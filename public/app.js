// public/app.js
// BN-Skola v1 – frontend-logik

let teacherMission = null;
let worldState = {
  chapterIndex: 0,
  previousChapters: []
};

const LS_MISSION_KEY = "bn_school_teacher_mission_v1";
const LS_WORLDSTATE_KEY = "bn_school_worldstate_v1";

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
  });

  // Lärarform
  const saveMissionBtn = document.getElementById("save-mission-btn");
  saveMissionBtn.addEventListener("click", onSaveMissionClicked);

  // Elevknapp
  const generateChapterBtn = document.getElementById("generate-chapter-btn");
  generateChapterBtn.addEventListener("click", onGenerateChapterClicked);

  // Försök ladda befintlig data från localStorage
  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
});

// ---------- LocalStorage ----------

function loadFromLocalStorage() {
  try {
    const missionRaw = localStorage.getItem(LS_MISSION_KEY);
    const wsRaw = localStorage.getItem(LS_WORLDSTATE_KEY);

    if (missionRaw) {
      teacherMission = JSON.parse(missionRaw);
      // Fyll form-fälten
      fillTeacherForm(teacherMission);
    }

    if (wsRaw) {
      worldState = JSON.parse(wsRaw);
    }
  } catch (e) {
    console.warn("Kunde inte läsa från localStorage:", e);
  }
}

function saveToLocalStorage() {
  try {
    if (teacherMission) {
      localStorage.setItem(LS_MISSION_KEY, JSON.stringify(teacherMission));
    }
    localStorage.setItem(LS_WORLDSTATE_KEY, JSON.stringify(worldState));
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

  teacherMission = {
    topic,
    facts,
    learning_goals: learningGoals,
    grade_level: gradeLevel,
    story_style: storyStyle,
    requires_interaction: requiresInteraction
  };

  // Nollställ worldstate för ny lektion
  worldState = {
    chapterIndex: 0,
    previousChapters: []
  };

  saveToLocalStorage();
  renderSavedMission();
  renderLessonSummary();

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

async function onGenerateChapterClicked() {
  const statusEl = document.getElementById("student-status");
  const storyEl = document.getElementById("story-output");
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
  btn.textContent =
    worldState.chapterIndex === 0 ? "Skapar första kapitlet..." : "Skapar nästa kapitel...";
  storyEl.textContent = "";
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Fel från server:", errText);
      statusEl.textContent = "Fel från servern. Försök igen eller kontakta admin.";
      statusEl.classList.add("error");
      return;
    }

    const data = await resp.json();

    worldState = data.worldstate || worldState;
    worldState.chapterIndex = data.chapterIndex ?? worldState.chapterIndex;
    saveToLocalStorage();

    // Visa kapitelinfo
    metaEl.textContent = `Kapitel ${data.chapterIndex}`;

    // Visa berättelse
    storyEl.textContent = data.chapterText || "(Inget kapitel returnerades)";

    // Visa reflektionsfrågor
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

    // Uppdatera knapptexten
    btn.textContent = "Nästa kapitel";
    statusEl.textContent = "Kapitel genererat.";
  } catch (e) {
    console.error("Nätverksfel:", e);
    statusEl.textContent = "Nätverksfel. Kontrollera uppkoppling och försök igen.";
    statusEl.classList.add("error");
  } finally {
    btn.disabled = false;
  }
}
