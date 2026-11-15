import { useState } from 'react'
import { posterUrl } from '../api/tmdb.js'
import { explainPick, rankMovies, topPicks } from '../engine/engine.js'
import { releaseYear } from '../engine/traits.js'
import Bubble from './Bubble.jsx'
import MovieCard from './MovieCard.jsx'

export default function ResultScreen({
  game,
  onSeen,
  onRestart,
  canContinue,
  onContinue,
  canGoBack,
  onBack,
}) {
  const [chosen, setChosen] = useState(null)
  const ranked = rankMovies(game)

  const backLink = canGoBack && (
    <button type="button" className="text-button" onClick={onBack}>
      ← Back
    </button>
  )

  if (chosen) {
    return (
      <section className="result">
        <p className="enjoy">Enjoy {chosen.title}! 🍿</p>
        <button type="button" className="primary-button" onClick={onRestart}>
          Play again
        </button>
      </section>
    )
  }

  if (ranked.length === 0) {
    return (
      <>
        <Bubble>I ran out of movies! Let&apos;s try another round.</Bubble>
        <button type="button" className="primary-button" onClick={onRestart}>
          Play again
        </button>
        {backLink}
      </>
    )
  }

  // One clear winner, or a close call between up to 3 movies
  const picks = topPicks(ranked)
  const closeCall = picks.length > 1
  const others = ranked.slice(picks.length, picks.length + 3)

  return (
    <section className="result">
      <p className="result-intro">{closeCall ? 'Your best matches:' : 'I think you should watch…'}</p>

      {picks.map(({ movie }) => (
        <MovieCard
          key={movie.id}
          movie={movie}
          reasons={explainPick(game, movie)}
          compact={closeCall}
        >
          {closeCall && (
            <div className="card-actions">
              <button type="button" className="small-button" onClick={() => setChosen(movie)}>
                This one!
              </button>
              <button type="button" className="small-button" onClick={() => onSeen(movie.id)}>
                Seen it
              </button>
            </div>
          )}
        </MovieCard>
      ))}

      <div className="result-actions">
        {!closeCall && (
          <>
            <button
              type="button"
              className="answer-button"
              onClick={() => setChosen(picks[0].movie)}
            >
              Sounds good!
            </button>
            <button
              type="button"
              className="answer-button"
              onClick={() => onSeen(picks[0].movie.id)}
            >
              Already seen it
            </button>
          </>
        )}
        {canContinue && (
          <button type="button" className="answer-button" onClick={onContinue}>
            Keep narrowing it down
          </button>
        )}
        <button type="button" className="answer-button" onClick={onRestart}>
          Play again
        </button>
      </div>

      {backLink}

      {others.length > 0 && (
        <div className="runner-ups">
          <p className="reasons-title">Also a good fit</p>
          <ul className="runner-up-list">
            {others.map(({ movie: other }) => {
              const thumb = posterUrl(other.poster_path, 'w154')
              const [reason] = explainPick(game, other)
              return (
                <li key={other.id}>
                  <a
                    className="runner-up"
                    href={`https://www.themoviedb.org/movie/${other.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {thumb ? (
                      <img className="runner-up-poster" src={thumb} alt="" />
                    ) : (
                      <span className="runner-up-poster poster-missing" />
                    )}
                    <span className="runner-up-title">
                      {other.title} <span className="runner-up-year">({releaseYear(other)})</span>
                    </span>
                    <span className="runner-up-meta">
                      ★ {other.vote_average.toFixed(1)}
                      {reason && ` · ${reason}`}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
