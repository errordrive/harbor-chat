# Harbor Chat

A beautiful, mobile-first free AI chat web app (React + Vite frontend, zero-dependency
Node server). Talks to **Token Harbor** (`https://tokenharbor.ai/v1`, OpenAI-compatible)
through the server, so your API key stays server-side and never reaches the browser.

Pinned models: **Claude Haiku 5.5**, **DeepSeek V4.1 Flash**, **MiMo V2.6 Flash**
(all `:free`), plus every other free model Token Harbor lists — live from `/v1/models`.

Features: **user accounts (every limit is bound to the user ID)**, streaming replies, markdown with code blocks, multi-chat sidebar (browser
localStorage), model picker, temperature / max tokens / system prompt settings,
regenerate, stop, copy, token usage, per-device **free-usage limits**, **Agent Mode**
(ReAct loop with calculator / clock / web-search tools), installable
PWA (Add to Home Screen), fully responsive from phones to desktops.
UI: "Exam Blue" design system, English/Bangla toggle, light/dark toggle.

## Accounts (v3.2)

Sign-up / sign-in is required to chat. Everything the server enforces is keyed by the
**user ID**, not the browser: clearing site data, a new device or incognito can no longer
reset a quota.

- Email + password. Passwords are hashed with **scrypt** (per-user salt); the server never
  stores or logs plaintext.
- Sessions are a signed (HMAC-SHA256) **HttpOnly, SameSite=Lax** cookie (`Secure` over HTTPS),
  30 days by default. No token in JavaScript / localStorage.
- Login brute-force limits: per IP and per account. Sign-up limit: 5 / hour / IP.
- POST routes require `application/json` + same-origin (CSRF guard).
- `model` must be a pinned model or one Token Harbor lists as `:free` — callers can't point
  your API key at a paid model.
- Each user has a `plan` (`free` | `plus` | `pro`) in `data/users.json`. The **daily** token
  limit is multiplied per plan (`PLAN_MULT` in `server.js`: 1 / 3 / 10). The per-model window is
  not multiplied (it protects the shared upstream pool). Change a user's plan by editing that
  field (an admin/payment hook is the natural next step).
- Chats are still stored in the browser (localStorage), now **namespaced per account**.
  v3.1 chats are adopted by the first account that signs in on that browser.

| Account route | Method | Purpose |
|---|---|---|
| `/api/auth/signup` | POST | `{email, password, name?}` → creates user + session |
| `/api/auth/login` | POST | `{email, password}` |
| `/api/auth/logout` | POST | clears the cookie |
| `/api/me` | GET | `{user}` or `{user:null}` |

**Hosting note:** `data/users.json` and `data/usage.json` live on disk. On hosts with an
ephemeral filesystem (Render free) they reset on redeploy — attach a persistent disk or move
them to a database (Postgres is the next step). Also set `SESSION_SECRET` there so logins
survive restarts.

## Free-usage limits

Token Harbor's free tier is ~1M tokens per model. The server enforces per-device
budgets so free usage always stays inside that allowance:

| Limit | Default | Env var | Scope |
|---|---|---|---|
| Daily tokens | 60,000 × plan multiplier | `DAILY_TOKEN_LIMIT` | per **user**, all models, resets UTC midnight |
| Per-model window | 800,000 | `MODEL_WINDOW_TOKEN_LIMIT` | per **user** per model, rolling 28 days (`MODEL_WINDOW_DAYS`) |

- Token counts **prefer the provider's real `usage` numbers** (streams request
  `stream_options.include_usage`, with automatic retry if the provider rejects it).
  The fallback estimate is Bangla-aware (~4 chars/token for Latin, ~2 for other scripts).
- Every upstream call follows **reserve → call → settle**: prompt estimate + `max_tokens`
  are reserved from your budgets *before* the call, then settled to the true spend
  (real usage when available). A failed call releases its reservation.
- Usage is tracked per signed-in user ID and persisted in `./data/usage.json` (git-ignored).
- When a budget is exhausted the API returns **HTTP 429** with a friendly message
  (English/Bangla, based on the `lang` the client sends) and reset time; the UI shows
  it inline and in the usage meter.
- `GET /api/usage` returns the device's current budgets; the sidebar shows a live
  daily meter, Settings shows per-model detail.
