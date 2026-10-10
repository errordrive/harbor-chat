'use strict';
/**
 * Harbor Chat v4.0 — built-in skill registry.
 * 15 functional skills with versioned manifests, capabilities, and permissions.
 * Instruction-based skills: the backend agent loads their instructions when
 * the skill is selected for a task. Executable tools are gated by capability.
 */

const BUILTINS = [
  {
    id: 'deep-research', name: 'Deep Research', category: 'Research', icon: 'globe', version: '1.0.0',
    description: 'Search the web, retrieve pages, compare evidence, identify contradictions, and produce citations.',
    instructions: 'For research requests: seek multiple independent sources, compare claims across them, note uncertainty and contradictions explicitly, and cite every factual claim with its URL. Never claim a source was checked unless it was actually retrieved.',
    capabilities: ['web.search', 'web.fetch'], permissions: ['network:web'],
    inputs: { query: 'string (required)', depth: 'string (quick|standard|deep)' },
    outputs: { summary: 'string', citations: 'array of {title, url}', contradictions: 'array of string' },
    timeout_ms: 120000, max_steps: 10,
  },
  {
    id: 'code-engineer', name: 'Code Engineer', category: 'Development', icon: 'code', version: '1.0.0',
    description: 'Understand project structure, debug code, create patches, refactor files, and explain actual changes.',
    instructions: 'Inspect relevant context before proposing changes. Explain the root cause first, prefer minimal patches, show the exact diff, and never claim code was changed or tests were run unless the tools confirm it.',
    capabilities: ['file.read', 'file.search', 'code.analyze'], permissions: ['workspace:read'],
    inputs: { task: 'string (required)', files: 'array of string' },
    outputs: { analysis: 'string', patch: 'string (unified diff)', files_changed: 'array of string' },
    timeout_ms: 180000, max_steps: 15,
  },
  {
    id: 'qa-bug-hunter', name: 'QA & Bug Hunter', category: 'Development', icon: 'bug', version: '1.0.0',
    description: 'Reproduce defects where possible, create regression tests, run approved checks, and validate fixes.',
    instructions: 'Look for reproducible defects, boundary conditions, and regressions. Distinguish verified failures from suspected issues. Recommend a concrete regression test for every fix.',
    capabilities: ['code.analyze', 'test.plan'], permissions: ['workspace:read'],
    inputs: { target: 'string (required)', context: 'string' },
    outputs: { findings: 'array of {severity, title, evidence}', tests: 'array of string' },
    timeout_ms: 120000, max_steps: 10,
  },
  {
    id: 'file-manager', name: 'File & Project Manager', category: 'Productivity', icon: 'folder', version: '1.0.0',
    description: 'Read, search, create, rename, move, edit, and delete files within explicitly authorized workspaces.',
    instructions: 'Operate only on user-authorized workspace paths. Preview destructive changes and obtain explicit approval before deleting or overwriting files. Never access paths outside the workspace.',
    capabilities: ['file.read', 'file.search', 'file.write'], permissions: ['workspace:read', 'workspace:write'],
    inputs: { operation: 'string (required)', path: 'string', content: 'string' },
    outputs: { result: 'string', paths: 'array of string' },
    timeout_ms: 60000, max_steps: 8,
  },
  {
    id: 'terminal-devops', name: 'Terminal & DevOps', category: 'Development', icon: 'terminal', version: '1.0.0',
    description: 'Diagnose logs, inspect configuration, analyze build failures, and run approved commands inside a sandbox.',
    instructions: 'Run only approved, non-destructive commands inside the sandbox. Explain what each command does before running it. Never run arbitrary model-generated shell commands in the main backend process.',
    capabilities: ['shell.run', 'log.read'], permissions: ['sandbox:exec'],
    inputs: { command: 'string (required)', purpose: 'string' },
    outputs: { stdout: 'string', stderr: 'string', exit_code: 'number' },
    timeout_ms: 120000, max_steps: 8,
  },
  {
    id: 'document-analyst', name: 'Document Analyst', category: 'Productivity', icon: 'file', version: '1.0.0',
    description: 'Process supported documents, extract information, compare versions, and generate reports.',
    instructions: 'Summarize provided documents faithfully, distinguish source content from inference, preserve important numbers and dates, and identify missing context.',
    capabilities: ['document.read', 'document.extract'], permissions: ['workspace:read'],
    inputs: { document: 'string (required)', task: 'string' },
    outputs: { summary: 'string', key_points: 'array of string' },
    timeout_ms: 120000, max_steps: 8,
  },
  {
    id: 'data-scientist', name: 'Data Scientist', category: 'Data', icon: 'chart', version: '1.0.0',
    description: 'Analyze CSV/JSON files, calculate statistics, detect anomalies, and create charts and exports.',
    instructions: 'Validate data shape and missing values before analysis. Explain assumptions, show calculations where useful, and do not infer causation from correlation alone.',
    capabilities: ['data.inspect', 'data.analyze'], permissions: ['workspace:read'],
    inputs: { dataset: 'string (required)', questions: 'array of string' },
    outputs: { statistics: 'object', insights: 'array of string', charts: 'array of string' },
    timeout_ms: 180000, max_steps: 12,
  },
  {
    id: 'workflow-builder', name: 'Workflow Builder', category: 'Automation', icon: 'workflow', version: '1.0.0',
    description: 'Create reusable multi-step workflows with validation, checkpoints, retries, and execution history.',
    instructions: 'Break complex tasks into ordered, testable steps. Track dependencies, use bounded retries, request approval for risky side effects, and summarize final outcomes.',
    capabilities: ['workflow.plan', 'workflow.execute'], permissions: [],
    inputs: { goal: 'string (required)', constraints: 'string' },
    outputs: { steps: 'array of {id, title, depends_on}', risks: 'array of string' },
    timeout_ms: 120000, max_steps: 10,
  },
  {
    id: 'api-engineer', name: 'API Integration Engineer', category: 'Development', icon: 'plug', version: '1.0.0',
    description: 'Inspect API documentation, generate typed clients, create test requests, and validate integrations.',
    instructions: 'Read the API documentation first. Identify authentication, request/response schemas, and error codes. Generate a minimal typed client and test requests. Never hardcode credentials.',
    capabilities: ['web.fetch', 'code.analyze'], permissions: ['network:web'],
    inputs: { api_docs: 'string (required)', goal: 'string' },
    outputs: { client_code: 'string', test_requests: 'array of string', notes: 'array of string' },
    timeout_ms: 180000, max_steps: 12,
  },
  {
    id: 'db-assistant', name: 'Database Assistant', category: 'Data', icon: 'database', version: '1.0.0',
    description: 'Inspect authorized schemas, draft queries, explain database errors, and generate safe migrations.',
    instructions: 'Inspect only authorized schemas. Draft read-only queries first; flag destructive statements and require approval. Explain errors with the exact failing part highlighted.',
    capabilities: ['db.inspect', 'db.query'], permissions: ['workspace:read'],
    inputs: { task: 'string (required)', schema: 'string' },
    outputs: { queries: 'array of string', explanation: 'string', warnings: 'array of string' },
    timeout_ms: 120000, max_steps: 10,
  },
  {
    id: 'ui-auditor', name: 'UI/UX Auditor', category: 'Design', icon: 'eye', version: '1.0.0',
    description: 'Review responsive layouts, accessibility, navigation, forms, and visual consistency.',
    instructions: 'Review mobile-first. Check touch targets (>=44px), contrast, focus states, form labels, and navigation consistency. Prioritize findings by user impact.',
    capabilities: ['file.read', 'code.analyze'], permissions: ['workspace:read'],
    inputs: { target: 'string (required)', viewport: 'string' },
    outputs: { findings: 'array of {severity, area, detail}', score: 'number' },
    timeout_ms: 120000, max_steps: 10,
  },
  {
    id: 'security-reviewer', name: 'Security Reviewer', category: 'Development', icon: 'shield', version: '1.0.0',
    description: 'Inspect authorized code for common vulnerabilities, exposed secrets, unsafe configuration, and dependency risks.',
    instructions: 'Review only authorized code and targets. Prioritize actionable findings by severity, include evidence and remediation, and never expose discovered secrets in the report.',
    capabilities: ['code.analyze', 'security.review'], permissions: ['workspace:read'],
    inputs: { target: 'string (required)', scope: 'string' },
    outputs: { findings: 'array of {severity, title, evidence, remediation}' },
    timeout_ms: 180000, max_steps: 12,
  },
  {
    id: 'seo-auditor', name: 'SEO Auditor', category: 'Marketing', icon: 'search', version: '1.0.0',
    description: 'Analyze page metadata, content structure, links, and technical SEO issues.',
    instructions: 'Check title/meta length, heading hierarchy, image alts, link health, and mobile usability. Give concrete fixes ordered by expected impact.',
    capabilities: ['web.fetch', 'code.analyze'], permissions: ['network:web'],
    inputs: { url: 'string (required)' },
    outputs: { findings: 'array of {severity, area, detail}', score: 'number' },
    timeout_ms: 120000, max_steps: 10,
  },
  {
    id: 'memory-manager', name: 'Memory Manager', category: 'Productivity', icon: 'brain', version: '1.0.0',
    description: 'Save, retrieve, edit, and delete user-approved preferences and project facts.',
    instructions: 'Only store what the user explicitly approves. Keep entries concise and factual. Never store credentials, tokens, or secrets.',
    capabilities: ['memory.read', 'memory.write'], permissions: [],
    inputs: { operation: 'string (required)', key: 'string', value: 'string' },
    outputs: { result: 'string' },
    timeout_ms: 30000, max_steps: 5,
  },
  {
    id: 'self-verifier', name: 'Self-Verification', category: 'System', icon: 'check', version: '1.0.0',
    description: 'Check outputs, validate results, identify missing evidence, and retry recoverable failures within a bounded budget.',
    instructions: 'Verify claims against evidence. List what was checked, what is missing, and what was retried. Stay within the step budget; report honestly when verification is incomplete.',
    capabilities: ['verify.check'], permissions: [],
    inputs: { claim: 'string (required)', evidence: 'array of string' },
    outputs: { verdict: 'string', gaps: 'array of string', retried: 'number' },
    timeout_ms: 60000, max_steps: 6,
  },
];

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

