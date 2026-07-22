# youdown 배포용 이미지
# Render / Railway / Fly.io / Google Cloud Run 등 컨테이너 호스팅에서 사용
FROM node:20-slim

# 시스템 의존성:
#  - ffmpeg   : 영상 병합 · MP3 변환
#  - python3  : yt-dlp 실행에 필요
#  - curl/ca-certificates : yt-dlp / deno 설치
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp 최신 바이너리
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp

# deno (유튜브 서명/nsig 해독용 JS 런타임) — 유튜브 호환성 향상
RUN curl -fsSL https://deno.land/install.sh | sh \
 && ln -s /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# 호스팅 플랫폼이 PORT 를 주입합니다 (Render/Railway 등). 기본값 3000.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
