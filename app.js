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
  done: null,
  result: null,
  submitted: null,
};

// DOMから画面要素を取り直す関数
function refreshScreens_() {
  screens = {
    start: $("screenStart"),
    sort: $("screenSort"),
    done: $("screenDone"),
    result: $("screenResult"),
    submitted: $("screenSubmitted"),
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
    alert(`画面 "${key}" が見つかりません。index.html の id を確認してください。`);
  }
}

function routeOnLoadOrOpen_() {
  if (IS_PROD && isSubmitted()) {
    showScreen("submitted");
    return true;
  }
  return false;
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
    showScreen("submitted");
    return;
  }
  setStatus(IS_DEV ? "DEV MODE" : "");
  if (routeOnLoadOrOpen_()) return;
  showScreen("start");
}

function renderSort() {
  showScreen("sort");
  if (!state.inserting) beginInsert();

  const p = currentPair();
  if (!p) {
    renderDone();
    return;
  }

  $("imgLeft").src = members[p.left].image;
  $("nameLeft").textContent = members[p.left].name;

  $("imgRight").src = members[p.right].image;
  $("nameRight").textContent = members[p.right].name;

  // 進行度（No / % / 円リング）
  const inserted = Math.min(state.pointer, N);
  const pct = Math.round((inserted / N) * 100);

  const noEl = $("progressNo");
  const pctEl = $("progressPct");
  const ringEl = $("progressRing");

  const q = state.compareCount + 1;
  if (noEl) noEl.textContent = `Q ${q}`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (ringEl) ringEl.style.setProperty("--p", String(pct));
}

function renderDone() {
  showScreen("done");
  // ここで特に描画するものが無いなら、画面切替だけでOK
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
      rankEl.textContent = String(rank);

      const nameEl = document.createElement("div");
      nameEl.className = "memberText";
      nameEl.textContent = members[i]?.name ?? "(unknown)";

      row.append(rankEl, nameEl);
      list.appendChild(row);
    }
    // 同率分だけ次の順位へ（例：1,1,3,...）
    rank += g.length;
  }
}

/* =========================================================
   SEND (最大3秒待ち用の「待てる送信」)
========================================================= */
function sleep_(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout_(promise, ms) {
  const timeout = sleep_(ms).then(() => ({ ok: false, timeout: true }));
  try {
    const res = await Promise.race([promise, timeout]);
    return res;
  } catch (e) {
    return { ok: false, error: e };
  }
}

function buildPayload_() {
  if (!state || !state.groups) return null;

  return {
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
}

// 送信：成功が「確定」したら {ok:true} を返す
// 注意：GAS側のCORS事情があるので、まずは読めるfetchを試し、ダメならbeaconで「キュー成功」を成功扱いに寄せる
async function sendResultAwaitable_() {
  // 送信済みガード
  if (IS_PROD && isSubmitted()) return { ok: true, already: true };

  const payload = buildPayload_();
  if (!payload) return { ok: false, error: new Error("state/groups が無いため送信できません") };

  const body = JSON.stringify(payload);

  // 1) 可能なら「レスポンスが読める」fetchを試す（成功確定しやすい）
  //    CORSで落ちる環境もあるので、失敗したら次へ。
  try {
    const res = await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      // CORSが通るならこれがベスト。通らない場合は例外になる。
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });

    // res.ok の判定（GASが200返す想定）
    if (res && res.ok) {
      // JSONを返しているなら読む（読めなくてもok扱い）
      try {
        const data = await res.json();
        if (data && data.status && data.status !== "success") {
          return { ok: false, error: new Error("GAS returned non-success") };
        }
      } catch (_) {
        // no-op: 読めなくても200なら成功寄りで扱う
      }
      return { ok: true, via: "fetch-cors" };
    }
  } catch (_) {
    // no-op: 次へ
  }

  // 2) sendBeacon を試す（キュー成功ならかなり強い）
  try {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    if (navigator.sendBeacon && navigator.sendBeacon(GAS_WEBAPP_URL, blob)) {
      return { ok: true, via: "beacon" };
    }
  } catch (_) {
    // no-op
  }

  // 3) 最後の手段：no-cors fetch（成功確定できないので ok:false 扱い）
  try {
    fetch(GAS_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    }).catch(() => {});
  } catch (_) {
    // no-op
  }

  return { ok: false, via: "no-cors" };
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  // 毎回DOMを取り直してから結びつける
  refreshScreens_();

  const btnStart = $("btnStart");
  btnStart.addEventListener("click", () => {
    if (IS_PROD && isSubmitted()) {
      showScreen("submitted");
      return;
    }

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

  // 「結果を見る」ボタン：送信→最大3秒待ち→結果表示
  const btnView = $("btnViewResult");
  if (btnView) {
    btnView.addEventListener("click", async () => {
      // 連打防止
      btnView.disabled = true;

      // 送信を開始して最大3秒だけ待つ（表示は増やさない方針）
      const r = await withTimeout_(sendResultAwaitable_(), 3000);

      // 画面遷移は必ず行う
      renderResult();

      // 成功が確認できた場合のみ、送信済みにする
      if (r && r.ok) {
        markSubmitted();
      } else if (r && r.timeout) {
        // 3秒で終わらなかった場合：UIは増やさないので黙って結果へ
        // 裏で1回だけ軽く再送（ベストエフォート）
        try {
          await sleep_(1200);
          const r2 = await withTimeout_(sendResultAwaitable_(), 2500);
          if (r2 && r2.ok) markSubmitted();
        } catch (_) {}
      }

      // 結果画面に行った後、ボタンは戻さない（戻る導線が無い前提）
    });
  }
}

/* =========================================================
   BOOT
========================================================= */
function preloadMemberImages_() {
  for (const m of members) {
    const img = new Image();
    img.src = m.image; // members.json に入ってるパス
  }
}

async function boot() {
  refreshScreens_();     // ① 画面DOM再取得
  bindEvents();          // ② ボタンにイベントを結びつける
  const res = await fetch("./members.json");
  members = await res.json();
  preloadMemberImages_();

  // 起動時ルーティング
  if (routeOnLoadOrOpen_()) return;

  showScreen("start");   // ③ 最初は必ずスタート画面
}

boot();
