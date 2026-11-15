// Live calls to TMDB (themoviedb.org). Movies only, never TV.
// The token comes from .env.local (VITE_TMDB_TOKEN), which is gitignored.

const TOKEN = import.meta.env.VITE_TMDB_TOKEN
const API_BASE = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p/'

// Genres we never recommend for now: Documentary, TV Movie
const SKIP_GENRES = [99, 10770]

// The starting pool is a mix of three kinds of lists.
// Pages are picked at random from the first `fromFirst` pages so each game differs.
const POOL_MIX = [
  // Most-rated movies: things most people have heard of
  { params: { sort_by: 'vote_count.desc' }, pages: 5, fromFirst: 15 },
  // What people are watching right now
  {
    params: { sort_by: 'popularity.desc', 'vote_count.gte': 300 },
    pages: 3,
    fromFirst: 8,
  },
  // Well-rated movies fewer people have seen: hidden gems. Sorted by vote count
  // within the range so they're watchable (not concert films or 1950s
  // arthouse), from 1980 up to 2 years ago (brand-new releases have
  // inflated early ratings).
  {
    params: {
      sort_by: 'vote_count.desc',
      'vote_average.gte': 7,
      'vote_count.gte': 300,
      'vote_count.lte': 2000,
      'primary_release_date.gte': '1980-01-01',
      'primary_release_date.lte': `${new Date().getFullYear() - 2}-12-31`,
    },
    pages: 3,
    fromFirst: 20,
  },
]

const MAX_PARALLEL = 10 // TMDB allows roughly 50 requests a second
const DETAILS_CACHE_KEY = 'reelmind:details:v1'
const DETAILS_CACHE_DAYS = 7
const DETAILS_CACHE_MAX = 3000

export function posterUrl(path, size = 'w342') {
  return path ? `${IMAGE_BASE}${size}${path}` : null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function tmdbGet(path, params = {}) {
  if (!TOKEN) {
    throw new Error(
      'No TMDB token found. Add VITE_TMDB_TOKEN to .env.local, then restart npm run dev.',
    )
  }

  const url = new URL(API_BASE + path)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
    })
    // Too many requests: wait a moment and try again
    if (response.status === 429 && attempt < 3) {
      await sleep((Number(response.headers.get('retry-after')) || 1) * 1000)
      continue
    }
    if (response.status === 401) {
      throw new Error(
        'TMDB rejected the token. Make sure VITE_TMDB_TOKEN in .env.local is the long API Read Access Token.',
      )
    }
    if (!response.ok) {
      throw new Error(`TMDB request failed (${response.status}): ${path}`)
    }
    return response.json()
  }
}

// Runs at most MAX_PARALLEL tasks at once. `urgent` tasks skip the line.
let running = 0
const waiting = [] // [{ key, run }]
function limited(task, { urgent = false, key } = {}) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      running++
      try {
        resolve(await task())
      } catch (err) {
        reject(err)
      } finally {
        running--
        waiting.shift()?.run()
      }
    }
    if (running < MAX_PARALLEL) run()
    else if (urgent) waiting.unshift({ key, run })
    else waiting.push({ key, run })
  })
}

// Move an already-waiting task to the front of the line
function hurry(key) {
  const index = waiting.findIndex((entry) => entry.key === key)
  if (index > 0) waiting.unshift(...waiting.splice(index, 1))
}

function discover(params, page) {
  return tmdbGet('/discover/movie', {
    include_adult: false,
    include_video: false,
    language: 'en-US',
    page,
    ...params,
  })
}

function randomPages(count, outOf) {
  const pages = Array.from({ length: outOf }, (_, i) => i + 1)
  for (let i = pages.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pages[i], pages[j]] = [pages[j], pages[i]]
  }
  return pages.slice(0, count)
}

function isUsable(movie) {
  return (
    !movie.adult &&
    Boolean(movie.poster_path) &&
    Boolean(movie.release_date) &&
    !movie.genre_ids.some((id) => SKIP_GENRES.includes(id))
  )
}

function uniqueUsable(movies) {
  const byId = new Map()
  for (const movie of movies) {
    if (isUsable(movie) && !byId.has(movie.id)) byId.set(movie.id, movie)
  }
  return [...byId.values()]
}

