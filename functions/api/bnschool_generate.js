// functions/api/bnschool_generate.js
// BN-Skola v1.4 – StoryEngine backend (Cloudflare Pages Functions)
// Fokus: v1-driv (framåtrörelse + upptäckter), mindre snack, bättre minne mellan kapitel
// Stabil respons-signatur: { chapterIndex, chapterText, reflectionQuestions, worldstate }

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    const body = await request.json().catch(() => ({}));

    const teacherMission = body.teacher_mission || null;
    const studentPromptRaw = typeof body.student_prompt === "string" ? body.student_prompt : "";
    const studentName = typeof body.student_name === "string" ? body.student_name.trim() : "";
    const incomingWorldState = body.worldstate && typeof body.worldstate === "object" ? body.worldstate : {};
    const useNewDirection = body.use_new_direction === true; // frontend checkbox

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

    // ---------------------------
    // Helpers
    // ---------------------------
    const safeStr = (v) => (typeof v === "string" ? v : "");
    const safeArr = (v) => (Array.isArray(v) ? v : []);
    const cleanOneLine = (s) => safeStr(s).trim().replace(/\s+/g, " ");
    const qClean = (s) => cleanOneLine(s);

    // ---------------------------
    // Kapitelindex
    // ---------------------------
    const prevIndex = typeof incomingWorldState.chapterIndex === "number" ? incomingWorldState.chapterIndex : 0;
    const chapterIndex = prevIndex + 1;

    // ---------------------------
    // Length ranges (ord)
    // ---------------------------
    const grade = parseInt(teacherMission.grade_level, 10) || 4;
    const len = safeStr(teacherMission.chapter_length || "normal").toLowerCase(); // "kort" | "normal" | "lang"

    const lengthTable = {
      2: { kort: [70, 95], normal: [95, 130], lang: [140, 190] },
      3: { kort: [90, 125], normal: [125, 170], lang: [180, 240] },
      4: { kort: [120, 170], normal: [170, 230], lang: [240, 340] },
      5: { kort: [140, 200], normal: [200, 270], lang: [280, 380] },
      6: { kort: [160, 230], normal: [230, 320], lang: [330, 450] },
      7: { kort: [180, 260], normal: [260, 360], lang: [370, 520] },
      8: { kort: [200, 290], normal: [290, 420], lang: [430, 600] },
      9: { kort: [220, 320], normal: [320, 480], lang: [490, 680] },
    };

    const ranges = lengthTable[grade] || lengthTable[4];
    const [minWords, maxWords] = ranges[len] || ranges["normal"];

    // ---------------------------
    // “Minne”: previous summaries (senaste 3)
    // ---------------------------
    const incomingPrev = safeArr(incomingWorldState.previousChapters || []);
    const last3 = incomingPrev.slice(-3).map((x) => ({
      chapterIndex: typeof x?.chapterIndex === "number" ? x.chapterIndex : null,
      short_summary: safeStr(x?.short_summary || ""),
    }));

    const incomingSummary = safeStr(incomingWorldState.summary_for_next || "");
    const memoryBlock = {
      summary_for_next: incomingSummary,
      last_chapters: last3,
    };

    // ---------------------------
    // Prompt-beteende (BN-Kids-style):
    // - Kap 1: prompt används alltid (om finns)
    // - Kap 2+: prompt används bara om "use_new_direction" är true
    // ---------------------------
    const studentPrompt = cleanOneLine(studentPromptRaw);
    const effectivePrompt =
      chapterIndex === 1 ? studentPrompt : (useNewDirection ? studentPrompt : "");

    // ---------------------------
    // Systemprompt – v1-driv (framåt + rundtur + upptäckter, mindre gubbsnack)
    // ---------------------------
    const systemPrompt = `
Du är BN-School StoryEngine v1.4.

=== ROLL ===
Du skriver ett kapitel i andra person ("du"). Du är en medspelare i elevens äventyr, inte en föreläsare.

=== KÄRNMÅL (V1-DRIV) ===
Varje kapitel måste KÄNNAS som att det händer något nytt.
Du ska prioritera: rörelse, upptäckter, miljö, små spår/ledtrådar, och en tydlig "nästa steg"-krok.

=== LÄRARFAKTA ===
Lärarens uppdrag och fakta får inte motsägas. Du får väva in 1–2 extra mikrofakta om det passar och är säkert.

=== MINDRE DIALOG, MER UTFORSKNING ===
- Max 6 repliker totalt per kapitel.
- Inga dialog-loopar där karaktärer pratar om varandra ("Zeus sa / Poseidon sa / Hades sa...").
- Visa istället världen: saker ni SER, HÖR, KÄNNER, och PLATSER ni rör er genom.

=== "RUND-TUR"-STIL (det som funkade bäst) ===
När eleven vill följa med en figur (t.ex. Poseidon/Hades) ska kapitlet bli en rundtur:
- Ni rör er genom MINST 2 platser eller "stationer" (ex. port → sal → flod → tunnel).
- Varje station har 2 konkreta detaljer + 1 liten händelse (något rör sig, en ledtråd, ett val, en reaktion).
- Låt figuren guida genom handling, inte genom föreläsning.

=== INGEN "VÅGAR DU?"-TON ===
Ställ aldrig frågor som skammar eller utmanar ("vågar du?").
Om du ställer en fråga, gör den nyfiken och öppen: "Vad väljer du?" / "Vad vill du undersöka?"

=== ELEVENS NAMN ===
Om student_name finns: nämn namnet naturligt 1–2 gånger (inte i varje mening).

=== LÄNGD (HÅRD) ===
Håll chapter_text inom ${minWords}–${maxWords} ord. Hellre lite kort än för långt.

=== KAPITELSTRUKTUR (MÅSTE) ===
1) Start: direkt in i en scen (1–2 meningar).
2) Utforskning: 2 stationer/plats-skiften med konkreta detaljer.
3) Framåtdrift: en liten twist/ledtråd/händelse som ändrar läget.
4) Avslut: en tydlig "nästa steg"-krok (utan att fråga "vågar du").

=== REFLEKTIONSFRÅGOR (EXAKT 3) ===
1) Fakta: enkel vad-fråga från uppdraget
2) Förståelse: enkel varför-fråga kopplad till händelsen
3) Personlig: "Vad hade du valt/gjort?" (inga rätt/fel)

=== OUTPUTFORMAT ===
Svara ENDAST med ren JSON:
{
  "chapter_text": "...",
  "reflection_questions": ["...","...","..."],
  "worldstate": {
    "summary_for_next": "2–4 meningar + en sista rad 'STATE: {...}'",
    "state_tags": ["valfria korta taggar"]
  }
}

VIKTIGT: summary_for_next MÅSTE sluta med en egen rad:
STATE: {}
Eller STATE: {"nyckel":"värde"} om något behöver låsas.
`.trim();

    // ---------------------------
    // User payload till modellen
    // ---------------------------
    const userPayload = {
      chapterIndex,
      teacher_mission: teacherMission,
      student_name: studentName,
      // Bara effektiv prompt (så vi slipper att den “fastnar” på prompt 1 när du inte vill)
      student_prompt: effectivePrompt,
      use_new_direction: useNewDirection,
      // "minne" från tidigare kapitel
      memory: memoryBlock,
      // worldstate som frontend skickar (för kompat)
      worldstate: incomingWorldState || {},
    };

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

    const openaiJson = await openaiResponse.json().catch(() => ({}));
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

    // Enforce: EXAKT 3 reflektionsfrågor
    let rq = safeArr(parsed.reflection_questions).map(qClean).filter(Boolean);

    const topic = safeStr(teacherMission.topic || "ämnet");
    const fallback1 = `Vilken sak lärde du dig om ${topic} i kapitlet?`;
    const fallback2 = `Varför tror du att det som hände hängde ihop med ${topic}?`;
    const fallback3 = `Vad hade du själv valt att göra härnäst?`;

    if (rq.length >= 3) rq = rq.slice(0, 3);
    while (rq.length < 3) {
      if (rq.length === 0) rq.push(fallback1);
      else if (rq.length === 1) rq.push(fallback2);
      else rq.push(fallback3);
    }

    const chapterText = safeStr(parsed.chapter_text || "").trim();
    const summaryForNext = safeStr(parsed.worldstate?.summary_for_next || "").trim() || "STATE: {}";

    // Append:a previousChapters så "minnet" verkligen byggs
    const nextPrevious = safeArr(incomingWorldState.previousChapters || []).slice();
    // kort sammanfattning: ta första ~200 tecken om modellen inte ger egen “short_summary”
    const autoShort =
      summaryForNext.split("\n").filter(Boolean)[0]?.slice(0, 200) || chapterText.slice(0, 200);
    nextPrevious.push({
      chapterIndex,
      short_summary: autoShort,
    });

    // Output till frontend (stabil signatur)
    const responseJson = {
      chapterIndex,
      chapterText,
      reflectionQuestions: rq,
      worldstate: {
        chapterIndex,
        summary_for_next: summaryForNext,
        previousChapters: nextPrevious,
        // behåll ev. andra worldstate-nycklar (framtidssäkert)
        ...(incomingWorldState && typeof incomingWorldState === "object" ? incomingWorldState : {}),
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
