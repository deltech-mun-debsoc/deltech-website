# The production image for our AWS host (docs/AWS.md). One image per
# environment: NEXT_PUBLIC_* values and APP_ENV are inlined at build time, so
# staging and production are built separately from the same commit.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_ENV
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV APP_ENV=$APP_ENV \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
# The build never connects to a database (same as CI); it only needs the
# variables to exist.
RUN npx prisma generate && \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    DIRECT_URL=postgresql://build:build@localhost:5432/build \
    npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ARG APP_ENV
ARG NEXT_PUBLIC_APP_URL
# AUTH_TRUST_HOST: off Vercel, Auth.js rejects every request unless told to
# trust the Host header. Caddy only forwards our own hostnames, so it is safe.
# AUTH_URL: a standalone server's request.url is its bind address
# (http://0.0.0.0:3000), and Auth.js would put that into every sign-in redirect
# and callbackUrl. Each container serves exactly one hostname, so pinning it is
# safe here -- unlike Vercel, where docs/CI.md forbids it.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AUTH_TRUST_HOST=true \
    AUTH_URL=$NEXT_PUBLIC_APP_URL \
    APP_ENV=$APP_ENV
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/signin').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
