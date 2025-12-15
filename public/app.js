// public/app.js
// BN-Skola v1.3 – frontend-logik
// Fixar:
// - Kapitel-sparning + dropdown "Visa kapitel"
// - Spinner-overlay
// - Prompt-hänger-kvar = fortsätt framåt (BN-Kids-beteende)
// - Kapitel-längd: kort/normal/lång skickas till backend via teacher_mission.chapter_length

let teacherMission = null;

let worldState = {
  chapterIndex: 0,
  previousChapters: [],
  summary_for_next: "",
  // viktig: senaste prompt vi faktiskt skickade in som "styrning"
  lastStudentPromptUsed: ""
};

const LS_MISSION_KEY = "bn_school_teacher_mission_v1";
const LS_WORLDSTATE_KEY = "bn_school_worldstate_v1";

// ---------- Helpers ----------
function $(id) { return document.getElementById(id); }

function showSpinner(show) {
  const overlay = $("spinner-overlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
  overlay.setAttribute("aria-hidden", show ? "false" : "true");
}

function setStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  // Mode-knappar
  const modeTeacherBtn = $("mode-teacher");
  const modeStudentBtn = $("mode-student");
  const teacherPanel = $("teacher-panel");
  const studentPanel = $("student-panel");

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
    renderChaptersUI();
  });

  // Lärarform
  $("save-mission-btn").addEventListener("click", onSaveMissionClicked);

  // Elevknapp
  $("generate-chapter-btn").addEventListener("click", onGenerateChapterClicked);

  // Rensa saga
  $("reset-story-btn").addEventListener("click", () => {
    if (!confirm("Vill du rensa sagan på den här enheten?")) return;
    worldState = {
      chapterIndex: 0,
      previousChapters: [],
      summary_for_next: "",
      lastStudentPromptUsed: ""
    };
    saveToLocalStorage();
    renderChaptersUI();
    $("story-output").textContent = "";
    $("questions-output").innerHTML = "";
    $("chapter-meta").textContent = "";
    setStatus($("student-status"), "Sagan rensad.");
    $("generate-chapter-btn").textContent = "Starta första kapitlet";
  });

  // Kapitelväljare
  $("chapter-select").addEventListener("change", () => {
    const val = $("chapter-select").value;
    renderChapterBySelectValue(val);
  });

  // Ladda state
  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChaptersUI();
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
      const parsed = JSON.parse(wsRaw);
      if (parsed && typeof parsed === "object") {
        worldState = {
          chapterIndex: parsed.chapterIndex || 0,
          previousChapters: Array.isArray(parsed.previousChapters) ? parsed.previousChapters : [],
          summary_for_next: typeof parsed.summary_for_next === "string" ? parsed.summary_for_next : "",
          lastStudentPromptUsed: typeof parsed.lastStudentPromptUsed === "string" ? parsed.lastStudentPromptUsed : ""
        };
      }
    }
  } catch (e) {
    console.warn("Kunde inte läsa från localStorage:", e);
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

// ---------- Lärarläge ----------
function fillTeacherForm(mission) {
  $("topic-input").value = mission.topic || "";
  $("facts-input").value = (mission.facts || []).join("\n");
  $("goals-input").value = (mission.learning_goals || []).join("\n");
  $("grade-select").value = mission.grade_level || "";
  $("style-select").value = mission.story_style || "äventyrlig";
  $("interaction-checkbox").checked = !!mission.requires_interaction;

  // nytt
  $("length-select").value = mission.chapter_length || "normal";
  if ($("maxchapters-select")) $("maxchapters-select").value = String(mission.max_chapters || 4);
}

function onSaveMissionClicked() {
  const statusEl = $("teacher-status");
  setStatus(statusEl, "");

  const topic = ($("topic-input").value || "").trim();
  const facts = ($("facts-input").value || "")
    .split("\n").map(s => s.trim()).filter(Boolean);

  const learningGoals = ($("goals-input").value || "")
    .split("\n").map(s => s.trim()).filter(Boolean);

  const gradeLevel = $("grade-select").value;
  const storyStyle = $("style-select").value || "äventyrlig";
  const requiresInteraction = $("interaction-checkbox").checked;

  const chapterLength = $("length-select").value || "normal";
  const maxChapters = parseInt(($("maxchapters-select")?.value || "4"), 10);

  if (!topic) return setStatus(statusEl, "Du måste ange ett ämne.", true);
  if (facts.length === 0) return setStatus(statusEl, "Lägg till minst en faktarad.", true);
  if (!gradeLevel) return setStatus(statusEl, "Välj årskurs.", true);

  teacherMission = {
    topic,
    facts,
    learning_goals: learningGoals,
    grade_level: gradeLevel,
    story_style: storyStyle,
    requires_interaction: requiresInteraction,
    chapter_length: chapterLength,
    max_chapters: Number.isFinite(maxChapters) ? maxChapters : 4
  };

  // Ny lektion => nollställ story
  worldState = {
    chapterIndex: 0,
    previousChapters: [],
    summary_for_next: "",
    lastStudentPromptUsed: ""
  };

  saveToLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChaptersUI();

  setStatus(statusEl, "Lektionsuppdrag sparat.");
}

function renderSavedMission() {
  const container = $("saved-mission");
  container.innerHTML = "";
  if (!teacherMission) return;

  const h3 = document.createElement("h3");
  h3.textContent = "Aktivt lektionsuppdrag";
  container.appendChild(h3);

  const p = document.createElement("p");
  p.textContent =
    `${teacherMission.topic} – Åk ${teacherMission.grade_level}, stil: ${teacherMission.story_style}, längd: ${teacherMission.chapter_length || "normal"}`;
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
  const summaryEl = $("lesson-summary");
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
  p2.innerHTML = `<strong>Årskurs:</strong> ${teacherMission.grade_level} &nbsp; <strong>Stil:</strong> ${teacherMission.story_style} &nbsp; <strong>Längd:</strong> ${teacherMission.chapter_length || "normal"}`;
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

function renderChaptersUI() {
  const select = $("chapter-select");
  const count = $("chapter-count");
  const chapters = Array.isArray(worldState.previousChapters) ? worldState.previousChapters : [];

  select.innerHTML = "";

  if (chapters.length === 0) {
    const opt = document.createElement("option");
    opt.value = "none";
    opt.textContent = "Inga kapitel ännu";
    select.appendChild(opt);
    count.textContent = "";
    return;
  }

  // senaste först-val
  const latestOpt = document.createElement("option");
  latestOpt.value = "latest";
  latestOpt.textContent = `Senaste (Kapitel ${chapters[chapters.length - 1].chapterIndex})`;
  select.appendChild(latestOpt);

  chapters.forEach((ch) => {
    const opt = document.createElement("option");
    opt.value = String(ch.chapterIndex);
    opt.textContent = `Kapitel ${ch.chapterIndex}`;
    select.appendChild(opt);
  });

  count.textContent = `Visar kapitel ${chapters[chapters.length - 1].chapterIndex} av ${chapters.length}`;

  // default: visa senaste
  select.value = "latest";
  renderChapterBySelectValue("latest");
}

function renderChapterBySelectValue(val) {
  const chapters = Array.isArray(worldState.previousChapters) ? worldState.previousChapters : [];
  const storyEl = $("story-output");
  const questionsEl = $("questions-output");
  const metaEl = $("chapter-meta");
  const count = $("chapter-count");

  if (chapters.length === 0) {
    storyEl.textContent = "";
    questionsEl.innerHTML = "";
    metaEl.textContent = "";
    count.textContent = "";
    return;
  }

  let ch;
  if (val === "latest") {
    ch = chapters[chapters.length - 1];
  } else {
    const idx = parseInt(val, 10);
    ch = chapters.find(x => x.chapterIndex === idx) || chapters[chapters.length - 1];
  }

  metaEl.textContent = `Kapitel ${ch.chapterIndex}`;
  storyEl.textContent = ch.chapterText || "(Inget kapitel returnerades)";

  questionsEl.innerHTML = "";
  const qs = Array.isArray(ch.reflectionQuestions) ? ch.reflectionQuestions : [];
  if (qs.length) {
    const h3 = document.createElement("h3");
    h3.textContent = "Reflektionsfrågor att diskutera:";
    questionsEl.appendChild(h3);

    const ol = document.createElement("ol");
    qs.forEach(q => {
      const li = document.createElement("li");
      li.textContent = q;
      ol.appendChild(li);
    });
    questionsEl.appendChild(ol);
  }

  count.textContent = `Visar kapitel ${ch.chapterIndex} av ${chapters.length}`;
}

async function onGenerateChapterClicked() {
  const statusEl = $("student-status");
  const btn = $("generate-chapter-btn");
  const promptInput = $("student-prompt-input");

  setStatus(statusEl, "");

  if (!teacherMission) return setStatus(statusEl, "Ingen lektionsplan är vald. Låt läraren skapa ett uppdrag först.", true);

  // BN-Kids-beteende:
  // - kapitel 1: prompt krävs (start)
  // - kapitel 2+: om prompten är exakt samma som senast använd => skicka tomt (fortsätt framåt)
  // - om eleven ändrar prompt => skickas som “ny riktning” EN gång, och blir nya lastStudentPromptUsed
  const rawPrompt = (promptInput.value || "").trim();

  if (worldState.chapterIndex === 0 && !rawPrompt) {
    return setStatus(statusEl, "Skriv en idé eller prompt för första kapitlet.", true);
  }

  let promptToSend = rawPrompt;

  if (worldState.chapterIndex > 0) {
    const lastUsed = (worldState.lastStudentPromptUsed || "").trim();

    // Om prompten är oförändrad (samma som senast), tolka det som “fortsätt bara”
    if (promptToSend && lastUsed && promptToSend === lastUsed) {
      promptToSend = "";
    }

    // Om prompten är tom, fortsätt bara
    if (!promptToSend) {
      // ok, fortsätt
    }
  }

  // Lås UI
  btn.disabled = true;
  $("reset-story-btn").disabled = true;
  showSpinner(true);

  try {
    btn.textContent = worldState.chapterIndex === 0 ? "Skapar första kapitlet..." : "Skapar nästa kapitel...";

    const payload = {
      teacher_mission: teacherMission,
      student_prompt: promptToSend,   // <-- här sker “BN-Kids fortsättning”
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
      return setStatus(statusEl, "Fel från servern. Försök igen.", true);
    }

    const data = await resp.json();

    // uppdatera worldstate från backend
    worldState = data.worldstate || worldState;
    worldState.chapterIndex = data.chapterIndex ?? worldState.chapterIndex;

    // Om vi faktiskt skickade en ny prompt (inte tom), spara den som “senast använda”
    if (promptToSend) {
      worldState.lastStudentPromptUsed = promptToSend;
    } else {
      // Om promptToSend var tom och vi redan har en lastStudentPromptUsed, behåll den.
      worldState.lastStudentPromptUsed = worldState.lastStudentPromptUsed || rawPrompt || "";
    }

    // Kapitel-sparning (idempotent: ersätt om samma kapitelindex råkar komma igen)
    const chapters = Array.isArray(worldState.previousChapters) ? worldState.previousChapters : [];
    const chapterObj = {
      chapterIndex: data.chapterIndex,
      chapterText: data.chapterText || "",
      reflectionQuestions: Array.isArray(data.reflectionQuestions) ? data.reflectionQuestions : []
    };

    const existsIdx = chapters.findIndex(c => c.chapterIndex === chapterObj.chapterIndex);
    if (existsIdx >= 0) chapters[existsIdx] = chapterObj;
    else chapters.push(chapterObj);

    worldState.previousChapters = chapters;

    saveToLocalStorage();

    // UI
    renderChaptersUI();
    setStatus(statusEl, "Kapitel genererat.");
    btn.textContent = "Nästa kapitel";
  } catch (e) {
    console.error("Nätverksfel:", e);
    setStatus(statusEl, "Nätverksfel. Kontrollera uppkoppling och försök igen.", true);
  } finally {
    btn.disabled = false;
    $("reset-story-btn").disabled = false;
    showSpinner(false);
  }
}
