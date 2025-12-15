// public/app.js
// BN-Skola v1.4 – frontend-logik
// Fixar: kapitel-spar + kapitelväljare + spinner/disable + reset

let teacherMission = null;

// OBS: worldState.previousChapters i backend är summaries, inte full text.
// Därför sparar vi kapiteltexter separat i localStorage.
let worldState = {
  chapterIndex: 0,
  previousChapters: [] // summaries från backend
};

let chapterTexts = []; // [{ chapterIndex: 1, text: "..." }, ...]

const LS_MISSION_KEY = "bn_school_teacher_mission_v1";
const LS_WORLDSTATE_KEY = "bn_school_worldstate_v1";
const LS_CHAPTERTEXTS_KEY = "bn_school_chapter_texts_v1";

document.addEventListener("DOMContentLoaded", () => {
  // Mode-knappar
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
    renderChapterUI(); // viktigt
  });

  // Lärarform
  const saveMissionBtn = document.getElementById("save-mission-btn");
  saveMissionBtn.addEventListener("click", onSaveMissionClicked);

  // Elevknappar
  const generateChapterBtn = document.getElementById("generate-chapter-btn");
  generateChapterBtn.addEventListener("click", onGenerateChapterClicked);

  const resetBtn = document.getElementById("reset-story-btn");
  if (resetBtn) resetBtn.addEventListener("click", onResetStoryClicked);

  // Kapitelväljare
  const chapterSelect = document.getElementById("chapter-select");
  if (chapterSelect) {
    chapterSelect.addEventListener("change", (e) => {
      renderChapterUI(e.target.value);
    });
  }

  // Ladda state
  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChapterUI();
});

