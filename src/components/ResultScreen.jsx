import { useState } from 'react'
import { posterUrl } from '../api/tmdb.js'
import { explainPick, rankMovies } from '../engine/engine.js'
import { GENRES, releaseYear } from '../engine/traits.js'
import Bubble from './Bubble.jsx'

export default function ResultScreen({ game, onSeen, onRestart }) {
  const [happy, setHappy] = useState(false)
  const ranked = rankMovies(game)

  if (ranked.length === 0) {
    return (
      <>
        <Bubble>I ran out of movies! Let&apos;s try another round.</Bubble>
        <button type="button" className="primary-button" onClick={onRestart}>
          Play again
        </button>
      </>
    )
  }

  const [{ movie }, ...rest] = ranked
  const reasons = explainPick(game, movie)
  const poster = posterUrl(movie.poster_path)
  const genres = movie.genre_ids.map((id) => GENRES[id]).join(', ')

  return (
    <section className="result">
      <p className="result-intro">I think you should watch…</p>

      <article className="result-card">
        {poster ? (
          <img className="poster" src={poster} alt={`Poster for ${movie.title}`} />
        ) : (
          <div className="poster poster-missing">No poster</div>
        )}

        <div className="result-info">
          <h2 className="result-title">
            {movie.title} <span className="result-year">({releaseYear(movie)})</span>
          </h2>
          <p className="result-meta">
            ★ {movie.vote_average.toFixed(1)} · {movie.vote_count.toLocaleString()} votes
            {genres && ` · ${genres}`}
          </p>
          <p className="result-overview">{movie.overview}</p>

          {reasons.length > 0 && (
            <div className="reasons">
              <p className="reasons-title">Why this movie</p>
              <ul className="reason-list">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <a
            className="tmdb-link"
            href={`https://www.themoviedb.org/movie/${movie.id}`}
            target="_blank"
            rel="noreferrer"
          >
            View on TMDB →
          </a>
        </div>
      </article>

      {happy ? (
        <>
          <p className="enjoy">Enjoy the movie! 🍿</p>
          <button type="button" className="primary-button" onClick={onRestart}>
            Play again
          </button>
        </>
      ) : (
        <div className="result-actions">
          <button type="button" className="answer-button" onClick={() => setHappy(true)}>
            Sounds good!
          </button>
          <button type="button" className="answer-button" onClick={() => onSeen(movie.id)}>
            Already seen it
          </button>
          <button type="button" className="answer-button" onClick={onRestart}>
            Play again
          </button>
        </div>
      )}

      {rest.length > 0 && (
        <div className="runner-ups">
          <p className="reasons-title">Also a good fit</p>
          <ul>
            {rest.slice(0, 3).map(({ movie: other }) => (
              <li key={other.id}>
                {other.title} ({releaseYear(other)})
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
