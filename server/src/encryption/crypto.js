/**
 * crypto.js — AES-256-GCM encryption for vault entry bodies.
 *
 * Uses the Web Crypto API (crypto.subtle) — compatible with Cloudflare Workers.
 *
 * Design:
 *   - AES-256-GCM provides authenticated encryption
 *   - Each entry gets a unique 12-byte IV (nonce)
 *   - Web Crypto AES-GCM appends the 16-byte auth tag to the ciphertext
 *     automatically, so there is no separate getAuthTag() step
 *
 * What's encrypted:
 *   - body (always)
 *   - title (encrypted copy — plaintext kept for FTS)
 *   - meta (if present)
 *
 * What stays plaintext:
 *   - kind, category, tags, source, timestamps, identity_key (structural metadata)
 *   - title (for FTS — pragmatic trade-off)
 *   - embeddings (not reversible — semantic search still works)
 *
 * All functions are async.
 * Keys are CryptoKey objects imported via importAesKey().
 * Raw bytes are Uint8Array throughout; callers store as base64 in Turso.
 */

const IV_LENGTH = 12; // GCM standard nonce size (bytes)

// ─── Key import helper ────────────────────────────────────────────────────────

/**
 * Import a raw 32-byte key as a CryptoKey for AES-256-GCM.
 *
 * @param {Uint8Array} rawKey - 32-byte key material
 * @returns {Promise<CryptoKey>}
 */
export async function importAesKey(rawKey) {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// ─── Low-level encrypt / decrypt ─────────────────────────────────────────────

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param {string} plaintext - Text to encrypt
 * @param {CryptoKey} key - AES-256-GCM CryptoKey
 * @returns {Promise<{ encrypted: Uint8Array, iv: Uint8Array }>}
 *   encrypted = ciphertext + 16-byte auth tag (Web Crypto appends it automatically)
 */
export async function encrypt(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    encoded,
  );
  return { encrypted: new Uint8Array(cipherBuffer), iv };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 *
 * @param {Uint8Array} encrypted - Ciphertext with auth tag appended
 * @param {Uint8Array} iv - 12-byte IV used during encryption
 * @param {CryptoKey} key - AES-256-GCM CryptoKey
 * @returns {Promise<string>} - Decrypted plaintext
 */
export async function decrypt(encrypted, iv, key) {
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    encrypted,
  );
  return new TextDecoder().decode(plainBuffer);
}

// ─── Entry-level encrypt / decrypt ───────────────────────────────────────────

/**
 * Encrypt a vault entry's sensitive fields.
 * Returns new fields to merge with the entry row.
 * All byte fields are Uint8Array; store as base64 in Turso.
 *
 * @param {{ title?: string, body: string, meta?: object }} entry
 * @param {CryptoKey} key - AES-256-GCM CryptoKey (from importAesKey)
 * @returns {Promise<{
 *   body_encrypted: Uint8Array,
 *   title_encrypted: Uint8Array|null,
 *   meta_encrypted: Uint8Array|null,
 *   iv: Uint8Array
 * }>}
 */
export async function encryptEntry(entry, key) {
  // Body
  const bodyIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const bodyEncBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bodyIv, tagLength: 128 },
    key,
    new TextEncoder().encode(entry.body),
  );
  const bodyEncrypted = new Uint8Array(bodyEncBuf);

  // Title (IV prepended so it can be decrypted independently)
  let titleEncrypted = null;
  if (entry.title) {
    const titleIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const titleEncBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: titleIv, tagLength: 128 },
      key,
      new TextEncoder().encode(entry.title),
    );
    // Prepend IV: [12 bytes IV | ciphertext+tag]
    const combined = new Uint8Array(IV_LENGTH + titleEncBuf.byteLength);
    combined.set(titleIv, 0);
    combined.set(new Uint8Array(titleEncBuf), IV_LENGTH);
    titleEncrypted = combined;
  }

  // Meta (IV prepended)
  let metaEncrypted = null;
  if (entry.meta && Object.keys(entry.meta).length > 0) {
    const metaStr = JSON.stringify(entry.meta);
    const metaIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const metaEncBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: metaIv, tagLength: 128 },
      key,
      new TextEncoder().encode(metaStr),
    );
    const combined = new Uint8Array(IV_LENGTH + metaEncBuf.byteLength);
    combined.set(metaIv, 0);
    combined.set(new Uint8Array(metaEncBuf), IV_LENGTH);
    metaEncrypted = combined;
  }

  return {
    body_encrypted: bodyEncrypted,
    title_encrypted: titleEncrypted,
    meta_encrypted: metaEncrypted,
    iv: bodyIv,
  };
}

/**
 * Decrypt a vault entry's sensitive fields.
 *
 * @param {{
 *   body_encrypted: Uint8Array,
 *   title_encrypted: Uint8Array|null,
 *   meta_encrypted: Uint8Array|null,
 *   iv: Uint8Array
 * }} row
 * @param {CryptoKey} key - AES-256-GCM CryptoKey
 * @returns {Promise<{ body: string, title: string|null, meta: object|null }>}
 */
export async function decryptEntry(row, key) {
  // Decrypt body
  const body = await decrypt(row.body_encrypted, row.iv, key);

  // Decrypt title (IV prepended)
  let title = null;
  if (row.title_encrypted) {
    const titleIv = row.title_encrypted.subarray(0, IV_LENGTH);
    const titleData = row.title_encrypted.subarray(IV_LENGTH);
    title = await decrypt(titleData, titleIv, key);
  }

  // Decrypt meta (IV prepended)
  let meta = null;
  if (row.meta_encrypted) {
    const metaIv = row.meta_encrypted.subarray(0, IV_LENGTH);
    const metaData = row.meta_encrypted.subarray(IV_LENGTH);
    meta = JSON.parse(await decrypt(metaData, metaIv, key));
  }

  return { body, title, meta };
}

// ─── Base64 helpers for Turso storage ────────────────────────────────────────

/** Encode Uint8Array to base64 string for Turso TEXT column storage. */
export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode base64 string from Turso back to Uint8Array. */
export function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
