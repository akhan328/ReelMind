import { useEffect, useRef, useState } from 'react'

// Top-right profile switcher: pick who's playing, add a profile, or open
// your seen movies. `profiles` is what useProfiles() returns.
export default function ProfileMenu({ profiles, onOpenSeen }) {
  const { active, error } = profiles
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')
  const [saving, setSaving] = useState(false)
  const menu = useRef(null)

  function close() {
    setOpen(false)
    setAdding(false)
    setNewName('')
    setAddError('')
  }

  function toggle() {
    if (open) return close()
    setOpen(true)
    profiles.refresh() // pick up profiles added elsewhere, or by editing the file
  }

  // Close when clicking anywhere else, or on Escape
  useEffect(() => {
    if (!open) return
    function onPointerDown(event) {
      if (!menu.current?.contains(event.target)) close()
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function pick(name) {
    profiles.select(name)
    close()
  }

  async function add(event) {
    event.preventDefault()
    setSaving(true)
    setAddError('')
    try {
      await profiles.create(newName)
      close()
    } catch (err) {
      setAddError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-menu" ref={menu}>
      <button
        type="button"
        className="profile-button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        title="Switch profile"
      >
        <span className={active ? 'avatar' : 'avatar guest'} aria-hidden="true">
          {active ? active.name[0].toUpperCase() : '?'}
        </span>
        <span className="profile-name">{active ? active.name : 'Guest'}</span>
        <span className="profile-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="profile-dropdown">
          <p className="profile-heading">Who&apos;s watching?</p>

          <ul className="profile-list">
            {profiles.profiles.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  className="profile-option"
                  aria-pressed={active?.name === p.name}
                  onClick={() => pick(p.name)}
                >
                  <span className="avatar" aria-hidden="true">
                    {p.name[0].toUpperCase()}
                  </span>
                  <span className="profile-option-name">{p.name}</span>
                  <span className="profile-option-count">{p.seenCount} seen</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="profile-option"
                aria-pressed={!active}
                onClick={() => pick(null)}
              >
                <span className="avatar guest" aria-hidden="true">
                  ?
                </span>
                <span className="profile-option-name">Guest</span>
                <span className="profile-option-count">nothing saved</span>
              </button>
            </li>
          </ul>

          {adding ? (
            <form className="profile-add" onSubmit={add}>
              <input
                className="profile-input"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Your name"
                aria-label="New profile name"
                maxLength={24}
                autoFocus
              />
              <button type="submit" className="small-button" disabled={saving || !newName.trim()}>
                Add
              </button>
            </form>
          ) : (
            <button type="button" className="profile-link" onClick={() => setAdding(true)}>
              + Add a profile
            </button>
          )}
          {addError && <p className="profile-error">{addError}</p>}
          {error && <p className="profile-error">{error}</p>}

          {active && (
            <button
              type="button"
              className="profile-link"
              onClick={() => {
                close()
                onOpenSeen()
              }}
            >
              🎬 {active.name}&apos;s seen movies ({active.seen.length})
            </button>
          )}
        </div>
      )}

      {error && !open && <p className="profile-error profile-error-floating">{error}</p>}
    </div>
  )
}
