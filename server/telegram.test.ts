/**
 * Telegram Bot Token connectivity test
 * Validates that the configured bot token can reach the Telegram API
 */
import { describe, it, expect } from "vitest";

const TELEGRAM_API = "https://api.telegram.org";

describe("Telegram Bot Token", () => {
  it("should be configured", () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThan(10);
  });

  it("should successfully call getMe endpoint", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn("TELEGRAM_BOT_TOKEN not set, skipping live test");
      return;
    }
    const res = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string } };
    expect(data.ok).toBe(true);
    expect(data.result?.username).toBeTruthy();
    console.log(`[Telegram] Bot verified: @${data.result?.username}`);
  });

  it("TELEGRAM_CHAT_ID should be configured", () => {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    expect(chatId).toBeTruthy();
  });
});
