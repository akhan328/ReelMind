import { useEffect, useState } from 'react'
import { fetchSeerrStatus, requestMovie } from '../api/seerr.js'

const MESSAGES = {
  available: "It's already on your server.",
  processing: "It's been requested and is downloading. It'll show up in Jellyfin when it's ready.",
  requested: "It's been requested and is waiting for approval.",
  blocked: "This movie is blocked from requests on your server.",
}

// Under "Enjoy [movie]!": is it on your server? If not, "Request it" sends it to
// Seerr, which has Radarr download it. Shows nothing if Seerr isn't set up.
// onRequested(movie): after a request goes through. Resolves to the profile's
// name if the movie was saved to one (so it isn't suggested again), else null.
export default function SeerrPanel({ movie, onRequested }) {
  const [info, setInfo] = useState(null) // { enabled, status, watchUrl }, null while checking
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const [savedTo, setSavedTo] = useState(null) // profile the request was saved to

  useEffect(() => {
    let current = true
    fetchSeerrStatus(movie.id)
      .then((result) => current && setInfo(result))
      .catch((err) => current && setError(`Couldn't check your server. ${err.message}`))
    return () => {
      current = false
    }
  }, [movie.id])

  async function request() {
    setRequesting(true)
    setError('')
    try {
      const result = await requestMovie(movie.id)
      setInfo((before) => ({ ...before, status: result.status }))
      if (onRequested) setSavedTo(await onRequested(movie))
    } catch (err) {
      setError(err.message)
    } finally {
      setRequesting(false)
    }
  }

  if (info?.enabled === false) return null

  return (
    <div className="seerr" aria-live="polite">
      {!info && !error && <p className="seerr-note">Checking your server…</p>}

      {info?.status === 'none' && (
        <>
          <p className="seerr-note">It&apos;s not on your server yet.</p>
          <button type="button" className="primary-button" onClick={request} disabled={requesting}>
            {requesting ? 'Requesting…' : 'Request it'}
          </button>
        </>
      )}

      {MESSAGES[info?.status] && <p className="seerr-note">{MESSAGES[info.status]}</p>}

      {savedTo && (
        <p className="seerr-note">
          Added to {savedTo}&apos;s movies, so it won&apos;t be suggested again.
        </p>
      )}

      {info?.status === 'available' && info.watchUrl && (
        <a className="primary-button" href={info.watchUrl} target="_blank" rel="noreferrer">
          Watch in Jellyfin
        </a>
      )}

      {error && <p className="seerr-error">{error}</p>}
    </div>
  )
}
