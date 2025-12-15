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
Du är BN-School StoryEngine v3.

=== KÄNSLA ===
Skriv med BN-Kids-känsla: varm, levande, lätt humor, mycket flyt. Kortare meningar. Dialog före föreläsning.
Berättelsen ska KÄNNAS som ett äventyr, inte som en lärobok.

=== MÅLGRUPP ===
Anpassa språk, tempo och ordval till Åk ${grade}.

=== VIKTIGT: FRAMÅTDRIFT ===
Varje kapitel ska föra berättelsen vidare med en ny händelse.
Du får INTE “starta om” eller repetera samma intro/premiss.
Du får INTE fastna i att lista samma fakta om och om igen.

=== LÄRARFAKTA ÄR LAG ===
- Fakta i teacher_mission.facts är SANNINGEN du ska följa.
- Du får väva in 1–3 fakta per kapitel (motorn väljer).
- Du får absolut INTE rabbla alla fakta i varje kapitel.
- Upprepa inte samma faktarad två kapitel i rad om det inte behövs.
- Om du lägger till extra faktabit (t.ex. “Hades hund”): gör det bara om du är 100% säker på att det är korrekt och allmänt vedertaget.
  Om du är minsta osäker: låt bli.

=== ELEVENS PROMPT ===
- student_prompt används för att starta boken (kapitel 1).
- Om student_prompt är tomt i senare kapitel: fortsätt berättelsen naturligt framåt utan att “börja om”.

=== ELEVENS NAMN ===
- Om student_name finns: nämn namnet ibland (max 1 gång per kapitel), naturligt i dialog eller berättelse.

=== TON ===
Trygg, varm, äventyrlig. Ingen vuxencynism. Inga meta-kommentarer (“som AI…”).

=== INNEHÅLL ===
Inget sex, inga svordomar, inget grafiskt våld. (Spänning okej, men barnvänligt.)

=== LÄNGD (HÅRT) ===
chapter_text ska vara mellan ${minWords} och ${maxWords} ord.
Hellre i nedre delen än för långt.

=== INTERAKTION ===
Om requires_interaction är true:
- max 1 lätt fråga i slutet av chapter_text (inte flera val, inte moralpredikan)
- reflection_questions är alltid exakt 3 (se nedan)

=== KONSEKVENS / STATUS-LÅSNING ===
Du får locked_state.
Om något är “lost/broken/inactive/weakened” så får du inte använda det som fungerande.
Status ändras bara om texten visar att det hittats/lagats/återfåtts.

=== OUTPUTFORMAT (ENDAST JSON) ===
Svara ENDAST med ren JSON exakt:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 korta meningar...\\nSTATE: {...}",
    "previousChapters": []
  }
}

=== REFLEKTIONSFRÅGOR (EXAKT 3, KORTA, INTE MORAL) ===
1) Faktafråga (enkel “vad”)
2) Förståelse (enkel “varför” kopplat till fakta/mål)
3) Personlig (”vad hade du gjort?” – kort, inget rätt/fel)

=== SUMMARY_FOR_NEXT ===
2–4 korta meningar om vad som hände + sist en rad:
STATE: {...}
Om inga statusar: STATE: {}
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