// ---------- Spinner ----------
function showSpinner(show) {
  const overlay = document.getElementById("spinnerOverlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
}

// ---------- LocalStorage ----------
function loadFromLocalStorage() {
  try {
    const missionRaw = localStorage.getItem(LS_MISSION_KEY);
    const wsRaw = localStorage.getItem(LS_WORLDSTATE_KEY);
    const chRaw = localStorage.getItem(LS_CHAPTERTEXTS_KEY);

    if (missionRaw) {
      teacherMission = JSON.parse(missionRaw);
      fillTeacherForm(teacherMission);
    }

    if (wsRaw) {
      const parsedWS = JSON.parse(wsRaw);
      if (parsedWS && typeof parsedWS === "object") worldState = parsedWS;
    }

    if (chRaw) {
      const parsedCh = JSON.parse(chRaw);
      if (Array.isArray(parsedCh)) chapterTexts = parsedCh;
    }
  } catch (e) {
    console.warn("Kunde inte läsa från localStorage:", e);
  }
}

function saveToLocalStorage() {
  try {
    if (teacherMission) localStorage.setItem(LS_MISSION_KEY, JSON.stringify(teacherMission));
    localStorage.setItem(LS_WORLDSTATE_KEY, JSON.stringify(worldState));
    localStorage.setItem(LS_CHAPTERTEXTS_KEY, JSON.stringify(chapterTexts));
  } catch (e) {
    console.warn("Kunde inte spara till localStorage:", e);
  }
}

// ---------- Lärarläge ----------
function fillTeacherForm(mission) {
  const topicInput = document.getElementById("topic-input");
  const factsInput = document.getElementById("facts-input");
  const goalsInput = document.getElementById("goals-input");
  const gradeSelect = document.getElementById("grade-select");
  const styleSelect = document.getElementById("style-select");
  const interactionCheckbox = document.getElementById("interaction-checkbox");

  topicInput.value = mission.topic || "";
  factsInput.value = (mission.facts || []).join("\n");
  goalsInput.value = (mission.learning_goals || []).join("\n");
  gradeSelect.value = mission.grade_level || "";
  styleSelect.value = mission.story_style || "äventyrlig";
  interactionCheckbox.checked = !!mission.requires_interaction;

  // (valfria fält om du har dem i UI)
  const maxCh = document.getElementById("max-chapters");
  if (maxCh && typeof mission.max_chapters === "number") maxCh.value = String(mission.max_chapters);

  const lenSel = document.getElementById("chapter-length");
  if (lenSel && mission.chapter_length) lenSel.value = mission.chapter_length;
}

function onSaveMissionClicked() {
  const topicInput = document.getElementById("topic-input");
  const factsInput = document.getElementById("facts-input");
  const goalsInput = document.getElementById("goals-input");
  const gradeSelect = document.getElementById("grade-select");
  const styleSelect = document.getElementById("style-select");
  const interactionCheckbox = document.getElementById("interaction-checkbox");
  const statusEl = document.getElementById("teacher-status");

  statusEl.textContent = "";
  statusEl.classList.remove("error");

  const topic = (topicInput.value || "").trim();
  const facts = (factsInput.value || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const learningGoals = (goalsInput.value || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const gradeLevel = gradeSelect.value;
  const storyStyle = styleSelect.value || "äventyrlig";
  const requiresInteraction = interactionCheckbox.checked;

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

  // Valfria fält (om du har dem i HTML)
  const maxChEl = document.getElementById("max-chapters");
  const maxChapters = maxChEl ? parseInt(maxChEl.value, 10) : NaN;

  const lengthEl = document.getElementById("chapter-length");
  const chapterLength = lengthEl ? (lengthEl.value || "normal") : "normal";

  // Bonusfakta: demo-on/off (om du vill)
  const enrichEl = document.getElementById("allow-enrichment");
  const allowEnrichment = enrichEl ? !!enrichEl.checked : true; // default true i demo

  teacherMission = {
    topic,
    facts,
    learning_goals: learningGoals,
    grade_level: gradeLevel,
    story_style: storyStyle,
    requires_interaction: requiresInteraction,

    // extras (backend v1.3 kan använda dem)
    max_chapters: Number.isFinite(maxChapters) && maxChapters > 0 ? maxChapters : undefined,
    chapter_length: chapterLength,
    allow_enrichment: allowEnrichment
  };

  // Nollställ story för ny lektion
  worldState = { chapterIndex: 0, previousChapters: [] };
  chapterTexts = [];

  saveToLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChapterUI();

  statusEl.textContent = "Lektionsuppdrag sparat. Elevläge är redo.";
}

function renderSavedMission() {
  const container = document.getElementById("saved-mission");
  container.innerHTML = "";

  if (!teacherMission) return;

  const h3 = document.createElement("h3");
  h3.textContent = "Aktivt lektionsuppdrag";
  container.appendChild(h3);

  const p = document.createElement("p");
  p.textContent = `${teacherMission.topic} – Åk ${teacherMission.grade_level}, stil: ${teacherMission.story_style}`;
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
  p2.innerHTML = `<strong>Årskurs:</strong> ${teacherMission.grade_level} &nbsp; <strong>Stil:</strong> ${teacherMission.story_style}`;
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

// Kapitel UI (dropdown + text)
function renderChapterUI(selected = "latest") {
  const chapterSelect = document.getElementById("chapter-select");
  const chapterInfo = document.getElementById("chapter-info");
  const storyEl = document.getElementById("story-output");

  if (!chapterSelect || !chapterInfo || !storyEl) return;

  const hasChapters = chapterTexts.length > 0;

  // Build dropdown
  chapterSelect.innerHTML = "";

  const latestOpt = document.createElement("option");
  latestOpt.value = "latest";
  latestOpt.textContent = hasChapters ? `Senaste (Kapitel ${chapterTexts.length})` : "Inga kapitel än";
  chapterSelect.appendChild(latestOpt);

  chapterTexts.forEach((ch, idx) => {
    const opt = document.createElement("option");
    opt.value = String(ch.chapterIndex);
    opt.textContent = `Kapitel ${ch.chapterIndex}`;
    chapterSelect.appendChild(opt);
  });

  if (!hasChapters) {
    chapterInfo.textContent = "";
    storyEl.textContent = "";
    chapterSelect.value = "latest";
    return;
  }

  let chosen = null;

  if (selected === "latest" || !selected) {
    chosen = chapterTexts[chapterTexts.length - 1];
    chapterSelect.value = "latest";
  } else {
    const wanted = parseInt(selected, 10);
    chosen = chapterTexts.find((x) => x.chapterIndex === wanted) || chapterTexts[chapterTexts.length - 1];
    chapterSelect.value = chosen ? String(chosen.chapterIndex) : "latest";
  }

  storyEl.textContent = chosen?.text || "";
  chapterInfo.textContent = `Visar kapitel ${chosen?.chapterIndex || "?"} av ${chapterTexts.length}`;
}

function upsertChapterText(chapterIndex, text) {
  const idx = chapterTexts.findIndex((c) => c.chapterIndex === chapterIndex);
  if (idx >= 0) chapterTexts[idx] = { chapterIndex, text };
  else chapterTexts.push({ chapterIndex, text });

  // sortera i ordning (för säkerhets skull)
  chapterTexts.sort((a, b) => a.chapterIndex - b.chapterIndex);
}

async function onGenerateChapterClicked() {
  const statusEl = document.getElementById("student-status");
  const questionsEl = document.getElementById("questions-output");
  const metaEl = document.getElementById("chapter-meta");
  const btn = document.getElementById("generate-chapter-btn");
  const promptInput = document.getElementById("student-prompt-input");

  statusEl.textContent = "";
  statusEl.classList.remove("error");

  if (!teacherMission) {
    statusEl.textContent = "Ingen lektionsplan är vald. Låt läraren skapa ett uppdrag först.";
    statusEl.classList.add("error");
    return;
  }

  const studentPrompt = (promptInput.value || "").trim();

  if (!studentPrompt && worldState.chapterIndex === 0) {
    statusEl.textContent = "Skriv en idé eller prompt för första kapitlet.";
    statusEl.classList.add("error");
    return;
  }

  btn.disabled = true;
  showSpinner(true);

  btn.textContent = worldState.chapterIndex === 0 ? "Skapar första kapitlet..." : "Skapar nästa kapitel...";

  // rensa visning
  questionsEl.innerHTML = "";
  metaEl.textContent = "";

  try {
    const payload = {
      teacher_mission: teacherMission,
      student_prompt: studentPrompt,
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

    // uppdatera state
    worldState = data.worldstate || worldState;
    worldState.chapterIndex = data.chapterIndex ?? worldState.chapterIndex;

    // spara kapiteltext (det du tappade!)
    const chapText = data.chapterText || "";
    upsertChapterText(worldState.chapterIndex, chapText);

    saveToLocalStorage();

    // visa kapitelinfo
    metaEl.textContent = `Kapitel ${data.chapterIndex}`;

    // rendera kapitel + dropdown
    renderChapterUI("latest");

    // reflektionsfrågor
    const questions = data.reflectionQuestions || [];
    if (questions.length > 0) {
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

    // knapptext
    btn.textContent = "Nästa kapitel";
    statusEl.textContent = "Kapitel genererat.";
  } catch (e) {
    console.error("Nätverksfel:", e);
    statusEl.textContent = "Nätverksfel. Kontrollera uppkoppling och försök igen.";
    statusEl.classList.add("error");
  } finally {
    btn.disabled = false;
    showSpinner(false);
  }
}

function onResetStoryClicked() {
  if (!confirm("Vill du rensa sagan på den här enheten?")) return;

  worldState = { chapterIndex: 0, previousChapters: [] };
  chapterTexts = [];

  saveToLocalStorage();
  renderChapterUI();

  const metaEl = document.getElementById("chapter-meta");
  const questionsEl = document.getElementById("questions-output");
  const statusEl = document.getElementById("student-status");
  const btn = document.getElementById("generate-chapter-btn");

  if (metaEl) metaEl.textContent = "";
  if (questionsEl) questionsEl.innerHTML = "";
  if (statusEl) statusEl.textContent = "Sagan är rensad.";
  if (btn) btn.textContent = "Starta första kapitlet";
}
