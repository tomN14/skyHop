# One URL: game + WebSocket + accounts on the same process (TLS via your platform)
FROM node:22-alpine
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY textures ./textures
COPY index.html stages.js stages-extra.js stages-36-50.js ./
COPY js ./js

WORKDIR /app/server
ENV SKYHOP_RACE_HOST=0.0.0.0
ENV SKYHOP_STATIC_ROOT=/app
EXPOSE 3001
CMD ["node", "index.js"]
