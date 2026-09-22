FROM node:lts-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY lofi.mp3 ./lofi.mp3
COPY README.md TERMS_OF_SERVICE.md ./

ENV NODE_ENV=production

CMD ["npm", "start"]
