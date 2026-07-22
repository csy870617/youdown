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

## 주의 (저작권)

이 도구는 개인적·합법적 용도로만 사용해야 합니다. 저작권이 있는 콘텐츠는
저작권자의 허락 또는 정당한 권리 범위 내에서만 내려받으세요. 유튜브 서비스
약관도 함께 확인하시기 바랍니다.
