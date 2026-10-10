'use strict';
/**
 * Agent tools (Phase 0 set, unchanged): calculator, datetime, web_search.
 * Moved verbatim from server.js into a module. Phase 4 replaces these with
 * the bigger toolset; the ReAct loop calls runTool(name, input).
 */
const https = require('https');

// Safe arithmetic evaluator (no eval): + - * / % ^ ( ) and decimals.
function calculator(expr) {
  const s = String(expr || '').trim().slice(0, 200);
  if (!s || !/^[0-9+\-*/%^().\s]+$/.test(s)) throw new Error('invalid expression');
  let i = 0;
  const peek = () => s[i];
  const eat = () => s[i++];
  const skipWs = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function parseNum() {
    skipWs();
    let num = '';
    while (i < s.length && /[0-9.]/.test(peek())) num += eat();
    if (!/^\d*\.?\d+$/.test(num)) throw new Error('invalid number');
    return parseFloat(num);
  }
  function parsePrimary() {
    skipWs();
    if (peek() === '(') { eat(); const v = parseAdd(); skipWs(); if (peek() !== ')') throw new Error('missing )'); eat(); return v; }
    if (peek() === '-') { eat(); return -parsePrimary(); }
    if (peek() === '+') { eat(); return parsePrimary(); }
    return parseNum();
  }
  function parsePow() {
    let v = parsePrimary();
    skipWs();
    if (peek() === '^') { eat(); v = Math.pow(v, parsePow()); }
    return v;
  }
  function parseMul() {
    let v = parsePow();
    for (;;) {
      skipWs();
      const op = peek();
      if (op === '*' || op === '/' || op === '%') {
        eat();
        const r = parsePow();
        v = op === '*' ? v * r : op === '/' ? v / r : v % r;
      } else return v;
    }
  }
  function parseAdd() {
    let v = parseMul();
    for (;;) {
      skipWs();
      const op = peek();
      if (op === '+' || op === '-') { eat(); const r = parseMul(); v = op === '+' ? v + r : v - r; }
      else return v;
    }
  }
  const v = parseAdd();
  skipWs();
  if (i !== s.length) throw new Error('invalid expression');
  if (!Number.isFinite(v)) throw new Error('result is not finite');
  return String(Math.round(v * 1e10) / 1e10);
}

function datetime() {
  const now = new Date();
  const fmt = (tz) => now.toLocaleString('en-GB', { timeZone: tz, hour12: false });
  const day = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dhaka' });
  return `UTC: ${fmt('UTC')} | Asia/Dhaka: ${fmt('Asia/Dhaka')} (+06:00), ${day}`;
}

function stripTags(h) {
  return String(h)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Best-effort web search via DuckDuckGo HTML (no API key needed).
function webSearch(query) {
  return new Promise((resolve) => {
    const q = String(query || '').trim().slice(0, 200);
    if (!q) return resolve('empty query');
    const req = https.request(
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
        timeout: 12000,
      },
      (upRes) => {
        const chunks = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () => {
          try {
            const html = Buffer.concat(chunks).toString('utf8');
            const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
            const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
            const out = [];
            for (let k = 0; k < Math.min(titles.length, 5); k++) {
              let href = titles[k][1];
              const m = href.match(/[?&]uddg=([^&]+)/);
              if (m) { try { href = decodeURIComponent(m[1]); } catch (_) {} }
              const title = stripTags(titles[k][2]).slice(0, 140);
              const snip = snips[k] ? stripTags(snips[k][1]).slice(0, 220) : '';
              if (title) out.push(`${k + 1}. ${title}\n   ${href}\n   ${snip}`);
            }
            resolve(out.length ? out.join('\n\n') : 'no results found');
          } catch (e) { resolve('search parse failed'); }
        });
        upRes.on('error', () => resolve('search failed'));
      }
    );
    req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve('search timed out'); });
    req.on('error', () => resolve('search unavailable'));
    req.end();
  });
}

const TOOLS = { calculator, datetime, web_search: webSearch };

async function runTool(name, input) {
  const fn = TOOLS[name];
  if (!fn) throw new Error('unknown tool: ' + name);
  return String(await fn(input)).slice(0, 2000);
}

module.exports = { TOOLS, runTool, toolNames: Object.keys(TOOLS) };
