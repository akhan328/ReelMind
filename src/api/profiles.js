// Profiles and the movies each one has already seen. Saved in profiles.json
// by the dev server (server/profiles.js), so they're kept between visits.

// Thrown when there's no profile server at all (e.g. a plain static build)
export class NoProfileServer extends Error {}

async function call(path, options) {
  const response = await fetch(`/api/profiles${path}`, options)
  const body = await response.json().catch(() => null)
  if (body === null) throw new NoProfileServer('Profiles need `npm run dev` or `npm run preview`.')
  if (!response.ok) throw new Error(body.error ?? `Couldn't reach profiles (${response.status})`)
  return body
}

function send(method, path, body) {
  return call(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  })
}

const named = (name) => `/${encodeURIComponent(name)}`

// { profiles: [{ name, seenCount }] }
export function listProfiles() {
  return call('')
}

// The ones below resolve to the profile: { name, seen: [{ id, title, year, poster, seenAt }] }

export function getProfile(name) {
  return call(named(name))
}

export function addProfile(name) {
  return send('POST', '', { name })
}

// Deletes the profile and its seen movies. Resolves to { deleted: name }
export function deleteProfile(name) {
  return send('DELETE', named(name))
}

// movie: { id, title, year, poster }
export function addSeen(name, movie) {
  return send('POST', `${named(name)}/seen`, movie)
}

export function removeSeen(name, movieId) {
  return send('DELETE', `${named(name)}/seen/${movieId}`)
}
