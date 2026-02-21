/**
 * google-oauth.js — Google OAuth 2.0 helpers.
 *
 * Handles authorization URL generation and code-for-token exchange.
 * Config via env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * Check if Google OAuth is configured.
 */
export function isGoogleOAuthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Resolve the redirect URI — explicit env var, or derive from the request origin.
 * This allows localhost/dev to work without setting GOOGLE_REDIRECT_URI.
 * @param {Request} [req] - Incoming request (used to derive origin when env var is unset)
 * @returns {string}
 */
export function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const origin = req?.headers?.get?.("x-forwarded-proto")
    ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("host")}`
    : req?.url && new URL(req.url).origin;
  return `${origin || "http://localhost:3000"}/api/auth/google/callback`;
}

/**
 * Generate the Google OAuth consent URL.
 * @param {Request} [req] - Incoming request (for redirect URI derivation)
 * @param {string} [state] - Optional CSRF state parameter
 * @returns {string} Authorization URL
 */
export function getAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  if (state) params.set("state", state);
  return `${GOOGLE_AUTH_URL}?${params}`;
}

/**
 * Exchange an authorization code for tokens and user info.
 * @param {string} code - The authorization code from Google
 * @returns {Promise<{ googleId: string, email: string, name: string | null, picture: string | null }>}
 */
export async function exchangeCode(code, redirectUri) {
  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const tokens = await tokenRes.json();

  // Fetch user info
  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error("Failed to fetch Google user info");
  }

  const profile = await userRes.json();

  return {
    googleId: profile.id,
    email: profile.email,
    name: profile.name || null,
    picture: profile.picture || null,
  };
}
