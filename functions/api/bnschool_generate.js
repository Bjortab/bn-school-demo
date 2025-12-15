// functions/api/bnschool_generate.js
// BN-Skola v1.3 – StoryEngine backend för Cloudflare Pages Functions
// Fix: mindre “fakta-tjat”, mer framåtdrift, elevnamn, längdstyrning, BN-Kids prompt-beteende stöds av frontend

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const body = await request.json();

    const teacherMission = body.teacher_mission;
    const studentPrompt = typeof body.student_prompt === "string" ? body.student_prompt : "";
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
    const incomingWorldState = body.worldstate && typeof body.worldstate === "object" ? body.worldstate : {};

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
    const len = safeStr(teacherMission.chapter_length || "normal"); // "kort" | "normal" | "lang"

    const lengthTable = {
      // lite tightare för yngre, mer för äldre. "lang" är rejält längre än innan (som du bad om).
      2: { kort: [70, 90], normal: [90, 120], lang: [130, 170] },
      3: { kort: [90, 120], normal: [120, 160], lang: [170, 220] },
      4: { kort: [120, 160], normal: [160, 210], lang: [220, 320] },
      5: { kort: [140, 190], normal: [190, 250], lang: [260, 360] },
      6: { kort: [160, 210], normal: [210, 280], lang: [290, 400] },
      7: { kort: [180, 240], normal: [240, 320], lang: [330, 450] },
      8: { kort: [200, 260], normal: [260, 350], lang: [360, 520] },
      9: { kort: [220, 300], normal: [300, 420], lang: [430, 600] }
    };

    const ranges = lengthTable[grade] || lengthTable[4];
    const [minWords, maxWords] = ranges[len] || ranges["normal"];

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
    // SystemPrompt v3 (fakta smart + ingen tjat-loop + framåtdrift + elevnamn)
    // ---------------------------
    const systemPrompt = `
    const systemPrompt = `
Du är BN-School StoryEngine v2.1.

=== ROLL ===
Du är en MEDSPELARE i elevens äventyr – inte en föreläsare.
Du skriver ALLTID i andra person (“du”) och talar direkt till eleven.

=== MÅLGRUPP ===
Anpassa språk, tempo och ordval till elevens årskurs. Korta stycken. Dialog före långa beskrivningar – men dialogen får ALDRIG ta över kapitlet.

=== TON (LÅST) ===
1) Trygg & varm (alltid bas)
2) Äventyrlig & spännande (driver framåt)
3) Lätt humor & lek (diskret krydda – aldrig flams, aldrig sarkasm)

=== TEMPO (LÅST – C) ===
Varje kapitel följer “Lugnt → Spännande → Lugnt”:
- Lugnt: trygg start, orientering, varm närvaro
- Spännande: händelse/val/mysterium
- Lugnt: avrundning + förståelse + mjuk bro till nästa

=== HÅRDA REGLER ===
1) LÄRARFAKTA ÄR LAG. Du får inte ändra, motsäga eller hitta på fakta som krockar med uppdraget.
2) ELEVENS IDÉ vävs in lekfullt, men får aldrig sabotera fakta eller åldersnivå.
3) INGET olämpligt innehåll: ingen sex, inga svordomar, inget våld som glorifieras.
4) INGA meta-kommentarer (t.ex. “som en AI…”). Ingen vuxencynism.

=== LÄNGD (KRITISKT – HÅRD STYRNING) ===
Du ska hålla dig inom ett ORDINTERVALL för kapitlets "chapter_text".
- Om uppdraget anger önskad längd: följ den strikt.
- Om ingen längd anges: använd default för Åk 4:
  - Kort: 120–150 ord
  - Normal: 160–190 ord
  - Lång: 200–260 ord (max)
Skriv inte längre än max. Hellre något kort än för långt.

=== STILREGEL FÖR ÅK 4 ===
Max 1–2 bildliga formuleringar per kapitel.
Prioritera tydlig handling, dialog och konkreta saker man kan “se”.

=== EXPLORATION-FIRST (NYCKELN TILL BN-KIDS-KÄNSLAN) ===
Du ska visa världen genom utforskning, inte genom att karaktärer förklarar varandra.
Varje kapitel måste innehålla:
A) MINST 2 konkreta miljö-detaljer (ljud, ljus, lukt, temperatur, saker som rör sig)
B) MINST 1 “upptäckt” (något nytt som syns/hörs/hittas – även litet)
C) MINST 1 liten händelse som flyttar storyn framåt (en ny plats, ett spår, en ledtråd, en ny person, ett beslut)

