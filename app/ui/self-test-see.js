// Self-tests for 0.2.0 "Seeing how it fits" (PLAN "## Seeing how it fits (0.2.0)").
// Uses from h: t, assert, eq, until, wait, settle, probe, openContent, sample, doc, typeAfter,
// view, S, E, P, preview, flows, runCommand, switchTo, tabNamed, activeTab, $.
// Not used: setDoc, replace, pageTabOf.
// The tests read only the DOM, the probe replies and exported functions, never CodeMirror internals.
import { invoke } from './api.js';

export const SEE_TESTS = 49;

const SAMPLE_IDS = ['space-poster', 'space-club', 'my-hobby', 'pancakes', 'gallery'];
// Code elements a sample page may hold that the page itself does not show as written.
const MAY_STAY_ALONE = new Set(['link', 'style', 'script']);

const PAGE = (body) => `<!doctype html>\n<html>\n<body>\n${body}</body>\n</html>\n`;

// Pure helpers, also run by the node checks.

export function foldedText(n) {
  return n === 1 ? '1 line folded' : `${n} lines folded`;
}

export function nthIndex(list, name, n) {
  let seen = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === name && ++seen === n) return i;
  }
  return -1;
}

export function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// True when the opening tag text holds id="ID" (any quotes, any case of "id").
export function holdsId(openTag, id) {
  const v = escapeRe(id);
  return new RegExp(`\\s[iI][dD]\\s*=\\s*("${v}"|'${v}'|${v}(?=[\\s/>]|$))`).test(openTag);
}

export function crumbsOf(names) {
  return names.join(' › ');
}

export function longDoc(n) {
  let body = '';
  for (let i = 0; i < n; i++) body += `<p>Line ${i} of a long page about planets, stars and comets.</p>\n`;
  return PAGE(body);
}

// Checks one page against its code line-up. slice(from, to) reads the code text.
export function lineUpProblems(where, names, ids, els, al, slice, strict) {
  const out = [];
  if (!al || al.pageToCode.length !== names.length || al.codeToPage.length !== els.length) {
    const sizes = al ? `${al.pageToCode.length}/${al.codeToPage.length}` : 'none';
    out.push(`${where}: line-up sizes ${sizes} for ${names.length} page and ${els.length} code elements`);
    return { problems: out, ids: 0 };
  }
  pairProblems(where, names, els, al, out);
  const idCount = idProblems(where, names, ids || [], els, al, slice, out);
  if (strict) {
    for (let c = 0; c < els.length; c++) {
      if (al.codeToPage[c] < 0 && !MAY_STAY_ALONE.has(els[c].name)) {
        out.push(`${where}: code <${els[c].name}> at ${els[c].from} has no page partner`);
      }
    }
  }
  return { problems: out, ids: idCount };
}

function pairProblems(where, names, els, al, out) {
  let last = -1;
  for (let i = 0; i < names.length; i++) {
    const c = al.pageToCode[i];
    if (c < 0) continue;
    if (c >= els.length) {
      out.push(`${where}: page ${i} goes to code ${c}, past the end`);
      continue;
    }
    if (al.codeToPage[c] !== i) out.push(`${where}: page ${i} goes to code ${c}, which goes back to page ${al.codeToPage[c]}`);
    if (els[c].name !== names[i]) out.push(`${where}: page ${i} <${names[i]}> paired with code <${els[c].name}>`);
    if (c <= last) out.push(`${where}: pairs cross at page ${i}`);
    last = c;
  }
  for (let c = 0; c < els.length; c++) {
    const p = al.codeToPage[c];
    if (p >= 0 && (p >= names.length || al.pageToCode[p] !== c)) out.push(`${where}: code ${c} goes to page ${p}, which does not come back`);
  }
}

function idProblems(where, names, ids, els, al, slice, out) {
  let count = 0;
  for (let i = 0; i < names.length; i++) {
    const id = ids[i];
    if (!id) continue;
    count += 1;
    const c = al.pageToCode[i];
    if (c < 0 || c >= els.length) {
      out.push(`${where}: <${names[i]} id="${id}"> has no code partner`);
      continue;
    }
    const open = slice(els[c].from, els[c].openTo);
    if (!holdsId(open, id)) out.push(`${where}: <${names[i]} id="${id}"> paired with ${open.slice(0, 60)}`);
  }
  return count;
}

export const __seePure = { foldedText, nthIndex, escapeRe, holdsId, crumbsOf, longDoc, lineUpProblems };

// DOM readers shared by the tests.

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function tools(h) {
  const { view, until, assert, doc, preview, E, $ } = h;
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const lines = () => [...view.contentDOM.querySelectorAll('.cm-line')];
  const lineAtY = (y) => lines().find((l) => {
    const r = l.getBoundingClientRect();
    return y >= r.top && y < r.bottom;
  }) || null;
  const marks = () => [...view.dom.querySelectorAll('.cm-foldGutter .fold-mark')].filter(shown);
  const markLine = (mark) => {
    const r = mark.getBoundingClientRect();
    const line = lineAtY((r.top + r.bottom) / 2);
    return line ? line.textContent : '';
  };
  const markOn = (start) => marks().find((m) => markLine(m).trim().startsWith(start)) || null;
  const pills = () => [...view.dom.querySelectorAll('.fold-pill')];
  const pillText = (pill) => pill.textContent.replace(/\s+/g, ' ').trim();
  const classed = (cls) => lines().filter((l) => l.classList.contains(cls)).map((l) => l.textContent);
  const cursorAt = (needle, k = 0) => {
    const at = doc().indexOf(needle);
    assert(at >= 0, `"${needle}" not in the doc`);
    view.dispatch({ selection: { anchor: at + k } });
    return at + k;
  };
  const cursorOnLine = (start) => {
    const n = doc().split('\n').findIndex((l) => l.startsWith(start));
    assert(n >= 0, `no line starts with "${start}"`);
    view.dispatch({ selection: { anchor: view.state.doc.line(n + 1).from + 1 } });
  };
  const sel = () => {
    const m = view.state.selection.main;
    return { from: m.from, to: m.to, text: view.state.sliceDoc(m.from, m.to) };
  };
  const pressed = (id) => $(id).getAttribute('aria-pressed');
  const inspect = async () => {
    const res = await preview.__probe(null, null);
    assert(res && res.inspect, 'the page sent no inspect');
    return res.inspect;
  };
  const crumbs = () => [...$('inside-line').querySelectorAll('.inside-crumb')].map((b) => b.textContent.trim());
  const inside = () => {
    const row = $('inside-line');
    const none = row.querySelector('.inside-none');
    if (none) return none.textContent.trim();
    const lead = row.querySelector('.inside-lead');
    return lead ? `${lead.textContent.trim()} ${crumbsOf(crumbs())}` : '';
  };
  const hint = () => $('page-hint').textContent;
  const codeFocused = () => view.contentDOM.contains(document.activeElement);
  const waitFor = async (read, ok, label, ms = 4000) => {
    let last;
    try {
      return await until(async () => {
        last = await read();
        return ok(last) ? last || true : false;
      }, label, ms);
    } catch (e) {
      throw new Error(`${label}: last seen ${JSON.stringify(last)}`);
    }
  };
  const restAt = (pos) => {
    const box = view.coordsAtPos(pos, 1);
    assert(box, `position ${pos} is not on screen`);
    const x = box.left + 1;
    const y = (box.top + box.bottom) / 2;
    const target = document.elementFromPoint(x, y);
    assert(target && view.contentDOM.contains(target), `the mouse at ${pos} is not on the code`);
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, view: window }));
  };
  // The mouse rests on the k-th character of needle (inside the word, not at its edge).
  // The code scrolls it on screen first, without moving the cursor.
  const restOn = async (needle, k = 2) => {
    const at = doc().indexOf(needle);
    assert(at >= 0, `"${needle}" not in the doc`);
    view.dispatch({ effects: E.EditorView.scrollIntoView(at + k, { y: 'center' }) });
    await frame();
    await frame();
    restAt(at + k);
  };
  // A move to the far end of the code closes a tooltip that is open.
  const away = () => {
    const r = view.contentDOM.getBoundingClientRect();
    const x = r.right - 4;
    const y = Math.min(r.bottom, view.scrollDOM.getBoundingClientRect().bottom) - 4;
    view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, view: window }));
  };
  const tip = (cls) => [...document.querySelectorAll(`.${cls}`)].find(shown) || null;
  return {
    shown, lines, marks, markLine, markOn, pills, pillText, classed, cursorAt, cursorOnLine, sel, pressed,
    inspect, crumbs, inside, hint, codeFocused, waitFor, restAt, restOn, away, tip,
  };
}

