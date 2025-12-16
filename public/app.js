// public/app.js
// BN-Skola v1.4 – fix: prompt-styrning (fortsätt vs ny riktning) + ingen omstart vid kvarlämnad prompt

let teacherMission = null;

let worldState = {
  chapterIndex: 0,
  summary_for_next: "",
  previousChapters: [],
  last_start_prompt: "" // sparar prompt 1 så vi vet vad som var “start”
};

const LS_MISSION_KEY = "bn_school_teacher_mission_v1";
const LS_WORLDSTATE_KEY = "bn_school_worldstate_v1";

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
    renderChapterSelector();
    renderCurrentChapter();
  });

  document.getElementById("save-mission-btn").addEventListener("click", onSaveMissionClicked);
  document.getElementById("generate-chapter-btn").addEventListener("click", onGenerateChapterClicked);
  document.getElementById("reset-story-btn").addEventListener("click", onResetStoryClicked);

  document.getElementById("chapter-select").addEventListener("change", renderCurrentChapter);

  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChapterSelector();
  renderCurrentChapter();
});

function defaultWorldState() {
  return { chapterIndex: 0, summary_for_next: "", previousChapters: [], last_start_prompt: "" };
}

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
      if (!worldState || typeof worldState !== "object") worldState = defaultWorldState();
      if (!Array.isArray(worldState.previousChapters)) worldState.previousChapters = [];
      if (typeof worldState.chapterIndex !== "number") worldState.chapterIndex = 0;
      if (typeof worldState.last_start_prompt !== "string") worldState.last_start_prompt = "";
    }
  } catch (e) {
    console.warn("LS read fail:", e);
    teacherMission = null;
    worldState = defaultWorldState();
  }
}

function saveToLocalStorage() {
  try {
    if (teacherMission) localStorage.setItem(LS_MISSION_KEY, JSON.stringify(teacherMission));
    localStorage.setItem(LS_WORLDSTATE_KEY, JSON.stringify(worldState));
  } catch (e) {
    console.warn("LS save fail:", e);
  }
}

function fillTeacherForm(mission) {
  document.getElementById("topic-input").value = mission.topic || "";
  document.getElementById("facts-input").value = (mission.facts || []).join("\n");
  document.getElementById("goals-input").value = (mission.learning_goals || []).join("\n");
  document.getElementById("grade-select").value = mission.grade_level || "";
  document.getElementById("style-select").value = mission.story_style || "äventyrlig";
  document.getElementById("interaction-checkbox").checked = !!mission.requires_interaction;
  document.getElementById("max-chapters-select").value = String(mission.max_chapters || "4");
  document.getElementById("chapter-length-select").value = mission.chapter_length || "normal";
}

function prettyLen(v) {
  if (v === "kort") return "Kort";
  if (v === "lang") return "Lång";
  return "Normal";
}

function onSaveMissionClicked() {
  const statusEl = document.getElementById("teacher-status");
  statusEl.textContent = "";
  statusEl.classList.remove("error");

  const topic = (document.getElementById("topic-input").value || "").trim();
  const facts = (document.getElementById("facts-input").value || "").split("\n").map(s => s.trim()).filter(Boolean);
  const learningGoals = (document.getElementById("goals-input").value || "").split("\n").map(s => s.trim()).filter(Boolean);
  const gradeLevel = document.getElementById("grade-select").value;
  const storyStyle = document.getElementById("style-select").value || "äventyrlig";
  const requiresInteraction = document.getElementById("interaction-checkbox").checked;
  const maxChapters = parseInt(document.getElementById("max-chapters-select").value, 10) || 4;
  const chapterLength = document.getElementById("chapter-length-select").value || "normal";

  if (!topic) return fail(statusEl, "Du måste ange ett ämne.");
  if (facts.length === 0) return fail(statusEl, "Lägg till minst en faktarad.");
  if (!gradeLevel) return fail(statusEl, "Välj årskurs.");

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

  worldState = defaultWorldState();
  saveToLocalStorage();

  renderSavedMission();
  renderLessonSummary();
  renderChapterSelector();
  renderCurrentChapter();

  statusEl.textContent = "Lektionsuppdrag sparat.";
}

function fail(el, msg) {
  el.textContent = msg;
  el.classList.add("error");
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
}