// Validate an imported/custom skill manifest. Returns { ok, errors[] }.
function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return { ok: false, errors: ['Manifest must be an object.'] };
  if (!ID_RE.test(String(m.id || ''))) errors.push('id must match [a-z0-9._-]{2,64}.');
  if (String(m.name || '').trim().length < 2) errors.push('name is required (min 2 chars).');
  if (String(m.instructions || '').trim().length < 20) errors.push('instructions required (min 20 chars).');
  if (m.version && !/^\d+\.\d+\.\d+$/.test(String(m.version))) errors.push('version must be semver (x.y.z).');
  // Security: reject executable behavior in instruction-only skills.
  const text = JSON.stringify(m).toLowerCase();
  const banned = ['eval(', 'child_process', 'require(\'fs\')', '__proto__', 'constructor['];
  for (const b of banned) {
    if (text.includes(b)) errors.push(`manifest contains forbidden pattern: ${b}`);
  }
  // Capabilities must be from the known set.
  const knownCaps = new Set(BUILTINS.flatMap((s) => s.capabilities));
  for (const c of m.capabilities || []) {
    if (!knownCaps.has(c)) errors.push(`unknown capability: ${c}`);
  }
  return { ok: errors.length === 0, errors };
}

function getBuiltin(id) {
  return BUILTINS.find((s) => s.id === id) || null;
}

module.exports = { BUILTINS, getBuiltin, validateManifest, ID_RE };
