// public/app.js
// BN-Skola v1.1 – frontend-logik (minimal diff på din fungerande bas)
// + Rensa saga
// + Spara kapitel lokalt + dropdown för att visa tidigare kapitel
// + Elevläge uppdateras direkt när läraren sparar (årskurs/stil/mål)
// + (valfritt) lärarstyrning: max kapitel + längd skickas till backend (bakåtkompatibelt)

let teacherMission = null;
let worldState = {
  chapterIndex: 0,
  previousChapters: []
};

// LocalStorage keys
const LS_MISSION_KEY = "bn_school_teacher_mission_v1";
const LS_WORLDSTATE_KEY = "bn_school_worldstate_v1";
const LS_CHAPTERS_KEY = "bn_school_chapters_v1"; // NYTT: kapiteltexter + frågor

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
    renderChapterDropdown();
    renderSelectedChapter("latest");
  });

  // Lärarform
  const saveMissionBtn = document.getElementById("save-mission-btn");
  saveMissionBtn.addEventListener("click", onSaveMissionClicked);

  // Elevknapp
  const generateChapterBtn = document.getElementById("generate-chapter-btn");
  generateChapterBtn.addEventListener("click", onGenerateChapterClicked);

  // Rensa saga (både lärar- och elevknapp)
  const resetTeacherBtn = document.getElementById("reset-story-btn-teacher");
  const resetStudentBtn = document.getElementById("reset-story-btn-student");
  if (resetTeacherBtn) resetTeacherBtn.addEventListener("click", onResetStoryClicked);
  if (resetStudentBtn) resetStudentBtn.addEventListener("click", onResetStoryClicked);

  // Kapitel-dropdown
  const chapterSelect = document.getElementById("chapter-select");
  if (chapterSelect) {
    chapterSelect.addEventListener("change", (e) => {
      renderSelectedChapter(e.target.value);
    });
  }

  // Ladda localStorage
  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChapterDropdown();
  renderSelectedChapter("latest");
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

