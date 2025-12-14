// public/app.js
// BN-Skola Demo v1.0 (stabil)
// - Rensa saga
// - Prompt kvar = startar inte om (BN-Kids-beteende)
// - Läraren styr: max kapitel + längd

let teacherMission = null;

let worldState = {
  chapterIndex: 0,
  previousChapters: [],
  summary_for_next: ""
};

let lastPromptUsed = "";

const LS_MISSION_KEY = "bn_school_teacher_mission_v1";
const LS_WORLDSTATE_KEY = "bn_school_worldstate_v1";
const LS_LASTPROMPT_KEY = "bn_school_last_prompt_v1";

document.addEventListener("DOMContentLoaded", () => {
  const modeTeacherBtn = document.getElementById("mode-teacher");
  const modeStudentBtn = document.getElementById("mode-student");
  const teacherPanel = document.getElementById("teacher-panel");
  const studentPanel = document.getElementById("student-panel");

  modeTeacherBtn.addEventListener("click", () => {
    modeTeacherBtn.classList.add("active");
    modeStudentBtn.classList.remove("active");
    teacherPanel.classList.remove("hidden");
    studentPanel.classList.add("hidden");
  });

  modeStudentBtn.addEventListener("click", () => {
    modeStudentBtn.classList.add("active");
    modeTeacherBtn.classList.remove("active");
    teacherPanel.classList.add("hidden");
    studentPanel.classList.remove("hidden");
    renderLessonSummary();
    renderLatestChapter();
  });

  document.getElementById("save-mission-btn").addEventListener("click", onSaveMissionClicked);
  document.getElementById("generate-chapter-btn").addEventListener("click", onGenerateChapterClicked);
  document.getElementById("reset-story-btn").addEventListener("click", onResetStoryClicked);

  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderLatestChapter();
});

function loadFromLocalStorage() {
  try {
    const missionRaw = localStorage.getItem(LS_MISSION_KEY);
    const wsRaw = localStorage.getItem(LS_WORLDSTATE_KEY);
    const lpRaw = localStorage.getItem(LS_LASTPROMPT_KEY);

    if (missionRaw) {
      teacherMission = JSON.parse(missionRaw);
      fillTeacherForm(teacherMission);
    }
    if (wsRaw) {
      worldState = JSON.parse(wsRaw);
    }
    if (lpRaw) {
      lastPromptUsed = String(lpRaw || "");
    }
  } catch (e) {
    console.warn("Kunde inte läsa från localStorage:", e);
  }
}

function saveToLocalStorage() {
  try {
    if (teacherMission) localStorage.setItem(LS_MISSION_KEY, JSON.stringify(teacherMission));
    localStorage.setItem(LS_WORLDSTATE_KEY, JSON.stringify(worldState));
    localStorage.setItem(LS_LASTPROMPT_KEY, String(lastPromptUsed || ""));
  } catch (e) {
    console.warn("Kunde inte spara till localStorage:", e);
  }
}

function fillTeacherForm(mission) {
  document.getElementById("topic-input").value = mission.topic || "";
  document.getElementById("facts-input").value = (mission.facts || []).join("\n");
  document.getElementById("goals-input").value = (mission.learning_goals || []).join("\n");
  document.getElementById("grade-select").value = mission.grade_level || "";
  document.getElementById("style-select").value = mission.story_style || "äventyrlig";
  document.getElementById("interaction-checkbox").checked = !!mission.requires_interaction;

  document.getElementById("maxchapters-select").value = String(mission.max_chapters ?? 4);
  document.getElementById("chapterlength-select").value = String(mission.chapter_length ?? "kort");
}

function resetStoryStateOnly() {
  worldState = { chapterIndex: 0, previousChapters: [], summary_for_next: "" };
  lastPromptUsed = "";
  saveToLocalStorage();
}

