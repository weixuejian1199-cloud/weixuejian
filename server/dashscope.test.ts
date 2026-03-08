import { describe, it, expect } from "vitest";

describe("DashScope API Key Validation", () => {
  it("should have DASHSCOPE_API_KEY configured", () => {
    const key = process.env.DASHSCOPE_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("should have DASHSCOPE_BASE_URL configured", () => {
    const url = process.env.DASHSCOPE_BASE_URL;
    expect(url).toBeTruthy();
    expect(url).toContain("dashscope");
  });

  it("should successfully call DashScope API with the key", async () => {
    const key = process.env.DASHSCOPE_API_KEY!;
    const baseUrl = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3-max-2026-01-23",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      }),
    });

    console.log("DashScope API status:", response.status);
    const data = await response.json() as any;
    console.log("DashScope API response:", JSON.stringify(data).substring(0, 200));

    expect(response.status).toBe(200);
    expect(data.choices).toBeDefined();
  }, 30000);
});
