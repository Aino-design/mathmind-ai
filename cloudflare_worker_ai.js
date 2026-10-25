/**
 * Cloudflare Worker Handler for AI Models (Gemini 3.8 Flash + DeepSeek R1)
 * Supports CORS, Server-Sent Events (SSE) streaming, error handling (valid JSON output), and Notebook context.
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    const url = new URL(request.url);

    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/api/chat")) {
        return jsonResponse({ status: "ok", message: "AI Cloudflare Worker is active." }, 200, corsHeaders);
      }

      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed. Use POST." }, 405, corsHeaders);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: "Invalid JSON input body in request." }, 400, corsHeaders);
      }

      // Accept both the current client contract (query/forceReasoning) and
      // older app builds that send message/deepThinking.
      const query = body.query ?? body.message ?? body.prompt;
      const notebookContent = body.notebookContent ?? body.notebook ?? "";
      const forceReasoning = body.forceReasoning ?? body.deepThinking ?? false;

      if (!query || typeof query !== "string") {
        return jsonResponse({ error: "Field 'query' is required." }, 400, corsHeaders);
      }

      const googleApiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
      const deepseekApiKey = env.DEEPSEEK_API_KEY;

      const isSimpleQuery = query.trim().length <= 50 && !forceReasoning;
      const useGemini = isSimpleQuery || !deepseekApiKey;

      if (useGemini && !googleApiKey) {
        return jsonResponse(
          { error: "GEMINI_API_KEY is missing from the Cloudflare Pages project secrets." },
          500,
          corsHeaders
        );
      }

      if (!useGemini && !deepseekApiKey) {
        return jsonResponse(
          { error: "DEEPSEEK_API_KEY missing on Cloudflare Worker. Set it with `npx wrangler secret put DEEPSEEK_API_KEY`." },
          500,
          corsHeaders
        );
      }

      let fullPrompt = query;
      if (notebookContent && notebookContent.trim()) {
        fullPrompt = `=== ИИ ТЕТРАДЬ (КОНТЕКСТ ПРИЛОЖЕНИЯ) ===\n${notebookContent.trim()}\n=======================================\n\nЗапрос пользователя:\n${query}`;
      }

      if (useGemini) {
        // Stream the current Gemini Flash model via SSE.
        const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse";
        const upstreamRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": googleApiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { thinkingConfig: { thinkingLevel: forceReasoning ? "medium" : "low" } },
          }),
        });

        if (!upstreamRes.ok) {
          const errData = await upstreamRes.json().catch(() => ({}));
          return jsonResponse({ error: errData.error?.message || `Gemini API error ${upstreamRes.status}` }, upstreamRes.status, corsHeaders);
        }

        return new Response(upstreamRes.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } else {
        // Stream DeepSeek-R1 via SSE
        const deepseekUrl = "https://api.deepseek.com/chat/completions";
        const upstreamRes = await fetch(deepseekUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-reasoner",
            messages: [{ role: "user", content: fullPrompt }],
            stream: true,
          }),
        });

        if (!upstreamRes.ok) {
          const errData = await upstreamRes.json().catch(() => ({}));
          return jsonResponse({ error: errData.error?.message || `DeepSeek API error ${upstreamRes.status}` }, upstreamRes.status, corsHeaders);
        }

        return new Response(upstreamRes.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }
    } catch (err) {
      return jsonResponse({ error: `Internal Cloudflare Worker Error: ${err.message}` }, 500, corsHeaders);
    }
  },
};

function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
