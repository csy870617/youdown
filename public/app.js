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

let currentUrl = "";
let selectedType = "video";

// 준비 상태 폴링 (최초 실행 시 yt-dlp/ffmpeg 자동 설치 대기)
function setReady(isReady) {
  fetchBtn.disabled = !isReady;
  urlInput.disabled = !isReady;
}

async function pollHealth() {
  try {
    const h = await (await fetch("/api/health")).json();
    if (h.bootError) {
      $("env-note").textContent = "⚠ 준비 실패: " + h.bootError;
      setReady(false);
      return;
    }
    if (!h.ready) {
      $("env-note").textContent =
        "⏳ 최초 실행 준비 중 — " + (h.bootStatus || "구성요소 내려받는 중…");
      setReady(false);
      setTimeout(pollHealth, 1000);
      return;
    }
    // 준비 완료
    setReady(true);
    if (!h.ffmpeg) {
      $("env-note").textContent =
        "※ ffmpeg 이 없어 음원은 원본 오디오, 영상은 단일 스트림으로 제공됩니다.";
    } else {
      $("env-note").textContent = "";
    }
  } catch {
    setTimeout(pollHealth, 1500);
  }
}
setReady(false);
pollHealth();

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
    thumb.style.display = data.thumbnail ? "block" : "none";
    titleEl.textContent = data.title || "제목 없음";
    uploaderEl.textContent = data.uploader ? "📺 " + data.uploader : "";
    durationEl.textContent = data.duration ? "⏱ " + fmtDuration(data.duration) : "";
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
