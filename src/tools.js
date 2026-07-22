import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";

// 사용자 홈에 도구를 캐시 (최초 1회만 내려받음)
const APP_DIR = path.join(os.homedir(), ".youdown");
const BIN_DIR = path.join(APP_DIR, "bin");
const TMP_DIR = path.join(APP_DIR, "tmp");

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const arch = process.arch; // 'x64' | 'arm64' ...

function ensureDirs() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function onPath(bin) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return !r.error;
}

// 리다이렉트를 따라가며 파일 다운로드 (진행률 콜백 지원)
function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "youdown" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          return download(res.headers.location, dest, onProgress).then(
            resolve,
            reject
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} · ${url}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let got = 0;
        const file = fs.createWriteStream(dest);
        res.on("data", (c) => {
          got += c.length;
          if (onProgress && total) onProgress(got / total);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", (e) => {
          fs.rmSync(dest, { force: true });
          reject(e);
        });
      }
    );
    req.on("error", reject);
  });
}

// ------- yt-dlp -------
function ytdlpName() {
  return isWin ? "yt-dlp.exe" : "yt-dlp";
}
function ytdlpUrl() {
  const base =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
  if (isWin) return base + "yt-dlp.exe";
  if (isMac) return base + "yt-dlp_macos";
  return base + "yt-dlp_linux";
}

async function resolveYtDlp(log) {
  const cached = path.join(BIN_DIR, ytdlpName());
  if (fs.existsSync(cached)) return cached;
  if (onPath("yt-dlp")) return "yt-dlp";
  ensureDirs();
  log("yt-dlp 내려받는 중…");
  await download(ytdlpUrl(), cached, (p) =>
    log(`yt-dlp 내려받는 중… ${Math.round(p * 100)}%`)
  );
  if (!isWin) fs.chmodSync(cached, 0o755);
  return cached;
}

// ------- ffmpeg -------
function ffmpegBinName() {
  return isWin ? "ffmpeg.exe" : "ffmpeg";
}
function ffmpegArchiveUrl() {
  if (isWin) {
    return "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
  }
  if (isMac) {
    return "https://evermeet.cx/ffmpeg/getrelease/zip";
  }
  // linux (static builds)
  const a = arch === "arm64" ? "arm64" : "amd64";
  return `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${a}-static.tar.xz`;
}

// 압축 해제 후 트리에서 실행파일 찾기
function findFileRecursive(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

async function resolveFfmpeg(log) {
  const cached = path.join(BIN_DIR, ffmpegBinName());
  if (fs.existsSync(cached)) return BIN_DIR;
  if (onPath("ffmpeg")) return null; // 시스템 ffmpeg 사용 (--ffmpeg-location 불필요)

  ensureDirs();
  log("ffmpeg 내려받는 중…");
  const url = ffmpegArchiveUrl();
  const archive = path.join(
    TMP_DIR,
    isWin || isMac ? "ffmpeg-archive.zip" : "ffmpeg-archive.tar.xz"
  );
  await download(url, archive, (p) =>
    log(`ffmpeg 내려받는 중… ${Math.round(p * 100)}%`)
  );

  log("ffmpeg 설치 중…");
  const extractDir = path.join(TMP_DIR, "ffmpeg-extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  // tar(bsdtar) 는 zip · tar.xz 모두 처리 (Win10 1803+, macOS, Linux 기본 제공)
  const r = spawnSync("tar", ["-xf", archive, "-C", extractDir], {
    stdio: "ignore",
  });
  if (r.error) throw new Error("압축 해제(tar)에 실패했습니다.");

  for (const bin of [ffmpegBinName(), isWin ? "ffprobe.exe" : "ffprobe"]) {
    const src = findFileRecursive(extractDir, bin);
    if (src) {
      const dst = path.join(BIN_DIR, bin);
      fs.copyFileSync(src, dst);
      if (!isWin) fs.chmodSync(dst, 0o755);
    }
  }
  fs.rmSync(archive, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });

  if (!fs.existsSync(cached)) throw new Error("ffmpeg 설치에 실패했습니다.");
  return BIN_DIR;
}

// ------- JS 런타임(deno, 선택) -------
function resolveDeno() {
  const candidates = [
    process.env.DENO_BIN,
    "deno",
    path.join(os.homedir(), ".deno", "bin", "deno"),
    path.join(BIN_DIR, isWin ? "deno.exe" : "deno"),
  ].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error) return bin;
  }
  return null;
}

// 모든 도구를 준비. 최초 실행 시 자동 다운로드.
export async function ensureTools(log = () => {}) {
  const ytdlp = await resolveYtDlp(log);
  const ffmpegDir = await resolveFfmpeg(log); // 경로(dir) 또는 null(시스템 PATH)
  const deno = resolveDeno();
  return {
    ytdlp,
    ffmpegDir,
    hasFfmpeg: ffmpegDir !== null || onPath("ffmpeg"),
    deno,
    appDir: APP_DIR,
  };
}
