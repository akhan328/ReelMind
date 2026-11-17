// The recommendation algorithm. Plain functions, no React, no API calls.
//
// 1. Every answer adds weights to a taste profile (trait -> weight).
// 2. Every movie is scored by how well its traits match the profile.
// 3. The next question is the one that best splits the top-scoring movies.
//    Questions go from broad (tier 1) to narrow (tier 5): the preferred tier
//    drifts narrower as the game goes, and narrow follow-ups only open up
//    after a "yes" to their parent question.
// 4. Stop when one movie is clearly ahead, few are left, or the limit is hit.

import {
  GENRE_GROUPS,
  addTraits,
  isDetailTrait,
  releaseYear,
  themeKeywordIds,
  traitLabel,
  trendingCutoffFor,
} from './traits.js'

const MAX_QUESTIONS = 15
const MIN_QUESTIONS = 7 // don't guess before this, unless almost nothing is left
const KEEP_GOING_MAX = 5 // "Keep narrowing it down" allows up to this many more questions
const KEEP_GOING_MIN = 3 // ...and asks at least this many before guessing again
const MIN_MOVIES_LEFT = 5 // a hard filter can't shrink the pool below this
const CONFIDENT_SHARE = 0.5 // guess early once the top movie holds this share
const MIN_INFO = 0.25 // skip questions that barely split the pool
const TIER_UNLOCK = { 1: 0, 2: 1, 3: 3, 4: 4, 5: 6 } // questions asked before a tier opens
const START_TIER = 1 // the game prefers broad questions at the start...
const END_TIER = 4.5 // ...and drifts toward narrow ones by the end
const TIER_PENALTY = 0.12 // per tier a question is away from where the game is
// A question whose Yes pulls more movies counts as if at least this share of
// the pool matched (the pool understates how many such movies TMDB has)
const BROAD_SHARE_FLOOR = 0.25 // tiers 1-2 (broad and mood, e.g. "Do you want to be scared?")
const SHARE_FLOOR = 0.15 // tier 3 (genres, decades) and follow-ups
const NARROW_SHARE_FLOOR = 0.08 // stand-alone narrow questions (nothing says they're relevant yet)
const FOLLOW_UP_BONUS = 0.1 // follow-up whose parent got a Yes at some point
const FRESH_FOLLOW_UP_BONUS = 0.3 // ...or within the last FRESH_WINDOW questions
const FRESH_WINDOW = 2
const CLOSE_ENOUGH = 0.2 // pick randomly among questions this close to the best
const DONT_KNOW_PENALTY = 0.35 // per extra "Don't know" to one kind of question (era, length...)
const SIMILAR_WEIGHT = 0.6 // "like [movie]": weight per genre that movie has
const SIMILAR_THEME_WEIGHT = 0.5 // ...and per theme it has (smaller: themes are narrower)
const RECOMMENDED_BOOST = 1 // "like [movie]": bonus for TMDB's recommendations
const REFERENCE_PENALTY = 1 // "like [movie]": the [movie] itself drops a bit, so similar movies rank above it
const MIN_REF_VOTES = 2000 // [movie] has to be well known enough to recognize
const TRAIT_CAP = 2 // no trait's weight goes past ±2, so overlapping questions can't pile up on one thing
const TIE_MARGIN = 0.5 // top picks within this score of #1 count as equally good fits
const STRONG_ANSWER = 1 // a profile weight this big (a full Yes/No) shapes the movie searches
const MAX_EXTRA_GENRES = 2 // liked genres added to a search on top of the current answer

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
  const trendingCutoff = trendingCutoffFor(movies)
  return {
    pool: addTraits(movies, trendingCutoff),
    trendingCutoff, // popularity needed for "trending now", fixed for the whole game
    profile: {}, // trait -> weight
    hardFilters: [], // [{ trait, wanted }]
    excludedIds: [], // marked "Already seen it" on the current result screen (never saved)
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

// The best picks from a ranking: just #1 if it's clearly ahead, or up to
// `max` movies when they're about equally good fits
export function topPicks(ranked, max = 3) {
  if (ranked.length === 0) return []
  const best = ranked[0].score
  return ranked.slice(0, max).filter((r) => best - r.score <= TIE_MARGIN)
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

// What "like [movie]" means: that movie's genres, and its themes at a smaller weight
function likeWeight(trait) {
  if (trait.startsWith('genre:')) return SIMILAR_WEIGHT
  if (trait.startsWith('theme:')) return SIMILAR_THEME_WEIGHT
  return 0
}

// The genres and themes a movie has, with their weights. Themes come from the
// details call, which the [movie] has: it's picked from the top 15.
function likeTraits(movie) {
  return Object.fromEntries(
    Object.entries(movie.traits)
      .filter(([trait, value]) => value >= 0.5 && likeWeight(trait) > 0)
      .map(([trait]) => [trait, likeWeight(trait)]),
  )
}

// Share of their genres and themes two movies have in common, by weight:
// 1 for the same ones, 0 for none
function similarity(a, b) {
  const traitsA = likeTraits(a)
  const traitsB = likeTraits(b)
  let shared = 0
  let union = 0
  for (const trait of new Set([...Object.keys(traitsA), ...Object.keys(traitsB)])) {
    const weight = likeWeight(trait) / SIMILAR_WEIGHT // a genre counts 1
    union += weight
    if (traitsA[trait] && traitsB[trait]) shared += weight
  }
  return union === 0 ? 0 : shared / union
}

// How well a movie fits a question: 0 (not at all) to 1 (fully)
export function questionMatch(question, movie, ref) {
  if (question.fill === 'movie') return similarity(movie, ref)
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

// Follow-ups need the right answer to at least one parent question:
//   "recent"   a Yes / Probably to "recent"
//   "!recent"  a No / Probably not to "recent" (e.g. "2000s?" after "recent? No")
// Returns the most recent matching parent and how many questions ago it was.
function latestParent(game, question) {
  if (!question.follows) return null
  for (let i = game.asked.length - 1; i >= 0; i--) {
    const { id, answer } = game.asked[i]
    const matches =
      (answer > 0 && question.follows.includes(id)) ||
      (answer < 0 && question.follows.includes(`!${id}`))
    if (matches) return { id, ago: game.asked.length - i }
  }
  return null
}

// Kinds of question people often have no opinion on. After two "Don't know"
// answers to one kind, the rest of that kind get held back.
const OPINION_KINDS = ['era', 'perception', 'length', 'rating', 'budget', 'franchise']

function kindOf(question) {
  const kind = (mainTrait(question) ?? '').split(':')[0]
  return OPINION_KINDS.includes(kind) ? kind : null
}

function dontKnowsByKind(game, questions) {
  const byId = Object.fromEntries(questions.map((q) => [q.id, q]))
  const counts = {}
  for (const { id, answer } of game.asked) {
    const kind = byId[id] && kindOf(byId[id])
    if (answer === 0 && kind) counts[kind] = (counts[kind] ?? 0) + 1
  }
  return counts
}

// A well-known movie from near the top of the current ranking. Skips the top
// 3 so the question compares against a close alternative, and the [movie]
// penalty doesn't land on the current front-runners.
function pickReferenceMovie(game, ranked) {
  const usedIds = game.asked.filter((a) => a.ref).map((a) => a.ref.id)
  const options = ranked
    .slice(3, 15)
    .map((r) => r.movie)
    .filter((movie) => movie.vote_count >= MIN_REF_VOTES && !usedIds.includes(movie.id))
    .sort((a, b) => b.vote_count - a.vote_count)
  return options[0] ?? null
}

// The tier the game "should" be on: 1 (broad) at the start, drifting to
// narrow by the end. Questions far from it get a penalty.
function targetTier(game) {
  const progress = Math.min(1, game.asked.length / game.questionLimit)
  return START_TIER + (END_TIER - START_TIER) * progress
}

// Would a Yes pull more matching movies from TMDB? If so, the current pool
// understates how many exist (e.g. 2% zombie movies now, 40 more on a Yes).
function canPullMore(game, question) {
  return question.fill === 'movie' || refillQuery(game, question, 1) !== null
}

// Questions with a "slot" (e.g. [6, 9]) are asked once, at a random question
// number in that range. Each turn in the range has an equal chance.
function slotIsDue(game, question, random) {
  if (!question.slot || (game.askCounts[question.id] ?? 0) > 0) return false
  const number = game.asked.length + 1
  const [from, to] = question.slot
  if (number < from || number > to) return false
  return random() < 1 / (to - number + 1)
}

function withText(question, ref) {
  const text = ref
    ? question.text.replace('[movie]', `${ref.title} (${releaseYear(ref)})`)
    : question.text
  return { question, ref, text }
}

export function nextQuestion(game, questions, random = Math.random) {
  const ranked = rankMovies(game)
  if (ranked.length === 0) return null
  const weights = softmax(ranked.map((r) => r.score))
  const target = targetTier(game)
  const tierOf = Object.fromEntries(questions.map((q) => [q.id, q.tier]))
  const dontKnows = dontKnowsByKind(game, questions)

  const options = []
  for (const question of questions) {
    if ((game.askCounts[question.id] ?? 0) >= (question.repeat ?? 1)) continue
    const parent = latestParent(game, question)
    if (question.follows && !parent) continue
    const fresh = parent !== null && parent.ago <= FRESH_WINDOW
    if (needsDetails(question) && !game.detailsLoaded) continue

    const ref = question.fill === 'movie' ? pickReferenceMovie(game, ranked) : null
    if (question.fill === 'movie' && !ref) continue

    // A question whose slot has come up jumps the line
    if (slotIsDue(game, question, random)) return withText(question, ref)
    // A fresh Yes to the parent unlocks a follow-up right away
    if (!fresh && game.asked.length < TIER_UNLOCK[question.tier]) continue

    // Weighted share of movies on each side of the question
    let yes = 0
    let no = 0
    ranked.forEach((r, i) => {
      const match = questionMatch(question, r.movie, ref)
      if (match > 0.6) yes += weights[i]
      else if (match < 0.4) no += weights[i]
    })
    const decided = yes + no
    let share = decided === 0 ? 0 : yes / decided
    if (canPullMore(game, question)) {
      let floor = NARROW_SHARE_FLOOR
      if (question.tier <= 2) floor = BROAD_SHARE_FLOOR
      else if (question.tier === 3 || parent) floor = SHARE_FLOOR
      share = Math.max(share, floor)
    }
    const info = entropy(share) * decided
    if (info < MIN_INFO) continue

    // A follow-up counts as one step narrower than its parent, not its own tier
    const tier = parent ? Math.min(question.tier, tierOf[parent.id] + 1) : question.tier
    const bonus = parent ? (fresh ? FRESH_FOLLOW_UP_BONUS : FOLLOW_UP_BONUS) : 0
    // Two or more "Don't know" answers to this kind of question: hold it back
    const shrugs = dontKnows[kindOf(question)] ?? 0
    const holdBack = shrugs >= 2 ? DONT_KNOW_PENALTY * (shrugs - 1) : 0
    const value = info - TIER_PENALTY * Math.abs(tier - target) + bonus - holdBack
    options.push({ question, ref, value })
  }
  if (options.length === 0) return null

  // Random pick among the near-best questions, so games don't all go the same way
  const topValue = Math.max(...options.map((o) => o.value))
  const closeOnes = options.filter((o) => o.value >= topValue - CLOSE_ENOUGH)
  const best = closeOnes[Math.floor(random() * closeOnes.length)]
  return withText(best.question, best.ref)
}

// ---------------------------------------------------------------------------
// Answers

function addToProfile(profile, traits, amount) {
  const next = { ...profile }
  for (const [trait, weight] of Object.entries(traits)) {
    const total = (next[trait] ?? 0) + amount * weight
    next[trait] = Math.max(-TRAIT_CAP, Math.min(TRAIT_CAP, total))
  }
  return next
}

// answerValue: Yes 1, Probably 0.5, Don't know 0, Probably not -0.5, No -1
// recommendations: only for "like [movie]" questions (fetched live by the caller)
// Hard Yes/No filters are applied separately by applyHardFilter (see below).
export function applyAnswer(game, current, answerValue, recommendations = []) {
  const { question, ref, text } = current
  const next = {
    ...game,
    asked: [...game.asked, { id: question.id, text, ref, answer: answerValue }],
    askCounts: { ...game.askCounts, [question.id]: (game.askCounts[question.id] ?? 0) + 1 },
  }

  if (question.fill === 'movie') {
    return applyLikeMovie(next, ref, answerValue, recommendations)
  }
  return { ...next, profile: addToProfile(next.profile, question.traits, answerValue) }
}

// Hard questions: a plain Yes / No removes movies that don't fit.
// Run this AFTER pulling more movies for the answer, so the safety net counts
// them. Otherwise "Korean? Yes" with only 3 Korean movies in the pool would be
// treated as a soft answer even though the refill just added 40 more.
export function applyHardFilter(game, question, answerValue) {
  if (!question.hard || Math.abs(answerValue) !== 1) return game
  const filtered = {
    ...game,
    hardFilters: [...game.hardFilters, { trait: mainTrait(question), wanted: answerValue > 0 }],
  }
  // Safety net: never filter down to almost nothing
  return candidates(filtered).length >= MIN_MOVIES_LEFT ? filtered : game
}

function applyLikeMovie(game, ref, answerValue, recommendations) {
  const boosts = { ...game.boosts }
  for (const movie of recommendations) {
    const before = boosts[movie.id]?.amount ?? 0
    boosts[movie.id] = { amount: before + answerValue * RECOMMENDED_BOOST, because: ref.title }
  }
  // You probably want something *like* the [movie], not the movie itself.
  // It's not removed though: if it's still the best fit, it can win, and
  // "Already seen it" on the result screen covers the rest.
  boosts[ref.id] = {
    amount: (boosts[ref.id]?.amount ?? 0) - REFERENCE_PENALTY,
    because: ref.title,
  }

  // On a yes, TMDB's recommendations join the pool
  const withRecs = answerValue > 0 ? addMovies(game, recommendations) : game
  return {
    ...withRecs,
    profile: addToProfile(game.profile, likeTraits(ref), answerValue),
    boosts,
  }
}

export function excludeMovie(game, movieId) {
  return { ...game, excludedIds: [...game.excludedIds, movieId] }
}

// ---------------------------------------------------------------------------
// Pulling more movies live

// Ids behind the profile's strong preferences for one kind of trait, strongest
// first, e.g. strongIds(profile, 'genre:', (w) => w >= 1) -> ['27', '878']
function strongIds(profile, prefix, test) {
  return Object.entries(profile)
    .filter(([trait, weight]) => trait.startsWith(prefix) && test(weight))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([trait]) => trait.slice(prefix.length))
}

// After a Yes / Probably, a TMDB search for more movies like that answer.
// Returns { params, fallback, hints } or null if there's nothing to search:
//   params    the sharpest search: this answer + hard filters + your strong
//             answers so far (e.g. horror + after 2015 + zombies)
//   fallback  the plain search (this answer + hard filters), used if the
//             sharp one finds too little. null if they're the same.
export function refillQuery(game, question, answerValue) {
  if (answerValue <= 0 || !question.traits) return null

  // 1. What this answer asks for
  const params = {}
  const hints = {}
  const genres = new Set() // movies must have ALL of these
  let anyGenre = null // ...or, for a genre group, ANY of these
  let language = null
  const trait = mainTrait(question)
  if (trait.startsWith('genre:')) {
    genres.add(trait.slice('genre:'.length))
  } else if (GENRE_GROUPS[trait]) {
    anyGenre = GENRE_GROUPS[trait]
  } else if (trait.startsWith('theme:')) {
    params.with_keywords = themeKeywordIds(trait.slice('theme:'.length)).join('|')
    hints[trait] = 1
  } else if (trait === 'format:anime') {
    genres.add('16')
    language = 'ja'
  } else if (/^lang:[a-z]{2}$/.test(trait)) {
    language = trait.slice('lang:'.length)
  } else if (ERA_DATES[trait]) {
    const [from, to] = ERA_DATES[trait]
    if (from) params['primary_release_date.gte'] = from
    if (to) params['primary_release_date.lte'] = to
  } else {
    return null
  }

  // 2. Keep the hard filters from earlier answers (this answer's language wins)
  let anyForeign = false
  for (const filter of game.hardFilters) {
    if (filter.trait === 'lang:foreign') {
      if (filter.wanted) anyForeign = true
      else language ??= 'en'
      continue
    }
    if (!filter.wanted) continue
    if (filter.trait.startsWith('genre:')) genres.add(filter.trait.slice('genre:'.length))
    if (/^lang:[a-z]{2}$/.test(filter.trait)) language ??= filter.trait.slice('lang:'.length)
    if (filter.trait === 'format:anime') {
      genres.add('16')
      language ??= 'ja'
    }
  }

  // TMDB can't search for "any language except English". Without a specific
  // language the results would mostly be English movies that get filtered out.
  if (anyForeign && !language) return null
  // TMDB can't mix "all of these genres" (,) and "any of these" (|) in one search
  if (anyGenre && genres.size > 0) return null

  // The plain search: this answer + the hard filters
  const basic = { ...params }
  if (anyGenre) basic.with_genres = anyGenre.join('|')
  else if (genres.size > 0) basic.with_genres = [...genres].join(',')
  if (language) basic.with_original_language = language

  // 3. The sharper search: also use your strong answers so far
  const sharp = { ...basic }
  const liked = strongIds(game.profile, 'genre:', (w) => w >= STRONG_ANSWER)
    .filter((id) => !genres.has(id))
    .slice(0, MAX_EXTRA_GENRES)
  if (!anyGenre && liked.length > 0) sharp.with_genres = [...genres, ...liked].join(',')
  const disliked = strongIds(game.profile, 'genre:', (w) => w <= -STRONG_ANSWER).filter(
    (id) => !genres.has(id) && !anyGenre?.includes(Number(id)),
  )
  if (disliked.length > 0) sharp.without_genres = disliked.join('|')

  const answerIsEra = Boolean(ERA_DATES[trait])
  if (!answerIsEra) {
    const [era] = strongIds(game.profile, 'era:', (w) => w >= STRONG_ANSWER)
    if (ERA_DATES[`era:${era}`]) {
      const [from, to] = ERA_DATES[`era:${era}`]
      if (from) sharp['primary_release_date.gte'] = from
      if (to) sharp['primary_release_date.lte'] = to
    } else {
      // No era you wanted, but maybe ones you ruled out
      if ((game.profile['era:recent'] ?? 0) <= -STRONG_ANSWER) {
        sharp['primary_release_date.lte'] = '2014-12-31'
      }
      if ((game.profile['era:classic'] ?? 0) <= -STRONG_ANSWER) {
        sharp['primary_release_date.gte'] = '1990-01-01'
      }
    }
  }

  const isSharper = JSON.stringify(sharp) !== JSON.stringify(basic)
  return { params: sharp, fallback: isSharper ? basic : null, hints }
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
  const fresh = [...found.values()]
    .filter((movie) => !known.has(movie.id))
    .map((movie) => ({ ...movie, hints }))
  return { ...game, pool: addTraits([...pool, ...fresh], game.trendingCutoff) }
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
  return { ...game, pool: addTraits(pool, game.trendingCutoff), detailsLoaded: true }
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
