import express from "express";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// 환경 점검 (yt-dlp / ffmpeg)
// ---------------------------------------------------------------------------
function resolveBin(candidates) {
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error) return bin;
  }
  return null;
}

const YTDLP = resolveBin(["yt-dlp", "yt-dlp.exe", "youtube-dl"]);
const HAS_FFMPEG = !!resolveBin(["ffmpeg"]);

// JS 런타임 (yt-dlp 의 유튜브 서명/nsig 해독에 사용). deno 를 우선 탐색.
function resolveJsRuntime() {
  const candidates = [
    process.env.DENO_BIN,
    "deno",
    path.join(os.homedir(), ".deno", "bin", "deno"),
  ].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error) return bin;
  }
  return null;
}
const DENO_BIN = resolveJsRuntime();

if (!YTDLP) {
  console.warn(
    "\n[경고] yt-dlp 를 찾을 수 없습니다. `pip install yt-dlp` 로 설치하세요.\n"
  );
}
if (!HAS_FFMPEG) {
  console.warn(
    "[경고] ffmpeg 이 없습니다. 고화질 병합/음원 변환 품질이 제한됩니다.\n"
  );
}

// yt-dlp 실행 시 사용할 환경 (deno 가 커스텀 경로에 있으면 PATH 에 추가)
const YT_ENV = { ...process.env };
if (DENO_BIN) {
  const denoDir = path.dirname(DENO_BIN);
  YT_ENV.PATH = `${denoDir}${path.delimiter}${YT_ENV.PATH || ""}`;
}
// 모든 yt-dlp 호출에 공통으로 붙일 인자
const COMMON_ARGS = [];
if (DENO_BIN) COMMON_ARGS.push("--js-runtimes", "deno");
// 서버 환경에서의 안정성 옵션 (일시적 네트워크/차단 대응)
COMMON_ARGS.push("--retries", "5", "--fragment-retries", "5");

const DOWNLOAD_ROOT = path.join(os.tmpdir(), "youdown-files");
fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });

// 쿠키 지원 — 배포된 서버(데이터센터 IP)에서 유튜브 봇 차단을 우회하려면
// 로그인 상태의 쿠키(Netscape 형식)가 필요할 수 있습니다.
//   - YTDLP_COOKIES_FILE : 쿠키 파일 경로
//   - YTDLP_COOKIES_B64  : 쿠키 파일 내용을 base64 로 인코딩한 문자열(환경변수용)
function resolveCookies() {
  const explicit = process.env.YTDLP_COOKIES_FILE;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const b64 = process.env.YTDLP_COOKIES_B64;
  if (b64) {
    try {
      const p = path.join(DOWNLOAD_ROOT, "cookies.txt");
      fs.writeFileSync(p, Buffer.from(b64, "base64").toString("utf8"), { mode: 0o600 });
      return p;
    } catch {
      console.warn("[경고] YTDLP_COOKIES_B64 디코딩에 실패했습니다.");
    }
  }
  return null;
}
const COOKIES_FILE = resolveCookies();
if (COOKIES_FILE) COMMON_ARGS.push("--cookies", COOKIES_FILE);

// 진행 중인 작업 저장소
const jobs = new Map();

// URL 이 유튜브(또는 yt-dlp 지원)인지 최소 검증
function looksLikeUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 영상 정보 조회
// ---------------------------------------------------------------------------
app.post("/api/info", (req, res) => {
  if (!YTDLP) return res.status(500).json({ error: "서버에 yt-dlp 가 설치되어 있지 않습니다." });
  const { url } = req.body || {};
  if (!looksLikeUrl(url)) return res.status(400).json({ error: "올바른 URL 을 입력하세요." });

  const args = [...COMMON_ARGS, "-J", "--no-playlist", "--no-warnings", url];
  const child = spawn(YTDLP, args, { env: YT_ENV });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", () => res.status(500).json({ error: "yt-dlp 실행에 실패했습니다." }));
  child.on("close", (code) => {
    if (code !== 0) {
      return res.status(400).json({ error: parseYtError(err) });
    }
    try {
      const info = JSON.parse(out);
      res.json({
        id: info.id,
        title: info.title,
        uploader: info.uploader || info.channel || "",
        duration: info.duration || 0,
        thumbnail: info.thumbnail || "",
      });
    } catch {
      res.status(500).json({ error: "정보를 해석하지 못했습니다." });
    }
  });
});