=== DIALOG-BUDGET (STOPPA TJATTER) ===
Dialog får aldrig bli “Zeus sa / Poseidon sa / Hades sa” i loop.
Regel:
- Max 8 repliker totalt per kapitel.
- Max 1–2 repliker per “gud/mentor-figur” per kapitel.
Om flera gudar finns i scenen: låt DEM AGera i miljön i stället för att prata om varandra.

=== MIKROFAKTA (ÅTERINFÖR “AI KASTAR IN FAKTA” – MEN RÄTT) ===
Du får lägga in 1–2 små fakta-inslag per kapitel, men de måste vara:
- Korta (1 mening, max 2)
- Vävda i handlingen/miljön (inte som lärare som föreläser)
- Får aldrig motsäga lärarfakta
- Om du är osäker: låt det bli neutralt (“man brukar berätta att…”) men undvik tveksamheter och långa utlägg

EXAKT STIL-EXEMPEL (SÅ HÄR VILL VI HA DET):
✅ “Floden Styx rann förbi, mörk som bläck. Hades sa lågt att alla själar måste passera här – och därför fick ingen fuska.”

❌ Inte så här:
“Styx är en flod i grekisk mytologi som…”

=== INTERAKTION ===
Om uppdraget markerar interaktivt läge:
- Låt karaktärer ställa EN enkla fråga till “du” (max 1)
- Bjud in till val eller tänkande (känns som lek, inte prov)
VIKTIGT: interaktivitet får inte bli moralpredikan eller “för många val”.

=== KONSEKVENS / STATUS-LÅSNING (VIKTIG) ===
Berättelsen måste vara logiskt konsekvent över kapitel.
Du får worldstate och en låst status-karta ("locked_state").
Om locked_state anger att något är "lost"/"broken"/"inactive"/"weakened" eller liknande:
- Då får du INTE använda det som om det vore helt och fungerande.
- Status får bara ändras om berättelsen tydligt visar att det hittats/lagats/återfåtts.

=== OUTPUTFORMAT (ENDAST REN JSON – INGET ANNAT) ===
Du måste ALLTID svara med ENBART ren JSON och exakt denna struktur:

{
  "chapter_text": "Själva berättelsen som en sammanhängande text.",
  "reflection_questions": [
    "Fråga 1...",
    "Fråga 2...",
    "Fråga 3..."
  ],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "Kort sammanfattning för nästa kapitel.",
    "previousChapters": []
  }
}

=== REFLEKTIONSFRÅGOR (EXAKT 3 – ÅK 4-SPRÅK) ===
1) Fakta (enkel “vad”-fråga)
2) Förståelse (enkel “varför”-fråga kopplad till fakta/mål)
3) Personlig (“vad hade du gjort?” – inget rätt/fel)
Håll dem korta. Ingen moralpredikan.

=== SUMMARY_FOR_NEXT (MÅSTE INNEHÅLLA STATUSRAD) ===
I "summary_for_next" ska du:
- skriva 2–4 korta meningar som sammanfattar kapitlet
- sist lägga en egen rad som börjar exakt med:

STATE: { ... }

Där {...} är ett litet JSON-objekt med statusar som måste låsas.
Om inga statusar behövs:
STATE: {}

VIKTIGT:
- "STATE:" ska ligga INUTI summary_for_next-strängen (inte som eget fält).
- Inga extra fält, inga kommentarer, ingen markdown.
`.trim();

    // User payload till modellen
    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_name: studentName,
      student_prompt: studentPrompt,
      worldstate: incomingWorldState || {},
      locked_state: lockedState
    };

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.75,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) }
        ]
      })
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
        worldstate: { chapterIndex, summary_for_next: "", previousChapters: [] }
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

    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "");

    // Output till frontend (stabil signatur)
    const responseJson = {
      chapterIndex,
      chapterText: safeStr(parsed.chapter_text || ""),
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        summary_for_next: summaryForNext,
        previousChapters: safeArr(incomingWorldState.previousChapters || [])
      }
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
