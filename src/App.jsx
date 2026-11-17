import { useMemo, useRef, useState } from 'react'
import questions from './data/questions.json'
import { answerQuestion, startNewGame } from './gameFlow.js'
import { useProfiles } from './useProfiles.js'
import {
  canKeepGoing,
  excludeMovies,
  keepGoing,
  nextQuestion,
  shouldGuess,
} from './engine/engine.js'
import Bubble from './components/Bubble.jsx'
import QuestionScreen from './components/QuestionScreen.jsx'
import ResultScreen from './components/ResultScreen.jsx'
import DebugPanel from './components/DebugPanel.jsx'
import ProfileMenu from './components/ProfileMenu.jsx'
import SeenScreen from './components/SeenScreen.jsx'
import './App.css'

function App() {
  const [phase, setPhase] = useState('start') // start | loading | question | result | error
  const [savedGame, setGame] = useState(null)
  const [current, setCurrent] = useState(null) // { question, ref, text }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Screens you can go Back to: [{ phase, game, current }], newest last
  const [history, setHistory] = useState([])

  // Who's playing, and the movies they've already seen
  const profiles = useProfiles()
  const { seenIds } = profiles
  // The seen-movies list sits on top of the game, which stays where it was
  const [showSeen, setShowSeen] = useState(false)
  // Switched to Guest, or deleted the profile: close it, so it doesn't pop up
  // again the next time someone picks a profile
  if (showSeen && !profiles.active) setShowSeen(false)
  const view = showSeen && profiles.active ? 'seen' : phase

  // The game as it's played: the profile's seen movies never come up. Applied
  // here rather than once at the start, so it also covers switching profile
  // mid-game, going Back, and the seen list loading after a game has started.
  const game = useMemo(
    () => savedGame && excludeMovies(savedGame, seenIds),
    [savedGame, seenIds],
  )

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
  function advance(newState) {
    const nextGame = excludeMovies(newState, seenIds) // so the next question skips them too
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
    setShowSeen(false)
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

  // "Already seen it": gone from this game, and saved to the profile (if one is picked)
  function markSeen(movie) {
    setGame(excludeMovies(game, [movie.id]))
    profiles.markSeen(movie)
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
      {profiles.available && (
        <header className="topbar">
          <ProfileMenu profiles={profiles} onOpenSeen={() => setShowSeen(true)} />
        </header>
      )}

      <main className="game">
        <h1 className="title">
          <button type="button" className="title-button" onClick={goHome} title="Back to start">
            ReelMind
          </button>
        </h1>

        {view === 'seen' && (
          <SeenScreen
            key={profiles.active.name} // a fresh screen (no half-asked "Delete?") per profile
            profile={profiles.active}
            onRemove={profiles.unmarkSeen}
            onDeleteProfile={profiles.removeProfile}
            onClose={() => setShowSeen(false)}
          />
        )}

        {/* Hidden, not removed, while the seen list is open, so the game is just as you left it */}
        <div className="screens" hidden={view === 'seen'}>
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
              onSeen={markSeen}
              onRestart={startGame}
              canContinue={canKeepGoing(game, questions)}
              onContinue={continueGame}
              canGoBack={history.length > 0}
              onBack={goBack}
            />
          )}
        </div>
      </main>

      {(view === 'question' || view === 'result') && <DebugPanel game={game} />}

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
