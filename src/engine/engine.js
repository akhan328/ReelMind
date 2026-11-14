// The recommendation algorithm. Plain functions, no React, no API calls.
//
// 1. Every answer adds weights to a taste profile (trait -> weight).
// 2. Every movie is scored by how well its traits match the profile.
// 3. The next question is the one that best splits the top-scoring movies.
//    Questions go from broad (tier 1) to narrow (tier 5); narrow follow-ups
//    only open up after a "yes" to their parent question.
// 4. Stop when one movie is clearly ahead, few are left, or the limit is hit.

import { addTraits, isDetailTrait, releaseYear, themeKeywordIds, traitLabel } from './traits.js'

const MAX_QUESTIONS = 15
const MIN_QUESTIONS = 7 // don't guess before this, unless almost nothing is left
const KEEP_GOING_MAX = 5 // "Keep narrowing it down" allows up to this many more questions
const KEEP_GOING_MIN = 3 // ...and asks at least this many before guessing again
const MIN_MOVIES_LEFT = 5 // a hard filter can't shrink the pool below this
const CONFIDENT_SHARE = 0.5 // guess early once the top movie holds this share
const MIN_INFO = 0.25 // skip questions that barely split the pool
const TIER_UNLOCK = { 1: 0, 2: 1, 3: 3, 4: 4, 5: 6 } // questions asked before a tier opens
const TIER_PENALTY = 0.15 // prefer broad questions over narrow ones
const FOLLOW_UP_BONUS = 0.15 // nudge follow-ups so they come soon after their parent
const CLOSE_ENOUGH = 0.2 // pick randomly among questions this close to the best
const SIMILAR_WEIGHT = 0.6 // "like [movie]": weight per genre that movie has
const RECOMMENDED_BOOST = 1 // "like [movie]": bonus for TMDB's recommendations
const MIN_REF_VOTES = 2000 // [movie] has to be well known enough to recognize

// Release-date ranges used when pulling more movies for an era answer
const ERA_DATES = {
  'era:recent': ['2015-01-01', null],
  'era:classic': [null, '1989-12-31'],
  'era:70s': ['1970-01-01', '1979-12-31'],
  'era:80s': ['1980-01-01', '1989-12-31'],
  'era:90s': ['1990-01-01', '1999-12-31'],
  'era:2000s': ['2000-01-01', '2009-12-31'],
  'era:2010s': ['2010-01-01', '2019-12-31'],
  'era:2020s': ['2020-01-01', null],
}

export function newGame(movies) {
  return {
    pool: addTraits(movies),
    profile: {}, // trait -> weight
    hardFilters: [], // [{ trait, wanted }]
    excludedIds: [], // already seen, or used as a [movie] reference
    boosts: {}, // movieId -> { amount, because }
    asked: [], // [{ id, text, ref, answer }]
    askCounts: {}, // questionId -> times asked
    questionLimit: MAX_QUESTIONS, // always guess once this many are asked
    earliestGuess: MIN_QUESTIONS, // never guess on confidence before this many
    detailsLoaded: false, // keyword / runtime / age-rating data is in
  }
}

// ---------------------------------------------------------------------------
// Scoring

export function candidates(game) {
  return game.pool.filter(
    (movie) =>
      !game.excludedIds.includes(movie.id) &&
      game.hardFilters.every((f) => movie.traits[f.trait] >= 0.5 === f.wanted),
  )
}

export function scoreMovie(game, movie) {
  let score = game.boosts[movie.id]?.amount ?? 0
  for (const [trait, weight] of Object.entries(game.profile)) {
    score += weight * (2 * (movie.traits[trait] ?? 0.5) - 1)
  }
  return score
}

// Small tie-breaker: better rated + more votes wins between equal scores
function quality(movie) {
  return (movie.vote_average / 10) * Math.min(1, Math.log10(movie.vote_count + 1) / 4)
}

export function rankMovies(game) {
  return candidates(game)
    .map((movie) => ({ movie, score: scoreMovie(game, movie) }))
    .sort((a, b) => b.score + 0.1 * quality(b.movie) - (a.score + 0.1 * quality(a.movie)))
}

// Turns scores into weights that add up to 1 (higher score = much more weight)
function softmax(scores) {
  const max = Math.max(...scores)
  const exps = scores.map((score) => Math.exp(score - max))
  const total = exps.reduce((sum, e) => sum + e, 0)
  return exps.map((e) => e / total)
}

// 1 for a perfect 50/50 split, 0 when everything lands on one side
function entropy(p) {
  if (p <= 0 || p >= 1) return 0
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p))
}

// ---------------------------------------------------------------------------
// Choosing questions

function genreOverlap(a, b) {
  const union = new Set([...a.genre_ids, ...b.genre_ids])
  if (union.size === 0) return 0
  const shared = a.genre_ids.filter((id) => b.genre_ids.includes(id)).length
  return shared / union.size
}