export async function seeTests(h) {
  const d = tools(h);
  await foldTests(h, d);
  await pairAndBandTests(h, d);
  await insideTests(h, d);
  await litTests(h, d);
  await pointTests(h, d);
  await outlineTests(h, d);
  await ruleTests(h, d);
  await explainTests(h, d);
  await pictureTests(h, d);
  await boxesTests(h, d);
  await lineUpTest(h);
}

// Fold

async function foldTests(h, d) {
  const { t, assert, eq, until, wait, openContent, view, E, runCommand, switchTo, tabNamed } = h;

  const foldOn = async (start) => {
    d.cursorOnLine(start);
    const before = d.pills().length;
    runCommand('fold');
    await until(() => d.pills().length > before, `a fold on "${start}"`);
  };

  await t('Fold: an arrow only where a part spans 2 or more lines', async () => {
    const project = await openContent('A', [
      ['a.html', PAGE('<div>\n<p>one</p>\n<p>two</p>\n</div>\n<p>short</p>\n')],
      ['style.css', 'h1 { color: red; }\n\np {\n  color: blue;\n}\n'],
    ]);
    // A tab's view is made hidden, so its heights settle a frame after it shows: wait for the lines.
    await d.waitFor(() => d.marks().map(d.markLine).join('|'), (v) => v === '<html>|<body>|<div>', 'lines with an arrow');
    for (const mark of d.marks()) eq(mark.title, 'Fold this part', 'arrow tooltip');
    assert(!d.marks().some((m) => m.classList.contains('folded')), 'an arrow shows folded with nothing folded');
    switchTo(tabNamed(project, 'style.css').path);
    await d.waitFor(() => d.marks().map(d.markLine).join('|'), (v) => v === 'p {', 'the CSS lines with an arrow');
  });

  await t('Fold: Fold This Part shows a pill with the folded line count, and a click on it unfolds', async () => {
    await openContent('A', [['a.html', PAGE('<div>\n<p>one</p>\n</div>\n<p>two</p>\n<p>three</p>\n')]]);
    await foldOn('<body>');
    const pill = d.pills()[0];
    await d.waitFor(() => d.pillText(pill), (v) => v === foldedText(5), 'the pill text');
    eq(pill.title, 'Unfold this part', 'pill tooltip');
    assert(!pill.classList.contains('oops'), 'the pill is Oops without a mistake');
    const line = pill.closest('.cm-line');
    assert(line && line.textContent.startsWith('<body>') && line.textContent.endsWith('</body>'), `the folded line reads ${line && line.textContent}`);
    const mark = await until(() => {
      const m = d.markOn('<body>');
      return m && m.classList.contains('folded') ? m : null;
    }, 'the arrow to show folded');
    eq(mark.title, 'Unfold this part', 'folded arrow tooltip');
    pill.click();
    await until(() => d.pills().length === 0, 'the pill to go');
    assert(d.lines().some((l) => l.textContent === '<p>three</p>'), 'the lines did not come back');
    await until(() => d.markOn('<body>') && !d.markOn('<body>').classList.contains('folded'), 'the arrow to show unfolded');
  });

  await t('Fold: one folded line says 1 line folded', async () => {
    await openContent('A', [['a.html', PAGE('<div>\n<p>one</p>\n</div>\n')]]);
    await foldOn('<div>');
    await d.waitFor(() => d.pillText(d.pills()[0]), (v) => v === foldedText(1), 'the pill text');
  });

  await t('Fold: Unfold This Part unfolds the part on the cursor line', async () => {
    await openContent('A', [['a.html', PAGE('<div>\n<p>one</p>\n<p>two</p>\n</div>\n')]]);
    await foldOn('<div>');
    d.cursorOnLine('<div>');
    runCommand('unfold');
    await until(() => d.pills().length === 0, 'the fold to go');
  });

  await t('Fold: Unfold Everything unfolds every part', async () => {
    await openContent('A', [['a.html', PAGE('<div>\n<p>one</p>\n</div>\n<section>\n<p>two</p>\n</section>\n')]]);
    await foldOn('<div>');
    await foldOn('<section>');
    eq(d.pills().length, 2, 'pills');
    runCommand('unfold-all');
    await until(() => d.pills().length === 0, 'every fold to go');
  });

  await t('Fold: a fold stays while the tab is open, across a tab switch', async () => {
    const project = await openContent('A', [
      ['a.html', PAGE('<div>\n<p>one</p>\n<p>two</p>\n</div>\n')],
      ['b.html', PAGE('<p>b</p>\n')],
    ]);
    await foldOn('<div>');
    switchTo(tabNamed(project, 'b.html').path);
    await until(() => d.pills().length === 0, 'b.html without the fold');
    switchTo(tabNamed(project, 'a.html').path);
    await d.waitFor(() => d.pills().map(d.pillText), (v) => v.length === 1 && v[0] === foldedText(2), 'the fold back in a.html');
  });

  await t('Fold: a mistake inside a folded part turns the pill Oops, and its click shows the mistake', async () => {
    await openContent('A', [['a.html', PAGE('<div>\n<h1>Hi\n<p>x</p>\n</div>\n<div>\n<p>fine</p>\n<p>also fine</p>\n</div>\n')]]);
    await foldOn('<div>');
    const lines = view.state.doc.toString().split('\n');
    const second = lines.indexOf('<div>', lines.indexOf('</div>'));
    view.dispatch({ selection: { anchor: view.state.doc.line(second + 1).from + 1 } });
    runCommand('fold');
    await until(() => d.pills().length === 2, 'the second fold');
    // The mistake hint waits 800 ms after the last change.
    await until(() => d.pills().some((p) => p.classList.contains('oops')), 'an Oops pill', 3000);
    const [oops, fine] = d.pills();
    assert(oops.classList.contains('oops') && !fine.classList.contains('oops'), 'Oops on the wrong pill');
    eq(oops.title, 'Something is wrong in here. Click to see it.', 'Oops tooltip');
    eq(d.pillText(oops), foldedText(2), 'Oops pill text');
    const use = oops.querySelector('use');
    assert(use && /oops/.test(use.getAttribute('href') || ''), 'the Oops pill has no oops icon');
    oops.click();
    await until(() => d.pills().length === 1, 'the Oops part to unfold');
    await until(() => [...view.dom.querySelectorAll('.hint-box')].some(d.shown), 'the mistake hint', 3000);
  });

  await t('Fold: Find unfolds a part that holds the match', async () => {
    await openContent('A', [['a.html', PAGE('<div>\n<p>A zebra here</p>\n<p>two</p>\n</div>\n')]]);
    await foldOn('<div>');
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
    E.runFind(h.S.ed.view, 'find');
    const bar = await until(() => view.dom.querySelector('.hl-find'), 'the Find bar');
    const field = bar.querySelector('input[name="search"]');
    field.value = 'zebra';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    bar.querySelector('button[name="next"]').click();
    await until(() => d.sel().text === 'zebra', 'zebra selected');
    await until(() => d.pills().length === 0, 'the fold to go');
    bar.querySelector('button[name="close"]').click();
    await wait(0);
  });

  await t('Fold: CSS rules and @media blocks fold inside their braces', async () => {
    const project = await openContent('A', [
      ['a.html', PAGE('<p>x</p>\n')],
      ['style.css', '@media (max-width: 500px) {\n  p {\n    color: red;\n  }\n}\n'],
    ]);
    switchTo(tabNamed(project, 'style.css').path);
    await d.waitFor(() => d.marks().length, (n) => n === 2, 'two CSS arrows');
    await foldOn('@media');
    const pill = d.pills()[0];
    await d.waitFor(() => d.pillText(pill), (v) => v === foldedText(3), 'the @media pill');
    const line = pill.closest('.cm-line').textContent;
    assert(line.startsWith('@media (max-width: 500px) {') && line.endsWith('}'), `the folded line reads ${line}`);
  });
}

