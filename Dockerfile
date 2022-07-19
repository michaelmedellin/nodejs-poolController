FROM node:18 AS build-env
WORKDIR /app
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci 
COPY . ./
RUN npm run build

FROM gcr.io/distroless/nodejs:18
WORKDIR /app
COPY --chown=node:node --from=build-env /app ./
USER node
CMD ["dist/app.js"]
