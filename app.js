/* =========================================================
   CONFIG
========================================================= */
const MODE = "prod"; // "dev" or "prod"  ← 公開前に必ず "prod" にする
const IS_DEV = MODE === "dev";
const IS_PROD = MODE === "prod";

const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw7IsZvqhWnCCKsAMkHAtQ2y1RrOCsLGscrqQntKxRx7rUuncuDjh_IS5Qau0etl5gU/exec";
const VERSION = "v1.0";

const N = 36;
const P = 1.5;
window.addEventListener("error", (e) => {
  alert("JS Error: " + (e.message || e.error || "unknown"));
});
window.addEventListener("unhandledrejection", (e) => {
  alert("Promise Error: " + (e.reason?.message || e.reason || "unknown"));
});

/* =========================================================
   DOM UTIL
========================================================= */
const $ = (id) => document.getElementById(id);

// 画面DOMは「後から取り直す」前提で let にする
let screens = {
  start: null,
  sort: null,
  result: null,
  thanks: null,
};

// DOMから画面要素を取り直す関数
function refreshScreens_() {
  screens = {
    start: $("screenStart"),
    sort: $("screenSort"),
    result: $("screenResult"),
    thanks: $("screenThanks"),
  };
}

// 画面切り替え（nullが混ざっても落ちない）
function showScreen(key) {
  // まず .screen を全部 hidden にする（IDが欠けてもこれなら確実）
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.add("hidden");
  });

  // 念のため毎回取り直す（HTML更新直後でも安定）
  refreshScreens_();

  const target = screens[key];
  if (target) {
    target.classList.remove("hidden");
  } else {
    // ここに来るのは「HTML側にそのIDが無い」時
    alert(`画面 "${key}" が見つかりません。index.html の id を確認してください。`);
  }
}

function setStatus(text = "") {
  const el = $("statusText");
  if (el) el.textContent = text;
}

/* =========================================================
   STORAGE / MODE CONTROL
========================================================= */
function getClientId() {
  const k = "nogi_sort_client_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(k, v);
  }
  return v;
}

function submittedKey_() {
  // DEVとPRODでキーを分ける（DEVで送信済みになってもPRODに影響させない）
  return IS_DEV ? "nogi_sort_submitted_dev" : "nogi_sort_submitted_prod";
}

function isSubmitted() {
  if (IS_DEV) return false; // DEVは無制限
  return localStorage.getItem(submittedKey_()) === "true";
}

function markSubmitted() {
  if (IS_DEV) return; // DEVは記録しない
  localStorage.setItem(submittedKey_(), "true");
}


/* =========================================================
   STATE
========================================================= */
let members = [];
let order = [];
let state = null;
let history = [];

/* =========================================================
   SCORING
========================================================= */
function scoreAt(rank) {
  return Math.pow((N + 1 - rank), P);
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function computeScores(groups) {
  const scores = Array(N).fill(0);
  let r = 1;
  for (const g of groups) {
    const vals = [];
    for (let i = 0; i < g.length; i++) {
      vals.push(scoreAt(r + i));
    }
    const s = avg(vals);
    g.forEach((idx) => (scores[idx] = s));
    r += g.length;
  }
  return scores;
}

/* =========================================================
   SORT LOGIC（Binary Insertion + Tie）
========================================================= */
function initSort(gender) {
  const idxs = [...Array(N).keys()];
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }

  state = {
    gender,
    startedAt: Date.now(),
    pointer: 0,
    insertOrder: idxs,
    groups: [],
    inserting: null,
    compareCount: 0,
    tieCount: 0,
  };
  history = [];
}

function beginInsert() {
  if (state.pointer >= state.insertOrder.length) {
    state.inserting = null;
    return;
  }

  const idx = state.insertOrder[state.pointer++];
  if (state.groups.length === 0) {
    state.groups.push([idx]);
    beginInsert();
    return;
  }

  state.inserting = { idx, low: 0, high: state.groups.length };
  nextCompare();
}

function nextCompare() {
  const ins = state.inserting;
  if (!ins) return;

  if (ins.low >= ins.high) {
    state.groups.splice(ins.low, 0, [ins.idx]);
    state.inserting = null;
    beginInsert();
    return;
  }
  ins.mid = Math.floor((ins.low + ins.high) / 2);
}

function currentPair() {
  const ins = state.inserting;
  if (!ins) return null;
  return {
    left: ins.idx,
    right: state.groups[ins.mid][0],
    mid: ins.mid,
    groupSize: state.groups[ins.mid].length,
  };
}

function choose(type) {
  const ins = state.inserting;
  if (!ins) return;

  history.push(JSON.parse(JSON.stringify(state)));
  state.compareCount++;

  if (type === "tie") {
    state.tieCount++;
    state.groups[ins.mid].push(ins.idx);
    state.inserting = null;
    beginInsert();
  } else if (type === "left") {
    ins.high = ins.mid;
    nextCompare();
  } else {
    ins.low = ins.mid + 1;
    nextCompare();
  }

  renderSort();
}

function undo() {
  if (!history.length) return;
  state = history.pop();
  renderSort();
}

/* =========================================================
   RENDER
========================================================= */
function renderStart() {
  if (IS_PROD && isSubmitted()) {
    showScreen("thanks");
    $("thanksText").textContent = "この端末からは既に送信済みです。";
    return;
  }
  setStatus(IS_DEV ? "DEV MODE" : "");
  showScreen("start");
}