- Request rate limits: 30 req/min per user + 120 req/min per IP on chat/agent.
- **Agent runs are quota'd per day** (`AGENT_DAILY_FREE=1`, `_PLUS=10`, `_PRO=50`).
- **Global pool governor:** the upstream allowance is shared by all users
  (`POOL_TOTAL_TOKENS=3000000` per `POOL_WINDOW_DAYS=30`; set to `0` to disable).
  Below 25% remaining ("strained") free users are clamped to 1024 output tokens and
  free agent runs pause; below 5% ("critical") free chat is denied with a friendly
  message. Paid plans are never governor-limited. Pool state is visible at
  `GET /api/health` → `pool` and `GET /api/usage` → `pool`.
- `npm test` runs the limit/ledger/governor/sanitizer test suite (29 tests).

## Agent Mode

Toggle **Agent mode** in the top bar. Instead of a single reply, the server runs a
ReAct loop (Thought → Action → Observation, up to 6 steps) with three local tools:

| Tool | What it does |
|---|---|
| `calculator` | Safe arithmetic evaluator (`+ - * / % ^ ( )`) — no `eval` |
| `datetime` | Current UTC + Asia/Dhaka date/time |
| `web_search` | Live web results via DuckDuckGo (no API key) |

`POST /api/agent` streams Server-Sent Events: `event: step` with
`{kind:"thought"|"action"|"observation", ...}`, then `event: final` with the answer.
The UI renders each step in a collapsible card above the final answer. Token usage
from all steps counts toward the same free-usage budgets. Works with any chat
model — no function-calling support required.

## Run locally

```bash
cd harbor-chat
export TOKENHARBOR_KEY="thk_live_..."   # your key — never commit it
node server.js
# open http://localhost:3000
```

Frontend source lives in `web/` (React + Vite). To rebuild after editing it:

```bash
cd web && npm install && npm run build   # outputs to ../public/
```

## Deploy on Render (free)

1. Push this folder to a GitHub repo.
2. Render → **New → Web Service** → connect the repo.
3. Settings:
   - **Build Command:** `cd web && npm install && npm run build`
   - **Start Command:** `node server.js`
   - **Environment variables:**
     - `TOKENHARBOR_KEY` = your `thk_live_...` key
     - `SESSION_SECRET` = any long random string (signs login cookies)
     - `TRUST_PROXY_HOPS` = `1` (default; Render sits behind one proxy). Use `0` if not behind a proxy.
     - (optional) `DAILY_TOKEN_LIMIT`, `MODEL_WINDOW_TOKEN_LIMIT`, `MODEL_WINDOW_DAYS`, `SESSION_DAYS`
     - (optional) `POOL_TOTAL_TOKENS`, `POOL_WINDOW_DAYS` (global pool governor), `MAX_OUTPUT_TOKENS`
     - (optional) `AGENT_DAILY_FREE`, `AGENT_DAILY_PLUS`, `AGENT_DAILY_PRO` (agent runs/day)
4. Deploy. On your phone open the URL → *Add to Home screen* for an app-like feel.

## Notes

- The browser only ever talks to `/api/*` on this server; the key is sent
  server → Token Harbor only.
- Chats live in the browser's localStorage (per account) — clearing site data deletes them. Cloud sync needs a database (planned).
- Free-tier models rotate on Token Harbor's side; if a model errors, pick another
  from the dropdown (the list refreshes from `/v1/models` on every load).

## Skills Library upgrade

This revision adds a user-scoped Skills Library:

- Eight built-in instruction skills (research, code review, QA, files, documents, data, workflow planning, security review).
- Install/remove built-in skills and create, enable/disable, import (JSON), or delete custom instruction skills.
- Custom skill content is stored per user in Postgres; migration `005_skills.sql` is applied by the existing migration runner.
- Enabled skill guidance is prepended server-side to chat requests. Explicit online-research requests can trigger a quiet DuckDuckGo search and add the retrieved results as untrusted context.
- The visible Agent toggle is removed from the React source. Agent orchestration is not presented as a separate mode.

### Important capability boundary

Custom skills in this release are instruction-only. They cannot execute uploaded code, run shell commands, or read/write/delete arbitrary project files. The web-search helper is best-effort and should not be treated as guaranteed live browsing. A sandboxed project workspace, code execution, and permission-gated file mutation are still separate implementation tasks and must not be represented to users as available until implemented and tested.

### Build the updated React UI

The checked-in `public/` bundle is retained for compatibility and has a small `skills-runtime.js` adapter so the Skills Library is accessible before rebuilding. To publish the canonical React UI from source, run:

```sh
cd web
npm ci
npm run build
```

Vite writes the production bundle into `../public`. Then restart the Node server. The server applies database migrations automatically on boot.
