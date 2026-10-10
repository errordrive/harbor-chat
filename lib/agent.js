'use strict';
/**
 * Harbor Chat v4.0 — invisible backend agent.
 * No agent button, no separate screen. The chat route calls orchestrate() which:
 *  1. Classifies intent (direct | research | file | code | data | multi | background)
 *  2. Selects installed skills matching the intent
 *  3. Builds an augmented system prompt with skill instructions
 *  4. Returns { mode, skillIds, systemExtra, statusMessages }
 *
 * The model still generates the answer; skills shape *how* it works.
 * Nothing private (chain-of-thought, tool protocols) is exposed.
 */

const { getBuiltin } = require('./skills-lib');

// Intent patterns -> skill ids. Ordered by specificity.
const INTENT_RULES = [
  { re: /\b(research|investigate|compare|sources?|citations?|evidence|news about|what happened)\b/i, skills: ['deep-research'], mode: 'research', status: 'Searching sources' },
  { re: /\b(debug|bug|error|stack ?trace|fix (this|the) code|why (does|is).*(not work|fail))\b/i, skills: ['code-engineer', 'qa-bug-hunter'], mode: 'code', status: 'Analyzing code' },
  { re: /\b(refactor|rewrite|optimize|patch|pull request|code review)\b/i, skills: ['code-engineer'], mode: 'code', status: 'Reviewing code' },
  { re: /\b(test|regression|edge ?cases?|qa)\b/i, skills: ['qa-bug-hunter'], mode: 'code', status: 'Planning tests' },
  { re: /\.(csv|json|xlsx?)\b|\b(data analysis|statistics|chart|dataset|correlation|anomal(y|ies))\b/i, skills: ['data-scientist'], mode: 'data', status: 'Analyzing data' },
  { re: /\b(summar(y|ize).*(document|pdf|file|article)|extract.*(document|pdf))\b/i, skills: ['document-analyst'], mode: 'file', status: 'Reading document' },
  { re: /\b(api|endpoint|integration|webhook|sdk|client)\b.*\b(docs?|documentation|integrate|connect)\b/i, skills: ['api-engineer'], mode: 'code', status: 'Reading API docs' },
  { re: /\b(sql|query|database|schema|migration|postgres)\b/i, skills: ['db-assistant'], mode: 'data', status: 'Inspecting schema' },
  { re: /\b(accessib|responsive|mobile layout|ui|ux|design review|contrast)\b/i, skills: ['ui-auditor'], mode: 'code', status: 'Auditing interface' },
  { re: /\b(secur|vulnerab|xss|injection|secret.*expos|audit.*code)\b/i, skills: ['security-reviewer'], mode: 'code', status: 'Reviewing security' },
  { re: /\b(seo|meta tags?|ranking|search engine)\b/i, skills: ['seo-auditor'], mode: 'research', status: 'Auditing SEO' },
  { re: /\b(remember|my preference|save.*preference|forget)\b/i, skills: ['memory-manager'], mode: 'direct', status: null },
  { re: /\b(workflow|automate|steps? to|plan.*task)\b/i, skills: ['workflow-builder'], mode: 'multi', status: 'Planning workflow' },
  { re: /\b(file|folder|directory|organize|rename|move)\b.*\b(project|files?)\b/i, skills: ['file-manager'], mode: 'file', status: 'Managing files' },
  { re: /\b(logs?|build fail|deploy|server|terminal|command)\b/i, skills: ['terminal-devops'], mode: 'code', status: 'Diagnosing' },
];

async function getUserSkills(pool, userId) {
  try {
    const installed = await pool.query(
      'SELECT skill_id FROM skill_installations WHERE user_id=$1 AND enabled=TRUE', [userId]
    );
    const custom = await pool.query(
      'SELECT id, name, instructions, capabilities FROM user_skills WHERE user_id=$1 AND enabled=TRUE', [userId]
    );
    return {
      builtinIds: new Set(installed.rows.map((r) => r.skill_id)),
      custom: custom.rows,
    };
  } catch (e) {
    return { builtinIds: new Set(), custom: [] };
  }
}

async function orchestrate(pool, userId, text) {
  const { builtinIds, custom } = await getUserSkills(pool, userId);
  const t = String(text || '');

  // Match intent rules.
  let matched = null;
  for (const rule of INTENT_RULES) {
    if (rule.re.test(t)) { matched = rule; break; }
  }
  // Custom skills: match by keyword in name/instructions.
  const customMatched = [];
  for (const c of custom) {
    const hay = (c.name + ' ' + c.instructions).toLowerCase();
    const words = t.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    if (words.some((w) => hay.includes(w))) customMatched.push(c);
    if (customMatched.length >= 2) break;
  }

  if (!matched && !customMatched.length) {
    return { mode: 'direct', skillIds: [], systemExtra: '', statusMessages: [] };
  }

  const skillIds = [];
  const instructions = [];
  const statuses = [];

  if (matched) {
    for (const sid of matched.skills) {
      if (!builtinIds.has(sid)) continue; // only use installed skills
      const s = getBuiltin(sid);
      if (!s) continue;
      skillIds.push(sid);
      instructions.push(`[Skill: ${s.name}]\n${s.instructions}`);
    }
    if (matched.status && skillIds.length) statuses.push(matched.status);
  }
  for (const c of customMatched) {
    skillIds.push(c.id);
    instructions.push(`[Custom skill: ${c.name}]\n${String(c.instructions).slice(0, 2000)}`);
  }

  if (!skillIds.length) {
    return { mode: 'direct', skillIds: [], systemExtra: '', statusMessages: [] };
  }

  const systemExtra = [
    'Relevant skills are active for this request. Follow their instructions.',
    ...instructions,
    'Return a polished final answer only. Do not expose internal reasoning, tool calls, or planning.',
    'If a capability is not actually available, say so instead of claiming it was executed.',
  ].join('\n\n');

  return {
    mode: matched ? matched.mode : 'multi',
    skillIds, systemExtra,
    statusMessages: statuses,
  };
}

module.exports = { orchestrate, INTENT_RULES };
