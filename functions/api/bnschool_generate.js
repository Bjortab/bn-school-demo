// functions/api/bnschool_generate.js
// BN-Skola v1.3 – StoryEngine backend för Cloudflare Pages Functions
// Fixar:
// - Kapitel-längd (kort/normal/lång) via teacher_mission.chapter_length
// - Mindre moral/val-överkörning: 1 tydlig fråga max i text, sen 3 reflektionsfrågor
// - Fortsätt framåt: använder worldstate + summary_for_next + locked_state
// - Extra fakta: får lägga till, men bara om det är säkert och inte krockar. Om osäker -> låt bli.

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  try {
    const body = await request.json();
    const teacherMission = body.teacher_mission;
    const studentPrompt = body.student_prompt || "";
    const incomingWorldState = body.worldstate || {};

    if (!teacherMission || !teacherMission.topic) {
      return new Response(JSON.stringify({ error: "teacher_mission.topic saknas" }), { status: 400, headers: corsHeaders });
    }

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY saknas i miljövariablerna" }), { status: 500, headers: corsHeaders });
    }

    const chapterIndex =
      typeof incomingWorldState.chapterIndex === "number"
        ? incomingWorldState.chapterIndex + 1
        : 1;

    // ---------------------------
    // Helpers
    // ---------------------------
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

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
    // Längdlogik: kort/normal/lång
    // Vi styr med ordintervall per årskurs (ungefär), och hård max.
    // ---------------------------
    const grade = String(teacherMission.grade_level || "4");
    const length = String(teacherMission.chapter_length || "normal").toLowerCase();

    // Basintervall per "längd" (justerar lite per högre åk)
    // Obs: vi håller det tight för demo så modellen inte sväller.
    const gradeBoost = (() => {
      const g = parseInt(grade, 10);
      if (Number.isNaN(g)) return 0;
      if (g <= 3) return -15;
      if (g <= 4) return 0;
      if (g <= 6) return +20;
      return +35; // åk 7-9
    })();

    const lengthRanges = {
      kort:   { min: 120 + gradeBoost, max: 160 + gradeBoost },
      normal: { min: 165 + gradeBoost, max: 210 + gradeBoost },
      lång:   { min: 215 + gradeBoost, max: 260 + gradeBoost }
    };

    const lr = lengthRanges[length] || lengthRanges.normal;
    const minWords = Math.max(90, lr.min);
    const maxWords = Math.max(minWords + 20, lr.max);

    // ---------------------------
    // SystemPrompt v3 (BN-Kids-flyt + framåt + mindre moral-överlast)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v3.

=== ROLL ===
Du skapar en magisk, engagerande berättelse som känns som BN-Kids i flyt och värme,
men med lärarens fakta inbakat på ett korrekt sätt.

=== MÅLGRUPP ===
Anpassa språk till årskursen. Korta stycken. Dialog före lång förklaring.

=== HÅRDA REGLER ===
1) LÄRARFAKTA ÄR LAG. Du får inte ändra, motsäga eller krocka med dem.
2) Du får lägga till EXTRA fakta SOM BONUS, men bara om du är SÄKER att det är korrekt.
   Om du är det minsta osäker: låt bli att lägga till den faktan.
3) Elevens idé ska vävas in, men får inte starta om berättelsen varje kapitel.
4) Inget olämpligt innehåll. Ingen glorifiering av våld, ingen sex, inga svordomar.
5) Inga meta-kommentarer (”som AI…”).

=== FRAMÅTDRIV (VIKTIGT) ===
- Du får worldstate och en låst status-karta ("locked_state").
- Berättelsen måste gå FRAMÅT. Återberätta inte “vi är i 1939” om du redan gått vidare.
- Upprepa inte samma startscen igen. Fortsätt från där du slutade.

=== INTERAKTION / MORAL (STRYPT) ===
Om interaktivt läge är på:
- Max 1 kort fråga i själva berättelsen.
- Ingen lång moralpredikan, inga “massor av val”.
Reflektionsdelen sköter frågorna.

=== LÄNGD (HÅRD) ===
Kapitlets "chapter_text" måste ligga inom ${minWords}–${maxWords} ord.
Gå aldrig över max. Hellre lite kortare än för långt.

=== OUTPUTFORMAT (ENDAST JSON) ===
Svara ENBART med ren JSON, exakt denna struktur:

{
  "chapter_text": "Text…",
  "reflection_questions": ["Q1", "Q2", "Q3"],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar. Sista raden måste vara STATE: {...}",
    "previousChapters": []
  }
}

=== REFLEKTIONSFRÅGOR (EXAKT 3) ===
1) Faktafråga (vad)
2) Förståelse (varför) kopplat till fakta/mål
3) Personlig (vad hade du gjort?) – mjuk, trygg, ingen skam

=== SUMMARY_FOR_NEXT (MÅSTE) ===
Skriv 2–4 meningar sammanfattning.
Sista raden: STATE: { ... } (litet JSON-objekt) eller STATE: {}.
`.trim();

    // User payload
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
        "Authorization": `Bearer ${openaiKey}`
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
        worldstate: { chapterIndex, summary_for_next: "STATE: {}", previousChapters: [] }
      };
    }

    // Enforce: exakt 3 reflektionsfrågor
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);
    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vad handlade kapitlet om inom ${topic}?`;
    const fallback2 = `Varför var det som hände viktigt kopplat till faktan?`;
    const fallback3 = `Vad hade du själv gjort i den här situationen – och varför?`;
    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "");

    // Spara historik (server-side) för locked_state och konsistens
    const prevFromIncoming = safeArr(incomingWorldState.previousChapters);
    const updatedPrev = [...prevFromIncoming];

    // idempotent append/replace
    const last = updatedPrev.length ? updatedPrev[updatedPrev.length - 1] : null;
    const entry = { chapterIndex, title: "", short_summary: summaryForNext };

    if (last && last.chapterIndex === chapterIndex) updatedPrev[updatedPrev.length - 1] = entry;
    else updatedPrev.push(entry);

    const responseWorldstate = {
      chapterIndex,
      summary_for_next: summaryForNext,
      previousChapters: updatedPrev
    };

    // Output till frontend (stabil signatur)
    const responseJson = {
      chapterIndex,
      chapterText: safeStr(parsed.chapter_text || ""),
      reflectionQuestions: rq,
      worldstate: responseWorldstate
    };

    return new Response(JSON.stringify(responseJson), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Oväntat fel i bnschool_generate:", err);
    return new Response(JSON.stringify({ error: "Internt fel i bnschool_generate", details: String(err) }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  }});
}
