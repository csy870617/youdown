import { spawn } from "node:child_process";

// 기본 브라우저로 URL 열기 (플랫폼별)
export function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* 브라우저 자동 실행 실패는 치명적이지 않음 */
  }
}
