FROM node:18 AS build-env
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18 AS ts-remover
WORKDIR /app
COPY --from=ts-remover /app/package*.json ./
COPY --from=ts-remover /app/dist ./
RUN npm ci --production

FROM gcr.io/distroless/nodejs:18
USER node
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=ts-remover /app ./
CMD ["dist/app.js"]
