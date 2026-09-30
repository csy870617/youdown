import express from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { ensureTools, APP_DIR } from "./src/tools.js";
import { openBrowser } from "./src/open.js";

// 번들(CJS, esbuild)에서는 전역 __dirname 을, 소스 실행(ESM)에서는
// import.meta.url 을 사용해 기준 디렉터리를 구한다.
const ROOT_DIR =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, "public")));

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
let bootPercent = null; // 현재 준비 항목 진행률(0~1), 모르면 null
let bootError = null;
let booting = false;

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"))
      .version;
  } catch {
    return "";
  }
}
const VERSION = readVersion();

// 데스크톱 앱(실행파일)으로 실행 중인지. Docker/개발 실행과 동작을 구분한다.
const IS_DESKTOP = !!process.pkg || process.env.YOUDOWN_DESKTOP === "1";
// macOS 가 다운로드 폴더에서 격리(App Translocation) 실행 중인지
const TRANSLOCATED = process.execPath.includes("/AppTranslocation/");

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
  // 멈춘 연결을 일정 시간 후 끊어 무한 대기를 방지
  args.push("--socket-timeout", "30", "--retries", "5", "--fragment-retries", "5");
  COMMON_ARGS = args;

  YT_ENV = { ...process.env };
  const pathParts = [];
  if (DENO_BIN) pathParts.push(path.dirname(DENO_BIN));
  if (FFMPEG_DIR) pathParts.push(FFMPEG_DIR);
  if (pathParts.length) {
    // Windows 는 변수 이름이 'Path' 일 수 있어 기존 키를 대소문자 무시로 찾는다
    const key = Object.keys(YT_ENV).find((k) => k.toUpperCase() === "PATH") || "PATH";
    YT_ENV[key] = `${pathParts.join(path.delimiter)}${path.delimiter}${YT_ENV[key] || ""}`;
  }
}

async function initTools() {
  if (booting || toolsReady) return;
  booting = true;
  bootError = null;
  let lastLogKey = "";
  try {
    const t = await ensureTools((msg, p) => {
      bootStatus = msg;
      bootPercent = typeof p === "number" ? p : null;
      // 진행률마다 찍지 않고 25% 단위로만 기록 (로그 파일 비대화 방지)
      const key = msg.replace(/\s*\d+%$/, "") + "|" + (p == null ? "-" : Math.floor(p * 4));
      if (key !== lastLogKey) {
        lastLogKey = key;
        console.log("  · " + msg);
      }
    });
    YTDLP = t.ytdlp;
    FFMPEG_DIR = t.ffmpegDir;
    HAS_FFMPEG = t.hasFfmpeg;
    DENO_BIN = t.deno;
    rebuildCommonArgs();
    toolsReady = true;
    bootStatus = "준비 완료";
    bootPercent = null;
    console.log(
      `\n  준비 완료 · ffmpeg: ${HAS_FFMPEG ? "OK" : "없음"} | JS런타임(deno): ${DENO_BIN ? "OK" : "없음"} | 쿠키: ${COOKIES_FILE ? "OK" : "없음"}\n`
    );
  } catch (e) {
    bootError = e.message || "구성요소 준비에 실패했습니다.";
    bootStatus = "준비 실패";
    bootPercent = null;
    console.error("[오류] 도구 준비 실패:", bootError);
  } finally {
    booting = false;
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

  // 응답은 한 번만 (error·close·timeout 이 중복 전송하지 않도록 가드)
  let responded = false;
  let timer = null;
  const respond = (code, body) => {
    if (responded || res.headersSent) return;
    responded = true;
    if (timer) clearTimeout(timer);
    res.status(code).json(body);
  };

  const args = [...COMMON_ARGS, "-J", "--no-playlist", "--no-warnings", url];
  const child = spawn(YTDLP, args, { env: YT_ENV, windowsHide: true });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));

  // 응답이 무한정 지연되지 않도록 60초 후 종료
  timer = setTimeout(() => {
    child.kill("SIGKILL");
    respond(504, { error: "정보 조회 시간이 초과되었습니다. 다시 시도해 주세요." });
  }, 60_000);

  child.on("error", () =>
    respond(500, { error: "yt-dlp 실행에 실패했습니다." })
  );
  child.on("close", (code) => {
    if (responded) return;
    if (code !== 0) return respond(400, { error: parseYtError(err) });
    try {
      const info = JSON.parse(out);
      respond(200, {
        id: info.id,
        title: info.title,
        uploader: info.uploader || info.channel || "",
        duration: info.duration || 0,
        thumbnail: info.thumbnail || "",
      });
    } catch {
      respond(500, { error: "정보를 해석하지 못했습니다." });
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
  const child = spawn(YTDLP, args, { env: YT_ENV, windowsHide: true });

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
    cleanupLater(job);
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
      cleanupLater(job);
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
  sseClients++;
  send();
  req.on("close", () => {
    job.listeners.delete(send);
    sseClients--;
  });
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
    app: "youdown", // 이미 실행 중인 인스턴스를 식별하는 표식
    version: VERSION,
    ready: toolsReady,
    bootStatus,
    bootPercent,
    bootError,
    ytDlp: !!YTDLP,
    ffmpeg: HAS_FFMPEG,
    jsRuntime: !!DENO_BIN,
    cookies: !!COOKIES_FILE,
    translocated: TRANSLOCATED,
  });
});

