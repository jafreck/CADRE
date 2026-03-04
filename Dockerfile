# --- Build stage ---
FROM node:20 AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
COPY packages/ ./packages/

RUN npm ci
RUN npm run build

# --- Runtime stage ---
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git \
      openssh-client \
      ca-certificates \
      curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/ ./packages/
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/

ENTRYPOINT ["node", "dist/index.js", "run", "-c", "/config/cadre.config.json"]
