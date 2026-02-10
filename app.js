/*
  PaoHuZi Trainer (Practice: Manual or Bots)
  - Plain HTML/CSS/JS, PWA
  - 2 or 3 players
  - Choose each opponent: Bot or Manual (pass-and-play)
  - Claims implemented for the *current claim candidate* with simple priority:
      1) Next player: Chi or Peng
      2) Other players: Peng only
    We stop at the first player in priority order who has any legal claim.
  - Bots: draw + discard randomly; they auto-pass claims for now.
*/

const App = (() => {
  const state = {
    mode: "beginner",
    voiceEnabled: true,
    pronunciation: "slow",
    rate: 1.0,
    autoRead: true,
    data: null,

    lessonIndex: 0,
    stepIndex: 0,

    game: null,
    selectedByPlayer: {}, // playerIndex -> selected hand index
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- Settings ----------
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("phz_settings") || "{}");
      if (saved.mode) state.mode = saved.mode;
      if (typeof saved.voiceEnabled === "boolean") state.voiceEnabled = saved.voiceEnabled;
      if (saved.pronunciation) state.pronunciation = saved.pronunciation;
      if (typeof saved.rate === "number") state.rate = saved.rate;
      if (typeof saved.autoRead === "boolean") state.autoRead = saved.autoRead;
    } catch {}
  }

  function saveSettings() {
    localStorage.setItem("phz_settings", JSON.stringify({
      mode: state.mode,
      voiceEnabled: state.voiceEnabled,
      pronunciation: state.pronunciation,
      rate: state.rate,
      autoRead: state.autoRead
    }));
  }

  async function loadData() {
    const res = await fetch("./data.json", {cache: "no-store"});
    state.data = await res.json();
    if (!localStorage.getItem("phz_settings")) {
      state.voiceEnabled = !!state.data.voice.defaultEnabled;
      state.pronunciation = state.data.voice.defaultPronunciation || "slow";
      state.rate = state.data.voice.defaultRate || 1.0;
      state.autoRead = (state.data.voice.defaultAutoRead !== false);
      saveSettings();
    }
  }

  // ---------- UI helpers ----------
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

  function escapeHtml(s){
    return (s ?? "").replace(/[&<>"']/g, (c)=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    })[c]);
  }

  // ---------- Voice ----------
  function cancelSpeech(){ try { window.speechSynthesis.cancel(); } catch {} }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function warmVoices(){
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  function speakBilingual({en, cn, pinyin, explain}) {
    if (!state.voiceEnabled) return;
    const p = (state.pronunciation === "slow") ? `${cn}… ${pinyin}…` : `${cn} (${pinyin})`;
    const parts = [];
    if (en) parts.push(en);
    if (cn && pinyin) parts.push(p);
    if (explain) parts.push(explain);
    const text = parts.join(". ").replace(/\s+/g," ").trim();
    if (!text) return;
    cancelSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = clamp(state.rate, 0.7, 1.3);
    window.speechSynthesis.speak(u);
  }
  function speakText(text){
    if (!state.voiceEnabled) return;
    cancelSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = clamp(state.rate, 0.7, 1.3);
    window.speechSynthesis.speak(u);
  }

  // ---------- Cards ----------
  const SMALL_CN = ["","一","二","三","四","五","六","七","八","九","十"];
  const BIG_CN   = ["","壹","贰","叁","肆","伍","陆","柒","捌","玖","拾"];
  const PINYIN = {1:"yī",2:"èr",3:"sān",4:"sì",5:"wǔ",6:"liù",7:"qī",8:"bā",9:"jiǔ",10:"shí"};

  function cardLabel(c){
    const cn = c.suit === "small" ? SMALL_CN[c.rank] : BIG_CN[c.rank];
    const en = `${c.suit === "small" ? "Small" : "Big"} ${c.rank}`;
    return {en, cn, pinyin: PINYIN[c.rank]};
  }
  function cardKey(c){ return `${c.suit}:${c.rank}`; }

  function makeDeck(){
    const deck = [];
    for (const suit of ["small","big"]) {
      for (let r=1;r<=10;r++){
        for (let k=0;k<4;k++) deck.push({suit, rank:r});
      }
    }
    for (let i=deck.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // ---------- Game ----------
  // playerTypes: ["manual","bot",...]
  function newGame({players=3, playerTypes}){
    const deck = makeDeck();
    const game = {
      players,
      dealer: 0,
      current: 0,
      phase: "dealer_discard", // dealer_discard | draw | discard | claim_window | ended
      drawPile: deck,
      discardPile: [],
      lastDiscard: null,
      hands: Array.from({length: players}, () => []),
      melds: Array.from({length: players}, () => []),
      playerTypes: playerTypes || Array.from({length:players}, (_,i)=> i===0 ? "manual" : "bot"),
      claim: null, // {claimer, options:[...], discarder}
      log: [],
    };

    for (let p=0;p<players;p++){
      const n = (p===game.dealer) ? 21 : 20;
      for (let i=0;i<n;i++) game.hands[p].push(game.drawPile.pop());
      sortHand(game.hands[p]);
    }

    game.current = game.dealer;
    pushLog(game, `Dealer is Player 1. Dealer must discard first.`);
    return game;
  }

  function sortHand(hand){
    hand.sort((a,b)=>{
      if (a.suit !== b.suit) return a.suit === "small" ? -1 : 1;
      return a.rank - b.rank;
    });
  }

  function pushLog(game, msg){
    game.log.unshift({t: Date.now(), msg});
    if (game.log.length > 60) game.log.pop();
  }

  function nextPlayer(game){
    game.current = (game.current + 1) % game.players;
  }

  function isManual(game, p){ return game.playerTypes[p] === "manual"; }
  function whoName(p){ return p===0 ? "Player 1 (You)" : `Player ${p+1}`; }

  function doDealerDiscard(game){
    game.phase = "discard";
    announceTurn(game);
    if (!isManual(game, game.current)) botDiscard(game);
  }

  function announceTurn(game){
    const p = game.current;
    const msg = `${whoName(p)} turn.`;
    pushLog(game, msg);
    if (state.autoRead) {
      speakText(`${whoName(p)} turn. ${isManual(game,p) ? "Select Draw or discard when ready." : ""}`.trim());
    }
  }

  function drawCard(game){
    if (game.drawPile.length === 0) {
      game.phase = "ended";
      pushLog(game, "Draw pile empty. Game ends.");
      speakText("Draw pile empty. Game ends.");
      return;
    }
    const c = game.drawPile.pop();
    game.hands[game.current].push(c);
    sortHand(game.hands[game.current]);
    const {en, cn, pinyin} = cardLabel(c);
    pushLog(game, `${whoName(game.current)} drew: ${en} — ${cn} (${pinyin})`);
    if (isManual(game, game.current) && state.autoRead) {
      speakBilingual({en:"Draw", cn:"摸牌", pinyin:"mō pái", explain:`${whoName(game.current)} drew ${en}. ${cn}. ${pinyin}.`});
    }
  }

  function discardCard(game, handIndex){
    const p = game.current;
    const hand = game.hands[p];
    const c = hand.splice(handIndex, 1)[0];
    sortHand(hand);
    game.discardPile.push(c);
    game.lastDiscard = c;

    const {en, cn, pinyin} = cardLabel(c);
    pushLog(game, `${whoName(p)} discarded: ${en} — ${cn} (${pinyin})`);
    if (isManual(game, p) && state.autoRead) {
      speakBilingual({en:"Discard", cn:"打牌", pinyin:"dǎ pái", explain:`${whoName(p)} discarded ${en}. ${cn}. ${pinyin}.`});
    }

    // After discard: open claim window if someone can claim
    game.phase = "claim_window";
    const claim = findNextClaim(game, p);
    game.claim = claim;

    if (claim) {
      const claimerName = whoName(claim.claimer);
      const types = [...new Set(claim.options.map(o=>o.type))].join(" / ");
      pushLog(game, `${claimerName} may claim: ${types}.`);
      if (state.autoRead) speakText(`${claimerName} may claim ${types}.`);
      // If claimer is bot: auto-pass
      if (!isManual(game, claim.claimer)) {
        pushLog(game, `${claimerName} (bot) passes.`);
        proceedAfterClaims(game, false);
      }
    } else {
      proceedAfterClaims(game, false);
    }
  }

  function proceedAfterClaims(game, claimed){
    game.claim = null;
    game.phase = "draw";
    nextPlayer(game);
    announceTurn(game);
    if (!isManual(game, game.current)) botTurn(game);
  }

  function botTurn(game){
    drawCard(game);
    game.phase = "discard";
    botDiscard(game);
  }

  function botDiscard(game){
    const hand = game.hands[game.current];
    const idx = Math.floor(Math.random()*hand.length);
    discardCard(game, idx);
  }

  // ----- Claims -----
  // priority: next player first (chi or peng), then others (peng only)
  function findNextClaim(game, discarder){
    const c = game.lastDiscard;
    if (!c) return null;

    const order = [];
    const next = (discarder + 1) % game.players;
    order.push(next);
    for (let i=1;i<game.players;i++){
      const p = (next + i) % game.players;
      if (p !== next) order.push(p);
    }

    for (const claimer of order){
      if (claimer === discarder) continue;
      const allowChi = (claimer === next);
      const opts = legalClaimsForPlayer(game, claimer, discarder, allowChi);
      if (opts.length) return {claimer, discarder, options: opts};
    }
    return null;
  }

  function legalClaimsForPlayer(game, playerIndex, discarder, allowChi){
    const c = game.lastDiscard;
    const hand = game.hands[playerIndex];
    const opts = [];

    // peng
    const matches = hand.filter(h => h.suit === c.suit && h.rank === c.rank);
    if (matches.length >= 2) opts.push({type:"peng", card:c});

    // chi
    if (allowChi){
      const chiMelds = findChiOptions(hand, c);
      for (const m of chiMelds) opts.push({type:"chi", cards:m});
    }
    return opts;
  }

  function findChiOptions(hand, discard){
    const suit = discard.suit;
    const r = discard.rank;
    const options = [];

    const suitHand = hand.filter(c => c.suit === suit);

    // run patterns containing r
    const runPatterns = [
      [r-2, r-1, r],
      [r-1, r, r+1],
      [r, r+1, r+2]
    ];
    for (const pat of runPatterns){
      if (pat.some(x => x<1 || x>10)) continue;
      const needed = pat.filter(x=>x!==r);
      const a = suitHand.find(c=>c.rank===needed[0]);
      const b = suitHand.find(c=>c.rank===needed[1] && c!==a);
      if (a && b) options.push([a, b, discard]);
    }

    // 2-7-10
    if ([2,7,10].includes(r)){
      const req = [2,7,10].filter(x=>x!==r);
      const a = suitHand.find(c=>c.rank===req[0]);
      const b = suitHand.find(c=>c.rank===req[1] && c!==a);
      if (a && b) options.push([a, b, discard]);
    }

    // dedup by ranks
    const seen = new Set();
    const out = [];
    for (const opt of options){
      const ranks = opt.map(c=>c.rank).sort((a,b)=>a-b).join("-");
      const key = `${suit}:${ranks}`;
      if (!seen.has(key)){ seen.add(key); out.push(opt); }
    }
    return out;
  }

  function claimPass(game){
    const claimer = game.claim?.claimer;
    if (claimer == null) return;
    pushLog(game, `${whoName(claimer)} passed.`);
    proceedAfterClaims(game, false);
  }

  function claimPeng(game){
    const claim = game.claim;
    if (!claim) return;
    const p = claim.claimer;
    const c = game.lastDiscard;
    if (!c) return;

    const hand = game.hands[p];
    let removed = 0;
    for (let i=hand.length-1;i>=0;i--){
      if (hand[i].suit===c.suit && hand[i].rank===c.rank){
        hand.splice(i,1); removed++;
        if (removed===2) break;
      }
    }
    sortHand(hand);
    game.melds[p].push({type:"peng", cards:[{...c},{...c},{...c}]});
    pushLog(game, `${whoName(p)} declared Peng — 碰 (pèng).`);
    if (state.autoRead) speakBilingual({en:"Peng", cn:"碰", pinyin:"pèng", explain:`${whoName(p)} claimed the discard to make three of a kind.`});
    proceedAfterClaims(game, true);
  }

  function claimChi(game, optionIndex){
    const claim = game.claim;
    if (!claim) return;
    const p = claim.claimer;
    const chiOpts = claim.options.filter(o=>o.type==="chi");
    const opt = chiOpts[optionIndex];
    if (!opt) return;

    const discard = game.lastDiscard;
    const suit = discard.suit;

    const hand = game.hands[p];
    const toRemove = opt.cards.filter(c => !(c.suit===discard.suit && c.rank===discard.rank));
    for (const r of toRemove){
      const idx = hand.findIndex(c => c.suit===suit && c.rank===r.rank);
      if (idx>=0) hand.splice(idx,1);
    }
    sortHand(hand);
    game.melds[p].push({type:"chi", cards: opt.cards.map(c=>({...c}))});
    const ranks = opt.cards.map(c=>c.rank).sort((a,b)=>a-b).join("-");
    pushLog(game, `${whoName(p)} declared Chi — 吃 (chī): ${ranks} (${suit}).`);
    if (state.autoRead) speakBilingual({en:"Chi", cn:"吃", pinyin:"chī", explain:`${whoName(p)} claimed the discard to make a sequence.`});
    proceedAfterClaims(game, true);
  }

  // ---------- Hu check (same simple solver) ----------
  function canHuFromHand(hand){
    const counts = new Map();
    for (const c of hand){
      const k = cardKey(c);
      counts.set(k, (counts.get(k)||0)+1);
    }
    function getCount(suit, rank){ return counts.get(`${suit}:${rank}`) || 0; }
    function dec(suit, rank, n=1){ counts.set(`${suit}:${rank}`, getCount(suit,rank)-n); }
    function inc(suit, rank, n=1){ counts.set(`${suit}:${rank}`, getCount(suit,rank)+n); }

    function findNext(){
      for (const suit of ["small","big"]){
        for (let r=1;r<=10;r++){
          const v = getCount(suit,r);
          if (v>0) return {suit, r, v};
        }
      }
      return null;
    }

    function dfs(){
      const nxt = findNext();
      if (!nxt) return true;
      const {suit, r, v} = nxt;

      if (v>=3){
        dec(suit,r,3); if (dfs()) return true; inc(suit,r,3);
      }
      if (r<=8 && getCount(suit,r+1)>0 && getCount(suit,r+2)>0){
        dec(suit,r,1); dec(suit,r+1,1); dec(suit,r+2,1);
        if (dfs()) return true;
        inc(suit,r,1); inc(suit,r+1,1); inc(suit,r+2,1);
      }
      if (getCount(suit,2)>0 && getCount(suit,7)>0 && getCount(suit,10)>0){
        // allow 2-7-10 always if present; cheap and works for our training
        if ([2,7,10].includes(r)){
          dec(suit,2,1); dec(suit,7,1); dec(suit,10,1);
          if (dfs()) return true;
          inc(suit,2,1); inc(suit,7,1); inc(suit,10,1);
        }
      }
      return false;
    }
    return dfs();
  }

  // ---------- Rendering ----------
  function renderHome() {
    const {app} = state.data;
    $("#title").textContent = `${app.name} — ${app.name_cn}`;
    $("#subtitle").textContent = `Province: ${app.province.en} / ${app.province.cn} (${app.province.pinyin})`;

    $("#modePill").textContent = state.mode === "beginner"
      ? `Beginner / 新手 (xīnshǒu) — simple rules`
      : `Advanced / 进阶 (jìnjiē) — extra rules (coming soon)`;

    $("#voicePill").textContent = state.voiceEnabled
      ? `Voice: ON • ${state.pronunciation.toUpperCase()} • rate ${state.rate.toFixed(1)}x`
      : `Voice: OFF`;

    $("#playBtn").onclick = () => openGameSetup();
    $("#startLessonBtn").onclick = () => startLesson();
    $("#glossaryBtn").onclick = () => openGlossary();
    $("#settingsBtn").onclick = () => openSettings();
  }

  function openSettings(){
    setView("settingsView");
    $("#modeSelect").value = state.mode;
    $("#voiceToggle").checked = state.voiceEnabled;
    $("#autoReadToggle").checked = state.autoRead;
    $("#pronSelect").value = state.pronunciation;
    $("#rateSelect").value = String(state.rate);

    $("#saveSettingsBtn").onclick = () => {
      state.mode = $("#modeSelect").value;
      state.voiceEnabled = $("#voiceToggle").checked;
      state.autoRead = $("#autoReadToggle").checked;
      state.pronunciation = $("#pronSelect").value;
      state.rate = parseFloat($("#rateSelect").value);
      saveSettings();
      renderHome();
      setView("homeView");
      toast("Saved");
      speakBilingual({en:"Settings saved", cn:"设置已保存", pinyin:"shè zhì yǐ bǎo cún", explain:"You're ready to continue."});
    };

    $("#testVoiceBtn").onclick = () => {
      speakBilingual({en:"Peng", cn:"碰", pinyin:"pèng", explain:"Triplet from discard."});
      toast("Voice test");
    };

    $("#backFromSettingsBtn").onclick = () => setView("homeView");
  }

  function openGlossary(){
    setView("glossaryView");
    const list = $("#termList");
    list.innerHTML = "";
    for (const t of state.data.terms){
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-weight:800;font-size:16px;">${escapeHtml(t.en)} — ${escapeHtml(t.cn)} <span style="color:var(--muted);font-weight:700;">(${escapeHtml(t.pinyin)})</span></div>
            <div style="margin-top:6px;color:var(--muted);">${escapeHtml(t.def)}</div>
          </div>
          <button class="primary">🔊</button>
        </div>
      `;
      div.querySelector("button").onclick = () => speakBilingual({en:t.en, cn:t.cn, pinyin:t.pinyin, explain:t.def});
      list.appendChild(div);
    }
    $("#backFromGlossaryBtn").onclick = () => setView("homeView");
  }

  // ---------- Lessons ----------
  function startLesson(){
    setView("lessonView");
    state.lessonIndex = 0;
    state.stepIndex = 0;
    renderLesson();
  }

  function renderLesson(){
    const lesson = state.data.lessons[state.lessonIndex];
    const step = lesson.steps[state.stepIndex];
    const say = step.say;

    $("#lessonTitle").textContent = `${lesson.title.en} — ${lesson.title.cn} (${lesson.title.pinyin})`;
    $("#lessonProgress").textContent = `Step ${state.stepIndex+1} of ${lesson.steps.length}`;

    $("#lessonBody").innerHTML = `
      <div class="card">
        <div style="font-size:14px;color:var(--muted);font-weight:700;">What you'll hear</div>
        <div style="margin-top:8px;font-size:18px;font-weight:900;">${escapeHtml(say.en)} — ${escapeHtml(say.cn)} <span style="color:var(--muted);font-weight:800;">(${escapeHtml(say.pinyin)})</span></div>
        <div style="margin-top:10px;color:var(--muted);line-height:1.4;">${escapeHtml(say.explain)}</div>
        <div class="row" style="margin-top:12px;">
          <button class="primary" id="speakStepBtn">🔊 Speak</button>
          <button id="repeatStepBtn">Repeat</button>
        </div>
      </div>
    `;
    $("#speakStepBtn").onclick = () => speakBilingual(say);
    $("#repeatStepBtn").onclick = () => speakBilingual(say);

    $("#nextStepBtn").disabled = (state.stepIndex >= lesson.steps.length-1);
    $("#prevStepBtn").disabled = (state.stepIndex <= 0);

    $("#nextStepBtn").onclick = () => { if (state.stepIndex < lesson.steps.length-1) { state.stepIndex++; renderLesson(); } };
    $("#prevStepBtn").onclick = () => { if (state.stepIndex > 0) { state.stepIndex--; renderLesson(); } };

    $("#exitLessonBtn").onclick = () => { setView("homeView"); cancelSpeech(); };

    if (state.voiceEnabled && state.autoRead) speakBilingual(say);
  }

  // ---------- Game setup ----------
  function openGameSetup(){
    setView("gameSetupView");
    $("#playersSelect").value = "3";
    renderPlayerTypeSelectors();
    $("#playersSelect").onchange = () => renderPlayerTypeSelectors();

    $("#startGameBtn").onclick = () => {
      const players = parseInt($("#playersSelect").value, 10);
      const types = ["manual"]; // Player 1 always manual
      for (let p=1;p<players;p++){
        const sel = $(`#ptype_${p}`);
        types.push(sel ? sel.value : "bot");
      }
      startGame(players, types);
    };

    $("#backFromGameSetupBtn").onclick = () => setView("homeView");
  }

  function renderPlayerTypeSelectors(){
    const players = parseInt($("#playersSelect").value, 10);
    const wrap = $("#playerTypesWrap");
    wrap.innerHTML = "";
    for (let p=1;p<players;p++){
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div class="kv">
          <div class="k">Player ${p+1}</div>
          <div>
            <select id="ptype_${p}">
              <option value="bot" selected>Bot</option>
              <option value="manual">Manual</option>
            </select>
          </div>
        </div>
      `;
      wrap.appendChild(div);
    }
  }

  // ---------- Game ----------
  function startGame(players, playerTypes){
    state.game = newGame({players, playerTypes});
    state.selectedByPlayer = {};
    setView("gameView");
    renderGame();

    if (state.game.phase === "dealer_discard") {
      doDealerDiscard(state.game);
      renderGame();
    }
  }

  function renderGame(){
    const game = state.game;
    if (!game) return;

    $("#gameInfo").textContent = `${game.players} players • Dealer: Player ${game.dealer+1} • Types: ` +
      game.playerTypes.map((t,i)=>`P${i+1}:${t}`).join("  ");
    $("#gamePhase").textContent = `Phase: ${game.phase.replaceAll("_"," ")}`;
    $("#activePlayer").textContent = `Active: ${whoName(game.current)}`;

    // piles
    $("#drawCount").textContent = `${game.drawPile.length}`;
    const ld = game.lastDiscard;
    if (ld){
      const {en, cn, pinyin} = cardLabel(ld);
      $("#lastDiscard").innerHTML = `<div style="font-weight:900;">${escapeHtml(en)}</div><div style="font-size:22px;font-weight:900;margin-top:6px;">${escapeHtml(cn)}</div><div style="color:var(--muted);font-weight:800;margin-top:6px;">(${escapeHtml(pinyin)})</div>`;
    } else {
      $("#lastDiscard").innerHTML = `<div style="color:var(--muted);">None</div>`;
    }

    // opponent summary
    const opp = [];
    for (let p=0;p<game.players;p++){
      if (p===game.current) continue;
      opp.push(`<div class="pill">P${p+1} (${game.playerTypes[p]}): ${game.hands[p].length} cards • melds ${game.melds[p].length}</div>`);
    }
    $("#opponentsRow").innerHTML = opp.join("");

    // active player's melds
    const meldWrap = $("#activeMelds");
    meldWrap.innerHTML = "";
    for (const m of game.melds[game.current]){
      const div = document.createElement("div");
      div.className = "meld";
      const label = m.type.toUpperCase();
      const minis = m.cards.map(c=>{
        const {en, cn} = cardLabel(c);
        const cls = c.suit==="big" ? "mini big" : "mini";
        return `<div class="${cls}"><div class="en">${escapeHtml(en)}</div><div class="cn">${escapeHtml(cn)}</div></div>`;
      }).join("");
      div.innerHTML = `<div class="label">${label}</div><div class="cards">${minis}</div>`;
      meldWrap.appendChild(div);
    }

    // active hand (only show if manual; bots stay hidden)
    const activeHandWrap = $("#activeHand");
    activeHandWrap.innerHTML = "";
    const showHand = isManual(game, game.current);
    $("#handTitle").textContent = showHand ? `${whoName(game.current)} Hand (tap to select)` : `${whoName(game.current)} Hand (bot hidden)`;

    if (showHand){
      const hand = game.hands[game.current];
      const selected = state.selectedByPlayer[game.current] ?? null;
      for (let i=0;i<hand.length;i++){
        const c = hand[i];
        const {en, cn, pinyin} = cardLabel(c);
        const tile = document.createElement("div");
        tile.className = `tile ${c.suit}`;
        if (selected === i) tile.classList.add("selected");
        tile.innerHTML = `<div class="en">${escapeHtml(en)}</div><div class="cn">${escapeHtml(cn)}</div><div class="py">(${escapeHtml(pinyin)})</div>`;
        tile.onclick = () => {
          state.selectedByPlayer[game.current] = i;
          renderGame();
          speakBilingual({en, cn, pinyin, explain:""});
        };
        activeHandWrap.appendChild(tile);
      }
    }

    // Claims panel
    const claimPanel = $("#claimPanel");
    if (game.phase === "claim_window" && game.claim){
      claimPanel.style.display = "block";
      const cl = game.claim.claimer;
      $("#claimerLabel").textContent = `Claim decision: ${whoName(cl)}`;
      const opts = game.claim.options;
      const canPeng = opts.some(o=>o.type==="peng");
      const chiOpts = opts.filter(o=>o.type==="chi");

      $("#passBtn").disabled = !isManual(game, cl);
      $("#pengBtn").disabled = !(isManual(game, cl) && canPeng);
      $("#chiBtn").disabled  = !(isManual(game, cl) && chiOpts.length);

      const chiSel = $("#chiSelect");
      if (chiOpts.length > 1){
        chiSel.style.display = "inline-block";
        chiSel.innerHTML = chiOpts.map((o,idx)=>{
          const ranks = o.cards.map(c=>c.rank).sort((a,b)=>a-b).join("-");
          const suit = o.cards[0].suit;
          return `<option value="${idx}">${suit} ${ranks}</option>`;
        }).join("");
      } else {
        chiSel.style.display = "none";
        chiSel.innerHTML = "";
      }
    } else {
      claimPanel.style.display = "none";
    }

    // Controls
    const manualTurn = isManual(game, game.current);
    $("#drawBtn").disabled = !(manualTurn && game.phase === "draw");
    const selIdx = state.selectedByPlayer[game.current] ?? null;
    $("#discardBtn").disabled = !(manualTurn && game.phase === "discard" && selIdx !== null);
    $("#checkHuBtn").disabled = !(manualTurn && game.phase !== "ended");

    // log
    $("#logBox").innerHTML = game.log.map(x=>escapeHtml(x.msg)).join("<br/>");

    // Wire buttons
    $("#drawBtn").onclick = () => {
      drawCard(game);
      game.phase = "discard";
      state.selectedByPlayer[game.current] = null;
      pushLog(game, `${whoName(game.current)}: select a card to discard.`);
      if (state.autoRead) speakText("Select a card to discard.");
      renderGame();
    };

    $("#discardBtn").onclick = () => {
      const idx = state.selectedByPlayer[game.current];
      discardCard(game, idx);
      state.selectedByPlayer[game.current] = null;
      renderGame();
    };

    $("#checkHuBtn").onclick = () => {
      const ok = canHuFromHand(game.hands[game.current]);
      if (ok){
        pushLog(game, `${whoName(game.current)} can Hu — 胡 (hú)! (Practice check)`);
        speakBilingual({en:"Hu", cn:"胡", pinyin:"hú", explain:`${whoName(game.current)} can win with valid sets.`});
      } else {
        pushLog(game, `${whoName(game.current)} not ready to Hu.`);
        speakText("Not ready to win yet.");
      }
      renderGame();
    };

    // Claim actions
    $("#passBtn").onclick = () => { claimPass(game); renderGame(); };
    $("#pengBtn").onclick = () => { claimPeng(game); renderGame(); };
    $("#chiBtn").onclick  = () => {
      const chiSel = $("#chiSelect");
      const idx = (chiSel.style.display === "inline-block") ? parseInt(chiSel.value,10) : 0;
      claimChi(game, idx);
      renderGame();
    };

    $("#exitGameBtn").onclick = () => { state.game=null; cancelSpeech(); setView("homeView"); };
  }

  // ---------- PWA ----------
  function initPWA(){
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
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
