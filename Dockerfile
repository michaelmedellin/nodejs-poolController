FROM node:18 AS build-env
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm ci --production

FROM gcr.io/distroless/nodejs:18
USER node
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build-env /app ./
CMD ["dist/app.js"]
