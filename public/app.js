// public/app.js
// BN-Skola v1.5 – kompatibel med motor v2.1: sparar minnesfält (covered_facts, beat_log, last_tail),
// "Avsluta sagan"-knapp, max 2–12 kapitel, barn/AI-segment sparas, HTML-escape, tydligare felmeddelanden.
 
let teacherMission = null;
 
let worldState = {
  chapterIndex: 0,
  summary_for_next: "",
  previousChapters: [],
  last_start_prompt: "", // sparar prompt 1 så vi vet vad som var “start”
  covered_facts: [],
  beat_log: [],
  last_tail: "",
  finished: false
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
  document.getElementById("generate-chapter-btn").addEventListener("click", () => onGenerateChapterClicked(false));
  document.getElementById("reset-story-btn").addEventListener("click", onResetStoryClicked);
 
  document.getElementById("chapter-select").addEventListener("change", renderCurrentChapter);
 
  setupMaxChaptersOptions();
  setupFinishButton();
  setupDemoMissions();
  loadFromLocalStorage();
  renderSavedMission();
  renderLessonSummary();
  renderChapterSelector();
  renderCurrentChapter();
});
 
function defaultWorldState() {
  return { chapterIndex: 0, summary_for_next: "", previousChapters: [], last_start_prompt: "", covered_facts: [], beat_log: [], last_tail: "", finished: false };
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
      if (!Array.isArray(worldState.covered_facts)) worldState.covered_facts = [];
      if (!Array.isArray(worldState.beat_log)) worldState.beat_log = [];
      if (typeof worldState.last_tail !== "string") worldState.last_tail = "";
      worldState.finished = !!worldState.finished;
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
  document.getElementById("max-chapters-select").value = String(mission.max_chapters || "6");
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
  const maxChapters = parseInt(document.getElementById("max-chapters-select").value, 10) || 6;
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
    `<p><strong>Ämne:</strong> ${escapeHtml(teacherMission.topic)}</p>` +
    `<p><strong>Årskurs:</strong> ${escapeHtml(teacherMission.grade_level)} &nbsp; ` +
    `<strong>Stil:</strong> ${escapeHtml(teacherMission.story_style)} &nbsp; ` +
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
  updateFinishButton();
 
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
 
  if (isStoryDone()) {
    btn.textContent = "Sagan är klar";
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
    questionsEl.innerHTML = `<h3>Reflektionsfrågor att diskutera:</h3><ol>${qs.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ol>`;
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
 
async function onGenerateChapterClicked(finish = false) {
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
 
  if (isStoryDone()) return fail(statusEl, "Sagan är redan klar.");
 
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
      finish: !!finish,
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
      let msg = "Fel från servern. Försök igen.";
      try {
        const e = JSON.parse(errText);
        if (e && e.error && (e.blocked || resp.status === 502)) msg = e.error;
      } catch {}
      return fail(statusEl, msg);
    }
 
    const data = await resp.json();
 
    const newIndex = data.chapterIndex;
    const chapterText = data.chapterText || "";
    const reflectionQuestions = data.reflectionQuestions || [];
    const newWs = data.worldstate || {};
 
    const segments = Array.isArray(data.segments) ? data.segments : [];
    const chapterObj = { chapterIndex: newIndex, chapterText, reflectionQuestions, segments };
 
    const nextChapters = Array.isArray(worldState.previousChapters) ? [...worldState.previousChapters] : [];
    const pos = nextChapters.findIndex(c => c.chapterIndex === newIndex);
    if (pos >= 0) nextChapters[pos] = chapterObj;
    else nextChapters.push(chapterObj);
 
    worldState = {
      ...worldState,
      chapterIndex: newIndex,
      summary_for_next: newWs.summary_for_next || "",
      previousChapters: nextChapters,
      covered_facts: Array.isArray(newWs.covered_facts) ? newWs.covered_facts : [],
      beat_log: Array.isArray(newWs.beat_log) ? newWs.beat_log : [],
      last_tail: typeof newWs.last_tail === "string" ? newWs.last_tail : "",
      finished: !!data.finished
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
    btn.disabled = isStoryDone();
    updateFinishButton();
  }
}

// ---------------------------
// Hjälpfunktioner (v1.5)
// ---------------------------
function isStoryDone() {
  const maxCh = teacherMission?.max_chapters || null;
  const n = (worldState.previousChapters || []).length;
  return !!worldState.finished || !!(maxCh && n >= maxCh);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Lärarens val av max antal kapitel: 2–12 (bygger om listan så HTML inte behöver ändras)
function setupMaxChaptersOptions() {
  const sel = document.getElementById("max-chapters-select");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = "";
  for (let n = 2; n <= 12; n++) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    sel.appendChild(opt);
  }
  sel.value = Array.from(sel.options).some((o) => o.value === current) ? current : "6";
}

// "Avsluta sagan": eleven kan välja att skriva slutkapitlet innan max nåtts
function setupFinishButton() {
  const genBtn = document.getElementById("generate-chapter-btn");
  if (!genBtn || document.getElementById("finish-story-btn")) return;
  const btn = document.createElement("button");
  btn.id = "finish-story-btn";
  btn.type = "button";
  btn.className = genBtn.className;
  btn.textContent = "Avsluta sagan";
  btn.classList.add("hidden");
  btn.addEventListener("click", () => {
    if (!confirm("Vill du skriva ett slutkapitel och avsluta sagan nu?")) return;
    onGenerateChapterClicked(true);
  });
  genBtn.insertAdjacentElement("afterend", btn);
}

function updateFinishButton() {
  const btn = document.getElementById("finish-story-btn");
  if (!btn) return;
  const n = (worldState.previousChapters || []).length;
  btn.classList.toggle("hidden", !(teacherMission && n >= 1 && !isStoryDone()));
}

// ---------------------------
// Demo-uppdrag (för presentationer): fyller i lärarformuläret med ett klick
// ---------------------------
const DEMO_MISSIONS = {
  "Grekisk mytologi (historia, åk 5)": {
    topic: "Grekisk mytologi",
    grade: "5",
    facts: [
      "Zeus är gudarnas kung och styr över himlen och blixten",
      "Poseidon är havets gud",
      "Hades härskar över underjorden, de dödas rike",
      "Enligt myterna bodde de största gudarna på berget Olympen",
      "Athena är visdomens gudinna, och staden Aten är uppkallad efter henne",
      "Hermes är gudarnas budbärare"
    ],
    goals: ["Eleven kan namnge flera grekiska gudar och säga vad de styr över"]
  },
  "Vikingatiden (historia, åk 4)": {
    topic: "Vikingatiden",
    grade: "4",
    facts: [
      "Vikingatiden varade ungefär mellan år 800 och 1050",
      "Vikingarna seglade i långskepp som var smala och snabba",
      "Birka vid Mälaren var en viktig handelsstad",
      "Vikingarna reste runstenar med runor till minne av någon",
      "Enligt vikingarnas tro var Oden den främste guden och Tor åskans gud",
      "På tinget avgjorde fria män tvister och lagar"
    ],
    goals: ["Eleven kan berätta hur vikingarna levde, reste och trodde"]
  },
  "Vattnets kretslopp (biologi/NO, åk 4)": {
    topic: "Vattnets kretslopp",
    grade: "4",
    facts: [
      "Solens värme gör att vatten från hav och sjöar avdunstar och blir vattenånga",
      "När vattenångan kyls av bildar den små vattendroppar som blir moln",
      "Från molnen faller vatten som regn eller snö",
      "Vattnet rinner i bäckar och floder tillbaka till havet och kretsloppet börjar om"
    ],
    goals: ["Eleven kan förklara vattnets kretslopp i rätt ordning"]
  },
  "Diwali (religion, åk 5)": {
    topic: "Diwali – ljusets högtid",
    grade: "5",
    facts: [
      "Diwali kallas ljusets högtid",
      "Hinduer firar Diwali genom att tända små oljelampor som kallas diyor",
      "Enligt traditionen symboliserar ljuset att det goda segrar över det onda",
      "Diwali firas oftast i oktober eller november",
      "Diwali firas även av jainer och sikher"
    ],
    goals: ["Eleven kan berätta hur och varför Diwali firas"]
  }
};

function setupDemoMissions() {
  const saveBtn = document.getElementById("save-mission-btn");
  if (!saveBtn || document.getElementById("demo-mission-select")) return;

  const wrap = document.createElement("div");
  wrap.style.margin = "0 0 12px 0";
  const label = document.createElement("label");
  label.htmlFor = "demo-mission-select";
  label.textContent = "Demo-uppdrag (fyller i formuläret)";
  label.style.display = "block";
  const sel = document.createElement("select");
  sel.id = "demo-mission-select";
  sel.appendChild(new Option("– Välj ett exempel –", ""));
  Object.keys(DEMO_MISSIONS).forEach((k) => sel.appendChild(new Option(k, k)));
  wrap.appendChild(label);
  wrap.appendChild(sel);
  saveBtn.insertAdjacentElement("beforebegin", wrap);

  sel.addEventListener("change", () => {
    const d = DEMO_MISSIONS[sel.value];
    if (!d) return;
    document.getElementById("topic-input").value = d.topic;
    document.getElementById("facts-input").value = d.facts.join("\n");
    document.getElementById("goals-input").value = d.goals.join("\n");
    const grade = document.getElementById("grade-select");
    if (!Array.from(grade.options).some((o) => o.value === d.grade)) grade.appendChild(new Option(d.grade, d.grade));
    grade.value = d.grade;
    document.getElementById("max-chapters-select").value = "4";
    document.getElementById("chapter-length-select").value = "normal";
    const statusEl = document.getElementById("teacher-status");
    statusEl.classList.remove("error");
    statusEl.textContent = "Demo-uppdrag inlagt. Klicka Spara för att aktivera.";
  });
}
