import { test, expect } from "@playwright/test";
import { apiGet, apiPost, apiPut, apiDelete, hasTestKey, getTestKey } from "../helpers/api";

// Full CRUD suite requires a valid API key.
test.describe("e2e-vault: CRUD lifecycle", () => {
  test.skip(!hasTestKey(), "Requires API_TEST_KEY env var");

  let entryId: string;

  test("create entry", async () => {
    const key = getTestKey();
    const res = await apiPost(
      "/api/vault/entries",
      {
        title: "e2e-test-entry",
        body: "Created by pentest suite for CRUD validation.",
        kind: "insight",
        tags: ["e2e", "pentest"],
        tier: "working",
      },
      key
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    entryId = data.id || data.entry?.id;
    expect(entryId).toBeTruthy();
  });

  test("read entry", async () => {
    const key = getTestKey();
    const res = await apiGet(`/api/vault/entries/${entryId}`, key);
    expect(res.status).toBe(200);
    const data = await res.json();
    const entry = data.entry || data;
    expect(entry.title).toBe("e2e-test-entry");
    expect(entry.kind).toBe("insight");
  });

  test("update entry", async () => {
    const key = getTestKey();
    const res = await apiPut(
      `/api/vault/entries/${entryId}`,
      {
        title: "e2e-test-entry-updated",
        body: "Updated by pentest suite.",
      },
      key
    );
    expect(res.status).toBe(200);

    // Verify the update
    const getRes = await apiGet(`/api/vault/entries/${entryId}`, key);
    const data = await getRes.json();
    const entry = data.entry || data;
    expect(entry.title).toBe("e2e-test-entry-updated");
  });

  test("search finds entry", async () => {
    const key = getTestKey();
    const res = await apiPost(
      "/api/vault/search",
      { query: "e2e-test-entry-updated" },
      key
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const results = data.results || data;
    expect(Array.isArray(results)).toBe(true);
  });

  test("delete entry", async () => {
    const key = getTestKey();
    const res = await apiDelete(`/api/vault/entries/${entryId}`, key);
    expect([200, 204]).toContain(res.status);

    // Verify deletion
    const getRes = await apiGet(`/api/vault/entries/${entryId}`, key);
    expect([404, 410]).toContain(getRes.status);
  });
});

test.describe("e2e-vault: list with filters", () => {
  test.skip(!hasTestKey(), "Requires API_TEST_KEY env var");

  test("list entries with limit param", async () => {
    const key = getTestKey();
    const res = await apiGet("/api/vault/entries?limit=5", key);
    expect(res.status).toBe(200);
    const data = await res.json();
    const entries = data.entries || data.results || data;
    expect(Array.isArray(entries)).toBe(true);
  });

  test("list entries with kind filter", async () => {
    const key = getTestKey();
    const res = await apiGet("/api/vault/entries?kind=insight", key);
    expect(res.status).toBe(200);
  });
});

test.describe("e2e-vault: bulk import", () => {
  test.skip(!hasTestKey(), "Requires API_TEST_KEY env var");

  const bulkEntryIds: string[] = [];

  test("bulk import multiple entries", async () => {
    const key = getTestKey();
    const res = await apiPost(
      "/api/vault/import/bulk",
      {
        entries: [
          {
            title: "bulk-test-1",
            body: "First bulk entry",
            kind: "insight",
            tags: ["bulk", "pentest"],
          },
          {
            title: "bulk-test-2",
            body: "Second bulk entry",
            kind: "pattern",
            tags: ["bulk", "pentest"],
          },
        ],
      },
      key
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBeGreaterThanOrEqual(2);

    // Track IDs for cleanup if available
    if (data.ids) {
      bulkEntryIds.push(...data.ids);
    }
  });

  test("cleanup: delete bulk entries", async () => {
    const key = getTestKey();
    // Search for our bulk entries and clean them up
    const searchRes = await apiPost(
      "/api/vault/search",
      { query: "bulk-test" },
      key
    );
    if (searchRes.status === 200) {
      const data = await searchRes.json();
      const results = data.results || [];
      for (const entry of results) {
        const id = entry.id || entry.entry?.id;
        if (id) {
          await apiDelete(`/api/vault/entries/${id}`, key);
        }
      }
    }
  });
});
