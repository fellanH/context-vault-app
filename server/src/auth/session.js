/**
 * session.js — JWT-based session cookie helpers.
 *
 * Sets/clears an HttpOnly cv_session cookie for web app auth.
 * In production (SameSite=None; Secure) to support cross-subdomain fetch.
 * API keys continue to work unchanged via Bearer auth.
 */

import { sign, verify } from "hono/jwt";

const SESSION_COOKIE = "cv_session";
const MAX_AGE = 2592000; // 30 days in seconds

// Use AUTH_REQUIRED as the prod signal — avoids requiring a separate NODE_ENV
const isProd = process.env.AUTH_REQUIRED === "true";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

/**
 * Sign a JWT and set it as the cv_session cookie.
 * SameSite=None; Secure in prod (required for cross-subdomain fetch).
 */
export async function setSessionCookie(c, userId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: userId, iat: now, exp: now + MAX_AGE };
  const token = await sign(payload, getSecret(), "HS256");

  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Path=/`,
    `HttpOnly`,
    `Max-Age=${MAX_AGE}`,
    isProd ? `SameSite=None` : `SameSite=Lax`,
  ];
  if (isProd) parts.push("Secure");

  c.header("Set-Cookie", parts.join("; "), { append: true });
}

/**
 * Clear the cv_session cookie (Max-Age=0).
 */
export function clearSessionCookie(c) {
  const parts = [
    `${SESSION_COOKIE}=`,
    `Path=/`,
    `HttpOnly`,
    `Max-Age=0`,
    isProd ? `SameSite=None` : `SameSite=Lax`,
  ];
  if (isProd) parts.push("Secure");

  c.header("Set-Cookie", parts.join("; "), { append: true });
}

/**
 * Verify a session JWT. Returns payload ({ sub, iat, exp }) or null.
 */
export async function verifySessionToken(token) {
  try {
    return await verify(token, getSecret(), "HS256");
  } catch {
    return null;
  }
}
