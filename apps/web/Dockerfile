# ==============================================================================
# Web2APK Web Frontend Production Image
# Multi-stage Vite build + Nginx Alpine
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/web/package*.json ./apps/web/

RUN npm install --workspace=@web2apk/web

COPY apps/web ./apps/web
WORKDIR /app/apps/web

RUN npm run build

# ==============================================================================
# Production Nginx Runtime Stage
# ==============================================================================
FROM nginx:1.25-alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q -O - http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
