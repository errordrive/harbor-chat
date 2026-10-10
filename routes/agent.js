'use strict';
/**
 * POST /api/agent — ReAct agent loop (max N steps, tools: calculator,
 * datetime, web_search). SSE streams: step events + final answer.
 *
 * Budgeting (Phase 1, per user's Q2 decision): reserve a REALISTIC amount
 * up front (prompt estimate + ONE step ceiling), then TOP UP before each
 * subsequent step. If a top-up fails mid-run, the run ends gracefully with
 * a friendly note instead of failing outright.
 */
const { readJson, sendJson, csrfOk, getClientIp, createRateLimiter } = require('../lib/http');
const validate = require('../lib/validate');
const accounting = require('../lib/accounting');
const { runTool, toolNames } = require('../lib/tools');
const log = require('../lib/log');

const SYSTEM = (lang) => lang === 'bn'
  ? `You are Harbor Agent, a helpful AI assistant that can use tools. Think step by step. When you need a calculation use the calculator tool, for the current date/time use datetime, for fresh web facts use web_search. Reply in Bangla unless the user wrote in English.`
  : `You are Harbor Agent, a helpful AI assistant that can use tools. Think step by step. When you need a calculation use the calculator tool, for the current date/time use datetime, for fresh web facts use web_search.`;

function parseToolCall(text) {
  // The model is instructed to emit: TOOL: name | INPUT: ...
  const m = String(text || '').match(/TOOL:\s*([a-z_]+)\s*\|\s*INPUT:\s*([\s\S]{1,2000})/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!toolNames.includes(name)) return null;
  return { name, input: m[2].trim() };
}