function renderLessonSummary() {
  const summaryEl = document.getElementById("lesson-summary");
  summaryEl.innerHTML = "";

  if (!teacherMission) {
    summaryEl.textContent = "Ingen lektionsplan är vald ännu. Skapa ett uppdrag i Lärarläget.";
    return;
  }

  summaryEl.innerHTML =
    `<p><strong>Ämne:</strong> ${teacherMission.topic}</p>` +
    `<p><strong>Årskurs:</strong> ${teacherMission.grade_level} &nbsp; ` +
    `<strong>Stil:</strong> ${teacherMission.story_style} &nbsp; ` +
    `<strong>Längd:</strong> ${prettyLen(teacherMission.chapter_length)}</p>`;
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

  sel.value = String(chapters[chapters.length - 1].chapterIndex);
  counter.textContent = max ? `Visar kapitel ${chapters.length} av ${max}` : `Visar kapitel ${chapters.length}`;
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

  const qs = Array.isArray(chosen.reflectionQuestions) ? chosen.reflectionQuestions : [];
  if (qs.length) {
    questionsEl.innerHTML = `<h3>Reflektionsfrågor att diskutera:</h3><ol>${qs.map(q => `<li>${q}</li>`).join("")}</ol>`;
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

  if (!teacherMission) return fail(statusEl, "Ingen lektionsplan är vald.");

  const promptInput = document.getElementById("student-prompt-input");
  const useDirection = document.getElementById("use-prompt-as-direction");
  const studentName = (document.getElementById("student-name-input").value || "").trim();

  const chapters = worldState.previousChapters || [];
  const isFirst = chapters.length === 0;
  const rawPrompt = (promptInput.value || "").trim();

  const maxCh = teacherMission.max_chapters || null;
  if (maxCh && chapters.length >= maxCh) return fail(statusEl, "Max antal kapitel nått.");

  // ✅ Regler:
  // - Kapitel 1: måste ha prompt (start)
  // - Kapitel 2+: prompt ignoreras om inte "Använd som ny riktning" är ibockad
  let outgoingPrompt = "";

  if (isFirst) {
    if (!rawPrompt) return fail(statusEl, "Skriv en idé/prompt för första kapitlet.");
    outgoingPrompt = rawPrompt;
    worldState.last_start_prompt = rawPrompt;
  } else {
    if (useDirection.checked) {
      if (!rawPrompt) return fail(statusEl, "Skriv en ny prompt för att byta riktning.");
      outgoingPrompt = rawPrompt; // skickas som “ny riktning”
    } else {
      outgoingPrompt = ""; // fortsätt framåt, ingen omstart
    }
  }

  btn.disabled = true;
  setLoading(true, isFirst ? "Skapar första kapitlet…" : "Skapar nästa kapitel…");

  try {
    const payload = {
      teacher_mission: teacherMission,
      student_name: studentName,
      student_prompt: outgoingPrompt,
      prompt_mode: isFirst ? "start" : (useDirection.checked ? "direction" : "continue"),
      worldstate: worldState
    };

    const resp = await fetch("/api/bnschool_generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Server-fel:", errText);
      return fail(statusEl, "Fel från servern. Försök igen.");
    }

    const data = await resp.json();

    const newIndex = data.chapterIndex;
    const chapterText = data.chapterText || "";
    const reflectionQuestions = data.reflectionQuestions || [];
    const newWs = data.worldstate || {};

    const chapterObj = { chapterIndex: newIndex, chapterText, reflectionQuestions };

    const nextChapters = Array.isArray(worldState.previousChapters) ? [...worldState.previousChapters] : [];
    const pos = nextChapters.findIndex(c => c.chapterIndex === newIndex);
    if (pos >= 0) nextChapters[pos] = chapterObj;
    else nextChapters.push(chapterObj);

    worldState = {
      ...worldState,
      chapterIndex: newIndex,
      summary_for_next: newWs.summary_for_next || "",
      previousChapters: nextChapters
    };

    // 🔥 Viktigt: Om man använde “ny riktning”, så ska den vara one-shot:
    if (!isFirst && useDirection.checked) {
      useDirection.checked = false;
      // du får välja: antingen lämna texten kvar (som minne) eller nolla för att undvika omstartkänsla.
      // Jag nollar för att göra det idiotsäkert:
      promptInput.value = "";
    }

    saveToLocalStorage();
    renderChapterSelector();
    renderCurrentChapter();
    statusEl.textContent = "Kapitel genererat.";
  } catch (e) {
    console.error("Nätverksfel:", e);
    fail(statusEl, "Nätverksfel. Försök igen.");
  } finally {
    setLoading(false);
    btn.disabled = false;
  }
}