// ---------------------------------------------------------------------------
// 다운로드 작업 생성
// ---------------------------------------------------------------------------
app.post("/api/jobs", (req, res) => {
  if (!YTDLP) return res.status(500).json({ error: "서버에 yt-dlp 가 설치되어 있지 않습니다." });
  const { url, type = "video", quality = "best" } = req.body || {};
  if (!looksLikeUrl(url)) return res.status(400).json({ error: "올바른 URL 을 입력하세요." });
  if (type !== "video" && type !== "audio")
    return res.status(400).json({ error: "type 은 video 또는 audio 여야 합니다." });

  const jobId = randomUUID();
  const outDir = path.join(DOWNLOAD_ROOT, jobId);
  fs.mkdirSync(outDir, { recursive: true });

  const args = buildYtArgs({ url, type, quality, outDir });
  const child = spawn(YTDLP, args, { env: YT_ENV });

  const job = {
    id: jobId,
    type,
    outDir,
    status: "running",
    percent: 0,
    stage: type === "audio" ? "음원 추출 준비 중" : "영상 다운로드 준비 중",
    error: null,
    filePath: null,
    fileName: null,
    listeners: new Set(),
    child,
  };
  jobs.set(jobId, job);

  let errBuf = "";
  const handleLine = (line) => {
    // 진행률 파싱: "[download]  42.7% ..."
    const m = line.match(/\[download\]\s+([\d.]+)%/);
    if (m) {
      job.percent = parseFloat(m[1]);
      job.stage = type === "audio" ? "음원 다운로드 중" : "영상 다운로드 중";
      emit(job);
    } else if (/\[ExtractAudio\]|Extracting audio/i.test(line)) {
      job.stage = "음원 변환 중";
      emit(job);
    } else if (/\[Merger\]|Merging formats/i.test(line)) {
      job.stage = "영상 합치는 중";
      emit(job);
    }
  };

  attachLineReader(child.stdout, handleLine);
  attachLineReader(child.stderr, (line) => {
    errBuf += line + "\n";
    handleLine(line);
  });

  child.on("error", () => {
    job.status = "error";
    job.error = "yt-dlp 실행에 실패했습니다.";
    emit(job);
  });

  child.on("close", (code) => {
    if (job.status === "error") return;
    if (code !== 0) {
      job.status = "error";
      job.error = parseYtError(errBuf);
      emit(job);
      cleanupLater(job);
      return;
    }
    // 결과 파일 찾기
    const files = fs.readdirSync(outDir).filter((f) => !f.endsWith(".part"));
    if (files.length === 0) {
      job.status = "error";
      job.error = "다운로드된 파일을 찾지 못했습니다.";
      emit(job);
      return;
    }
    job.fileName = files[0];
    job.filePath = path.join(outDir, files[0]);
    job.percent = 100;
    job.status = "done";
    job.stage = "완료";
    emit(job);
  });

  res.json({ jobId });
});

// ---------------------------------------------------------------------------
// 진행률 스트림 (SSE)
// ---------------------------------------------------------------------------
app.get("/api/jobs/:id/events", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");

  const send = () => {
    res.write(
      `data: ${JSON.stringify({
        status: job.status,
        percent: job.percent,
        stage: job.stage,
        error: job.error,
        fileName: job.fileName,
      })}\n\n`
    );
    if (job.status === "done" || job.status === "error") {
      res.end();
    }
  };

  job.listeners.add(send);
  send(); // 즉시 현재 상태 전송

  req.on("close", () => job.listeners.delete(send));
});

