// Profiles: who's playing, and the movies each person has already seen.
// Everything is kept in one file, profiles.json in the project folder. You can
// open it to look, or edit it by hand while the app isn't running.
// No passwords: anyone using the app can pick any profile.
//
//   GET    /api/profiles                      every profile: { profiles: [{ name, seenCount }] }
//   POST   /api/profiles                      { name }: add a profile
//   GET    /api/profiles/:name                one profile: { name, seen: [movie, ...] }
//   DELETE /api/profiles/:name                delete a profile and its seen movies
//   POST   /api/profiles/:name/seen           { id, title, year, poster }: "Already seen it"
//   DELETE /api/profiles/:name/seen/:movieId  take a movie off the list again
//
// Runs inside the dev server (see vite.config.js), not in the browser.

import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_NAME_LENGTH = 24
const MAX_PROFILES = 50
const MAX_SEEN = 5000 // per profile

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

// "  anan   k " -> "anan k". Throws if there's nothing left or it's too long.
function cleanName(name) {
  const cleaned = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) throw new ApiError(400, 'Give the profile a name.')
  if (cleaned.length > MAX_NAME_LENGTH) {
    throw new ApiError(400, `Names can be up to ${MAX_NAME_LENGTH} characters.`)
  }
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(cleaned)) throw new ApiError(400, "That name has characters that can't be used.")
  return cleaned
}

// What's saved for a seen movie: enough to show it on the profile screen
function cleanMovie(body) {
  const id = body?.id
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id must be a TMDB movie id')
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
  if (!title) throw new ApiError(400, 'The movie needs a title')
  const year = Number.isInteger(body.year) && body.year > 1800 && body.year < 3000 ? body.year : null
  // A TMDB image path, e.g. "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg"
  const poster = typeof body.poster === 'string' && /^\/[\w.-]{1,100}$/.test(body.poster) ? body.poster : null
  return { id, title, year, poster, seenAt: new Date().toISOString() }
}

function sameName(a, b) {
  return a.toLowerCase() === b.toLowerCase()
}

function summary(profile) {
  return { name: profile.name, seenCount: profile.seen.length }
}

// Returns a (req, res, next) handler: answers /api/profiles... and passes anything else on.
// `file` is where the profiles are saved.
export function createProfilesApi(file) {
  const fileName = path.basename(file)

  // One read-or-change at a time, so two quick saves can't undo each other
  let queue = Promise.resolve()
  function inTurn(task) {
    const result = queue.then(task)
    queue = result.catch(() => {})
    return result
  }

  // Read fresh each time, so hand edits to the file count right away
  async function load() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return { profiles: [] } // nobody has made a profile yet
      throw err
    }
    let data
    try {
      data = JSON.parse(text)
    } catch {
      // Never overwrite a file someone may have hand-edited: say so instead
      throw new ApiError(500, `${fileName} isn't valid JSON. Fix it, or delete it to start over.`)
    }
    const profiles = (Array.isArray(data?.profiles) ? data.profiles : [])
      .filter((profile) => typeof profile?.name === 'string' && profile.name.trim())
      .map((profile) => ({
        ...profile,
        seen: (Array.isArray(profile.seen) ? profile.seen : []).filter((movie) =>
          Number.isInteger(movie?.id),
        ),
      }))
    return { ...data, profiles }
  }

  async function save(data) {
    const text = `${JSON.stringify(data, null, 2)}\n`
    // Write a temporary file, then swap it in, so a crash can't leave half a file
    const temp = `${file}.tmp`
    await writeFile(temp, text)
    try {
      await rename(temp, file)
    } catch {
      // Windows (or OneDrive syncing) sometimes holds the file for a moment
      await writeFile(file, text)
      await rm(temp, { force: true })
    }
  }

  function find(data, name) {
    const profile = data.profiles.find((p) => sameName(p.name, name))
    if (!profile) throw new ApiError(404, `There's no profile called ${name}.`)
    return profile
  }

  // Load, change, save, all in one turn. `change` returns what to send back.
  function update(change) {
    return inTurn(async () => {
      const data = await load()
      const result = change(data)
      await save(data)
      return result
    })
  }

  async function route(req, res, url) {
    const parts = url.pathname.split('/').slice(3) // after /api/profiles/
    if (parts.at(-1) === '') parts.pop() // trailing slash
    let name
    try {
      name = parts[0] === undefined ? undefined : decodeURIComponent(parts[0])
    } catch {
      throw new ApiError(400, 'Bad profile name in the address')
    }

    // /api/profiles
    if (parts.length === 0 && req.method === 'GET') {
      const data = await inTurn(load)
      return sendJson(res, 200, { profiles: data.profiles.map(summary) })
    }
    if (parts.length === 0 && req.method === 'POST') {
      const newName = cleanName((await readJson(req)).name)
      const profile = await update((data) => {
        if (data.profiles.some((p) => sameName(p.name, newName))) {
          throw new ApiError(409, `There's already a profile called ${newName}.`)
        }
        if (data.profiles.length >= MAX_PROFILES) {
          throw new ApiError(400, `That's the most profiles there can be (${MAX_PROFILES}).`)
        }
        const added = { name: newName, created: new Date().toISOString(), seen: [] }
        data.profiles.push(added)
        return added
      })
      return sendJson(res, 201, { name: profile.name, seen: profile.seen })
    }

    // /api/profiles/:name
    if (parts.length === 1 && req.method === 'GET') {
      const data = await inTurn(load)
      const profile = find(data, name)
      return sendJson(res, 200, { name: profile.name, seen: profile.seen })
    }
    if (parts.length === 1 && req.method === 'DELETE') {
      const deleted = await update((data) => {
        const found = find(data, name)
        data.profiles = data.profiles.filter((p) => p !== found)
        return found
      })
      return sendJson(res, 200, { deleted: deleted.name })
    }

    // /api/profiles/:name/seen
    if (parts.length === 2 && parts[1] === 'seen' && req.method === 'POST') {
      const movie = cleanMovie(await readJson(req))
      const profile = await update((data) => {
        const found = find(data, name)
        if (!found.seen.some((m) => m.id === movie.id)) {
          if (found.seen.length >= MAX_SEEN) {
            throw new ApiError(400, `${found.name} has the most seen movies a profile can hold.`)
          }
          found.seen.push(movie)
        }
        return found
      })
      return sendJson(res, 200, { name: profile.name, seen: profile.seen })
    }

    // /api/profiles/:name/seen/:movieId
    if (parts.length === 3 && parts[1] === 'seen' && /^\d+$/.test(parts[2]) && req.method === 'DELETE') {
      const movieId = Number(parts[2])
      const profile = await update((data) => {
        const found = find(data, name)
        found.seen = found.seen.filter((m) => m.id !== movieId)
        return found
      })
      return sendJson(res, 200, { name: profile.name, seen: profile.seen })
    }

    throw new ApiError(404, 'Not found')
  }

  return async function handleProfiles(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/api/profiles' && !url.pathname.startsWith('/api/profiles/')) return next()
    try {
      await route(req, res, url)
    } catch (err) {
      if (!(err instanceof ApiError)) console.error(`[profiles] ${req.method} ${url.pathname}:`, err)
      if (res.headersSent) return res.end()
      if (err instanceof ApiError) return sendJson(res, err.status, { error: err.message })
      sendJson(res, 500, { error: `Couldn't read or save ${fileName}.` })
    }
  }
}
