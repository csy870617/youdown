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

Node.js 같은 걸 설치할 필요 없이 **실행파일 하나만 내려받아 실행**하면 됩니다.

1. **[Releases](../../releases)** 에서 내 OS 에 맞는 파일을 받습니다.
   - Windows → `youdown-win.exe`
   - macOS → `youdown-mac.zip` (압축을 풀면 `youdown.app`)
   - Linux → `youdown-linux`
2. 실행합니다.
   - Windows: `youdown-win.exe` **더블클릭**
   - macOS: `youdown-mac.zip` 더블클릭해 압축 해제 → 나온 **`youdown.app` 더블클릭**
   - Linux: 터미널에서 `chmod +x youdown-linux && ./youdown-linux`
3. 잠시 뒤 브라우저가 열리면, 유튜브 링크를 붙여넣고 영상/음원을 받습니다.

> **최초 실행 1회**만 필수 구성요소(yt-dlp·ffmpeg)를 자동으로 내려받습니다(수십 MB,
> 인터넷 필요). 화면에 "최초 실행 준비 중" 이 표시되며, 끝나면 바로 사용할 수 있습니다.

> **OS 보안 경고 안내** (서명되지 않은 개인 배포라 나타나는 정상 경고)
> - Windows: "Windows의 PC 보호" 창이 뜨면 → **추가 정보 → 실행**.
> - macOS: `youdown.app` 을 **우클릭(Control+클릭) → 열기** → 다시 **열기**.
>   또는 **시스템 설정 → 개인정보 보호 및 보안** 하단의 **"확인 없이 열기"**.

> **문제 진단**: 앱 실행 중 생기는 모든 기록은 `~/.youdown/youdown.log` 파일에
> 남습니다(터미널 없이도 확인 가능). 문제가 생기면 이 파일을 열어보세요.

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

> GitHub 에 `v1.0.0` 같은 **태그를 푸시하면** Actions 가 3개 OS 실행파일을 자동
> 빌드해 Releases 에 올립니다(`.github/workflows/release.yml`).

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