// Tag pair and section band

async function pairAndBandTests(h, d) {
  const { t, assert, eq, until, openContent, view, switchTo, tabNamed } = h;
  const PAIR_DOC = PAGE('<h1>Hi</h1>\n<div>\n<p>x\n</div>\n');
  const matching = () => [...view.dom.querySelectorAll('.cm-matchingBracket')];
  const marked = (el) => {
    const s = getComputedStyle(el);
    return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' || s.boxShadow !== 'none' || s.outlineStyle !== 'none';
  };

  await t('Pair: the cursor on either tag name marks both names', async () => {
    await openContent('A', [['a.html', PAIR_DOC]]);
    view.focus();
    for (const [needle, k] of [['<h1>', 2], ['</h1>', 3]]) {
      d.cursorAt(needle, k);
      const marks = await d.waitFor(() => matching().map((m) => m.textContent), (v) => v.length === 2, `the pair from ${needle}`);
      eq(marks.join(), 'h1,h1', 'the marked names');
      // The colors may wait for the window focus, as CodeMirror's own theme does.
      if (view.dom.classList.contains('cm-focused')) assert(matching().every(marked), 'the pair has no color');
    }
  });

  await t('Pair: a tag with no partner gets no color, not red', async () => {
    await openContent('A', [['a.html', PAIR_DOC]]);
    view.focus();
    d.cursorAt('<h1>', 2);
    await until(() => matching().length === 2, 'the h1 pair first');
    d.cursorAt('<p>', 2);
    await until(() => matching().length === 0, 'no pair for p');
    for (const el of view.dom.querySelectorAll('.cm-nonmatchingBracket')) {
      const s = getComputedStyle(el);
      assert(s.color !== 'rgb(170, 34, 34)', 'the lone tag is red');
      assert(!marked(el), 'the lone tag has a color');
    }
  });

  await t('Band: the cursor on the tag name of a long element bands its lines', async () => {
    await openContent('A', [['a.html', PAGE('<h1>Hi</h1>\n<ul>\n<li>One</li>\n<li>Two</li>\n</ul>\n')]]);
    d.cursorAt('</ul>', 3);
    await d.waitFor(() => d.classed('cm-band'), (v) => v.join('|') === '<ul>|<li>One</li>|<li>Two</li>|</ul>', 'the band');
    eq(d.classed('cm-band-first').join(), '<ul>', 'first line');
    eq(d.classed('cm-band-last').join(), '</ul>', 'last line');
    d.cursorAt('<h1>', 2);
    await until(() => d.classed('cm-band').length === 0, 'no band for a one-line element');
    d.cursorAt('<ul>', 2);
    await until(() => d.classed('cm-band').length === 4, 'the band again');
    d.cursorAt('One', 1);
    await until(() => d.classed('cm-band').length === 0, 'no band in plain text');
  });

  await t('Band: the mouse on a fold arrow bands its part, and leaving takes it away', async () => {
    await openContent('A', [['a.html', PAGE('<div>\n<p>one</p>\n<p>two</p>\n</div>\n')]]);
    d.cursorAt('one', 1);
    const mark = await until(() => d.markOn('<div>'), 'the div arrow');
    const r = mark.getBoundingClientRect();
    const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    mark.dispatchEvent(new MouseEvent('mouseover', at));
    await d.waitFor(() => d.classed('cm-band'), (v) => v.join('|') === '<div>|<p>one</p>|<p>two</p>|</div>', 'the arrow band');
    mark.dispatchEvent(new MouseEvent('mouseout', { ...at, relatedTarget: view.contentDOM }));
    const gutter = mark.closest('.cm-foldGutter');
    gutter.dispatchEvent(new MouseEvent('mouseleave', { clientX: r.right + 40, clientY: at.clientY, relatedTarget: view.contentDOM, view: window }));
    await until(() => d.classed('cm-band').length === 0, 'the band to go after the mouse left');
  });

  await t('Band: the cursor in a CSS selector bands its rule, in a CSS tab and in <style>', async () => {
    const project = await openContent('A', [
      ['a.html', '<!doctype html>\n<html>\n<head>\n<style>\nh2 {\n  color: red;\n}\n</style>\n</head>\n<body>\n<h2>x</h2>\n</body>\n</html>\n'],
      ['style.css', 'h1 { color: red; }\n\n.card {\n  color: blue;\n}\n'],
    ]);
    d.cursorAt('h2 {', 1);
    await d.waitFor(() => d.classed('cm-band'), (v) => v.join('|') === 'h2 {|  color: red;|}', 'the <style> band');
    switchTo(tabNamed(project, 'style.css').path);
    d.cursorAt('.card', 2);
    await d.waitFor(() => d.classed('cm-band'), (v) => v.join('|') === '.card {|  color: blue;|}', 'the CSS band');
    eq(d.classed('cm-band-first').join(), '.card {', 'first line');
    d.cursorAt('h1', 1);
    await until(() => d.classed('cm-band').length === 0, 'no band for a one-line rule');
  });
}

