import { useState } from 'react'
import questions from './data/questions.json'
import { fetchRecommendations, fetchStartingPool } from './api/tmdb.js'
import {
  MAX_QUESTIONS,
  applyAnswer,
  excludeMovie,
  newGame,
  nextQuestion,
  shouldGuess,
} from './engine/engine.js'
import Bubble from './components/Bubble.jsx'
import QuestionScreen from './components/QuestionScreen.jsx'
import ResultScreen from './components/ResultScreen.jsx'
import DebugPanel from './components/DebugPanel.jsx'
import './App.css'

function App() {
  const [phase, setPhase] = useState('start') // start | loading | question | result | error
  const [game, setGame] = useState(null)
  const [current, setCurrent] = useState(null) // { question, ref, text }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Save the new game state, then either ask another question or show the result
  function advance(nextGame) {
    const question = shouldGuess(nextGame) ? null : nextQuestion(nextGame, questions)
    setGame(nextGame)
    setCurrent(question)
    setPhase(question ? 'question' : 'result')
  }

  async function startGame() {
    setPhase('loading')
    setError('')
    try {
      const movies = await fetchStartingPool()
      advance(newGame(movies))
    } catch (err) {
      setError(err.message)
      setPhase('error')
    }
  }

  async function handleAnswer(value) {
    setBusy(true)
    let recommendations = []
    if (current.question.fill === 'movie' && value !== 0) {
      try {
        recommendations = await fetchRecommendations(current.ref.id)
      } catch {
        // Not critical: keep playing without the recommendations
      }
    }
    advance(applyAnswer(game, current, value, recommendations))
    setBusy(false)
  }

  return (
    <div className="app">
      <main className="game">
        <h1 className="title">ReelMind</h1>

        {phase === 'start' && (
          <>
            <Bubble>
              Think about what you&apos;re in the mood for. I&apos;ll ask a few questions and
              pick a movie for you.
            </Bubble>
            <button type="button" className="primary-button" onClick={startGame}>
              Start
            </button>
          </>
        )}

        {phase === 'loading' && <Bubble thinking>Warming up the projector…</Bubble>}

        {phase === 'error' && (
          <>
            <Bubble label="Something went wrong">
              <span className="error-text">{error}</span>
            </Bubble>
            <button type="button" className="primary-button" onClick={startGame}>
              Try again
            </button>
          </>
        )}

        {phase === 'question' && (
          <QuestionScreen
            number={game.asked.length + 1}
            max={MAX_QUESTIONS}
            text={current.text}
            busy={busy}
            onAnswer={handleAnswer}
          />
        )}

        {phase === 'result' && (
          <ResultScreen
            game={game}
            onSeen={(movieId) => setGame(excludeMovie(game, movieId))}
            onRestart={startGame}
          />
        )}
      </main>

      {(phase === 'question' || phase === 'result') && <DebugPanel game={game} />}

      <footer className="footer">
        This product uses the TMDB API but is not endorsed or certified by TMDB. Movie data and
        posters from{' '}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
          themoviedb.org
        </a>
        .
      </footer>
    </div>
  )
}

export default App
