import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { ensureTools } from "./src/tools.js";
import { openBrowser } from "./src/open.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// 도구/환경 상태 (최초 실행 시 자동 준비)
// ---------------------------------------------------------------------------
let YTDLP = null;
let FFMPEG_DIR = null; // 다운로드한 ffmpeg 디렉터리 (시스템 PATH 사용 시 null)
let HAS_FFMPEG = false;
let DENO_BIN = null;
let COMMON_ARGS = [];
let YT_ENV = { ...process.env };

let toolsReady = false;
let bootStatus = "필수 구성요소를 준비하고 있습니다…";
let bootError = null;

const DOWNLOAD_ROOT = path.join(os.tmpdir(), "youdown-files");
fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });

// 쿠키 지원 (배포/서버 환경에서 유튜브 봇 차단 우회용, 로컬에선 대개 불필요)
function resolveCookies() {
  const explicit = process.env.YTDLP_COOKIES_FILE;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const b64 = process.env.YTDLP_COOKIES_B64;
  if (b64) {
    try {
      const p = path.join(DOWNLOAD_ROOT, "cookies.txt");
      fs.writeFileSync(p, Buffer.from(b64, "base64").toString("utf8"), {
        mode: 0o600,
      });
      return p;
    } catch {
      console.warn("[경고] YTDLP_COOKIES_B64 디코딩 실패");
    }
  }
  return null;
}
const COOKIES_FILE = resolveCookies();

// 도구 준비가 끝난 뒤 실행 인자 구성
function rebuildCommonArgs() {
  const args = [];
  if (DENO_BIN) args.push("--js-runtimes", "deno");
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  if (COOKIES_FILE) args.push("--cookies", COOKIES_FILE);
  args.push("--retries", "5", "--fragment-retries", "5");
  COMMON_ARGS = args;

  YT_ENV = { ...process.env };
  const pathParts = [];
  if (DENO_BIN) pathParts.push(path.dirname(DENO_BIN));
  if (FFMPEG_DIR) pathParts.push(FFMPEG_DIR);
  if (pathParts.length) {
    YT_ENV.PATH = `${pathParts.join(path.delimiter)}${path.delimiter}${YT_ENV.PATH || ""}`;
  }
}

async function initTools() {
  try {
    const t = await ensureTools((msg) => {
      bootStatus = msg;
      console.log("  · " + msg);
    });
    YTDLP = t.ytdlp;
    FFMPEG_DIR = t.ffmpegDir;
    HAS_FFMPEG = t.hasFfmpeg;
    DENO_BIN = t.deno;
    rebuildCommonArgs();
    toolsReady = true;
    bootStatus = "준비 완료";
    console.log(
      `\n  준비 완료 · ffmpeg: ${HAS_FFMPEG ? "OK" : "없음"} | JS런타임(deno): ${DENO_BIN ? "OK" : "없음"} | 쿠키: ${COOKIES_FILE ? "OK" : "없음"}\n`
    );
  } catch (e) {
    bootError = e.message || "구성요소 준비에 실패했습니다.";
    bootStatus = "준비 실패";
    console.error("[오류] 도구 준비 실패:", bootError);
  }
}

function requireReady(res) {
  if (bootError) {
    res.status(503).json({ error: "구성요소 준비 실패: " + bootError });
    return false;
  }
  if (!toolsReady) {
    res.status(503).json({ error: bootStatus });
    return false;
  }
  return true;
}

// 진행 중인 작업
const jobs = new Map();

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
  if (!requireReady(res)) return;
  const { url } = req.body || {};
  if (!looksLikeUrl(url))
    return res.status(400).json({ error: "올바른 URL 을 입력하세요." });

  const args = [...COMMON_ARGS, "-J", "--no-playlist", "--no-warnings", url];
  const child = spawn(YTDLP, args, { env: YT_ENV });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", () =>
    res.status(500).json({ error: "yt-dlp 실행에 실패했습니다." })
  );
  child.on("close", (code) => {
    if (code !== 0) return res.status(400).json({ error: parseYtError(err) });
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
  if (!requireReady(res)) return;
  const { url, type = "video", quality = "best" } = req.body || {};
  if (!looksLikeUrl(url))
    return res.status(400).json({ error: "올바른 URL 을 입력하세요." });
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
    if (job.status === "done" || job.status === "error") res.end();
  };

  job.listeners.add(send);
  send();
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
      base.push("-f", "bestaudio/best");
    }
  } else {
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
    return "유튜브가 봇으로 판단해 차단했습니다. 잠시 후 다시 시도하거나, 서버 배포 시에는 쿠키 설정이 필요합니다.";
  if (/HTTP Error 403|Forbidden/i.test(cleaned))
    return "유튜브가 다운로드를 거부했습니다(403). 잠시 후 다시 시도해 보세요.";
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

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  try {
    for (const name of fs.readdirSync(DOWNLOAD_ROOT)) {
      if (name === "cookies.txt") continue;
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
    ready: toolsReady,
    bootStatus,
    bootError,
    ytDlp: !!YTDLP,
    ffmpeg: HAS_FFMPEG,
    jsRuntime: !!DENO_BIN,
    cookies: !!COOKIES_FILE,
  });
});

// ---------------------------------------------------------------------------
// 빈 포트 찾아서 서버 시작
// ---------------------------------------------------------------------------
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => {
      // preferred 사용 중 → 임의 빈 포트
      const s2 = net.createServer();
      s2.listen(0, () => {
        const port = s2.address().port;
        s2.close(() => resolve(port));
      });
    });
    srv.once("listening", () => {
      srv.close(() => resolve(preferred));
    });
    srv.listen(preferred);
  });
}

const AUTO_OPEN = process.env.YOUDOWN_NO_OPEN !== "1";

(async () => {
  const preferred = parseInt(process.env.PORT || "3000", 10);
  const port = await findFreePort(preferred);
  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  youdown 실행 중 → ${url}`);
    console.log("  브라우저가 자동으로 열립니다. (닫으려면 이 창을 종료)\n");
    if (AUTO_OPEN) openBrowser(url);
    // 서버는 즉시 응답하고, 도구 준비는 백그라운드로 진행
    initTools();
  });
})();