// You are inside

async function insideTests(h, d) {
  const { t, assert, eq, until, openContent, view, flows, switchTo, tabNamed, $ } = h;
  const MAIN = PAGE('<main>\n<p>Hello <b>there</b></p>\n</main>\n');
  const shows = (want) => d.waitFor(d.inside, (v) => v === want, `"${want}"`);

  await t('Inside: the row names the written tags around the cursor', async () => {
    await openContent('A', [['a.html', MAIN]]);
    const row = $('inside-line');
    eq(row.previousElementSibling && row.previousElementSibling.id, 'editor-host', 'row above');
    eq(row.nextElementSibling && row.nextElementSibling.id, 'statusline', 'row below');
    eq(Math.round(row.getBoundingClientRect().height), 28, 'row height');
    d.cursorAt('Hello', 2);
    await shows('You are inside: html › body › main › p');
    eq(row.querySelectorAll('.inside-sep').length, 3, 'separators');
    assert([...row.querySelectorAll('.inside-sep')].every((s) => s.textContent.trim() === '›'), 'separator text');
    d.cursorAt('there', 2);
    await shows('You are inside: html › body › main › p › b');
    view.dispatch({ selection: { anchor: 0 } });
    await shows('You are not inside a tag here.');
  });

  await t('Inside: a page without <html> starts at what was written, and the row empties with no tab', async () => {
    await openContent('A', [['a.html', '<p>Some <em>very</em> nice words</p>\n']]);
    d.cursorAt('very', 2);
    await shows('You are inside: p › em');
    flows.__closeAllNow();
    await until(() => $('inside-line').childElementCount === 0, 'an empty row with no tab');
  });

  await t('Inside: in a <style> block the tag names come first', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<html>\n<head>\n<style>\nh1 {\n  color: red;\n}\n</style>\n</head>\n<body>\n<h1>Hi</h1>\n</body>\n</html>\n']]);
    d.cursorAt('color', 2);
    await shows('You are inside: html › head › style › h1');
  });

  await t('Inside: CSS shows the rule with its @media, and outside a rule says so', async () => {
    const long = '.a-very-long-selector-name .another-long-part > .and-one-more-part';
    const project = await openContent('A', [
      ['a.html', PAGE('<p>x</p>\n')],
      ['style.css', `@media (max-width: 500px) {\n  .card {\n    color: red;\n  }\n}\n\n.card {\n  color: blue;\n}\n\nh2,\nh3 {\n  color: green;\n}\n\n${long} {\n  color: gold;\n}\n`],
    ]);
    switchTo(tabNamed(project, 'style.css').path);
    d.cursorAt('color: red', 2);
    await shows('You are inside: @media › .card');
    d.cursorAt('color: blue', 2);
    await shows('You are inside: .card');
    d.cursorAt('}\n\n.card', 2);
    await shows('You are not inside a rule here.');
    d.cursorAt('color: green', 2);
    await shows('You are inside: h2, h3');
    d.cursorAt('color: gold', 2);
    const label = await d.waitFor(() => d.crumbs().join('|'), (v) => v.startsWith('.a-very-long'), 'the long selector');
    assert(label.endsWith('…') && label.length <= 41 && !label.includes('|'), `the long selector reads "${label}"`);
  });

  await t('Inside: a click on a name selects that whole element and puts the focus in the code', async () => {
    await openContent('A', [['a.html', MAIN]]);
    d.cursorAt('there', 2);
    await shows('You are inside: html › body › main › p › b');
    const crumb = [...$('inside-line').querySelectorAll('.inside-crumb')].find((b) => b.textContent.trim() === 'main');
    assert(crumb && crumb.tagName === 'BUTTON', 'main is not a button');
    crumb.click();
    const text = view.state.doc.toString();
    await d.waitFor(() => d.sel(), (s) => s.from === text.indexOf('<main>') && s.to === text.indexOf('</main>') + 7, 'main selected');
    await until(() => d.codeFocused(), 'the focus back in the code');
  });

  await t('Inside: too many names give way to … at the front', async () => {
    await openContent('A', [['a.html', `${'<section>'.repeat(40)}<b>deep</b>${'</section>'.repeat(40)}\n`]]);
    d.cursorAt('deep', 2);
    const row = $('inside-line');
    const more = await until(() => row.querySelector('.inside-crumbs .inside-more'), 'the … in front');
    eq(more.textContent.trim(), '…', 'the give-way mark');
    eq(row.querySelector('.inside-crumbs').firstElementChild, more, '… is not first');
    const names = d.crumbs();
    assert(names.length < 41 && names[names.length - 1] === 'b', `names: ${names.slice(-3).join()}`);
    const buttons = row.querySelectorAll('.inside-crumb');
    const last = buttons[buttons.length - 1].getBoundingClientRect();
    assert(last.right <= row.getBoundingClientRect().right + 1, 'the last name runs past the row');
  });
}

// The page lights the code

