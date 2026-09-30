# youdown

유튜브 링크를 붙여넣으면 **영상(MP4)** 또는 **음원(MP3)** 으로 내려받을 수 있는 웹 페이지입니다.

<p align="center">링크 입력 → 정보 확인 → 형식 선택 → 실시간 진행률 → 저장</p>

## 특징

- 🔗 링크 붙여넣기 한 번으로 제목·썸네일·길이 미리보기
- 🎬 영상은 MP4 (최고화질 / 1080p / 720p / 480p / 360p 선택)
- 🎵 음원은 MP3 로 추출
- 📊 다운로드 진행률 실시간 표시 (SSE)
- 🖱 **더블클릭 실행** — 실행하면 브라우저가 자동으로 열림
- 📦 **설치 불필요** — 최초 실행 시 yt-dlp·ffmpeg 를 자동으로 내려받음

## 다운로드해서 바로 쓰기 (권장)

### 👉 [다운로드 페이지](https://csy870617.github.io/youdown/) — 이 링크 하나만 공유하세요

**Mac** — 터미널(⌘+스페이스 → "터미널")에 붙여넣고 Enter. 설치 후 바로 실행됩니다.

```bash
curl -fsSL https://raw.githubusercontent.com/csy870617/youdown/HEAD/scripts/install-mac.sh | bash
```

다음부터는 Launchpad·Spotlight 에서 **youdown** 으로 실행. 보안 경고 없이 설치됩니다.

