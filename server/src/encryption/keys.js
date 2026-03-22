/**
 * keys.js — Key derivation and DEK (Data Encryption Key) management.
 *
 * Uses the Web Crypto API (PBKDF2 + AES-GCM) — compatible with Cloudflare Workers.
 *
 * Architecture:
 *   master secret → PBKDF2 → master_key → AES-GCM encrypts DEK
 *   DEK stored encrypted in Turso (encrypted_dek + dek_salt columns as base64)
 *
 * Workers are stateless — no in-memory DEK cache. Every request derives the DEK
 * from the encrypted blob. PBKDF2 with 100k iterations is fast enough per request
 * (~1-5ms on Workers hardware).
 *
 * All functions are async.
 * Raw bytes are Uint8Array; encode to base64 for Turso storage.
 */

import { encrypt, decrypt, importAesKey, toBase64, fromBase64 } from "./crypto.js";

const KEY_LENGTH_BYTES = 32; // 256 bits for AES-256
const IV_LENGTH_BYTES = 12; // GCM standard nonce size
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH_BYTES = 16;

// ─── PBKDF2 key derivation ────────────────────────────────────────────────────

/**
 * Derive a 256-bit AES-GCM CryptoKey from a password/secret and salt using PBKDF2.
 *
 * @param {string} secret - Password or master secret
 * @param {Uint8Array} salt - 16-byte random salt
 * @returns {Promise<CryptoKey>} - AES-256-GCM CryptoKey (non-extractable)
 */
export async function deriveKey(secret, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH_BYTES * 8, // bits
  );

  return importAesKey(new Uint8Array(bits));
}

// ─── DEK generation and encryption ───────────────────────────────────────────

/**
 * Generate a new random DEK and encrypt it with the master key.
 *
 * @param {string} masterSecret - Server master secret (from env)
 * @returns {Promise<{ encryptedDek: string, dekSalt: string, dekRaw: Uint8Array }>}
 *   encryptedDek and dekSalt are base64-encoded for Turso storage.
 *   dekRaw is the raw DEK bytes for immediate use (not stored).
 */
export async function generateDek(masterSecret) {
  const dekRaw = crypto.getRandomValues(new Uint8Array(KEY_LENGTH_BYTES));
  const dekSaltBytes = crypto.getRandomValues(
    new Uint8Array(SALT_LENGTH_BYTES),
  );
  const masterKey = await deriveKey(masterSecret, dekSaltBytes);

  // Encrypt the DEK hex string so we can recover raw bytes on decryption
  const { encrypted, iv } = await encrypt(toBase64(dekRaw), masterKey);

  // Store: [12-byte IV | ciphertext+tag] as base64
  const encryptedDekBytes = new Uint8Array(IV_LENGTH_BYTES + encrypted.byteLength);
  encryptedDekBytes.set(iv, 0);
  encryptedDekBytes.set(encrypted, IV_LENGTH_BYTES);

  return {
    encryptedDek: toBase64(encryptedDekBytes),
    dekSalt: toBase64(dekSaltBytes),
    dekRaw,
  };
}

/**
 * Decrypt a stored DEK using the master key.
 *
 * @param {string} encryptedDekB64 - Base64 of [IV (12 bytes) | ciphertext+tag]
 * @param {string} dekSaltB64 - Base64 of the 16-byte PBKDF2 salt
 * @param {string} masterSecret - Server master secret
 * @returns {Promise<Uint8Array>} - 32-byte raw DEK
 */
export async function decryptDek(encryptedDekB64, dekSaltB64, masterSecret) {
  const encryptedDekBytes = fromBase64(encryptedDekB64);
  const dekSaltBytes = fromBase64(dekSaltB64);

  const iv = encryptedDekBytes.subarray(0, IV_LENGTH_BYTES);
  const encrypted = encryptedDekBytes.subarray(IV_LENGTH_BYTES);

  const masterKey = await deriveKey(masterSecret, dekSaltBytes);
  const dekB64 = await decrypt(encrypted, iv, masterKey);
  return fromBase64(dekB64);
}

