// Turns raw TMDB movie data into "traits" the algorithm can compare.
// Every trait is a number from 0 (doesn't have it) to 1 (fully has it).

export const GENRES = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}

// Used to estimate tone: light (1) vs heavy (0)
const LIGHT_GENRES = [35, 10751, 16, 10402, 12, 14, 10749]
const HEAVY_GENRES = [18, 27, 53, 10752, 80, 36, 9648]

// [label when you wanted it, label when you didn't]
const LABELS = {
  'tone:light': ['Lighthearted', 'Serious'],
  'era:recent': ['Recent (2015+)', 'Older (before 2015)'],
  'era:classic': ['Classic (before 1990)', 'Not too old'],
  'perception:acclaimed': ['Critically loved', 'Not a critics pick'],
  'perception:bigHit': ['Big well-known hit', 'Lesser known'],
  'perception:hiddenGem': ['Hidden gem', 'Well known'],
  'lang:foreign': ['Not in English', 'In English'],
}

export function traitLabel(trait, wanted = true) {
  if (trait.startsWith('genre:')) {
    const genre = GENRES[trait.slice('genre:'.length)]
    return wanted ? genre : `No ${genre}`
  }
  const [yes, no] = LABELS[trait] ?? [trait, `Not ${trait}`]
  return wanted ? yes : no
}

export function releaseYear(movie) {
  return Number(movie.release_date?.slice(0, 4)) || null
}

function movieTraits(movie, votePercentile) {
  const traits = {}

  for (const id of Object.keys(GENRES)) {
    traits[`genre:${id}`] = movie.genre_ids.includes(Number(id)) ? 1 : 0
  }

  const light = movie.genre_ids.filter((id) => LIGHT_GENRES.includes(id)).length
  const heavy = movie.genre_ids.filter((id) => HEAVY_GENRES.includes(id)).length
  traits['tone:light'] = light + heavy === 0 ? 0.5 : light / (light + heavy)

  const year = releaseYear(movie) ?? 0
  traits['era:recent'] = year >= 2015 ? 1 : 0
  traits['era:classic'] = year > 0 && year < 1990 ? 1 : 0

  // Public perception, partly relative to the rest of the pool
  const rating = movie.vote_average
  if (rating >= 7.5 && movie.vote_count >= 1000) traits['perception:acclaimed'] = 1
  else if (rating >= 7) traits['perception:acclaimed'] = 0.5
  else traits['perception:acclaimed'] = 0

  if (votePercentile >= 0.75) traits['perception:bigHit'] = 1
  else if (votePercentile >= 0.5) traits['perception:bigHit'] = 0.5
  else traits['perception:bigHit'] = 0

  traits['perception:hiddenGem'] = rating >= 7 && votePercentile <= 0.35 ? 1 : 0

  traits['lang:foreign'] = movie.original_language === 'en' ? 0 : 1

  return traits
}

// Adds a `traits` object to every movie. Run it again whenever the pool
// changes, because "big hit" / "hidden gem" depend on the whole pool.
export function addTraits(movies) {
  const voteCounts = movies.map((movie) => movie.vote_count).sort((a, b) => a - b)
  return movies.map((movie) => {
    const fewerVotes = voteCounts.findIndex((count) => count >= movie.vote_count)
    const votePercentile = movies.length > 1 ? fewerVotes / (movies.length - 1) : 0.5
    return { ...movie, traits: movieTraits(movie, votePercentile) }
  })
}
