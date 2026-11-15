// Turns raw TMDB movie data into "traits" the algorithm can compare.
// Every trait is a number from 0 (doesn't have it) to 1 (fully has it).
// 0.5 means "unknown / in between", which counts for nothing either way.

import THEMES from '../data/themes.json'

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

const LANGUAGES = { ko: 'Korean', ja: 'Japanese', fr: 'French', es: 'Spanish', hi: 'Hindi' }

// Genre groups: one trait that's 1 if a movie has ANY of these genres.
// Used for "something different?", which opens up genres that are too rare
// in the pool to be asked about on their own.
export const GENRE_GROUPS = {
  'group:different': [37, 10752, 10402, 36], // Western, War, Music, History
}

const DECADES = {
  '70s': [1970, 1979],
  '80s': [1980, 1989],
  '90s': [1990, 1999],
  '2000s': [2000, 2009],
  '2010s': [2010, 2019],
  '2020s': [2020, 2999],
}

// Used to estimate tone: light (1) vs heavy (0)
const LIGHT_GENRES = [35, 10751, 16, 10402, 12, 14, 10749]
const HEAVY_GENRES = [18, 27, 53, 10752, 80, 36, 9648]

const THEME_KEYWORDS = Object.fromEntries(
  Object.entries(THEMES).map(([id, theme]) => [id, new Set(Object.values(theme.keywords))]),
)

const THIS_YEAR = new Date().getFullYear()

// [label when you wanted it, label when you didn't]
const LABELS = {
  'tone:light': ['Lighthearted', 'Serious'],
  'era:recent': ['Recent (2015+)', 'Older (before 2015)'],
  'era:classic': ['Classic (before 1990)', 'Not too old'],
  'perception:acclaimed': ['Critically loved', 'Not a critics pick'],
  'perception:bigHit': ['Big well-known hit', 'Lesser known'],
  'perception:hiddenGem': ['Hidden gem', 'Well known'],
  'perception:cult': ['Cult classic', 'Not a cult classic'],
  'perception:guiltyPleasure': ['Guilty pleasure', 'Not a guilty pleasure'],
  'perception:trending': ['Trending now', 'Not trending'],
  'lang:foreign': ['Not in English', 'In English'],
  'format:anime': ['Anime', 'Not anime'],
  'group:different': ['Western, war, music or history', 'No western, war, music or history'],
  'length:short': ['Under 100 minutes', 'Not too short'],
  'length:long': ['Long epic', 'Not too long'],
  'rating:adult': ['Rated R', 'Not rated R'],
  franchise: ['Part of a franchise', 'Standalone movie'],
  'budget:big': ['Big-budget blockbuster', 'Smaller production'],
}
for (const [code, name] of Object.entries(LANGUAGES)) {
  LABELS[`lang:${code}`] = [name, `Not ${name}`]
}
for (const decade of Object.keys(DECADES)) {
  LABELS[`era:${decade}`] = [`From the ${decade}`, `Not from the ${decade}`]
}
for (const [id, theme] of Object.entries(THEMES)) {
  LABELS[`theme:${id}`] = [theme.label, `No ${theme.label.toLowerCase()}`]
}

export function traitLabel(trait, wanted = true) {
  if (trait.startsWith('genre:')) {
    const genre = GENRES[trait.slice('genre:'.length)]
    return wanted ? genre : `No ${genre}`
  }
  const [yes, no] = LABELS[trait] ?? [trait, `Not ${trait}`]
  return wanted ? yes : no
}

// Traits that need the extra "details" call (keywords, runtime, age rating...)
export function isDetailTrait(trait) {
  return /^(theme:|length:|rating:|budget:|franchise$)/.test(trait)
}

// TMDB keyword ids for a theme, used to pull more matching movies
export function themeKeywordIds(themeId) {
  return Object.values(THEMES[themeId]?.keywords ?? {})
}

export function releaseYear(movie) {
  return Number(movie.release_date?.slice(0, 4)) || null
}

