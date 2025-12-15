// functions/api/bnschool_generate.js
// BN-Skola v1.5 – StoryEngine backend för Cloudflare Pages Functions
// Fix: stoppar “tre gudar-rollcall”, minskar dialog, ökar utforskning + stabil prompt-beteende + kapitel-sparande.

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await request.json();

    const teacherMission = body.teacher_mission || {};
    const studentPromptRaw = typeof body.student_prompt === "string" ? body.student_prompt : "";
    const studentPrompt = studentPromptRaw.trim();
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
    const incomingWorldState = body.worldstate && typeof body.worldstate === "object" ? body.worldstate : {};

    // Frontend checkbox: true = ny riktning (använd prompt igen)
    const usePromptAsNewDirection = !!body.use_prompt_as_new_direction;

    if (!teacherMission || !teacherMission.topic) {
      return new Response(JSON.stringify({ error: "teacher_mission.topic saknas" }), { status: 400, headers: corsHeaders });
    }

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY saknas i miljövariablerna" }), { status: 500, headers: corsHeaders });
    }

    // chapterIndex (nästa)
    const prevIndex = typeof incomingWorldState.chapterIndex === "number" ? incomingWorldState.chapterIndex : 0;
    const chapterIndex = prevIndex + 1;

    // Helpers
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    // Length ranges (ord)
    const grade = parseInt(teacherMission.grade_level, 10) || 4;
    const len = safeStr(teacherMission.chapter_length || "normal").toLowerCase(); // "kort" | "normal" | "lang"

    const lengthTable = {
      2: { kort: [70, 90], normal: [90, 120], lang: [130, 170] },
      3: { kort: [90, 120], normal: [120, 160], lang: [170, 220] },
      4: { kort: [120, 160], normal: [160, 210], lang: [230, 360] }, // lång lite längre
      5: { kort: [140, 190], normal: [190, 260], lang: [270, 390] },
      6: { kort: [160, 210], normal: [210, 290], lang: [300, 430] },
      7: { kort: [180, 240], normal: [240, 330], lang: [340, 480] },
      8: { kort: [200, 270], normal: [270, 370], lang: [380, 550] },
      9: { kort: [220, 310], normal: [310, 430], lang: [440, 620] },
    };

    const ranges = lengthTable[grade] || lengthTable[4];
    const [minWords, maxWords] = (ranges[len] || ranges["normal"]);

    // ---------------------------
    // STATE parsing (låst status)
    // ---------------------------
    const parseStateFromText = (text) => {
      const t = safeStr(text);
      if (!t) return {};
      const lines = t.split(/\r?\n/).map((x) => x.trim());
      const stateLine = lines.find((l) => l.startsWith("STATE:"));
      if (!stateLine) return {};
      const jsonPart = stateLine.replace(/^STATE:\s*/, "").trim();
      if (!jsonPart) return {};
      try {
        const obj = JSON.parse(jsonPart);
        return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
      } catch {
        return {};
      }
    };

    const mergeState = (a, b) => {
      const out = {};
      if (a && typeof a === "object") for (const [k, v] of Object.entries(a)) out[k] = v;
      if (b && typeof b === "object") for (const [k, v] of Object.entries(b)) out[k] = v;
      return out;
    };

    const incomingSummary = safeStr(incomingWorldState.summary_for_next || "");
    const incomingPrev = safeArr(incomingWorldState.previousChapters || []);
    const lastPrev = incomingPrev.length ? incomingPrev[incomingPrev.length - 1] : null;
    const lastPrevSummary = lastPrev ? safeStr(lastPrev.short_summary || "") : "";

    const stateFromSummary = parseStateFromText(incomingSummary);
    const stateFromLastPrev = parseStateFromText(lastPrevSummary);
    const lockedState = mergeState(stateFromSummary, stateFromLastPrev);

    // ---------------------------
    // BN-Kids prompt-beteende:
    // - Kapitel 1: använd prompt om den finns
    // - Kapitel 2+: använd prompt bara om checkbox = true
    // ---------------------------
    const promptEffective = (chapterIndex === 1 || usePromptAsNewDirection) ? studentPrompt : "";

    // ---------------------------
    // SystemPrompt v2.2 (Anti-rollcall + mer exploration)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v2.2.

=== ROLL ===
Du är en MEDSPELARE i elevens äventyr – inte en föreläsare.
Du skriver ALLTID i andra person (“du”) och talar direkt till eleven.

=== ELEVENS NAMN (VIKTIGT) ===
Om "student_name" finns: använd exakt det namnet (inte “Björn” om det inte är namnet).
Nämn namnet naturligt MAX 1 gång per kapitel, helst i första stycket.

=== MÅLGRUPP ===
Anpassa språk, tempo och ordval till elevens årskurs. Korta stycken.

=== TON ===
Trygg & varm (bas) + Äventyrlig (driver framåt) + Lätt humor (diskret).

