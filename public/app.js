// ===============================
// public/app.js
// BN-Skola v1.1 – frontend logik
// ===============================
(() => {
  const LS_MISSION_KEY = "bnschool_teacher_mission_v1";
  const LS_STORY_KEY   = "bnschool_story_state_v1";

  const el = (id) => document.getElementById(id);

  const tabTeacher = el("tabTeacher");
  const tabStudent = el("tabStudent");
  const teacherView = el("teacherView");
  const studentView = el("studentView");

  const teacherTopic = el("teacherTopic");
  const teacherFacts = el("teacherFacts");
  const teacherGoals = el("teacherGoals");
  const teacherGrade = el("teacherGrade");
  const teacherStyle = el("teacherStyle");
  const teacherInteractive = el("teacherInteractive");
  const teacherChapterCount = el("teacherChapterCount");
  const teacherLengthPreset = el("teacherLengthPreset");

  const saveTeacherMission = el("saveTeacherMission");
  const resetStoryTeacher = el("resetStoryTeacher");
  const teacherSavedInfo = el("teacherSavedInfo");
  const activeMissionPreview = el("activeMissionPreview");

  const studentMissionCard = el("studentMissionCard");
  const studentPrompt = el("studentPrompt");
  const startStory = el("startStory");
  const nextChapter = el("nextChapter");
  const resetStoryStudent = el("resetStoryStudent");
  const statusLine = el("statusLine");
  const chaptersWrap = el("chaptersWrap");

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function getMission() {
    const raw = localStorage.getItem(LS_MISSION_KEY);
    return raw ? safeJsonParse(raw, null) : null;
  }

  function setMission(mission) {
    localStorage.setItem(LS_MISSION_KEY, JSON.stringify(mission));
  }

  function getStoryState() {
    const raw = localStorage.getItem(LS_STORY_KEY);
    return raw ? safeJsonParse(raw, { worldstate: {}, chapters: [] }) : { worldstate: {}, chapters: [] };
  }

  function setStoryState(state) {
    localStorage.setItem(LS_STORY_KEY, JSON.stringify(state));
  }

  function resetStoryState() {
    localStorage.removeItem(LS_STORY_KEY);
  }

  function wordTargetFor(grade, preset) {
    // Snälla, stabila defaultvärden. Åk 4 ska inte dränkas i text.
    const baseByGrade = {
      "Ak 1": 120, "Ak 2": 150, "Ak 3": 200, "Ak 4": 260, "Ak 5": 320, "Ak 6": 380,
      "Ak 7": 450, "Ak 8": 520, "Ak 9": 600
    };
    const base = baseByGrade[grade] ?? 260;
    if (preset === "Kort") return base;
    if (preset === "Normal") return Math.round(base * 1.25);
    if (preset === "Lång") return Math.round(base * 1.6);
    return base;
  }

  function renderActiveMissionPreview() {
    const m = getMission();
    if (!m) {
      activeMissionPreview.innerHTML = `<div class="muted">Inget sparat lektionsuppdrag ännu.</div>`;
      return;
    }
    const goals = (m.goals || []).map(g => `<li>${escapeHtml(g)}</li>`).join("");
    activeMissionPreview.innerHTML = `
      <div><b>${escapeHtml(m.topic || "")}</b> – ${escapeHtml(m.grade || "")}, stil: ${escapeHtml(m.style || "")}</div>
      <div class="muted">Max kapitel: ${escapeHtml(String(m.chapter_plan?.max_chapters ?? ""))}, ca ${escapeHtml(String(m.chapter_plan?.target_words_per_chapter ?? ""))} ord/kapitel</div>
      <div style="margin-top:6px"><b>Lärandemål:</b></div>
      <ul>${goals}</ul>
    `;
  }

  function renderStudentMissionCard() {
    const m = getMission();
    if (!m) {
      studentMissionCard.innerHTML = `<b>Inget lektionsuppdrag sparat.</b><div class="muted">Be läraren fylla i och trycka “Spara lektionsuppdrag”.</div>`;
      return;
    }
    const goals = (m.goals || []).map(g => `<li>${escapeHtml(g)}</li>`).join("");
    studentMissionCard.innerHTML = `
      <div><b>Ämne:</b> ${escapeHtml(m.topic || "")}</div>
      <div><b>Årskurs:</b> ${escapeHtml(m.grade || "")} &nbsp; <b>Stil:</b> ${escapeHtml(m.style || "")}</div>
      <div><b>Lärandemål:</b></div>
      <ul>${goals}</ul>
    `;
  }

  function renderChaptersFromState() {
    const state = getStoryState();
    const chapters = state.chapters || [];
    chaptersWrap.innerHTML = "";
    if (chapters.length === 0) return;

    for (const ch of chapters) {
      const wrap = document.createElement("div");
      wrap.className = "chapter";
      const questions = (ch.reflectionQuestions || []).map(q => `<li>${escapeHtml(q)}</li>`).join("");
      wrap.innerHTML = `
        <h4>Kapitel ${escapeHtml(String(ch.chapterIndex || ""))}</h4>
        <div class="chapterText">${escapeHtml(ch.chapterText || "")}</div>
        <div class="refBox">
          <b>Reflektionsfrågor att diskutera:</b>
          <ol>${questions}</ol>
        </div>
      `;
      chaptersWrap.appendChild(wrap);
    }
  }

  function setStatus(msg) {
    statusLine.textContent = msg || "";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function switchTo(view) {
    if (view === "teacher") {
      tabTeacher.classList.add("active");
      tabStudent.classList.remove("active");
      teacherView.classList.remove("hidden");
      studentView.classList.add("hidden");
    } else {
      tabStudent.classList.add("active");
      tabTeacher.classList.remove("active");
      studentView.classList.remove("hidden");
      teacherView.classList.add("hidden");
      // Viktigt: uppdatera elevkortet varje gång man går in
      renderStudentMissionCard();
      renderChaptersFromState();
    }
  }

  tabTeacher.addEventListener("click", () => switchTo("teacher"));
  tabStudent.addEventListener("click", () => switchTo("student"));

  function loadMissionIntoForm() {
    const m = getMission();
    if (!m) return;

    teacherTopic.value = m.topic || "";
    teacherFacts.value = (m.facts || []).join("\n");
    teacherGoals.value = (m.goals || []).join("\n");
    teacherGrade.value = m.grade || "Ak 4";
    teacherStyle.value = m.style || "Äventyrlig";
    teacherInteractive.checked = !!m.interactive;

    if (m.chapter_plan?.max_chapters) teacherChapterCount.value = String(m.chapter_plan.max_chapters);
    // length preset är inte sparat som preset – vi sparar target_words i mission, preset är bara UI
  }

  saveTeacherMission.addEventListener("click", () => {
    const topic = teacherTopic.value.trim();
    const facts = teacherFacts.value.split("\n").map(s => s.trim()).filter(Boolean);
    const goals = teacherGoals.value.split("\n").map(s => s.trim()).filter(Boolean);
    const grade = teacherGrade.value;
    const style = teacherStyle.value;
    const interactive = teacherInteractive.checked;

    const maxChapters = parseInt(teacherChapterCount.value, 10) || 4;
    const preset = teacherLengthPreset.value;
    const targetWords = wordTargetFor(grade, preset);

    const mission = {
      topic,
      facts,
      goals,
      grade,
      style,
      interactive,
      chapter_plan: {
        max_chapters: maxChapters,
        target_words_per_chapter: targetWords
      }
    };

    setMission(mission);
    teacherSavedInfo.textContent = `Sparat. Elevläget uppdateras nu.`;
    renderActiveMissionPreview();
    renderStudentMissionCard(); // direkt uppdatering
    setTimeout(() => { teacherSavedInfo.textContent = ""; }, 2500);
  });

  function doResetStory() {
    resetStoryState();
    chaptersWrap.innerHTML = "";
    setStatus("Saga rensad. Starta om med “Starta första kapitlet”.");
  }

  resetStoryTeacher.addEventListener("click", doResetStory);
  resetStoryStudent.addEventListener("click", doResetStory);

  async function callGenerate({ isFirst }) {
    const mission = getMission();
    if (!mission) {
      setStatus("Ingen lektionsplan sparad. Gå till Lärarläge och tryck “Spara lektionsuppdrag”.");
      return;
    }

    const prompt = studentPrompt.value.trim();
    if (isFirst && !prompt) {
      setStatus("Skriv en elev-idé först.");
      return;
    }

    setStatus("Skapar kapitel…");

    const state = getStoryState();
    const worldstate = state.worldstate || {};

    const payload = {
      teacher_mission: mission,
      student_prompt: prompt,
      worldstate
    };

    try {
      const res = await fetch("/api/bnschool_generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("API-fel:", res.status, json);
        setStatus(`Fel: ${json?.error || "Okänt fel"} (${res.status})`);
        return;
      }

      // Om API säger “klart” (när maxkapitel nåtts)
      if (json?.done) {
        setStatus(json?.message || "Sagan är klar enligt lärarens kapitelplan.");
        // vi sparar ändå worldstate om den kom tillbaka
        if (json.worldstate) {
          state.worldstate = json.worldstate;
          setStoryState(state);
        }
        return;
      }

      const chapterObj = {
        chapterIndex: json.chapterIndex,
        chapterText: json.chapterText,
        reflectionQuestions: json.reflectionQuestions
      };

      const nextState = getStoryState();
      nextState.worldstate = json.worldstate || nextState.worldstate || {};
      nextState.chapters = Array.isArray(nextState.chapters) ? nextState.chapters : [];
      nextState.chapters.push(chapterObj);
      setStoryState(nextState);

      renderChaptersFromState();
      setStatus("Kapitel genererat.");
    } catch (err) {
      console.error(err);
      setStatus("Nätverksfel. Kolla konsolen (F12) → Console.");
    }
  }

  startStory.addEventListener("click", async () => {
    // Start om – börja alltid från rent state (om man vill)
    // men vi rensar inte automatiskt eftersom du ibland vill fortsätta.
    // Använd “Rensa saga” för en ny bok.
    await callGenerate({ isFirst: true });
  });

  nextChapter.addEventListener("click", async () => {
    await callGenerate({ isFirst: false });
  });

  // Init
  loadMissionIntoForm();
  renderActiveMissionPreview();
  renderStudentMissionCard();
  renderChaptersFromState();

  // Default startläge
  switchTo("teacher");
})();


// ===============================
// functions/api/bnschool_generate.js
// BN-Skola v1.1 – StoryEngine backend för Cloudflare Pages Functions
// ===============================
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

    const maxChapters = Number(teacherMission?.chapter_plan?.max_chapters || 4);
    const targetWords = Number(teacherMission?.chapter_plan?.target_words_per_chapter || 260);

    const prevIndex = (typeof incomingWorldState.chapterIndex === "number") ? incomingWorldState.chapterIndex : 0;
    const chapterIndex = prevIndex + 1;

    // Stoppa om vi nått max kapitel (defensivt – hindrar “19 kapitel”)
    if (chapterIndex > maxChapters) {
      return new Response(
        JSON.stringify({
          done: true,
          message: `Sagan är klar. Läraren har satt max ${maxChapters} kapitel.`,
          chapterIndex: prevIndex,
          worldstate: incomingWorldState
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // System + tone prompt v1 – mer “personlig/levande” men fortfarande skol-safe.
    // Och: hårdare kontinuitetsregler (Zeus kan inte ha åskvingen om den är tappad…)
    const systemPrompt = `
Du är BN-School StoryEngine v1.1.

Mål:
- Skapa pedagogiska, roliga äventyrskapitel för elever 7–15 år.
- Läraren styr FAKTA och LÄRANDEMÅL. Eleven styr fantasin inom ramen.

Kontinuitet (VIKTIGT):
- Du får worldstate med tidigare kapitel och sammanfattning.
- Säg inte emot det som redan hänt.
- Om något är “tappat” / “borta” får karaktären INTE ha det, förrän det faktiskt hittas i berättelsen.
- Var konsekvent med plats, mål och vem som vet vad.

Textnivå:
- Anpassa språket efter teacher_mission.grade.
- Var tydlig, varm och lite humoristisk (utan att bli tramsig).
- Undvik opersonlig “robot-ton”. Skriv som en engagerad berättare.

Längdkrav (MÅSTE):
- Skriv cirka ${targetWords} ord per kapitel (+/- 20%).
- Korta stycken. Inga textväggar.

Innehållsregler:
- Inget sex, inga svordomar.
- Inget våld som glorifieras. Om fara förekommer: håll det mjukt, tryggt och barnanpassat.

Interaktivitet:
- Om teacher_mission.interactive = true:
  - Lägg in 1–2 naturliga frågor i kapitlet som bjuder in eleven att tänka/ välja.
  - Men håll fortfarande kapitlet sammanhängande.

Reflektionsfrågor (MÅSTE):
- Skapa exakt 3 frågor som:
  1) Knyter till lärarens fakta
  2) Knyter till lärandemål
  3) Knyter till elevens val/upplevelse
- Frågorna ska vara tydliga och passa åldern.

Outputformat (MÅSTE):
- ENDAST ren JSON, inget annat.
- Exakt struktur:

{
  "chapter_text": "text…",
  "reflection_questions": ["…","…","…"],
  "worldstate": {
    "chapterIndex": <number>,
    "summary_for_next": "kort sammanfattning",
    "previousChapters": [
      { "chapterIndex": <number>, "title": "", "short_summary": "…" }
    ]
  }
}

Håll dig strikt till detta. Inga extra fält.
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
      return new Response(
        JSON.stringify({ error: "OpenAI API fel", details: openaiJson }),
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
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
