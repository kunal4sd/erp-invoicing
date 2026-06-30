# ── Stage 1: build ────────────────────────────────────────────────────────────
# Use Debian-based image (bookworm-slim) instead of Alpine.
# Prisma 5 ships glibc + OpenSSL binaries; Alpine (musl) cannot load them.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install openssl so prisma generate can locate it at build time
RUN apt-get update -y && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Use npm ci for reproducible installs (requires package-lock.json)
RUN npm ci

COPY . .
# Generate Prisma client for the target platform (debian-openssl-3.0.x)
RUN npx prisma generate
# Compile TypeScript → dist/
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# openssl required for Prisma query engine; curl required for healthcheck
RUN apt-get update -y && apt-get install -y openssl curl --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Strip devDependencies (jest, ts-node, typescript, etc.) — not needed at runtime
RUN npm prune --omit=dev

EXPOSE 3001

# On startup: run migrations (idempotent), seed demo data (upserts = idempotent), then start API.
# Seed runs with ; so the server always starts even on subsequent runs where seed is a no-op.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/prisma/seed.js; node dist/src/server.js"]