// How well a movie fits a question: 0 (not at all) to 1 (fully)
export function questionMatch(question, movie, ref) {
  if (question.fill === 'movie') return genreOverlap(movie, ref)
  let total = 0
  let weightSum = 0
  for (const [trait, weight] of Object.entries(question.traits)) {
    total += weight * (2 * (movie.traits[trait] ?? 0.5) - 1)
    weightSum += Math.abs(weight)
  }
  return (total / weightSum + 1) / 2
}

// The trait a question is mostly about (its biggest weight)
function mainTrait(question) {
  const entries = Object.entries(question.traits ?? {})
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  return entries[0]?.[0]
}

function needsDetails(question) {
  return Object.keys(question.traits ?? {}).some(isDetailTrait)
}

// Follow-ups need a Yes / Probably to at least one parent question
function followsSatisfied(game, question) {
  if (!question.follows) return true
  return game.asked.some((a) => question.follows.includes(a.id) && a.answer > 0)
}

// A well-known movie from near the top of the current ranking
function pickReferenceMovie(game, ranked) {
  const usedIds = game.asked.filter((a) => a.ref).map((a) => a.ref.id)
  const options = ranked
    .slice(0, 15)
    .map((r) => r.movie)
    .filter((movie) => movie.vote_count >= MIN_REF_VOTES && !usedIds.includes(movie.id))
    .sort((a, b) => b.vote_count - a.vote_count)
  return options[0] ?? null
}

export function nextQuestion(game, questions, random = Math.random) {
  const ranked = rankMovies(game)
  if (ranked.length === 0) return null
  const weights = softmax(ranked.map((r) => r.score))

  const options = []
  for (const question of questions) {
    if ((game.askCounts[question.id] ?? 0) >= (question.repeat ?? 1)) continue
    if (game.asked.length < TIER_UNLOCK[question.tier]) continue
    if (!followsSatisfied(game, question)) continue
    if (needsDetails(question) && !game.detailsLoaded) continue

    const ref = question.fill === 'movie' ? pickReferenceMovie(game, ranked) : null
    if (question.fill === 'movie' && !ref) continue

    // Weighted share of movies on each side of the question
    let yes = 0
    let no = 0
    ranked.forEach((r, i) => {
      const match = questionMatch(question, r.movie, ref)
      if (match > 0.6) yes += weights[i]
      else if (match < 0.4) no += weights[i]
    })
    const decided = yes + no
    const info = decided === 0 ? 0 : entropy(yes / decided) * decided
    if (info < MIN_INFO) continue

    const bonus = question.follows ? FOLLOW_UP_BONUS : 0
    options.push({ question, ref, value: info - TIER_PENALTY * (question.tier - 1) + bonus })
  }
  if (options.length === 0) return null

  // Random pick among the near-best questions, so games don't all go the same way
  const topValue = Math.max(...options.map((o) => o.value))
  const closeOnes = options.filter((o) => o.value >= topValue - CLOSE_ENOUGH)
  const best = closeOnes[Math.floor(random() * closeOnes.length)]

  const text = best.ref
    ? best.question.text.replace('[movie]', `${best.ref.title} (${releaseYear(best.ref)})`)
    : best.question.text
  return { question: best.question, ref: best.ref, text }
}

// ---------------------------------------------------------------------------
// Answers

function addToProfile(profile, traits, amount) {
  const next = { ...profile }
  for (const [trait, weight] of Object.entries(traits)) {
    next[trait] = (next[trait] ?? 0) + amount * weight
  }
  return next
}

// answerValue: Yes 1, Probably 0.5, Don't know 0, Probably not -0.5, No -1
// recommendations: only for "like [movie]" questions (fetched live by the caller)
export function applyAnswer(game, current, answerValue, recommendations = []) {
  const { question, ref, text } = current
  let next = {
    ...game,
    asked: [...game.asked, { id: question.id, text, ref, answer: answerValue }],
    askCounts: { ...game.askCounts, [question.id]: (game.askCounts[question.id] ?? 0) + 1 },
  }

  if (question.fill === 'movie') {
    return applyLikeMovie(next, ref, answerValue, recommendations)
  }

  next = { ...next, profile: addToProfile(next.profile, question.traits, answerValue) }

  // Hard questions: a plain Yes / No removes movies that don't fit
  if (question.hard && Math.abs(answerValue) === 1) {
    const filtered = {
      ...next,
      hardFilters: [...next.hardFilters, { trait: mainTrait(question), wanted: answerValue > 0 }],
    }
    // Safety net: never filter down to almost nothing
    if (candidates(filtered).length >= MIN_MOVIES_LEFT) next = filtered
  }
  return next
}

function applyLikeMovie(game, ref, answerValue, recommendations) {
  const genreTraits = Object.fromEntries(
    ref.genre_ids.map((id) => [`genre:${id}`, SIMILAR_WEIGHT]),
  )

  const boosts = { ...game.boosts }
  for (const movie of recommendations) {
    const before = boosts[movie.id]?.amount ?? 0
    boosts[movie.id] = { amount: before + answerValue * RECOMMENDED_BOOST, because: ref.title }
  }

  // On a yes, TMDB's recommendations join the pool
  const withRecs = answerValue > 0 ? addMovies(game, recommendations) : game
  return {
    ...withRecs,
    profile: addToProfile(game.profile, genreTraits, answerValue),
    boosts,
    // Never recommend the reference movie itself
    excludedIds: [...game.excludedIds, ref.id],
  }
}