=== HÅRDA REGLER ===
1) LÄRARFAKTA ÄR LAG. Du får inte motsäga uppdragets fakta.
2) ELEVENS IDÉ vävs in, men får aldrig sabotera fakta eller åldersnivå.
3) Inget olämpligt innehåll. Inga svordomar. Ingen vuxencynism.
4) Inga meta-kommentarer (“som en AI…”).

=== LÄNGD (KRITISKT) ===
Håll "chapter_text" ungefär ${minWords}–${maxWords} ord. Gå inte över max.

=== EXPLORATION-FIRST (NYCKELN) ===
Varje kapitel MÅSTE innehålla:
A) minst 3 konkreta miljödetaljer (ljud/ljus/lukt/temperatur/rörelse)
B) minst 2 “upptäckter” (något nytt syns/hörs/hittas – även litet)
C) minst 1 händelse som flyttar storyn framåt (ny plats, spår, ledtråd, beslut, ny person)

=== ANTI-ROLLCALL (VIKTIGT – STOPPA “TRE GUDARNA”) ===
Du får INTE starta med att rada upp flera gudar med “Jag är X och jag styr Y”.
Regler:
- I kapitel 1: introducera max 1 gud/mentor tydligt med namn.
- Övriga (om de alls ska finnas): ska bara anas via miljön (eko, skugga, spår, symbol, ljud) – inga presentationstal.
- I kapitel 2+: om flera gudar finns i scenen: max 1 kort replik per figur och inget “vi tre… utan oss… jag styr…”.
Fokus ska vara på platsen, sakerna, mysteriet – inte på att de pratar om varandra.

=== DIALOG-BUDGET ===
Max 6 repliker per kapitel totalt. Dialog får aldrig bli en “X sa / Y sa / Z sa”-loop.

=== MIKROFAKTA (SMART) ===
Lägg in 1–2 mikrofakta per kapitel, kort och invävt i scenen (inte uppslagsbok).
Stil:
“Floden Styx rann förbi, mörk som bläck. Hades sa lågt att alla själar måste passera här – och därför fick ingen fuska.”

=== INTERAKTION ===
Om interaktivt läge: ställ max 1 fråga i kapitlet (känns som lek).

=== REFLEKTIONSFRÅGOR (EXAKT 3 – OCH INTE REPETITIVA) ===
Frågorna ska variera och kopplas till kapitlets händelser + lärarens fakta.
Förbjudet om inte lärarfaktan kräver det: “Vilka tre gudar mötte du…”.
Format:
1) Fakta (vad)
2) Förståelse (varför)
3) Personlig (vad hade du gjort)

=== KONSEKVENS / STATUS-LÅSNING ===
Respektera locked_state. Ingen “reset” av storyn.

=== OUTPUTFORMAT (ENDAST JSON) ===
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar. Sist en rad: STATE: {}",
    "previousChapters": []
  }
}
`.trim();

    // User payload
    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_name: studentName,
      student_prompt: promptEffective,
      prompt_mode: (promptEffective ? "new_direction" : "continue_forward"),
      previous_summary: incomingSummary,
      worldstate: incomingWorldState || {},
      locked_state: lockedState,
    };

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.75,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
    });

    const openaiJson = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error("OpenAI-fel:", openaiResponse.status, openaiJson);
      return new Response(JSON.stringify({ error: "OpenAI API fel", details: openaiJson }), { status: 500, headers: corsHeaders });
    }

    let rawContent = openaiJson?.choices?.[0]?.message?.content;
    if (!rawContent) {
      return new Response(JSON.stringify({ error: "Tomt svar från OpenAI" }), { status: 500, headers: corsHeaders });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      console.error("Kunde inte parsa JSON från OpenAI:", e);
      parsed = {
        chapter_text: rawContent,
        reflection_questions: [],
        worldstate: { chapterIndex, summary_for_next: "", previousChapters: [] },
      };
    }

    // Enforce: EXAKT 3 reflektionsfrågor
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);

    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vad var det viktigaste du lade märke till om ${topic} i kapitlet?`;
    const fallback2 = `Varför tror du att den detaljen var viktig i berättelsen?`;
    const fallback3 = `Vad hade du gjort om du var där själv?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    const chapterText = safeStr(parsed.chapter_text || "");
    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "");

    // Kapitel-sparande
    const updatedPrevious = safeArr(incomingWorldState.previousChapters || []).slice();
    updatedPrevious.push({
      chapterIndex,
      short_summary: summaryForNext || `Kapitel ${chapterIndex} klart.\nSTATE: {}`,
    });

    const responseJson = {
      chapterIndex,
      chapterText,
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        summary_for_next: summaryForNext,
        previousChapters: updatedPrevious,
      },
    };

    return new Response(JSON.stringify(responseJson), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Oväntat fel i bnschool_generate:", err);
    return new Response(JSON.stringify({ error: "Internt fel i bnschool_generate", details: String(err) }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
