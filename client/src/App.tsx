import { useEffect, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? ''

type ApiStatus = 'checking' | 'online' | 'offline'

function App() {
  const [status, setStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body: { ok: boolean }) => setStatus(body.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'))
  }, [])

  return (
    <main>
      <h1>Writers Wrefined</h1>
      <p>A continuity checker for fantasy authors.</p>
      <p className={`status status-${status}`}>API: {status}</p>
    </main>
  )
}

export default App
