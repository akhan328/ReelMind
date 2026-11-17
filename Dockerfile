# ReelMind in one container: the built quiz plus its small server (server/).
# Settings come from environment variables: TMDB_TOKEN, SEERR_URL,
# SEERR_API_KEY, PORT (see README.md). Profiles are saved in /app/data:
# mount a volume there to keep them.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4173 PROFILES_FILE=/app/data/profiles.json
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist
# The one folder the app writes to (profiles.json), owned by the user it runs as
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4173
CMD ["node", "server/index.js"]
