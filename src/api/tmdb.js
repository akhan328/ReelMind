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
  // Highly rated but fewer votes: hidden gems
  {
    params: {
      sort_by: 'vote_average.desc',
      'vote_average.gte': 7,
      'vote_count.gte': 150,
      'vote_count.lte': 1500,
    },
    pages: 3,
    fromFirst: 10,
  },
]

export function posterUrl(path, size = 'w342') {
  return path ? `${IMAGE_BASE}${size}${path}` : null
}

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

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
  })
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

// Movies TMDB recommends for people who liked `movieId`
export async function fetchRecommendations(movieId) {
  const data = await tmdbGet(`/movie/${movieId}/recommendations`, {
    language: 'en-US',
    page: 1,
  })
  return uniqueUsable(data.results).filter((movie) => movie.vote_count >= 300)
}
