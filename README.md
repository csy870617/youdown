# youdown

유튜브 링크를 붙여넣으면 **영상(MP4)** 또는 **음원(MP3)** 으로 내려받을 수 있는 웹 페이지입니다.

<p align="center">링크 입력 → 정보 확인 → 형식 선택 → 실시간 진행률 → 저장</p>

## 특징

- 🔗 링크 붙여넣기 한 번으로 제목·썸네일·길이 미리보기
- 🎬 영상은 MP4 (최고화질 / 1080p / 720p / 480p / 360p 선택)
- 🎵 음원은 MP3 로 추출 (ffmpeg 있을 때)
- 📊 다운로드 진행률 실시간 표시 (SSE)
- 📱 모바일 대응 반응형 UI

## 요구 사항

| 도구 | 용도 | 설치 |
| --- | --- | --- |
| Node.js 18+ | 서버 실행 | https://nodejs.org |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 다운로드 엔진 (필수) | `pip install yt-dlp` |
| [ffmpeg](https://ffmpeg.org) | 고화질 병합 · MP3 변환 (권장) | `apt install ffmpeg` / `brew install ffmpeg` |

> ffmpeg 이 없어도 동작합니다. 이 경우 영상은 단일 스트림(오디오·비디오가 이미 합쳐진 포맷), 음원은 원본 오디오(m4a 등)로 제공됩니다.

## 실행

```bash
npm install
npm start
# 브라우저에서 http://localhost:3000 접속
```

포트를 바꾸려면 `PORT=8080 npm start` 처럼 환경변수를 지정하세요.

## 구조

```
youdown/
├─ server.js          # Express 서버 + yt-dlp 연동, 진행률 SSE
├─ public/
│  ├─ index.html      # 페이지
│  ├─ style.css       # 스타일
│  └─ app.js          # 프론트엔드 로직
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
