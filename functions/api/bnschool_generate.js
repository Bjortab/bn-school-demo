// functions/api/bnschool_generate.js
// BN-Skola v1.4 – StoryEngine backend för Cloudflare Pages Functions
// V1-DRIV: mindre “runt-snack”, mer utforskning/rundtur, tydlig framåtdrift, elevnamn
// Prompt-beteende: prompt ignoreras vid fortsättning om inte "ny riktning" är ikryssad (frontend skickar flagga)

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
    const studentPromptRaw = typeof body.student_prompt === "string" ? body.student_prompt : "";
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
    const incomingWorldState = body.worldstate && typeof body.worldstate === "object" ? body.worldstate : {};

    // Frontend-flagga (accepterar flera namn för robusthet)
    const useNewDirection =
      body.use_prompt_as_new_direction === true ||
      body.use_new_direction === true ||
      body.useNewDirection === true ||
      body.new_direction === true;

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

    // Kapitelräkning
    const prevIndex = typeof incomingWorldState.chapterIndex === "number" ? incomingWorldState.chapterIndex : 0;
    const chapterIndex = prevIndex + 1;

    // Helpers
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    // Längdstyrning (ordintervall)
    const grade = parseInt(teacherMission.grade_level, 10) || 4;
    const lenRaw = safeStr(teacherMission.chapter_length || "normal").toLowerCase(); // "kort" | "normal" | "lang"

    const lengthTable = {
      2: { kort: [70, 95], normal: [95, 130], lang: [130, 180] },
      3: { kort: [90, 120], normal: [120, 170], lang: [170, 240] },
      4: { kort: [120, 160], normal: [160, 220], lang: [240, 340] }, // lång: rejält längre (som du ville)
      5: { kort: [140, 190], normal: [190, 260], lang: [280, 380] },
      6: { kort: [160, 210], normal: [210, 290], lang: [310, 420] },
      7: { kort: [180, 240], normal: [240, 330], lang: [350, 470] },
      8: { kort: [200, 270], normal: [270, 360], lang: [380, 520] },
      9: { kort: [220, 300], normal: [300, 420], lang: [450, 620] },
    };

    const ranges = lengthTable[grade] || lengthTable[4];
    const lenKey = lenRaw === "lång" ? "lang" : lenRaw; // säkerhetsrygg
    const [minWords, maxWords] = ranges[lenKey] || ranges["normal"];

    // Prompt-beteende (BN-Kids-känsla):
    // - Kapitel 1: prompt används (om finns)
    // - Kapitel 2+ : prompt ignoreras, om inte useNewDirection är true
    const studentPrompt = cleanOneLine(studentPromptRaw);
    const effectivePrompt = chapterIndex === 1 || useNewDirection ? studentPrompt : "";

    // =========================
    // Locked STATE (enkel låsning)
    // =========================
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

    // =========================
    // V1-DRIV systemprompt (kort, styrande, inte över-verbose)
    // =========================
    const systemPrompt = `
Du är BN-School StoryEngine (V1-DRIV).

DU SKRIVER KAPITEL SOM HAR "BN-KIDS-FRAMFART":
- mindre prat OM saker
- mer att de GÖR saker, SER saker, UPPTÄCKER saker
- varje kapitel flyttar till NYTT läge/ny detalj/ny upptäckt (rundtur-känsla)

=== FORMAT (HÅRT) ===
Svara ENDAST med ren JSON:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "summary_for_next": "2–4 korta meningar. Sist: STATE: {...}"
  }
}

=== PERSPEKTIV ===
Skriv i andra person: "du".
Om elevnamn finns: använd elevnamnet 1–2 gånger naturligt (inte varje stycke).

=== LÄRARUPPDRAG ===
- Följ teacher_mission: ämne + fakta + lärandemål är lag.
- Du får lägga in 1–2 extra mikro-fakta per kapitel (max 1 mening vardera), men bara om de passar och inte krockar.

=== V1-DRIV-REGLER (DET VIKTIGA) ===
1) VARJE kapitel måste innehålla:
   A) 2 konkreta miljödetaljer (ljud/ljus/lukt/kyla/värme/saker som rör sig)
   B) 1 tydlig upptäckt (något nytt som hittas/ses/hörs)
   C) 1 händelse som flyttar storyn framåt (en dörr öppnas, en tunnel, en stig, en karta, ett spår, en ny plats)
2) Dialogbudget:
   - Max 6 repliker totalt.
   - Ingen “person A berättar om person B”-loop.
   - Om det finns flera “gudar/mentorer”: LÅT DEM VISA MILJÖN istället för att prata om varandra.
3) Undvik tjat:
   - Upprepa INTE listor av “tre gudar” eller “vi delar världen” i varje kapitel.
   - Nämn sådant en gång, sen går du vidare med utforskning.
4) Interaktivt:
   - Max 1 fråga till eleven i slutet, som känns som ett val/nyfikenhet (inte prov).
5) Längd:
   - Håll chapter_text inom angivet ordintervall. Hellre kort än för långt.

=== STATE-LÅSNING ===
Du får en locked_state (statusar). Om något är trasigt/förlorat/inaktivt: använd det inte som fungerande, om inte kapitlet visar att det återställs.

=== STILREFERENS (SÅ HÄR) ===
"Floden Styx rann förbi, mörk som bläck. Hades visade dig en stenbro med ristningar och sa lågt att ingen får fuska här."

INTE SÅ HÄR:
"Styx är i grekisk mytologi en flod som..."
`.trim();

    // =========================
    // User payload
    // =========================
    const userPayload = {
      chapterIndex,
      word_range: { minWords, maxWords },
      teacher_mission: teacherMission,
      student_name: studentName,
      student_prompt: effectivePrompt, // tom vid fortsättning om ej ny riktning
      use_new_direction: useNewDirection,
      worldstate: incomingWorldState || {},
      locked_state: lockedState,
    };

    // =========================
    // OpenAI call
    // =========================
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0.8,
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
      return new Response(JSON.stringify({ error: "OpenAI API fel", details: openaiJson }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const rawContent = openaiJson?.choices?.[0]?.message?.content;
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
        worldstate: { summary_for_next: "STATE: {}" },
      };
    }

    const chapterText = safeStr(parsed.chapter_text || "").trim();

    // Reflektionsfrågor: exakt 3
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);
    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vad var det viktigaste du lärde dig om ${topic}?`;
    const fallback2 = `Varför var den detaljen viktig i kapitlet?`;
    const fallback3 = `Vad hade du själv gjort härnäst?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    // summary_for_next måste finnas, och innehålla STATE:
    let summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "").trim();
    if (!summaryForNext) summaryForNext = "STATE: {}";
    if (!summaryForNext.includes("STATE:")) summaryForNext += "\nSTATE: {}";

    // Kapitelhistorik: behåll + lägg till kort summary
    const previousChapters = safeArr(incomingWorldState.previousChapters || []);
    const shortSummary = summaryForNext.split("\n")[0]?.trim() || "";

    const nextPreviousChapters = previousChapters.concat([
      {
        chapterIndex,
        short_summary: summaryForNext, // inkluderar STATE-rad
        short_title: `Kapitel ${chapterIndex}`,
      },
    ]);

    // Stabil response-signatur till frontend
    const responseJson = {
      chapterIndex,
      chapterText,
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        summary_for_next: summaryForNext,
        previousChapters: nextPreviousChapters,
      },
      // debug/metadata (ofarligt)
      meta: {
        usedPrompt: effectivePrompt ? true : false,
        useNewDirection: useNewDirection ? true : false,
        wordRange: { minWords, maxWords },
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