async function litTests(h, d) {
  const { t, assert, eq, until, wait, openContent, view, P, preview, switchTo, tabNamed } = h;
  const LIST = PAGE('<h1>Title</h1>\n<ul>\n<li>One</li>\n<li>Two</li>\n</ul>\n\n<p>End</p>\n');
  const hover = async (sel, index = 0) => {
    const res = await preview.__hover(sel, index);
    assert(res && res.found, `the page has no ${sel} #${index}`);
  };
  const litIs = (want, label) => d.waitFor(() => d.classed('cm-lit'), (v) => v.join('|') === want, label);

  await t('Lit: the mouse on the page lights that element in the code', async () => {
    await openContent('A', [['a.html', LIST]]);
    await hover('ul');
    await litIs('<ul>|<li>One</li>|<li>Two</li>|</ul>', 'the ul lines');
    eq(d.classed('cm-lit-first').join(), '<ul>', 'first line');
    eq(d.classed('cm-lit-last').join(), '</ul>', 'last line');
    eq([...view.dom.querySelectorAll('.cm-lit-tag')].map((m) => m.textContent).join(), 'ul,ul', 'lit tag names');
    await hover('li', 1);
    await litIs('<li>Two</li>', 'the second li');
    eq([...view.dom.querySelectorAll('.cm-lit-tag')].map((m) => m.textContent).join(), 'li,li', 'lit li names');
  });

  await t('Lit: out of step the code does not light, but the page still outlines', async () => {
    await openContent('A', [['a.html', LIST]]);
    await hover('li');
    await litIs('<li>One</li>', 'the li lit first');
    const at = view.state.doc.toString().indexOf('\n\n<p>End') + 1;
    view.dispatch({ changes: { from: at, insert: '<h2' }, selection: { anchor: at + 3 }, userEvent: 'input.type' });
    await until(() => P.hold, 'the unfinished tag to hold the page');
    await until(() => d.classed('cm-lit').length === 0, 'a change to clear the lit lines');
    await hover('ul');
    await wait(300);
    eq(d.classed('cm-lit').length, 0, 'lit lines out of step');
    const res = await preview.__probe(null, null);
    assert(res && res.inspect && res.inspect.hover !== null, 'the page does not outline the element');
  });

  await t('Lit: nothing lights while a CSS tab is active', async () => {
    const project = await openContent('A', [
      ['a.html', '<!doctype html>\n<html>\n<head>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>Hi</h1>\n<p>x</p>\n</body>\n</html>\n'],
      ['style.css', 'h1 {\n  color: red;\n}\n'],
    ]);
    await hover('h1');
    await litIs('<h1>Hi</h1>', 'h1 lit in the page tab');
    switchTo(tabNamed(project, 'style.css').path);
    await h.settle();
    await hover('h1');
    await wait(300);
    eq(view.dom.querySelectorAll('.cm-lit, .lit-chip').length, 0, 'lit in the CSS tab');
    switchTo(tabNamed(project, 'a.html').path);
    await wait(50);
    eq(d.classed('cm-lit').length, 0, 'lit in the page tab after the switch');
  });

  await t('Lit: an element the browser adds lights its nearest written parent', async () => {
    await openContent('A', [['a.html', PAGE('<table>\n<tr>\n<td>One</td>\n</tr>\n</table>\n')]]);
    await hover('tbody');
    await litIs('<table>|<tr>|<td>One</td>|</tr>|</table>', 'the table for its tbody');
    await hover('head');
    await d.waitFor(() => d.classed('cm-lit'), (v) => v[0] === '<html>' && v[v.length - 1] === '</html>', 'the html for its head');
  });

  await t('Lit: an opening tag below the code shows a Line chip, and its click selects the tag name', async () => {
    await openContent('A', [['long.html', longDoc(300)]]);
    view.dispatch({ selection: { anchor: 0 } });
    const top = view.scrollDOM.scrollTop;
    await hover('p', 249);
    const chip = await until(() => view.dom.querySelector('.lit-chip'), 'the chip');
    assert(chip.classList.contains('lit-chip-down'), 'the chip is not at the bottom');
    eq(chip.querySelector('.lit-chip-text').textContent.trim(), 'Line 253', 'chip text');
    eq(view.scrollDOM.scrollTop, top, 'the code scrolled by itself');
    chip.click();
    const from = view.state.doc.line(253).from;
    await d.waitFor(() => d.sel(), (s) => s.from === from + 1 && s.to === from + 2, 'the tag name of line 253');
    await until(() => !d.shown(view.dom.querySelector('.lit-chip')), 'the chip to go');
  });

  await t('Lit: an opening tag above the code shows the chip at the top', async () => {
    await openContent('A', [['long.html', longDoc(300)]]);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    await wait(50);
    await hover('p', 0);
    const chip = await until(() => view.dom.querySelector('.lit-chip'), 'the chip');
    assert(chip.classList.contains('lit-chip-up'), 'the chip is not at the top');
    eq(chip.querySelector('.lit-chip-text').textContent.trim(), 'Line 4', 'chip text');
  });
}

// Point

async function pointTests(h, d) {
  const { t, assert, eq, until, wait, openContent, view, preview, flows, runCommand, switchTo, tabNamed, activeTab, $ } = h;
  const LIST = PAGE('<h1>Title</h1>\n<ul>\n<li>One</li>\n<li>Two</li>\n</ul>\n');
  const pointOn = async () => {
    runCommand('point');
    await until(() => d.pressed('btn-point') === 'true', 'Point on');
  };
  const pointOff = (label) => until(() => d.pressed('btn-point') === 'false', label);

  await t('Point: the buttons say what they do, and wait for a page', async () => {
    flows.__closeAllNow();
    await until(() => $('btn-point').disabled && $('btn-boxes').disabled, 'disabled buttons with no page');
    eq($('btn-point').title, 'Point at your page to find its code', 'Point tooltip');
    eq($('btn-boxes').title, 'Show the boxes on your page', 'Boxes tooltip');
    eq(d.pressed('btn-point'), 'false', 'Point pressed');
    eq(d.pressed('btn-boxes'), 'false', 'Boxes pressed');
    await openContent('A', [['a.html', LIST]]);
    await until(() => !$('btn-point').disabled && !$('btn-boxes').disabled, 'enabled buttons with a page');
  });

  await t('Point: a pick selects the opening tag name, focuses the code and turns Point off', async () => {
    await openContent('A', [['a.html', LIST]]);
    await pointOn();
    eq((await d.inspect()).point, true, 'Point on in the page');
    const res = await preview.__pickAt('li', 1);
    assert(res && res.found && res.picked, 'the pick did not happen');
    const at = view.state.doc.toString().indexOf('<li>Two');
    await d.waitFor(() => d.sel(), (s) => s.from === at + 1 && s.to === at + 3, 'the second li name');
    await pointOff('Point off after the pick');
    eq((await d.inspect()).point, false, 'Point off in the page');
    await until(() => d.codeFocused(), 'the focus in the code');
  });

  await t('Point: a pick from a CSS tab switches to the page tab', async () => {
    const project = await openContent('A', [
      ['a.html', '<!doctype html>\n<html>\n<head>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>Hi</h1>\n</body>\n</html>\n'],
      ['style.css', 'h1 {\n  color: red;\n}\n'],
    ]);
    switchTo(tabNamed(project, 'style.css').path);
    await h.settle();
    await pointOn();
    const res = await preview.__pickAt('h1', 0);
    assert(res && res.picked, 'the pick did not happen');
    await until(() => activeTab() && activeTab().name === 'a.html', 'the page tab');
    const at = view.state.doc.toString().indexOf('<h1>');
    await d.waitFor(() => d.sel(), (s) => s.from === at + 1 && s.to === at + 3, 'the h1 name');
  });

  await t('Point: Esc in the app turns Point off', async () => {
    await openContent('A', [['a.html', LIST]]);
    await pointOn();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    await pointOff('Point off after Esc on the window');
    await pointOn();
    view.focus();
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    await pointOff('Point off after Esc in the code');
    eq((await d.inspect()).point, false, 'Point off in the page');
  });

  await t('Point: a second press, Help and another page load turn it off', async () => {
    await openContent('A', [['a.html', LIST]]);
    await pointOn();
    runCommand('point');
    await pointOff('Point off after a second press');
    await pointOn();
    runCommand('help');
    await pointOff('Point off when Help shows');
    runCommand('my-page');
    await h.settle();
    await pointOn();
    preview.load();
    await pointOff('Point off when the page loads again');
    await h.settle();
    await wait(0);
    eq((await d.inspect()).point, false, 'Point off in the new page');
  });
}

