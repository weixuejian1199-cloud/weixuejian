/**
 * AI Reply handler for IM conversations
 * Uses Qianwen (DashScope) streaming API as fallback when OpenClaw is not connected
 */

import { ENV } from "../_core/env";

interface StreamAIReplyParams {
  conversationId: string;
  userId: number;
  content: string;
  onToken: (token: string) => void;
  onDone: (fullReply: string) => void;
  onError?: (err: Error) => void;
}

export async function streamAIReply(params: StreamAIReplyParams): Promise<void> {
  const { content, onToken, onDone, onError } = params;

  const apiKey = ENV.dashScopeApiKey;
  const baseUrl = ENV.dashScopeBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";

  if (!apiKey) {
    onDone("AI 服务暂时不可用，请稍后再试。");
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen3-max-2026-01-23",
        messages: [
          {
            role: "system",
            content:
              "你是 ATLAS 智能助手，一个专业的企业数据分析和报表生成助手。你可以帮助用户分析数据、生成报表、解答业务问题。请用简洁专业的语言回答。",
          },
          { role: "user", content },
        ],
        stream: true,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI API error: ${response.status} ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullReply = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const token = json.choices?.[0]?.delta?.content ?? "";
          if (token) {
            fullReply += token;
            onToken(token);
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    onDone(fullReply || "（无回复）");
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[IM] AI reply error:", error.message);
    if (onError) {
      onError(error);
    } else {
      onDone("AI 回复出现错误，请稍后再试。");
    }
  }
}
