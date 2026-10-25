import aiWorker from "../../cloudflare_worker_ai.js";

// Cloudflare Pages exposes files in functions/ as real API routes.
// This makes POST /api/chat reach the AI worker logic.
export async function onRequest(context) {
  return aiWorker.fetch(context.request, context.env, context);
}
