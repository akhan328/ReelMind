import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createProfilesApi } from './server/profiles.js'

// Profiles and their "Already seen it" movies are saved here (gitignored)
const PROFILES_FILE = fileURLToPath(new URL('./profiles.json', import.meta.url))

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
export default defineConfig({
  plugins: [react(), profilesApi()],
  server: {
    // Saving a profile isn't a code change: don't let it wake up the file watcher
    watch: { ignored: ['**/profiles.json', '**/profiles.json.tmp'] },
  },
})
