FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
RUN npm ci
COPY shared shared
COPY backend backend
COPY worker worker
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app

FROM runtime AS api
CMD ["node", "backend/dist/main.js"]

FROM runtime AS worker
CMD ["node", "worker/dist/main.js"]
