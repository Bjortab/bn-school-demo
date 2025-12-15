// public/app.js
// BN-Skola v1.3 – frontend-logik (BN-Kids prompt-beteende + kapitel-spar + spinner + elevnamn)

let teacherMission = null;

let worldState = {
  chapterIndex: 0,
  summary_for_next: "",
  previousChapters: [] // [{chapterIndex, chapterText, reflectionQuestions, summary_for_next}]
};

const LS_MISSION_KEY = "bn_school_teacher_mission_v1";
const LS_WORLDSTATE_KEY = "bn_school_worldstate_v1";

document.addEventListener("DOMContentLoaded", () => {
  // Mode
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
    renderChapterSelector();
    renderCurrentChapter();
  });

  // Buttons
  document.getElementById("save-mission-btn").addEventListener("click", onSaveMissionClicked);
  document.getElementById("generate-chapter-btn").addEventListener("click", onGenerateChapterClicked);
  document.getElementById("reset-story-btn").addEventListener("click", onResetStoryClicked);

  // Chapter selector
  document.getElementById("chapter-select").addEventListener("change", renderCurrentChapter);

  // Load
  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChapterSelector();
  renderCurrentChapter();
});

// ---------- LocalStorage ----------
function loadFromLocalStorage() {
  try {
    const missionRaw = localStorage.getItem(LS_MISSION_KEY);
    const wsRaw = localStorage.getItem(LS_WORLDSTATE_KEY);

    if (missionRaw) {
      teacherMission = JSON.parse(missionRaw);
      fillTeacherForm(teacherMission);
    }
    if (wsRaw) {
      worldState = JSON.parse(wsRaw);
      // hård-säkring
      if (!worldState || typeof worldState !== "object") worldState = defaultWorldState();
      if (!Array.isArray(worldState.previousChapters)) worldState.previousChapters = [];
      if (typeof worldState.chapterIndex !== "number") worldState.chapterIndex = 0;
    }
  } catch (e) {
    console.warn("Kunde inte läsa från localStorage:", e);
    teacherMission = null;
    worldState = defaultWorldState();
  }
}

function saveToLocalStorage() {
  try {
    if (teacherMission) localStorage.setItem(LS_MISSION_KEY, JSON.stringify(teacherMission));
    localStorage.setItem(LS_WORLDSTATE_KEY, JSON.stringify(worldState));
  } catch (e) {
    console.warn("Kunde inte spara till localStorage:", e);
  }
}

function defaultWorldState() {
  return { chapterIndex: 0, summary_for_next: "", previousChapters: [] };
}

// ---------- Lärarläge ----------
function fillTeacherForm(mission) {
  document.getElementById("topic-input").value = mission.topic || "";
  document.getElementById("facts-input").value = (mission.facts || []).join("\n");
  document.getElementById("goals-input").value = (mission.learning_goals || []).join("\n");
  document.getElementById("grade-select").value = mission.grade_level || "";
  document.getElementById("style-select").value = mission.story_style || "äventyrlig";
  document.getElementById("interaction-checkbox").checked = !!mission.requires_interaction;

  const maxCh = String(mission.max_chapters || "4");
  const len = mission.chapter_length || "normal";
  const maxSel = document.getElementById("max-chapters-select");
  const lenSel = document.getElementById("chapter-length-select");
  if (maxSel) maxSel.value = maxCh;
  if (lenSel) lenSel.value = len;
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

  const maxChapters = parseInt(document.getElementById("max-chapters-select").value, 10) || 4;
  const chapterLength = document.getElementById("chapter-length-select").value || "normal";

  if (!topic) {
    statusEl.textContent = "Du måste ange ett ämne.";
    statusEl.classList.add("error");
    return;
  }
  if (facts.length === 0) {
    statusEl.textContent = "Lägg till minst en faktarad.";
    statusEl.classList.add("error");
    return;
  }
  if (!gradeLevel) {
    statusEl.textContent = "Välj årskurs.";
    statusEl.classList.add("error");
    return;
  }

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

  // Ny lektion = ny story
  worldState = defaultWorldState();
  saveToLocalStorage();

  renderSavedMission();
  renderLessonSummary();
  renderChapterSelector();
  renderCurrentChapter();

  statusEl.textContent = "Lektionsuppdrag sparat.";
}

