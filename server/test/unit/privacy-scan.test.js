/**
 * Unit tests for privacy-scan module.
 */

import { describe, it, expect } from "vitest";
import {
  scanForSensitiveContent,
  scanEntry,
  redact,
} from "../../src/validation/privacy-scan.js";

describe("redact", () => {
  it("redacts long strings showing first 3 and last 3 chars", () => {
    expect(redact("felix@klarhimmel.se")).toBe("fel***.se");
    expect(redact("sk-proj-abc123def456ghi789")).toBe("sk-***789");
  });

  it("fully redacts short strings", () => {
    expect(redact("abc")).toBe("***");
    expect(redact("abcdef")).toBe("***");
  });
});

describe("scanForSensitiveContent", () => {
  it("returns clean for normal text", () => {
    const result = scanForSensitiveContent(
      "This is a normal vault entry about API design patterns.",
      "body",
    );
    expect(result.clean).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  it("returns clean for null/empty input", () => {
    expect(scanForSensitiveContent(null).clean).toBe(true);
    expect(scanForSensitiveContent("").clean).toBe(true);
    expect(scanForSensitiveContent(undefined).clean).toBe(true);
  });

  it("detects email addresses", () => {
    const result = scanForSensitiveContent(
      "Contact felix@klarhimmel.se for details",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe("email");
    expect(result.matches[0].field).toBe("body");
    expect(result.matches[0].line).toBe(1);
    // Value should be redacted
    expect(result.matches[0].value).not.toContain("klarhimmel");
  });

  it("detects API keys (sk- prefix)", () => {
    const result = scanForSensitiveContent(
      "Used key sk-proj-abc123def456ghi789jkl012mno012mno345",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "api_key")).toBe(true);
  });

  it("detects API keys (cv_ prefix)", () => {
    const result = scanForSensitiveContent(
      "Token cv_abcdefghij1234567890klmnop",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "api_key")).toBe(true);
  });

  it("detects GitHub PATs (ghp_ prefix)", () => {
    const result = scanForSensitiveContent(
      "ghp_ABCDEFghijklmnopqrstuvwxyz0123456789",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "api_key")).toBe(true);
  });

  it("detects AWS access key IDs", () => {
    const result = scanForSensitiveContent(
      "AWS key: AKIAIOSFODNN7EXAMPLE",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "api_key")).toBe(true);
  });

  it("detects Bearer tokens", () => {
    const result = scanForSensitiveContent(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123def456",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "bearer_token")).toBe(true);
  });

  it("detects private IPs (192.168.x.x)", () => {
    const result = scanForSensitiveContent(
      "Connect to 192.168.1.100 on port 3000",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "private_ip")).toBe(true);
  });

  it("detects private IPs (10.x.x.x)", () => {
    const result = scanForSensitiveContent(
      "Internal service at 10.0.0.42",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "private_ip")).toBe(true);
  });

  it("detects localhost references", () => {
    const result = scanForSensitiveContent(
      "Running on localhost:3000",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "internal_host")).toBe(true);
  });

  it("detects internal hostnames", () => {
    const result = scanForSensitiveContent(
      "API at service.internal.company.com",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "internal_host")).toBe(true);
  });

  it("detects file paths with /Users/", () => {
    const result = scanForSensitiveContent(
      "File at /Users/felix/projects/vault",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "file_path")).toBe(true);
  });

  it("detects file paths with /home/", () => {
    const result = scanForSensitiveContent(
      "Config at /home/kevin/.config/app",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "file_path")).toBe(true);
  });

  it("detects Windows file paths", () => {
    const result = scanForSensitiveContent(
      "Path: C:\\Users\\felix\\Documents",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "file_path")).toBe(true);
  });

  it("detects password assignments", () => {
    const result = scanForSensitiveContent(
      "password: hunter2",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "password")).toBe(true);
  });

  it("detects secret assignments", () => {
    const result = scanForSensitiveContent(
      "secret=abc123secretvalue",
      "body",
    );
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "password")).toBe(true);
  });

  it("reports correct line numbers", () => {
    const text = "Line one is fine\nLine two has felix@test.com\nLine three also fine";
    const result = scanForSensitiveContent(text, "body");
    expect(result.matches[0].line).toBe(2);
  });

  it("detects multiple matches in one text", () => {
    const text =
      "Email: user@test.com\nKey: sk-proj-abc123def456ghi789jkl012mno\nIP: 192.168.1.1";
    const result = scanForSensitiveContent(text, "body");
    expect(result.clean).toBe(false);
    expect(result.matches.length).toBeGreaterThanOrEqual(3);
  });
});

describe("scanEntry", () => {
  it("scans title, body, and meta separately", () => {
    const result = scanEntry({
      title: "Setup for felix@klarhimmel.se",
      body: "Clean body text with no issues",
      meta: { note: "key: sk-proj-abc123def456ghi789jkl012mno" },
    });
    expect(result.clean).toBe(false);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);

    const titleMatch = result.matches.find((m) => m.field === "title");
    const metaMatch = result.matches.find((m) => m.field === "meta");
    expect(titleMatch).toBeDefined();
    expect(metaMatch).toBeDefined();
  });

  it("returns clean for entries with no sensitive content", () => {
    const result = scanEntry({
      title: "API Design Patterns",
      body: "Use REST endpoints with proper versioning",
      meta: { status: "published" },
    });
    expect(result.clean).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  it("handles entries with missing fields", () => {
    const result = scanEntry({});
    expect(result.clean).toBe(true);
  });

  it("handles meta as a string", () => {
    const result = scanEntry({
      title: "Test",
      body: "Body",
      meta: '{"key": "sk-proj-abc123def456ghi789jkl012mno"}',
    });
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.field === "meta")).toBe(true);
  });
});
