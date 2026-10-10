'use strict';
/**
 * Harbor Chat v4.0 — workflow engine.
 * Bounded, step-based execution with dependencies, retries, timeouts,
 * checkpoints, and persistent history. Steps are typed; the chat model
 * executes each step's prompt within the user's workspace boundaries.
 *
 * 6 built-in templates: repair, research-build, website-improve,
 * secure-review, api-integrate, data-analysis.
 */
const crypto = require('crypto');

const TEMPLATES = {
  'repair': {
    name: 'Autonomous Project Repair', description: 'Inspect → diagnose → patch → test → report.',
    steps: [
      { id: 'inspect', title: 'Inspect project structure', kind: 'analyze' },
      { id: 'diagnose', title: 'Detect bugs and root causes', kind: 'analyze', depends_on: ['inspect'] },
      { id: 'patch', title: 'Prepare patch', kind: 'act', depends_on: ['diagnose'], approval: true },
      { id: 'test', title: 'Run tests', kind: 'verify', depends_on: ['patch'] },
      { id: 'report', title: 'Final report', kind: 'report', depends_on: ['test'] },
    ],
  },
  'research-build': {
    name: 'Research and Implementation', description: 'Research → compare → implement → test.',
    steps: [
      { id: 'research', title: 'Search and gather sources', kind: 'analyze' },
      { id: 'compare', title: 'Compare alternatives', kind: 'analyze', depends_on: ['research'] },
      { id: 'implement', title: 'Implement solution', kind: 'act', depends_on: ['compare'], approval: true },
      { id: 'test', title: 'Run tests', kind: 'verify', depends_on: ['implement'] },
      { id: 'report', title: 'Report with citations', kind: 'report', depends_on: ['test'] },
    ],
  },
  'website-improve': {
    name: 'Website Improvement', description: 'Audit → fix UI → build → report.',
    steps: [
      { id: 'audit', title: 'Audit layout and accessibility', kind: 'analyze' },
      { id: 'fix', title: 'Apply UI fixes', kind: 'act', depends_on: ['audit'], approval: true },
      { id: 'build', title: 'Build and test', kind: 'verify', depends_on: ['fix'] },
      { id: 'report', title: 'Changed files report', kind: 'report', depends_on: ['build'] },
    ],
  },
  'secure-review': {
    name: 'Secure Code Review', description: 'Scan → prioritize → patch → verify.',
    steps: [
      { id: 'scan', title: 'Scan for vulnerabilities', kind: 'analyze' },
      { id: 'prioritize', title: 'Prioritize findings', kind: 'analyze', depends_on: ['scan'] },
      { id: 'patch', title: 'Create remediation patches', kind: 'act', depends_on: ['prioritize'], approval: true },
      { id: 'verify', title: 'Run relevant tests', kind: 'verify', depends_on: ['patch'] },
      { id: 'report', title: 'Risk report', kind: 'report', depends_on: ['verify'] },
    ],
  },
  'api-integrate': {
    name: 'API Integration', description: 'Read docs → design client → test.',
    steps: [
      { id: 'docs', title: 'Read API documentation', kind: 'analyze' },
      { id: 'design', title: 'Design client/adapter', kind: 'analyze', depends_on: ['docs'] },
      { id: 'implement', title: 'Implement client', kind: 'act', depends_on: ['design'], approval: true },
      { id: 'test', title: 'Mock + integration tests', kind: 'verify', depends_on: ['implement'] },
      { id: 'report', title: 'Integration report', kind: 'report', depends_on: ['test'] },
    ],
  },
  'data-analysis': {
    name: 'Data Analysis', description: 'Validate → analyze → visualize → report.',
    steps: [
      { id: 'validate', title: 'Validate dataset structure', kind: 'analyze' },
      { id: 'analyze', title: 'Statistical analysis', kind: 'analyze', depends_on: ['validate'] },
      { id: 'visualize', title: 'Create charts', kind: 'act', depends_on: ['analyze'] },
      { id: 'report', title: 'Written report + exports', kind: 'report', depends_on: ['visualize'] },
    ],
  },
};

function getTemplate(id) {
  return TEMPLATES[id] || null;
}

// Topological sort for dependency-aware execution.
function orderSteps(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set(), out = [];
  function visit(s) {
    if (visited.has(s.id)) return;
    visited.add(s.id);
    for (const dep of s.depends_on || []) {
      const d = byId.get(dep);
      if (d) visit(d);
    }
    out.push(s);
  }
  for (const s of steps) visit(s);
  return out;
}

async function createWorkflow(pool, userId, { name, description, template_id, steps }) {
  const id = 'wf_' + crypto.randomBytes(8).toString('hex');
  let finalSteps = steps;
  if (template_id && TEMPLATES[template_id]) {
    finalSteps = TEMPLATES[template_id].steps;
    name = name || TEMPLATES[template_id].name;
    description = description || TEMPLATES[template_id].description;
  }
  if (!Array.isArray(finalSteps) || !finalSteps.length) throw new Error('Workflow needs at least one step.');
  await pool.query(
    'INSERT INTO workflows(id, user_id, name, description, template_id, steps) VALUES($1,$2,$3,$4,$5,$6)',
    [id, userId, String(name).slice(0, 120), String(description || '').slice(0, 500),
     template_id || null, JSON.stringify(finalSteps)]
  );
  return { id, name, steps: finalSteps };
}

async function startRun(pool, userId, workflowId) {
  const { rows } = await pool.query('SELECT * FROM workflows WHERE id=$1 AND user_id=$2', [workflowId, userId]);
  if (!rows.length) throw new Error('Workflow not found.');
  const runId = 'wr_' + crypto.randomBytes(8).toString('hex');
  const steps = rows[0].steps;
  const ordered = orderSteps(steps);
  await pool.query(
    'INSERT INTO workflow_runs(id, workflow_id, user_id, status, current_step, result) VALUES($1,$2,$3,$4,$5,$6)',
    [runId, workflowId, userId, 'running', ordered[0]?.id || null, JSON.stringify({ steps: ordered.map((s) => s.id) })]
  );
  return { runId, steps: ordered };
}

module.exports = { TEMPLATES, getTemplate, orderSteps, createWorkflow, startRun };
