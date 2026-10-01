# Multi-stage production Dockerfile for Omnysync ERP Platform
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and workspace package files
COPY package*.json ./
COPY packages/contracts/package*.json ./packages/contracts/
COPY packages/financial-engine/package*.json ./packages/financial-engine/
COPY packages/platform/package*.json ./packages/platform/
COPY packages/ui/package*.json ./packages/ui/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

# Install all dependencies across workspaces
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY vitest*.ts ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Build all workspaces (contracts -> financial-engine -> platform -> ui -> api -> web)
RUN npm run build

# Production Runner Stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV KEEP_ALIVE_ENABLED=true
ENV KEEP_ALIVE_INTERVAL_MINUTES=10

# Copy root package files
COPY package*.json ./
COPY packages/contracts/package*.json ./packages/contracts/
COPY packages/financial-engine/package*.json ./packages/financial-engine/
COPY packages/platform/package*.json ./packages/platform/
COPY packages/ui/package*.json ./packages/ui/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

# Install production-only dependencies
RUN npm ci --omit=dev

# Copy built dist artifacts and migration files
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/financial-engine/dist ./packages/financial-engine/dist
COPY --from=builder /app/packages/platform/dist ./packages/platform/dist
COPY --from=builder /app/packages/platform/src/db/migrations ./packages/platform/src/db/migrations
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:10000/health || exit 1

CMD ["npm", "run", "start"]
