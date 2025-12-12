// functions/api/bnschool_generate.js
// BN-Skola v1.1 (SAFE PATCH) – Endast: Tone/Tempo v1 + 3 reflektionsfrågor + idempotent previousChapters

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
    // System & Tone Prompt v1 (LOCKED)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v1.

ROLL:
- Du är en MEDSPELARE i elevens äventyr – inte en föreläsare.
- Du skriver ALLTID i andra person ("du") och talar direkt till eleven.

TON (LÅST):
1) Trygg & varm (alltid bas)
2) Äventyrlig & spännande
3) Lätt humor & lek (diskret, aldrig flams, aldrig sarkasm)

TEMPO (LÅST – C):
Varje kapitel följer "Lugnt -> Spännande -> Lugnt":
- Lugnt: trygg start, orientering, varm närvaro
- Spännande: händelse/val/mysterium
- Lugnt: avrundning, förståelse, mjuk bro till nästa

GRUNDREGLER:
- Lärarens fakta är LAG. Du får inte ändra eller motsäga dem.
- Elevens idé vävs in lekfullt utan att förstöra faktan.
- Enkelt, tydligt språk anpassat till årskurs.
- Undvik opersonlig, neutral "lärobokston".
- Inga meta-kommentarer (t.ex. "som en AI...").
- Inget olämpligt innehåll: inget våld som glorifieras, ingen sex, inga svordomar.

INTERAKTION:
Om läraren markerat interaktivt läge:
- Låt karaktärer ställa enkla frågor till "du"
- Bjud in eleven att tänka/ta val

REFLEKTIONSFRÅGOR (EXAKT 3 – LÅST):
Efter kapitlet ska du skapa EXAKT tre frågor i denna ordning:
1) Faktafråga (enkel, trygg)
2) Förståelsefråga (kopplar fakta till berättelsen)
3) Personlig reflektionsfråga (inget rätt/fel)

OUTPUTFORMAT:
Du måste ALLTID svara med ENBART ren JSON och exakt denna struktur:

{
  "chapter_text": "Själva berättelsen som en sammanhängande text.",
  "reflection_questions": [
    "Fråga 1...",
    "Fråga 2...",
    "Fråga 3..."
  ],
  "worldstate": {
    "chapterIndex": 1,
    "summary_for_next": "Kort sammanfattning att använda som kontext för nästa kapitel.",
    "previousChapters": []
  }
}

VIKTIGT:
- Inga extra fält. Inga kommentarer. Inget runt omkring.
- Håll dig strikt till JSON-strukturen ovan.
`.trim();

    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_prompt: studentPrompt,
      worldstate: incomingWorldState || {}
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
      return new Response(
        JSON.stringify({
          error: "OpenAI API fel",
          details: openaiJson
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    let rawContent = openaiJson?.choices?.[0]?.message?.content;
    if (!rawContent) {
      return new Response(
        JSON.stringify({ error: "Tomt svar från OpenAI" }),
        { status: 500, headers: corsHeaders }
      );
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
          previousChapters: []
        }
      };
    }

    // ---------------------------
    // Enforce: EXAKT 3 reflektionsfrågor (fallback om modellen spårar)
    // ---------------------------
    const qClean = (s) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");
    let rq = Array.isArray(parsed.reflection_questions) ? parsed.reflection_questions.map(qClean).filter(Boolean) : [];

    const topic = (teacherMission && typeof teacherMission.topic === "string") ? teacherMission.topic : "ämnet";
    const fallback1 = `Vilka viktiga saker handlade kapitlet om kring ${topic}?`;
    const fallback2 = `Varför var det som hände i kapitlet viktigt för att förstå ${topic}?`;
    const fallback3 = `Vad hade du själv valt att göra nu - och varför?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    // ---------------------------
    // Worldstate: previousChapters (idempotent vid retry)
    // ---------------------------
    const previousChapters =
      parsed.worldstate?.previousChapters ||
      incomingWorldState.previousChapters ||
      [];

    const summaryForNext = (parsed.worldstate && typeof parsed.worldstate.summary_for_next === "string")
      ? parsed.worldstate.summary_for_next
      : "";

    let updatedPrevious;
    if (Array.isArray(previousChapters) && previousChapters.length > 0) {
      const last = previousChapters[previousChapters.length - 1];
      if (last && last.chapterIndex === chapterIndex) {
        updatedPrevious = [
          ...previousChapters.slice(0, -1),
          { chapterIndex, title: last.title || "", short_summary: summaryForNext }
        ];
      } else {
        updatedPrevious = [
          ...previousChapters,
          { chapterIndex, title: "", short_summary: summaryForNext }
        ];
      }
    } else {
      updatedPrevious = [{ chapterIndex, title: "", short_summary: summaryForNext }];
    }

    const responseWorldstate = {
      chapterIndex,
      summary_for_next: summaryForNext,
      previousChapters: updatedPrevious
    };

    const responseJson = {
      chapterIndex,
      chapterText: parsed.chapter_text || "",
      reflectionQuestions: rq,
      worldstate: responseWorldstate
    };

    return new Response(JSON.stringify(responseJson), {
      status: 200,
      headers: corsHeaders
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
