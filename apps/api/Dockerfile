# ==============================================================================
# Web2APK API Gateway Production Image
# Multi-stage minimal Node.js 20 Alpine
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/

# Install dependencies and build TypeScript
RUN npm install --workspace=@web2apk/api

COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npm run build

# ==============================================================================
# Runtime Stage
# ==============================================================================
FROM node:20-alpine AS runner

RUN apk add --no-cache curl

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
RUN npm install --omit=dev --workspace=@web2apk/api

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

# Run as non-privileged system user 'node'
USER node

WORKDIR /app/apps/api

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

CMD ["node", "dist/index.js"]
