// Who's playing. Picking a profile means "Already seen it" is saved for that
// person, and their seen movies never come up in a game again. With no
// profile picked (Guest), nothing is saved.

import { useEffect, useMemo, useState } from 'react'
import {
  NoProfileServer,
  addProfile,
  addSeen,
  deleteProfile,
  getProfile,
  listProfiles,
  removeSeen,
} from './api/profiles.js'
import { releaseYear } from './engine/traits.js'

// Which profile this browser played as last (the profiles themselves live in profiles.json)
const LAST_PROFILE_KEY = 'reelmind:profile'

function lastProfile() {
  try {
    return localStorage.getItem(LAST_PROFILE_KEY)
  } catch {
    return null
  }
}

function rememberProfile(name) {
  try {
    if (name) localStorage.setItem(LAST_PROFILE_KEY, name)
    else localStorage.removeItem(LAST_PROFILE_KEY)
  } catch {
    // private window or storage blocked: you'll just pick again next time
  }
}

const NO_IDS = []

export function useProfiles() {
  const [available, setAvailable] = useState(false) // false until the profile server answers
  const [profiles, setProfiles] = useState([]) // [{ name, seenCount }]
  const [active, setActive] = useState(null) // { name, seen: [...] }, or null for Guest
  const [error, setError] = useState('')

  // A fresh copy of a profile from the server: use it, and update its count in the list
  function received(profile) {
    setActive((current) => (current?.name === profile.name ? profile : current))
    setProfiles((list) =>
      list.map((p) => (p.name === profile.name ? { ...p, seenCount: profile.seen.length } : p)),
    )
  }

  function failed(err) {
    if (err instanceof NoProfileServer) setAvailable(false)
    else setError(err.message)
  }

  // On load: get the profiles, and switch back to the one this browser used last
  useEffect(() => {
    let current = true
    async function load() {
      try {
        const { profiles: list } = await listProfiles()
        if (!current) return
        setProfiles(list)
        setAvailable(true)
        const last = lastProfile()
        if (last && list.some((p) => p.name === last)) {
          const profile = await getProfile(last)
          if (current) setActive(profile)
        }
      } catch (err) {
        if (!current) return
        if (!(err instanceof NoProfileServer)) setAvailable(true) // e.g. profiles.json is broken: say so
        failed(err)
      }
    }
    load()
    return () => {
      current = false
    }
  }, [])

  // Re-read the list (and the current profile), e.g. when the menu opens
  async function refresh() {
    try {
      const { profiles: list } = await listProfiles()
      setProfiles(list)
      setError('')
      if (active && list.some((p) => p.name === active.name)) received(await getProfile(active.name))
      else if (active) select(null) // it was deleted from the file
    } catch (err) {
      failed(err)
    }
  }

  // null = play as Guest
  async function select(name) {
    setError('')
    if (!name) {
      setActive(null)
      rememberProfile(null)
      return
    }
    try {
      const profile = await getProfile(name)
      setActive(profile)
      rememberProfile(profile.name)
    } catch (err) {
      failed(err)
    }
  }

  // Throws if the profile can't be added (e.g. the name is taken), so the form can say why
  async function create(name) {
    const profile = await addProfile(name)
    setError('')
    setProfiles((list) => [...list, { name: profile.name, seenCount: profile.seen.length }])
    setActive(profile)
    rememberProfile(profile.name)
  }

  // Deletes a profile and its seen movies. If it's the one playing, you're
  // back to Guest. Throws if it can't be deleted, so the screen can say why.
  async function removeProfile(name) {
    await deleteProfile(name)
    setError('')
    setProfiles((list) => list.filter((p) => p.name !== name))
    if (active?.name === name) {
      setActive(null)
      rememberProfile(null)
    }
  }

  // "Already seen it": saved to the current profile. Does nothing for Guest.
  async function markSeen(movie) {
    if (!active) return
    try {
      received(
        await addSeen(active.name, {
          id: movie.id,
          title: movie.title,
          year: releaseYear(movie),
          poster: movie.poster_path ?? null,
        }),
      )
    } catch (err) {
      setError(`Couldn't save that to ${active.name}'s profile. ${err.message}`)
    }
  }

  async function unmarkSeen(movieId) {
    if (!active) return
    try {
      received(await removeSeen(active.name, movieId))
    } catch (err) {
      setError(err.message)
    }
  }

  const seenIds = useMemo(() => active?.seen.map((movie) => movie.id) ?? NO_IDS, [active])

  return {
    available,
    profiles,
    active,
    seenIds,
    error,
    refresh,
    select,
    create,
    removeProfile,
    markSeen,
    unmarkSeen,
  }
}
