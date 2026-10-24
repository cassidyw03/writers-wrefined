import { useState, type FormEvent } from 'react'
import { authClient } from './authClient'
import './LoginForm.css'

type Mode = 'log-in' | 'sign-up'

// One form for both logging in and creating an account. On success Better Auth sets the session
// cookie and useSession() in App picks up the new user.
export function LoginForm() {
  const [mode, setMode] = useState<Mode>('log-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } =
      mode === 'log-in'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name: name.trim(), email, password })
    if (error) setError(error.message ?? 'Something went wrong. Try again.')
    setBusy(false)
  }

  function switchMode() {
    setMode(mode === 'log-in' ? 'sign-up' : 'log-in')
    setError(null)
  }

  return (
    <form className="chapter-form auth-form" onSubmit={handleSubmit}>
      <h2>{mode === 'log-in' ? 'Log in' : 'Create an account'}</h2>

      {mode === 'sign-up' && (
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </label>
      )}

      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>

      <label>
        Password {mode === 'sign-up' && <span className="muted">(at least 8 characters)</span>}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'log-in' ? 'current-password' : 'new-password'}
          minLength={8}
          required
        />
      </label>

      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <div className="form-footer">
        <button type="button" className="link-button" onClick={switchMode}>
          {mode === 'log-in' ? 'New here? Create an account' : 'Already have an account? Log in'}
        </button>
        <button type="submit" disabled={busy}>
          {mode === 'log-in' ? 'Log in' : 'Sign up'}
        </button>
      </div>
    </form>
  )
}
