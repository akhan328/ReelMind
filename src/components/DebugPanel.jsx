import { candidates, rankMovies } from '../engine/engine.js'
import { traitLabel } from '../engine/traits.js'

// Collapsible panel that shows what the algorithm is thinking. Handy while testing.
export default function DebugPanel({ game }) {
  const ranked = rankMovies(game)
  const profile = Object.entries(game.profile)
    .filter(([, weight]) => Math.abs(weight) > 0.001)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))

  return (
    <details className="debug">
      <summary>Behind the scenes</summary>

      <p>
        {game.pool.length} movies pulled from TMDB · {candidates(game).length} still in the
        running
      </p>

      <h3>Top 5 right now</h3>
      <ol>
        {ranked.slice(0, 5).map(({ movie, score }) => (
          <li key={movie.id}>
            {movie.title} <span className="debug-score">{score.toFixed(2)}</span>
          </li>
        ))}
      </ol>

      <h3>Taste profile</h3>
      {profile.length === 0 ? (
        <p>No answers yet.</p>
      ) : (
        <ul>
          {profile.map(([trait, weight]) => (
            <li key={trait}>
              {traitLabel(trait)}{' '}
              <span className="debug-score">
                {weight > 0 ? '+' : ''}
                {weight.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {game.hardFilters.length > 0 && (
        <>
          <h3>Hard filters</h3>
          <ul>
            {game.hardFilters.map((filter) => (
              <li key={filter.trait}>{traitLabel(filter.trait, filter.wanted)} only</li>
            ))}
          </ul>
        </>
      )}
    </details>
  )
}
