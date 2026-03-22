/**
 * vault-crypto.js — Bridge between vault entry format and encrypted Turso storage.
 *
 * Connects the entry-level data flow with the low-level crypto primitives
 * (crypto.js) and key management (keys.js).
 *
 * Supports two encryption modes:
 *   - legacy: server-only master secret (existing users)
 *   - split-authority: server + client secret required (new users)
 *
 * The DEK data (encrypted_dek, dek_salt, encryption_mode) is passed in from
 * the caller, which queries Turso directly. No internal DB dependency here.
 *
 * All functions are async (crypto operations are async in Workers).
 */

import { encryptEntry, decryptEntry, fromBase64 } from "./crypto.js";
import { getUserDekAuto } from "./keys.js";

/**
 * @typedef {object} DekData
 * @property {string} encrypted_dek   - Base64 of [IV | ciphertext+tag]
 * @property {string} dek_salt        - Base64 of PBKDF2 salt
 * @property {string} [encryption_mode] - "legacy" | "split-authority"
 */

/**
 * Encrypt an entry's sensitive fields for database storage.
 *
 * @param {{ title?: string, body: string, meta?: object }} entry
 * @param {DekData} dekData - From Turso users/dek table
 * @param {string} masterSecret - From c.env.VAULT_MASTER_SECRET
 * @param {string|null} [clientKeyShare] - User's encryption secret (for split-authority)
 * @returns {Promise<{
 *   body_encrypted: string,
 *   title_encrypted: string|null,
 *   meta_encrypted: string|null,
 *   iv: string
 * }>} All byte fields are base64-encoded for Turso TEXT columns
 */
export async function encryptForStorage(
  entry,
  dekData,
  masterSecret,
  clientKeyShare,
) {
  const key = await getDekKey(dekData, masterSecret, clientKeyShare);
  const result = await encryptEntry(entry, key);

  // Encode Uint8Array fields to base64 for Turso storage
  return {
    body_encrypted: uint8ToB64(result.body_encrypted),
    title_encrypted: result.title_encrypted
      ? uint8ToB64(result.title_encrypted)
      : null,
    meta_encrypted: result.meta_encrypted
      ? uint8ToB64(result.meta_encrypted)
      : null,
    iv: uint8ToB64(result.iv),
  };
}

/**
 * Decrypt encrypted fields from a Turso row.
 * Returns plaintext fields. If the row is not encrypted, returns plaintext as-is.
 *
 * @param {{
 *   body_encrypted?: string|null,
 *   title_encrypted?: string|null,
 *   meta_encrypted?: string|null,
 *   iv?: string|null,
 *   body: string,
 *   title?: string,
 *   meta?: string
 * }} row - Row from Turso with base64-encoded byte fields
 * @param {DekData} dekData - From Turso users/dek table
 * @param {string} masterSecret - From c.env.VAULT_MASTER_SECRET
 * @param {string|null} [clientKeyShare] - User's encryption secret (for split-authority)
 * @returns {Promise<{ body: string, title: string|null, meta: object|null }>}
 */
export async function decryptFromStorage(
  row,
  dekData,
  masterSecret,
  clientKeyShare,
) {
  if (!row.body_encrypted) {
    // Not encrypted — return plaintext fields
    return {
      body: row.body,
      title: row.title || null,
      meta: row.meta
        ? typeof row.meta === "string"
          ? JSON.parse(row.meta)
          : row.meta
        : null,
    };
  }

  const key = await getDekKey(dekData, masterSecret, clientKeyShare);

  // Decode base64 fields back to Uint8Array for crypto operations
  const cryptoRow = {
    body_encrypted: fromBase64(row.body_encrypted),
    title_encrypted: row.title_encrypted ? fromBase64(row.title_encrypted) : null,
    meta_encrypted: row.meta_encrypted ? fromBase64(row.meta_encrypted) : null,
    iv: fromBase64(row.iv),
  };

  return decryptEntry(cryptoRow, key);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the CryptoKey for a user given their DEK data.
 *
 * @param {DekData} dekData
 * @param {string} masterSecret
 * @param {string|null} clientKeyShare
 * @returns {Promise<CryptoKey>}
 */
async function getDekKey(dekData, masterSecret, clientKeyShare) {
  if (!dekData?.encrypted_dek || !dekData?.dek_salt) {
    throw new Error(
      "No encryption key found for user. Was the user registered with VAULT_MASTER_SECRET set?",
    );
  }

  const encryptionMode = dekData.encryption_mode || "legacy";

  return getUserDekAuto(
    dekData.encrypted_dek,
    dekData.dek_salt,
    masterSecret,
    clientKeyShare || null,
    encryptionMode,
  );
}

/** Encode Uint8Array to base64 string. */
function uint8ToB64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
