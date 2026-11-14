// The recommendation algorithm. Plain functions, no React, no API calls.
//
// 1. Every answer adds weights to a taste profile (trait -> weight).
// 2. Every movie is scored by how well its traits match the profile.
// 3. The next question is the one that best splits the top-scoring movies.
// 4. Stop when one movie is clearly ahead, few are left, or the limit is hit.

import { addTraits, releaseYear, traitLabel } from './traits.js'

export const MAX_QUESTIONS = 12
const MIN_QUESTIONS = 6 // don't guess before this, unless almost nothing is left
const MIN_MOVIES_LEFT = 5 // a hard filter can't shrink the pool below this
const CONFIDENT_SHARE = 0.5 // guess early once the top movie holds this share
const MIN_INFO = 0.25 // skip questions that barely split the pool
const TIER_UNLOCK = { 1: 0, 2: 1, 3: 3, 4: 5 } // questions asked before a tier opens
const TIER_PENALTY = 0.1 // prefer broad questions over narrow ones
const CLOSE_ENOUGH = 0.3 // pick randomly among questions this close to the best
const SIMILAR_WEIGHT = 0.6 // "like [movie]": weight per genre that movie has
const RECOMMENDED_BOOST = 1 // "like [movie]": bonus for TMDB's recommendations
const MIN_REF_VOTES = 2000 // [movie] has to be well known enough to recognize

export function newGame(movies) {
  return {
    pool: addTraits(movies),
    profile: {}, // trait -> weight
    hardFilters: [], // [{ trait, wanted }]
    excludedIds: [], // already seen, or used as a [movie] reference
    boosts: {}, // movieId -> { amount, because }
    asked: [], // [{ id, text, ref, answer }]
    askCounts: {}, // questionId -> times asked
  }
}

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
    score += weight * (2 * movie.traits[trait] - 1)
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
    total += weight * (2 * movie.traits[trait] - 1)
    weightSum += Math.abs(weight)
  }
  return (total / weightSum + 1) / 2
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

    options.push({ question, ref, value: info - TIER_PENALTY * (question.tier - 1) })
  }
  if (options.length === 0) return null

  // Random pick among the near-best questions, so games don't all start the same
  const topValue = Math.max(...options.map((o) => o.value))
  const closeOnes = options.filter((o) => o.value >= topValue - CLOSE_ENOUGH)
  const best = closeOnes[Math.floor(random() * closeOnes.length)]
  const text = best.ref
    ? best.question.text.replace('[movie]', `${best.ref.title} (${releaseYear(best.ref)})`)
    : best.question.text
  return { question: best.question, ref: best.ref, text }
}

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
    const [trait] = Object.keys(question.traits)
    const filtered = {
      ...next,
      hardFilters: [...next.hardFilters, { trait, wanted: answerValue > 0 }],
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

  // On a yes, TMDB's recommendations join the pool (this is the live refill)
  const knownIds = new Set(game.pool.map((movie) => movie.id))
  const newMovies =
    answerValue > 0 ? recommendations.filter((movie) => !knownIds.has(movie.id)) : []

  return {
    ...game,
    pool: newMovies.length > 0 ? addTraits([...game.pool, ...newMovies]) : game.pool,
    profile: addToProfile(game.profile, genreTraits, answerValue),
    boosts,
    // Never recommend the reference movie itself
    excludedIds: [...game.excludedIds, ref.id],
  }
}

export function excludeMovie(game, movieId) {
  return { ...game, excludedIds: [...game.excludedIds, movieId] }
}

export function shouldGuess(game) {
  const ranked = rankMovies(game)
  if (ranked.length <= 3) return true
  if (game.asked.length >= MAX_QUESTIONS) return true
  if (game.asked.length < MIN_QUESTIONS) return false
  const [topShare] = softmax(ranked.map((r) => r.score))
  return topShare >= CONFIDENT_SHARE
}

// Short reasons for the result screen, e.g. ["Comedy", "Hidden gem", "No Horror"]
// Things you wanted come first, then things you avoided.
export function explainPick(game, movie) {
  const reasons = Object.entries(game.profile)
    .map(([trait, weight]) => ({
      trait,
      wanted: weight > 0,
      effect: weight * (2 * movie.traits[trait] - 1),
    }))
    .filter((r) => r.effect > 0.25)
    .sort((a, b) => b.wanted - a.wanted || b.effect - a.effect)
    .slice(0, 4)
    .map((r) => traitLabel(r.trait, r.wanted))

  const boost = game.boosts[movie.id]
  if (boost?.amount > 0) reasons.unshift(`Similar to ${boost.because}`)
  return reasons
}
