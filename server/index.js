// Production server: serves the built app (dist/) and the /api routes.
//   npm run build
//   npm start
// Settings come from environment variables, or .env.local in the project folder:
//   TMDB_TOKEN      TMDB API Read Access Token
//   SEERR_URL       e.g. http://seerr:5055 (optional: no "Request it" without it)
//   SEERR_API_KEY   Seerr -> Settings -> General -> API Key
//   PORT            default 4173

import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi, settingsFrom } from './api.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const envFile = path.join(root, '.env.local')
if (existsSync(envFile)) process.loadEnvFile(envFile) // doesn't override real environment variables

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

// A file from dist/, or index.html for anything else (it's a one-page app)
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    return res.end()
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    res.writeHead(400)
    return res.end()
  }
  let file = path.join(dist, pathname)
  if (!file.startsWith(dist + path.sep) || !isFile(file)) file = path.join(dist, 'index.html')

  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    // Built assets have a hash in their name, so they never change
    'cache-control': file.startsWith(path.join(dist, 'assets') + path.sep)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

if (!isFile(path.join(dist, 'index.html'))) {
  console.error('No built app found in dist/. Run `npm run build` first.')
  process.exit(1)
}

const settings = settingsFrom(process.env)
const api = createApi(settings)
const port = Number(process.env.PORT) || 4173

http
  .createServer((req, res) => api(req, res, () => serveStatic(req, res)))
  .listen(port, () => {
    console.log(`ReelMind is running on http://localhost:${port}`)
    if (!settings.tmdbToken) console.warn('  No TMDB token: set TMDB_TOKEN')
    console.log(
      settings.seerrUrl && settings.seerrApiKey
        ? `  Seerr: ${settings.seerrUrl}`
        : '  Seerr: not set up (set SEERR_URL and SEERR_API_KEY for "Request it")',
    )
  })
