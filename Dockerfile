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
RUN pnpm --filter backend prisma:generate
RUN pnpm --filter backend build

# --- Stage: production ---
FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/backend/package.json ./packages/backend/
COPY --from=build /app/packages/backend/node_modules/.prisma ./packages/backend/node_modules/.prisma
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml ./
COPY --from=build /app/pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --filter backend --prod

COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "packages/backend/dist/app.js"]
