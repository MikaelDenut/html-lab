#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COWORK = path.resolve(APP, '..', '..', '..');
const DETECTOR = process.env.IMPECCABLE_DIR
  || path.join(COWORK, 'cyborvent_projects', 'aeris-mittari', '.claude', 'skills', 'impeccable');
const DETECTOR_SCRIPTS = path.join(DETECTOR, 'scripts');
const TEMPLATES = process.env.DESIGN_DETECT_TEMPLATES || path.join(APP, 'core', 'content', 'templates');
const PARSER_PACKAGES = ['htmlparser2', 'css-select', 'css-tree', 'domutils'];

const failures = [];
const fail = (msg) => failures.push(msg);

function exitAfterFlush(code) {
  return new Promise(() => {
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
  });
}

function bail(extra) {
  if (extra) fail(extra);
  process.stderr.write('\nDESIGN-DETECT BROKEN - the result above (if any) is NOT a pass:\n');
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  return exitAfterFlush(1);
}

const proof = (process.env.DESIGN_DETECT_PROOF || '').match(/^(hide|empty):(.+)$/);
if (proof && (!PARSER_PACKAGES.includes(proof[2]) || (proof[1] === 'empty' && proof[2] !== 'css-select'))) {
  await bail(`DESIGN_DETECT_PROOF="${process.env.DESIGN_DETECT_PROOF}" names no package this switch can change`);
}
if (process.env.DESIGN_DETECT_PROOF && !proof) await bail(`DESIGN_DETECT_PROOF="${process.env.DESIGN_DETECT_PROOF}" is not hide:<pkg> or empty:<pkg>`);
const EMPTY_CSS_SELECT = 'data:text/javascript,' + encodeURIComponent(
  'export const selectAll = () => []; export const selectOne = () => null; export const is = () => false;');
const appParent = pathToFileURL(path.join(APP, 'package.json')).href;
const detectorPrefix = pathToFileURL(DETECTOR_SCRIPTS + path.sep).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromDetector = (context.parentURL || '').startsWith(detectorPrefix);
    if (!fromDetector || !PARSER_PACKAGES.includes(specifier)) return nextResolve(specifier, context);
    if (proof && proof[2] === specifier) {
      if (proof[1] === 'hide') return nextResolve(`${specifier}-hidden-by-DESIGN_DETECT_PROOF`, { ...context, parentURL: appParent });
      if (proof[1] === 'empty' && specifier === 'css-select') return { url: EMPTY_CSS_SELECT, shortCircuit: true };
    }
    return nextResolve(specifier, { ...context, parentURL: appParent });
  },
});

