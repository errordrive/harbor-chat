/**
 * Markdown renderer: marked (GFM: tables, strikethrough, task lists) +
 * DOMPurify (XSS sanitization with a strict URL scheme allowlist).
 *
 * Heavy libraries are LAZY-LOADED so the initial bundle stays small:
 * - highlight.js loads (once, via dynamic import) only when a message
 *   actually contains a fenced code block.
 * - KaTeX's JS loads (once) only when a message actually contains math.
 * The KaTeX CSS stays a static import (~23KB, fine).
 *
 * Security notes:
 * - marked's raw HTML output is ALWAYS passed through DOMPurify before it
 *   touches the DOM. Never inject marked output directly.
 * - A DOMPurify hook enforces a strict scheme allowlist: links allow only
 *   http(s)/mailto/tel, images only http(s). `javascript:`, `data:`,
 *   `vbscript:` etc. are stripped even if a future marked version let them
 *   through.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let codeId = 0;

// NOTE: marked 12's `renderer` overrides use the classic positional signature:
// code(code, infostring, escaped), link(href, title, text).
//
// Code content is rendered PLAIN (HTML-escaped) here; enhanceRendered()
// highlights it later once highlight.js has lazy-loaded. The language is
// stashed in data-lang for the highlighter.
marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    code(code, info) {
      const id = 'cb' + (++codeId);
      const lang = String(info || '').trim().split(/\s+/)[0];
      return (
        '<div class="codeblock"><div class="chead"><span>' + escapeHtml(lang || 'code') + '</span>' +
        '<button data-codeblock="' + id + '">Copy</button></div>' +
        '<div class="cbody"><pre><code id="' + id + '" class="hljs" data-lang="' + escapeHtml(lang) + '">' +
        escapeHtml(code) +
        '</code></pre></div></div>'
      );
    },
  },
});

let hooksInstalled = false;
function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        node.removeAttribute('href');
      }
    } else if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (/^https?:\/\//i.test(src)) {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('referrerpolicy', 'no-referrer');
        node.setAttribute('alt', node.getAttribute('alt') || '');
      } else {
        node.removeAttribute('src');
      }
    }
  });
}

/** Render markdown to SANITIZED html. Safe for dangerouslySetInnerHTML. */
export function renderMarkdown(src) {
  installHooks();
  const raw = marked.parse(String(src || ''));
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

// Delegated click handler for "Copy" buttons inside rendered markdown.
export function bindCodeCopy(container) {
  if (!container || container._codeCopyBound) return;
  container._codeCopyBound = true;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-codeblock]');
    if (!btn) return;
    const code = document.getElementById(btn.getAttribute('data-codeblock'));
    if (code) {
      navigator.clipboard.writeText(code.innerText)
        .then(() => {
          const old = btn.textContent;
          btn.textContent = 'Copied ✓';
          setTimeout(() => { btn.textContent = old; }, 1500);
        })
        .catch(() => {});
    }
  });
}

/**
 * Highlight code blocks inside a container. highlight.js is loaded lazily
 * (dynamic import, cached by the module system after the first load).
 * Already-highlighted blocks are skipped via a dataset flag.
 */
async function highlightCodeBlocks(container) {
  const blocks = container.querySelectorAll('pre code[data-lang]');
  if (!blocks.length) return;
  let hljs;
  try {
    ({ default: hljs } = await import('highlight.js/lib/common'));
  } catch {
    return; // offline / chunk failed — leave plain code readable
  }
  for (const el of blocks) {
    if (el.dataset.hl) continue;
    el.dataset.hl = '1';
    const language = String(el.dataset.lang || '').trim().split(/\s+/)[0].toLowerCase();
    try {
      if (language && hljs.getLanguage(language)) {
        el.innerHTML = hljs.highlight(el.textContent, { language }).value;
      } else {
        el.innerHTML = hljs.highlightAuto(el.textContent).value;
      }
    } catch {
      // leave the plain escaped code as-is
    }
  }
}

/**
 * Render math inside a container. KaTeX's JS is loaded lazily (dynamic
 * import, cached after the first load).
 * Single-$ inline math is intentionally NOT enabled (prices like "$5").
 */
async function renderMath(container) {
  let renderMathInElement;
  try {
    ({ default: renderMathInElement } = await import('katex/dist/contrib/auto-render.mjs'));
  } catch {
    return; // offline / chunk failed — leave the raw text readable
  }
  try {
    renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'option', 'pre', 'code'],
      throwOnError: false,
    });
  } catch { /* leave the raw text readable */ }
}

/**
 * Post-process a container that just received renderMarkdown() html:
 * code-copy buttons, lazy syntax highlighting, lazy KaTeX math.
 * Fire-and-forget: callers don't await it. Safe to call on every render
 * (including during streaming) — dynamic imports are cached, highlighted
 * blocks are skipped, and KaTeX consumes delimiters so re-runs are cheap.
 *
 * @param {Element} container - element holding the rendered html
 * @param {string} rawSrc - the original markdown source (used to decide
 *   whether the heavy libraries are needed at all)
 */
export async function enhanceRendered(container, rawSrc) {
  bindCodeCopy(container);
  if (!container) return;
  const src = String(rawSrc || '');
  try {
    if (src.indexOf('```') !== -1) {
      await highlightCodeBlocks(container);
    }
    if (src.indexOf('$$') !== -1 || src.indexOf('\\(') !== -1 || src.indexOf('\\[') !== -1) {
      await renderMath(container);
    }
  } catch { /* never break the chat UI for a post-processing failure */ }
}
