import { posterUrl } from '../api/tmdb.js'
import { GENRES, releaseYear } from '../engine/traits.js'

// One recommended movie: poster, details, "why this movie" and a TMDB link.
// `compact` is the smaller version used when a few picks are shown side by side.
export default function MovieCard({ movie, reasons, compact = false, children }) {
  const poster = posterUrl(movie.poster_path, compact ? 'w185' : 'w342')
  const genres = movie.genre_ids.map((id) => GENRES[id]).join(', ')
  const runtime = movie.details?.runtime
  const meta = [
    `★ ${movie.vote_average.toFixed(1)} (${movie.vote_count.toLocaleString()} votes)`,
    movie.details?.certification,
    runtime && `${Math.floor(runtime / 60)}h ${runtime % 60}m`,
    genres,
  ].filter(Boolean)

  return (
    <article className={compact ? 'result-card compact' : 'result-card'}>
      {poster ? (
        <img className="poster" src={poster} alt={`Poster for ${movie.title}`} />
      ) : (
        <div className="poster poster-missing">No poster</div>
      )}

      <div className="result-info">
        <h2 className="result-title">
          {movie.title} <span className="result-year">({releaseYear(movie)})</span>
        </h2>
        <p className="result-meta">{meta.join(' · ')}</p>
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

        {children}
      </div>
    </article>
  )
}
