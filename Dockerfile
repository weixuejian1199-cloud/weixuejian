# ============================================================
# 企业AI工作站 Backend Dockerfile (multi-stage)
# ============================================================

# --- Stage: base ---
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# --- Stage: deps (install dependencies) ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter backend --filter shared

# --- Stage: development ---
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "--filter", "backend", "dev"]

# --- Stage: build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter backend build

# --- Stage: production ---
FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/backend/package.json ./packages/backend/
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml ./
COPY --from=build /app/pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --filter backend --prod

EXPOSE 3000
USER node
CMD ["node", "packages/backend/dist/app.js"]
