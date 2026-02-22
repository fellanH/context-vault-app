/**
 * scopes.js — API key scope definitions and enforcement helpers.
 *
 * Scopes define what a key is permitted to do:
 *   *            Full access (default for new keys)
 *   vault:read   GET /api/vault/entries, /search, /status, /manifest
 *   vault:write  POST/PUT/DELETE on vault entries, import, ingest
 *   vault:export GET /api/vault/export
 *   mcp          /mcp endpoint only
 *   keys:read    GET /api/keys
 */

export const VALID_SCOPES = [
  "*",
  "vault:read",
  "vault:write",
  "vault:export",
  "mcp",
  "keys:read",
];

/**
 * Check if a scopes array grants the required scope.
 * A key with "*" passes all scope checks.
 *
 * @param {string[]} scopes - Key's granted scopes
 * @param {string} required - Required scope for the operation
 * @returns {boolean}
 */
export function hasScope(scopes, required) {
  return scopes.includes("*") || scopes.includes(required);
}

/**
 * Validate that all requested scopes are in VALID_SCOPES.
 * Returns an error string or null if valid.
 *
 * @param {string[]} scopes
 * @returns {string|null}
 */
export function validateScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return "scopes must be a non-empty array";
  }
  const invalid = scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalid.length > 0) {
    return `Invalid scopes: ${invalid.join(", ")}. Valid scopes: ${VALID_SCOPES.join(", ")}`;
  }
  return null;
}
