// functions/api/bnschool_generate.js
// BN-Skola v1.4 – StoryEngine backend (Pages Functions)
//
// Mål med v1.4:
// - V1-drivet tillbaka (problem -> handling -> nästa steg)
// - Elevens prompt blir ett "STORY GOAL" som modellen MÅSTE följa (Atlantis ignoreras inte)
// - Mindre rundsnack, mer utforskning med syfte
// - Reflektionsfrågor måste vara svarbara från texten (backend gör enkel sanity-fix)
// - Robust worldstate: sparar story_goal + last_student_prompt + korta summaries

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await request.json();

    const teacherMission = body.teacher_mission;
    const studentPrompt = typeof body.student_prompt === "string" ? body.student_prompt.trim() : "";
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
      2: { kort: [70, 95], normal: [95, 130], lang: [140, 190] },
      3: { kort: [90, 125], normal: [125, 175], lang: [185, 245] },
      4: { kort: [120, 165], normal: [165, 230], lang: [240, 340] },
      5: { kort: [140, 195], normal: [195, 270], lang: [280, 380] },
      6: { kort: [160, 220], normal: [220, 310], lang: [320, 430] },
      7: { kort: [180, 250], normal: [250, 350], lang: [360, 480] },
      8: { kort: [200, 280], normal: [280, 390], lang: [400, 540] },
      9: { kort: [220, 310], normal: [310, 440], lang: [450, 620] },
    };

    const ranges = lengthTable[grade] || lengthTable[4];
    const [minWords, maxWords] = ranges[len] || ranges["normal"];

    // ---------------------------
    // Locked state parsing (STATE: {...} i summary)
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
    // STORY GOAL (nyckeln till att prompten INTE ignoreras)
    // ---------------------------
    // Regler:
    // - Kapitel 1: studentPrompt = story_goal (om finns). Annars mål från teacherMission.
    // - Kapitel 2+: Om studentPrompt finns => uppdatera story_goal till den (direktiv).
    //              Annars behåll worldstate.story_goal.
    const prevGoal = safeStr(incomingWorldState.story_goal || "");
    const defaultGoal = `Gör en spännande historia som lär ut om: ${safeStr(teacherMission.topic)}`;
    const storyGoal =
      chapterIndex === 1
        ? (studentPrompt || prevGoal || defaultGoal)
        : (studentPrompt || prevGoal || defaultGoal);

    const lastStudentPrompt = studentPrompt || safeStr(incomingWorldState.last_student_prompt || "");

    // ---------------------------
    // SystemPrompt – V1-DRIV (hårt)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v1-DRIVE.

=== KÄRNIDÉ ===
Du skapar ett äventyr som känns som "nu händer det", inte som en rundtur.
Varje kapitel måste ha:
1) PROBLEM (något konkret står på spel eller är oklart)
2) HANDLING (du/ni gör något direkt)
3) RESULTAT/LEDTRÅD (något nytt som tvingar nästa steg)

=== POV ===
Skriv alltid i andra person ("du") och prata till eleven.
Om elevens namn finns: nämn det naturligt 1–2 gånger max.

=== STORY GOAL (MÅSTE FÖLJAS) ===
Du får ett "story_goal". Det är elevens vilja eller riktning.
Du MÅSTE:
- Väva in story_goal i kapitlets handling
- Göra det till ett konkret nästa steg (inte ignorera det)
- Om story_goal är omöjligt just NU: ge en tydlig "väg dit" (ledning/spår/portal/krav) samma kapitel.

Exempel:
Goal: "Ta mig till Atlantis"
✅ Poseidon visar en symbol/karta/port som kräver en nyckel – och ni tar första steget mot den.

❌ Inte okej:
Ignorera Atlantis och fortsätt med allmän tugg.

=== FAKTA (LÄRARUPPDRAG) ===
Lärarfakta är lag. Du får lägga 1–2 mikrofakta per kapitel, men de ska sitta i handlingen.
Inga föreläsningar.

=== REALISM I FANTASY ===
Fantasy är okej, men undvik fåniga/ologiska detaljer.
- Inga "mullrar när en sköldpadda simmar" om det inte finns tydlig fantasy-orsak som gör det coolt.
- Inga random föremål som "bara dyker upp" utan motivation. Om något hittas: visa varför det är där.