function onSaveMissionClicked() {
  const statusEl = document.getElementById("teacher-status");
  statusEl.textContent = "";
  statusEl.classList.remove("error");

  const topic = (document.getElementById("topic-input").value || "").trim();

  const facts = (document.getElementById("facts-input").value || "")
    .split("\n").map(s => s.trim()).filter(Boolean);

  const learningGoals = (document.getElementById("goals-input").value || "")
    .split("\n").map(s => s.trim()).filter(Boolean);

  const gradeLevel = document.getElementById("grade-select").value;
  const storyStyle = document.getElementById("style-select").value || "äventyrlig";
  const requiresInteraction = document.getElementById("interaction-checkbox").checked;

  const maxChapters = parseInt(document.getElementById("maxchapters-select").value || "4", 10);
  const chapterLength = String(document.getElementById("chapterlength-select").value || "kort");

  if (!topic) return fail(statusEl, "Du måste ange ett ämne.");
  if (facts.length === 0) return fail(statusEl, "Lägg till minst en faktarad.");
  if (!gradeLevel) return fail(statusEl, "Välj årskurs.");
  if (!Number.isFinite(maxChapters) || maxChapters < 1 || maxChapters > 20) return fail(statusEl, "Max antal kapitel måste vara 1–20.");
  if (!["kort", "normal", "lång"].includes(chapterLength)) return fail(statusEl, "Kapitel-längd måste vara Kort/Normal/Lång.");

  teacherMission = {
    topic,
    facts,
    learning_goals: learningGoals,
    grade_level: gradeLevel,
    story_style: storyStyle,
    requires_interaction: requiresInteraction,
    max_chapters: maxChapters,
    chapter_length: chapterLength
  };

  resetStoryStateOnly();
  saveToLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderLatestChapter();

  statusEl.textContent = "Lektionsuppdrag sparat.";
}

function fail(statusEl, msg) {
  statusEl.textContent = msg;
  statusEl.classList.add("error");
}

