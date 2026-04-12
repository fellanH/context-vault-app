/**
 * Unit tests for billing/tier logic.
 */

import { describe, it, expect } from "vitest";
import { getTierLimits, isOverEntryLimit } from "../../src/billing/stripe.js";

describe("tier limits", () => {
  it("returns free tier limits by default", () => {
    const limits = getTierLimits("free");
    expect(limits.maxEntries).toBe(10000);
    expect(limits.storageMb).toBe(1024);
    expect(limits.requestsPerDay).toBe(5000);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(true);
  });

  it("returns pro tier limits", () => {
    const limits = getTierLimits("pro");
    expect(limits.maxEntries).toBe(50000);
    expect(limits.storageMb).toBe(10240);
    expect(limits.requestsPerDay).toBe(Infinity);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(true);
  });

  it("returns team tier limits", () => {
    const limits = getTierLimits("team");
    expect(limits.maxEntries).toBe(200000);
    expect(limits.storageMb).toBe(51200);
    expect(limits.requestsPerDay).toBe(Infinity);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(true);
  });

  it("defaults to free for unknown tiers", () => {
    const limits = getTierLimits("unknown");
    expect(limits.maxEntries).toBe(10000);
    expect(limits.apiKeys).toBe(Infinity);
    expect(limits.exportEnabled).toBe(true);
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
  it("free tier is over entry limit at maxEntries", () => {
    expect(isOverEntryLimit("free", 0)).toBe(false);
    expect(isOverEntryLimit("free", 500)).toBe(false);
    expect(isOverEntryLimit("free", 9999)).toBe(false);
    expect(isOverEntryLimit("free", 10000)).toBe(true);
  });

  it("pro tier is over limit at maxEntries", () => {
    expect(isOverEntryLimit("pro", 0)).toBe(false);
    expect(isOverEntryLimit("pro", 49999)).toBe(false);
    expect(isOverEntryLimit("pro", 50000)).toBe(true);
  });

  it("team tier is never over limit", () => {
    expect(isOverEntryLimit("team", 0)).toBe(false);
    expect(isOverEntryLimit("team", 100000)).toBe(false);
  });

  it("unknown tier falls back to free limits", () => {
    expect(isOverEntryLimit("nonexistent", 500)).toBe(false);
    expect(isOverEntryLimit("nonexistent", 9999)).toBe(false);
    expect(isOverEntryLimit("nonexistent", 10000)).toBe(true);
  });
});
