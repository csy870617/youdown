#!/bin/bash
# youdown 한 줄 설치 (macOS)
#   curl -fsSL https://raw.githubusercontent.com/csy870617/youdown/HEAD/scripts/install-mac.sh | bash
#
# 최신 버전을 내려받아 '응용 프로그램' 폴더에 설치하고 바로 실행한다.
# (브라우저가 아닌 curl 로 받기 때문에 "확인할 수 없음" 경고가 뜨지 않음)
set -euo pipefail

URL="https://github.com/csy870617/youdown/releases/latest/download/youdown-mac.zip"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "이 설치 스크립트는 macOS 전용입니다." >&2
  exit 1
fi

echo ""
echo "  youdown 설치를 시작합니다…"
echo ""

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "${YOUDOWN_ZIP:-}" ]; then
  cp "$YOUDOWN_ZIP" "$TMP/youdown-mac.zip"   # 테스트용: 로컬 zip 사용
else
  curl -fL --progress-bar -o "$TMP/youdown-mac.zip" "$URL"
fi

# 실행 중인 youdown 이 있으면 종료 (업데이트 설치 대비)
pkill -f "youdown.app/Contents/MacOS/youdown-bin" 2>/dev/null || true

# 관리자 권한 없이 쓸 수 있는 곳에 설치
DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

rm -rf "$DEST/youdown.app"
ditto -x -k "$TMP/youdown-mac.zip" "$DEST"
xattr -dr com.apple.quarantine "$DEST/youdown.app" 2>/dev/null || true
# youdown:// 링크(다운로드 페이지의 'youdown 실행' 버튼) 등록
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$DEST/youdown.app" 2>/dev/null || true

echo ""
echo "  ✅ 설치 완료: $DEST/youdown.app"
echo "  youdown 을 실행합니다. (다음부터는 Launchpad 나 Spotlight 에서 'youdown' 으로 실행)"
echo ""

[ -n "${YOUDOWN_NO_LAUNCH:-}" ] || open "$DEST/youdown.app"