function movieTraits(movie, { votePercentile, popularityPercentile }) {
  const traits = {}
  const year = releaseYear(movie) ?? 0
  const rating = movie.vote_average

  // Genres and tone
  for (const id of Object.keys(GENRES)) {
    traits[`genre:${id}`] = movie.genre_ids.includes(Number(id)) ? 1 : 0
  }
  const light = movie.genre_ids.filter((id) => LIGHT_GENRES.includes(id)).length
  const heavy = movie.genre_ids.filter((id) => HEAVY_GENRES.includes(id)).length
  traits['tone:light'] = light + heavy === 0 ? 0.5 : light / (light + heavy)

  // Era
  traits['era:recent'] = year >= 2015 ? 1 : 0
  traits['era:classic'] = year > 0 && year < 1990 ? 1 : 0
  for (const [decade, [from, to]] of Object.entries(DECADES)) {
    traits[`era:${decade}`] = year >= from && year <= to ? 1 : 0
  }

  // Public perception (vote counts and popularity are relative to the pool)
  if (rating >= 7.5 && movie.vote_count >= 1000) traits['perception:acclaimed'] = 1
  else if (rating >= 7) traits['perception:acclaimed'] = 0.5
  else traits['perception:acclaimed'] = 0

  if (votePercentile >= 0.75) traits['perception:bigHit'] = 1
  else if (votePercentile >= 0.5) traits['perception:bigHit'] = 0.5
  else traits['perception:bigHit'] = 0

  traits['perception:hiddenGem'] = rating >= 7 && votePercentile <= 0.35 ? 1 : 0
  traits['perception:cult'] =
    year > 0 && year <= 2005 && rating >= 7 && votePercentile >= 0.15 && votePercentile <= 0.7
      ? 1
      : 0
  traits['perception:guiltyPleasure'] = votePercentile >= 0.4 && rating < 6.5 ? 1 : 0
  traits['perception:trending'] =
    popularityPercentile >= 0.8 || year >= THIS_YEAR - 1 ? 1 : 0

  // Language and format
  traits['lang:foreign'] = movie.original_language === 'en' ? 0 : 1
  for (const code of Object.keys(LANGUAGES)) {
    traits[`lang:${code}`] = movie.original_language === code ? 1 : 0
  }
  traits['format:anime'] =
    movie.original_language === 'ja' && movie.genre_ids.includes(16) ? 1 : 0

  for (const [group, ids] of Object.entries(GENRE_GROUPS)) {
    traits[group] = movie.genre_ids.some((id) => ids.includes(id)) ? 1 : 0
  }

  // From the details call. Unknown = 0.5, except themes: most movies don't
  // have any given theme, so unknown counts as "no" (0).
  const details = movie.details
  const runtime = details?.runtime ?? 0
  traits['length:short'] = runtime ? (runtime < 100 ? 1 : 0) : 0.5
  traits['length:long'] = runtime ? (runtime >= 140 ? 1 : 0) : 0.5

  const cert = details?.certification ?? ''
  traits['rating:adult'] = cert ? (cert === 'R' || cert === 'NC-17' ? 1 : 0) : 0.5

  traits.franchise = details ? (details.inCollection ? 1 : 0) : 0.5

  const budget = details?.budget ?? 0
  if (budget >= 100_000_000) traits['budget:big'] = 1
  else if (budget >= 30_000_000 || budget === 0) traits['budget:big'] = 0.5
  else traits['budget:big'] = 0

  const keywordIds = details?.keywordIds ?? []
  for (const [id, keywords] of Object.entries(THEME_KEYWORDS)) {
    traits[`theme:${id}`] = keywordIds.some((k) => keywords.has(k)) ? 1 : 0
  }

  // Hints: traits we already know from how the movie was found
  // (e.g. it came from a "zombie" search), used until details load
  if (!details && movie.hints) Object.assign(traits, movie.hints)

  return traits
}

function percentileOf(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return (value) =>
    sorted.length > 1 ? sorted.findIndex((v) => v >= value) / (sorted.length - 1) : 0.5
}

// Adds a `traits` object to every movie. Run it again whenever the pool
// changes, because "big hit" / "hidden gem" depend on the whole pool.
export function addTraits(movies) {
  const voteRank = percentileOf(movies.map((m) => m.vote_count))
  const popularityRank = percentileOf(movies.map((m) => m.popularity ?? 0))
  return movies.map((movie) => ({
    ...movie,
    traits: movieTraits(movie, {
      votePercentile: voteRank(movie.vote_count),
      popularityPercentile: popularityRank(movie.popularity ?? 0),
    }),
  }))
}