/**
 * Get the AES-256-GCM CryptoKey for a user by decrypting their stored DEK.
 * No caching — Workers are stateless; derive on each request.
 *
 * @param {string} encryptedDekB64 - From Turso
 * @param {string} dekSaltB64 - From Turso
 * @param {string} masterSecret - From environment
 * @returns {Promise<CryptoKey>}
 */
export async function getUserDek(encryptedDekB64, dekSaltB64, masterSecret) {
  const dekRaw = await decryptDek(encryptedDekB64, dekSaltB64, masterSecret);
  return importAesKey(dekRaw);
}

// ─── Split-Authority Key Management ──────────────────────────────────────────

/**
 * Generate a new DEK encrypted with split-authority (requires both server + client secrets).
 *
 * The client key share is returned once at registration and must be saved by the user.
 * Neither the server alone nor the client alone can decrypt — both are required.
 *
 * KEK = PBKDF2(masterSecret + clientKeyShare, salt)
 *
 * @param {string} masterSecret - Server master secret (from env)
 * @returns {Promise<{
 *   encryptedDek: string,
 *   dekSalt: string,
 *   dekRaw: Uint8Array,
 *   clientKeyShare: string
 * }>}
 */
export async function generateDekSplitAuthority(masterSecret) {
  const clientKeyShareBytes = crypto.getRandomValues(new Uint8Array(32));
  const clientKeyShare = `cvs_${toBase64(clientKeyShareBytes).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c])}`;

  const combinedSecret = masterSecret + clientKeyShare;
  const dekRaw = crypto.getRandomValues(new Uint8Array(KEY_LENGTH_BYTES));
  const dekSaltBytes = crypto.getRandomValues(
    new Uint8Array(SALT_LENGTH_BYTES),
  );
  const masterKey = await deriveKey(combinedSecret, dekSaltBytes);

  const { encrypted, iv } = await encrypt(toBase64(dekRaw), masterKey);
  const encryptedDekBytes = new Uint8Array(IV_LENGTH_BYTES + encrypted.byteLength);
  encryptedDekBytes.set(iv, 0);
  encryptedDekBytes.set(encrypted, IV_LENGTH_BYTES);

  return {
    encryptedDek: toBase64(encryptedDekBytes),
    dekSalt: toBase64(dekSaltBytes),
    dekRaw,
    clientKeyShare,
  };
}

/**
 * Decrypt a stored DEK using split-authority (both server + client secrets).
 *
 * @param {string} encryptedDekB64 - Base64 of [IV | ciphertext+tag]
 * @param {string} dekSaltB64 - Base64 of PBKDF2 salt
 * @param {string} masterSecret - Server master secret
 * @param {string} clientKeyShare - User's encryption secret (cvs_...)
 * @returns {Promise<Uint8Array>} - 32-byte raw DEK
 */
export async function decryptDekSplitAuthority(
  encryptedDekB64,
  dekSaltB64,
  masterSecret,
  clientKeyShare,
) {
  const combinedSecret = masterSecret + clientKeyShare;
  return decryptDek(encryptedDekB64, dekSaltB64, combinedSecret);
}

/**
 * Get the AES-256-GCM CryptoKey for a user.
 * Automatically handles legacy vs split-authority modes.
 * No caching — Workers are stateless; derive on each request.
 *
 * @param {string} encryptedDekB64 - From Turso
 * @param {string} dekSaltB64 - From Turso
 * @param {string} masterSecret - From environment
 * @param {string|null} clientKeyShare - User's encryption secret (null for legacy)
 * @param {"legacy"|"split-authority"} encryptionMode
 * @returns {Promise<CryptoKey>}
 */
export async function getUserDekAuto(
  encryptedDekB64,
  dekSaltB64,
  masterSecret,
  clientKeyShare,
  encryptionMode,
) {
  let dekRaw;
  if (encryptionMode === "split-authority") {
    if (!clientKeyShare) {
      throw new Error(
        "Split-authority encryption requires X-Vault-Secret header. Include your encryption secret.",
      );
    }
    dekRaw = await decryptDekSplitAuthority(
      encryptedDekB64,
      dekSaltB64,
      masterSecret,
      clientKeyShare,
    );
  } else {
    dekRaw = await decryptDek(encryptedDekB64, dekSaltB64, masterSecret);
  }

  return importAesKey(dekRaw);
}