function mount(add, ctx) {
  const { pool, auth, config, plans, ledger, governor, upstream, modelLabel, isModelAllowed } = ctx;
  const rlUser = createRateLimiter({ windowMs: 60000, max: 10 });

  add('POST', '/api/agent', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }

    const lang = validate.lang(body.lang);
    const user = await auth.getAuthUser(pool, req).catch(() => null);
    if (!user) return sendJson(res, 401, { error: 'Please sign in to use the agent.' });
    if (ctx.gateway && !(await ctx.gateway.flag('agent_enabled', true))) {
      return sendJson(res, 503, {
        error: 'Agent mode is temporarily disabled by the administrator.',
        error_bn: 'অ্যাডমিন এজেন্ট মোড সাময়িকভাবে বন্ধ রেখেছেন।',
      });
    }
    if (!rlUser.check('agent:' + user.id)) {
      return sendJson(res, 429, { error: 'Too many requests — slow down a little.' });
    }

    const modelErr = validate.modelId(body.model);
    if (modelErr) return sendJson(res, 400, { error: modelErr });
    const model = body.model;
    const plan = plans.get(user.plan_id);
    if (!plans.modelAllowed(plan, model)) {
      return sendJson(res, 403, { error: 'This model is not included in your plan.' });
    }
    if (!(await isModelAllowed(model))) {
      return sendJson(res, 403, { error: 'This model is not available on the free tier.' });
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 20000) : '';
    if (!prompt.trim()) return sendJson(res, 400, { error: 'prompt is required' });

    // Agent quota (plan-based, per user's Q2 decision).
    const quotaDenied = await ledger.checkAgentQuota(user.id, plan.agent_runs_day).catch(() => null);
    if (quotaDenied) {
      return sendJson(res, 429, {
        error: `You've used all ${quotaDenied.limit} agent run${quotaDenied.limit === 1 ? '' : 's'} for today. It resets at midnight (Dhaka time).`,
        error_bn: `আজকের জন্য আপনার ${quotaDenied.limit}টি এজেন্ট রান শেষ। মধ্যরাতে (ঢাকা সময়) রিসেট হবে।`,
        type: 'agent',
      });
    }

    // Pool governor: free agent paused when strained.
    const g = await governor.state().catch(() => ({ remaining: Infinity }));
    const isPaid = plan.id !== 'free';
    if (!isPaid && g.remaining < config.poolTotalTokens * 0.25) {
      return sendJson(res, 429, {
        error: 'Agent mode is paused for free users during high demand. Try chat mode, or try again later.',
        error_bn: 'বেশি চাপের সময় ফ্রি ব্যবহারকারীদের জন্য এজেন্ট মোড বন্ধ থাকে। চ্যাট মোড ব্যবহার করুন বা পরে চেষ্টা করুন।',
        type: 'pool',
      });
    }

    if (!config.tokenHarborKey) return sendJson(res, 500, { error: 'AI service is not configured.' });

    const stepMax = Math.min(4096, plan.max_output_tokens);
    const stepCeil = stepMax + 1200; // per-step ceiling incl. prompt growth
    const estPrompt = accounting.estimateTokens(SYSTEM(lang)) + accounting.estimateTokens(prompt);
    const lim = { daily: plan.daily_credits, model: config.modelWindowTokenLimit };

    // Reserve a realistic amount up front: prompt + ONE step.
    const r = await ledger.reserve(user.id, model, estPrompt + stepCeil, lim, 'agent').catch(() => ({ error: true }));
    if (r.error) return sendJson(res, 500, { error: 'Could not check your usage. Try again.' });
    if (r.denied) {
      const d = r.denied;
      return sendJson(res, 429, {
        error: d.type === 'daily'
          ? `You've used today's ${d.limit.toLocaleString()} token budget. It resets at midnight (Dhaka time).`
          : `You've used all ${modelLabel(model)} for today.`,
        error_bn: 'আজকের বাজেট শেষ। মধ্যরাতে (ঢাকা সময়) রিসেট হবে।',
        type: d.type,
      });
    }
    const reservation = r.reservation;
    await ledger.recordAgentRun(user.id).catch((e) => log.error('recordAgentRun failed', { error: e.message }));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} };

    let totalPrompt = 0, totalCompletion = 0, settled = false;
    const doSettle = async () => {
      if (settled) return;
      settled = true;
      try { await ledger.settle(reservation, totalPrompt, totalCompletion); }
      catch (e) { log.error('agent settle failed', { error: e.message, userId: user.id }); }
    };
    req.on('close', () => { doSettle(); });

    try {
      const history = [
        { role: 'system', content: SYSTEM(lang) + `\n\nYou can call tools by replying with exactly one line:\nTOOL: <${toolNames.join('|')}> | INPUT: <input>\nAfter a tool result arrives as "TOOL RESULT:", use it and either call another tool or give your FINAL ANSWER.` },
        { role: 'user', content: prompt },
      ];
      let finalAnswer = '';
      let stoppedEarly = false;

      for (let step = 0; step < config.agentSteps; step++) {
        // Top up before each step after the first (realistic per-step reserve).
        if (step > 0) {
          const t = await ledger.topUp(reservation, stepCeil, lim).catch(() => ({ denied: { type: 'daily' } }));
          if (t.denied) {
            stoppedEarly = true;
            send({ type: 'step', step, note: 'budget-exhausted' });
            finalAnswer = (lang === 'bn'
              ? '\n\n_(এই ধাপে দৈনিক বাজেট শেষ হয়ে গেছে, তাই এখানেই থামছি। উপরের অংশটুকুই ফলাফল।)_'
              : '\n\n_(Daily budget ran out at this step, so I stopped here. The partial result above is what I found.)_');
            break;
          }
        }

        send({ type: 'step', step, phase: 'thinking' });
        let call;
        try {
          const gw = ctx.gatewayUpstream;
          call = gw
            ? await gw.callModel(model, history, 0.7, stepMax, user.plan_id)
            : await upstream.callModel(model, history, 0.7, stepMax);
          if (call.fallbackUsed) send({ type: 'fallback', model: call.fallbackUsed });
        } catch (e) {
          send({ type: 'error', error: e.message });
          break;
        }
        totalPrompt += call.promptTokens;
        totalCompletion += call.completionTokens;

        const toolCall = parseToolCall(call.text);
        if (!toolCall) {
          finalAnswer = call.text;
          send({ type: 'step', step, phase: 'done' });
          break;
        }
        send({ type: 'step', step, phase: 'tool', tool: toolCall.name });
        let result;
        try {
          result = await runTool(toolCall.name, toolCall.input);
        } catch (e) {
          result = 'tool error: ' + e.message;
        }
        send({ type: 'step', step, phase: 'tool-result', tool: toolCall.name });
        history.push({ role: 'assistant', content: call.text });
        history.push({ role: 'user', content: `TOOL RESULT: ${result}\n\nContinue: call another tool or give your FINAL ANSWER.` });

        if (step === config.agentSteps - 1) {
          finalAnswer = call.text.replace(/TOOL:\s*[a-z_]+\s*\|\s*INPUT:[\s\S]*/i, '').trim()
            || (lang === 'bn' ? 'দুঃখিত, এই ধাপগুলোতে চূড়ান্ত উত্তর তৈরি করা যায়নি।' : 'Sorry, I could not produce a final answer within the step limit.');
        }
      }

      send({ type: 'final', answer: finalAnswer, stoppedEarly, model });
      await doSettle();
      try { res.end(); } catch (e) {}
    } catch (e) {
      log.error('agent loop failed', { error: e.message, userId: user.id });
      await doSettle();
      send({ type: 'error', error: 'Agent run failed. Try again.' });
      try { res.end(); } catch (e2) {}
    }
  });
}

module.exports = { mount };