function renderSavedMission() {
  const container = document.getElementById("saved-mission");
  container.innerHTML = "";
  if (!teacherMission) return;

  const h3 = document.createElement("h3");
  h3.textContent = "Aktivt lektionsuppdrag";
  container.appendChild(h3);

  const p = document.createElement("p");
  p.textContent = `${teacherMission.topic} – Åk ${teacherMission.grade_level}, stil: ${teacherMission.story_style} • max kapitel: ${teacherMission.max_chapters} • längd: ${teacherMission.chapter_length}`;
  container.appendChild(p);

  if (teacherMission.learning_goals && teacherMission.learning_goals.length) {
    const t = document.createElement("p");
    t.textContent = "Lärandemål:";
    container.appendChild(t);

    const ul = document.createElement("ul");
    teacherMission.learning_goals.forEach(g => {
      const li = document.createElement("li");
      li.textContent = g;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }
}

function renderLessonSummary() {
  const summaryEl = document.getElementById("lesson-summary");
  summaryEl.innerHTML = "";

  if (!teacherMission) {
    const p = document.createElement("p");
    p.textContent = "Ingen lektionsplan är vald ännu. Be läraren skapa ett lektionsuppdrag i Lärarläget.";
    summaryEl.appendChild(p);
    return;
  }

  const p1 = document.createElement("p");
  p1.innerHTML = `<strong>Ämne:</strong> ${teacherMission.topic}`;
  summaryEl.appendChild(p1);

  const p2 = document.createElement("p");
  p2.innerHTML = `<strong>Årskurs:</strong> ${teacherMission.grade_level} &nbsp; <strong>Stil:</strong> ${teacherMission.story_style} &nbsp; <strong>Längd:</strong> ${teacherMission.chapter_length} &nbsp; <strong>Max kapitel:</strong> ${teacherMission.max_chapters}`;
  summaryEl.appendChild(p2);

  if (teacherMission.learning_goals && teacherMission.learning_goals.length) {
    const p3 = document.createElement("p");
    p3.innerHTML = "<strong>Lärandemål:</strong>";
    summaryEl.appendChild(p3);

    const ul = document.createElement("ul");
    teacherMission.learning_goals.forEach(g => {
      const li = document.createElement("li");
      li.textContent = g;
      ul.appendChild(li);
    });
    summaryEl.appendChild(ul);
  }
}

function renderLatestChapter() {
  const metaEl = document.getElementById("chapter-meta");
  const storyEl = document.getElementById("story-output");
  const questionsEl = document.getElementById("questions-output");
  const btn = document.getElementById("generate-chapter-btn");

  const pcs = Array.isArray(worldState.previousChapters) ? worldState.previousChapters : [];

  if (!pcs.length) {
    metaEl.textContent = "";
    storyEl.textContent = "";
    questionsEl.innerHTML = "";
    btn.textContent = "Starta första kapitlet";
    return;
  }

  const latest = pcs[pcs.length - 1];
  const chapterNum = latest?.chapterIndex || worldState.chapterIndex || pcs.length;

  metaEl.textContent = `Kapitel ${chapterNum}`;
  storyEl.textContent = latest?.chapter_text || "";

  questionsEl.innerHTML = "";
  const qs = Array.isArray(latest?.reflection_questions) ? latest.reflection_questions : [];
  if (qs.length) {
    const h3 = document.createElement("h3");
    h3.textContent = "Reflektionsfrågor att diskutera:";
    questionsEl.appendChild(h3);

    const ol = document.createElement("ol");
    qs.forEach(q => {
      const li = document.createElement("li");
      li.textContent = String(q || "");
      ol.appendChild(li);
    });
    questionsEl.appendChild(ol);
  }

  btn.textContent = "Nästa kapitel";
}

function onResetStoryClicked() {
  if (!confirm("Vill du rensa sagan på den här enheten?")) return;

  resetStoryStateOnly();

  document.getElementById("student-status").textContent = "Sagan rensad.";
  document.getElementById("student-status").classList.remove("error");
  document.getElementById("chapter-meta").textContent = "";
  document.getElementById("story-output").textContent = "";
  document.getElementById("questions-output").innerHTML = "";
  document.getElementById("generate-chapter-btn").textContent = "Starta första kapitlet";
  // prompten får stå kvar – men den startar inte om automatiskt
}

function shouldSendStudentPrompt(rawPrompt) {
  const p = (rawPrompt || "").trim();
  const idx = Number(worldState.chapterIndex || 0);

  if (idx === 0) return p;        // kapitel 1 behöver prompt
  if (!p) return "";              // inget att skicka
  if (p === lastPromptUsed) return ""; // kvarlämnad prompt ignoreras
  return p;                       // ny/ändrad prompt skickas
}

async function onGenerateChapterClicked() {
  const statusEl = document.getElementById("student-status");
  const btn = document.getElementById("generate-chapter-btn");
  const promptInput = document.getElementById("student-prompt-input");

  statusEl.textContent = "";
  statusEl.classList.remove("error");

  if (!teacherMission) return fail(statusEl, "Ingen lektionsplan är vald. Låt läraren skapa ett uppdrag först.");

  const studentPromptToSend = shouldSendStudentPrompt(promptInput.value || "");

  if (!studentPromptToSend && Number(worldState.chapterIndex || 0) === 0) {
    return fail(statusEl, "Skriv en idé eller prompt för första kapitlet.");
  }

  btn.disabled = true;
  btn.textContent = Number(worldState.chapterIndex || 0) === 0 ? "Skapar första kapitlet..." : "Skapar nästa kapitel...";

  try {
    const payload = {
      teacher_mission: teacherMission,
      student_prompt: studentPromptToSend,
      worldstate: worldState
    };

    const resp = await fetch("/api/bnschool_generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Fel från server:", resp.status, t);
      if (resp.status === 400) return fail(statusEl, "Max antal kapitel är nått för den här lektionen.");
      return fail(statusEl, "Fel från servern. Försök igen.");
    }

    const data = await resp.json();

    if (studentPromptToSend) lastPromptUsed = studentPromptToSend.trim();

    worldState = data.worldstate || worldState;
    worldState.chapterIndex = data.chapterIndex ?? worldState.chapterIndex;

    saveToLocalStorage();
    renderLatestChapter();

    statusEl.textContent = "Kapitel genererat.";
  } catch (e) {
    console.error("Nätverksfel:", e);
    fail(statusEl, "Nätverksfel. Kontrollera uppkoppling och försök igen.");
  } finally {
    btn.disabled = false;
    btn.textContent = Number(worldState.chapterIndex || 0) === 0 ? "Starta första kapitlet" : "Nästa kapitel";
  }
}