function renderSavedMission() {
  const container = document.getElementById("saved-mission");
  container.innerHTML = "";
  if (!teacherMission) return;

  const h3 = document.createElement("h3");
  h3.textContent = "Aktivt lektionsuppdrag";
  container.appendChild(h3);

  const p = document.createElement("p");
  p.textContent =
    `${teacherMission.topic} – Åk ${teacherMission.grade_level}, stil: ${teacherMission.story_style}, ` +
    `längd: ${prettyLen(teacherMission.chapter_length)}, max kapitel: ${teacherMission.max_chapters}`;
  container.appendChild(p);

  if (teacherMission.learning_goals && teacherMission.learning_goals.length > 0) {
    const goalsTitle = document.createElement("p");
    goalsTitle.textContent = "Lärandemål:";
    container.appendChild(goalsTitle);

    const ul = document.createElement("ul");
    teacherMission.learning_goals.forEach((g) => {
      const li = document.createElement("li");
      li.textContent = g;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }
}

function prettyLen(v) {
  if (v === "kort") return "Kort";
  if (v === "lang") return "Lång";
  return "Normal";
}

// ---------- Elevläge ----------
function renderLessonSummary() {
  const summaryEl = document.getElementById("lesson-summary");
  summaryEl.innerHTML = "";

  if (!teacherMission) {
    const p = document.createElement("p");
    p.textContent =
      "Ingen lektionsplan är vald ännu. Be läraren skapa ett lektionsuppdrag i Lärarläget.";
    summaryEl.appendChild(p);
    return;
  }

  const p1 = document.createElement("p");
  p1.innerHTML = `<strong>Ämne:</strong> ${teacherMission.topic}`;
  summaryEl.appendChild(p1);

  const p2 = document.createElement("p");
  p2.innerHTML =
    `<strong>Årskurs:</strong> ${teacherMission.grade_level} &nbsp; ` +
    `<strong>Stil:</strong> ${teacherMission.story_style} &nbsp; ` +
    `<strong>Längd:</strong> ${prettyLen(teacherMission.chapter_length)}`;
  summaryEl.appendChild(p2);

  if (teacherMission.learning_goals && teacherMission.learning_goals.length > 0) {
    const p3 = document.createElement("p");
    p3.innerHTML = "<strong>Lärandemål:</strong>";
    summaryEl.appendChild(p3);

    const ul = document.createElement("ul");
    teacherMission.learning_goals.forEach((g) => {
      const li = document.createElement("li");
      li.textContent = g;
      ul.appendChild(li);
    });
    summaryEl.appendChild(ul);
  }
}

function setLoading(isLoading, text = "Skapar kapitel…") {
  const overlay = document.getElementById("loading-overlay");
  const t = overlay.querySelector(".loading-text");
  t.textContent = text;
  overlay.classList.toggle("hidden", !isLoading);
  overlay.setAttribute("aria-hidden", String(!isLoading));
}

function renderChapterSelector() {
  const sel = document.getElementById("chapter-select");
  const counter = document.getElementById("chapter-counter");
  const chapters = worldState.previousChapters || [];
  const max = teacherMission?.max_chapters || 0;

  sel.innerHTML = "";

  if (chapters.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Inga kapitel ännu";
    sel.appendChild(opt);
    counter.textContent = max ? `Visar kapitel 0 av ${max}` : "";
    return;
  }

  chapters.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.chapterIndex);
    opt.textContent = `Kapitel ${c.chapterIndex}`;
    sel.appendChild(opt);
  });

  // Default: senaste
  sel.value = String(chapters[chapters.length - 1].chapterIndex);

  counter.textContent = max
    ? `Visar kapitel ${chapters.length} av ${max}`
    : `Visar kapitel ${chapters.length}`;
}

function renderCurrentChapter() {
  const storyEl = document.getElementById("story-output");
  const questionsEl = document.getElementById("questions-output");
  const metaEl = document.getElementById("chapter-meta");
  const statusEl = document.getElementById("student-status");
  const btn = document.getElementById("generate-chapter-btn");

  storyEl.textContent = "";
  questionsEl.innerHTML = "";
  metaEl.textContent = "";
  statusEl.textContent = "";

  const chapters = worldState.previousChapters || [];
  const maxCh = teacherMission?.max_chapters || null;

  if (!teacherMission) {
    btn.disabled = true;
    btn.textContent = "Starta första kapitlet";
    return;
  }

  btn.disabled = false;

  if (chapters.length === 0) {
    btn.textContent = "Starta första kapitlet";
    return;
  }

  // Sätt knapptext
  if (maxCh && chapters.length >= maxCh) {
    btn.textContent = "Klar (max kapitel)";
    btn.disabled = true;
  } else {
    btn.textContent = "Nästa kapitel";
  }

  const sel = document.getElementById("chapter-select");
  const wanted = parseInt(sel.value, 10);
  const chosen = chapters.find(c => c.chapterIndex === wanted) || chapters[chapters.length - 1];

  metaEl.textContent = `Kapitel ${chosen.chapterIndex}`;
  storyEl.textContent = chosen.chapterText || "(Inget kapitel sparat)";

  const questions = Array.isArray(chosen.reflectionQuestions) ? chosen.reflectionQuestions : [];
  if (questions.length) {
    const h3 = document.createElement("h3");
    h3.textContent = "Reflektionsfrågor att diskutera:";
    questionsEl.appendChild(h3);

    const ol = document.createElement("ol");
    questions.forEach((q) => {
      const li = document.createElement("li");
      li.textContent = q;
      ol.appendChild(li);
    });
    questionsEl.appendChild(ol);
  }
}

