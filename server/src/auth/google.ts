/**
 * Signing in with Google: the standard OpenID Connect "authorization code"
 * flow, run on the server with PKCE. The browser goes to Google, the person
 * picks their account, Google sends the browser back with a one-time code,
 * and the server swaps that code for who the person is. The client secret
 * never leaves the server.
 */

/** Who Google says the person is. */
export interface Identity {
  /** Google's permanent id for the account; an email address can change. */
  subject: string
  email: string
  emailVerified: boolean
  name: string
  picture?: string
  /** The Google Workspace domain the account belongs to; absent for personal accounts. */
  hostedDomain?: string
}

/** Where people sign in. Google in the app; a stand-in in tests. */
export interface IdentityProvider {
  authorizeUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<Identity>
}

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export interface GoogleOptions {
  clientId: string
  clientSecret: string
  /** Only offer accounts from this Workspace domain in Google's account picker. A hint for people, not a check. */
  hostedDomain?: string
  fetch?: typeof fetch
}

export function googleProvider({ clientId, clientSecret, hostedDomain, fetch: fetchFn = fetch }: GoogleOptions): IdentityProvider {
  return {
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })
      if (hostedDomain) q.set('hd', hostedDomain)
      return `${AUTHORIZE_URL}?${q}`
    },

    async exchange({ code, codeVerifier, redirectUri }) {
      const res = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          code_verifier: codeVerifier,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`Google's token endpoint answered ${res.status}`)
      const { id_token: idToken } = (await res.json()) as { id_token?: string }
      if (!idToken) throw new Error('Google sent no ID token')
      return identityFromIdToken(idToken, clientId)
    },
  }
}

/**
 * Read the ID token Google's token endpoint returned. It came straight from
 * Google over TLS in answer to a request made with our client secret, which
 * OpenID Connect accepts in place of checking the token's signature (Core
 * 1.0, section 3.1.3.7). The claims are still checked: it must be from
 * Google, for this app, and not expired.
 */
export function identityFromIdToken(idToken: string, clientId: string, now = Date.now()): Identity {
  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('Unreadable ID token')
  }
  if (!ISSUERS.includes(String(claims.iss))) throw new Error('ID token is not from Google')
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(clientId)) throw new Error('ID token is for another app')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) throw new Error('ID token has expired')
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new Error('ID token has no account or email')
  const email = claims.email.toLowerCase()
  return {
    subject: claims.sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' && claims.name ? claims.name : email,
    ...(typeof claims.picture === 'string' ? { picture: claims.picture } : {}),
    ...(typeof claims.hd === 'string' ? { hostedDomain: claims.hd.toLowerCase() } : {}),
  }
}
