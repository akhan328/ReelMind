import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createApi, settingsFrom } from './server/api.js'
import { createProfilesApi } from './server/profiles.js'

// Profiles and their "Already seen it" movies are saved here (gitignored)
const PROFILES_FILE = fileURLToPath(new URL('./profiles.json', import.meta.url))

// The app's /api routes (TMDB and Seerr, with the keys added server-side) also
// work in `npm run dev` and `npm run preview`, not just `npm start`
function apiRoutes(env) {
  const api = createApi(settingsFrom(env))
  return {
    name: 'reelmind-api',
    configureServer(server) {
      server.middlewares.use(api)
    },
    configurePreviewServer(server) {
      server.middlewares.use(api)
    },
  }
}

// Adds the /api/profiles routes to `npm run dev` and `npm run preview`,
// so the page can read and save profiles.json
function profilesApi() {
  const api = createProfilesApi(PROFILES_FILE)
  return {
    name: 'reelmind-profiles',
    configureServer(server) {
      server.middlewares.use(api)
    },
    configurePreviewServer(server) {
      server.middlewares.use(api)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Before apiRoutes: that one answers "Not found" for any /api path it doesn't know
    profilesApi(),
    // '' = every variable in .env.local, not just VITE_ ones. They stay on the server.
    apiRoutes(loadEnv(mode, process.cwd(), '')),
  ],
  server: {
    // Saving a profile isn't a code change: don't let it wake up the file watcher
    watch: { ignored: ['**/profiles.json', '**/profiles.json.tmp'] },
  },
}))
