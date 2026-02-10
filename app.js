/*
  PaoHuZi Trainer Starter
  - Single-page views (no folders / multi-page navigation needed)
  - PWA: manifest.json + sw.js
  - Voice: Web Speech API (speechSynthesis)
*/

const App = (() => {
  const state = {
    mode: "beginner",          // beginner | advanced
    voiceEnabled: true,
    pronunciation: "slow",     // slow | normal
    rate: 1.0,
    data: null,
    lessonIndex: 0,
    stepIndex: 0,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("phz_settings") || "{}");
      if (saved.mode) state.mode = saved.mode;
      if (typeof saved.voiceEnabled === "boolean") state.voiceEnabled = saved.voiceEnabled;
      if (saved.pronunciation) state.pronunciation = saved.pronunciation;
      if (typeof saved.rate === "number") state.rate = saved.rate;
    } catch {}
  }

  function saveSettings() {
    localStorage.setItem("phz_settings", JSON.stringify({
      mode: state.mode,
      voiceEnabled: state.voiceEnabled,
      pronunciation: state.pronunciation,
      rate: state.rate
    }));
  }

  async function loadData() {
    const res = await fetch("./data.json", {cache: "no-store"});
    state.data = await res.json();

    // defaults if nothing saved
    if (!localStorage.getItem("phz_settings")) {
      state.voiceEnabled = !!state.data.voice.defaultEnabled;
      state.pronunciation = state.data.voice.defaultPronunciation || "slow";
      state.rate = state.data.voice.defaultRate || 1.0;
      saveSettings();
    }
  }

  function setView(id) {
    $$(".view").forEach(v => v.classList.remove("active"));
    const el = $("#" + id);
    if (el) el.classList.add("active");
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2300);
  }

  // --- Voice ---
  function cancelSpeech() {
    try { window.speechSynthesis.cancel(); } catch {}
  }

  function speakBilingual({en, cn, pinyin, explain}) {
    if (!state.voiceEnabled) return;

    // Build spoken string
    const p = (state.pronunciation === "slow")
      ? `${cn}… ${pinyin}…`
      : `${cn} (${pinyin})`;

    const parts = [];
    if (en) parts.push(en);
    if (cn && pinyin) parts.push(p);
    if (explain) parts.push(explain);

    const text = parts.join(". ").replace(/\s+/g, " ").trim();
    if (!text) return;

    cancelSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = clamp(state.rate, 0.7, 1.3);

    // Try to prefer English voice; Chinese pronunciation still works reasonably on many Android voices
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const preferred = pickVoice(voices);
    if (preferred) u.voice = preferred;

    window.speechSynthesis.speak(u);
  }

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  function pickVoice(voices){
    if (!voices || !voices.length) return null;
    // Prefer en-US, else any English, else default.
    const enUS = voices.find(v => (v.lang || "").toLowerCase().startsWith("en-us"));
    if (enUS) return enUS;
    const en = voices.find(v => (v.lang || "").toLowerCase().startsWith("en"));
    return en || voices[0];
  }

  // Some browsers load voices async
  function warmVoices(){
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  // --- UI wiring ---
  function renderHome() {
    const {app} = state.data;
    $("#title").textContent = `${app.name} — ${app.name_cn}`;
    $("#subtitle").textContent = `Province: ${app.province.en} / ${app.province.cn} (${app.province.pinyin})`;

    // mode pills
    const mode = state.mode;
    $("#modePill").textContent = mode === "beginner"
      ? `Beginner / 新手 (xīnshǒu) — simple rules`
      : `Advanced / 进阶 (jìnjiē) — extra rules`;

    $("#voicePill").textContent = state.voiceEnabled
      ? `Voice: ON • ${state.pronunciation.toUpperCase()} • rate ${state.rate.toFixed(1)}x`
      : `Voice: OFF`;

    $("#startLessonBtn").onclick = () => startLesson();
    $("#settingsBtn").onclick = () => openSettings();
    $("#glossaryBtn").onclick = () => openGlossary();

    $("#speakWelcomeBtn").onclick = () => {
      speakBilingual({
        en:"Welcome to Pao Hu Zi",
        cn:"跑胡子",
        pinyin:"pǎo hú zi",
        explain:"This is the Hunan beginner course with voice guidance."
      });
      toast("Speaking…");
    };
  }

  function openSettings(){
    setView("settingsView");
    // set controls
    $("#modeSelect").value = state.mode;
    $("#voiceToggle").checked = state.voiceEnabled;
    $("#pronSelect").value = state.pronunciation;
    $("#rateSelect").value = String(state.rate);

    $("#saveSettingsBtn").onclick = () => {
      state.mode = $("#modeSelect").value;
      state.voiceEnabled = $("#voiceToggle").checked;
      state.pronunciation = $("#pronSelect").value;
      state.rate = parseFloat($("#rateSelect").value);

      saveSettings();
      renderHome();
      setView("homeView");
      toast("Saved");
      speakBilingual({
        en:"Settings saved",
        cn:"设置已保存",
        pinyin:"shè zhì yǐ bǎo cún",
        explain:"You're ready to continue."
      });
    };

    $("#backFromSettingsBtn").onclick = () => {
      setView("homeView");
    };

    $("#testVoiceBtn").onclick = () => {
      speakBilingual({
        en:"Peng",
        cn:"碰",
        pinyin:"pèng",
        explain:"Triplet from discard. Tap repeat any time."
      });
      toast("Voice test");
    };
  }

  function openGlossary(){
    setView("glossaryView");
    const list = $("#termList");
    list.innerHTML = "";
    for (const t of state.data.terms) {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-weight:800;font-size:16px;">${t.en} — ${t.cn} <span style="color:var(--muted);font-weight:700;">(${t.pinyin})</span></div>
            <div style="margin-top:6px;color:var(--muted);">${t.def}</div>
          </div>
          <button class="primary" aria-label="Speak">🔊</button>
        </div>
      `;
      div.querySelector("button").onclick = () => {
        speakBilingual({en:t.en, cn:t.cn, pinyin:t.pinyin, explain:t.def});
        toast("Speaking…");
      };
      list.appendChild(div);
    }
    $("#backFromGlossaryBtn").onclick = () => setView("homeView");
  }

  function startLesson(){
    setView("lessonView");
    state.lessonIndex = 0;
    state.stepIndex = 0;
    renderLesson();
  }

  function renderLesson(){
    const lesson = state.data.lessons[state.lessonIndex];
    const step = lesson.steps[state.stepIndex];

    $("#lessonTitle").textContent = `${lesson.title.en} — ${lesson.title.cn} (${lesson.title.pinyin})`;
    $("#lessonProgress").textContent = `Step ${state.stepIndex + 1} of ${lesson.steps.length}`;

    const say = step.say;
    $("#lessonBody").innerHTML = `
      <div class="card">
        <div style="font-size:14px;color:var(--muted);font-weight:700;">What you'll hear</div>
        <div style="margin-top:8px;font-size:18px;font-weight:900;">${say.en} — ${say.cn} <span style="color:var(--muted);font-weight:800;">(${say.pinyin})</span></div>
        <div style="margin-top:10px;color:var(--muted);line-height:1.4;">${say.explain}</div>
        <div class="row" style="margin-top:12px;">
          <button class="primary" id="speakStepBtn">🔊 Speak</button>
          <button id="repeatStepBtn">Repeat</button>
        </div>
      </div>
    `;

    $("#speakStepBtn").onclick = () => { speakBilingual(say); toast("Speaking…"); };
    $("#repeatStepBtn").onclick = () => { speakBilingual(say); toast("Repeating…"); };

    $("#nextStepBtn").disabled = (state.stepIndex >= lesson.steps.length - 1);
    $("#prevStepBtn").disabled = (state.stepIndex <= 0);

    $("#nextStepBtn").onclick = () => {
      if (state.stepIndex < lesson.steps.length - 1) {
        state.stepIndex++;
        renderLesson();
        if (state.voiceEnabled) speakBilingual(state.data.lessons[state.lessonIndex].steps[state.stepIndex].say);
      }
    };
    $("#prevStepBtn").onclick = () => {
      if (state.stepIndex > 0) {
        state.stepIndex--;
        renderLesson();
        if (state.voiceEnabled) speakBilingual(state.data.lessons[state.lessonIndex].steps[state.stepIndex].say);
      }
    };

    $("#exitLessonBtn").onclick = () => {
      setView("homeView");
      cancelSpeech();
    };

    // Auto-read on render (beginner-friendly)
    if (state.voiceEnabled) speakBilingual(say);
  }

  function initPWA(){
    // service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  async function init(){
    warmVoices();
    loadSettings();
    await loadData();
    renderHome();
    setView("homeView");
    initPWA();
  }

  return { init };
})();

window.addEventListener("DOMContentLoaded", () => App.init());
