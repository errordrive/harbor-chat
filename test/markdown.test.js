'use strict';
/**
 * Phase 0: markdown sanitization tests (XSS vectors must not survive).
 * Needs a DOM for DOMPurify -> jsdom (devDependency of web/).
 * Run from repo root: npm test
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let renderMarkdown;
before(async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('', { url: 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  // web/src/lib/markdown.js is ESM; import it dynamically.
  const path = require('path');
  const { pathToFileURL } = require('url');
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'src', 'lib', 'markdown.js')).href);
  renderMarkdown = mod.renderMarkdown;
});

describe('markdown sanitization', () => {
  it('strips javascript: URLs from links (the reported hole)', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    assert.ok(!html.includes('javascript:'), 'javascript: must not survive, got: ' + html);
    assert.ok(!html.includes('href='), 'href attribute must be removed');
    assert.ok(html.includes('click'), 'link text stays readable');
  });

  it('strips javascript: URLs from images', () => {
    const html = renderMarkdown('![x](javascript:alert(1))');
    assert.ok(!html.includes('javascript:'), 'got: ' + html);
  });

  it('strips data: and vbscript: URLs', () => {
    assert.ok(!renderMarkdown('[a](data:text/html,<script>alert(1)</script>)').includes('data:'));
    assert.ok(!renderMarkdown('[a](vbscript:msgbox(1))').includes('vbscript:'));
  });

  it('keeps https links and images, adds safe rel/target', () => {
    const html = renderMarkdown('[ok](https://example.com/a) ![img](https://example.com/i.png)');
    assert.ok(html.includes('href="https://example.com/a"'), 'got: ' + html);
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(html.includes('src="https://example.com/i.png"'));
  });

  it('strips raw HTML event handlers and script tags', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(2)</script>');
    assert.ok(!html.includes('onerror'), 'got: ' + html);
    assert.ok(!html.includes('<script'), 'got: ' + html);
  });

  it('renders tables (GFM)', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    assert.ok(html.includes('<table'), 'got: ' + html.slice(0, 120));
  });

  it('renders fenced code blocks with copy button and language label', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    assert.ok(html.includes('class="codeblock"'), 'got: ' + html.slice(0, 200));
    assert.ok(html.includes('data-codeblock='), 'copy button hook missing');
    assert.ok(html.includes('const'), 'code content missing');
  });

  it('does not render single-dollar math (prices stay intact)', () => {
    const html = renderMarkdown('It costs $5 and $10.');
    assert.ok(html.includes('$5'), 'price mangled: ' + html);
  });
});
