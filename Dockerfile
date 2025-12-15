FROM node:20 AS build-env
WORKDIR /app
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20 AS ts-remover
WORKDIR /app
COPY --from=build-env /app/ ./
RUN npm prune --omit=dev

FROM gcr.io/distroless/nodejs20-debian12
LABEL org.opencontainers.image.title="nodejs-poolController"
LABEL org.opencontainers.image.description="Bridge Pentair / compatible pool automation equipment to modern interfaces (REST, WebSockets, MQTT, Influx, Rules)."
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
LABEL org.opencontainers.image.source="https://github.com/tagyoureit/nodejs-poolController"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=ts-remover /app ./
USER nonroot
CMD ["dist/app.js"]
