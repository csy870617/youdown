const $ = (id) => document.getElementById(id);

const urlForm = $("url-form");
const urlInput = $("url");
const fetchBtn = $("fetch-btn");
const inputError = $("input-error");

const preview = $("preview");
const thumb = $("thumb");
const titleEl = $("title");
const uploaderEl = $("uploader");
const durationEl = $("duration");
const typeSeg = $("type-seg");
const qualityGroup = $("quality-group");
const qualitySelect = $("quality");
const downloadBtn = $("download-btn");

const progress = $("progress");
const stageEl = $("stage");
const percentEl = $("percent");
const barFill = $("bar-fill");
const progressNote = $("progress-note");

const statusEl = $("status");
const statusText = $("status-text");
const statusHint = $("status-hint");
const statusBar = $("status-bar");
const statusBarFill = $("status-bar-fill");
const statusAction = $("status-action");

let currentUrl = "";
let selectedType = "video";

// 상태 배너
// type: "loading" | "error" | "warn" | ""
// opts: { hint, percent(0~1), action: { label, onClick } }
function setStatus(type, text, opts = {}) {
  if (!text) {
    statusEl.classList.add("hidden");
    return;
  }
  statusEl.className = "status" + (type ? " " + type : "");
  statusText.textContent = text;

  statusHint.textContent = opts.hint || "";
  statusHint.classList.toggle("hidden", !opts.hint);

  const hasPct = typeof opts.percent === "number";
  statusBar.classList.toggle("hidden", !hasPct);
  if (hasPct) statusBarFill.style.width = Math.round(opts.percent * 100) + "%";

  if (opts.action) {
    statusAction.textContent = opts.action.label;
    statusAction.onclick = opts.action.onClick;
    statusAction.classList.remove("hidden");
  } else {
    statusAction.onclick = null;
    statusAction.classList.add("hidden");
  }
}

// 준비 상태 폴링 (최초 실행 시 yt-dlp/ffmpeg/deno 자동 설치 대기)
function setReady(isReady) {
  fetchBtn.disabled = !isReady;
  urlInput.disabled = !isReady;
}

let appReady = false;
let appGone = false;
let updating = false; // 업데이트 적용 → 재시작 중
let knownVersion = null;
let doneNoticeUntil = 0;
let pollTimer = null;

// 폴링은 항상 하나의 타이머로만 (중복 루프 방지)
function schedulePoll(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollHealth, ms);
}

async function pollHealth() {
  try {
    const h = await (await fetch("/api/health", { cache: "no-store" })).json();
    appGone = false;

    // 업데이트가 끝나고 새 버전으로 다시 연결됨
    if (knownVersion && h.version && h.version !== knownVersion && updating) {
      doneNoticeUntil = Date.now() + 5000;
    }
    if (h.version) knownVersion = h.version;
    if (!h.update || (h.update.state !== "downloading" && h.update.state !== "applying")) {
      if (updating && h.version) updating = false;
    }

    // 업데이트 진행 중
    const u = h.update || {};
    if (u.state === "downloading" || u.state === "applying") {
      updating = true;
      appReady = false;
      setReady(false);
      setStatus(
        "loading",
        u.state === "applying"
          ? `새 버전(v${u.version})으로 바꾸는 중…`
          : `새 버전(v${u.version}) 받는 중…${typeof u.percent === "number" ? " " + Math.round(u.percent * 100) + "%" : ""}`,
        {
          hint: "이전 버전은 자동으로 지워지고, 끝나면 이 화면이 그대로 이어져요.",
          percent: typeof u.percent === "number" ? u.percent : undefined,
        }
      );
      schedulePoll(500);
      return;
    }
    if (h.bootError) {
      appReady = false;
      setReady(false);
      setStatus("error", "준비하지 못했습니다 — " + h.bootError, {
        hint: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        action: {
          label: "다시 시도",
          onClick: async () => {
            setStatus("loading", "다시 준비하는 중…");
            try {
              await fetch("/api/retry-setup", { method: "POST" });
            } catch {
              /* 폴링이 상태를 반영 */
            }
            schedulePoll(500);
          },
        },
      });
      return;
    }
    if (!h.ready) {
      appReady = false;
      setReady(false);
      setStatus("loading", h.bootStatus || "필수 구성요소를 준비하는 중…", {
        hint: "처음 한 번만 필요한 준비예요. 보통 1~3분 걸립니다.",
        percent: typeof h.bootPercent === "number" ? h.bootPercent : undefined,
      });
      schedulePoll(700);
      return;
    }
    appReady = true;
    setReady(true);
    if (Date.now() < doneNoticeUntil) {
      setStatus("", `업데이트 완료 — 이제 v${h.version} 이에요.`);
      schedulePoll(Math.max(500, doneNoticeUntil - Date.now()));
      return;
    }
    if (u.state === "error") {
      setStatus("warn", "업데이트하지 못했어요 — " + u.error, {
        action: { label: "다시 시도", onClick: startUpdate },
      });
    } else if (u.available) {
      setStatus("warn", `새 버전(v${u.version})이 있어요.`, {
        hint: "지금 받는 작업이 없을 때 눌러 주세요. 1분이면 끝나요.",
        action: { label: "지금 업데이트", onClick: startUpdate },
      });
      schedulePoll(5000);
    } else if (h.translocated) {
      setStatus("warn", "youdown 을 '응용 프로그램' 폴더로 옮겨서 실행하면 더 안정적이에요.");
    } else if (!h.ffmpeg) {
      setStatus("warn", "ffmpeg 없음 — 음원은 원본 오디오, 영상은 단일 스트림으로 제공됩니다.");
    } else {
      setStatus("", "");
    }
  } catch {
    // 서버에 연결할 수 없음 (앱이 종료됨) → 다시 켜지면 자동으로 이어서 사용
    if (appReady || appGone || updating) showGone();
    schedulePoll(updating ? 700 : 2000);
  }
}

