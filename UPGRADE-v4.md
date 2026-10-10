# Harbor Chat v4.0 — Upgrade Report

Source: v3.4-skills-upgrade → v4.0 Advanced AI Workspace
Tests: **61/61 pass** (was 45/45). Frontend builds cleanly.

## Fixed bugs
1. `test/skills.test.js` imported BUILTINS from `routes/skills` (moved to `lib/skills-lib`); updated to expect 15 skills.
2. `lib/health.js` operator-precedence syntax error in `classifyError`.
3. Chat route loaded all skill guidance unconditionally; replaced with intent-based orchestration (only relevant skills injected).

## New features (actually implemented)
- **15 built-in skills** (was 8): added terminal-devops, api-engineer, db-assistant, ui-auditor, seo-auditor, memory-manager, self-verifier.
- **Invisible backend agent** (`lib/agent.js`): intent classification → skill selection → augmented system prompt. No agent button/toggle/screen.
- **Skill lifecycle**: update (auto version bump), rollback, uninstall, import/export with manifest validation, isolated testing, execution history.
- **Workflow engine** (`lib/workflow.js`): 6 templates (repair, research-build, website-improve, secure-review, api-integrate, data-analysis), dependency ordering, run history.
- **Secure workspace** (`lib/workspace.js`): per-user isolation, traversal/symlink protection, list/read/write/move/delete API.
- **Gateway failover** (`lib/health.js` + rewritten `lib/gateway-upstream.js`): health tracking, circuit breaker (5 failures → 1min cooldown), error classification, bounded retries with backoff, correlation IDs, admin diagnostics endpoint.
- **Auth**: account deletion (password + DELETE confirmation), audit log table + login/signup/delete events, audit viewer in admin.
- **Admin**: Diagnostics tab (model health, circuits, error categories — no secrets), Audit Log tab.
- **Frontend**: SkillsLibrary (Discover/Installed/My Skills/History, create/edit/test/export/import/rollback), new skill API functions, admin tabs.

## Migrations added
- `006_skills_v4.sql`: skill_versions, skill_executions, manifest fields
- `007_workflows.sql`: workflows, workflow_runs, workspaces
- `008_audit.sql`: audit_log

## Incomplete (documented blockers)
- Executable skills are instruction-only; no bundled sandbox for code execution.
- No persistent background job queue (workflow runs are request-bounded).
- No community skill publishing/moderation.
- No Git integration.

## Important file changes
- NEW: `lib/skills-lib.js`, `lib/agent.js`, `lib/health.js`, `lib/workflow.js`, `lib/workspace.js`, `lib/audit.js`
- REWRITTEN: `routes/skills.js`, `lib/gateway-upstream.js`, `web/src/components/SkillsLibrary.jsx`
- MODIFIED: `routes/chat.js` (orchestrator), `routes/admin.js` (diagnostics/audit), `routes/auth.js` (delete/audit), `routes/workspace.js` (new), `server.js` (wiring), `web/src/lib/api.js`, `web/src/components/AdminPanel.jsx`, `web/src/App.jsx`, `web/src/styles.css`
- TESTS: `test/v4.test.js` (16 new), updated `test/skills.test.js`, `package.json` test script
