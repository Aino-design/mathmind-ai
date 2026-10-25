/**
 * Safe PWA Frontend Client for Cloudflare Worker AI Backend.
 * Handles SSE streaming, prevents Unexpected end of JSON input, and parses reasoning process in real time.
 */

function explainProviderError(message) {
  const retry = message.match(/retry in\s+([\d.]+)s/i);
  const seconds = retry ? Math.ceil(Number(retry[1])) : 60;
  if (/quota exceeded|resource_exhausted|free_tier_requests|requests per minute limit exceeded/i.test(message)) {
    return `Исчерпан минутный лимит Gemini. Подожди примерно ${seconds} сек. и отправь вопрос снова. Ключ работает; перезапуск сервера не поможет.`;
  }
  if (/high demand|temporarily overloaded|service_unavailable/i.test(message)) {
    return "Gemini сейчас перегружен. Подожди немного и попробуй ещё раз.";
  }
  if (/insufficient balance/i.test(message)) {
    return "У DeepSeek закончился баланс. Попробуй позже: приложение переключится на Gemini.";
  }
  return message;
}

export async function askAI({ workerUrl = "/api/chat", query, notebookContent = "", forceReasoning = false, onThinking, onResponse }) {
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, notebookContent, forceReasoning }),
    });

    const contentType = res.headers.get("content-type") || "";

    // Parse JSON errors safely; empty/error HTML from Pages must not become a JSON parse exception.
    if (contentType.includes("application/json")) {
      const raw = await res.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Cloudflare вернул некорректный JSON (HTTP ${res.status}). Проверь Pages Function /api/chat.`);
      }
      if (data.error) {
        throw new Error(explainProviderError(String(data.error)));
      }
      if (data.reply) {
        if (onResponse) onResponse(data.reply);
        return { response: data.reply };
      }
    }

    if (!res.ok) {
      const rawText = await res.text();
      throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 100) || "Empty server response"}`);
    }

    if (!contentType.includes("text/event-stream")) {
      const rawText = await res.text();
      throw new Error(`Для /api/chat ожидался потоковый ответ, но пришёл ${contentType || "пустой ответ"}: ${rawText.slice(0, 80)}`);
    }

    if (!res.body) {
      throw new Error("Server response body is empty.");
    }

    // Read SSE ReadableStream line by line
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullResponse = "";
    let fullThinking = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (trimmed.startsWith("data:")) {
          const dataStr = trimmed.replace(/^data:\s*/, "");
          if (dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);

            // Gemini SSE structure
            const geminiText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (geminiText) {
              fullResponse += geminiText;
              if (onResponse) onResponse(fullResponse);
            }

            // DeepSeek SSE structure
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              if (delta.reasoning_content) {
                fullThinking += delta.reasoning_content;
                if (onThinking) onThinking(fullThinking);
              }
              if (delta.content) {
                fullResponse += delta.content;
                if (onResponse) onResponse(fullResponse);
              }
            }
          } catch (e) {
            // Ignore partial JSON chunks until full line arrives
          }
        }
      }
    }

    if (!fullResponse) {
      throw new Error("ИИ вернул пустой поток. Проверь модель и секрет GEMINI_API_KEY в Cloudflare.");
    }
    return { thinking: fullThinking, response: fullResponse };
  } catch (err) {
    console.error("AI PWA Request Error:", err);
    throw err;
  }
}
