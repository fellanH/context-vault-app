/**
 * privacy-scan.js -- Scan text for sensitive content before team vault publishing.
 *
 * Detects: email addresses, API keys/tokens, Bearer tokens, private IPs,
 * file paths with usernames, password/secret assignments.
 *
 * Returns { clean, matches[] } where matches contain redacted values.
 */

const PATTERNS = [
  {
    type: "email",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    type: "api_key",
    regex: /sk-[a-zA-Z0-9_-]{20,}/g,
  },
  {
    type: "api_key",
    regex: /cv_[a-zA-Z0-9]{20,}/g,
  },
  {
    type: "api_key",
    regex: /ghp_[a-zA-Z0-9]{36}/g,
  },
  {
    type: "api_key",
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    type: "bearer_token",
    regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
  },
  {
    type: "private_ip",
    regex: /192\.168\.\d+\.\d+/g,
  },
  {
    type: "private_ip",
    regex: /10\.\d+\.\d+\.\d+/g,
  },
  {
    type: "private_ip",
    regex: /172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+/g,
  },
  {
    type: "internal_host",
    regex: /localhost:\d+/g,
  },
  {
    type: "internal_host",
    regex: /\S+\.internal\.\S+/g,
  },
  {
    type: "internal_host",
    regex: /\S+\.local\.\S+/g,
  },
  {
    type: "file_path",
    regex: /\/Users\/[a-zA-Z0-9]+\//g,
  },
  {
    type: "file_path",
    regex: /\/home\/[a-zA-Z0-9]+\//g,
  },
  {
    type: "file_path",
    regex: /C:\\Users\\[a-zA-Z0-9]+/g,
  },
  {
    type: "password",
    regex: /password\s*[:=]\s*\S+/gi,
  },
  {
    type: "password",
    regex: /secret\s*[:=]\s*\S+/gi,
  },
];

/**
 * Redact a matched value: show first 3 + last 3 chars with *** in the middle.
 * Short values (<=6 chars) get fully redacted.
 */
export function redact(value) {
  if (value.length <= 6) return "***";
  return value.slice(0, 3) + "***" + value.slice(-3);
}

/**
 * Scan text for sensitive content.
 *
 * @param {string} text - Text to scan
 * @param {string} [field] - Field name for match reporting (e.g. "title", "body", "meta")
 * @returns {{ clean: boolean, matches: Array<{ type: string, value: string, field: string, line: number }> }}
 */
export function scanForSensitiveContent(text, field = "unknown") {
  if (!text || typeof text !== "string") return { clean: true, matches: [] };

  const lines = text.split("\n");
  const matches = [];

  for (const pattern of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      // Reset lastIndex for global regexes
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(lines[i])) !== null) {
        matches.push({
          type: pattern.type,
          value: redact(match[0]),
          field,
          line: i + 1,
        });
      }
    }
  }

  return { clean: matches.length === 0, matches };
}

/**
 * Scan multiple fields of an entry for sensitive content.
 *
 * @param {{ title?: string, body?: string, meta?: object }} entry
 * @returns {{ clean: boolean, matches: Array<{ type: string, value: string, field: string, line: number }> }}
 */
export function scanEntry(entry) {
  const allMatches = [];

  if (entry.title) {
    const { matches } = scanForSensitiveContent(entry.title, "title");
    allMatches.push(...matches);
  }

  if (entry.body) {
    const { matches } = scanForSensitiveContent(entry.body, "body");
    allMatches.push(...matches);
  }

  if (entry.meta) {
    const metaStr =
      typeof entry.meta === "string" ? entry.meta : JSON.stringify(entry.meta);
    const { matches } = scanForSensitiveContent(metaStr, "meta");
    allMatches.push(...matches);
  }

  return { clean: allMatches.length === 0, matches: allMatches };
}
