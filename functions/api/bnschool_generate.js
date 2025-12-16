// functions/api/bnschool_generate.js
// BN-Skola v1.4 – StoryEngine backend (Cloudflare Pages Functions)
// Fokus: V1-driv + prompt-lydnad + Atlantis-payoff direkt + stopp för "lukt-tjat" + reflektionsfrågor som går att besvara
// Stabil API-signatur: { chapterIndex, chapterText, reflectionQuestions, worldstate }

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await request.json();

    const teacherMission = body.teacher_mission;
    const rawStudentPrompt = typeof body.student_prompt === "string" ? body.student_prompt : "";
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
    const incomingWorldState = body.worldstate && typeof body.worldstate === "object" ? body.worldstate : {};

    // Checkbox-stöd (BN-Kids-liknande beteende):
    // - Om false: prompt ignoreras (förutom vid kapitel 1) och vi fortsätter storyn framåt.
    // - Om true: prompt används som ny riktning från och med detta kapitel.
    const useNewDirection =
      body.use_new_direction === true ||
      body.apply_new_prompt === true ||
      body.useAsNewDirection === true;

    if (!teacherMission || !teacherMission.topic) {
      return new Response(JSON.stringify({ error: "teacher_mission.topic saknas" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY saknas i miljövariablerna" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // chapterIndex (nästa)
    const prevIndex = typeof incomingWorldState.chapterIndex === "number" ? incomingWorldState.chapterIndex : 0;
    const chapterIndex = prevIndex + 1;

    // Helpers
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    // Prompt-beteende: alltid i kap 1, annars endast om checkboxen är i.
    const studentPrompt = (chapterIndex === 1 || useNewDirection) ? rawStudentPrompt.trim() : "";

    // Length ranges (ord)
    const grade = parseInt(teacherMission.grade_level, 10) || 4;
    const len = safeStr(teacherMission.chapter_length || "normal"); // "kort" | "normal" | "lang"

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
    // SystemPrompt v1.4 (V1-driv + prompt-lydnad + Atlantis payoff + stopp för doft-tjat)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v1.4.

=== ROLL ===
Du är en MEDSPELARE i elevens äventyr – inte en föreläsare.
Du skriver ALLTID i andra person (“du”) och talar direkt till eleven.

=== MÅLGRUPP ===
Anpassa språk, tempo och ordval till elevens årskurs. Korta stycken. Driv framåt. Inga upprepningar.

=== TON (LÅST) ===
Trygg & varm (bas) + Äventyrlig (driver) + lätt humor (max 1 liten blinkning/kapitel).

=== V1-DRIV (KRITISKT) ===
Varje kapitel måste:
1) starta snabbt (inom 2 meningar händer något / ni rör er)
2) innehålla en tydlig händelse som flyttar storyn framåt (ny plats, upptäckt, spår, hot, beslut)
3) sluta med en naturlig krok – men inte “du måste klara en ny sak” om ni just redan vunnit en sak.

=== PROMPT-PRIORITET (EXTREMT VIKTIGT) ===
Du får:
- teacher_mission (fakta/uppdrag)
- student_prompt (elevens riktning)
- worldstate + locked_state (kontinuitet)

Regel:
A) teacher_mission styr fakta/ram.
B) student_prompt styr riktning/val i storyn.
Om student_prompt säger “ta mig till Atlantis” → då ska du föra storyn mot Atlantis NU, inte ignorera det.

=== ATLANTIS PAYOFF-REGEL (NY) ===
Om locked_state.atlantisKey === "owned" och locked_state.location !== "atlantis":
- Nästa kapitel måste börja med att nyckeln används och att ni kommer IN i Atlantis inom 3–5 meningar.
- Inga “men först måste du…” efter att nyckeln är vunnen.

Om ni i kapitlet hittar/vrider om nyckeln:
- Sätt STATE: {"atlantisKey":"owned"} i summary_for_next (om den ännu inte finns)
När ni går igenom porten och faktiskt är inne:
- Sätt STATE: {"location":"atlantis","atlantisKey":"used"}

=== SENSOR-BUDGET (STOPPA 'LUKT'-TJAT) ===
- Max 1 sensorisk detalj per kapitel (ljud ELLER ljus ELLER känsla av kyla/värme).
- Skriv INTE om lukt/doft om inte eleven eller uppdraget kräver det.
- Prioritera synliga saker + handling.

=== DIALOG-BUDGET (STOPPA RUNTSNACK) ===
- Max 6 repliker totalt per kapitel.
- Dialog får aldrig bli “X säger / Y säger / X säger” i loop.
- Låt världen göra jobbet: visa, gör, flytta.

=== MIKROFAKTA (BRA – MEN RÄTT) ===
Du får lägga in 1 mikro-fakta per kapitel (1 mening), men endast om det hjälper uppdraget och är tydligt kopplat till scenen.

=== KONSEKVENS / STATUS-LÅSNING ===
locked_state är lag.
Om något är markerat som tappat/försvagat/icke aktivt → du får inte använda det som helt.
Status ändras bara om kapitlet visar hur.

=== REFLEKTIONSFRÅGOR (MÅSTE GÅ ATT BESVARA) ===
Exakt 3 frågor.
De måste kunna besvaras genom att läsa kapitlet (inte kräva “allmän kunskap” som inte nämns).
1) Fakta: “Vad såg/hände?”
2) Förståelse: “Varför hände det / varför gjorde ni X?”
3) Personlig: “Vad hade du gjort?”

=== LÄNGD (HÅRDT) ===
Skriv chapter_text inom ${minWords}–${maxWords} ord. Hellre lite kort än för långt.

=== OUTPUTFORMAT (ENBART REN JSON) ===
{
  "chapter_text": "Text",
  "reflection_questions": ["Q1","Q2","Q3"],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 meningar. Sista raden: STATE: {...}",
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
        temperature: 0.75,
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
      return new Response(JSON.stringify({ error: "Tomt svar från OpenAI" }), {
        status: 500,
        headers: corsHeaders,
      });
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

    // Enforce: EXAKT 3 reflektionsfrågor + rensa
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);

    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vad var det viktigaste som hände i kapitlet?`;
    const fallback2 = `Varför tror du att det hände just då?`;
    const fallback3 = `Vad hade du själv gjort i den situationen?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    const chapterText = safeStr(parsed.chapter_text || "");
    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "STATE: {}");

    // Bygg previousChapters om frontend inte gör det robust
    const prevChapters = safeArr(incomingWorldState.previousChapters || []);
    const nextPrevChapters = prevChapters.slice();

    // Spara en kort summary “som minne” (vi använder summary_for_next som källa)
    // För att inte blåsa upp payloaden håller vi bara senaste 12.
    nextPrevChapters.push({
      chapterIndex,
      short_summary: summaryForNext,
    });
    while (nextPrevChapters.length > 12) nextPrevChapters.shift();

    // Output till frontend (stabil signatur)
    const responseJson = {
      chapterIndex,
      chapterText,
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        summary_for_next: summaryForNext,
        previousChapters: nextPrevChapters,
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
