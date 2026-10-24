import { createAuthClient } from 'better-auth/react'

// Talks to Better Auth on the API at /api/auth. In dev the Vite proxy forwards /api; in production the
// static site rewrites /api to the API service, so the session cookie stays on the site's own domain.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || window.location.origin,
  basePath: '/api/auth',
})
