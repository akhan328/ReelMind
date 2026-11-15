import { useRef, useState } from 'react'
import questions from './data/questions.json'
import { answerQuestion, startNewGame } from './gameFlow.js'
import {
  canKeepGoing,
  excludeMovie,
  keepGoing,
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
  // Screens you can go Back to: [{ phase, game, current }], newest last
  const [history, setHistory] = useState([])

  // Remember the screen you're on before moving away from it
  function remember(screen = { phase, game, current }) {
    setHistory((past) => [...past, screen])
  }

  // Back: return to the previous screen exactly as it was
  function goBack() {
    const previous = history.at(-1)
    if (!previous || busy) return
    setHistory(history.slice(0, -1))
    setGame(previous.game)
    setCurrent(previous.current)
    setPhase(previous.phase)
  }

  // Save the new game state, then either ask another question or show the result
  function advance(nextGame) {
    const question = shouldGuess(nextGame) ? null : nextQuestion(nextGame, questions)
    setGame(nextGame)
    setCurrent(question)
    setPhase(question ? 'question' : 'result')
  }

  // Goes up by one every time you leave a game, so anything still loading
  // from the old game is ignored when it finishes
  const session = useRef(0)

  function goHome() {
    session.current++
    setPhase('start')
    setGame(null)
    setCurrent(null)
    setBusy(false)
    setError('')
    setHistory([])
  }

  async function startGame() {
    const thisSession = ++session.current
    setPhase('loading')
    setError('')
    setHistory([])
    try {
      const newGame = await startNewGame()
      if (session.current === thisSession) advance(newGame)
    } catch (err) {
      if (session.current !== thisSession) return
      setError(err.message)
      setPhase('error')
    }
  }

  async function handleAnswer(value) {
    const thisSession = session.current
    const screenBefore = { phase, game, current }
    setBusy(true)
    const nextGame = await answerQuestion(game, current, value)
    if (session.current !== thisSession) return
    remember(screenBefore)
    advance(nextGame)
    setBusy(false)
  }

  // Show the best pick so far without answering more questions
  function stopNow() {
    remember()
    setCurrent(null)
    setPhase('result')
  }

  // From the result screen: ask more questions to narrow it down further
  function continueGame() {
    const extended = keepGoing(game)
    const question = nextQuestion(extended, questions)
    if (!question) return
    remember()
    setGame(extended)
    setCurrent(question)
    setPhase('question')
  }

  return (
    <div className="app">
      <main className="game">
        <h1 className="title">
          <button type="button" className="title-button" onClick={goHome} title="Back to start">
            ReelMind
          </button>
        </h1>

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
            max={game.questionLimit}
            text={current.text}
            busy={busy}
            onAnswer={handleAnswer}
            canStop={game.asked.length > 0}
            onStop={stopNow}
            canGoBack={history.length > 0}
            onBack={goBack}
          />
        )}

        {phase === 'result' && (
          <ResultScreen
            game={game}
            onSeen={(movieId) => setGame(excludeMovie(game, movieId))}
            onRestart={startGame}
            canContinue={canKeepGoing(game, questions)}
            onContinue={continueGame}
            canGoBack={history.length > 0}
            onBack={goBack}
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
