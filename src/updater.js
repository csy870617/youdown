// 앱 자동 업데이트.
// GitHub 최신 릴리스를 확인해 더 새 버전이 있으면 받아서 실행 중인 앱을
// 새 버전으로 교체(이전 버전은 삭제)하고 다시 시작한다.
//  - Windows: 실행 중인 exe 는 지울 수 없지만 이름은 바꿀 수 있으므로
//             현재 exe → .old 로 바꾸고 새 exe 를 같은 이름으로 둔 뒤 재시작.
//             .old 는 다음 실행 때 지운다.
//  - macOS:   youdown.app 번들을 통째로 새 것으로 바꾼 뒤 재시작.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { spawn } from "node:child_process";
import { download, run } from "./tools.js";

const REPO = "csy870617/youdown";
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

// "1.2.10" > "1.2.9" 처럼 숫자 단위로 비교
export function isNewer(latest, current) {
  const a = String(latest).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(current).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// github.com/.../releases/latest 는 최신 태그 페이지로 리다이렉트된다.
// API(시간당 호출 제한 있음)를 쓰지 않고 그 주소에서 버전을 읽는다.
function latestTag() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://github.com/${REPO}/releases/latest`,
      { method: "HEAD", headers: { "User-Agent": "youdown" } },
      (res) => {
        res.resume();
        const loc = res.headers.location || "";
        const m = loc.match(/\/releases\/tag\/([^/?#]+)/);
        if (m) resolve(decodeURIComponent(m[1]));
        else reject(new Error("최신 버전을 확인하지 못했습니다 (HTTP " + res.statusCode + ")"));
      }
    );
    req.setTimeout(10_000, () => req.destroy(new Error("시간 초과")));
    req.on("error", reject);
    req.end();
  });
}

// 이 플랫폼이 스스로 업데이트할 수 있는 위치에서 실행 중인지
function macBundlePath() {
  // .../youdown.app/Contents/MacOS/youdown-bin-arm64 → .../youdown.app
  const bundle = path.resolve(path.dirname(process.execPath), "..", "..");
  return bundle.endsWith(".app") ? bundle : null;
}

export function canSelfUpdate() {
  if (!process.pkg) return false; // 개발 실행·Docker 에서는 하지 않음
  try {
    if (isWin) {
      fs.accessSync(path.dirname(process.execPath), fs.constants.W_OK);
      return true;
    }
    if (isMac) {
      const b = macBundlePath();
      if (!b || process.execPath.includes("/AppTranslocation/")) return false;
      fs.accessSync(path.dirname(b), fs.constants.W_OK);
      return true;
    }
  } catch {
    /* 쓰기 권한 없음 */
  }
  return false;
}

function assetName() {
  return isWin ? "youdown-win.exe" : isMac ? "youdown-mac.zip" : null;
}

// 최신 릴리스 확인 → { version, url } 또는 null
export async function checkForUpdate(currentVersion) {
  const name = assetName();
  if (!name || !currentVersion) return null;
  const tag = await latestTag();
  const latest = tag.replace(/^v/, "");
  if (!isNewer(latest, currentVersion)) return null;
  return {
    version: latest,
    url: `https://github.com/${REPO}/releases/download/${tag}/${name}`,
  };
}

// 지난 업데이트가 남긴 이전 버전 파일 정리 (Windows)
export function cleanupOldVersion() {
  if (!isWin || !process.pkg) return;
  try {
    fs.rmSync(process.execPath + ".old", { force: true });
  } catch {
    /* 아직 잠겨 있으면 다음에 */
  }
}

// 새 버전을 받아 교체할 준비까지 (서버는 계속 동작)
// 반환: 교체 후 실행할 새 실행파일 경로를 돌려주는 apply() 함수
export async function prepareUpdate(update, onProgress) {
  if (isWin) {
    const exe = process.execPath;
    const next = exe + ".new";
    await download(update.url, next, onProgress);
    return () => {
      fs.rmSync(exe + ".old", { force: true });
      fs.renameSync(exe, exe + ".old"); // 실행 중인 파일도 이름 변경은 가능
      fs.renameSync(next, exe);
      return exe;
    };
  }
  if (isMac) {
    const bundle = macBundlePath();
    const parent = path.dirname(bundle);
    const work = path.join(parent, ".youdown-update");
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const zip = path.join(os.tmpdir(), `youdown-update-${process.pid}.zip`);
    await download(update.url, zip, onProgress);
    await run("ditto", ["-x", "-k", zip, work]);
    fs.rmSync(zip, { force: true });
    const fresh = path.join(work, "youdown.app");
    const binName = path.basename(process.execPath); // youdown-bin-arm64 / -x64
    if (!fs.existsSync(path.join(fresh, "Contents", "MacOS", binName))) {
      throw new Error("받은 업데이트 파일이 올바르지 않습니다.");
    }
    return () => {
      const old = path.join(work, "old.app");
      fs.renameSync(bundle, old); // 같은 볼륨 안에서 이동 → 순식간에 교체
      fs.renameSync(fresh, bundle);
      fs.rmSync(work, { recursive: true, force: true }); // 이전 버전 삭제
      return path.join(bundle, "Contents", "MacOS", binName);
    };
  }
  throw new Error("이 환경에서는 자동 업데이트를 지원하지 않습니다.");
}

// 새 버전을 백그라운드로 실행 (현재 프로세스는 곧 종료)
export function launch(exe) {
  const env = { ...process.env, YOUDOWN_UPDATED: "1", YOUDOWN_NO_OPEN: "1" };
  delete env.YOUDOWN_FAKE_VERSION; // 테스트용 값이 새 버전에 이어지지 않게
  if (isMac) {
    env.YOUDOWN_APP = "1";
    env.YOUDOWN_DETACHED = "1";
  }
  // Windows 는 원래처럼 새 콘솔 창(=닫으면 종료)과 함께 실행
  const child = isWin
    ? spawn("cmd", ["/c", "start", '""', `"${exe}"`], {
        detached: true,
        stdio: "ignore",
        env,
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
    : spawn(exe, [], { detached: true, stdio: "ignore", env });
  child.unref();
}
