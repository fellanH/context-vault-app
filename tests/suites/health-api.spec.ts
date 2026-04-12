import { test, expect } from "@playwright/test";

const API_URL = process.env.API_URL || "https://api.context-vault.com";

test.describe("health-api: health endpoint", () => {
  test("GET /health returns 200 with status ok", async () => {
    const res = await fetch(`${API_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("GET /health responds within 2000ms", async () => {
    const start = Date.now();
    const res = await fetch(`${API_URL}/health`);
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

  test("GET /health returns JSON content-type", async () => {
    const res = await fetch(`${API_URL}/health`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

test.describe("health-api: auth endpoints exist", () => {
  test("POST /api/auth/sign-in exists (not 404)", async () => {
    const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@test.com", password: "x" }),
    });
    // Should return some auth response, not 404
    expect(res.status).not.toBe(404);
  });

  test("POST /api/auth/sign-up exists (not 404)", async () => {
    const res = await fetch(`${API_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "pentest-no-create@example.com",
        password: "testpass123!",
        name: "Pentest",
      }),
    });
    // We don't expect success, just not a 404
    expect(res.status).not.toBe(404);
  });
});

test.describe("health-api: 404 handling", () => {
  test("unknown route returns 404 as JSON", async () => {
    const res = await fetch(`${API_URL}/api/this-route-does-not-exist`);
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") || "";
    // Should be JSON, not HTML
    expect(ct).toContain("application/json");
  });

  test("unknown route body is not HTML", async () => {
    const res = await fetch(`${API_URL}/api/this-route-does-not-exist`);
    const text = await res.text();
    expect(text).not.toMatch(/^<!DOCTYPE/i);
    expect(text).not.toMatch(/^<html/i);
  });
});

test.describe("health-api: method enforcement", () => {
  test("PUT on /health returns 404 or 405", async () => {
    const res = await fetch(`${API_URL}/health`, { method: "PUT" });
    expect([404, 405]).toContain(res.status);
  });

  test("DELETE on /health returns 404 or 405", async () => {
    const res = await fetch(`${API_URL}/health`, { method: "DELETE" });
    expect([404, 405]).toContain(res.status);
  });

  test("PATCH on /api/vault/entries returns 401 or 404 or 405", async () => {
    const res = await fetch(`${API_URL}/api/vault/entries`, {
      method: "PATCH",
    });
    // Either auth blocks first (401) or method not allowed (405) or not found (404)
    expect([401, 404, 405]).toContain(res.status);
  });
});

test.describe("health-api: response time", () => {
  const endpoints = [
    { method: "GET", path: "/health" },
    { method: "GET", path: "/api/vault/entries" },
  ];

  for (const ep of endpoints) {
    test(`${ep.method} ${ep.path} responds within 2000ms`, async () => {
      const start = Date.now();
      await fetch(`${API_URL}${ep.path}`, { method: ep.method });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
    });
  }
});
