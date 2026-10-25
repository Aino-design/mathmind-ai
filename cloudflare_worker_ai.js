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
      // Older cached PWA builds send `message` and expect one JSON response.
      // New builds send `query` and consume the SSE stream directly.
      const legacyJsonClient = typeof body.query !== "string" && typeof body.message === "string";

      if (!query || typeof query !== "string") {
        return jsonResponse({ error: "Field 'query' is required." }, 400, corsHeaders);
      }

      if (!notebookContent.trim() && !forceReasoning) {
        const arithmeticAnswer = solveSimpleArithmetic(query);
        if (arithmeticAnswer !== null) {
          return jsonResponse({ answer: arithmeticAnswer, reply: arithmeticAnswer }, 200, corsHeaders);
        }
      }

      const googleApiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
      const deepseekApiKey = env.DEEPSEEK_API_KEY;

      const isSimpleQuery = query.trim().length <= 50 && !forceReasoning;
      // Keep DeepSeek opt-in: it requires a funded account. Without the explicit
      // USE_DEEPSEEK=true setting, use the configured Gemini key for every query.
      const useGemini = isSimpleQuery || !deepseekApiKey || env.USE_DEEPSEEK !== "true";

      if (useGemini && !googleApiKey && !env.GROQ_API_KEY && !env.MISTRAL_API_KEY) {
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

      // Optional Groq Qwen provider. The key remains a Cloudflare secret.
      const groqResult = env.GROQ_API_KEY
        ? await requestGroq(env.GROQ_API_KEY, fullPrompt, forceReasoning, env.GROQ_MODEL)
        : null;
      if (groqResult?.response) {
        if (legacyJsonClient) return await legacyJsonResponse(groqResult.response, corsHeaders);
        return new Response(groqResult.response.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      const mistralResult = env.MISTRAL_API_KEY
        ? await requestMistral(env.MISTRAL_API_KEY, fullPrompt, forceReasoning, env.MISTRAL_MODEL)
        : null;
      if (mistralResult?.response) {
        if (legacyJsonClient) return await legacyJsonResponse(mistralResult.response, corsHeaders);
        return new Response(mistralResult.response.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      if (useGemini && !googleApiKey) {
        return jsonResponse({
          error: `Резервные ИИ недоступны (${[
            groqResult?.error && `Groq: ${groqResult.error}`,
            mistralResult?.error && `Mistral: ${mistralResult.error}`,
          ].filter(Boolean).join("; ") || "ошибка"}), и в Cloudflare не задан GEMINI_API_KEY.`,
        }, 502, corsHeaders);
      }

      if (useGemini) {
        // Retry temporary overloads, then step down to stable Flash models.
        const upstreamRes = await requestGemini(googleApiKey, fullPrompt, forceReasoning ? "medium" : "low");

        if (!upstreamRes.ok) {
          const errData = await upstreamRes.json().catch(() => ({}));
          const geminiError = errData.error?.message || `Gemini API error ${upstreamRes.status}`;
          return jsonResponse({
            error: `${[
              groqResult?.error && `Groq: ${groqResult.error}`,
              mistralResult?.error && `Mistral: ${mistralResult.error}`,
              `Gemini: ${geminiError}`,
            ].filter(Boolean).join("; ")}`,
          }, upstreamRes.status, corsHeaders);
        }

        if (legacyJsonClient) return await legacyJsonResponse(upstreamRes, corsHeaders);

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
          const deepseekError = errData.error?.message || `DeepSeek API error ${upstreamRes.status}`;

          // DeepSeek can reject requests when its prepaid balance is empty.
          // Fall back to the already-configured Gemini key so the chat remains usable.
          if (googleApiKey) {
            const fallbackRes = await requestGemini(googleApiKey, fullPrompt, "medium");

            if (fallbackRes.ok) {
              if (legacyJsonClient) return await legacyJsonResponse(fallbackRes, corsHeaders);
              return new Response(fallbackRes.body, {
                status: 200,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "text/event-stream; charset=utf-8",
                  "Cache-Control": "no-cache",
                  "Connection": "keep-alive",
                },
              });
            }

            const fallbackError = await fallbackRes.json().catch(() => ({}));
            return jsonResponse({
              error: `DeepSeek недоступен (${deepseekError}); резервный Gemini тоже не ответил: ${fallbackError.error?.message || `HTTP ${fallbackRes.status}`}`,
            }, fallbackRes.status, corsHeaders);
          }

          return jsonResponse({
            error: `DeepSeek отказал: ${deepseekError}. Пополни баланс DeepSeek или добавь GEMINI_API_KEY в Cloudflare для автоматического резерва.`,
          }, upstreamRes.status, corsHeaders);
        }

        if (legacyJsonClient) return await legacyJsonResponse(upstreamRes, corsHeaders);

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

async function requestGemini(apiKey, prompt, thinkingLevel) {
  const models = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
  let lastResponse;
  let lastError;

  for (const [modelIndex, model] of models.entries()) {
    const attempts = modelIndex === 0 ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        lastResponse = await fetchBeforeHeaders(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { thinkingConfig: { thinkingLevel } },
          }),
        });

        if (lastResponse.ok) return lastResponse;
        const canRetry = [429, 500, 502, 503, 504].includes(lastResponse.status);
        if (canRetry && attempt + 1 < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
          continue;
        }
        break;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
        }
      }
    }
  }

  if (lastResponse) return lastResponse;
  return jsonResponse({ error: `Gemini временно недоступен: ${lastError?.message || "ошибка сети"}` }, 503);
}

