import { useState } from 'react'
import { posterUrl } from '../api/tmdb.js'

// A profile's "Already seen it" movies, newest first. None of these come up in
// a game again; Remove puts one back in the running. At the bottom: delete the
// whole profile (asks first).
export default function SeenScreen({ profile, onRemove, onDeleteProfile, onClose }) {
  const seen = [...profile.seen].reverse()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function deleteProfile() {
    setDeleting(true)
    setDeleteError('')
    try {
      await onDeleteProfile(profile.name)
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(false)
    }
  }

  return (
    <section className="seen-screen">
      <div>
        <h2 className="seen-title">{profile.name}&apos;s seen movies</h2>
        <p className="seen-note">
          {seen.length === 0
            ? 'Nothing here yet. Movies you mark "Already seen it", or request, show up here.'
            : `ReelMind won't suggest ${seen.length === 1 ? 'this one' : `these ${seen.length}`} to ${profile.name} again.`}
        </p>
      </div>

      {seen.length > 0 && (
        <ul className="seen-list">
          {seen.map((movie) => {
            const thumb = posterUrl(movie.poster, 'w154')
            return (
              <li key={movie.id} className="seen-item">
                <a
                  className="seen-link"
                  href={`https://www.themoviedb.org/movie/${movie.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {thumb ? (
                    <img className="runner-up-poster" src={thumb} alt="" />
                  ) : (
                    <span className="runner-up-poster poster-missing" />
                  )}
                  <span className="runner-up-title">
                    {movie.title}
                    {movie.year && <span className="runner-up-year"> ({movie.year})</span>}
                  </span>
                  {movie.requested && <span className="seen-tag">Requested</span>}
                </a>
                <button
                  type="button"
                  className="seen-remove"
                  onClick={() => onRemove(movie.id)}
                  aria-label={`Remove ${movie.title} from seen movies`}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className="text-button" onClick={onClose}>
        ← Back
      </button>

      <div className="profile-delete">
        {confirming ? (
          <>
            <p className="profile-delete-question">
              Delete {profile.name}&apos;s profile?
              {seen.length > 0 &&
                ` Their ${seen.length} seen ${seen.length === 1 ? 'movie goes' : 'movies go'} with it.`}{' '}
              This can&apos;t be undone.
            </p>
            <div className="card-actions">
              <button
                type="button"
                className="small-button danger-button"
                onClick={deleteProfile}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : `Delete ${profile.name}`}
              </button>
              <button
                type="button"
                className="small-button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="text-button danger-link" onClick={() => setConfirming(true)}>
            Delete this profile
          </button>
        )}
        {deleteError && <p className="profile-error">{deleteError}</p>}
      </div>
    </section>
  )
}
