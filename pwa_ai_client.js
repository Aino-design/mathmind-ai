/**
 * Safe PWA Frontend Client for Cloudflare Worker AI Backend.
 * Safely parses JSON responses and handles thinking stream (<think>...</think>).
 */

export async function askAI({ workerUrl, query, notebookContent = "", forceReasoning = false, onThinking, onResponse }) {
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, notebookContent, forceReasoning }),
    });

    const contentType = res.headers.get("content-type") || "";

    // Prevent 'Unexpected end of JSON input' error when server sends non-JSON or empty body
    if (!contentType.includes("application/json")) {
      const rawText = await res.text();
      throw new Error(`Server returned non-JSON response (${res.status}): ${rawText.slice(0, 100)}`);
    }

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP error ${res.status}`);
    }

    const reply = data.reply || "";

    // Extract thinking process (<think>...</think>) if present
    if (reply.includes("<think>")) {
      const thinkStart = reply.indexOf("<think>") + 7;
      const thinkEnd = reply.indexOf("</think>");

      if (thinkEnd !== -1) {
        const thinkingProcess = reply.substring(thinkStart, thinkEnd).trim();
        const finalAnswer = reply.substring(thinkEnd + 8).trim();

        if (onThinking) onThinking(thinkingProcess);
        if (onResponse) onResponse(finalAnswer);

        return { thinking: thinkingProcess, response: finalAnswer, model: data.model };
      }
    }

    if (onResponse) onResponse(reply);
    return { response: reply, model: data.model };
  } catch (err) {
    console.error("AI PWA Request Error:", err);
    throw err;
  }
}
