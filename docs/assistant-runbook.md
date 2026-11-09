# Solar assistant — connecting the site to the Mac Studio

The floating "Ask Apolaki" widget (`js/chat.js`) posts to a same-origin
`/api/chat`, which proxies to the **llm-slm** solar assistant running on the
Mac Studio. This document is the bring-up order and the gotchas.

The browser can only ever call the site's own origin — `netlify.toml` sets
`connect-src 'self'` — so the serverless proxy is not optional decoration. It
is what makes a self-hosted assistant reachable from a public page at all.

---

## The chain

Six links, each of which can be down independently:

| # | Component | Port | Started by |
|---|-----------|------|------------|
| 1 | SEA-LION 9B (MLX, Taglish 8-bit) | `:8001` | MLX server |
| 2 | BGE-M3 embeddings | `:8100` | `llm-slm/embeddings-server/server.py` |
| 3 | LiteLLM gateway | `:4000` | `agent_skills/start-litellm.sh` |
| 4 | Postgres + pgvector | `:5433` | `llm-slm` → `make db-up` |
| 5 | llm-slm Go server | `:8090` | `go run ./cmd/server` |
| 6 | Cloudflare Tunnel | — | `cloudflared` |

Links 1–4 must be up **before** 5, because the Go server resolves its model and
database handles at boot.

---

## Bring-up

```bash
# 1-2. Model servers. SEA-LION 8-bit is the generation model; BGE-M3 is the
#      embedding model. Both are required — see "Gotchas" for why forgetting
#      the embedder produces a bot that answers nothing.
#      (SEA-LION lives at llm-slm/training/quantized/sea-lion-taglish-8bit)

# 3. LiteLLM gateway — already configured with both `sea-lion-9b` and `bge-m3`
cd ~/Documents/Code/agent_skills && ./start-litellm.sh
curl -s http://localhost:4000/v1/models | grep -o 'sea-lion-9b\|bge-m3'

# 4. pgvector
cd ~/Documents/llm-slm
make db-up                              # colima start && docker-compose up -d
go run ./cmd/server -migrate            # apply migrations

# 5. The assistant itself
set -a; source .env; set +a
go run ./cmd/server                     # listens on :8090
curl -s http://localhost:8090/assistant/health     # expect {"status":"ok"}
```

Only once `/assistant/health` returns `ok` locally is there any point exposing it.

---

## Cloudflare Tunnel

DNS for `apolaki.ai` is at Netfirms (`ns1/ns2.netfirms.com`), not Cloudflare, so
a named tunnel cannot create its own record on the apex zone. We delegate a
single subdomain instead, which leaves the live site's DNS completely untouched.

```bash
cloudflared tunnel login                     # opens a browser; pick the zone
cloudflared tunnel create apolaki-assistant  # writes credentials to ~/.cloudflared/
cloudflared tunnel route dns apolaki-assistant assistant.apolaki.ai
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: apolaki-assistant
credentials-file: /Users/macstudio/.cloudflared/<TUNNEL-UUID>.json
ingress:
  - hostname: assistant.apolaki.ai
    service: http://localhost:8090
  - service: http_status:404
```

Run it, then install it so it survives a reboot:

```bash
cloudflared tunnel run apolaki-assistant
sudo cloudflared service install          # launchd; starts at boot
```

**DNS delegation at Netfirms.** In the Netfirms DNS panel add `NS` records for
the `assistant` subdomain pointing at the two Cloudflare nameservers shown when
you add `assistant.apolaki.ai` as a zone in the Cloudflare dashboard. Nothing
about the apex `A` record (currently `75.2.60.5`, Netlify) or the `www` CNAME
changes, so apolaki.ai cannot be affected by this.

> Not yet verified: that Cloudflare accepts a subdomain-only zone on this
> account's plan. If it refuses, the fallbacks are (a) move the whole zone to
> Cloudflare, or (b) host the tunnel on any other domain already in Cloudflare
> — the hostname is never seen by a browser, only by the serverless proxy, so
> it does not need to be on-brand.

---

## Locking the tunnel down — do this before the tunnel is public

Creating the tunnel publishes a hostname, and hostnames are discoverable (new
certificates appear in public Certificate Transparency logs within minutes).
Access control therefore has to come from a policy in front of the tunnel, never
from the hostname being hard to guess.

**Put a Cloudflare Access policy with a service token in front of
`assistant.apolaki.ai` before you route any traffic to it.** Then set the token
on both hosts; `_shared/chat-core.mjs` forwards the pair automatically:

| Variable | Where |
|---|---|
| `CF_ACCESS_CLIENT_ID` | Netlify + Cloudflare Pages env |
| `CF_ACCESS_CLIENT_SECRET` | Netlify + Cloudflare Pages env |

Verify the policy is actually doing its job — an unauthenticated request must be
refused:

```bash
# expect 403 and an Access login page, NOT a model reply
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://assistant.apolaki.ai/assistant/chat \
  -H 'Content-Type: application/json' -d '{"message":"test"}'
```

Also review the service's own auth configuration before exposing it, rather than
relying on the tunnel alone. Check what `JWT_SECRET` is set to in the
environment you actually run, and confirm the behaviour matches your
expectations — `internal/httpapi/auth.go` is the file that decides.

---

## Environment variables

| Variable | Value | Set in |
|---|---|---|
| `SOLAR_ASSISTANT_URL` | `https://assistant.apolaki.ai` | Netlify, Cloudflare Pages |
| `CF_ACCESS_CLIENT_ID` | Access service token id | Netlify, Cloudflare Pages |
| `CF_ACCESS_CLIENT_SECRET` | Access service token secret | Netlify, Cloudflare Pages |
| `VISITOR_OFFSET` | `10000` (default if unset) | optional |

```bash
netlify env:set SOLAR_ASSISTANT_URL https://assistant.apolaki.ai
```

---

## Verifying

```bash
# the tunnel is up and the assistant is healthy
curl -s https://assistant.apolaki.ai/assistant/health

# the site's health gate agrees (this is what decides if the launcher appears)
curl -s https://apolaki.ai/api/chat-health          # expect {"ok":true,...}

# a real answer streams back
curl -N -X POST https://apolaki.ai/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Is solar worth it in Manila?","mode":"customer"}'
```

A reply containing `"fallback":true` means the proxy never reached the
assistant — walk back down the chain from link 6 to link 1.

---

## Gotchas

**Port 5433 is contested on this machine.** `llm-slm/.env.example` puts pgvector
on `localhost:5433`, which is also used by the Les Petits Horizons French tutor's
Postgres, and the BIAN `cloud-sql-proxy` has been seen shadowing it too.
Whichever binds first wins; the loser connects *successfully* to the wrong
database and fails with missing-table errors that read like a broken migration.
If migrations look wrong, check `lsof -nP -iTCP:5433 -sTCP:LISTEN` before
debugging the schema.

**The embedding model is the one people forget.** The assistant needs *both*
`sea-lion-9b` and `bge-m3` from LiteLLM. Without the embedder, retrieval returns
nothing, the grounded-only safety layer escalates every question, and the bot
appears to be "working" while declining to answer anything. That failure looks
like a prompt problem and is not one.

**`:8000` is not the assistant.** Per the machine's `CLAUDE.md`, `:8000` is MLX
serving Qwen2.5-Coder-32B for coding work. SEA-LION is a separate server on
`:8001`. Pointing LiteLLM's `sea-lion-9b` at `:8000` yields a coding model
answering solar questions in English.

**The widget fails closed.** If `/api/chat-health` errors or times out, no
launcher is drawn at all. When testing, an absent chat button is the expected
symptom of a down assistant — not a broken deploy.