=== DIALOG-BUDGET (STOPPA TJAT) ===
Max 6 repliker per kapitel.
Max 1 replik per gud/mentor per kapitel.
Prioritera handling, miljö och framåtdrift.

=== UTFORSKNING MED SYFTE ===
Minst 2 konkreta miljödetaljer (ljud/ljus/lukt/temperatur/rörelse),
men de måste driva scenen framåt (t.ex. avslöjar en ledtråd, varnar, visar väg).

=== LÄNGD (HÅRT) ===
Håll dig mellan ${minWords} och ${maxWords} ord i chapter_text.
Hellre lite kort än för långt.

=== REFLEKTIONSFRÅGOR (VIKTIGT) ===
Exakt 3 frågor.
De måste vara svarbara från chapter_text.
Ställ inte frågor om saker som inte uttryckligen nämnts i texten.

Format:
1) Fakta (Vad såg/hette/var?)
2) Förståelse (Varför hände/varför gjorde ni?)
3) Personlig (Vad hade du gjort?)

=== KONSEKVENS / LOCKED STATE ===
Om locked_state säger att något är trasigt/förlorat/inaktivt: använd det inte som fungerande.

=== OUTPUT (ENBART JSON) ===
Svara med exakt:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "story_goal": "...",
    "last_student_prompt": "...",
    "summary_for_next": "2–4 meningar\\nSTATE: {...}",
    "previousChapters": []
  }
}
`.trim();

    // User payload till modellen
    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_name: studentName,
      student_prompt: studentPrompt,
      story_goal: storyGoal,
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
        temperature: 0.78,
        max_tokens: 1400,
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
      return new Response(JSON.stringify({ error: "OpenAI API fel", details: openaiJson }), {
        status: 500,
        headers: corsHeaders,
      });
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
        worldstate: { chapterIndex, story_goal: storyGoal, last_student_prompt: lastStudentPrompt, summary_for_next: "STATE: {}", previousChapters: [] },
      };
    }

    const chapterText = safeStr(parsed.chapter_text || "");
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);

    // Fallbackfrågor som alltid går att svara på från texten (vi gör dem generiska men relevanta)
    const fallback1 = "Vilken plats eller sak upptäckte du i kapitlet?";
    const fallback2 = "Varför var den upptäckten viktig för nästa steg?";
    const fallback3 = "Vad hade du valt att göra härnäst, och varför?";

    // Enforce: exakt 3 frågor
    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    // --- Sanity-fix: frågor måste matcha texten ---
    // Enkel heuristik: om fråga nämner ett namn/ord som inte finns i texten -> byt till fallback som går att svara på.
    const mustExistTerms = ["Zeus", "Poseidon", "Hades", "Atlantis", "Styx"];
    const textHas = (term) => chapterText.toLowerCase().includes(term.toLowerCase());
    const questionMentions = (q, term) => q.toLowerCase().includes(term.toLowerCase());

    rq = rq.map((q, idx) => {
      for (const term of mustExistTerms) {
        if (questionMentions(q, term) && !textHas(term)) {
          // Byt till en fråga som säkert går att svara på från texten
          if (idx === 0) return fallback1;
          if (idx === 1) return fallback2;
          return fallback3;
        }
      }
      return q;
    });

    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "STATE: {}");

    // previousChapters: behåll inkommande + lägg till en kort summary-rad (om finns)
    const prevChapters = safeArr(incomingWorldState.previousChapters || []).slice(0, 50);

    const shortSummary = summaryForNext.split("\n")[0]?.trim() || "";
    if (shortSummary) {
      prevChapters.push({
        chapterIndex,
        short_summary: shortSummary.length > 240 ? shortSummary.slice(0, 240) + "…" : shortSummary,
      });
    }

    // Output till frontend (stabil signatur)
    const responseJson = {
      chapterIndex,
      chapterText,
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        story_goal: safeStr(parsed.worldstate?.story_goal || storyGoal),
        last_student_prompt: safeStr(parsed.worldstate?.last_student_prompt || lastStudentPrompt),
        summary_for_next: summaryForNext,
        previousChapters: prevChapters,
      },
    };

    return new Response(JSON.stringify(responseJson), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Oväntat fel i bnschool_generate:", err);
    return new Response(JSON.stringify({ error: "Internt fel i bnschool_generate", details: String(err) }), {
      status: 500,
      headers: corsHeaders,
    });
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
