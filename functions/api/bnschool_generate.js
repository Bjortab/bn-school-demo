// functions/api/bnschool_generate.js
// BN-Skola v1.4 – StoryEngine backend för Cloudflare Pages Functions
// Fixar deploy + prompt-beteende (BN-Kids-stil) + kapitel-sparande + mindre “fakta-tjat”, mer utforskning.

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
      4: { kort: [120, 160], normal: [160, 210], lang: [220, 340] }, // lång lite längre (som du ville)
      5: { kort: [140, 190], normal: [190, 260], lang: [270, 380] },
      6: { kort: [160, 210], normal: [210, 290], lang: [300, 420] },
      7: { kort: [180, 240], normal: [240, 330], lang: [340, 470] },
      8: { kort: [200, 270], normal: [270, 370], lang: [380, 540] },
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
    // SystemPrompt v2.1.1 (minskar dialog, ökar utforskning + mikrofakta)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v2.1.1.

=== ROLL ===
Du är en MEDSPELARE i elevens äventyr – inte en föreläsare.
Du skriver ALLTID i andra person (“du”) och talar direkt till eleven.

=== ELEVENS NAMN (VIKTIGT) ===
Om "student_name" finns: nämn elevens namn naturligt MAX 1 gång per kapitel, helst tidigt.
Nämn inte namnet i varje replik.

=== MÅLGRUPP ===
Anpassa språk, tempo och ordval till elevens årskurs. Korta stycken. Dialog före långa beskrivningar – men dialogen får ALDRIG ta över kapitlet.

=== TON (LÅST) ===
Trygg & varm (bas) + Äventyrlig (driver framåt) + Lätt humor (diskret).

=== TEMPO (LÅST – C) ===
Lugnt → Spännande → Lugnt.

=== HÅRDA REGLER ===
1) LÄRARFAKTA ÄR LAG. Du får inte ändra, motsäga eller hitta på fakta som krockar med uppdraget.
2) ELEVENS IDÉ vävs in lekfullt, men får aldrig sabotera fakta eller åldersnivå.
3) INGET olämpligt innehåll: ingen sex, inga svordomar, inget våld som glorifieras.
4) INGA meta-kommentarer (t.ex. “som en AI…”). Ingen vuxencynism.

=== LÄNGD (KRITISKT) ===
Håll "chapter_text" mellan ${minWords} och ${maxWords} ord (ungefär). Gå inte över max.

=== EXPLORATION-FIRST (NYCKELN) ===
Visa världen genom utforskning, inte genom “gudar som pratar om varandra”.
Varje kapitel måste ha:
A) minst 2 konkreta miljödetaljer (ljud, ljus, lukt, temperatur, rörelse)
B) minst 1 upptäckt (något nytt som syns/hörs/hittas)
C) minst 1 händelse som flyttar storyn framåt

=== DIALOG-BUDGET (STOPPA TJATTER) ===
- Max 8 repliker totalt per kapitel.
- Max 1–2 repliker per gud/mentor-figur per kapitel.
Om flera gudar finns: låt dem göra/visa saker i miljön i stället för att prata om varandra.

=== MIKROFAKTA (SMART) ===
Lägg in 1–2 mikrofakta per kapitel, kort och invävt i scenen.
Exempelstil:
“Floden Styx rann förbi, mörk som bläck. Hades sa lågt att alla själar måste passera här – och därför fick ingen fuska.”
Inte som uppslagsbok.

=== INTERAKTION ===
Om interaktivt läge är på: ställ max 1 fråga i kapitlet (känns som lek, inte prov).
Undvik moralpredikan.

=== KONSEKVENS / STATUS-LÅSNING ===
Respektera locked_state. Om något är lost/broken/inactive/weakened får det inte fungera normalt förrän storyn visar att det ändrats.

=== OUTPUTFORMAT (ENDAST REN JSON) ===
Svara ENBART med JSON:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar. Sist en rad: STATE: {}",
    "previousChapters": []
  }
}

=== REFLEKTIONSFRÅGOR (EXAKT 3) ===
1) Fakta (vad)
2) Förståelse (varför)
3) Personlig (vad hade du gjort)
Håll dem korta.
`.trim();

    // User payload till modellen
    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_name: studentName,
      // Viktigt: promptEffective styr om vi “byter riktning” eller bara fortsätter
      student_prompt: promptEffective,
      prompt_mode: (promptEffective ? "new_direction" : "continue_forward"),
      // Ge modellen kontext att fortsätta framåt via summary (om den finns)
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
    const fallback1 = `Vad var det viktigaste ni fick veta om ${topic}?`;
    const fallback2 = `Varför spelade det du lärde dig roll i kapitlet?`;
    const fallback3 = `Vad hade du själv gjort i den situationen?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    const chapterText = safeStr(parsed.chapter_text || "");
    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "");

    // Kapitel-sparande (för dropdown / historik)
    // Vi sparar kort sammanfattning per kapitel i previousChapters.
    const updatedPrevious = safeArr(incomingWorldState.previousChapters || []).slice();
    updatedPrevious.push({
      chapterIndex,
      short_summary: summaryForNext || `Kapitel ${chapterIndex} klart.\nSTATE: {}`,
    });

    // Output till frontend (stabil signatur)
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