// The code outlines the page

async function outlineTests(h, d) {
  const { t, assert, eq, wait, settle, probe, openContent, typeAfter } = h;
  const markIs = (i, label, ms) => d.waitFor(d.inspect, (v) => v.mark === i && v.markShown, label, ms);

  await t('Outline: a cursor move outlines its element after 150 ms, gone after 2 s, and typing does not bring it back', async () => {
    await openContent('A', [['a.html', PAGE('<h1>Head</h1>\n<p>First</p>\n<p>Second</p>\n')]]);
    const names = (await probe(null, null, { names: true })).names;
    assert(Array.isArray(names), 'the probe sent no names');
    d.cursorAt('Second', 2);
    const moved = performance.now();
    await markIs(nthIndex(names, 'p', 1), 'the second p outlined', 1500);
    assert(performance.now() - moved >= 140, 'the outline came before the 150 ms wait');
    const seen = performance.now();
    await d.waitFor(d.inspect, (v) => !v.markShown, 'the outline to go', 3200);
    assert(performance.now() - seen >= 1500, 'the outline went before 2 s');
    await d.waitFor(d.inspect, (v) => !v.layer, 'the helper layer to leave the page', 1000);
    typeAfter('Second', '!');
    await wait(400);
    await settle();
    eq((await d.inspect()).markShown, false, 'typing outlined again');
    const fresh = (await probe(null, null, { names: true })).names;
    d.cursorAt('First', 2);
    await markIs(nthIndex(fresh, 'p', 0), 'the first p outlined', 1500);
  });

  await t('Morph: forms with a field named id change in place, with no stale copy', async () => {
    const form = (w) => `<form><input name="id" value="${w}"></form>`;
    await openContent('A', [['a.html', PAGE(`${form('one')}\n${form('two')}\n`)]]);
    typeAfter('value="one', '!');
    typeAfter('value="two', '!');
    await settle();
    const html = (await probe(null, null)).html || '';
    eq((html.match(/<form/g) || []).length, 2, 'forms on the page after the change');
  });

  // Off the Mac the page gets a <style data-hl-fonts> with the look-alike fonts.
  // Before 0.2.0 the first change morphed it away and its presence read as the page's own style.
  await t('Fonts: the look-alike fonts stay after a change, and do not count as the page\'s style', async () => {
    await openContent('A', [['a.html', PAGE('<p>Plain</p>\n')]]);
    const before = (await probe('style[data-hl-fonts]', null)).found;
    if (!/Macintosh/.test(navigator.userAgent)) assert(before, 'no fonts style off the Mac');
    typeAfter('Plain', '!');
    await settle();
    eq((await probe('style[data-hl-fonts]', null)).found, before, 'the fonts style after a change');
    assert(d.hint() !== 'The style is inside this page', 'a page without style says its style is inside');
  });

  await t('Outline: the page scrolls only when the element is out of view', async () => {
    await openContent('A', [['long.html', longDoc(300)]]);
    const names = (await probe(null, null, { names: true })).names;
    d.cursorAt('Line 1 of', 2);
    await markIs(nthIndex(names, 'p', 1), 'p 1 outlined', 1500);
    eq((await probe(null, null)).y, 0, 'the page scrolled for a seen element');
    d.cursorAt('Line 250 of', 2);
    await markIs(nthIndex(names, 'p', 250), 'p 250 outlined', 1500);
    await d.waitFor(async () => (await probe(null, null)).y, (y) => y > 1000, 'the page to scroll to p 250');
  });
}

// A CSS rule counts what it styles

