FROM node:18 AS build-env
WORKDIR /app
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18 AS ts-remover
WORKDIR /app
COPY --from=build-env /app/ ./
RUN npm ci --omit-dev

FROM gcr.io/distroless/nodejs:18
ENV NODE_ENV=production
WORKDIR /app
COPY --from=ts-remover /app ./
CMD ["dist/app.js"]