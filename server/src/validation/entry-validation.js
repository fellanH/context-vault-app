/**
 * entry-validation.js — Shared validation helpers for vault entries.
 *
 * Used by both the management routes (import) and the REST API routes.
 * Validation constants are canonical in @context-vault/core/constants.
 */

import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_KIND_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_COUNT,
  MAX_META_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_IDENTITY_KEY_LENGTH,
} from "@context-vault/core/constants";

export {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_KIND_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_COUNT,
  MAX_META_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_IDENTITY_KEY_LENGTH,
};

export const KIND_PATTERN = /^[a-z0-9-]+$/;

/**
 * Validate entry input fields. Returns { error, status } on failure, null on success.
 *
 * @param {object} data — Request body with kind, body, title, tags, meta, source, identity_key
 * @param {{ requireKind?: boolean, requireBody?: boolean }} opts
 * @returns {{ error: string, status: number } | null}
 */
export function validateEntryInput(
  data,
  { requireKind = true, requireBody = true } = {},
) {
  if (requireKind) {
    if (!data.kind) return { error: "kind is required", status: 400 };
  }
  if (data.kind !== undefined) {
    if (
      typeof data.kind !== "string" ||
      data.kind.length > MAX_KIND_LENGTH ||
      !KIND_PATTERN.test(data.kind)
    ) {
      return {
        error: `kind must be lowercase alphanumeric/hyphens, max ${MAX_KIND_LENGTH} chars`,
        status: 400,
      };
    }
  }

  if (requireBody) {
    if (!data.body) return { error: "body is required", status: 400 };
  }
  if (data.body !== undefined && data.body !== null) {
    if (typeof data.body !== "string" || data.body.length > MAX_BODY_LENGTH) {
      return {
        error: `body must be a string, max ${MAX_BODY_LENGTH / 1024}KB`,
        status: 400,
      };
    }
  }

  if (data.title !== undefined && data.title !== null) {
    if (
      typeof data.title !== "string" ||
      data.title.length > MAX_TITLE_LENGTH
    ) {
      return {
        error: `title must be a string, max ${MAX_TITLE_LENGTH} chars`,
        status: 400,
      };
    }
  }

  if (data.tags !== undefined && data.tags !== null) {
    if (!Array.isArray(data.tags)) {
      return { error: "tags must be an array of strings", status: 400 };
    }
    if (data.tags.length > MAX_TAGS_COUNT) {
      return { error: `tags: max ${MAX_TAGS_COUNT} tags allowed`, status: 400 };
    }
    for (const tag of data.tags) {
      if (typeof tag !== "string" || tag.length > MAX_TAG_LENGTH) {
        return {
          error: `each tag must be a string, max ${MAX_TAG_LENGTH} chars`,
          status: 400,
        };
      }
    }
  }

  if (data.meta !== undefined && data.meta !== null) {
    const metaStr = JSON.stringify(data.meta);
    if (metaStr.length > MAX_META_LENGTH) {
      return {
        error: `meta must be under ${MAX_META_LENGTH / 1024}KB when serialized`,
        status: 400,
      };
    }
  }

  if (data.source !== undefined && data.source !== null) {
    if (
      typeof data.source !== "string" ||
      data.source.length > MAX_SOURCE_LENGTH
    ) {
      return {
        error: `source must be a string, max ${MAX_SOURCE_LENGTH} chars`,
        status: 400,
      };
    }
  }

  if (data.identity_key !== undefined && data.identity_key !== null) {
    if (
      typeof data.identity_key !== "string" ||
      data.identity_key.length > MAX_IDENTITY_KEY_LENGTH
    ) {
      return {
        error: `identity_key must be a string, max ${MAX_IDENTITY_KEY_LENGTH} chars`,
        status: 400,
      };
    }
  }

  return null;
}
