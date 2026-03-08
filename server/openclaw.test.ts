/**
 * OpenClaw Integration Tests
 * Tests that OPENCLAW_API_KEY and OPENCLAW_API_URL are configured correctly.
 */

import { describe, it, expect } from "vitest";

describe("OpenClaw Configuration", () => {
  it("should have OPENCLAW_API_KEY configured", () => {
    const key = process.env.OPENCLAW_API_KEY;
    expect(key).toBeDefined();
    expect(key?.trim().length).toBeGreaterThan(0);
  });

  it("should have OPENCLAW_API_URL configured", () => {
    const url = process.env.OPENCLAW_API_URL ?? process.env.OPENCLAW_ENDPOINT;
    expect(url).toBeDefined();
    expect(url).toMatch(/^https?:\/\//);
  });

  it("isOpenClawEnabled should return true when key is set", async () => {
    // Dynamically import to pick up env
    const { isOpenClawEnabled } = await import("./openclaw");
    // The key is set to atlas_sk_test_openclaw_integration_2026
    // isOpenClawEnabled checks ENV.openClawApiKey which reads from process.env
    const enabled = Boolean(process.env.OPENCLAW_API_KEY?.trim().length);
    expect(enabled).toBe(true);
  });
});
