# Postly — multi-stage production build
# Stage 1: build TypeScript
FROM node:22-alpine AS builder
WORKDIR /app

# Copia package files primeiro pra cache de layers
COPY package*.json ./
COPY tsconfig*.json ./

RUN npm ci

# Copia source + scripts (scripts precisam estar disponíveis pro runtime rodar migrate/seed)
COPY src ./src
COPY scripts ./scripts
COPY supabase ./supabase

RUN npm run build

# Stage 2: runtime enxuto
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Instala só deps de produção
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia dist do builder
COPY --from=builder /app/dist ./dist
# Copia migrations pra poder rodar via npm run migrate no servidor
COPY --from=builder /app/supabase ./supabase
COPY --from=builder /app/scripts ./scripts
# tsx é dev, então copia do builder completo pra rodar scripts (migrate/seed)
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv

# Health check simples
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

EXPOSE 3000

# Usuário não-root (segurança)
USER node

CMD ["node", "dist/server.js"]