async function requestGroq(apiKey, prompt, forceReasoning, configuredModel) {
  try {
    const response = await fetchBeforeHeaders("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: configuredModel || "qwen/qwen3.8-27b",
        messages: [
          {
            role: "system",
            content: [
              "Ты MathMind, дружелюбный репетитор по математике. Отвечай на русском, если пользователь пишет по-русски.",
              "На простой вопрос отвечай кратко и сразу; сложную тему объясняй понятно, по шагам и с примерами.",
              "Форматируй ответ Markdown: используй абзацы, списки и формулы, когда это помогает.",
              "Если дан контекст тетради, опирайся на него и не выдумывай нечитаемые записи.",
              forceReasoning ? "Тщательно проверь решение и объясни понятные шаги, не раскрывая скрытые внутренние рассуждения." : "",
            ].filter(Boolean).join(" "),
          },
          { role: "user", content: prompt },
        ],
        stream: true,
        max_completion_tokens: 2048,
        ...(forceReasoning ? { reasoning_effort: "medium", reasoning_format: "hidden" } : {}),
      }),
    });

    if (response.ok) return { response };
    const details = await response.text().catch(() => "");
    return { error: details.slice(0, 300) || `HTTP ${response.status}` };
  } catch (error) {
    return { error: error.message };
  }
}

async function requestMistral(apiKey, prompt, forceReasoning, configuredModel) {
  try {
    const response = await fetchBeforeHeaders("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: configuredModel || "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: [
              "Ты MathMind, дружелюбный репетитор по математике. Отвечай на русском, если пользователь пишет по-русски.",
              "На простой вопрос отвечай кратко и сразу; сложную тему объясняй понятно, по шагам и с примерами.",
              "Форматируй ответ Markdown: используй абзацы, списки и формулы, когда это помогает.",
              "Если дан контекст тетради, опирайся на него и не выдумывай нечитаемые записи.",
              forceReasoning ? "Тщательно проверь вычисления и объясни решение понятными шагами." : "",
            ].filter(Boolean).join(" "),
          },
          { role: "user", content: prompt },
        ],
        stream: true,
        max_tokens: 2048,
        ...(forceReasoning ? { reasoning_effort: "medium" } : {}),
      }),
    });

    if (response.ok) return { response };
    const details = await response.text().catch(() => "");
    return { error: details.slice(0, 300) || `HTTP ${response.status}` };
  } catch (error) {
    return { error: error.message };
  }
}

async function fetchBeforeHeaders(url, options, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Clear the timer as soon as headers arrive, so it cannot cut off the SSE body.
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function solveSimpleArithmetic(input) {
  const expression = input.toLowerCase().trim()
    .replace(/^(?:сколько будет|чему равно|посчитай|вычисли|ответ)\s*/i, "")
    .replace(/[?!=]+$/g, "")
    .replace(/[−]/g, "-")
    .replace(/[×]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/,/g, ".")
    .trim();

  if (!expression || !/[+*/-]/.test(expression) || !/^[\d\s().+*/-]+$/.test(expression)) return null;
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/]/g) || [];
  if (tokens.join("") !== expression.replace(/\s+/g, "")) return null;

  let position = 0;
  function factor() {
    const token = tokens[position++];
    if (token === "+") return factor();
    if (token === "-") return -factor();
    if (token === "(") {
      const value = sum();
      if (tokens[position++] !== ")") throw new Error("bracket");
      return value;
    }
    if (!token || !/^\d+(?:\.\d+)?$/.test(token)) throw new Error("number");
    return Number(token);
  }
  function product() {
    let value = factor();
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const right = factor();
      if (operator === "/" && right === 0) throw new Error("zero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  try {
    const value = sum();
    if (position !== tokens.length || !Number.isFinite(value)) return null;
    return `Ответ: ${Number(value.toPrecision(12))}`;
  } catch {
    return null;
  }
}

async function legacyJsonResponse(streamResponse, corsHeaders) {
  const raw = await streamResponse.text();
  let answer = "";

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const item = JSON.parse(payload);
      const geminiParts = item.candidates?.[0]?.content?.parts || [];
      answer += geminiParts.filter((part) => !part.thought).map((part) => part.text || "").join("");
      answer += item.choices?.[0]?.delta?.content || "";
    } catch {
      // Ignore SSE metadata or non-JSON event lines.
    }
  }

  if (!answer) {
    return jsonResponse({ error: "ИИ вернул пустой поток. Обнови страницу и повтори запрос." }, 502, corsHeaders);
  }
  return jsonResponse({ answer }, 200, corsHeaders);
}
