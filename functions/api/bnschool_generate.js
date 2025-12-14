// functions/api/bnschool_generate.js
// BN-Skola Demo – StoryEngine (BN-Kids-flyt + prompt-omstart-skydd via frontend)
// - Mindre moral/val i chapter_text
// - Längd styrs: teacher_mission.chapter_length + grade_level
// - Max kapitel stoppas server-side
// - STATE-lås i summary_for_next (för konsekvens över kapitel)

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const body = await request.json();
    const teacherMission = body.teacher_mission;
    const studentPrompt = body.student_prompt || "";
    const incomingWorldState = body.worldstate || {};

    if (!teacherMission || !teacherMission.topic) {
      return new Response(JSON.stringify({ error: "teacher_mission.topic saknas" }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY saknas i miljövariablerna" }), {
        status: 500,
        headers: corsHeaders
      });
    }

    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    const safeNum = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    // --- max kapitel (server-säkert) ---
    const maxCh = safeNum(teacherMission.max_chapters ?? 4, 4);
    const currentIdx = safeNum(incomingWorldState.chapterIndex ?? 0, 0);
    if (maxCh > 0 && currentIdx >= maxCh) {
      return new Response(JSON.stringify({ error: "Max antal kapitel är nått." }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const chapterIndex =
      typeof incomingWorldState.chapterIndex === "number"
        ? incomingWorldState.chapterIndex + 1
        : 1;

    // --- STATE parsing ---
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

    const lockedState = mergeState(parseStateFromText(incomingSummary), parseStateFromText(lastPrevSummary));

    // --- Längdintervall ---
    const grade = safeNum(teacherMission.grade_level, 4);
    const lengthMode = safeStr(teacherMission.chapter_length || "kort").toLowerCase();

    const lengthTable = {
      2: { kort: [70, 90], normal: [90, 110], lång: [110, 130] },
      3: { kort: [90, 120], normal: [120, 150], lång: [150, 180] },
      4: { kort: [120, 150], normal: [160, 190], lång: [200, 230] },
      5: { kort: [150, 190], normal: [200, 240], lång: [250, 300] },
      6: { kort: [170, 210], normal: [220, 270], lång: [280, 330] },
      7: { kort: [190, 240], normal: [250, 310], lång: [320, 390] },
      8: { kort: [210, 270], normal: [280, 350], lång: [360, 450] },
      9: { kort: [220, 290], normal: [300, 380], lång: [390, 480] }
    };

    const g = Math.min(9, Math.max(2, grade));
    const row = lengthTable[g] || lengthTable[4];
    const [minWords, maxWords] = row[lengthMode] || row.kort;

    // --- Systemprompt: BN-Kids-flyt i skolformat ---
    const systemPrompt = `
Du är BN-School StoryEngine.

MÅL:
Skapa en pedagogisk men levande berättelse som känns som BN-Kids: varm, flytande, dialogdriven, korta stycken.

HÅRDA REGLER:
1) Lärarens fakta är LAG. Du får inte ändra eller motsäga dem.
2) Elevens idé vävs in lekfullt utan att sabotera fakta.
3) Inget olämpligt innehåll (sex, svordomar, glorifierat våld).
4) Inga meta-kommentarer (“som en AI…”).

BN-KIDS-FLYT (VIKTIGT):
- Skriv “du”-form (andra person).
- Dialog + handling före förklaringar.
- INGEN moralpredikan i storytexten.
- Inga långa val-listor. Om interaktivt: max 1 mjuk fråga i storyn.

LÄNGD:
Sikta på ${minWords}–${maxWords} ord i "chapter_text". Överskrid inte max.

KONSEKVENS / STATUS-LÅSNING:
Du får "locked_state". Om något är lost/broken/inactive/weakened:
- Använd det inte som om det fungerar.
- Ändra status bara om berättelsen visar att det hittas/lagas/återfås.

OUTPUT: ENDAST REN JSON exakt så här:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar. Sista raden: STATE: {...}",
    "previousChapters": []
  }
}

REFLEKTIONSFRÅGOR: EXAKT 3
1) Fakta (vad?)
2) Förståelse (varför?)
3) Personlig (vad hade du gjort?)

SUMMARY_FOR_NEXT:
Skriv 2–4 meningar.
Sista raden måste börja exakt: STATE: { ... }
Om inga statusar: STATE: {}
`.trim();

    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
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
        temperature: 0.7,
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
      return new Response(JSON.stringify({ error: "OpenAI API fel", details: openaiJson }), {
        status: 500,
        headers: corsHeaders
      });
    }

    const rawContent = openaiJson?.choices?.[0]?.message?.content;
    if (!rawContent) {
      return new Response(JSON.stringify({ error: "Tomt svar från OpenAI" }), {
        status: 500,
        headers: corsHeaders
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      console.error("Kunde inte parsa JSON:", e);
      parsed = {
        chapter_text: rawContent,
        reflection_questions: [],
        worldstate: { chapterIndex, summary_for_next: "STATE: {}", previousChapters: [] }
      };
    }

    // Enforce: exakt 3 frågor
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);
    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vad var den viktigaste faktan i kapitlet om ${topic}?`;
    const fallback2 = `Varför var det som hände viktigt för att förstå ${topic}?`;
    const fallback3 = `Vad hade du gjort nu – och varför?`;
    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) rq.push([fallback1, fallback2, fallback3][rq.length]);

    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "STATE: {}");

    // previousChapters: spara “kapitelpaket” (text + frågor) så frontend kan visa snyggt
    let previousChapters = safeArr(incomingWorldState.previousChapters || []);

    const chapterPack = {
      chapterIndex,
      chapter_text: safeStr(parsed.chapter_text || ""),
      reflection_questions: rq,
      short_summary: summaryForNext
    };

    if (previousChapters.length > 0) {
      const last = previousChapters[previousChapters.length - 1];
      if (last && last.chapterIndex === chapterIndex) {
        previousChapters = [...previousChapters.slice(0, -1), chapterPack];
      } else {
        previousChapters = [...previousChapters, chapterPack];
      }
    } else {
      previousChapters = [chapterPack];
    }

    const responseWorldstate = {
      chapterIndex,
      summary_for_next: summaryForNext,
      previousChapters
    };

    const responseJson = {
      chapterIndex,
      chapterText: safeStr(parsed.chapter_text || ""),
      reflectionQuestions: rq,
      worldstate: responseWorldstate
    };

    return new Response(JSON.stringify(responseJson), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Oväntat fel i bnschool_generate:", err);
    return new Response(JSON.stringify({ error: "Internt fel", details: String(err) }), {
      status: 500,
      headers: corsHeaders
    });
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
