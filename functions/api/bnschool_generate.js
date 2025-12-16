// functions/api/bnschool_generate.js
// BN-Skola v1.4 – StoryEngine backend (Cloudflare Pages Functions)
//
// Fokus: tillbaka till V1-DRIV
// - Mindre “runtprat”, mer faktisk förflyttning och utforskning
// - Varje kapitel: ny plats / ny upptäckt / konsekvens / tydlig hook framåt
// - Elevens prompt används bara när: kapitel 1 ELLER "use_new_direction"=true
// - Elevens namn vävs in
// - Kapitel sparas i worldstate.previousChapters + summary_for_next
// - 1–2 mikro-fakta per kapitel (inbakade i händelser, inte föreläsning)
//
// Förväntad request-body (frontend):
// {
//   teacher_mission: { topic, facts[], learning_goals[], grade_level, chapter_length, interactive_mode, story_style, max_chapters },
//   student_prompt: "…",
//   student_name: "Björn",
//   use_new_direction: true/false,   // checkbox i UI
//   worldstate: { chapterIndex, summary_for_next, previousChapters: [...] }
// }

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

    const teacherMission = body.teacher_mission || null;
    const studentPromptRaw = typeof body.student_prompt === "string" ? body.student_prompt : "";
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
    const useNewDirection = !!body.use_new_direction; // <-- checkbox (viktigt)
    const incomingWorldState =
      body.worldstate && typeof body.worldstate === "object" && !Array.isArray(body.worldstate)
        ? body.worldstate
        : {};

    if (!teacherMission || !teacherMission.topic) {
      return new Response(JSON.stringify({ error: "teacher_mission.topic saknas" }), { status: 400, headers: corsHeaders });
    }

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY saknas i miljövariablerna" }), { status: 500, headers: corsHeaders });
    }

    // ------------------------------------------------------------
    // 1) ChapterIndex (nästa kapitel)
    // ------------------------------------------------------------
    const prevIndex = typeof incomingWorldState.chapterIndex === "number" ? incomingWorldState.chapterIndex : 0;
    const chapterIndex = prevIndex + 1;

    // ------------------------------------------------------------
    // 2) Helpers (safe)
    // ------------------------------------------------------------
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    const topic = safeStr(teacherMission.topic || "ämnet").trim();
    const grade = parseInt(teacherMission.grade_level, 10) || 4;

    // chapter_length kan vara: "kort" | "normal" | "lang" | "lång"
    let len = safeStr(teacherMission.chapter_length || "normal").toLowerCase().trim();
    if (len === "lång") len = "lang";
    if (!["kort", "normal", "lang"].includes(len)) len = "normal";

    const interactiveMode = !!teacherMission.interactive_mode; // kryssruta i UI (om ni har)
    const storyStyle = safeStr(teacherMission.story_style || "").toLowerCase().trim(); // "rolig", "realistisk", "äventyrlig" etc.

    // ------------------------------------------------------------
    // 3) Längdstyrning (ordintervall)
    //    (lite längre "lang" än tidigare, men inte tok-långt i demo)
    // ------------------------------------------------------------
    const lengthTable = {
      2: { kort: [70, 95], normal: [95, 125], lang: [135, 180] },
      3: { kort: [90, 125], normal: [125, 165], lang: [175, 230] },
      4: { kort: [120, 160], normal: [160, 210], lang: [220, 320] },
      5: { kort: [140, 190], normal: [190, 250], lang: [260, 360] },
      6: { kort: [160, 210], normal: [210, 280], lang: [290, 400] },
      7: { kort: [180, 240], normal: [240, 320], lang: [330, 460] },
      8: { kort: [200, 270], normal: [270, 360], lang: [370, 520] },
      9: { kort: [220, 300], normal: [300, 420], lang: [430, 600] },
    };

    const ranges = lengthTable[grade] || lengthTable[4];
    const [minWords, maxWords] = ranges[len] || ranges["normal"];

    // ------------------------------------------------------------
    // 4) Parse locked STATE från summary_for_next (om den finns)
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // 5) Prompt-regel (SUPERviktig för ditt problem)
    //    - Kap 1: använd prompt
    //    - Kap 2+: använd prompt bara om use_new_direction=true
    // ------------------------------------------------------------
    const studentPrompt = cleanOneLine(studentPromptRaw);
    const shouldUsePrompt = chapterIndex === 1 || useNewDirection;

    // Vi skickar även med en "effective_prompt" så modellen fattar vad som gäller.
    const effectivePrompt = shouldUsePrompt ? studentPrompt : "";

    // ------------------------------------------------------------
    // 6) Fakta/mål från läraren
    // ------------------------------------------------------------
    const teacherFacts = safeArr(teacherMission.facts || teacherMission.teacher_facts || []).map(cleanOneLine).filter(Boolean);
    const learningGoals = safeArr(teacherMission.learning_goals || teacherMission.goals || []).map(cleanOneLine).filter(Boolean);

    // ------------------------------------------------------------
    // 7) SYSTEMPROMPT – V1-DRIV (här är hela hemligheten)
    // ------------------------------------------------------------
    // Obs: Vi instruerar bort “gudar snackar om varandra”-loop,
    // och tvingar fram "rundtur/utforskning" och faktisk förflyttning.
    const systemPrompt = `
Du är BN-Skola StoryEngine – V1-DRIV (stabil demo-motor).

=== ROLL ===
Du skriver ett kapitel som känns som ett äventyr där eleven dras framåt.
Du skriver ALLTID i andra person (“du”) och talar direkt till eleven.

=== KÄRNMÅL (DET HÄR ÄR V1-DRIVET) ===
Varje kapitel MÅSTE innehålla:
1) FÖRFLYTTNING: eleven går från en plats till en ny plats (A → B).
2) UPPTÄCKT: minst 1 tydlig upptäckt (sak/varelse/spår/rum/mekanism).
3) KONKRET HÄNDELSE: något händer som ändrar läget (kan ej vara bara prat).
4) HOOK: slutet pekar på NÄSTA konkreta steg (inte en diskussion).

Om du inte uppfyller dessa 4, är kapitlet underkänt.

=== “RUND-TUR”-STIL (REFERENS) ===
Känslan ska vara: “Poseidon tar dig runt”, “Hades visar Styx”, “du ser saker”.
Alltså: visa världen genom att ni rör er, ser, hör, känner och hittar saker.
Inte genom att karaktärer pratar om varandra.

EXEMPEL-PUNCH (rätt känsla):
“Floden Styx rann förbi, mörk som bläck. Hades nickade: ‘Här passerar alla. Därför får ingen fuska.’”

=== ANPASSNING ===
- Årskurs: anpassa ordval/tempo till Åk ${grade}.
- Elevens namn: om ett namn finns, nämn det naturligt 1–2 gånger (max).
  Elevens namn: "${studentName || "eleven"}".

=== LÄRARFAKTA ÄR LAG ===
Du får ALDRIG hitta på fakta som krockar med lärarens fakta.

Lärarens ämne: "${topic}"
Lärarens fakta (du får använda flera per kapitel, men kort och inbakade):
${teacherFacts.length ? teacherFacts.map((f, i) => `${i + 1}. ${f}`).join("\n") : "- (inga fakta angivna)"}

Lärandemål (som ska kännas i berättelsen):
${learningGoals.length ? learningGoals.map((g, i) => `${i + 1}. ${g}`).join("\n") : "- (inga mål angivna)"}

=== PROMPT-STYRNING (VIKTIGT) ===
Om "effective_prompt" är tom:
- Fortsätt berättelsen framåt utan att starta om.
Om "effective_prompt" har text:
- Byt riktning enligt den, men behåll fakta och mål.

=== STOPPA “TJAT” / PRATMAL ===
- Max 6 repliker totalt per kapitel.
- Inga repliker som bara upprepar: “Zeus, Poseidon, Hades…” eller “vi tre…”
- Om figurer finns: låt dem GÖRA saker i miljön (visa, öppna, leda, varna).
- Undvik “nu berättar jag” och undvik att de “pratar OM” varandra.

=== UTFORSKNINGS-KRAV (måste synas) ===
Minst 2 konkreta miljödetaljer per kapitel (ljud, ljus, lukt, temperatur, rörelse).
Minst 1 ny plats per kapitel (tydlig: rum, korridor, tunnel, sal, strand, port, trappa etc.).

=== MIKROFAKTA (det du saknade när det var som bäst) ===
Lägg in 1–2 korta fakta-inslag per kapitel:
- 1 mening (max 2)
- inbakade i handlingen (inte föreläsning)
- får inte krocka med lärarens fakta

=== LÄNGD (HÅRD) ===
chapter_text ska hålla sig inom ${minWords}–${maxWords} ord.
Hellre lite kort än för långt.

=== INTERAKTIVITET ===
Om interaktivt läge: ställ EN (1) enkel fråga i slutet av chapter_text.
Om inte interaktivt: inget val, men ha en tydlig hook.

Interaktivt läge: ${interactiveMode ? "JA" : "NEJ"}

=== WORLDSTATE / KONSEKVENS ===
Du får "locked_state". Om något där är förlorat/trasigt/inaktivt etc:
- använd det inte som om det fungerar.
- ändra status bara om berättelsen visar en tydlig förändring.

=== OUTPUTFORMAT ===
Svara med ENDAST ren JSON med exakt:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar + en sista rad: STATE: {...}",
    "previousChapters": []
  }
}
`.trim();

    // ------------------------------------------------------------
    // 8) Payload till modellen
    // ------------------------------------------------------------
    const userPayload = {
      chapterIndex,
      topic,
      grade_level: grade,
      chapter_length: len,
      story_style: storyStyle,
      interactive_mode: interactiveMode,
      student_name: studentName,
      // Här är den riktiga styrningen:
      effective_prompt: effectivePrompt,
      // Vi skickar ändå med originalprompt för debug om du vill logga senare:
      student_prompt_raw: studentPrompt,
      use_new_direction: useNewDirection,
      // State:
      worldstate: incomingWorldState || {},
      locked_state: lockedState,
      teacher_facts: teacherFacts,
      learning_goals: learningGoals,
    };

    // ------------------------------------------------------------
    // 9) OpenAI call
    // ------------------------------------------------------------
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.8, // lite mer energi = bättre driv, men fortfarande stabilt
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
      return new Response(JSON.stringify({ error: "OpenAI API fel", details: openaiJson }), { status: 500, headers: corsHeaders });
    }

    let rawContent = openaiJson?.choices?.[0]?.message?.content;
    if (!rawContent) {
      return new Response(JSON.stringify({ error: "Tomt svar från OpenAI" }), { status: 500, headers: corsHeaders });
    }

    // ------------------------------------------------------------
    // 10) Parse + säkerställ format
    // ------------------------------------------------------------
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      console.error("Kunde inte parsa JSON från OpenAI:", e);
      parsed = {
        chapter_text: safeStr(rawContent),
        reflection_questions: [],
        worldstate: { chapterIndex, summary_for_next: "STATE: {}", previousChapters: [] },
      };
    }

    const chapterText = safeStr(parsed.chapter_text || "");
    const summaryForNext = safeStr(parsed?.worldstate?.summary_for_next || "");

    // Exakt 3 reflektionsfrågor (Åk-anpassade fallbacks)
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);

    const fallback1 = `Vad upptäckte du i kapitlet om ${topic}?`;
    const fallback2 = `Varför tror du att det du såg/lärde dig hänger ihop med ${topic}?`;
    const fallback3 = `Vad hade du gjort som nästa steg om du var där?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    // ------------------------------------------------------------
    // 11) Worldstate – append previousChapters (stabilt)
    // ------------------------------------------------------------
    const prevChapters = safeArr(incomingWorldState.previousChapters || []);

    // Vi lagrar en kort summary per kapitel (om summaryForNext finns).
    // Plocka bort STATE-raden ur short_summary så UI blir snyggt.
    const shortSummary = (() => {
      const s = summaryForNext || "";
      if (!s) return "";
      const lines = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const noState = lines.filter((l) => !l.startsWith("STATE:"));
      return noState.join(" ");
    })();

    const newPrevChapters = prevChapters.concat([
      {
        chapterIndex,
        short_summary: shortSummary,
      },
    ]);

    // ------------------------------------------------------------
    // 12) Response (stabil signatur till frontend)
    // ------------------------------------------------------------
    const responseJson = {
      chapterIndex,
      chapterText,
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        summary_for_next: summaryForNext || "",
        previousChapters: newPrevChapters,
        // Extra (ofarligt, kan ignorera i frontend):
        last_used_prompt: effectivePrompt || "",
        last_used_prompt_chapter: effectivePrompt ? chapterIndex : (incomingWorldState.last_used_prompt_chapter || 0),
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
