# SMART-ER — one image serving the API, the realtime channel and the web app.
#
# Two stages: the first installs every dependency and builds all three
# packages; the second keeps the build output and the production dependencies
# only. The directory layout is preserved because the server locates the web
# build relative to its own compiled output.

FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so a change to source does not invalidate the install layer.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./
# Drop everything only needed to build. The core package's postinstall would
# try to rebuild, so prune with scripts disabled.
RUN npm prune --omit=dev --ignore-scripts

# The platform overrides this; it is the default for a plain `docker run`.
ENV PORT=4000
EXPOSE 4000

# SQLite lives here. Mount a volume to keep accounts and run history across
# restarts; without one the seed is rewritten each time the container starts.
ENV DATABASE_PATH=/app/data/smart-er.db
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
