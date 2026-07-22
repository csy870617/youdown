#!/usr/bin/env bash
# pkg 로 만든 macOS 실행 바이너리를 더블클릭 가능한 .app 번들로 감싸고 zip 으로 압축.
# 사용법: scripts/make-macos-app.sh <바이너리경로> <출력디렉터리>
set -euo pipefail

BIN="${1:-dist/youdown-macos}"
OUT="${2:-dist}"
APP="$OUT/youdown.app"

if [ ! -f "$BIN" ]; then
  echo "실행 바이너리를 찾을 수 없습니다: $BIN" >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

# 실제 서버 바이너리
cp "$BIN" "$APP/Contents/MacOS/youdown-bin"
chmod +x "$APP/Contents/MacOS/youdown-bin"

# 앱의 진입점(런처): 출력을 로그 파일로 남기고 서버 바이너리 실행
cat > "$APP/Contents/MacOS/youdown" <<'SH'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.youdown"
exec "$DIR/youdown-bin" >> "$HOME/.youdown/youdown.log" 2>&1
SH
chmod +x "$APP/Contents/MacOS/youdown"

# 앱 메타데이터
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>youdown</string>
  <key>CFBundleDisplayName</key><string>youdown</string>
  <key>CFBundleIdentifier</key><string>com.youdown.app</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleExecutable</key><string>youdown</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
</dict>
</plist>
PLIST

# zip 으로 압축 (실행 권한 보존: -y 로 심볼릭 링크 유지, 유닉스 퍼미션 보존)
( cd "$OUT" && rm -f youdown-mac.zip && zip -r -y youdown-mac.zip youdown.app >/dev/null )
echo "생성 완료: $OUT/youdown-mac.zip"
