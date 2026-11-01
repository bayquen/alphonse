# syntax=docker/dockerfile:1

# ---------- Stage 1: build (compiler + dev dependencies live and die here) ----------
FROM node:24-trixie-slim AS build
WORKDIR /app

# Copy only the dependency manifests first so Docker can cache `npm ci`
# until package*.json actually changes.
COPY package.json package-lock.json ./
RUN npm ci

# Now the source. Changing code won't re-run npm ci.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build            # tsc -> /app/dist

# ---------- Stage 2: runtime (what actually ships) ----------
FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production \
    GIT_TERMINAL_PROMPT=0
# GIT_TERMINAL_PROMPT=0: if git ever wants a username/password it fails
# immediately instead of hanging forever waiting for keyboard input.

# Your code shells out to `git clone` (src/github.ts), and slim has no git.
# ca-certificates lets git verify github.com's HTTPS certificate.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# built-in non-root user (uid 1000)
USER node

# Default = the web service. Render's per-service "Docker Command"
# replaces this for the two workers.
CMD ["node", "dist/app.js"]