function showGone() {
  appGone = true;
  appReady = false;
  setReady(false);
  if (updating) {
    setStatus("loading", "새 버전으로 다시 시작하는 중…", {
      hint: "잠시만 기다려 주세요. 자동으로 이어집니다.",
    });
    return;
  }
  setStatus("error", "youdown 이 종료되었습니다.", {
    hint: "앱을 다시 실행하면 이 화면이 자동으로 이어집니다.",
  });
}

async function startUpdate() {
  updating = true;
  setStatus("loading", "업데이트를 시작하는 중…");
  try {
    await fetch("/api/update", { method: "POST" });
  } catch {
    /* 폴링이 상태를 반영 */
  }
  schedulePoll(300);
}

// 이 페이지가 열려 있는 동안 앱이 켜져 있도록 주기적으로 신호를 보낸다.
// (탭을 닫으면 신호가 끊기고, 앱은 잠시 후 스스로 종료)
async function ping() {
  try {
    await fetch("/api/ping", { method: "POST", cache: "no-store" });
    if (appGone) schedulePoll(0);
  } catch {
    if (appReady) {
      showGone();
      schedulePoll(2000);
    }
  }
}
setInterval(ping, 30_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") ping();
});

setReady(false);
pollHealth();
ping();

function showError(msg) {
  inputError.textContent = msg;
  inputError.classList.remove("hidden");
}
function clearError() {
  inputError.classList.add("hidden");
  inputError.textContent = "";
}

function fmtDuration(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// 1) 정보 불러오기
urlForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const url = urlInput.value.trim();
  if (!url) return;

  fetchBtn.disabled = true;
  fetchBtn.textContent = "불러오는 중…";
  preview.classList.add("hidden");
  progress.classList.add("hidden");

  try {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "정보를 불러오지 못했습니다.");

    currentUrl = url;
    thumb.src = data.thumbnail || "";
    thumb.style.visibility = data.thumbnail ? "visible" : "hidden";
    titleEl.textContent = data.title || "제목 없음";
    uploaderEl.textContent = data.uploader || "";
    if (data.duration) {
      durationEl.textContent = fmtDuration(data.duration);
      durationEl.classList.remove("hidden");
    } else {
      durationEl.classList.add("hidden");
    }
    preview.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = "불러오기";
  }
});

// 2) 형식 선택 (영상/음원)
typeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  selectedType = btn.dataset.type;
  [...typeSeg.children].forEach((b) => b.classList.toggle("active", b === btn));
  // 음원이면 화질 선택 숨김
  qualityGroup.classList.toggle("hidden", selectedType === "audio");
});

// 3) 다운로드
downloadBtn.addEventListener("click", async () => {
  clearError();
  downloadBtn.disabled = true;
  downloadBtn.textContent = "시작 중…";

  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: currentUrl,
        type: selectedType,
        quality: qualitySelect.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "다운로드를 시작하지 못했습니다.");

    trackJob(data.jobId);
  } catch (err) {
    showError(err.message);
    resetDownloadBtn();
  }
});

function resetDownloadBtn() {
  downloadBtn.disabled = false;
  downloadBtn.textContent = "다운로드";
}

// 4) 진행률 추적 (SSE)
function trackJob(jobId) {
  progress.classList.remove("hidden");
  stageEl.textContent = "준비 중";
  percentEl.textContent = "0%";
  barFill.style.width = "0%";
  progressNote.textContent = "";

  const es = new EventSource(`/api/jobs/${jobId}/events`);

  es.onmessage = (ev) => {
    const s = JSON.parse(ev.data);
    if (s.stage) stageEl.textContent = s.stage;
    if (typeof s.percent === "number") {
      const p = Math.round(s.percent);
      percentEl.textContent = p + "%";
      barFill.style.width = p + "%";
    }

    if (s.status === "done") {
      es.close();
      stageEl.textContent = "완료 — 저장을 시작합니다";
      percentEl.textContent = "100%";
      barFill.style.width = "100%";
      progressNote.textContent = s.fileName ? "파일: " + s.fileName : "";
      // 파일 저장 트리거
      window.location.href = `/api/jobs/${jobId}/file`;
      setTimeout(resetDownloadBtn, 1500);
    } else if (s.status === "error") {
      es.close();
      showError(s.error || "다운로드 중 오류가 발생했습니다.");
      progress.classList.add("hidden");
      resetDownloadBtn();
    }
  };

  es.onerror = () => {
    es.close();
    // done 직후 서버가 스트림을 닫으면 여기로 올 수 있으므로 상태로 판단
    if (!downloadBtn.disabled) return;
    // 아직 완료 안 됐는데 끊긴 경우
    if (barFill.style.width !== "100%") {
      showError("서버 연결이 끊어졌습니다. 다시 시도해주세요.");
      progress.classList.add("hidden");
      resetDownloadBtn();
    }
  };
}