// ---------------------------------------------------------------------------
// 파일 다운로드
// ---------------------------------------------------------------------------
app.get("/api/jobs/:id/file", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "done" || !job.filePath) {
    return res.status(404).send("파일을 찾을 수 없습니다.");
  }
  res.download(job.filePath, job.fileName, (err) => {
    if (!err) cleanupLater(job, 5000);
  });
});

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------
function buildYtArgs({ url, type, quality, outDir }) {
  const output = path.join(outDir, "%(title).200B.%(ext)s");
  const base = [
    ...COMMON_ARGS,
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--restrict-filenames",
    "-o",
    output,
  ];

  if (type === "audio") {
    if (HAS_FFMPEG) {
      base.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      // ffmpeg 없으면 원본 오디오 스트림(m4a 등)만 저장
      base.push("-f", "bestaudio/best");
    }
  } else {
    // 영상
    let selector;
    if (quality === "best") {
      selector = HAS_FFMPEG ? "bv*+ba/b" : "b[ext=mp4]/b";
    } else {
      const h = parseInt(quality, 10);
      selector = HAS_FFMPEG
        ? `bv*[height<=${h}]+ba/b[height<=${h}]/b`
        : `b[ext=mp4][height<=${h}]/b[height<=${h}]/b`;
    }
    base.push("-f", selector);
    if (HAS_FFMPEG) base.push("--merge-output-format", "mp4");
  }

  base.push(url);
  return base;
}

function attachLineReader(stream, onLine) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    // yt-dlp 진행률은 \r 로 갱신되므로 \r, \n 모두 구분자로 처리
    const parts = buf.split(/[\r\n]/);
    buf = parts.pop();
    for (const line of parts) if (line.trim()) onLine(line.trim());
  });
  stream.on("end", () => {
    if (buf.trim()) onLine(buf.trim());
  });
}

function emit(job) {
  for (const send of job.listeners) {
    try {
      send();
    } catch {
      /* ignore */
    }
  }
}

function parseYtError(err) {
  if (!err) return "다운로드에 실패했습니다.";
  const line = err
    .split("\n")
    .reverse()
    .find((l) => /ERROR/i.test(l));
  if (!line) return "다운로드에 실패했습니다.";
  const cleaned = line.replace(/^ERROR:\s*/i, "").trim();
  if (/Sign in to confirm|not a bot|429|Too Many Requests/i.test(cleaned))
    return "유튜브가 이 서버를 봇으로 차단했습니다. 서버에 쿠키(YTDLP_COOKIES_B64)를 설정해야 다운로드가 가능합니다.";
  if (/HTTP Error 403|Forbidden/i.test(cleaned))
    return "유튜브가 다운로드를 거부했습니다(403). 서버 배포 환경에서는 쿠키 설정이 필요할 수 있습니다.";
  if (/Private video/i.test(cleaned)) return "비공개 영상입니다.";
  if (/Video unavailable/i.test(cleaned)) return "이용할 수 없는 영상입니다.";
  if (/is not a valid URL/i.test(cleaned)) return "올바른 URL 이 아닙니다.";
  if (/Unsupported URL/i.test(cleaned)) return "지원하지 않는 URL 입니다.";
  if (/DRM/i.test(cleaned)) return "DRM 으로 보호된 영상은 받을 수 없습니다.";
  return cleaned.slice(0, 200);
}

function cleanupLater(job, delay = 60_000) {
  setTimeout(() => {
    try {
      fs.rmSync(job.outDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    jobs.delete(job.id);
  }, delay);
}

// 오래된 임시 파일 주기적 청소 (1시간)
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  try {
    for (const name of fs.readdirSync(DOWNLOAD_ROOT)) {
      const p = path.join(DOWNLOAD_ROOT, name);
      const st = fs.statSync(p);
      if (st.mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}, 30 * 60 * 1000);

app.get("/api/health", (_req, res) => {
  res.json({
    ytDlp: !!YTDLP,
    ffmpeg: HAS_FFMPEG,
    jsRuntime: !!DENO_BIN,
    cookies: !!COOKIES_FILE,
  });
});

app.listen(PORT, () => {
  console.log(`\n  youdown 서버 실행 중 → http://localhost:${PORT}`);
  console.log(
    `  yt-dlp: ${YTDLP ? "OK" : "없음"} | ffmpeg: ${HAS_FFMPEG ? "OK" : "없음"} | JS런타임(deno): ${DENO_BIN ? "OK" : "없음"} | 쿠키: ${COOKIES_FILE ? "OK" : "없음"}\n`
  );
});
