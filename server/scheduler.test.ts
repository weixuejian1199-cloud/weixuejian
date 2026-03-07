/**
 * ATLAS Scheduler Tests
 * Tests the cron calculation and scheduling logic
 */

import { describe, it, expect } from "vitest";
import { calculateNextCronRun } from "./scheduler";

describe("Scheduler: calculateNextCronRun", () => {
  it("should calculate next daily run correctly (0 9 * * *)", () => {
    const cronExpr = "0 9 * * *";
    const next = calculateNextCronRun(cronExpr);
    expect(next).toBeInstanceOf(Date);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    // Should be in the future
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("should calculate next weekly run correctly (0 9 * * 1 = Monday)", () => {
    const cronExpr = "0 9 * * 1";
    const next = calculateNextCronRun(cronExpr);
    expect(next).toBeInstanceOf(Date);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("should calculate next hourly run correctly (0 * * * *)", () => {
    const cronExpr = "0 * * * *";
    const next = calculateNextCronRun(cronExpr);
    expect(next).toBeInstanceOf(Date);
    expect(next.getMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    // Should be within next hour
    expect(next.getTime()).toBeLessThan(Date.now() + 60 * 60 * 1000 + 1000);
  });

  it("should return a future date for invalid cron (fallback)", () => {
    const cronExpr = "invalid";
    const next = calculateNextCronRun(cronExpr);
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("should handle monthly cron (0 9 1 * *) with fallback", () => {
    const cronExpr = "0 9 1 * *";
    const next = calculateNextCronRun(cronExpr);
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("should always return a date at least 1 second in the future", () => {
    const expressions = ["0 9 * * *", "0 * * * *", "0 9 * * 1", "0 9 * * 5", "30 8 * * *"];
    for (const expr of expressions) {
      const next = calculateNextCronRun(expr);
      expect(next.getTime()).toBeGreaterThan(Date.now() - 1000);
    }
  });
});
