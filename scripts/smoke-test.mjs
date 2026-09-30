// 설치된 youdown 을 실제로 돌려 보는 스모크 테스트 (CI 의 macOS·Windows·Linux 러너용).
// 앱이 이미 실행 중이라고 가정하고:
//  1) 최초 준비(yt-dlp·ffmpeg·deno 자동 설치)가 끝나는지
//  2) 로컬 테스트 영상으로 음원(MP3)·영상(MP4) 변환이 실제로 되는지
// 를 확인한다. 실패하면 종료 코드 1.
//
// 사용법: node scripts/smoke-test.mjs [포트=3000]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  const r = await fetch(BASE + p, { cache: "no-store" });
  return r;
}
async function postJson(p, body) {
  return fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// 테스트 영상을 제공할 로컬 서버
function serveFixture() {
  const file = path.join(ROOT, "test", "fixtures", "sample.mp4");
  const srv = http.createServer((req, res) => {
    const data = fs.readFileSync(file);
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": data.length });
    res.end(data);
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(srv)));
}

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      const h = await (await get("/api/health")).json();
      if (h.app === "youdown") return h;
    } catch {
      /* 아직 안 뜸 */
    }
    await sleep(1000);
  }
  fail("앱이 응답하지 않습니다 (120초)");
}

async function waitForReady() {
  let last = "";
  for (let i = 0; i < 900; i++) {
    await postJson("/api/ping").catch(() => {});
    const h = await (await get("/api/health")).json();
    if (h.bootError) fail("준비 실패: " + h.bootError);
    if (h.ready) return h;
    const msg = h.bootStatus.replace(/\s*\d+%$/, "");
    if (msg !== last) {
      console.log("  · " + h.bootStatus);
      last = msg;
    }
    await sleep(1000);
  }
  fail("준비가 끝나지 않습니다 (15분)");
}

async function runJob(url, type) {
  const r = await postJson("/api/jobs", { url, type, quality: "best" });
  const { jobId, error } = await r.json();
  if (!jobId) fail(`${type} 작업 생성 실패: ${error}`);
  // 진행률 스트림(SSE)은 작업이 끝나면 서버가 닫는다 → 끝까지 읽으면 됨
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180_000);
  let text = "";
  try {
    text = await (await fetch(`${BASE}/api/jobs/${jobId}/events`, { signal: ctrl.signal })).text();
  } catch {
    fail(`${type} 작업이 180초 안에 끝나지 않습니다`);
  }
  clearTimeout(t);
  if (!text.includes('"status":"done"')) fail(`${type} 작업 실패: ${text.slice(-300)}`);
  const f = await get(`/api/jobs/${jobId}/file`);
  if (f.status !== 200) fail(`${type} 파일을 받지 못했습니다 (HTTP ${f.status})`);
  return Buffer.from(await f.arrayBuffer());
}

const h0 = await waitForApp();
console.log(`✓ 앱 응답 (버전 ${h0.version})`);
const h = await waitForReady();
console.log(`✓ 준비 완료 (ffmpeg:${h.ffmpeg} deno:${h.jsRuntime})`);
if (!h.ffmpeg) fail("ffmpeg 가 준비되지 않았습니다");
if (!h.jsRuntime) fail("deno 가 준비되지 않았습니다");

const srv = await serveFixture();
const url = `http://127.0.0.1:${srv.address().port}/sample.mp4`;

const mp3 = await runJob(url, "audio");
const isMp3 =
  mp3.slice(0, 3).toString() === "ID3" || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0);
if (!isMp3 || mp3.length < 1000) fail(`MP3 가 올바르지 않습니다 (${mp3.length} bytes)`);
console.log(`✓ 음원 변환 OK (${mp3.length} bytes)`);

const mp4 = await runJob(url, "video");
if (mp4.slice(4, 8).toString() !== "ftyp") fail("MP4 가 올바르지 않습니다");
console.log(`✓ 영상 저장 OK (${mp4.length} bytes)`);

srv.close();
console.log("✓ 스모크 테스트 통과");
process.exit(0);
