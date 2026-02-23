/**
 * Unit tests for billing/tier logic.
 */

import { describe, it, expect } from "vitest";
import { getTierLimits, isOverEntryLimit } from "../../src/billing/stripe.js";

describe("tier limits", () => {
  it("returns free tier limits by default", () => {
    const limits = getTierLimits("free");
    expect(limits.maxEntries).toBe(Infinity);
    expect(limits.storageMb).toBe(50);
    expect(limits.requestsPerDay).toBe(200);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(false);
  });

  it("returns pro tier limits", () => {
    const limits = getTierLimits("pro");
    expect(limits.maxEntries).toBe(Infinity);
    expect(limits.storageMb).toBe(5120);
    expect(limits.requestsPerDay).toBe(Infinity);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(true);
  });

  it("returns team tier limits", () => {
    const limits = getTierLimits("team");
    expect(limits.maxEntries).toBe(Infinity);
    expect(limits.storageMb).toBe(20480);
    expect(limits.requestsPerDay).toBe(Infinity);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(true);
  });

  it("defaults to free for unknown tiers", () => {
    const limits = getTierLimits("unknown");
    expect(limits.maxEntries).toBe(Infinity);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(false);
  });

  it("all tiers have all required fields", () => {
    for (const tier of ["free", "pro", "team"]) {
      const limits = getTierLimits(tier);
      expect(limits).toHaveProperty("maxEntries");
      expect(limits).toHaveProperty("storageMb");
      expect(limits).toHaveProperty("requestsPerDay");
      expect(limits).toHaveProperty("apiKeys");
      expect(limits).toHaveProperty("exportEnabled");
    }
  });
});

describe("entry limit enforcement", () => {
  it("free tier is never over entry limit (storage is the gate)", () => {
    expect(isOverEntryLimit("free", 0)).toBe(false);
    expect(isOverEntryLimit("free", 500)).toBe(false);
    expect(isOverEntryLimit("free", 100000)).toBe(false);
  });

  it("pro tier is never over limit", () => {
    expect(isOverEntryLimit("pro", 0)).toBe(false);
    expect(isOverEntryLimit("pro", 100000)).toBe(false);
  });

  it("team tier is never over limit", () => {
    expect(isOverEntryLimit("team", 0)).toBe(false);
    expect(isOverEntryLimit("team", 100000)).toBe(false);
  });

  it("unknown tier falls back to free (unlimited entries)", () => {
    expect(isOverEntryLimit("nonexistent", 500)).toBe(false);
    expect(isOverEntryLimit("nonexistent", 100000)).toBe(false);
  });
});