// About 11 requests sent at once -> roughly 200 movies
export async function fetchStartingPool() {
  const requests = POOL_MIX.flatMap((mix) =>
    randomPages(mix.pages, mix.fromFirst).map((page) => discover(mix.params, page)),
  )
  const responses = await Promise.all(requests)
  return uniqueUsable(responses.flatMap((response) => response.results))
}

// Extra movies matching a narrower search, e.g. { with_keywords: '12377' } for zombies.
// Sorted by vote count: page 1 has the best-known matches, plus one random
// page from 2-5 so the same search doesn't always bring back the same movies.
// (A random page past the end of the results just comes back empty.)
// Rated 6+ only: deeper pages otherwise bring in poorly liked movies that can
// end up as the pick (testing turned up a 4.8-rated one).
export async function fetchMoreMovies(params) {
  const extraPage = 2 + Math.floor(Math.random() * 4)
  const requests = [1, extraPage].map((page) =>
    discover(
      { sort_by: 'vote_count.desc', 'vote_count.gte': 100, 'vote_average.gte': 6, ...params },
      page,
    ),
  )
  const responses = await Promise.all(requests)
  return uniqueUsable(responses.flatMap((response) => response.results))
}

// Movies TMDB recommends for people who liked `movieId`
export async function fetchRecommendations(movieId) {
  const data = await tmdbGet(`/movie/${movieId}/recommendations`, {
    language: 'en-US',
    page: 1,
  })
  return uniqueUsable(data.results).filter((movie) => movie.vote_count >= 300)
}

// ---------------------------------------------------------------------------
// Movie details: keywords, runtime, US age rating, franchise, budget.
// Saved in the browser for a few days so repeat games need fewer calls.

let savedDetails = null // { [movieId]: { savedAt, details } }
let saveTimer = null

function loadSavedDetails() {
  if (savedDetails) return savedDetails
  savedDetails = {}
  try {
    const raw = globalThis.localStorage?.getItem(DETAILS_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const oldest = Date.now() - DETAILS_CACHE_DAYS * 24 * 60 * 60 * 1000
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry.savedAt > oldest) savedDetails[id] = entry
    }
  } catch {
    // Storage blocked or corrupted: start empty
  }
  return savedDetails
}

function saveDetailsSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const entries = Object.entries(savedDetails)
        .sort((a, b) => b[1].savedAt - a[1].savedAt)
        .slice(0, DETAILS_CACHE_MAX)
      globalThis.localStorage?.setItem(DETAILS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
    } catch {
      // Storage full or blocked: the in-memory copy still works
    }
  }, 500)
}

function compactDetails(data) {
  const us = data.release_dates?.results?.find((r) => r.iso_3166_1 === 'US')
  return {
    runtime: data.runtime || 0,
    certification: us?.release_dates?.map((d) => d.certification).find(Boolean) ?? '',
    keywordIds: data.keywords?.keywords?.map((k) => k.id) ?? [],
    inCollection: Boolean(data.belongs_to_collection),
    budget: data.budget || 0,
  }
}

const detailRequests = new Map() // movieId -> Promise<details | null>

function requestDetails(id, urgent) {
  const saved = loadSavedDetails()[id]
  if (saved) return Promise.resolve(saved.details)

  return limited(
    () => tmdbGet(`/movie/${id}`, { append_to_response: 'keywords,release_dates' }),
    { urgent, key: id },
  )
    .then((data) => {
      const details = compactDetails(data)
      savedDetails[id] = { savedAt: Date.now(), details }
      saveDetailsSoon()
      return details
    })
    .catch(() => {
      detailRequests.delete(id) // allow a retry later
      return null
    })
}

// Returns { [movieId]: details } for the ids that loaded
export async function fetchDetails(ids, { urgent = true } = {}) {
  const entries = await Promise.all(
    ids.map(async (id) => {
      if (!detailRequests.has(id)) detailRequests.set(id, requestDetails(id, urgent))
      else if (urgent) hurry(id) // was preloading in the background: do it now
      return [id, await detailRequests.get(id)]
    }),
  )
  return Object.fromEntries(entries.filter(([, details]) => details))
}

// Start loading details in the background so they're ready when needed
export function prefetchDetails(ids) {
  fetchDetails(ids, { urgent: false }).catch(() => {})
}
