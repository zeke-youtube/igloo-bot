FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY README.md TERMS_OF_SERVICE.md ./

ENV NODE_ENV=production

CMD ["npm", "start"]