function onResetStoryClicked() {
  if (!teacherMission) return;
  worldState = defaultWorldState();
  saveToLocalStorage();
  renderChapterSelector();
  renderCurrentChapter();

  const statusEl = document.getElementById("student-status");
  statusEl.textContent = "Sagan rensad.";
}

async function onGenerateChapterClicked() {
  const statusEl = document.getElementById("student-status");
  const btn = document.getElementById("generate-chapter-btn");

  statusEl.textContent = "";
  statusEl.classList.remove("error");

  if (!teacherMission) {
    statusEl.textContent = "Ingen lektionsplan är vald. Låt läraren skapa ett uppdrag först.";
    statusEl.classList.add("error");
    return;
  }

  const promptInput = document.getElementById("student-prompt-input");
  const studentName = (document.getElementById("student-name-input").value || "").trim();

  const chapters = worldState.previousChapters || [];
  const isFirst = chapters.length === 0;

  const rawPrompt = (promptInput.value || "").trim();

  // BN-Kids-regel:
  // - Kap 1: prompt måste finnas.
  // - Kap 2+: prompt skickas INTE (även om den ligger kvar), så vi fortsätter framåt utan att börja om.
  let outgoingPrompt = "";
  if (isFirst) {
    if (!rawPrompt) {
      statusEl.textContent = "Skriv en idé eller prompt för första kapitlet.";
      statusEl.classList.add("error");
      return;
    }
    outgoingPrompt = rawPrompt;
  } else {
    outgoingPrompt = "";
  }

  // Max kapitel-lås
  const maxCh = teacherMission.max_chapters || null;
  if (maxCh && chapters.length >= maxCh) {
    statusEl.textContent = "Max antal kapitel nått.";
    statusEl.classList.add("error");
    return;
  }

  btn.disabled = true;
  setLoading(true, isFirst ? "Skapar första kapitlet…" : "Skapar nästa kapitel…");

  try {
    const payload = {
      teacher_mission: teacherMission,
      student_name: studentName,
      student_prompt: outgoingPrompt,
      worldstate: worldState
    };

    const resp = await fetch("/api/bnschool_generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Fel från server:", errText);
      statusEl.textContent = "Fel från servern. Försök igen.";
      statusEl.classList.add("error");
      return;
    }

    const data = await resp.json();

    // Uppdatera state + spara kapitel lokalt
    const newIndex = data.chapterIndex;
    const chapterText = data.chapterText || "";
    const reflectionQuestions = data.reflectionQuestions || [];
    const newWs = data.worldstate || {};

    // Bygg lokalt chapter-objekt
    const chapterObj = {
      chapterIndex: newIndex,
      chapterText,
      reflectionQuestions,
      summary_for_next: newWs.summary_for_next || ""
    };

    // Idempotent: ersätt om samma index redan finns
    const nextChapters = Array.isArray(worldState.previousChapters) ? [...worldState.previousChapters] : [];
    const existingPos = nextChapters.findIndex(c => c.chapterIndex === newIndex);
    if (existingPos >= 0) nextChapters[existingPos] = chapterObj;
    else nextChapters.push(chapterObj);

    worldState = {
      chapterIndex: newIndex,
      summary_for_next: newWs.summary_for_next || "",
      previousChapters: nextChapters
    };

    saveToLocalStorage();

    renderChapterSelector();
    renderCurrentChapter();

    statusEl.textContent = "Kapitel genererat.";
  } catch (e) {
    console.error("Nätverksfel:", e);
    statusEl.textContent = "Nätverksfel. Kontrollera uppkoppling och försök igen.";
    statusEl.classList.add("error");
  } finally {
    setLoading(false);
    btn.disabled = false;
  }
}