export function excludeMovie(game, movieId) {
  return { ...game, excludedIds: [...game.excludedIds, movieId] }
}

// ---------------------------------------------------------------------------
// Pulling more movies live

// After a Yes / Probably, a TMDB search for more movies like that answer
// (respecting the hard filters so far). Returns null if there's nothing to search.
export function refillQuery(game, question, answerValue) {
  if (answerValue <= 0 || !question.traits) return null

  const genres = new Set()
  let language = null
  for (const filter of game.hardFilters) {
    if (!filter.wanted) {
      if (filter.trait === 'lang:foreign') language = 'en'
      continue
    }
    if (filter.trait.startsWith('genre:')) genres.add(filter.trait.slice('genre:'.length))
    if (/^lang:[a-z]{2}$/.test(filter.trait)) language = filter.trait.slice('lang:'.length)
    if (filter.trait === 'format:anime') {
      genres.add('16')
      language = 'ja'
    }
  }

  // TMDB can't search for "any language except English", so a search here
  // would mostly return English movies that get filtered out anyway
  const anyForeign = game.hardFilters.some((f) => f.trait === 'lang:foreign' && f.wanted)
  if (anyForeign && !language) return null

  const params = {}
  const hints = {}
  const trait = mainTrait(question)
  if (trait.startsWith('genre:')) {
    genres.add(trait.slice('genre:'.length))
  } else if (trait.startsWith('theme:')) {
    params.with_keywords = themeKeywordIds(trait.slice('theme:'.length)).join('|')
    hints[trait] = 1
  } else if (trait === 'format:anime') {
    genres.add('16')
    language = 'ja'
  } else if (/^lang:[a-z]{2}$/.test(trait)) {
    language = trait.slice('lang:'.length)
  } else if (ERA_DATES[trait] && !anyForeign) {
    const [from, to] = ERA_DATES[trait]
    if (from) params['primary_release_date.gte'] = from
    if (to) params['primary_release_date.lte'] = to
  } else {
    return null
  }

  if (genres.size > 0) params.with_genres = [...genres].join(',')
  if (language) params.with_original_language = language
  return { params, hints }
}

// Adds new movies to the pool. `hints` are traits we already know about them.
export function addMovies(game, movies, hints = {}) {
  const found = new Map(movies.map((movie) => [movie.id, movie]))
  const pool = game.pool.map((movie) =>
    found.has(movie.id) && !movie.details
      ? { ...movie, hints: { ...movie.hints, ...hints } }
      : movie,
  )
  const known = new Set(game.pool.map((movie) => movie.id))
  const fresh = movies.filter((movie) => !known.has(movie.id)).map((movie) => ({ ...movie, hints }))
  return { ...game, pool: addTraits([...pool, ...fresh]) }
}

// Ids of top-ranked movies that still need the details call
export function missingDetails(game, count) {
  return rankMovies(game)
    .slice(0, count)
    .filter((r) => !r.movie.details)
    .map((r) => r.movie.id)
}

export function attachDetails(game, detailsById) {
  const pool = game.pool.map((movie) =>
    detailsById[movie.id] ? { ...movie, details: detailsById[movie.id] } : movie,
  )
  return { ...game, pool: addTraits(pool), detailsLoaded: true }
}

// ---------------------------------------------------------------------------
// Ending the game

export function shouldGuess(game) {
  const ranked = rankMovies(game)
  const asked = game.asked.length
  if (ranked.length <= 1) return true
  if (asked >= game.questionLimit) return true
  if (asked < game.earliestGuess) return false
  if (ranked.length <= 3) return true
  const [topShare] = softmax(ranked.map((r) => r.score))
  return topShare >= CONFIDENT_SHARE
}

// "Keep narrowing it down": raise the limits so the game doesn't stop right away
export function keepGoing(game) {
  const asked = game.asked.length
  return {
    ...game,
    questionLimit: Math.max(game.questionLimit, asked + KEEP_GOING_MAX),
    earliestGuess: Math.max(game.earliestGuess, asked + KEEP_GOING_MIN),
  }
}

// False when no question left would split the remaining movies usefully
export function canKeepGoing(game, questions) {
  return candidates(game).length > 1 && nextQuestion(keepGoing(game), questions) !== null
}

// Short reasons for the result screen, e.g. ["Comedy", "Hidden gem", "No Horror"]
// Things you wanted come first, then things you avoided.
export function explainPick(game, movie) {
  const reasons = Object.entries(game.profile)
    .map(([trait, weight]) => ({
      trait,
      wanted: weight > 0,
      effect: weight * (2 * (movie.traits[trait] ?? 0.5) - 1),
    }))
    .filter((r) => r.effect > 0.25)
    .sort((a, b) => b.wanted - a.wanted || b.effect - a.effect)
    .slice(0, 4)
    .map((r) => traitLabel(r.trait, r.wanted))

  const boost = game.boosts[movie.id]
  if (boost?.amount > 0) reasons.unshift(`Similar to ${boost.because}`)
  return reasons
}
