// Netlify entry point — POST /api/chat.
// The widget calls this same-origin path; the site's CSP is `connect-src 'self'`,
// so the browser cannot reach the assistant directly and this proxy makes the
// outbound hop. All logic lives in _shared/chat-core.mjs, which the Cloudflare
// Pages entry point (functions/api/chat.js) reuses verbatim.
import { handleChat } from "./_shared/chat-core.mjs";

export default async (req) => handleChat(req, process.env);

export const config = { path: "/api/chat" };
