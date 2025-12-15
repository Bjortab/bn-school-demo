// functions/api/bnschool_generate.js
// BN-Skola v1.6 – StoryEngine backend för Cloudflare Pages Functions
// Fix: tillbaka till "rundtur" (Poseidon/Hades visar runt), hård framåtdrift, mindre fluff, mer setpieces.

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
      4: { kort: [120, 160], normal: [160, 210], lang: [240, 380] }, // lång märkbart längre
      5: { kort: [140, 190], normal: [190, 260], lang: [280, 410] },
      6: { kort: [160, 210], normal: [210, 290], lang: [310, 450] },
      7: { kort: [180, 240], normal: [240, 330], lang: [350, 500] },
      8: { kort: [200, 270], normal: [270, 370], lang: [390, 570] },
      9: { kort: [220, 310], normal: [310, 430], lang: [450, 640] },
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
    // Prompt-beteende:
    // - Kapitel 1: använd prompt om den finns
    // - Kapitel 2+: använd prompt bara om checkbox = true
    // ---------------------------
    const promptEffective = (chapterIndex === 1 || usePromptAsNewDirection) ? studentPrompt : "";

    // För tour-mode: försök plocka senaste "current_location" om den finns
    const currentLocation = safeStr(lockedState.current_location || "");
    const visited = Array.isArray(lockedState.visited_locations) ? lockedState.visited_locations : [];
    const guideName = safeStr(lockedState.guide || ""); // "Poseidon" / "Hades" kan ligga här om modellen sparar det

    // ---------------------------
    // SystemPrompt v2.3 (TOUR MODE – hård framåtdrift)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v2.3.

=== ROLL ===
Du är en MEDSPELARE i elevens äventyr – inte en föreläsare.
All text skrivs i andra person (“du”).

=== ELEVENS NAMN ===
Om "student_name" finns: använd exakt det namnet naturligt MAX 1 gång per kapitel (gärna i början).

=== LÄRARFAKTA ===
Lärarfakta är LAG. Du får inte motsäga det. Du får däremot visa fakta genom händelser/miljö.

=== LÄNGD (HÅRD) ===
"chapter_text" ska vara ungefär ${minWords}–${maxWords} ord. Aldrig över max.

=== TOUR MODE (DET HÄR ÄR HELA GREJEN) ===
Varje kapitel ska kännas som en GUIDAD RUNDTUR:
- En guide (t.ex. Poseidon eller Hades) leder dig fysiskt genom en plats.
- Guiden ska VISA saker, inte stå och prata om abstrakta grejer.
- Du ska RÖRA DIG till en ny delplats varje kapitel.

HÅRDA TOUR-REGLER:
1) NY DELPLATS VARJE KAPITEL.
   - Du får inte stanna kvar och “prata runt” i samma scen.
   - Exempel delplatser: “Havsmosaiken”, “Korallbiblioteket”, “Tritons ekorum”, “Styx-stranden”, “Färjkarlsbryggan”, “Porten av ben”, etc.
2) SETPIECE-KRAV: Varje kapitel måste innehålla:
   A) 2–3 saker som du ser (konkreta objekt/landmärken)
   B) 1 sak som händer (en liten incident/mini-hinder/mini-mysterie)
   C) 1 tydlig rörelse framåt (ni går vidare till nästa delplats eller tar ett beslut)
3) DIALOG: Max 5 repliker totalt per kapitel. Ingen “mystisk röst”-utfyllnad.

=== ANTI-FLUFF (FÖRBJUDET) ===
Följande är förbjudet om det inte är absolut nödvändigt:
- “Inte allt är synligt…”, “du känner en mystisk närvaro…”, “en röst viskar…” (som utfyllnad)
- “Vi tre gudar…” / “utan oss blir världen kaos” / “jag styr X, han styr Y” (tjöt)
- Att rada upp flera gudar med presentationstal.

Om fler gudar nämns:
- Max 1 kort mening och vidare till handling/utforskning.

=== MIKROFAKTA (BRA VERSIONEN) ===
Du ska lägga in 1–2 korta fakta-inslag per kapitel, invävda i platsen.
EXAKT stil:
“Floden Styx rann förbi, mörk som bläck. Hades pekade: alla själar måste passera här – därför fick ingen fuska.”

=== INTERAKTION ===
Om interaktivt läge: ställ max 1 fråga i kapitlet (ett val som påverkar nästa delplats).

=== KONSEKVENS / STATUS ===
Du får locked_state med t.ex. current_location, guide, visited_locations.
- Respektera status.
- Uppdatera så att storyn driver framåt (ny delplats).

=== OUTPUTFORMAT (ENDAST JSON) ===
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar. Sist: STATE: {...}",
    "previousChapters": []
  }
}

=== REFLEKTIONSFRÅGOR (EXAKT 3, VARIERADE) ===
1) Fakta (vad) – kopplad till delplatsen/händelsen
2) Förståelse (varför)
3) Personlig (vad hade du gjort?)
FÖRBJUDET som standard: “Vilka tre gudar…”.
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
      locked_state: {
        ...lockedState,
        current_location: currentLocation,
        visited_locations: visited,
        guide: guideName,
      },
      // Liten hint: driver mot tour-känslan du vill ha
      author_intent: "TOUR_MODE: guidning + rundtur + nya delplatser varje kapitel. Mindre snack, mer visar runt.",
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
    const fallback1 = `Vilken ny sak såg du eller upptäckte du i kapitlet om ${topic}?`;
    const fallback2 = `Varför tror du att den saken var viktig i berättelsen?`;
    const fallback3 = `Vad hade du gjort om du stod där på riktigt?`;

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
