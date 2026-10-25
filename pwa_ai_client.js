/**
 * Safe PWA Frontend Client for Cloudflare Worker AI Backend.
 * Handles SSE streaming, prevents Unexpected end of JSON input, and parses reasoning process in real time.
 */

export async function askAI({ workerUrl = "/api/chat", query, notebookContent = "", forceReasoning = false, onThinking, onResponse }) {
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, notebookContent, forceReasoning }),
    });

    const contentType = res.headers.get("content-type") || "";

    // If server returned non-200 JSON error object, parse safely
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
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

    return { thinking: fullThinking, response: fullResponse };
  } catch (err) {
    console.error("AI PWA Request Error:", err);
    throw err;
  }
}