async function ruleTests(h, d) {
  const { t, assert, eq, wait, openContent, view, switchTo, tabNamed } = h;
  const hintIs = (want) => d.waitFor(d.hint, (v) => v === want, `the hint "${want}"`);

  await t('Rule: the hint counts what the rule styles, and asks to finish a selector', async () => {
    const project = await openContent('A', [
      ['a.html', '<!doctype html>\n<html>\n<head>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>Title</h1>\n<p>One</p>\n<p>Two</p>\n<p>Three</p>\n</body>\n</html>\n'],
      ['style.css', 'p {\n  color: blue;\n}\n\nh1 {\n  color: red;\n}\n\nem {\n  color: green;\n}\n\np > {\n  color: gold;\n}\n'],
    ]);
    switchTo(tabNamed(project, 'style.css').path);
    await h.settle();
    // Start outside every rule: the switch itself counts the rule at the cursor, without outlines.
    d.cursorAt('}\n\nh1', 2);
    await hintIs('style.css changes how this page looks');
    d.cursorAt('color: blue', 2);
    await hintIs('This rule styles 3 things on this page');
    const seen = await d.inspect();
    assert(seen.ruleShown && seen.ruleCount === 3, `outlines ${seen.ruleShown}, count ${seen.ruleCount}`);
    d.cursorAt('color: red', 2);
    await hintIs('This rule styles 1 thing on this page');
    d.cursorAt('color: green', 2);
    await hintIs('This rule does not style anything on this page yet');
    d.cursorAt('color: gold', 2);
    await hintIs('Finish this rule to see what it styles.');
    d.cursorAt('}\n\nh1', 2);
    await hintIs('style.css changes how this page looks');
  });

  await t('Rule: after a page update the count is asked again, without outlines', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<html>\n<head>\n<style>\np {\n  color: blue;\n}\n</style>\n</head>\n<body>\n<p>One</p>\n<p>Two</p>\n</body>\n</html>\n']]);
    d.cursorAt('color: blue', 2);
    await hintIs('This rule styles 2 things on this page');
    await d.waitFor(d.inspect, (v) => !v.ruleShown, 'the rule outlines to go', 3200);
    const at = view.state.doc.toString().indexOf('</body>');
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert: '<p>Three</p>\n' }, userEvent: 'input.type' });
    eq(view.state.selection.main.head, head, 'the cursor moved');
    await hintIs('This rule styles 3 things on this page');
    await wait(100);
    eq((await d.inspect()).ruleShown, false, 'the update brought outlines');
  });

  await t('Rule: in a CSS tab, a selector finished again by typing is counted again', async () => {
    const project = await openContent('A', [
      ['a.html', '<!doctype html>\n<html>\n<head>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>One</h1>\n<h1>Two</h1>\n</body>\n</html>\n'],
      ['style.css', 'h1 {\n  color: red;\n}\n'],
    ]);
    switchTo(tabNamed(project, 'style.css').path);
    await h.settle();
    d.cursorAt('color: red', 2);
    await hintIs('This rule styles 2 things on this page');
    const at = view.state.doc.toString().indexOf(' {');
    view.dispatch({ changes: { from: at, insert: ',' }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
    await hintIs('Finish this rule to see what it styles.');
    view.dispatch({ changes: { from: at, to: at + 1 }, selection: { anchor: at }, userEvent: 'delete.backward' });
    await hintIs('This rule styles 2 things on this page');
  });
}

// Explanations on hover

async function explainTests(h, d) {
  const { t, assert, eq, until, wait, openContent, S, runCommand } = h;
  const TABLE = '<table style="margin: 4px; color: hotpink;">\n<tr><td>x</td></tr>\n</table>\n<p>A <zorp>made up</zorp> tag</p>\n';
  const tipShows = (label) => until(() => d.tip('explain-tip'), label, 3000);
  const tipGone = async () => {
    d.away();
    await until(() => !d.tip('explain-tip'), 'the tooltip to close', 2000);
  };
  const helpTitle = () => {
    const title = document.querySelector('#help-panel .help-view:not([hidden]) .topic-title');
    return title ? title.textContent : '';
  };

  await t('Explain: a tag name shows its row, and More in Help opens its topic', async () => {
    await openContent('A', [['a.html', TABLE]]);
    await d.restOn('<table', 2);
    const tip = await tipShows('the table tooltip');
    eq(tip.querySelector('.explain-code').textContent, '<table>', 'tooltip code');
    assert(tip.querySelector('.explain-means').textContent.trim().length > 0, 'the tooltip says nothing');
    const more = tip.querySelector('.explain-more');
    eq(more && more.textContent.trim(), 'More in Help', 'the button');
    more.click();
    await until(() => S.rightView === 'help', 'Help to show');
    await d.waitFor(helpTitle, (v) => v.includes('Tables'), 'the Tables topic');
    runCommand('my-page');
    await until(() => S.rightView === 'page', 'My page again');
  });

  await t('Explain: a CSS word and a color name in style="" show their rows, with a swatch', async () => {
    await openContent('A', [['a.html', TABLE]]);
    await d.restOn('margin', 2);
    const word = await tipShows('the margin tooltip');
    assert(word.querySelector('.explain-code').textContent.includes('margin'), 'margin row');
    assert(!word.querySelector('.explain-swatch'), 'a swatch on a CSS word');
    word.querySelector('.explain-more').click();
    // The same topic Help on This Word opens for margin.
    await d.waitFor(helpTitle, (v) => v.includes('Give things room'), 'the margin topic');
    runCommand('my-page');
    await tipGone();
    await d.restOn('hotpink', 2);
    const color = await tipShows('the hotpink tooltip');
    assert(color.querySelector('.explain-code').textContent.includes('hotpink'), 'hotpink row');
    const swatch = color.querySelector('.explain-head .explain-swatch');
    assert(swatch, 'no swatch');
    eq(getComputedStyle(swatch).backgroundColor, 'rgb(255, 105, 180)', 'swatch color');
  });

  await t('Explain: a word with no row shows no tooltip', async () => {
    await openContent('A', [['a.html', TABLE]]);
    await d.restOn('<p>', 1);
    await tipShows('the p tooltip first');
    await tipGone();
    await d.restOn('<zorp', 2);
    await wait(1000);
    assert(!d.tip('explain-tip') && !d.tip('picture-tip'), 'a tooltip for a made-up tag');
  });
}

// Picture preview

async function pictureTests(h, d) {
  const { t, assert, eq, until, wait, settle, openContent, sample, S, view, flows, switchTo, tabNamed } = h;
  const tipShows = (label) => until(() => d.tip('picture-tip'), label, 3000);
  const msgIs = (want) => d.waitFor(() => {
    const tip = d.tip('picture-tip');
    const msg = tip && tip.querySelector('.picture-msg');
    return msg ? msg.textContent.trim() : null;
  }, (v) => v === want, `the message "${want}"`, 3000);
  const loaded = async (label) => {
    const img = await until(() => {
      const tip = d.tip('picture-tip');
      const pic = tip && tip.querySelector('img.picture-img');
      return pic && pic.complete && pic.naturalWidth > 0 ? pic : null;
    }, label, 3000);
    const r = img.getBoundingClientRect();
    assert(r.width <= 160.5 && r.height <= 120.5, `the picture is ${r.width} x ${r.height}`);
  };

  await t('Picture: src and CSS url() show the picture, at most 160 by 120', async () => {
    const project = await sample('gallery');
    await d.restOn('sun.jpg', 2);
    await loaded('sun.jpg in the tooltip');
    switchTo(tabNamed(project, 'style.css').path);
    view.dispatch({ changes: { from: 0, insert: '.gallery {\n  background-image: url("tree.jpg");\n}\n\n' } });
    await settle();
    await d.restOn('tree.jpg', 2);
    await loaded('tree.jpg in the tooltip');
  });

  await t('Picture: a missing picture says to save first, then that it is not in the folder', async () => {
    const project = await openContent('A', [['a.html', '<!doctype html>\n<p>My cat</p>\n<img src="cat.png" alt="My cat sleeping">\n']]);
    await d.restOn('cat.png', 2);
    await tipShows('the cat.png tooltip');
    await msgIs('Save your project first. Then put cat.png in its folder.');
    d.away();
    await until(() => !d.tip('picture-tip'), 'the tooltip to close', 2000);
    await flows.__firstSaveTo(project, S.prefs.savePlace, `See pictures ${Date.now() % 100000}`);
    await settle();
    await d.restOn('cat.png', 3);
    await tipShows('the cat.png tooltip after the save');
    await msgIs('HTML Lab cannot find cat.png in this folder.');
  });

  await t('Picture: a picture on the internet is named, not fetched', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<img src="https://example.com/cat.png" alt="x">\n']]);
    await d.restOn('example.com', 2);
    await tipShows('the internet tooltip');
    await msgIs('This picture is on the internet.');
    eq(d.tip('picture-tip').querySelectorAll('img').length, 0, 'an img for an internet picture');
    await wait(0);
  });
}

