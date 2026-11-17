// Connects the algorithm (engine/) to the live TMDB calls (api/).
// Each function returns the next game state.

import {
  fetchDetails,
  fetchMoreMovies,
  fetchRecommendations,
  fetchStartingPool,
  prefetchDetails,
} from './api/tmdb.js'
import {
  addMovies,
  applyAnswer,
  applyHardFilter,
  attachDetails,
  missingDetails,
  newGame,
  refillQuery,
} from './engine/engine.js'

const DETAILS_AFTER = 2 // start using keyword / runtime / age-rating data after this many answers
const DETAILS_FOR_TOP = 80 // how many of the top-ranked movies need details
const ENOUGH_NEW_MOVIES = 15 // if the sharp search finds fewer, also run the plain one

async function orFallback(promise, fallback) {
  try {
    return await promise
  } catch {
    return fallback // not critical: keep playing without it
  }
}

export async function startNewGame() {
  const movies = await fetchStartingPool()
  // Warm up the details in the background while the first questions are answered
  prefetchDetails(movies.map((movie) => movie.id))
  return newGame(movies)
}

export async function answerQuestion(game, current, answerValue) {
  const { question, ref } = current

  let recommendations = []
  if (question.fill === 'movie' && answerValue !== 0) {
    recommendations = await orFallback(fetchRecommendations(ref.id), [])
  }
  let next = applyAnswer(game, current, answerValue, recommendations)

  // A yes to something specific: pull more movies that match it
  const refill = refillQuery(next, question, answerValue)
  if (refill) {
    let more = await orFallback(fetchMoreMovies(refill.params), [])
    if (more.length < ENOUGH_NEW_MOVIES && refill.fallback) {
      more = [...more, ...(await orFallback(fetchMoreMovies(refill.fallback), []))]
    }
    next = addMovies(next, more, refill.hints)
  }

  // Hard Yes/No filters go last, so the movies just pulled count toward the safety net
  next = applyHardFilter(next, question, answerValue)

  if (next.asked.length >= DETAILS_AFTER) next = await loadTopDetails(next)
  return next
}

// Makes sure the top contenders have keywords, runtime and age rating loaded.
// Runs twice because loading details can reshuffle the top of the ranking.
async function loadTopDetails(game) {
  let next = game
  for (let round = 0; round < 2; round++) {
    const ids = missingDetails(next, DETAILS_FOR_TOP)
    if (ids.length === 0) break
    next = attachDetails(next, await fetchDetails(ids))
  }
  return next.detailsLoaded ? next : { ...next, detailsLoaded: true }
}
