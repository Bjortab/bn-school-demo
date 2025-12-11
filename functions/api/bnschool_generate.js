// functions/api/bnschool_generate.js
// BN-Skola v1 – StoryEngine backend för Cloudflare Pages Functions

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

    const systemPrompt = `
Du är BN-School StoryEngine v1.

Ditt uppdrag:
- Skapa pedagogiska, engagerande äventyrsberättelser för elever i åldern 7–15 år.
- Du får:
  - lärarens lektionsuppdrag (fakta, lärandemål, årskurs, stil)
  - elevens fria prompt (idé, fantasi)
  - worldstate (tidigare kapitel och sammanfattning)

Grundregler:
- Lärarens fakta är LAG. Du får inte ändra eller motsäga dem.
- Elevens idéer ska vävas in på ett lekfullt sätt, men får inte förstöra faktan.
- Skriv på enkel, tydlig svenska anpassad till årskursen.
- Berättelsen ska kännas som ett äventyr eller berättelse, inte som en torr faktatext.
- Avsluta kapitlet på ett sätt som gör att man vill läsa nästa del (men utan cliffhanger som är för brutal).
- Om läraren har markerat att berättelsen ska vara interaktiv ska du:
  - låta karaktärerna ställa frågor
  - bjuda in eleven att tänka själv
- Du får inte skriva olämpligt innehåll: inget våld som glorifieras, ingen sex, inga svordomar.

Reflektionsfrågor:
- Efter själva berättelsen ska du skapa 2–4 frågor som:
  - hjälper eleven att tänka kring det som hänt
  - knyter an till fakta och lärandemål
  - kan användas som underlag för klassrumsdiskussion

Outputformat:
- Du måste ALLTID svara med ENBART ren JSON (ingen markdown, inget snack runt omkring).
- Struktur (exakt):

{
  "chapter_text": "Själva berättelsen som en sammanhängande text.",
  "reflection_questions": [
    "En första diskussionsfråga...",
    "En andra diskussionsfråga..."
  ],
  "worldstate": {
    "chapterIndex": 1,
    "summary_for_next": "En kort sammanfattning av kapitlet att använda som kontext för nästa kapitel.",
    "previousChapters": [
      {
        "chapterIndex": 1,
        "title": "En kort kapiteltitel om det behövs",
        "short_summary": "En väldigt kort sammanfattning av vad som hände i kapitlet."
      }
    ]
  }
}

VIKTIGT:
- Håll dig strikt till ovanstående JSON-struktur.
- Inga kommentarer, inga extra fält som inte efterfrågas.
- Om du återanvänder previousChapters ska du lägga till det senaste kapitlet sist i listan.
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
          {
            role: "user",
            content: JSON.stringify(userPayload)
          }
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

    const previousChapters =
      parsed.worldstate?.previousChapters ||
      incomingWorldState.previousChapters ||
      [];

    // Lägg till aktuellt kapitel i historiken om det inte redan gjorts
    const updatedPrevious = [
      ...previousChapters,
      {
        chapterIndex,
        title: "",
        short_summary: parsed.worldstate?.summary_for_next || ""
      }
    ];

    const responseWorldstate = {
      chapterIndex,
      summary_for_next: parsed.worldstate?.summary_for_next || "",
      previousChapters: updatedPrevious
    };

    const responseJson = {
      chapterIndex,
      chapterText: parsed.chapter_text || "",
      reflectionQuestions: parsed.reflection_questions || [],
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
  // En enkel CORS-OPTIONS om det skulle behövas
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
