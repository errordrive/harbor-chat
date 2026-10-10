# Harbor Chat v4.0 — Advanced AI Workspace

An AI chat workspace with an invisible backend agent, 15 built-in skills, custom skill ecosystem, workflow engine, secure workspaces, and health-aware provider failover.

**Base:** Token Harbor `https://tokenharbor.ai/v1` (OpenAI-compatible `/chat/completions`).
**Priority models:** `claude-haiku-5.5:free` → `deepseek-v4.1-flash:free` → `mimo-v2.6-flash:free`.

## Quick start

```bash
npm install
cp .env.example .env        # fill in secrets (never commit .env)
cd web && npm install && npm run build && cd ..
npm test                    # 61 tests
node server.js              # http://localhost:3000
```

## Environment (.env.example)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Neon recommended) |
| `SESSION_SECRET` | 32+ random bytes for session HMAC |
| `TOKENHARBOR_KEY` | Server-side API key (never exposed to browser) |
| `TOKENHARBOR_BASE` | Default `https://tokenharbor.ai/v1` |
| `RESEND_API_KEY` | Email sending (OTP, password reset) |
| `TURNSTILE_SECRET` / `TURNSTILE_SITE` | Bot protection (optional) |
| `ADMIN_EMAILS` | Comma-separated admin emails (auto-promoted) |
| `WORKSPACE_ROOT` | User workspace base dir (default `./workspaces`) |

## Key v4.0 features

- **Invisible agent:** chat auto-classifies intent (research, code, data, file, multi) and loads matching installed skills into the system prompt. No agent button, no separate screen.
- **Skills Library:** Discover / Installed / My Skills / History tabs. 15 built-ins, custom skill builder, import/export (validated manifests), version history + rollback, isolated testing, execution history.
- **Workflows:** 6 templates (repair, research-build, website-improve, secure-review, api-integrate, data-analysis) + custom workflows, dependency-ordered steps, run history.
- **Workspace:** per-user isolated file area with traversal/symlink protection. List/read/write/move/delete via API; deletes need `confirm:true`.
- **Gateway:** health tracking + circuit breaker per model, error classification (rate_limit/auth/quota/context_length/outage), bounded retries with backoff, correlation IDs, admin diagnostics at `/api/admin/diagnostics`.
- **Auth:** OTP email verification, scrypt passwords, HMAC sessions, CSRF, rate limits, account deletion (password-confirmed), audit log.
- **Admin:** users, plans, ledger, providers, models, fallbacks, feature flags, diagnostics, audit log.

## Security model

- Skills are instruction-only; manifests are validated (ID format, semver, no `eval(`/`child_process`, known capabilities only). Imports get new IDs and stay private.
- A skill cannot grant itself permissions or access other users' data.
- Workspace paths are resolved safely; symlinks refused; root deletion blocked.
- Destructive actions (file delete, account delete) require explicit confirmation.
- Admin endpoints require `is_admin`; provider keys are AES-256-GCM encrypted and never sent to the browser.

## Migrations

`lib/migrations/` runs in order on boot (idempotent):
- `001_init` users, plans, ledger · `002_admin` bans · `003_otp` email codes
- `004_gateway` providers/models/fallbacks/flags · `005_skills` skills tables
- `006_skills_v4` versions + execution history · `007_workflows` workflows + workspaces
- `008_audit` audit log

Rollback: drop the tables created by the migration you want to revert (they are additive; core tables untouched).

## Incomplete / blockers

- Executable skills run instruction-only; a sandboxed code-execution service is not bundled (run untrusted code in your own sandbox).
- Background jobs that survive process restarts need a job queue (not included); workflow runs are recorded but long runs are bounded by request timeouts.
- Community skill publishing/moderation UI is not included (import/export works locally).
- Git integration is not included.

## Deploy (Render)

Build: `npm install && cd web && npm install && npm run build`
Start: `node server.js`
Set `SESSION_SECRET`, `DATABASE_URL`, `TOKENHARBOR_KEY`, `ADMIN_EMAILS`.
