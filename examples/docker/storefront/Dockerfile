# syntax=docker/dockerfile:1
FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
WORKDIR /app

COPY server.js ./server.js
COPY public ./public

EXPOSE 8080
CMD ["node", "server.js"]