// 최초 준비가 실패했을 때(네트워크 끊김 등) 앱을 껐다 켜지 않고 다시 시도
app.post("/api/retry-setup", (_req, res) => {
  if (!toolsReady && !booting) initTools();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 자동 종료: 브라우저 탭이 닫히면 잠시 후 스스로 종료 (데스크톱 앱에서만)
// 페이지가 주기적으로 /api/ping 을 보내고, 일정 시간 신호가 없으며
// 진행 중인 작업도 없으면 종료한다.
// ---------------------------------------------------------------------------
let sseClients = 0;
let pingedSinceTick = true; // 시작 직후엔 브라우저가 열리는 시간을 준다
let idleTicks = 0;
const IDLE_TICK_MS = Number(process.env.YOUDOWN_IDLE_TICK_MS) || 60_000; // 테스트용 단축 가능
const IDLE_LIMIT_TICKS = 10; // 약 10분

app.post("/api/ping", (_req, res) => {
  pingedSinceTick = true;
  res.json({ ok: true });
});

function activeJobs() {
  let n = 0;
  for (const j of jobs.values()) if (j.status === "running") n++;
  return n;
}

function startIdleWatch() {
  if (process.env.YOUDOWN_NO_IDLE_EXIT === "1") return;
  // 분 단위 "틱"으로 센다. 컴퓨터가 잠자기 상태였던 시간은 틱이 돌지 않아
  // 잠깐 덮개를 닫았다고 앱이 꺼지지 않는다.
  setInterval(() => {
    if (pingedSinceTick || activeJobs() > 0 || sseClients > 0 || booting) {
      idleTicks = 0;
    } else {
      idleTicks++;
    }
    pingedSinceTick = false;
    if (idleTicks >= IDLE_LIMIT_TICKS) shutdown("브라우저가 닫혀 자동 종료합니다.");
  }, IDLE_TICK_MS).unref();
}

// ---------------------------------------------------------------------------
// 단일 실행: 이미 켜져 있으면 새로 띄우지 않고 브라우저만 연다
// ---------------------------------------------------------------------------
const INSTANCE_FILE = path.join(APP_DIR, "instance.json");

function probeYoudown(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 1500 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body).app === "youdown");
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

async function findRunningInstance(preferred) {
  const ports = [];
  try {
    const saved = JSON.parse(fs.readFileSync(INSTANCE_FILE, "utf8"));
    if (saved && saved.port) ports.push(saved.port);
  } catch {
    /* 기록 없음 */
  }
  if (!ports.includes(preferred)) ports.push(preferred);
  for (const p of ports) if (await probeYoudown(p)) return p;
  return null;
}

// ---------------------------------------------------------------------------
// 로그: 데스크톱 앱은 ~/.youdown/youdown.log 에 남긴다 (문제 진단용)
// ---------------------------------------------------------------------------
function setupFileLog() {
  try {
    fs.mkdirSync(APP_DIR, { recursive: true });
    const stream = fs.createWriteStream(path.join(APP_DIR, "youdown.log"), {
      flags: "w",
    });
    for (const level of ["log", "warn", "error"]) {
      const orig = console[level].bind(console);
      console[level] = (...a) => {
        try {
          stream.write(
            a.map((x) => (typeof x === "string" ? x : String(x))).join(" ") + "\n"
          );
        } catch {
          /* ignore */
        }
        try {
          orig(...a);
        } catch {
          /* 콘솔이 없어도 무시 */
        }
      };
    }
  } catch {
    /* 로그 파일을 못 열어도 앱은 동작 */
  }
}

process.on("uncaughtException", (e) => {
  console.error("[치명적 오류]", e && e.stack ? e.stack : e);
  shutdown("오류로 종료합니다.", 1);
});
process.on("unhandledRejection", (e) => {
  console.error("[처리되지 않은 오류]", e && e.stack ? e.stack : e);
});

function shutdown(reason, code = 0) {
  console.log("  " + reason);
  try {
    const saved = JSON.parse(fs.readFileSync(INSTANCE_FILE, "utf8"));
    if (saved.pid === process.pid) fs.rmSync(INSTANCE_FILE, { force: true });
  } catch {
    /* ignore */
  }
  for (const j of jobs.values()) {
    try {
      j.child.kill();
    } catch {
      /* ignore */
    }
  }
  try {
    for (const name of fs.readdirSync(DOWNLOAD_ROOT)) {
      if (name !== "cookies.txt")
        fs.rmSync(path.join(DOWNLOAD_ROOT, name), { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  process.exit(code);
}
process.on("SIGTERM", () => shutdown("종료 신호를 받았습니다."));
process.on("SIGINT", () => shutdown("종료합니다."));

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

  if (IS_DESKTOP) {
    // 1) 이미 실행 중이면 그 창을 열고 끝낸다 (아이콘을 다시 눌렀을 때)
    const running = await findRunningInstance(preferred);
    if (running) {
      if (AUTO_OPEN) openBrowser(`http://127.0.0.1:${running}`);
      setTimeout(() => process.exit(0), 300);
      return;
    }
    // 2) macOS 앱에서 실행된 경우, 서버를 앱 프로세스와 분리해 백그라운드로
    //    돌린다. 그래야 앱 아이콘을 다시 눌렀을 때 macOS 가 앱을 새로 실행해
    //    (=위 1번) 브라우저를 열어 준다.
    if (
      process.platform === "darwin" &&
      process.env.YOUDOWN_APP === "1" &&
      process.env.YOUDOWN_DETACHED !== "1"
    ) {
      const child = spawn(process.execPath, process.argv.slice(2), {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, YOUDOWN_DETACHED: "1" },
      });
      child.unref();
      setTimeout(() => process.exit(0), 300);
      return;
    }
    setupFileLog();
  }

  const port = await findFreePort(preferred);
  // 데스크톱 앱은 내 컴퓨터에서만 접속 가능하게(127.0.0.1),
  // 서버 배포(Docker 등)는 외부 접속을 위해 모든 인터페이스에서 대기
  const host = IS_DESKTOP ? "127.0.0.1" : undefined;
  const server = app.listen(port, host, () => {
    const url = `http://${IS_DESKTOP ? "127.0.0.1" : "localhost"}:${port}`;
    console.log(`\n  youdown ${VERSION} 실행 중 → ${url}`);
    console.log(
      process.platform === "win32" && IS_DESKTOP
        ? "  이 창을 닫으면 youdown 이 종료됩니다. (브라우저 탭을 닫아도 잠시 후 자동 종료)\n"
        : "  브라우저 탭을 닫으면 잠시 후 자동으로 종료됩니다.\n"
    );
    if (IS_DESKTOP) {
      try {
        fs.writeFileSync(INSTANCE_FILE, JSON.stringify({ pid: process.pid, port }));
      } catch {
        /* ignore */
      }
      startIdleWatch();
    }
    if (AUTO_OPEN) openBrowser(url);
    // 서버는 즉시 응답하고, 도구 준비는 백그라운드로 진행
    initTools();
  });
  server.on("error", (e) => {
    console.error("[오류] 서버를 시작하지 못했습니다:", e.message);
    process.exit(1);
  });
})();
