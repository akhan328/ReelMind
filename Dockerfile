# ReelMind in one container: the built quiz plus its small server (server/).
# Settings come from environment variables: TMDB_TOKEN, SEERR_URL,
# SEERR_API_KEY, PORT (see README.md).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4173
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4173
CMD ["node", "server/index.js"]
