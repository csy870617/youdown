// youdown:// 링크 등록.
// 다운로드 페이지의 'youdown 실행' 버튼이 설치된 앱을 바로 켤 수 있게,
// 운영체제에 youdown:// 주소를 이 실행 파일로 연결해 둔다.
//  - Windows: 현재 사용자 레지스트리(HKCU)에 등록 — 관리자 권한 불필요.
//             파일을 옮겨도 다음 실행 때 새 위치로 다시 등록된다.
//  - macOS:   Info.plist 의 CFBundleURLTypes 로 선언되어 있고, 자동 업데이트로
//             번들이 바뀐 경우를 대비해 LaunchServices 에 다시 알린다.
import path from "node:path";
import { execFile } from "node:child_process";

const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function exec(cmd, args) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, timeout: 15_000 }, (err) =>
      err ? reject(err) : resolve()
    )
  );
}

export async function registerLaunchLink() {
  if (!process.pkg) return; // 개발 실행·Docker 에서는 하지 않음
  try {
    if (process.platform === "win32") {
      const key = "HKCU\\Software\\Classes\\youdown";
      const exe = process.execPath;
      await exec("reg", ["add", key, "/ve", "/d", "URL:youdown", "/f"]);
      await exec("reg", ["add", key, "/v", "URL Protocol", "/d", "", "/f"]);
      await exec("reg", ["add", key + "\\DefaultIcon", "/ve", "/d", `"${exe}",0`, "/f"]);
      await exec("reg", ["add", key + "\\shell\\open\\command", "/ve", "/d", `"${exe}"`, "/f"]);
    } else if (process.platform === "darwin") {
      // .../youdown.app/Contents/MacOS/youdown-bin-* → .../youdown.app
      const bundle = path.resolve(path.dirname(process.execPath), "..", "..");
      if (bundle.endsWith(".app")) await exec(LSREGISTER, ["-f", bundle]);
    }
  } catch (e) {
    console.log("  · youdown:// 링크 등록 실패(무시): " + (e.message || e));
  }
}