async function diagnosePackages() {
  const bad = [];
  for (const name of PARSER_PACKAGES) {
    const spec = proof && proof[1] === 'hide' && proof[2] === name ? `${name}-hidden-by-DESIGN_DETECT_PROOF` : name;
    try { await import(spec); } catch (e) { bad.push(`${name}: ${e.code || ''} ${String(e.message).split('\n')[0]}`); }
  }
  return bad;
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const onlyIds = args.filter((a) => !a.startsWith('--'));

const facade = path.join(DETECTOR_SCRIPTS, 'detector', 'detect-antipatterns.mjs');
if (!fs.existsSync(facade)) await bail(`detector not found at ${facade} (set IMPECCABLE_DIR)`);
let detectHtml, detectText, isFullPage;
try {
  ({ detectHtml, detectText, isFullPage } = await import(pathToFileURL(facade).href));
} catch (e) {
  await bail(`detector failed to load: ${e.message}`);
}
for (const [n, f] of Object.entries({ detectHtml, detectText, isFullPage })) {
  if (typeof f !== 'function') await bail(`detector does not export ${n}()`);
}

async function runHtml(file) {
  const events = [];
  const findings = await detectHtml(file, { inlineIgnores: false, profile: events });
  const parsed = events.some((e) => e.engine === 'static-html' && e.ruleId === 'parse-document');
  const visited = events.filter((e) => e.engine === 'static-html' && e.phase === 'element').length;
  const unsupported = events.filter((e) => e.ruleId === 'unsupported-selector').map((e) => e.detail);
  return { findings, parsed, visited, unsupported };
}

function runCss(file) {
  return detectText(fs.readFileSync(file, 'utf-8'), file, { inlineIgnores: false });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-canary-'));
  try {
    const html = path.join(dir, 'index.html');
    fs.writeFileSync(path.join(dir, 'style.css'), '.body-copy { font-family: "Inter", sans-serif; }\n');
    fs.writeFileSync(html, '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Canary</title>'
      + '<link rel="stylesheet" href="style.css"></head>\n<body><main><h1>Canary</h1>'
      + '<p class="body-copy">Font only from the linked stylesheet.</p><img alt="no source"></main></body>\n</html>\n');
    const r = await runHtml(html);
    const ids = new Set(r.findings.map((f) => f.antipattern));
    if (!r.parsed) fail('canary: static-html engine did not parse the page (it fell back to regex)');
    if (r.parsed && r.visited === 0) fail('canary: static-html engine visited 0 elements (selectors match nothing)');
    for (const want of ['overused-font', 'broken-image']) {
      if (!ids.has(want)) fail(`canary: planted "${want}" was not found (found: ${[...ids].join(', ') || 'nothing'})`);
    }
    const cssIds = new Set(runCss(path.join(dir, 'style.css')).map((f) => f.antipattern));
    if (!cssIds.has('overused-font')) fail(`canary: regex engine missed planted "overused-font" in CSS (found: ${[...cssIds].join(', ') || 'nothing'})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (!fs.existsSync(TEMPLATES)) await bail(`templates folder missing: ${TEMPLATES}`);
let ids = fs.readdirSync(TEMPLATES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
if (onlyIds.length) {
  const unknown = onlyIds.filter((id) => !ids.includes(id));
  if (unknown.length) await bail(`unknown template id(s): ${unknown.join(', ')}`);
  ids = onlyIds;
}
if (ids.length === 0) await bail(`no template folders under ${TEMPLATES}`);

const linkRe = /<link\b[^>]*>/gi;
const report = [];
let htmlChecked = 0;
let cssChecked = 0;

for (const id of ids) {
  const dir = path.join(TEMPLATES, id);
  const files = fs.readdirSync(dir).sort();
  const htmls = files.filter((f) => f.toLowerCase().endsWith('.html'));
  const csss = files.filter((f) => f.toLowerCase().endsWith('.css'));
  if (htmls.length === 0) fail(`${id}: no .html file`);
  if (csss.length === 0) fail(`${id}: no .css file`);

  const entry = { id, html: htmls.length, css: csss.length, findings: [], unsupportedSelectors: [] };
  const linked = new Set();
  for (const h of htmls) {
    const file = path.join(dir, h);
    const src = fs.readFileSync(file, 'utf-8');
    for (const tag of src.match(linkRe) || []) {
      if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag)) continue;
      const href = (tag.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      if (!href || /^(https?:)?\/\//i.test(href)) continue;
      const target = path.resolve(dir, href.split(/[?#]/)[0]);
      if (!fs.existsSync(target)) fail(`${id}/${h}: linked stylesheet "${href}" does not exist`);
      linked.add(target);
    }
    let r;
    try {
      r = await runHtml(file);
    } catch (e) {
      fail(`${id}/${h}: static-html engine threw: ${e.message}`);
      continue;
    }
    if (!r.parsed) fail(`${id}/${h}: static-html engine did not run (fell back to regex)`);
    if (r.parsed && r.visited === 0) fail(`${id}/${h}: static-html engine visited 0 elements`);
    if (!isFullPage(src)) fail(`${id}/${h}: not a full page, so the page-level rules were skipped`);
    entry.unsupportedSelectors.push(...r.unsupported.map((s) => `${h}: ${s}`));
    entry.findings.push(...r.findings);
    htmlChecked += 1;
  }
  for (const c of csss) {
    const file = path.join(dir, c);
    if (!linked.has(file)) fail(`${id}/${c}: not linked by any .html page, so only the regex engine saw it`);
    entry.findings.push(...runCss(file));
    cssChecked += 1;
  }
  report.push(entry);
}

if (htmlChecked === 0 || cssChecked === 0) fail(`checked ${htmlChecked} .html and ${cssChecked} .css files; both must be above zero`);

if (failures.some((f) => /fell back|did not parse/.test(f))) {
  const bad = await diagnosePackages();
  if (bad.length) fail(`parser package(s) failed to load from ${APP}/node_modules: ${bad.join(' | ')} (run npm install in the app)`);
}

const rel = (f) => path.relative(TEMPLATES, f);
const primaryOf = (fs_) => fs_.filter((f) => f.advisory !== true);
let totalPrimary = 0;
let totalAdvisory = 0;
if (jsonMode) {
  process.stdout.write(JSON.stringify(report.map((e) => ({
    ...e, findings: e.findings.map((f) => ({ ...f, file: rel(f.file) })),
  })), null, 2) + '\n');
}
for (const e of report) {
  const p = primaryOf(e.findings);
  totalPrimary += p.length;
  totalAdvisory += e.findings.length - p.length;
  if (jsonMode) continue;
  process.stdout.write(`\n${e.id}: ${p.length} finding(s), ${e.findings.length - p.length} advisory (${e.html} html, ${e.css} css)\n`);
  for (const f of e.findings) {
    process.stdout.write(`  ${f.advisory ? '(advisory) ' : ''}${rel(f.file)}${f.line ? `:${f.line}` : ''} [${f.antipattern}] ${f.snippet}\n`);
  }
  if (e.unsupportedSelectors.length) {
    const uniq = [...new Set(e.unsupportedSelectors.map((s) => s.replace(/^[^:]+: /, '')))];
    process.stdout.write(`  note: static engine cannot match ${uniq.length} selector(s), left out of the cascade: ${uniq.join(' | ')}\n`);
  }
}
const engines = failures.length ? 'ENGINES NOT VERIFIED' : 'engines static-html + regex verified';
const summary = `design-detect: ${report.length} templates, ${htmlChecked} html + ${cssChecked} css checked, ${engines}; ${totalPrimary} finding(s), ${totalAdvisory} advisory`;
process.stderr.write(`\n${summary}\n`);

if (failures.length) await bail();
await exitAfterFlush(totalPrimary > 0 ? 2 : 0);
