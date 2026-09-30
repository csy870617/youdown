; youdown Windows 설치 프로그램 (NSIS)
;  - 관리자 권한 없이 사용자 폴더에 설치 (%LOCALAPPDATA%\Programs\youdown)
;  - 바탕화면·시작 메뉴 바로가기 생성, 설치 끝나면 바로 실행
;  - 제어판 '앱 제거'에 등록
;
; 빌드: makensis -DVERSION=1.1.0 scripts/windows-installer.nsi
;   (dist/youdown-win.exe, assets/icon.ico 필요 → dist/youdown-setup.exe 생성)

Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\youdown"

Name "youdown"
OutFile "../dist/youdown-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\youdown"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "youdown ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1042 "ProductName" "youdown"
VIAddVersionKey /LANG=1042 "FileDescription" "youdown 설치"
VIAddVersionKey /LANG=1042 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "ProductVersion" "${VERSION}"

!define MUI_ICON "../assets/icon.ico"
!define MUI_UNICON "../assets/icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\youdown.exe"
!define MUI_FINISHPAGE_RUN_TEXT "youdown 바로 실행하기"

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

Section "install"
  ; 업데이트 설치 시 실행 중인 youdown 종료 (파일 잠금 방지)
  nsExec::Exec 'taskkill /F /IM youdown.exe'
  Sleep 500

  SetOutPath "$INSTDIR"
  File "/oname=youdown.exe" "../dist/youdown-win.exe"
  File "/oname=youdown.ico" "../assets/icon.ico"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateShortcut "$DESKTOP\youdown.lnk" "$INSTDIR\youdown.exe" "" "$INSTDIR\youdown.ico" 0
  CreateDirectory "$SMPROGRAMS\youdown"
  CreateShortcut "$SMPROGRAMS\youdown\youdown.lnk" "$INSTDIR\youdown.exe" "" "$INSTDIR\youdown.ico" 0
  CreateShortcut "$SMPROGRAMS\youdown\youdown 제거.lnk" "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "youdown"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "youdown"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\youdown.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM youdown.exe'
  Sleep 500
  Delete "$INSTDIR\youdown.exe"
  Delete "$INSTDIR\youdown.ico"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\youdown.lnk"
  RMDir /r "$SMPROGRAMS\youdown"
  ; 앱이 내려받은 구성요소(yt-dlp·ffmpeg·deno)도 함께 정리
  RMDir /r "$PROFILE\.youdown"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