**Windows** — [`youdown-win.exe`](https://github.com/csy870617/youdown/releases/latest/download/youdown-win.exe) 를 받아 더블클릭. 설치 과정 없이 바로 실행됩니다.
("Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**. 함께 뜨는 검은 창을 닫으면 종료)

사용 방법:
- 실행하면 **브라우저가 자동으로 열립니다.** 링크를 붙여넣고 영상/음원을 받으세요.
- **처음 한 번만** 필요한 구성요소(yt-dlp·ffmpeg·deno, 약 200MB)를 자동으로 받습니다(1~3분).
- 이미 켜져 있을 때 다시 실행하면 **창만 다시 열립니다.**
- **브라우저 탭을 닫으면** 약 10분 뒤 **자동으로 종료**됩니다.
- **자동 업데이트:** 켤 때 새 버전이 있으면 스스로 받아 교체하고(이전 버전 자동 삭제) 다시 시작합니다. 다시 내려받을 필요가 없습니다.
- 문제가 생기면 `~/.youdown/youdown.log` 를 확인하세요.

## 개발자용 실행 (소스에서)

Node.js 18+ 가 있으면 소스로도 실행할 수 있습니다.

```bash
npm install
npm start        # 브라우저 자동 오픈
```

- 포트 변경: `PORT=8080 npm start`
- 브라우저 자동 오픈 끄기: `YOUDOWN_NO_OPEN=1 npm start`
- yt-dlp / ffmpeg 를 직접 설치해 두면(PATH 에 있으면) 자동 다운로드를 건너뜁니다.

## 실행파일 직접 빌드

```bash
npm install
npm run build          # dist/ 에 3개 OS 실행파일 생성
# 또는 특정 OS만: npm run build:win / build:mac / build:linux
```

> Actions 의 **Release** 워크플로를 실행하면(또는 `v1.1.0` 같은 태그 푸시) Mac(한 줄 설치용 .zip)·
> Windows(.exe) 파일을 만들고 **실제 macOS·Windows 러너에
> 설치해 도구 자동 설치와 변환까지 테스트한 뒤**, 통과하면 Releases 에 올립니다.
> 다운로드 페이지(`site/`)는 `pages.yml` 로 GitHub Pages 에 배포됩니다.

## 구조

```
youdown/
├─ server.js          # Express 서버 + yt-dlp 연동, 진행률 SSE, 자동 오픈
├─ src/
│  ├─ tools.js        # yt-dlp·ffmpeg 자동 탐색/다운로드
│  └─ open.js         # 기본 브라우저 자동 실행
├─ public/
│  ├─ index.html      # 페이지
│  ├─ style.css       # 스타일
│  └─ app.js          # 프론트엔드 로직 (준비 상태 폴링 포함)
├─ Dockerfile         # 서버 배포용 이미지
├─ render.yaml        # Render 배포 설정
├─ .github/workflows/release.yml  # 실행파일 자동 빌드·릴리스
├─ package.json
└─ README.md
```

### API 개요

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/api/info` | `{ url }` → 제목·썸네일·길이 등 메타데이터 |
| `POST` | `/api/jobs` | `{ url, type, quality }` → 다운로드 작업 시작, `{ jobId }` 반환 |
| `GET` | `/api/jobs/:id/events` | 진행률 실시간 스트림 (Server-Sent Events) |
| `GET` | `/api/jobs/:id/file` | 완료된 파일 다운로드 |
| `GET` | `/api/health` | yt-dlp / ffmpeg 설치 여부 |

`type` 은 `video` 또는 `audio`, `quality` 는 `best` / `1080` / `720` / `480` / `360` 입니다.

## 온라인 배포 (GitHub → 클라우드 호스팅)

> ⚠️ **GitHub Pages 로는 배포할 수 없습니다.** 이 앱은 서버(`yt-dlp` 실행)가
> 필요하므로 정적 호스팅이 아닌 **컨테이너/서버 호스팅**이 필요합니다.
> 저장소에 `Dockerfile` 이 포함되어 있어 아래 플랫폼 어디서든 배포됩니다.

### Render (무료, 가장 간단)

1. 이 저장소를 GitHub 에 올립니다.
2. [render.com](https://render.com) → **New → Blueprint** → 이 저장소 선택.
3. 저장소의 `render.yaml` 을 읽어 자동으로 빌드·배포합니다.
4. 몇 분 뒤 `https://youdown-xxxx.onrender.com` 같은 공개 URL 이 생깁니다.

> Railway, Fly.io, Google Cloud Run 등도 같은 `Dockerfile` 로 배포됩니다.

### ⚠️ 배포 시 반드시 알아야 할 점 — 유튜브 봇 차단

배포된 서버는 **데이터센터 IP** 를 쓰기 때문에 유튜브가 자주
`Sign in to confirm you're not a bot` / `HTTP 403` 으로 **다운로드를 차단**합니다.
이를 우회하려면 **로그인 상태의 쿠키**를 서버에 넣어줘야 합니다.

1. 브라우저 확장([Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) 등)으로
   유튜브에 로그인한 상태의 `cookies.txt`(Netscape 형식)를 내보냅니다.
2. base64 로 인코딩합니다.
   ```bash
   base64 -w0 cookies.txt        # 리눅스
   base64 -i cookies.txt         # macOS
   ```
3. 호스팅 대시보드(Render → Environment)에서 환경변수를 추가합니다.
   - `YTDLP_COOKIES_B64` = 위에서 얻은 base64 문자열
   - 또는 파일을 직접 마운트할 수 있으면 `YTDLP_COOKIES_FILE=/path/cookies.txt`

> 쿠키는 만료되면 다시 갱신해야 합니다. 부계정 사용을 권장합니다(계정이
> 비정상 트래픽으로 제한될 수 있음). 쿠키 없이도 서버는 뜨지만, 유튜브
> 영상 다운로드는 대부분 실패합니다.

### 환경변수 정리

| 변수 | 설명 |
| --- | --- |
| `PORT` | 서버 포트 (호스팅 플랫폼이 자동 주입, 기본 3000) |
| `YTDLP_COOKIES_B64` | 쿠키 파일(cookies.txt) 내용을 base64 로 인코딩한 값 |
| `YTDLP_COOKIES_FILE` | 쿠키 파일 경로 (파일 마운트가 가능한 환경용) |

### 로컬에서 Docker 로 실행

```bash
docker build -t youdown .
docker run -p 3000:3000 -e YTDLP_COOKIES_B64="$(base64 -w0 cookies.txt)" youdown
```

## 주의 (저작권)

이 도구는 개인적·합법적 용도로만 사용해야 합니다. 저작권이 있는 콘텐츠는
저작권자의 허락 또는 정당한 권리 범위 내에서만 내려받으세요. 유튜브 서비스
약관도 함께 확인하시기 바랍니다.