function renderSort() {
  showScreen("sort");
  if (!state.inserting) beginInsert();

  const p = currentPair();
  if (!p) {
    renderResult();
    return;
  }

  $("imgLeft").src = members[p.left].image;
  $("nameLeft").textContent = members[p.left].name;

  $("imgRight").src = members[p.right].image;
  $("nameRight").textContent = members[p.right].name;
  // 進行度（No / % / 円リング）
  const inserted = Math.min(state.pointer, N); // 何人目まで挿入処理が進んだか
  const pct = Math.round((inserted / N) * 100);

  const noEl = $("progressNo");
  const pctEl = $("progressPct");
  const ringEl = $("progressRing");

  const q = state.compareCount + 1;
  if (noEl) noEl.textContent = `Q ${q}`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (ringEl) ringEl.style.setProperty("--p", String(pct));

}
function renderResult() {
  showScreen("result");

  const list = $("resultList");
  if (!list) return;
  list.innerHTML = "";

  let rank = 1;

  // state.groups は「同率グループ」配列: 例 [[idx, idx], [idx], ...]
  for (const g of state.groups) {
    for (const i of g) {
      const row = document.createElement("div");
      row.className = "resultRow";

      const rankEl = document.createElement("div");
      rankEl.className = "rankNum";
      rankEl.textContent = String(rank); // 「1位」ではなく数字のみ

      const nameEl = document.createElement("div");
      nameEl.className = "memberText";
      nameEl.textContent = members[i]?.name ?? "(unknown)";

      row.append(rankEl, nameEl);
      list.appendChild(row);
    }

    // 同率分だけ次の順位へ（例：1,1,3,...）
    rank += g.length;
  }

  const btnSend = $("btnSend");
  if (btnSend) {
    btnSend.disabled = IS_PROD && isSubmitted();
  }
}

async function sendResult() {
  // 送信済みガード
  if (IS_PROD && isSubmitted()) return;

  // ボタンが取れなければ、その時点で原因確定
  const btn = $("btnSend");
  if (!btn) {
    alert("btnSend が見つかりません（index.htmlのID確認）");
    return;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "送信中…";

  // ① 先に完了画面へ（ここで止まらないのが大事）
  try {
    markSubmitted();
    showScreen("thanks");
    const t = $("thanksText");
    if (t) t.textContent = "送信を受け付けました。反映まで数秒かかる場合があります。ありがとうございました。";
  } catch (e) {
    alert("Thanks画面への遷移でエラー: " + (e?.message || e));
    btn.disabled = false;
    btn.textContent = originalText;
    return;
  }

  // ② 裏で送信（ここで落ちてもUIは止めない）
  setTimeout(() => {
    try {
      // stateが無い/壊れてる場合は送れないので中断（UIは完了扱いのまま）
      if (!state || !state.groups) return;

      const payload = {
        client_id: getClientIdSafe_(),
        gender: state.gender,
        timestamp: new Date().toISOString(),
        duration_sec: Math.round((Date.now() - state.startedAt) / 1000),
        tie_count: state.tieCount,
        compare_count: state.compareCount,
        version: VERSION,
        target_sheet: IS_DEV ? "responses_test" : "responses",
        scores_in_A_order: computeScores(state.groups),
      };

      const body = JSON.stringify(payload);
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });

      // sendBeacon優先（スマホで強い）
      if (navigator.sendBeacon && navigator.sendBeacon(GAS_WEBAPP_URL, blob)) {
        return;
      }

      // フォールバック：待たない fetch
      fetch(GAS_WEBAPP_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
      }).catch(() => {});
    } catch (e) {
      // 送信側の失敗はUIを止めない（ログだけ）
      console.log("send background error:", e);
    }
  }, 0);
}


/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  // 毎回DOMを取り直してから結びつける
  refreshScreens_();

  const btnStart = $("btnStart");
  const dbg = $("debugStart");

  btnStart.addEventListener("click", () => {

    const g = document.querySelector('input[name="gender"]:checked')?.value;
    if (!g) {
      alert("性別を選択してください。");
      return;
    }

    initSort(g);
    showScreen("sort");
    renderSort();
  });

  const btnLeft = $("btnLeft");
  if (btnLeft) btnLeft.addEventListener("click", () => choose("left"));

  const btnRight = $("btnRight");
  if (btnRight) btnRight.addEventListener("click", () => choose("right"));

  const btnTie = $("btnTie");
  if (btnTie) btnTie.addEventListener("click", () => choose("tie"));

  const btnUndo = $("btnUndo");
  if (btnUndo) btnUndo.addEventListener("click", () => undo());

  const btnSend = $("btnSend");
  if (btnSend) btnSend.addEventListener("click", () => sendResult());
}


function getClientIdSafe_() {
  const k = "nogi_sort_client_id";
  let v = localStorage.getItem(k);
  if (v) return v;

  // crypto.randomUUID が無い環境でも落ちないように
  if (crypto && typeof crypto.randomUUID === "function") {
    v = crypto.randomUUID();
  } else {
    v = "cid_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  localStorage.setItem(k, v);
  return v;
}

/* =========================================================
   BOOT
========================================================= */
async function boot() {
  refreshScreens_();     // ① 画面DOM再取得
  bindEvents();          // ② ボタンにイベントを結びつける
  const res = await fetch("./members.json");
  members = await res.json();

  showScreen("start");   // ③ 最初は必ずスタート画面
}

boot();
