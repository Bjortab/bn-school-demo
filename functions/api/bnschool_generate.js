// functions/api/bnschool_generate.js
// BN-Skola v1.3 – StoryEngine backend för Cloudflare Pages Functions
// Fixar:
// 1) BN-Kids-beteende: elevprompt används bara för kapitel 1 (minskar "startar om")
// 2) Mer framfart: kapitel ska börja "direkt där vi slutade" (minimera recap)
// 3) Bonusfakta tillbaka (kontrollerat): bara om läraren tillåter det
// 4) Respekt för max kapitel + kapitel-längd (om teacher_mission skickar dessa)

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const body = await request.json();

    const teacherMission = body.teacher_mission;
    const incomingWorldState = body.worldstate || {};
    const rawStudentPrompt = typeof body.student_prompt === "string" ? body.student_prompt : "";

    if (!teacherMission || !teacherMission.topic) {
      return new Response(JSON.stringify({ error: "teacher_mission.topic saknas" }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY saknas i miljövariablerna" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // ---------------------------
    // Utils / guards
    // ---------------------------
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    // ---------------------------
    // Kapitelräkning
    // ---------------------------
    const prevChapterIndex =
      typeof incomingWorldState.chapterIndex === "number" ? incomingWorldState.chapterIndex : 0;
    const chapterIndex = prevChapterIndex + 1;

    // ---------------------------
    // Teacher controls (om din frontend skickar dem)
    // - max_chapters: number
    // - chapter_length: "kort" | "normal" | "lång"
    // - allow_enrichment: boolean (bonusfakta)
    // ---------------------------
    const maxChapters =
      typeof teacherMission.max_chapters === "number" && teacherMission.max_chapters > 0
        ? teacherMission.max_chapters
        : null;

    if (maxChapters && chapterIndex > maxChapters) {
      return new Response(
        JSON.stringify({
          error: `Max antal kapitel (${maxChapters}) är nått. Tryck "Rensa saga" för att starta om.`
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    const chapterLengthRaw = safeStr(teacherMission.chapter_length || "").toLowerCase();
    const chapterLength =
      chapterLengthRaw === "kort" || chapterLengthRaw === "normal" || chapterLengthRaw === "lång"
        ? chapterLengthRaw
        : "normal";

    const allowEnrichment = !!teacherMission.allow_enrichment;

    // ---------------------------
    // BN-Kids-beteende: elevprompt endast i kapitel 1
    // Kapitel 2+ kör på worldstate/summary så den inte startar om.
    // ---------------------------
    const studentPrompt =
      chapterIndex === 1 ? cleanOneLine(rawStudentPrompt) : "";

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
    // Ordintervall per längd (styr "magin": mer tight, mer händelser)
    // ---------------------------
    const lengthSpec =
      chapterLength === "kort"
        ? { min: 120, max: 160 }
        : chapterLength === "lång"
          ? { min: 210, max: 260 }
          : { min: 165, max: 205 };

    // ---------------------------
    // SystemPrompt v3 (flow + kontrollerad bonusfakta)
    // ---------------------------
    const systemPrompt = `
Du är BN-Skola StoryEngine v3.

=== ROLL / KÄNSLA ===
Skriv som BN-Kids: varm, levande, "det händer saker", med små humorblinkningar när det passar.
Kortare stycken. Dialog före lång beskrivning. Håll flyt.

=== MÅL ===
Skapa ett kapitel som:
1) känns som ett äventyr (inte klassrumsföreläsning),
2) följer lärarens fakta och mål,
3) rör berättelsen FRAMÅT (ingen omstart).

=== HÅRDA REGLER ===
1) LÄRARFAKTA ÄR LAG. Motsäg aldrig fakta.
2) Inget olämpligt: ingen sex, inga svordomar, inget glorifierat våld.
3) Inga meta-kommentarer om AI eller promptar.
4) INGEN OMSTART: Om chapterIndex > 1:
   - börja direkt där förra kapitlet slutade (max 1 kort mening recap).
   - introducera en ny händelse/ny info/nytt steg i samma kapitel.

=== BONUSFAKTA (FÅ TILLBAKA "WOW") ===
Om allow_enrichment = true får du lägga in 1–2 BONUSFAKTA som gör berättelsen rikare.
Men:
- Bonusfakta måste vara ALLMÄNT KÄNDA och säkra på den här nivån.
- Om du är minsta osäker: skriv det som "man brukar säga att..." / "i historien/myterna berättas att..."
- Aldrig hitta på specifika siffror, exakta datum eller detaljer om du inte fått dem av läraren.

Om allow_enrichment = false: lägg inte till ny fakta utöver lärarens punkter.

=== TEMPO / FRAMFART ===
Varje kapitel ska ha:
- En tydlig händelse (något händer)
- En liten reaktion
- Ett nytt nästa-steg (mjuk bro till nästa kapitel)

Undvik att fastna i "vi pratar om vad som hände".

=== INTERAKTION ===
Om requires_interaction = true:
- Ställ högst EN enkel fråga i själva berättelsen.
- Resten kommer i reflektionsfrågorna.

=== LÄNGD (ORD, HÅRT) ===
chapter_text måste vara mellan ${lengthSpec.min} och ${lengthSpec.max} ord.
Hellre något kort än för långt.

=== KONSEKVENS / LOCKED STATE ===
Du får locked_state. Om något är "lost/broken/inactive" så får du inte använda det som helt.
Status får bara ändras om berättelsen visar att det faktiskt ändras.

=== OUTPUT (ENDAST REN JSON) ===
Svara ENBART med ren JSON exakt i denna struktur:

{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "chapterIndex": ${chapterIndex},
    "summary_for_next": "2–4 korta meningar. Sist en rad: STATE: {...}",
    "previousChapters": []
  }
}

=== REFLEKTIONSFRÅGOR (EXAKT 3) ===
1) Enkel faktafråga (vad?)
2) Enkel förståelsefråga (varför?) kopplad till fakta/mål
3) Personlig men kort (vad hade du gjort?)

=== SUMMARY_FOR_NEXT ===
2–4 korta meningar om vad som hände + nästa steg.
Sista raden måste vara: STATE: {...}
Om inget: STATE: {}
`.trim();

    // ---------------------------
    // Payload till modellen
    // ---------------------------
    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_prompt: studentPrompt,
      worldstate: incomingWorldState || {},
      locked_state: lockedState,
      allow_enrichment: allowEnrichment
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

    let rawContent = openaiJson?.choices?.[0]?.message?.content;
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
      console.error("Kunde inte parsa JSON från OpenAI, fallback:", e);
      parsed = {
        chapter_text: rawContent,
        reflection_questions: [],
        worldstate: {
          chapterIndex,
          summary_for_next: "STATE: {}",
          previousChapters: []
        }
      };
    }

    // Enforce: EXAKT 3 reflektionsfrågor
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

    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "STATE: {}");

    // Worldstate previousChapters: vi sparar summary i short_summary (som tidigare)
    const prevFromModel = parsed.worldstate?.previousChapters;
    const prevFromIncoming = incomingWorldState.previousChapters;

    let previousChapters = safeArr(prevFromModel).length ? safeArr(prevFromModel) : safeArr(prevFromIncoming);

    // Idempotent update: ersätt sista om samma chapterIndex
    if (previousChapters.length > 0) {
      const last = previousChapters[previousChapters.length - 1];
      if (last && last.chapterIndex === chapterIndex) {
        previousChapters = [
          ...previousChapters.slice(0, -1),
          {
            chapterIndex,
            title: safeStr(last.title || ""),
            short_summary: summaryForNext
          }
        ];
      } else {
        previousChapters = [
          ...previousChapters,
          { chapterIndex, title: "", short_summary: summaryForNext }
        ];
      }
    } else {
      previousChapters = [{ chapterIndex, title: "", short_summary: summaryForNext }];
    }

    const responseWorldstate = {
      chapterIndex,
      summary_for_next: summaryForNext,
      previousChapters
    };

    // Output till frontend (oförändrad)
    const responseJson = {
      chapterIndex,
      chapterText: safeStr(parsed.chapter_text || ""),
      reflectionQuestions: rq,
      worldstate: responseWorldstate
    };

    return new Response(JSON.stringify(responseJson), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    console.error("Oväntat fel i bnschool_generate:", err);
    return new Response(JSON.stringify({ error: "Internt fel i bnschool_generate", details: String(err) }), {
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
