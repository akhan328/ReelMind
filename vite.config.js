import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createApi, settingsFrom } from './server/api.js'

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // '' = every variable in .env.local, not just VITE_ ones. They stay on the server.
  plugins: [react(), apiRoutes(loadEnv(mode, process.cwd(), ''))],
}))
