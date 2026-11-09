// Netlify entry point — GET /api/chat-health.
// Tells the widget whether the solar assistant is actually answering right now,
// so the "Ask Apolaki" launcher only appears when it can be used.
// All logic lives in _shared/chat-core.mjs.
import { handleHealth } from "./_shared/chat-core.mjs";

export default async (req) => handleHealth(req, process.env);

export const config = { path: "/api/chat-health" };
