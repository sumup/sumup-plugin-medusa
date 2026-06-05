# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim
WORKDIR /app

COPY server.js ./server.js
COPY public ./public

EXPOSE 8080
CMD ["node", "server.js"]
