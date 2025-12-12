// functions/api/bnschool_generate.js
// BN-Skola v1.3 – StoryEngine backend för Cloudflare Pages Functions
// Fix: fetch URL string + REAL chapter_length handling (kort/normal/lång) + dynamic max_tokens
// Keep: API-signatur oförändrad, STATE lock parsing/injection kvar

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
    const studentPrompt = body.student_prompt || "";
    const incomingWorldState = body.worldstate || {};

    if (!teacherMission || !teacherMission.topic) {
      return new Response(
        JSON.stringify({ error: "teacher_mission.topic saknas" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY saknas i miljövariablerna" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const chapterIndex =
      typeof incomingWorldState.chapterIndex === "number"
        ? incomingWorldState.chapterIndex + 1
        : 1;

    // ---------------------------
    // Helpers (säkert + robust)
    // ---------------------------
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    const safeInt = (v) => {
      const n = typeof v === "number" ? v : parseInt(String(v || ""), 10);
      return Number.isFinite(n) ? n : null;
    };

    // ---------------------------
    // Längdstyrning: läs teacherMission.chapter_length + grade_level
    // ---------------------------
    const normalizeLengthLabel = (v) => {
      const s = safeStr(v).trim().toLowerCase();
      if (!s) return "";
      if (s === "kort") return "kort";
      if (s === "normal") return "normal";
      if (s === "lång" || s === "lang") return "lång";
      return "";
    };

    // Basintervall per årskurs (ord). Medvetet “klassrums-korta”.
    // Du kan justera senare, men detta ger tydlig skillnad direkt.
    const lengthTableByGrade = (gradeNum) => {
      // Default om okänd/ej satt: Åk 4 (din demo)
      const g = Number.isFinite(gradeNum) ? gradeNum : 4;

      if (g <= 2) return { kort: [80, 110], normal: [120, 150], lång: [160, 190] };
      if (g === 3) return { kort: [100, 130], normal: [140, 170], lång: [180, 210] };
      if (g === 4) return { kort: [120, 150], normal: [160, 190], lång: [200, 230] };
      if (g === 5) return { kort: [150, 190], normal: [200, 260], lång: [270, 330] };
      if (g === 6) return { kort: [180, 230], normal: [240, 320], lång: [330, 420] };
      if (g === 7) return { kort: [220, 300], normal: [320, 420], lång: [430, 560] };
      if (g === 8) return { kort: [260, 360], normal: [380, 520], lång: [540, 700] };
      // Åk 9
      return { kort: [300, 420], normal: [450, 650], lång: [680, 900] };
    };

    const gradeNum = safeInt(teacherMission.grade_level) ?? 4;
    const desiredLengthLabel = normalizeLengthLabel(teacherMission.chapter_length) || "kort";
    const intervals = lengthTableByGrade(gradeNum);
    const [wordMin, wordMax] = intervals[desiredLengthLabel] || intervals.kort;

    // max_tokens: grov men praktisk mapping (svenska ord/token ~ 0.7–1.3 varierar)
    // Vi sätter så att "kort" inte “råkar bli lång”.
    const maxTokensByLength = (label) => {
      if (label === "kort") return 500;
      if (label === "normal") return 800;
      return 1100; // lång
    };
    const maxTokens = maxTokensByLength(desiredLengthLabel);

    // ---------------------------
    // STATE parsing (från summary_for_next / short_summary)
    // Format: en rad som börjar med exakt "STATE: { ... }"
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
      if (a && typeof a === "object") {
        for (const [k, v] of Object.entries(a)) out[k] = v;
      }
      if (b && typeof b === "object") {
        for (const [k, v] of Object.entries(b)) out[k] = v;
      }
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
    // SystemPrompt v2 (+ aktiv längd injiceras hårt)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v2.

=== ROLL ===
Du är en MEDSPELARE i elevens äventyr – inte en föreläsare.
Du skriver ALLTID i andra person (“du”) och talar direkt till eleven.

=== MÅLGRUPP ===
Anpassa språk, tempo och ordval till elevens årskurs. Korta stycken. Dialog före beskrivning.

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
AKTIV LÄNGD FÖR DETTA KAPITEL:
- Önskad längd: "${desiredLengthLabel}"
- Ordintervall för chapter_text: ${wordMin}–${wordMax} ord (håll dig inom detta intervall)

Skriv INTE längre än max. Hellre något kort än för långt.

=== STILREGEL ===
Anpassa efter årskursen. Korta stycken. Tydlig handling. Dialog före beskrivning.
För yngre år: extra enkelt språk. För äldre: lite mer detaljer men fortfarande tydligt.

=== INTERAKTION ===
Om uppdraget markerar interaktivt läge:
- Låt karaktärer ställa ENKLA frågor till “du”
- Bjud in till val eller tänkande (känns som lek, inte prov)

=== KONSEKVENS / STATUS-LÅSNING (VIKTIG) ===
Berättelsen måste vara logiskt konsekvent över kapitel.

Du får worldstate och en låst status-karta ("locked_state").
Om locked_state anger att något är "lost"/"broken"/"inactive"/"weakened" eller liknande:
- Då får du INTE använda det som om det vore helt och fungerande.
- Status får bara ändras om berättelsen tydligt visar att det hittats/lagats/återfåtts.

Exempel:
- Om Zeus åskvigg är "lost" får Zeus inte ha den i handen senare.
  Han kan bara ha svaga gnistor om du etablerar att han är försvagad.

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

=== REFLEKTIONSFRÅGOR (EXAKT 3 – ÅK-ANPASSAT) ===
Efter "chapter_text" ska du skapa EXAKT tre frågor i denna ordning:
1) Fakta (enkel “vad”-fråga)
2) Förståelse (enkel “varför”-fråga kopplad till fakta/mål)
3) Personlig (“vad hade du gjort?” – inget rätt/fel)

Aldrig meta. Aldrig “varför tror du författaren…”.

=== SUMMARY_FOR_NEXT (MÅSTE INNEHÅLLA STATUSRAD) ===
I "summary_for_next" ska du:
- skriva 2–4 korta meningar som sammanfattar kapitlet
- sist lägga en egen rad som börjar exakt med:

STATE: { ... }

Där {...} är ett litet JSON-objekt med statusar som måste låsas.
Exempel:
STATE: {"zeus_thunderbolt":"lost","poseidon_help":"active"}

Om inga statusar behövs:
STATE: {}

VIKTIGT:
- "STATE:" ska ligga INUTI summary_for_next-strängen (inte som eget fält).
- Inga extra fält, inga kommentarer, ingen markdown.
`.trim();

    // ---------------------------
    // User payload (frontend påverkas inte av extra fält här)
    // ---------------------------
    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_prompt: studentPrompt,
      worldstate: incomingWorldState || {},
      locked_state: lockedState,
    };

    // ✅ FIX: URL måste vara sträng
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.7,
        max_tokens: maxTokens, // ✅ dynamiskt
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
      return new Response(
        JSON.stringify({ error: "OpenAI API fel", details: openaiJson }),
        { status: 500, headers: corsHeaders }
      );
    }

    let rawContent = openaiJson?.choices?.[0]?.message?.content;
    if (!rawContent) {
      return new Response(JSON.stringify({ error: "Tomt svar från OpenAI" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      console.error("Kunde inte parsa JSON från OpenAI, returnerar fallback:", e);
      parsed = {
        chapter_text: rawContent,
        reflection_questions: [],
        worldstate: {
          chapterIndex,
          summary_for_next: "",
          previousChapters: [],
        },
      };
    }

    // ---------------------------
    // Enforce: EXAKT 3 reflektionsfrågor (om modellen slirar)
    // ---------------------------
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);

    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vad handlade kapitlet om (t.ex. ${topic})?`;
    const fallback2 = `Varför var det som hände viktigt i berättelsen?`;
    const fallback3 = `Vad hade du själv gjort nu – och varför?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    // ---------------------------
    // Worldstate: previousChapters (idempotent) + summary_for_next vidare
    // ---------------------------
    const prevFromModel = parsed.worldstate?.previousChapters;
    const prevFromIncoming = incomingWorldState.previousChapters;

    let previousChapters = safeArr(prevFromModel).length
      ? safeArr(prevFromModel)
      : safeArr(prevFromIncoming);

    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "");

    if (previousChapters.length > 0) {
      const last = previousChapters[previousChapters.length - 1];
      if (last && last.chapterIndex === chapterIndex) {
        previousChapters = [
          ...previousChapters.slice(0, -1),
          {
            chapterIndex,
            title: safeStr(last.title || ""),
            short_summary: summaryForNext,
          },
        ];
      } else {
        previousChapters = [
          ...previousChapters,
          { chapterIndex, title: "", short_summary: summaryForNext },
        ];
      }
    } else {
      previousChapters = [{ chapterIndex, title: "", short_summary: summaryForNext }];
    }

    const responseWorldstate = {
      chapterIndex,
      summary_for_next: summaryForNext,
      previousChapters,
    };

    // Output till frontend (oförändrad signatur)
    const responseJson = {
      chapterIndex,
      chapterText: safeStr(parsed.chapter_text || ""),
      reflectionQuestions: rq,
      worldstate: responseWorldstate,
    };

    return new Response(JSON.stringify(responseJson), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("Oväntat fel i bnschool_generate:", err);
    return new Response(
      JSON.stringify({ error: "Internt fel i bnschool_generate", details: String(err) }),
      { status: 500, headers: corsHeaders }
    );
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
