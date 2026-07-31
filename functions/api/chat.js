// Cloudflare Pages entry point — POST /api/chat (staging).
// Mirrors netlify/functions/chat.mjs; the shared core is the single source of
// truth so staging and production cannot drift apart.
import { handleChat } from "../../netlify/functions/_shared/chat-core.mjs";

export const onRequest = ({ request, env }) => handleChat(request, env);
