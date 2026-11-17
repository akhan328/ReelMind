// Seerr (the request manager for Jellyfin): is the pick already on your server,
// and "Request it" if not. The calls go through this app's own server
// (server/api.js), which holds Seerr's address and API key.

async function call(url, options) {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `Couldn't reach Seerr (${response.status})`)
  return body
}

// { enabled: false } when Seerr isn't set up, otherwise
// { enabled: true, status, watchUrl }, where status is one of:
//   'available'   on your server (watchUrl links to it in Jellyfin, if Seerr knows it)
//   'processing'  requested and approved, downloading
//   'requested'   waiting for approval
//   'blocked'     on Seerr's blocklist
//   'none'        not there yet: can be requested
export function fetchSeerrStatus(tmdbId) {
  return call(`/api/seerr/movie/${tmdbId}`)
}

// Requests the movie. Resolves to { status: 'processing' | 'requested' }
export function requestMovie(tmdbId) {
  return call('/api/seerr/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tmdbId }),
  })
}
