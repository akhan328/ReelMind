// ReelMind's own small API. It runs on the server (server/index.js, and inside
// `npm run dev`), so the TMDB token and the Seerr API key never reach the browser.
//
//   GET  /api/tmdb/...               TMDB, with the token added here
//   GET  /api/seerr/movie/:tmdbId    is the movie on your server, requested, or neither?
//   POST /api/seerr/request          { tmdbId }: request it in Seerr

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TIMEOUT_MS = 15_000

// Only the TMDB calls the app makes, so the token can't be used for anything else
const TMDB_PATHS = [/^\/discover\/movie$/, /^\/movie\/\d+$/, /^\/movie\/\d+\/recommendations$/]

// Seerr's media status (MediaStatus in Seerr's code) -> what ReelMind shows.
// Anything else (1 unknown, 7 deleted, or not in Seerr yet) can be requested.
const SEERR_STATUS = {
  2: 'requested', // waiting for approval
  3: 'processing', // approved: Radarr is getting it
  4: 'available', // partly available (meant for TV shows)
  5: 'available',
  6: 'blocked', // on Seerr's blocklist
}
const REQUEST_NEEDS_APPROVAL = 1 // MediaRequestStatus.PENDING in Seerr's code

// Settings from environment variables (or .env.local)
export function settingsFrom(env) {
  return {
    tmdbToken: (env.TMDB_TOKEN || env.VITE_TMDB_TOKEN || '').trim(), // the old name still works
    seerrUrl: (env.SEERR_URL || '').trim().replace(/\/+$/, ''),
    seerrApiKey: (env.SEERR_API_KEY || '').trim(),
  }
}

// An error whose message is fine to show in the app
class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 10_000) throw new ApiError(413, 'Request too big')
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new ApiError(400, 'Request body must be JSON')
  }
}

// Returns a (req, res, next) handler: answers /api/... and passes anything else on
export function createApi({ tmdbToken, seerrUrl, seerrApiKey }) {
  const seerrReady = Boolean(seerrUrl && seerrApiKey)

  async function tmdb(res, path, search) {
    if (!tmdbToken) {
      throw new ApiError(500, 'No TMDB token found. Add TMDB_TOKEN to .env.local (or the container settings), then restart.')
    }
    if (!TMDB_PATHS.some((allowed) => allowed.test(path))) {
      throw new ApiError(404, 'Not a TMDB call this app makes')
    }
    const response = await fetch(`${TMDB_BASE}${path}${search}`, {
      headers: { Authorization: `Bearer ${tmdbToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401) {
      throw new ApiError(502, 'TMDB rejected the token. Make sure TMDB_TOKEN is the long API Read Access Token.')
    }
    const headers = { 'content-type': 'application/json' }
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter) headers['retry-after'] = retryAfter
    res.writeHead(response.status, headers)
    res.end(await response.text())
  }

  async function seerr(path, init = {}) {
    let response
    try {
      response = await fetch(`${seerrUrl}/api/v1${path}`, {
        ...init,
        headers: { 'X-Api-Key': seerrApiKey, accept: 'application/json', 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new ApiError(502, `Couldn't reach Seerr at ${seerrUrl}.`)
    }
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }

  async function seerrStatus(res, tmdbId) {
    if (!seerrReady) return sendJson(res, 200, { enabled: false })
    const { status, body } = await seerr(`/movie/${tmdbId}`)
    if (status === 401 || status === 403) {
      throw new ApiError(502, 'Seerr rejected the API key. Check SEERR_API_KEY.')
    }
    if (status !== 200) throw new ApiError(502, `Seerr couldn't look up this movie (${status}).`)
    const media = body.mediaInfo
    const shown = SEERR_STATUS[media?.status] ?? 'none'
    sendJson(res, 200, {
      enabled: true,
      status: shown,
      // Seerr builds this from the Jellyfin URL in its settings (Settings -> Jellyfin)
      watchUrl: shown === 'available' ? (media.mediaUrl ?? null) : null,
    })
  }

  async function seerrRequest(req, res) {
    if (!seerrReady) throw new ApiError(404, "Seerr isn't set up.")
    const { tmdbId } = await readJson(req)
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new ApiError(400, 'tmdbId must be a TMDB movie id')

    // The API key acts as Seerr's admin, so the request is approved right away.
    // No server, quality profile or folder given: Seerr uses its Radarr defaults.
    const { status, body } = await seerr('/request', {
      method: 'POST',
      body: JSON.stringify({ mediaType: 'movie', mediaId: tmdbId }),
    })
    if (status === 201) {
      return sendJson(res, 200, { status: body.status === REQUEST_NEEDS_APPROVAL ? 'requested' : 'processing' })
    }
    if (status === 409) return sendJson(res, 200, { status: 'requested', already: true })
    const reason = body.message ? `Seerr said: ${body.message}` : `Seerr couldn't request it (${status}).`
    throw new ApiError(status === 403 ? 403 : 502, reason)
  }

  return async function handleApi(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return next()
    try {
      if (req.method === 'GET' && url.pathname.startsWith('/api/tmdb/')) {
        return await tmdb(res, url.pathname.slice('/api/tmdb'.length), url.search)
      }
      const movie = /^\/api\/seerr\/movie\/(\d+)$/.exec(url.pathname)
      if (req.method === 'GET' && movie) return await seerrStatus(res, movie[1])
      if (req.method === 'POST' && url.pathname === '/api/seerr/request') {
        return await seerrRequest(req, res)
      }
      throw new ApiError(404, 'Not found')
    } catch (err) {
      if (!(err instanceof ApiError)) console.error(`[api] ${req.method} ${url.pathname}:`, err)
      if (res.headersSent) return res.end()
      if (err instanceof ApiError) return sendJson(res, err.status, { error: err.message })
      const timedOut = err?.name === 'TimeoutError'
      sendJson(res, 502, { error: timedOut ? 'TMDB or Seerr took too long to answer.' : 'Something went wrong on the server.' })
    }
  }
}
