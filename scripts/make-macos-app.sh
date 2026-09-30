#!/usr/bin/env bash
# pkg 로 만든 macOS 실행파일(Apple Silicon·Intel)을 더블클릭 가능한 youdown.app
# 으로 감싸고, 배포용 zip(터미널 한 줄 설치가 사용)을 만든다.
#
# 사용법: scripts/make-macos-app.sh <arm64 바이너리> <x64 바이너리> <출력 디렉터리>
set -euo pipefail

BIN_ARM64="${1:-dist/youdown-macos-arm64}"
BIN_X64="${2:-dist/youdown-macos-x64}"
OUT="${3:-dist}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$OUT/youdown.app"
VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 1.0.0)"

for b in "$BIN_ARM64" "$BIN_X64"; do
  [ -f "$b" ] || { echo "실행 바이너리를 찾을 수 없습니다: $b" >&2; exit 1; }
done

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# 실제 서버 바이너리 (둘 다 넣고 런처가 골라 실행)
cp "$BIN_ARM64" "$APP/Contents/MacOS/youdown-bin-arm64"
cp "$BIN_X64" "$APP/Contents/MacOS/youdown-bin-x64"
chmod +x "$APP/Contents/MacOS/youdown-bin-"*

# 앱 아이콘
if [ -f "$ROOT/assets/icon.icns" ]; then
  cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/icon.icns"
fi

# 앱의 진입점(런처)
cat > "$APP/Contents/MacOS/youdown" <<'SH'
#!/bin/bash
# Apple Silicon 이면 네이티브(arm64) 빌드, 아니면 Intel 빌드를 실행.
# (Rosetta 가 없어도 동작)
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
  BIN="$DIR/youdown-bin-arm64"
else
  BIN="$DIR/youdown-bin-x64"
fi
mkdir -p "$HOME/.youdown"
# YOUDOWN_APP=1 → 서버가 스스로 백그라운드로 분리되고, 이미 켜져 있으면
# 브라우저만 열고 끝낸다. 로그는 ~/.youdown/youdown.log 에 남는다.
export YOUDOWN_APP=1
exec "$BIN" >/dev/null 2>&1
SH
chmod +x "$APP/Contents/MacOS/youdown"

# 앱 메타데이터 (LSUIElement: 독에 아이콘을 띄우지 않음 — 창 없이 브라우저로 동작)
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>youdown</string>
  <key>CFBundleDisplayName</key><string>youdown</string>
  <key>CFBundleIdentifier</key><string>com.youdown.app</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleExecutable</key><string>youdown</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# 1) zip — 한 줄 설치 스크립트가 사용 (실행 권한·서명 보존)
rm -f "$OUT/youdown-mac.zip"
if command -v ditto >/dev/null 2>&1; then
  ( cd "$OUT" && ditto -c -k --keepParent youdown.app youdown-mac.zip )
else
  ( cd "$OUT" && zip -qry youdown-mac.zip youdown.app )
fi
echo "생성: $OUT/youdown-mac.zip"