// Show the Boxes

async function boxesTests(h, d) {
  const { t, eq, until, settle, openContent, typeAfter, view, preview, runCommand } = h;
  const BOXES = PAGE('<h1>Hi</h1>\n<p>One</p>\n<ul>\n<li>A</li>\n<li>B</li>\n</ul>\n');
  const boxesAre = (n, label) => d.waitFor(d.inspect, (v) => v.boxes === true && v.boxCount === n, label);
  const turnOff = async () => {
    if (d.pressed('btn-boxes') !== 'true') return;
    runCommand('boxes');
    await until(() => d.pressed('btn-boxes') === 'false', 'Boxes off');
  };

  await t('Boxes: Show the Boxes outlines every element in body, stays on across changes, and turns off', async () => {
    try {
      await openContent('A', [['a.html', BOXES]]);
      runCommand('boxes');
      await until(() => d.pressed('btn-boxes') === 'true', 'Boxes pressed');
      await boxesAre(5, 'five boxes');
      typeAfter('<h1>Hi', ' there');
      await settle();
      eq(d.pressed('btn-boxes'), 'true', 'Boxes after typing');
      await boxesAre(5, 'five boxes after typing');
      const at = view.state.doc.toString().indexOf('</body>');
      view.dispatch({ changes: { from: at, insert: '<p>Two</p>\n' }, userEvent: 'input.type' });
      await settle();
      await boxesAre(6, 'six boxes after a new paragraph');
      preview.load();
      await settle();
      await boxesAre(6, 'boxes after the page loads again');
      runCommand('boxes');
      await until(() => d.pressed('btn-boxes') === 'false', 'Boxes not pressed');
      await d.waitFor(d.inspect, (v) => v.boxes === false, 'boxes off in the page');
    } finally {
      await turnOff();
    }
  });

  // Teeth: without link.onAllClosed in preview.reset, the next page comes up with the boxes on.
  await t('Boxes: closing the last tab turns Show the Boxes off, and the next page has none', async () => {
    try {
      await openContent('A', [['a.html', BOXES]]);
      runCommand('boxes');
      await boxesAre(5, 'five boxes');
      // The same removal a close runs after its question; a new project's tab would ask first.
      h.flows.__closeAllNow();
      eq(h.S.tabs.length, 0, 'tabs left');
      eq(d.pressed('btn-boxes'), 'false', 'Boxes pressed with no tab');
      await openContent('B', [['b.html', BOXES]]);
      eq(d.pressed('btn-boxes'), 'false', 'Boxes pressed on the next page');
      eq((await d.inspect()).boxes, false, 'boxes in the next page');
    } finally {
      await turnOff();
    }
  });

  // Teeth: with every label put at its first spot (above, at the left), the
  // label of the second li sits on the first letter of the li above it.
  await t('Boxes: no label covers a letter, in a list and in the space sample', async () => {
    try {
      await openContent('A', [['a.html', BOXES]]);
      await turnOff();
      runCommand('boxes');
      await d.waitFor(d.inspect, (v) => v.boxes === true && v.boxCount === 5 && v.boxLabels > 0, 'the list boxes');
      eq((await d.inspect()).labelsOverText, 0, 'labels over text in the list');
      await turnOff();
      await h.sample('space-club');
      runCommand('boxes');
      await d.waitFor(d.inspect, (v) => v.boxes === true && v.boxLabels >= 8, 'the space sample boxes');
      eq((await d.inspect()).labelsOverText, 0, 'labels over text in the space sample');
    } finally {
      await turnOff();
    }
  });

  await t('Boxes: past 600 the header says it shows the first 600', async () => {
    try {
      await openContent('A', [['a.html', PAGE('<p>x</p>\n'.repeat(700))]]);
      runCommand('boxes');
      await d.waitFor(d.hint, (v) => v === 'Showing the first 600 boxes', 'the 600 hint');
      runCommand('boxes');
      await d.waitFor(d.hint, (v) => v !== 'Showing the first 600 boxes', 'the hint to change back');
    } finally {
      await turnOff();
    }
  });
}

// Line-up of page and code, over every sample and template page

async function lineUpTest(h) {
  const { t, assert, settle, probe, sample, view, S, E, P, flows, switchTo, activeTab } = h;

  const checkProject = async (project, where, strict, report) => {
    const pages = S.tabs.filter((x) => x.projectId === project.id && /\.html?$/i.test(x.name));
    assert(pages.length > 0, `${where}: no page tabs`);
    for (const tab of pages) {
      switchTo(tab.path);
      await settle();
      if (P.showing !== tab.path) {
        report.problems.push(`${where}/${tab.name}: the page panel shows ${P.showing}`);
        continue;
      }
      const res = await probe(null, null, { names: true });
      assert(Array.isArray(res.names), `${where}/${tab.name}: the probe sent no names`);
      const state = tab === activeTab() ? view.state : tab.state;
      const els = E.codeElements(state);
      if (!els) {
        report.problems.push(`${where}/${tab.name}: no code elements`);
        continue;
      }
      const al = E.alignPage(els, res.names);
      const slice = (from, to) => state.sliceDoc(from, to);
      const r = lineUpProblems(`${where}/${tab.name}`, res.names, res.ids, els, al, slice, strict);
      report.problems.push(...r.problems);
      report.ids += r.ids;
      report.pages += 1;
    }
  };

  await t('Line-up: every sample and template page pairs each element with an id with its code', async () => {
    const report = { problems: [], ids: 0, pages: 0 };
    for (const id of SAMPLE_IDS) {
      const project = await sample(id);
      await checkProject(project, id, true, report);
      flows.__closeAllNow();
    }
    const templates = (await invoke('samples')).filter((s) => s.group === 'template');
    assert(templates.length > 0, 'no templates');
    for (const tpl of templates) {
      const project = await sample(tpl.id);
      await checkProject(project, tpl.id, false, report);
      flows.__closeAllNow();
    }
    assert(!report.problems.length, `${report.problems.length} problems over ${report.pages} pages:\n${report.problems.slice(0, 20).join('\n')}`);
    assert(report.ids > 0, `checked ${report.pages} pages but no element with an id`);
  });
}
