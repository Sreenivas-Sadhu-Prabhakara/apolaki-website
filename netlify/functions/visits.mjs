// Netlify entry point — /api/visits. Storage is Netlify Blobs, which needs no
// provisioning: the store is created on first write and is free on all plans.
// All logic lives in _shared/visits-core.mjs.
import { getStore } from "@netlify/blobs";
import { handleVisits } from "./_shared/visits-core.mjs";

const STORE_NAME = "apolaki-visits";
const KEY = "total";

export default async (req) => {
  const blobs = getStore(STORE_NAME);
  const store = {
    read: () => blobs.get(KEY),
    write: (n) => blobs.set(KEY, String(n)),
  };
  return handleVisits(req, store, process.env);
};

export const config = { path: "/api/visits" };
