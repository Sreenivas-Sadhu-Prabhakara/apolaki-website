// Cloudflare Pages entry point — GET /api/chat-health (staging).
import { handleHealth } from "../../netlify/functions/_shared/chat-core.mjs";

export const onRequest = ({ request, env }) => handleHealth(request, env);
