# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_MAPBOX_ACCESS_TOKEN
ARG VITE_DISTRACOM_ICON_URL
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    DEPLOY_TARGET=node \
	VITE_API_URL=${VITE_API_URL} \
	VITE_SOCKET_URL=${VITE_SOCKET_URL} \
	VITE_MAPBOX_ACCESS_TOKEN=${VITE_MAPBOX_ACCESS_TOKEN} \
	VITE_DISTRACOM_ICON_URL=${VITE_DISTRACOM_ICON_URL}
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	BODY_SIZE_LIMIT=20M
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "build"]
