// Cloudflare Pages entry point — /api/visits (staging).
// Storage is a Workers KV namespace bound as VISITS in the Pages project
// settings. If the binding is missing the core answers with the floor value
// rather than an error, so a half-configured staging site still renders.
import { handleVisits } from "../../netlify/functions/_shared/visits-core.mjs";

const KEY = "total";

export const onRequest = ({ request, env }) => {
  const kv = env && env.VISITS;
  const store = {
    read: () => {
      if (!kv) throw new Error("VISITS KV namespace is not bound");
      return kv.get(KEY);
    },
    write: (n) => kv.put(KEY, String(n)),
  };
  return handleVisits(request, store, env);
};
