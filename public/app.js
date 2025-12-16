// functions/api/bnschool_generate.js
// BN-Skola v1.6 – FIX: hard direction fungerar alltid (via use_as_new_direction ELLER prompt_mode)
// + soft prompt ska fortfarande påverka riktning (utan att tappa tråd)
// + reflektionsfrågor alltid svarbara.

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    const body = await request.json();

    const teacherMission = body.teacher_mission;
    const studentPrompt = typeof body.student_prompt === "string" ? body.student_prompt.trim() : "";
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
    const incomingWorldState = body.worldstate && typeof body.worldstate === "object" ? body.worldstate : {};

    // ✅ Robust "hard direction" detection:
    // 1) explicit flags from frontend (preferred)
    // 2) prompt_mode === "direction" (legacy/alternate)
    const promptMode = typeof body.prompt_mode === "string" ? body.prompt_mode : "";
    const useAsNewDirection =
      !!body.use_as_new_direction ||
      !!body.useAsNewDirection ||
      !!body.new_direction ||
      promptMode === "direction";

    // Soft influence = prompt finns men rutan inte är hard
    const hasSoftPrompt = !!studentPrompt && !useAsNewDirection;

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
    const qClean = (s) => cleanOneLine(s).replace(/[“”]/g, '"');

    // Length ranges (ord)
    const grade = parseInt(teacherMission.grade_level, 10) || 4;
    const len = safeStr(teacherMission.chapter_length || "normal").toLowerCase();

    const lengthTable = {
      2: { kort: [70, 90], normal: [90, 120], lang: [130, 170] },
      3: { kort: [90, 120], normal: [120, 160], lang: [170, 220] },
      4: { kort: [120, 160], normal: [160, 210], lang: [220, 320] },
      5: { kort: [140, 190], normal: [190, 250], lang: [260, 360] },
      6: { kort: [160, 210], normal: [210, 280], lang: [290, 400] },
      7: { kort: [180, 240], normal: [240, 320], lang: [330, 450] },
      8: { kort: [200, 260], normal: [260, 350], lang: [360, 520] },
      9: { kort: [220, 300], normal: [300, 420], lang: [430, 600] },
    };

    const ranges = lengthTable[grade] || lengthTable[4];
    const [minWords, maxWords] = ranges[len] || ranges["normal"];

    // ---------------------------
    // STATE parsing (status-lås)
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
    // SystemPrompt – v1-driv
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v1-DRIVE.

ROLL
- Du är MEDSPELARE i elevens äventyr – inte en föreläsare.
- Du skriver ALLTID i andra person (“du”) och talar direkt till eleven.

PRIORITET (VIKTIGAST ÖVERST)
1) LÄRARUPPDRAGETS fakta & mål (teacher_mission) är lag.
2) Elevens prompt styr riktning.
   - HARD: du måste följa elevens önskan som huvudspår DIREKT i kapitlet.
   - SOFT: elevens prompt ska ändå påverka nästa scen/val tydligt (du får inte ignorera den).
3) Kontinuitet: följ worldstate + locked_state. Tappa inte bort vilka som är med.

DRIV (MÅSTE FINNAS VARJE KAPITEL)
- Krok inom 1–2 meningar (något händer NU)
- Tydligt mål
- Hinder
- Framsteg i slutet (ni kommer närmare målet)

UTFORSKNING
- Visa världen genom handling.
- Max 1 kort sinnesrad per kapitel. Undvik “det luktar…” som standard.

DIALOG-BUDGET
- Max 6 repliker per kapitel totalt.

INGA PÅTVINGADE “MÅSTE KLARA”
- Skriv inte “endast den som…” eller “du måste klara X”.
- Skapa spänning via hinder/val, inte lås.

MIKROFAKTA (1 st / kapitel max)
- Max 1 mening, vävd i handlingen.

REFLEKTIONSFRÅGOR (EXAKT 3)
- Måste vara svarbara utifrån chapter_text.
1) Fakta (vad hände)
2) Förståelse (varför)
3) Personlig (vad hade du gjort)

LÄNGD
- ${minWords}-${maxWords} ord för chapter_text.

OUTPUT
Svara ENDAST med ren JSON:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar. Sista raden: STATE: {...}",
    "previousChapters": []
  }
}
`.trim();

    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_name: studentName,
      student_prompt: studentPrompt,
      prompt_mode: useAsNewDirection ? "hard_direction" : (hasSoftPrompt ? "soft_influence" : "continue"),
      worldstate: incomingWorldState || {},
      locked_state: lockedState,
    };

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.7,
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
        worldstate: { chapterIndex, summary_for_next: "STATE: {}", previousChapters: [] },
      };
    }

    let chapterText = safeStr(parsed.chapter_text || "").trim();

    // --- Post-fix: om gudar nämns men deras domäner saknas, lägg minimal rad (för att frågor ska funka) ---
    const mentionsZeus = /Zeus/.test(chapterText);
    const mentionsPoseidon = /Poseidon/.test(chapterText);
    const mentionsHades = /Hades/.test(chapterText);

    const needsZeusDomain = mentionsZeus && !/(styr|råder|härskar).*(himmel|åska|blixt)/i.test(chapterText);
    const needsPoseidonDomain = mentionsPoseidon && !/(styr|råder|härskar).*(hav|vatten|stormar|vågor)/i.test(chapterText);
    const needsHadesDomain = mentionsHades && !/(styr|råder|härskar).*(underjord|dödas|riket)/i.test(chapterText);

    const addon = [];
    if (needsZeusDomain) addon.push("Zeus styr över himlen och blixten.");
    if (needsPoseidonDomain) addon.push("Poseidon råder över havet och vågorna.");
    if (needsHadesDomain) addon.push("Hades härskar över underjorden och de dödas rike.");

    if (addon.length) {
      chapterText = `${chapterText}\n\n${addon.join(" ")}`;
    }

    // Enforce: EXAKT 3 reflektionsfrågor
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);

    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vad var det viktigaste som hände i kapitlet?`;
    const fallback2 = `Varför tror du att det hängde ihop med ${topic}?`;
    const fallback3 = `Vad hade du gjort som nästa steg?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "").trim() || "STATE: {}";

    const responseJson = {
      chapterIndex,
      chapterText,
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        summary_for_next: summaryForNext,
        previousChapters: safeArr(incomingWorldState.previousChapters || []),
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