function getSavedChapters() {
  try {
    const raw = localStorage.getItem(LS_CHAPTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChapters(chapters) {
  try {
    localStorage.setItem(LS_CHAPTERS_KEY, JSON.stringify(chapters));
  } catch (e) {
    console.warn("Kunde inte spara kapitel:", e);
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

  const maxChSel = document.getElementById("max-chapters-select");
  const lenSel = document.getElementById("length-select");

  topicInput.value = mission.topic || "";
  factsInput.value = (mission.facts || []).join("\n");
  goalsInput.value = (mission.learning_goals || []).join("\n");
  gradeSelect.value = mission.grade_level || "";
  styleSelect.value = mission.story_style || "äventyrlig";
  interactionCheckbox.checked = !!mission.requires_interaction;

  // Bakåtkompatibelt (om gamla mission saknar dessa)
  if (maxChSel) maxChSel.value = String(mission.max_chapters || "4");
  if (lenSel) lenSel.value = String(mission.chapter_length || "kort");
}

function onSaveMissionClicked() {
  const topicInput = document.getElementById("topic-input");
  const factsInput = document.getElementById("facts-input");
  const goalsInput = document.getElementById("goals-input");
  const gradeSelect = document.getElementById("grade-select");
  const styleSelect = document.getElementById("style-select");
  const interactionCheckbox = document.getElementById("interaction-checkbox");
  const statusEl = document.getElementById("teacher-status");

  const maxChSel = document.getElementById("max-chapters-select");
  const lenSel = document.getElementById("length-select");

  statusEl.textContent = "";
  statusEl.classList.remove("error");

  const topic = (topicInput.value || "").trim();
  const facts = (factsInput.value || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const learningGoals = (goalsInput.value || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const gradeLevel = gradeSelect.value;
  const storyStyle = styleSelect.value || "äventyrlig";
  const requiresInteraction = interactionCheckbox.checked;

  const maxChapters = maxChSel ? parseInt(maxChSel.value, 10) : 4;
  const chapterLength = lenSel ? lenSel.value : "kort";

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

    // NYTT (bakåtkompatibelt, backend kan ignorera om du inte uppdaterar den)
    max_chapters: Number.isFinite(maxChapters) ? maxChapters : 4,
    chapter_length: chapterLength || "kort"
  };

  // Nollställ worldstate för ny lektion + rensa kapitelhistorik
  resetStoryState({ keepMission: true });

  saveToLocalStorage();
  renderSavedMission();
  renderLessonSummary();     // <-- viktig: uppdatera elevläge direkt
  renderChapterDropdown();
  renderSelectedChapter("latest");

  statusEl.textContent = "Lektionsuppdrag sparat (ny saga startad).";
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

  const p2 = document.createElement("p");
  p2.textContent = `Max kapitel: ${teacherMission.max_chapters || 4}, längd: ${teacherMission.chapter_length || "kort"}`;
  container.appendChild(p2);

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
  p1.innerHTML = `<strong>Ämne:</strong> ${escapeHtml(teacherMission.topic)}`;
  summaryEl.appendChild(p1);

  const p2 = document.createElement("p");
  p2.innerHTML = `<strong>Årskurs:</strong> ${escapeHtml(teacherMission.grade_level)} &nbsp; <strong>Stil:</strong> ${escapeHtml(teacherMission.story_style)}`;
  summaryEl.appendChild(p2);

  const p2b = document.createElement("p");
  p2b.innerHTML = `<strong>Max kapitel:</strong> ${escapeHtml(String(teacherMission.max_chapters || 4))} &nbsp; <strong>Längd:</strong> ${escapeHtml(String(teacherMission.chapter_length || "kort"))}`;
  summaryEl.appendChild(p2b);

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

function renderChapterDropdown() {
  const chapterSelect = document.getElementById("chapter-select");
  if (!chapterSelect) return;

  const chapters = getSavedChapters();
  chapterSelect.innerHTML = "";

  const latestOpt = document.createElement("option");
  latestOpt.value = "latest";
  latestOpt.textContent = chapters.length ? `Senaste (Kapitel ${chapters[chapters.length - 1].chapterIndex})` : "Senaste";
  chapterSelect.appendChild(latestOpt);

  chapters.forEach((ch) => {
    const opt = document.createElement("option");
    opt.value = String(ch.chapterIndex);
    opt.textContent = `Kapitel ${ch.chapterIndex}`;
    chapterSelect.appendChild(opt);
  });

  chapterSelect.value = "latest";
}

function renderSelectedChapter(which) {
  const storyEl = document.getElementById("story-output");
  const questionsEl = document.getElementById("questions-output");
  const metaEl = document.getElementById("chapter-meta");

  if (!storyEl || !questionsEl || !metaEl) return;

  const chapters = getSavedChapters();
  if (!chapters.length) {
    metaEl.textContent = "";
    storyEl.textContent = "";
    questionsEl.innerHTML = "";
    return;
  }

  let chosen = null;

  if (which === "latest") {
    chosen = chapters[chapters.length - 1];
  } else {
    const idx = parseInt(which, 10);
    chosen = chapters.find((c) => c.chapterIndex === idx) || chapters[chapters.length - 1];
  }

  metaEl.textContent = `Kapitel ${chosen.chapterIndex}`;
  storyEl.textContent = chosen.chapterText || "(Inget kapitel returnerades)";

  questionsEl.innerHTML = "";
  const questions = chosen.reflectionQuestions || [];
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

  // Frontend-stop: max kapitel (så UI säger stopp även om backend är gammal)
  const maxCh = parseInt(teacherMission.max_chapters || 4, 10);
  if (Number.isFinite(maxCh) && worldState.chapterIndex >= maxCh) {
    statusEl.textContent = `Stopp: läraren har satt max ${maxCh} kapitel. Klicka “Rensa saga” för ny berättelse.`;
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
  btn.textContent = worldState.chapterIndex === 0 ? "Skapar första kapitlet..." : "Skapar nästa kapitel...";

  // Nollställ visning (vi kommer ändå rendera efter svar)
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
      headers: { "Content-Type": "application/json" },
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

    // Uppdatera worldstate (räknare + summary)
    worldState = data.worldstate || worldState;
    worldState.chapterIndex = data.chapterIndex ?? worldState.chapterIndex;
    saveToLocalStorage();

    // Spara kapitel lokalt (BN-Kids-känsla)
    const chapters = getSavedChapters();
    const chapterObj = {
      chapterIndex: data.chapterIndex,
      chapterText: data.chapterText || "",
      reflectionQuestions: data.reflectionQuestions || []
    };

    // undvik duplicat om man klickar om
    const existsIdx = chapters.findIndex((c) => c.chapterIndex === chapterObj.chapterIndex);
    if (existsIdx >= 0) chapters[existsIdx] = chapterObj;
    else chapters.push(chapterObj);

    saveChapters(chapters);

    // Rendera
    renderChapterDropdown();
    renderSelectedChapter("latest");

    // Uppdatera knapptext
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

// ---------- Reset saga ----------

function resetStoryState({ keepMission } = { keepMission: true }) {
  worldState = { chapterIndex: 0, previousChapters: [] };

  // rensa kapitelhistorik
  try { localStorage.removeItem(LS_CHAPTERS_KEY); } catch {}

  // spara worldstate
  try { localStorage.setItem(LS_WORLDSTATE_KEY, JSON.stringify(worldState)); } catch {}

  if (!keepMission) {
    teacherMission = null;
    try { localStorage.removeItem(LS_MISSION_KEY); } catch {}
  }

  // UI reset
  const storyEl = document.getElementById("story-output");
  const questionsEl = document.getElementById("questions-output");
  const metaEl = document.getElementById("chapter-meta");
  const statusEl = document.getElementById("student-status");
  const btn = document.getElementById("generate-chapter-btn");
  const chapterSelect = document.getElementById("chapter-select");

  if (storyEl) storyEl.textContent = "";
  if (questionsEl) questionsEl.innerHTML = "";
  if (metaEl) metaEl.textContent = "";
  if (statusEl) { statusEl.textContent = "Sagan är rensad."; statusEl.classList.remove("error"); }
  if (btn) btn.textContent = "Starta första kapitlet";
  if (chapterSelect) {
    chapterSelect.innerHTML = `<option value="latest">Senaste</option>`;
    chapterSelect.value = "latest";
  }
}

function onResetStoryClicked() {
  if (!confirm("Vill du rensa sagan på den här enheten?")) return;
  resetStoryState({ keepMission: true });
  saveToLocalStorage();
  renderChapterDropdown();
  renderSelectedChapter("latest");
}

// ---------- Helpers ----------

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
