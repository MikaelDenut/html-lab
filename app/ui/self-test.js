import { isMac, previewBase } from './platform.js';
const modKey = isMac ? { metaKey: true } : { ctrlKey: true };
import { invoke } from './api.js';
import { S, activeTab, activeProject, projectOf, tabByPath, tabsOf, pageTabOf, baseName } from './state.js';
import { switchTo } from './tabs.js';
import { cancelDialog, isDialogOpen } from './dialogs.js';
import { showHome, showTopic, showWord } from './help.js';
import { checkFiles, checkTopic, counted, resetCounted } from './engine-check.js';

export const MIN_TESTS = 85;
const MIN_TEMPLATES = 6;
const MIN_SAMPLES = 5 + MIN_TEMPLATES;
const MIN_TOPICS = 97;
const MIN_LESSONS = 53;
const MIN_ENGINE = { pages: 112, sheets: 11, snippets: 259 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (id) => document.getElementById(id);

const results = [];
let filter = null;
let lastCopied = null;

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function eq(a, b, message) {
  if (a !== b) throw new Error(`${message || 'expected equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
}

async function until(fn, message, ms = 4000) {
  const start = performance.now();
  while (performance.now() - start < ms) {
    const value = await fn();
    if (value) return value;
    await wait(5);
  }
  throw new Error(`timed out: ${message}`);
}

export async function run(ctx) {
  const { flows, preview, whenEditor, showRight, runCommand } = ctx;
  if (ctx.selfTest && ctx.selfTest !== 'all') filter = ctx.selfTest;
  await whenEditor();
  const E = S.E;
  const view = new Proxy({}, {
    get(_, key) {
      const real = S.ed.view;
      const value = real[key];
      return typeof value === 'function' ? value.bind(real) : value;
    },
  });
  const P = preview.state;

  const settle = () =>
    until(
      () => P.phase === 'live' && P.out === null && !P.pendingHtml && P.pendingCss.size === 0,
      `preview to settle (phase ${P.phase}, out ${P.out})`,
      6000,
    );
  const probe = async (sel, prop) => {
    await settle();
    const res = await preview.__probe(sel, prop);
    assert(res, `probe failed for ${sel}`);
    return res;
  };
  const doc = () => view.state.doc.toString();
  const typeAfter = (needle, text) => {
    const at = doc().indexOf(needle);
    assert(at >= 0, `"${needle}" not in the doc`);
    const from = at + needle.length;
    view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' });
  };
  const replace = (from, to) => {
    const at = doc().indexOf(from);
    assert(at >= 0, `"${from}" not in the doc`);
    view.dispatch({
      changes: { from: at, to: at + from.length, insert: to },
      selection: { anchor: at + to.length },
      userEvent: 'input.type',
    });
  };
  const setDoc = (text) => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input.type' });
  };
  const content = (name, files, id = 'test') => ({ id, name, files: files.map(([n, code]) => ({ name: n, code, hidden: false })) });
  const openContent = async (name, files, kind = 'new') => {
    const project = await flows.__openContent(content(name, files), kind);
    showRight('page');
    await settle();
    return project;
  };
  const sample = async (id) => {
    const c = await invoke('open_sample', { id });
    const project = await flows.__openContent(c, 'sample');
    showRight('page');
    await settle();
    return project;
  };
  const tabNamed = (project, name) => tabsOf(project).find((t) => t.name === name);

  flows.__closeAllNow();
  const parent = await invoke('test_temp_folder', { name: 'selftest' });
  S.prefs.savePlace = parent;
  let folderCount = 0;
  const freshFolder = () => `P${++folderCount}`;

  const disk = async (project, files) => {
    const name = freshFolder();
    const saved = await invoke('save_project', { parent, name, files: files.map(([n, text]) => ({ name: n, text })) });
    return saved;
  };
  const readDisk = async (path) => (await invoke('read_files', { paths: [path] }))[0].text;

  const dialogRoot = () => $('dialog-root');
  const waitDialog = (label) =>
    until(
      () => isDialogOpen() && (!label || dialogRoot().textContent.includes(label)),
      `dialog ${label || ''} to open`,
    );
  const click = (text) => {
    const buttons = [...dialogRoot().querySelectorAll('button')];
    const button = buttons.find((b) => b.textContent.trim().includes(text));
    assert(button, `no button "${text}" among: ${buttons.map((b) => b.textContent.trim()).join(' | ')}`);
    assert(!button.disabled, `button "${text}" is disabled`);
    button.click();
  };
  const setField = (selector, value) => {
    const field = dialogRoot().querySelector(selector);
    assert(field, `no field ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const dialogGone = () => until(() => !isDialogOpen(), 'dialog to close');

  const cleanup = async () => {
    if (isDialogOpen()) cancelDialog();
    await wait(0);
    flows.__closeAllNow();
    S.prefs.autosave = false;
    showRight('page');
    await wait(0);
  };

  async function t(name, fn) {
    if (filter && !name.includes(filter)) return;
    const start = performance.now();
    const errorsBefore = window.__htmllabErrors.length;
    try {
      await fn();
      results.push({ name, ok: true, ms: Math.round(performance.now() - start) });
    } catch (error) {
      results.push({ name, ok: false, error: String(error && error.message ? error.message : error) });
    }
    const errors = window.__htmllabErrors.slice(errorsBefore);
    if (errors.length) {
      const row = results[results.length - 1];
      row.ok = false;
      row.error = `${row.error ? `${row.error}; ` : ''}script error: ${errors[0].slice(0, 300)}`;
    }
    try {
      await cleanup();
    } catch (error) {
      results.push({ name: `${name} (cleanup)`, ok: false, error: String(error) });
    }
  }

  const SPACE = 'space-club';

  await t('three tabs open, colored by language', async () => {
    const project = await sample(SPACE);
    eq(tabsOf(project).length, 3, 'tabs');
    eq(document.querySelectorAll('#tab-list .tab').length, 3, 'tab elements');
    await until(() => view.dom.querySelector('.c-tag'), 'html colors');
    switchTo(tabNamed(project, 'style.css').path);
    await until(() => view.dom.querySelector('.c-prop'), 'css colors');
    await until(() => view.dom.querySelector('.cm-css-color-picker-wrapper'), 'color swatch');
  });

  await t('the divider moves a guide line, and the panels take the width on let go', async () => {
    await sample(SPACE);
    const left = $('left');
    const ghost = $('divider-ghost');
    const before = left.getBoundingClientRect().width;
    const line = $('divider').getBoundingClientRect();
    ctx.divider.start();
    assert(!ghost.hidden, 'guide line shows');
    ctx.divider.move(line.left + line.width / 2 - 80);
    eq(Math.round(left.getBoundingClientRect().width), Math.round(before), 'width while dragging');
    assert(ghost.style.transform.includes('-80'), `guide line moved: ${ghost.style.transform}`);
    ctx.divider.end();
    assert(ghost.hidden, 'guide line hides');
    eq(Math.round(left.getBoundingClientRect().width), Math.round(before - 80), 'width after');
    ctx.divider.start();
    ctx.divider.move(-5000);
    ctx.divider.end();
    eq(Math.round(left.getBoundingClientRect().width), 320, 'never narrower than 320');
    left.style.flex = '';
  });

  await t('only the active tab editor is drawn, at the top of its box', async () => {
    const project = await sample(SPACE);
    const host = $('editor-host');
    for (const tab of [...tabsOf(project), tabsOf(project)[0]]) {
      switchTo(tab.path);
      view.focus();
      await settle();
      const shown = [...host.children].filter((el) => getComputedStyle(el).visibility !== 'hidden');
      eq(shown.length, 1, `visible editors on ${tab.name}`);
      assert(shown[0] === view.dom.parentElement, `the visible editor is not the one of ${tab.name}`);
      eq(host.scrollTop, 0, 'editor box scroll');
      eq(Math.round(view.dom.getBoundingClientRect().top), Math.round(host.getBoundingClientRect().top), 'editor top');
    }
  });

  await t('Tab indents and Shift+Tab unindents by two spaces', async () => {
    await openContent('A', [['a.html', '<p>x</p>\n']]);
    view.dispatch({ selection: { anchor: 0 } });
    const key = (init) => E.runScopeHandlers(view, new KeyboardEvent('keydown', init), 'editor');
    assert(key({ key: 'Tab', keyCode: 9 }), 'Tab was not handled');
    assert(doc().startsWith('  <p>'), `after Tab: ${doc().slice(0, 8)}`);
    assert(key({ key: 'Tab', keyCode: 9, shiftKey: true }), 'Shift+Tab was not handled');
    assert(doc().startsWith('<p>'), `after Shift+Tab: ${doc().slice(0, 8)}`);
  });

  await t('Cmd+Shift+L is left for the menu, Cmd+/ comments', async () => {
    await openContent('A', [['a.html', '<p>x</p>\n']]);
    view.dispatch({ selection: { anchor: 3 } });
    const key = (init) => E.runScopeHandlers(view, new KeyboardEvent('keydown', init), 'editor');
    assert(!key({ key: 'L', code: 'KeyL', keyCode: 76, ...modKey, shiftKey: true }), 'Cmd+Shift+L was taken');
    assert(key({ key: '/', code: 'Slash', keyCode: 191, ...modKey }), 'Cmd+/ was not handled');
    assert(doc().includes('<!--'), 'no comment made');
  });

  await t('undo in one tab does not touch another', async () => {
    const project = await sample(SPACE);
    const a = tabNamed(project, 'my-page.html');
    const b = tabNamed(project, 'planets.html');
    switchTo(a.path);
    typeAfter('Space is very big', ' AAA');
    switchTo(b.path);
    typeAfter('Saturn is my favorite', ' BBB');
    E.undo(view);
    assert(!doc().includes('BBB'), 'B not undone');
    switchTo(a.path);
    assert(doc().includes('AAA'), 'A lost its text');
    E.undo(view);
    assert(!doc().includes('AAA'), 'A not undone');
  });

  await t('switching HTML tabs switches the preview by morph, no full load', async () => {
    const project = await sample(SPACE);
    const before = P.loadId;
    switchTo(tabNamed(project, 'planets.html').path);
    eq((await probe('h1')).text, 'My planets', 'second page');
    switchTo(tabNamed(project, 'my-page.html').path);
    eq((await probe('h1')).text, 'Welcome to space!', 'first page');
    eq(P.loadId, before, 'loadId moved');
  });

  await t('a CSS tab keeps the page, and unsaved CSS shows live', async () => {
    const project = await sample(SPACE);
    const page = pageTabOf(project);
    switchTo(tabNamed(project, 'style.css').path);
    await settle();
    eq(P.showing, page.path, 'preview stayed');
    replace('color: gold', 'color: red');
    eq((await probe('h1', 'color')).value, 'rgb(255, 0, 0)', 'live color');
    eq($('page-label').textContent, `Showing ${page.name}`, 'label');
    assert($('page-hint').textContent.includes('style.css changes how this page looks'), $('page-hint').textContent);
  });

  await t('typing updates the page without saving', async () => {
    await openContent('A', [['a.html', '<!doctype html><html><body><h1>Hi</h1></body></html>\n']]);
    typeAfter('<h1>Hi', ' there');
    eq((await probe('h1')).text, 'Hi there');
  });

  const longPage = () => {
    let body = '';
    for (let i = 0; i < 300; i++) body += `<p>Line ${i} of a long page about planets, stars and many other things that wrap around the panel when it is narrow.</p>\n`;
    return `<!doctype html>\n<html>\n<body>\n${body}</body>\n</html>\n`;
  };

  await t('scroll stays while typing, and returns per page', async () => {
    const project = await openContent('A', [['long.html', longPage()], ['b.html', '<!doctype html><p>short</p>\n']]);
    const long = tabNamed(project, 'long.html');
    switchTo(long.path);
    await settle();
    $('preview').contentWindow.postMessage({ t: 'scroll', y: 800 }, '*');
    await until(() => long.pageY >= 700, 'scroll report');
    const y = long.pageY;
    typeAfter('Line 0', ' X');
    const typed = await probe('p');
    eq(Math.round(typed.y), Math.round(y), 'scroll moved while typing');
    switchTo(tabNamed(project, 'b.html').path);
    await settle();
    switchTo(long.path);
    await settle();
    await until(async () => Math.round((await preview.__probe('p')).y) === Math.round(y), 'scroll to come back');
  });

  await t('typing <h2 above a paragraph does not make it vanish', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<html>\n<body>\n\n<p>Stay</p>\n</body>\n</html>\n']]);
    const at = doc().indexOf('<p>') - 1;
    view.dispatch({ selection: { anchor: at } });
    for (const ch of ['<', 'h', '2']) {
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: ch }, selection: { anchor: pos + 1 }, userEvent: 'input.type' });
      await wait(30);
      if (ch !== '<') assert(P.hold, `not holding after "${ch}"`);
    }
    const during = await preview.__probe('p');
    eq(during.text, 'Stay', 'paragraph vanished');
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: '>' }, selection: { anchor: pos + 1 }, userEvent: 'input.type' });
    assert(!P.hold, 'still holding after >');
    assert((await probe('h2')).found, 'h2 did not show');
  });

  await t('changing blue inside a style attribute updates on every key', async () => {
    await openContent('A', [['a.html', '<!doctype html><p style="color: blue;">x</p>\n']]);
    replace('blue', 'red');
    assert(!P.hold, 'held inside a finished tag');
    eq((await probe('p', 'color')).value, 'rgb(255, 0, 0)');
  });

  await t('3 < 4 in his text never holds', async () => {
    await openContent('A', [['a.html', '<!doctype html><p>3 </p>\n']]);
    typeAfter('<p>3 ', '< 4');
    assert(!P.hold, 'held on a math sign');
  });

  await t('a key during a full load is not lost', async () => {
    await openContent('A', [['a.html', '<!doctype html><h1>One</h1>\n']]);
    preview.load();
    replace('One', 'Two');
    eq((await probe('h1')).text, 'Two');
  });

  await t('CSS key, then a quick switch to an HTML tab ends with the latest style', async () => {
    const project = await sample(SPACE);
    switchTo(tabNamed(project, 'style.css').path);
    await settle();
    replace('color: gold', 'color: lime');
    switchTo(tabNamed(project, 'planets.html').path);
    eq((await probe('h1', 'color')).value, 'rgb(0, 255, 0)');
  });

  await t('switching back to a long wrapped page keeps the top line', async () => {
    const project = await openContent('A', [['long.html', longPage()], ['b.html', '<!doctype html><p>x</p>\n']]);
    const long = tabNamed(project, 'long.html');
    switchTo(long.path);
    await wait(50);
    view.dispatch({ effects: E.EditorView.scrollIntoView(view.state.doc.line(200).from, { y: 'start' }) });
    const topLine = () => view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
    await until(() => topLine() > 150, 'the scroll to line 200');
    const topBefore = view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
    switchTo(tabNamed(project, 'b.html').path);
    await wait(30);
    switchTo(long.path);
    await wait(80);
    const topAfter = view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop).from).number;
    assert(Math.abs(topAfter - topBefore) <= 1, `top line ${topBefore} came back as ${topAfter}`);
  });

  await t('window focus with nothing changed does not reload, also right after a Save', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    await until(() => activeProject().stamp, 'stamp');
    const before = P.loadId;
    await preview.onWindowFocused();
    eq(P.loadId, before, 'reloaded on focus');
    typeAfter('<p>x', 'y');
    await settle();
    await flows.saveFlow();
    await preview.onWindowFocused();
    eq(P.loadId, before, 'reloaded after a Save');
  });

  await t('a picture put in the folder shows when the window comes back', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><img id="i" src="new.svg">\n']]);
    await flows.__openList(saved.paths);
    await settle();
    await until(() => activeProject().stamp, 'stamp');
    eq((await probe('#i')).natural, 0, 'picture before');
    await wait(1100);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>';
    await invoke('test_write_bytes', { path: `${saved.folder}/new.svg`, bytes: [...new TextEncoder().encode(svg)] });
    const before = P.loadId;
    await preview.onWindowFocused();
    assert(P.loadId > before, 'no reload');
    await until(async () => (await preview.__probe('#i'))?.natural === 40, 'picture to show');
  });

  await t('click a link to a picture, then type in CSS: back to his page with the new style', async () => {
    const c = await invoke('open_sample', { id: 'gallery' });
    const project = await flows.__openContent(c, 'sample');
    await settle();
    preview.__nav(`${previewBase}__new/${project.id}/sun.jpg`);
    assert($('page-label').textContent.includes('sun.jpg'), $('page-label').textContent);
    eq(P.phase, 'none', 'phase after a picture');
    switchTo(tabNamed(project, 'style.css').path);
    replace('color: #0b6e69', 'color: red');
    eq((await probe('h1', 'color')).value, 'rgb(255, 0, 0)');
    eq(P.showing, pageTabOf(project).path, 'showing');
  });

  await t('type <h2 in one tab and switch: the new tab shows at once', async () => {
    const project = await openContent('A', [['a.html', '<!doctype html><p>A</p>\n'], ['b.html', '<!doctype html><p>B</p>\n']]);
    switchTo(tabNamed(project, 'a.html').path);
    await settle();
    view.dispatch({ changes: { from: 0, insert: '<h2' }, selection: { anchor: 3 }, userEvent: 'input.type' });
    assert(P.hold, 'expected a hold');
    switchTo(tabNamed(project, 'b.html').path);
    assert(!P.hold, 'hold stayed');
    eq((await probe('p')).text, 'B');
  });

  await t('linked CSS, relative picture and a second page work', async () => {
    const c = await invoke('open_sample', { id: 'gallery' });
    await flows.__openContent(c, 'sample');
    showRight('page');
    await settle();
    await until(async () => (await preview.__probe('img')).natural > 0, 'hidden picture served');
    eq((await probe('.gallery', 'display')).value, 'flex', 'linked CSS');
  });

  await t('a link to an open page switches to its tab, a page not open loads', async () => {
    const project = await sample(SPACE);
    const planets = tabNamed(project, 'planets.html');
    preview.__nav(`${previewBase}__new/${project.id}/planets.html`);
    eq(S.activePath, planets.path, 'tab did not follow');
    await settle();
    preview.__nav(`${previewBase}__new/${project.id}/nowhere.html`);
    eq((await probe('h1')).text, 'This page does not exist yet.', 'friendly page');
    assert($('page-label').textContent.includes('nowhere.html'), $('page-label').textContent);
    typeAfter('Saturn is my favorite', '!');
    eq((await probe('h1')).text, 'My planets', 'next key returns to his page');
    eq(P.showing, planets.path);
  });

  await t('a folder named Minun sivu ä works', async () => {
    const saved = await invoke('save_project', {
      parent,
      name: 'Minun sivu ä',
      files: [
        { name: 'a.html', text: '<!doctype html><link rel="stylesheet" href="style.css"><h1>Hei</h1>\n' },
        { name: 'style.css', text: 'h1 { color: red; }\n' },
      ],
    });
    await flows.__openList(saved.paths);
    showRight('page');
    await settle();
    await until(async () => (await preview.__probe('h1', 'color')).value === 'rgb(255, 0, 0)', 'style through the folder');
  });

  await t('Save writes the file, and the dot clears', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    typeAfter('<p>x', 'y');
    assert(document.querySelector('.tab.active .tab-dot, .tab.active .dot'), 'no dot on a changed tab');
    assert($('status-text').textContent === 'Not saved yet', $('status-text').textContent);
    await flows.saveFlow();
    assert((await readDisk(saved.paths[0])).includes('<p>xy'), 'disk not updated');
    assert(!document.querySelector('.tab.active .tab-dot, .tab.active .dot'), 'dot stayed');
    eq($('status-text').textContent, 'Saved');
    eq($('btn-save').querySelector('.label').textContent, 'Saved!');
  });

  await t('closing a changed tab warns, and Keep working keeps it', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    typeAfter('<p>x', 'y');
    const flow = flows.closeTabFlow();
    await waitDialog('Save a.html before closing?');
    click('Keep working');
    await flow;
    eq(S.tabs.length, 1, 'tab closed');
  });

  await t('closing the only tab of a project shows the other project', async () => {
    await openContent('One', [['a.html', '<!doctype html><h1>One</h1>\n']]);
    await openContent('Two', [['b.html', '<!doctype html><h1>Two</h1>\n']]);
    eq((await probe('h1')).text, 'Two');
    await flows.closeTabFlow();
    await dialogGone();
    eq(S.tabs.length, 1, 'tabs');
    eq((await probe('h1')).text, 'One', 'other project');
    assert($('page-empty').hidden, 'empty state showed');
  });

  await t('a tab of another project shows its page, and typing updates it', async () => {
    const one = await openContent('One', [['a.html', '<!doctype html><h1>One</h1>\n']]);
    await openContent('Two', [['b.html', '<!doctype html><h1>Two</h1>\n']]);
    switchTo(tabsOf(one)[0].path);
    eq((await probe('h1')).text, 'One');
    replace('One', 'Uno');
    eq((await probe('h1')).text, 'Uno');
  });

  await t('a binary file and a too big file each give a message and open nothing', async () => {
    const dir = `${parent}/bad-${freshFolder()}`;
    await invoke('test_make_folder', { path: dir });
    await invoke('test_write_bytes', { path: `${dir}/photo.html`, bytes: [0x3c, 0x70, 0x00, 0xff, 0xfe] });
    const flow = flows.openPaths([`${dir}/photo.html`]);
    await waitDialog('HTML Lab cannot read this file.');
    click('OK');
    await flow;
    eq(S.tabs.length, 0, 'tab opened');
    const dir2 = `${parent}/big-${freshFolder()}`;
    await invoke('test_make_folder', { path: dir2 });
    await invoke('test_write_big', { path: `${dir2}/big.html`, size: 5 * 1024 * 1024 + 10 });
    const flow2 = flows.openPaths([`${dir2}/big.html`]);
    await waitDialog('This file is too big for HTML Lab.');
    click('OK');
    await flow2;
    eq(S.tabs.length, 0, 'tab opened');
  });

  await t('smart text is off in the editor', async () => {
    await openContent('A', [['a.html', '<p>x</p>\n']]);
    eq(view.contentDOM.getAttribute('spellcheck'), 'false');
    eq(view.contentDOM.getAttribute('autocorrect'), 'off');
    eq(view.contentDOM.getAttribute('autocapitalize'), 'off');
  });

  await t('a script with while(true) cannot freeze the editor, and the note shows', async () => {
    await openContent('A', [['a.html', '<!doctype html><script>while(true){}</script><h1>Safe</h1>\n']]);
    assert($('page-hint').textContent.includes('Scripts do not run here'), $('page-hint').textContent);
    replace('Safe', 'Still safe');
    eq((await probe('h1')).text, 'Still safe');
    const inline = '<!doctype html><button onclick="while(true){}">x</button><a href="javascript:while(true){}">y</a>\n';
    setDoc(inline);
    await settle();
  });

  await t('an unclosed <style> or <!-- updates once fixed, with no reload', async () => {
    await openContent('A', [['a.html', '<!doctype html><h1>A</h1>\n']]);
    const before = P.loadId;
    setDoc('<!doctype html><style>h1 { color: red; }<h1>A</h1>\n');
    await settle();
    setDoc('<!doctype html><style>h1 { color: red; }</style><h1>A</h1>\n');
    eq((await probe('h1', 'color')).value, 'rgb(255, 0, 0)', 'style block');
    setDoc('<!doctype html><!-- open <h1>A</h1>\n');
    await settle();
    setDoc('<!doctype html><!-- closed --><h1>B</h1>\n');
    eq((await probe('h1')).text, 'B', 'comment');
    eq(P.loadId, before, 'reloaded');
  });

  await t('moving the folder away keeps the text and offers Save it somewhere new', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    typeAfter('<p>x', 'y');
    await invoke('test_move', { from: saved.folder, to: `${saved.folder}-moved` });
    const flow = flows.saveFlow();
    await waitDialog('HTML Lab cannot find your folder.');
    click('Save it somewhere new');
    await waitDialog('Save your project');
    assert(doc().includes('<p>xy'), 'text lost');
    setField('input[type="text"]', 'Rescued');
    await wait(60);
    click('Save my project');
    await flow;
    await dialogGone();
    eq(baseName(activeProject().folder), 'Rescued', 'new folder');
    assert((await readDisk(`${activeProject().folder}/a.html`)).includes('<p>xy'), 'not on disk');
  });

  await t('a file copied in after + made the same name is not overwritten', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    const flow = flows.addFileFlow();
    await waitDialog('Add a new file');
    setField('input[type="text"]', 'planets');
    await wait(60);
    click('Add this file');
    await flow;
    await invoke('test_write_bytes', { path: `${saved.folder}/planets.html`, bytes: [...new TextEncoder().encode('his own')] });
    const save = flows.saveFlow();
    await waitDialog('There is already a file called planets.html');
    click('Keep working');
    await save;
    eq(await readDisk(`${saved.folder}/planets.html`), 'his own', 'overwritten');
    assert(document.querySelector('.tab.active .tab-dot, .tab.active .dot'), 'dot cleared');
  });

  await t('Select All and Undo act on the field with the focus', async () => {
    await openContent('A', [['a.html', '<p>x</p>\n']]);
    showRight('help');
    await showHome();
    const search = await until(() => document.querySelector('#help-panel input'), 'help search');
    search.value = 'hello';
    search.focus();
    assert(document.activeElement === search, `the search field did not take the focus: ${document.activeElement && document.activeElement.tagName}`);
    E.runEdit(view, 'select-all');
    eq(search.selectionEnd - search.selectionStart, 5, 'selection in the field');
    eq(view.state.selection.main.empty, true, 'selected the code too');
  });

  await t('New shows both ways and five samples, each with a working page', async () => {
    const flow = flows.newFlow();
    await waitDialog('What do you want to make?');
    const text = dialogRoot().textContent;
    for (const word of ['Style inside the page', 'Style in a separate file', 'Space poster', 'Space club website', 'My hobby page', 'Pancake recipe', 'Photo gallery']) {
      assert(text.includes(word), `missing ${word}`);
    }
    click('Cancel');
    await flow;
    for (const id of ['space-poster', 'space-club', 'my-hobby', 'pancakes', 'gallery']) {
      const project = await sample(id);
      assert((await probe('h1')).found, `${id} has no h1`);
      eq(project.kind, 'sample');
      if (id === 'gallery') {
        await until(async () => (await preview.__probe('img')).natural > 0, 'gallery picture');
      }
      flows.__closeAllNow();
    }
  });

  await t('a template that needs CSS this Mac lacks stays out of the gallery (D11)', async () => {
    assert(flows.shownHere({ id: 'x' }), 'no needs: shown');
    assert(flows.shownHere({ needs: ['(display: grid)', 'selector(:hover)'] }), 'needs this Mac has: shown');
    assert(!flows.shownHere({ needs: ['(display: grid)', '(display: no-such-display)'] }), 'one missing need: hidden');
    assert(!flows.shownHere({ needs: ['not a condition ((('] }), 'a broken need: hidden');
  });

  await t('the template gallery: hover shows each preview fast, Back returns to New', async () => {
    const templates = (await invoke('samples')).filter((s) => s.group === 'template' && flows.shownHere(s));
    assert(templates.length >= MIN_TEMPLATES, `only ${templates.length} templates`);
    const flow = flows.newFlow();
    await waitDialog('What do you want to make?');
    click('Template gallery');
    const box = await until(() => dialogRoot().querySelector('.tpl-list') && dialogRoot(), 'the gallery view');
    if (box.querySelector('.tpl-chip[data-filter="all"]').getAttribute('aria-pressed') !== 'true') box.querySelector('.tpl-chip[data-filter="all"]').click();
    const rows = [...box.querySelectorAll('.tpl-row')];
    eq(rows.length, templates.length, 'gallery rows');
    const big = box.querySelector('.tpl-big');
    let slowest = 0;
    for (let i = templates.length - 1; i >= 0; i--) {
      rows[i].scrollIntoView({ block: 'nearest' });
      const thumb = rows[i].querySelector('.tpl-thumb');
      await until(() => thumb.complete && thumb.naturalWidth > 0, `small picture of ${templates[i].id}`);
      const t0 = performance.now();
      rows[i].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      eq($('tpl-name').textContent, templates[i].title, 'name under the preview');
      eq($('tpl-layout').textContent, templates[i].layout, 'layout under the preview');
      eq($('tpl-shows').children.length, templates[i].shows.length, 'what it shows');
      eq(rows[i].tabIndex, 0, 'the hovered row is the Tab stop');
      await until(() => big.dataset.index === String(i) && big.complete && big.naturalWidth > 0, `preview of ${templates[i].id}`);
      slowest = Math.max(slowest, performance.now() - t0);
    }
    eq(box.querySelectorAll('.tpl-row[tabindex="0"]').length, 1, 'one Tab stop in the list');
    assert(slowest < 400, `a preview took ${Math.round(slowest)} ms to show`);
    box.querySelector('.tpl-back').click();
    await until(() => document.activeElement && document.activeElement.classList.contains('row-templates'), 'New again, on the gallery row');
    click('Cancel');
    await flow;
  });

  await t('the template gallery filters by kind, and keeps the filter after Back', async () => {
    const templates = (await invoke('samples')).filter((s) => s.group === 'template' && flows.shownHere(s));
    const flow = flows.newFlow();
    await waitDialog('What do you want to make?');
    click('Template gallery');
    let box = await until(() => dialogRoot().querySelector('.tpl-list') && dialogRoot(), 'the gallery view');
    const chips = [...box.querySelectorAll('.tpl-chip')];
    eq(chips[0].dataset.filter, 'all', 'All comes first');
    eq(Number(chips[0].querySelector('.tpl-count').textContent), templates.length, 'All counts every template');
    for (const chip of chips) {
      chip.click();
      const filter = chip.dataset.filter;
      const want = templates.filter((t) => filter === 'all' || t.category === filter);
      const shown = [...box.querySelectorAll('.tpl-row')].filter((r) => !r.hidden && r.offsetParent);
      eq(shown.length, want.length, `${filter}: rows`);
      eq(Number(chip.querySelector('.tpl-count').textContent), want.length, `${filter}: count`);
      eq(shown.map((r) => templates[Number(r.dataset.index)].id).join(), want.map((t) => t.id).join(), `${filter}: which rows`);
      eq(box.querySelectorAll('.tpl-chip[aria-pressed="true"]').length, 1, `${filter}: one chip pressed`);
      eq(box.querySelectorAll('.tpl-cat:not([hidden])').length, filter === 'all' ? new Set(templates.map((t) => t.category)).size : 0, `${filter}: headings`);
      eq($('tpl-name').textContent, want[0].title, `${filter}: the first one shows`);
      eq(shown[0].tabIndex, 0, `${filter}: the first row is the Tab stop`);
    }
    const pick = chips.find((c) => c.dataset.filter !== 'all');
    pick.click();
    box.querySelector('.tpl-back').click();
    await until(() => document.activeElement && document.activeElement.classList.contains('row-templates'), 'New again');
    click('Template gallery');
    box = await until(() => dialogRoot().querySelector('.tpl-list') && dialogRoot(), 'the gallery again');
    eq(box.querySelector('.tpl-chip[aria-pressed="true"]').dataset.filter, pick.dataset.filter, 'the filter he picked');
    const first = [...box.querySelectorAll('.tpl-row')].find((r) => !r.hidden);
    eq(document.activeElement, first, 'focus on the first row of his filter');
    box.querySelector('.tpl-chip[data-filter="all"]').click();
    click('Cancel');
    await flow;
  });

  await t('every template opens, and all its pages, pictures and style load', async () => {
    const templates = (await invoke('samples')).filter((s) => s.group === 'template');
    assert(templates.length >= MIN_TEMPLATES, `the gallery holds ${templates.length} templates`);
    let pictures = 0;
    for (const tpl of templates) {
      const c = await invoke('open_sample', { id: tpl.id });
      const project = await sample(tpl.id);
      eq(project.kind, 'sample');
      eq(activeTab().name, 'index.html', `${tpl.id} opens on`);
      const css = c.files.find((f) => f.name === 'style.css').code;
      const prop = /:root\s*{[^}]*?(--[\w-]+)\s*:\s*([^;]+);/.exec(css);
      assert(prop, `${tpl.id}: no custom property in :root`);
      for (const page of c.files.filter((f) => f.name.endsWith('.html'))) {
        preview.__nav(`${previewBase}__new/${project.id}/${page.name}`);
        await settle();
        assert((await probe('[aria-current="page"]')).found, `${tpl.id}/${page.name}: menu does not mark the page`);
        const squash = (v) => String(v).trim().replace(/\s+/g, ' ');
        eq(squash((await probe('html', prop[1])).value), squash(prop[2]), `${tpl.id}/${page.name}: ${prop[1]}`);
        const sources = [...page.code.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^(https?:|data:)/.test(s));
        for (const src of new Set(sources)) {
          await until(async () => (await preview.__probe(`img[src="${src}"]`)).natural > 0, `${tpl.id}/${page.name}: ${src}`);
          pictures += 1;
        }
      }
      flows.__closeAllNow();
    }
    assert(pictures > 0, 'no template page has a picture to load, so no picture was checked');
  });

  const clickLink = async (sel, index = 0) => {
    await settle();
    const res = await preview.__click(sel, index);
    assert(res && res.found, `nothing to click: ${sel}`);
    await settle();
  };

  await t('every template works as a site: each page is a tab, its menu goes there and home again, and each page takes his typing', async () => {
    const templates = (await invoke('samples')).filter((s) => s.group === 'template');
    assert(templates.length >= MIN_TEMPLATES, `the gallery holds ${templates.length} templates`);
    for (const tpl of templates) {
      const c = await invoke('open_sample', { id: tpl.id });
      const project = await sample(tpl.id);
      const pages = c.files.filter((f) => f.name.endsWith('.html')).map((f) => f.name);
      eq(tabsOf(project).map((x) => x.name).join(' '), ['index.html', 'style.css', ...pages.slice(1)].join(' '), `${tpl.id}: every page is a tab`);
      for (const name of pages.slice(1)) {
        await clickLink(`a[href="${name}"]`);
        eq(activeTab().name, name, `${tpl.id}: the editor follows the link to ${name}`);
        eq(baseName(P.showing), name, `${tpl.id}: the page follows the link to ${name}`);
        assert((await probe(`a[aria-current="page"][href="${name}"]`)).found, `${tpl.id}/${name}: the menu marks the page`);
        const at = doc().indexOf('>', doc().indexOf('<h1')) + 1;
        view.dispatch({ changes: { from: at, insert: 'Zq ' }, selection: { anchor: at + 3 }, userEvent: 'input.type' });
        assert((await probe('h1')).text.includes('Zq'), `${tpl.id}/${name}: his typing shows`);
        await clickLink('a[href="index.html"]');
        eq(activeTab().name, 'index.html', `${tpl.id}: back home from ${name}`);
        eq(baseName(P.showing), 'index.html', `${tpl.id}: the home page shows again after ${name}`);
      }
      switchTo(tabNamed(project, 'style.css').path);
      await clickLink(`a[href="${pages[1]}"]`);
      eq(activeTab().name, 'style.css', `${tpl.id}: the style sheet stays open`);
      eq(baseName(P.showing), pages[1], `${tpl.id}: the page changed behind the style sheet`);
      await clickLink('a[href="index.html"]');
      eq(baseName(P.showing), 'index.html', `${tpl.id}: home again behind the style sheet`);
      flows.__closeAllNow();
    }
  });

  await t('a saved site opened by one page: a link opens the next page as a tab, and home again', async () => {
    const page = (title, other) =>
      `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title></head>\n<body><h1>${title}</h1><a href="${other}">Go</a></body>\n</html>\n`;
    const saved = await disk(null, [['index.html', page('Home', 'b.html')], ['b.html', page('Bee', 'index.html')]]);
    await flows.__openList([`${saved.folder}/index.html`]);
    showRight('page');
    await settle();
    eq(tabsOf(activeProject()).map((x) => x.name).join(' '), 'index.html', 'one tab first');
    await clickLink('a[href="b.html"]');
    await until(() => activeTab().name === 'b.html', 'the link opened b.html as a tab');
    eq((await probe('h1')).text, 'Bee', 'the new tab shows');
    await clickLink('a[href="index.html"]');
    eq(activeTab().name, 'index.html', 'home tab');
    eq((await probe('h1')).text, 'Home', 'home again');
    flows.__closeAllNow();
  });

  await t('a link to a place on another page opens that page and goes to the place', async () => {
    const tall = '<p>Far down.</p>\n'.repeat(120);
    const saved = await disk(null, [
      ['index.html', '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Home</title></head>\n<body><h1>Home</h1><a href="b.html#far">Go far</a></body>\n</html>\n'],
      ['b.html', `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Bee</title></head>\n<body><h1>Bee</h1>\n${tall}<h2 id="far">Here</h2>\n${tall}</body>\n</html>\n`],
    ]);
    await flows.__openList([`${saved.folder}/index.html`]);
    showRight('page');
    await clickLink('a[href="b.html#far"]');
    await until(() => activeTab().name === 'b.html', 'the link opened b.html');
    let where = null;
    await until(async () => {
      where = await preview.__click('#no-such-thing-here');
      return where && where.url.endsWith('#far');
    }, 'the page went to #far');
    eq((await probe('h1')).text, 'Bee', 'b.html shows');
    flows.__closeAllNow();
  });

  await t('every template can be changed and saved, and opens again from its folder with its pictures', async () => {
    const templates = (await invoke('samples')).filter((s) => s.group === 'template');
    assert(templates.length >= MIN_TEMPLATES, `the gallery holds ${templates.length} templates`);
    const squash = (v) => String(v).trim().replace(/\s+/g, ' ');
    let withMostPictures = null;
    for (const tpl of templates) {
      const c = await invoke('open_sample', { id: tpl.id });
      const project = await sample(tpl.id);
      switchTo(tabNamed(project, 'style.css').path);
      await settle();
      const name = /:root\s*{[^}]*?(--[\w-]+)\s*:/.exec(doc());
      assert(name, `${tpl.id}: no custom property in :root`);
      const decl = new RegExp(`${name[1]}\\s*:\\s*[^;]+;`).exec(doc())[0];
      replace(decl, `${name[1]}: #123456;`);
      await settle();
      switchTo(tabNamed(project, 'index.html').path);
      for (const page of c.files.filter((f) => f.name.endsWith('.html'))) {
        preview.__nav(`${previewBase}__new/${project.id}/${page.name}`);
        await settle();
        eq(squash((await probe('html', name[1])).value), '#123456', `${tpl.id}/${page.name}: the change shows`);
      }
      const folder = await flows.__firstSaveTo(project, parent, `${tpl.title} ${freshFolder()}`);
      const names = await invoke('test_list_folder', { path: folder });
      for (const f of c.files) assert(names.includes(f.name), `${tpl.id}: ${f.name} was not saved`);
      assert((await readDisk(`${folder}/style.css`)).includes(`${name[1]}: #123456;`), `${tpl.id}: the saved style has his change`);
      const pictures = c.files.filter((f) => f.picture);
      if (!withMostPictures || pictures.length > withMostPictures.pictures.length) withMostPictures = { tpl, folder, pictures, files: c.files };
      flows.__closeAllNow();
    }
    const { tpl, folder, files } = withMostPictures;
    await flows.__openList([`${folder}/index.html`]);
    await settle();
    eq(activeProject().folder, folder, `${tpl.id}: opened from its folder`);
    let fromDisk = 0;
    for (const page of files.filter((f) => f.name.endsWith('.html'))) {
      const sources = [...page.code.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((src) => !/^(https?:|data:)/.test(src));
      await flows.__openList([`${folder}/${page.name}`]);
      await settle();
      for (const src of new Set(sources)) {
        await until(async () => (await preview.__probe(`img[src="${src}"]`)).natural > 0, `${tpl.id}/${page.name}: ${src} from disk`);
        fromDisk += 1;
      }
    }
    assert(fromDisk > 0, `${tpl.id}: no picture was loaded from the saved folder`);
    flows.__closeAllNow();
  });

  await t('every template, sample and Help topic uses only CSS and HTML this WebKit understands', async () => {
    const problems = [];
    resetCounted();
    const samples = await invoke('samples');
    for (const s of samples) {
      if (!flows.shownHere(s)) continue;
      const c = await invoke('open_sample', { id: s.id });
      problems.push(...checkFiles(c.files.filter((f) => !f.picture), s.id));
    }
    const index = await invoke('help_index');
    for (const topic of index.topics) problems.push(...checkTopic(await invoke('help_topic', { id: topic.id })));
    assert(!problems.length, `${problems.length} problems:\n${problems.slice(0, 25).join('\n')}`);
    assert(samples.length >= MIN_SAMPLES, `checked ${samples.length} samples and templates, wanted at least ${MIN_SAMPLES}`);
    assert(index.topics.length >= MIN_TOPICS, `checked ${index.topics.length} Help topics, wanted at least ${MIN_TOPICS}`);
    for (const [what, least] of Object.entries(MIN_ENGINE)) {
      assert(counted[what] >= least, `checked ${counted[what]} ${what}, wanted at least ${least}`);
    }
    assert(!counted.unread.length, `${counted.unread.length} snippets this check cannot read:\n${counted.unread.slice(0, 10).join('\n')}`);
  });

  await t('New project cards work: one file, then two files', async () => {
    let flow = flows.newFlow();
    await waitDialog();
    click('Style inside the page');
    await flow;
    eq(S.tabs.length, 1, 'inline tabs');
    eq(activeProject().kind, 'new');
    assert(document.querySelector('.tab.active .tab-dot, .tab.active .dot'), 'new project has no dot');
    eq($('status-text').textContent, 'Not saved yet');
    flows.__closeAllNow();
    flow = flows.newFlow();
    await waitDialog();
    click('Style in a separate file');
    await flow;
    eq(S.tabs.length, 2, 'file tabs');
    await settle();
    eq((await probe('h1', 'color')).value, 'rgb(0, 128, 128)', 'linked style');
  });

  await t('editing style.css changes both pages', async () => {
    const project = await sample(SPACE);
    switchTo(tabNamed(project, 'style.css').path);
    await settle();
    replace('color: gold', 'color: red');
    await settle();
    switchTo(tabNamed(project, 'planets.html').path);
    eq((await probe('h1', 'color')).value, 'rgb(255, 0, 0)', 'planets');
    switchTo(tabNamed(project, 'my-page.html').path);
    eq((await probe('h1', 'color')).value, 'rgb(255, 0, 0)', 'my-page');
  });

  await t('+ adds a page and a CSS file, and the tick adds a working link', async () => {
    const project = await sample(SPACE);
    let flow = flows.addFileFlow();
    await waitDialog('Add a new file');
    setField('input[type="text"]', 'My Moon');
    await wait(60);
    assert(dialogRoot().textContent.includes('my-moon.html'), dialogRoot().textContent);
    click('Add this file');
    await flow;
    eq(activeTab().name, 'my-moon.html', 'new tab active');
    assert(doc().includes('<title>My moon</title>') || doc().includes('<title>My Moon</title>'), doc());
    eq((await probe('h1')).text.toLowerCase(), 'my moon', 'preview shows it');
    switchTo(tabNamed(project, 'my-page.html').path);
    await settle();
    flow = flows.addFileFlow();
    await waitDialog('Add a new file');
    const choice = [...dialogRoot().querySelectorAll('[data-kind]')].find((el) => el.dataset.kind !== 'html');
    choice.click();
    await wait(30);
    setField('input[type="text"]', 'extra');
    await wait(60);
    click('Add this file');
    await flow;
    eq(activeTab().name, 'extra.css', 'css tab');
    assert(tabNamed(project, 'my-page.html').state.doc.toString().includes('href="extra.css"'), 'link added');
    replace('color: teal', 'color: red');
    await settle();
    assert(P.lastLinks.includes('extra.css'), `links: ${P.lastLinks}`);
    const h1 = await probe('h1', 'color');
    eq(h1.value, 'rgb(255, 0, 0)', 'new CSS styles the page');
  });

  await t('a taken name is refused with a reason', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n'], ['on-disk.txt', 'x']]);
    await flows.__openList([saved.paths[0]]);
    await settle();
    const flow = flows.addFileFlow();
    await waitDialog('Add a new file');
    setField('input[type="text"]', 'a');
    await until(() => dialogRoot().textContent.includes('You already have a file called a.html.'), 'taken line');
    const button = [...dialogRoot().querySelectorAll('button')].find((b) => b.textContent.includes('Add this file'));
    assert(button.disabled, 'button stayed on');
    click('Cancel');
    await flow;
  });

  await t('first Save makes one folder with all files, and tabs stay', async () => {
    const c = await invoke('open_sample', { id: 'gallery' });
    const project = await flows.__openContent(c, 'sample');
    await settle();
    const cursorDoc = doc();
    const flow = flows.saveFlow();
    await waitDialog('Save your project');
    const name = `Gallery ${freshFolder()}`;
    setField('input[type="text"]', name);
    await wait(60);
    assert(dialogRoot().textContent.includes(name), 'folder line');
    assert(dialogRoot().textContent.includes('sun.jpg'), 'pictures in the list');
    click('Save my project');
    await flow;
    await dialogGone();
    const folder = project.folder;
    assert(folder && baseName(folder) === name, `folder ${folder}`);
    const list = await invoke('test_list_folder', { path: folder });
    for (const f of ['gallery.html', 'style.css', 'sun.jpg', 'tree.jpg', 'boat.jpg']) assert(list.includes(f), `${f} missing: ${list}`);
    eq(project.kind, 'saved');
    eq(doc(), cursorDoc, 'text');
    eq($('status-text').textContent, 'Saved');
    assert(activeTab().path.startsWith(folder), activeTab().path);
    await settle();
    await until(async () => (await preview.__probe('img')).natural > 0, 'picture from disk');
    assert((await preview.__probe('img')).url.includes(encodeURIComponent(baseName(folder))), 'url');
  });

  await t('later Saves write every changed file, without asking', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n'], ['style.css', 'p { color: red; }\n']]);
    await flows.__openList(saved.paths);
    await settle();
    const project = activeProject();
    typeAfter('<p>x', 'y');
    switchTo(tabNamed(project, 'style.css').path);
    typeAfter('color: red;', ' margin: 0;');
    await flows.saveFlow();
    assert(!isDialogOpen(), 'asked');
    assert((await readDisk(saved.paths[0])).includes('<p>xy'), 'first file');
    assert((await readDisk(saved.paths[1])).includes('margin: 0'), 'second file');
  });

  await t('Save where a folder of that name exists asks for another name', async () => {
    await invoke('test_make_folder', { path: `${parent}/Taken` });
    await invoke('test_write_bytes', { path: `${parent}/Taken/keep.txt`, bytes: [97] });
    await openContent('A', [['a.html', '<p>x</p>\n']]);
    const flow = flows.saveFlow();
    await waitDialog('Save your project');
    setField('input[type="text"]', 'Taken');
    await wait(60);
    click('Save my project');
    await until(() => dialogRoot().textContent.includes('You already have a folder called Taken here. Pick another name.'), 'error line');
    const list = await invoke('test_list_folder', { path: `${parent}/Taken` });
    eq(list.join(','), 'keep.txt', 'folder changed');
    click('Cancel');
    await flow;
    eq(activeProject().kind, 'new', 'kind');
  });

  await t('Open asks about a project folder, and both answers work', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>a</p>\n'], ['b.html', '<!doctype html><p>b</p>\n'], ['style.css', 'p{}\n'], ['pic.png', 'x']]);
    let flow = flows.openPaths([saved.paths[1]]);
    await waitDialog('Open all the files in this folder?');
    assert(dialogRoot().textContent.includes('You picked this'), 'tag');
    click('Just this file');
    await flow;
    eq(S.tabs.length, 1, 'one tab');
    eq(activeTab().name, 'b.html');
    flows.__closeAllNow();
    flow = flows.openPaths([saved.paths[1]]);
    await waitDialog('Open all the files in this folder?');
    click('Open all 3 files');
    await flow;
    eq(S.tabs.map((t) => t.name).join(','), 'b.html,a.html,style.css', 'order');
    eq(activeTab().name, 'b.html', 'picked file active');
    eq(activeProject().kind, 'saved');
  });

  await t('an open file jumps to its tab with no question', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>a</p>\n'], ['b.html', '<!doctype html><p>b</p>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    switchTo(saved.paths[1]);
    await flows.openPaths([saved.paths[0]]);
    assert(!isDialogOpen(), 'asked');
    eq(activeTab().path, saved.paths[0]);
    eq(S.tabs.length, 2);
  });

  await t('a folder with other kinds asks nothing, and offers linked CSS (E6)', async () => {
    const saved = await disk(null, [
      ['a.html', '<!doctype html><link rel="stylesheet" href="style.css"><p>a</p>\n'],
      ['style.css', 'p { color: red; }\n'],
      ['notes.txt', 'x'],
    ]);
    let flow = flows.openPaths([saved.paths[0]]);
    await waitDialog('Open style.css too?');
    click('Just this page');
    await flow;
    eq(S.tabs.length, 1, 'just the page');
    await settle();
    eq((await probe('p', 'color')).value, 'rgb(255, 0, 0)', 'linked CSS still shows');
    flows.__closeAllNow();
    flow = flows.openPaths([saved.paths[0]]);
    await waitDialog('Open style.css too?');
    click('Open style.css too');
    await flow;
    eq(S.tabs.length, 2, 'both');
  });

  await t('a page that links a missing style file still shows at once', async () => {
    const lost = P.lostLoads;
    const start = performance.now();
    await openContent('Missing', [['m.html', '<!doctype html><link rel="stylesheet" href="nope.css"><p>here</p>\n']]);
    eq((await probe('p')).text, 'here');
    eq(P.lostLoads, lost, 'no retry');
    const ms = Math.round(performance.now() - start);
    assert(ms < 1500, `took ${ms} ms`);
  });

  await t('editing and saving a sample leaves the one in the app unchanged', async () => {
    const before = (await invoke('open_sample', { id: 'space-poster' })).files[0].code;
    const project = await sample('space-poster');
    typeAfter('Welcome to space', ' CHANGED');
    await flows.__firstSaveTo(project, parent, freshFolder());
    eq((await invoke('open_sample', { id: 'space-poster' })).files[0].code, before);
  });

  await t('Save on an untouched sample opens the dialog', async () => {
    await sample(SPACE);
    await until(() => $('btn-save').querySelector('.label').textContent === 'Save', 'an earlier Saved! to end');
    const flow = flows.saveFlow();
    await waitDialog('Save your project');
    assert($('btn-save').querySelector('.label').textContent !== 'Saved!', 'said Saved!');
    click('Cancel');
    await flow;
  });

  await t('closing untouched style.css in an unsaved project asks, Keep it keeps it', async () => {
    const project = await sample(SPACE);
    switchTo(tabNamed(project, 'style.css').path);
    const flow = flows.closeTabFlow();
    await waitDialog('Take style.css out of your project?');
    click('Keep it');
    await flow;
    eq(tabsOf(project).length, 3);
  });

  await t('+ CSS with the tick in a saved project styles the page at once', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html>\n<html>\n<head>\n</head>\n<body><h1>x</h1></body>\n</html>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    const flow = flows.addFileFlow();
    await waitDialog('Add a new file');
    const choice = [...dialogRoot().querySelectorAll('[data-kind]')].find((el) => el.dataset.kind !== 'html');
    choice.click();
    await wait(30);
    setField('input[type="text"]', 'look');
    await wait(60);
    click('Add this file');
    await flow;
    eq(activeTab().savedDoc, null, 'not on disk yet');
    replace('color: teal', 'color: red');
    eq((await probe('h1', 'color')).value, 'rgb(255, 0, 0)');
    await flows.saveFlow();
    assert((await readDisk(`${saved.folder}/look.css`)).includes('color: red'), 'on disk');
  });

  await t('Help: switch keeps the page alive behind it', async () => {
    await sample(SPACE);
    const before = P.loadId;
    showRight('help');
    assert(!$('help-panel').hidden, 'help hidden');
    assert($('page-panel').classList.contains('behind'), 'page not behind');
    typeAfter('Space is very big', ' X');
    await wait(30);
    eq(P.out, null, 'sent while Help shows');
    showRight('page');
    assert((await probe('p')).text.includes(' X'), 'update lost');
    eq(P.loadId, before, 'reloaded');
  });

  const index = await invoke('help_index');

  await t('every lesson opens with a Try it that loads a working page', async () => {
    const lessons = index.topics.filter((x) => x.kind === 'lesson');
    assert(lessons.length >= MIN_LESSONS, `only ${lessons.length} lessons`);
    for (const topic of lessons) {
      await flows.tryIt(topic.id);
      await settle();
      const tab = activeTab();
      assert(tab, `${topic.id}: no tab`);
      eq(tab.topicId, topic.id, `${topic.id}: topic`);
      const page = pageTabOf(projectOf(tab));
      assert(page, `${topic.id}: no page`);
      assert((await probe('body')).found, `${topic.id}: page did not load`);
      assert(!$('practice-bar').hidden, `${topic.id}: no practice bar`);
      flows.__closeAllNow();
    }
  });

  await t('every topic renders its screen', async () => {
    showRight('help');
    assert(index.topics.length >= MIN_TOPICS, `only ${index.topics.length} Help topics`);
    for (const topic of index.topics) {
      await showTopic(topic.id);
      const panel = $('help-panel');
      assert(panel.textContent.includes(topic.title), `${topic.id}: title not shown`);
      if (topic.kind === 'lesson') {
        assert(panel.querySelector('iframe'), `${topic.id}: no result`);
        assert(panel.querySelector('.c-tag, .c-prop, .c-text'), `${topic.id}: code not colored`);
      }
      if (topic.kind === 'lesson' || topic.kind === 'recipe') {
        const shown = panel.querySelector('.help-view:not([hidden])');
        assert(shown.querySelectorAll('.code-block').length > 0, `${topic.id}: no code block shows`);
        assert(shown.querySelectorAll('.copy-btn').length === shown.querySelectorAll('.code-block').length, `${topic.id}: a code block has no Copy`);
      }
    }
  });

  await t('recipes: the group has sections, and a recipe says where and copies', async () => {
    runCommand('help-recipes');
    await until(() => document.querySelector('.help-subhead'), 'section headings');
    eq(document.querySelectorAll('.help-subhead').length, 8, 'sections');
    eq(index.topics.filter((x) => x.kind === 'recipe').length, 38, 'recipes');
    await showTopic('want-red-text');
    const shown = () => document.querySelector('#help-panel .help-view:not([hidden])');
    await until(() => shown().textContent.includes('Make my text red'), 'the recipe');
    const text = shown().textContent;
    for (const part of ['Inline style: just one tag', 'Style block: all paragraphs on this page', 'Style file: all paragraphs on all your pages', 'just before </head>', 'style.css', 'What you see']) {
      assert(text.includes(part), `missing ${part}`);
    }
    const buttons = [...shown().querySelectorAll('.copy-btn')];
    eq(buttons.length, 5, 'copy buttons');
    const blocks = [...shown().querySelectorAll('.code-block')];
    const last = buttons.length - 2;
    buttons[last].click();
    await until(() => buttons[last].textContent.includes('Copied!'), 'Copied!');
    lastCopied = 'p {\n  color: red;\n}';
    eq(blocks[last].textContent, lastCopied, 'what the box shows');
    await until(() => buttons[last].textContent.includes('Copy') && !buttons[last].textContent.includes('Copied'), 'label back', 2500);
  });

  await t('a recipe has a lesson to learn from, and search shows recipes first', async () => {
    showRight('help');
    await showTopic('want-red-text');
    const learn = () => [...document.querySelectorAll('#help-panel .help-view:not([hidden]) .topic-foot button')].find((b) => b.textContent.includes('Learn how it works'));
    await until(learn, 'the Learn button');
    learn().click();
    await until(() => $('help-panel').querySelector('.help-view:not([hidden])').textContent.includes('Colors'), 'the lesson');
    await showHome();
    const search = await until(() => document.querySelector('#help-panel input'), 'search');
    search.value = 'red';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(30);
    const first = document.querySelector('#help-panel .help-row.result:not([hidden]) .help-row-title');
    eq(first.textContent, 'Make my text red', 'first hit');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await t('E2: a goes to Links, and a recipe word opens the recipe', async () => {
    showRight('help');
    const title = () => document.querySelector('#help-panel .help-view:not([hidden]) .topic-title');
    await showWord('a');
    await until(() => title() && title().textContent.includes('Links'), 'Links');
    await showWord('hotpink');
    await showWord('highlight');
    await until(() => title() && title().textContent === 'Put color behind my text', 'the recipe');
    await showHome();
  });

  await t('new pages and samples say charset, and no hint comes from it', async () => {
    const META = '<meta charset="utf-8">';
    const flow = flows.newFlow();
    await waitDialog();
    click('Style inside the page');
    await flow;
    assert(doc().includes(META), 'starter');
    await wait(1000);
    assert(!view.dom.querySelector('.hint-box'), 'hint on a starter');
    flows.__closeAllNow();
    for (const id of ['space-poster', 'space-club', 'my-hobby', 'pancakes', 'gallery']) {
      const c = await invoke('open_sample', { id });
      for (const f of c.files) {
        if (f.name.endsWith('.html')) assert(f.code.includes(META), `${id}/${f.name}`);
      }
    }
    await sample(SPACE);
    const flow2 = flows.addFileFlow();
    await waitDialog('Add a new file');
    setField('input[type="text"]', 'moon');
    await wait(60);
    click('Add this file');
    await flow2;
    assert(doc().includes(META), 'new page from +');
    const bones = await invoke('help_topic', { id: 'bones' });
    assert(bones.code[0].text.includes(META) && bones.legend.some((l) => l.word === META), 'Bones lesson');
  });

  await t('Try it twice jumps to the copy, with his changes', async () => {
    const id = index.topics.find((x) => x.title.startsWith('Inline style')).id;
    await flows.tryIt(id);
    await settle();
    assert($('page-label').textContent === 'Showing the practice page', $('page-label').textContent);
    assert($('tab-list').textContent.includes('Practice'), 'tab label');
    eq($('page-hint').textContent, 'This is a practice copy');
    assert($('practice-text').textContent.includes('Your turn:'), $('practice-text').textContent);
    replace('blue;', 'orange;');
    await flows.tryIt(id);
    eq(S.tabs.length, 1, 'second copy');
    assert(doc().includes('orange'), 'changes lost');
    assert(S.prefs.tried.includes(id), 'not marked as tried');
  });

  await t('Style file example: three tabs, and saving keeps the link working', async () => {
    const id = index.topics.find((x) => x.title.startsWith('Style file')).id;
    await flows.tryIt(id);
    await settle();
    const project = activeProject();
    eq(tabsOf(project).length, 3, 'tabs');
    await flows.__firstSaveTo(project, parent, freshFolder());
    await settle();
    eq((await probe('h1', 'color')).value, 'rgb(128, 0, 128)', 'link after save');
    assert(!$('practice-bar').hidden, 'bar stays after saving');
  });

  await t('Add to my code: at the cursor, undoable, off with a reason', async () => {
    eq(flows.canAdd('html').reason, 'Open a page first.', 'no tab');
    const project = await sample(SPACE);
    assert(flows.canAdd('html').ok, 'html in an html tab');
    eq(flows.canAdd('css').reason, 'Open a CSS file first.');
    switchTo(tabNamed(project, 'style.css').path);
    eq(flows.canAdd('html').reason, 'Open an HTML page first.');
    switchTo(tabNamed(project, 'my-page.html').path);
    const start = doc();
    const at = doc().indexOf('<h1>');
    view.dispatch({ selection: { anchor: at } });
    flows.addToCode({ lang: 'html', text: '<p>one</p>\n<p>two</p>' });
    assert(doc().includes('<p>one</p>\n    <p>two</p>'), 'indent');
    E.undo(view);
    eq(doc(), start, 'undo');
  });

  await t('Add to my code with the caret still at the start goes where the tag belongs', async () => {
    const place = flows.placeForBlock;
    const zero = { from: 0, to: 0 };
    const page = '<!doctype html>\n<html>\n  <head>\n    <title>A</title>\n  </head>\n  <body>\n    <h1>Hi</h1>\n  </body>\n</html>\n';
    let p = place(page, zero, '<title>My page</title>', 'html');
    eq(page.slice(0, p.at) + p.insert + page.slice(p.at), page.replace('  </head>', '    <title>My page</title>\n  </head>'), 'title before </head>');
    p = place(page, zero, '<p>one</p>\n<p>two</p>', 'html');
    eq(page.slice(0, p.at) + p.insert + page.slice(p.at), page.replace('  </body>', '    <p>one</p>\n    <p>two</p>\n  </body>'), 'p before </body>');
    const noHead = '<!doctype html>\n<html>\n  <body>\n    <h1>Hi</h1>\n  </body>\n</html>\n';
    p = place(noHead, zero, '<title>My page</title>', 'html');
    eq(noHead.slice(0, p.at) + p.insert + noHead.slice(p.at), noHead.replace('<html>\n', '<html>\n  <title>My page</title>\n'), 'title after <html> with no head');
    p = place('h1 {\n  color: red;\n}\n', zero, 'p {\n  color: blue;\n}', 'css');
    eq(p.insert, '\np {\n  color: blue;\n}\n', 'css at the end after a blank line');
    eq(place(page, { from: 5, to: 5 }, '<p>x</p>', 'html'), null, 'a placed caret wins');
    eq(place('<p>x</p>', zero, '<p>y</p>', 'html'), null, 'a fragment: at the caret');
  });

  await t('search finds inline and margin, and shows the empty text for xyz', async () => {
    showRight('help');
    await showHome();
    const search = await until(() => document.querySelector('#help-panel input'), 'search');
    const type = async (value) => {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(30);
      const shown = [...$('help-panel').querySelectorAll('.help-result-line, .help-row.result:not([hidden]), .help-nothing:not([hidden])')];
      return shown.map((el) => el.textContent).join(' ').replace(/\s+/g, ' ');
    };
    const inline = await type('inline');
    assert(inline.includes('Inline style'), `inline: ${inline.slice(0, 300)}`);
    assert((await type('MARGIN')).includes('The box'), 'margin');
    const none = await type('xyz');
    assert(none.includes('No topics found for "xyz"'), none.slice(0, 200));
    assert(none.includes('Try a word like color, link or picture.'), 'no suggestion');
    eq(document.querySelectorAll('#help-panel .help-row.result:not([hidden])').length, 0, 'rows shown for xyz');
    await type('');
  });

  await t('E2: table opens Tables, margin opens The box, xyz opens search', async () => {
    showRight('help');
    await showWord('table');
    assert($('help-panel').textContent.includes('Tables'), 'table');
    await showWord('margin');
    assert($('help-panel').textContent.includes('The box'), 'margin');
    await showWord('xyz');
    const search = document.querySelector('#help-panel input');
    eq(search && search.value, 'xyz', 'search field');
    await showHome();
  });

  await t('E2: the word under the cursor', async () => {
    await openContent('A', [['a.html', '<table style="margin-top: 1px"></table>\n']]);
    view.dispatch({ selection: { anchor: 3 } });
    eq(E.wordAtCursor(view.state), 'table');
    const at = doc().indexOf('margin-top') + 2;
    view.dispatch({ selection: { anchor: at } });
    eq(E.wordAtCursor(view.state), 'margin-top');
  });

  await t('E1: a mistake shows a hint, Hide this hint keeps the underline', async () => {
    const page = '<!doctype html>\n<html>\n<body>\n<h1>Hi<h1>\n<p>x</p>\n</body>\n</html>\n';
    await openContent('A', [['a.html', page]]);
    const box = await until(() => view.dom.querySelector('.hint-box'), 'hint box');
    assert(box.textContent.includes('Oops, this tag never closes.'), box.textContent);
    assert(box.textContent.includes('A closing tag needs a slash.'), box.textContent);
    assert(box.textContent.includes('</h1>'), box.textContent);
    assert(view.dom.querySelector('.cm-mistake'), 'underline');
    eq(view.dom.querySelector('.cm-mistake').textContent, '<h1>', 'marks the second tag');
    await until(() => $('page-hint').textContent === 'The mistake changes your page too', 'page hint');
    box.querySelector('[data-act="hide"]').click();
    await until(() => !view.dom.querySelector('.hint-box'), 'hide');
    assert(view.dom.querySelector('.cm-mistake'), 'underline went too');
  });

  await t('E1: unfinished tag and open quote wordings', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<html>\n<body>\n<h2\n<p>x</p>\n</body>\n</html>\n']]);
    view.dispatch({ selection: { anchor: 0 } });
    let box = await until(() => view.dom.querySelector('.hint-box'), 'first hint');
    assert(box.textContent.includes('Oops, this tag is not finished.'), box.textContent);
    assert(box.textContent.includes('A tag ends with'), box.textContent);
    setDoc('<!doctype html>\n<html>\n<body>\n<a href="x\n<p>hi</p>\n</body>\n</html>\n');
    view.dispatch({ selection: { anchor: 0 } });
    await until(() => view.dom.querySelector('.hint-box') && view.dom.querySelector('.hint-box').textContent.includes('quote'), 'quote hint');
  });

  await t('E1: fine pages show no hint, including tags that may leave out the close', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<html>\n<body>\n<h1>Hi</h1>\n<p>one\n<p>two\n<ul><li>x<li>y</ul>\n<img src="a.png">\n<br>\n</body>\n</html>\n']]);
    await wait(1000);
    assert(!view.dom.querySelector('.hint-box'), view.dom.querySelector('.hint-box') ? view.dom.querySelector('.hint-box').textContent : '');
  });

  await t('E3: width buttons change the width with no reload, and a media query reacts', async () => {
    const page = '<!doctype html><style>h1 { color: red; } @media (max-width: 500px) { h1 { color: blue; } }</style><h1>x</h1>\n';
    await openContent('A', [['a.html', page]]);
    const before = P.loadId;
    preview.setWidth('phone');
    await wait(60);
    eq((await probe('h1', 'color')).value, 'rgb(0, 0, 255)', 'phone');
    eq((await probe('h1')).w, 375, 'phone width');
    preview.setWidth('tablet');
    await wait(60);
    eq((await probe('h1')).w, 768, 'tablet width');
    eq((await probe('h1', 'color')).value, 'rgb(255, 0, 0)', 'tablet');
    preview.setWidth('full');
    await wait(60);
    eq(P.loadId, before, 'reloaded');
    eq($('preview').style.transform, '', 'transform stayed');
  });

  const typeThrough = (text) => {
    const { from, to } = view.state.selection.main;
    const handlers = view.state.facet(E.EditorView.inputHandler);
    const make = () =>
      view.state.update({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' });
    for (const handler of handlers) {
      if (handler(view, from, to, text, make)) return;
    }
    view.dispatch(make());
  };

  await t('E8: with Typing Helpers off, <p> adds no </p>, and undo still works', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<body>\n<p\n</body>\n']]);
    const at = doc().indexOf('<p') + 2;
    view.dispatch({ selection: { anchor: at } });
    typeThrough('>');
    assert(doc().includes('<p></p>'), `helpers on: ${doc()}`);
    E.undo(view);
    E.undo(view);
    assert(!doc().includes('</p>'), `undo: ${doc()}`);
    runCommand('typing-helpers');
    eq(S.prefs.typingHelpers, false);
    view.dispatch({ selection: { anchor: doc().indexOf('<p') + 2 } });
    typeThrough('>');
    assert(doc().includes('<p>') && !doc().includes('</p>'), `helpers off: ${doc()}`);
    E.undo(view);
    assert(!doc().includes('<p>'), 'undo with helpers off');
    runCommand('typing-helpers');
    eq(S.prefs.typingHelpers, true);
  });

  await t('E9: Tidy fixes indents in one undo step, and leaves <pre> alone', async () => {
    const messy = '<!doctype html>\n<html>\n<body>\n<div>\n<p>a</p>\n</div>\n<pre>\n   keep\n      me\n</pre>\n</body>\n</html>\n';
    await openContent('A', [['a.html', messy]]);
    E.tidy(view);
    assert(doc().includes('\n    <p>a</p>') || doc().includes('\n      <p>a</p>'), `not tidied: ${doc()}`);
    assert(doc().includes('\n   keep\n      me\n'), `pre changed: ${doc()}`);
    E.undo(view);
    eq(doc(), messy, 'one undo');
    E.tidy(view);
    const once = doc();
    const before = view.state.doc;
    E.tidy(view);
    eq(doc(), once, 'second tidy changed text');
    assert(view.state.doc === before, 'second tidy made a step');
  });

  await t('E10: a dropped folder gives the message, a dropped page opens', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>a</p>\n'], ['n.txt', 'x']]);
    const flow = flows.droppedFiles([saved.folder]);
    await waitDialog('HTML Lab opens HTML and CSS files.');
    click('OK');
    await flow;
    eq(S.tabs.length, 0);
    await flows.droppedFiles([saved.paths[0]]);
    eq(S.tabs.length, 1, 'dropped page');
  });

  await t('E12: Save Automatically writes in about 2 s, and a failure gives one message', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n']]);
    await flows.__openList(saved.paths);
    await settle();
    S.prefs.autosave = true;
    typeAfter('<p>x', 'y');
    await wait(1200);
    assert(!(await readDisk(saved.paths[0])).includes('<p>xy'), 'too early');
    await until(async () => (await readDisk(saved.paths[0])).includes('<p>xy'), 'autosave', 2500);
    assert($('btn-save').querySelector('.label').textContent === 'Save', 'said Saved!');
    await invoke('test_move', { from: saved.folder, to: `${saved.folder}-gone` });
    typeAfter('<p>xy', 'z');
    await waitDialog('HTML Lab cannot find your folder.');
    click('Keep working');
    await dialogGone();
    typeAfter('<p>xyz', 'w');
    await wait(2300);
    assert(!isDialogOpen(), 'a second message');
  });

  await t('E14: Save a Copy makes a new folder, pictures too, and the old one stays', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n'], ['pic.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>']]);
    await flows.__openList([saved.paths[0]]);
    await settle();
    typeAfter('<p>x', 'y');
    const flow = flows.saveCopyFlow();
    await waitDialog('Save a copy of your project');
    assert(dialogRoot().textContent.includes('and everything else in your folder'), 'extra line');
    const name = `Copy ${freshFolder()}`;
    setField('input[type="text"]', name);
    await wait(60);
    click('Save the copy');
    await flow;
    await dialogGone();
    const folder = activeProject().folder;
    eq(baseName(folder), name, 'new folder');
    assert((await readDisk(`${folder}/a.html`)).includes('<p>xy'), 'copy has his change');
    assert((await invoke('test_list_folder', { path: folder })).includes('pic.svg'), 'picture copied');
    assert(!(await readDisk(saved.paths[0])).includes('<p>xy'), 'old folder changed');
    assert(activeTab().path.startsWith(folder), 'tab points to the copy');
    eq($('status-text').textContent, 'Saved');
  });

  await t('text size: buttons, limits, and the code really changes', async () => {
    await openContent('A', [['a.html', '<p>x</p>\n']]);
    ctx.setTextSize(16);
    await wait(10);
    const base = view.defaultLineHeight;
    ctx.setTextSize(24);
    await wait(50);
    assert(view.defaultLineHeight > base, `line height ${base} -> ${view.defaultLineHeight}`);
    assert($('size-plus').disabled, 'plus at the limit');
    ctx.setTextSize(13);
    assert($('size-minus').disabled, 'minus at the limit');
    ctx.setTextSize(16);
  });

  await t('app config comes from the kinds table', async () => {
    const config = await invoke('get_app_config');
    eq(config.scriptPolicy, 'blocked');
    eq(config.kinds.length, 2);
    assert(config.kinds.every((k) => k.previewMode && k.label && k.openFirst), 'fields');
  });

  await t('a saved 3-file project closed and opened again 5 times shows its page live each time', async () => {
    const project = await sample(SPACE);
    await flows.__firstSaveTo(project, parent, freshFolder());
    const paths = tabsOf(project).map((x) => x.path);
    const names = tabsOf(project).map((x) => x.name).sort().join();
    eq(paths.length, 3, 'files in the project');
    for (let i = 1; i <= 5; i++) {
      for (const tab of [...S.tabs]) await flows.closeTabFlow(tab.path);
      eq(S.tabs.length, 0, `open ${i}: tabs left after closing`);
      await flows.__openList(paths);
      eq(S.tabs.map((x) => x.name).sort().join(), names, `open ${i}: the tabs`);
      await settle();
      assert(S.tabs.some((x) => x.path === P.showing), `open ${i}: the page panel shows ${P.showing}`);
      assert((await probe('h1')).found, `open ${i}: no h1 on the page`);
    }
  });

  if (filter === 'lost') {
    const project = await sample(SPACE);
    await flows.__firstSaveTo(project, parent, 'Lost club');
    const paths = tabsOf(project).map((t) => t.path);
    const times = [];
    let notClosed = 0;
    for (let i = 0; i < 40; i++) {
      for (const tab of [...S.tabs]) await flows.closeTabFlow(tab.path);
      if (S.tabs.length) notClosed += 1;
      const start = performance.now();
      await flows.__openList(paths);
      await settle();
      times.push(Math.round(performance.now() - start));
    }
    const sorted = [...times].sort((x, y) => x - y);
    results.push({
      name: `40 opens of a saved 3-file project: ${P.lostLoads} lost, ${notClosed} not closed first, median ${sorted[20]} ms, slowest ${sorted[39]} ms`,
      ok: P.lostLoads === 0 && notClosed === 0,
      error: `times ${times.join(' ')}`,
    });
  }

  if (filter === 'perf') {
    const project = await sample(SPACE);
    const a = tabNamed(project, 'my-page.html');
    const b = tabNamed(project, 'planets.html');
    switchTo(a.path);
    await settle();
    const time = async (label, fn) => {
      const list = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        fn(i);
        list.push(performance.now() - start);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await settle();
      }
      list.sort((x, y) => x - y);
      results.push({ name: `perf ${label}`, ok: true, ms: +list[15].toFixed(1), p95: +list[28].toFixed(1) });
    };
    await time('switchTo whole', (i) => switchTo((i % 2 ? a : b).path));
    await time('renderStrip', () => ctx.helpers.renderStrip());
    await time('updateHeader', () => preview.updateHeader());
    await time('doc toString', () => view.state.doc.toString());
  }

  if (filter === 'huge') {
    let body = '';
    for (let i = 0; i < 4990; i++) body += `    <p>Line ${i}: a long page to read, with <b>some</b> words in it.</p>\n`;
    const code = `<!doctype html>\n<html>\n  <head>\n    <title>Huge</title>\n  </head>\n  <body>\n    <h1>Huge page</h1>\n${body}  </body>\n</html>\n`;
    await openContent('Huge', [['huge.html', code]]);
    await settle();
    await wait(1000);
    const tab = activeTab();
    const at = () => doc().indexOf('Huge page</h1>') + 'Huge page</h1>'.length;
    const time = async (label, fn, settleAfter = true) => {
      const list = [];
      for (let i = 0; i < 24; i++) {
        const start = performance.now();
        fn(i);
        list.push(performance.now() - start);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (settleAfter) await settle();
      }
      list.sort((x, y) => x - y);
      results.push({ name: `perf ${label}`, ok: true, ms: +list[12].toFixed(1), p95: +list[22].toFixed(1) });
    };
    await time('huge dispatch, all listeners', (i) => view.dispatch({ changes: { from: at(), insert: String(i % 10) }, userEvent: 'input.type' }));
    await time('huge state.update only', (i) => view.state.update({ changes: { from: at(), insert: String(i % 10) } }));
    await time('huge preview.onKey', () => preview.onKey(tab));
    await time('huge updateHeader', () => preview.updateHeader());
    await time('huge unfinishedTagAt', () => S.E.unfinishedTagAt(view.state.doc, at()), false);
    await time('huge doc toString', () => view.state.doc.toString(), false);
    await time('huge view.measure', () => view.measure(), false);
    results.push({ name: 'perf huge helper apply (lastMs)', ok: true, ms: +P.lastMs.toFixed(1), p95: null });
  }

  if (filter === 'drag') {
    const long = Array.from({ length: 400 }, (_, i) => `  <p class="line">Line ${i} with some words to wrap across the editor width nicely</p>`).join('\n');
    const other = await openContent('Long one', [['index.html', `<!DOCTYPE html>\n<html>\n<body>\n${long}\n</body>\n</html>\n`]]);
    const project = await sample(SPACE);
    for (const tab of [...tabsOf(other), ...tabsOf(project)]) {
      switchTo(tab.path);
      await settle();
    }
    switchTo(tabNamed(project, 'my-page.html').path);
    await settle();
    const left = $('left');
    const box = $('main').getBoundingClientRect();
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
    const loop = async (label, before, after) => {
      before();
      await nextFrame();
      await nextFrame();
      const out = [];
      const lay = [];
      let last = await nextFrame();
      for (let i = 0; i < 180; i++) {
        const room = box.width - 700;
        left.style.flex = `0 0 ${320 + Math.abs(((i * 4) % (room * 2)) - room)}px`;
        const t0 = performance.now();
        void host.offsetWidth;
        lay.push(performance.now() - t0);
        const now = await nextFrame();
        out.push(now - last);
        last = now;
      }
      left.style.flex = '';
      after();
      await nextFrame();
      await nextFrame();
      out.sort((x, y) => x - y);
      lay.sort((x, y) => x - y);
      const over = (100 * out.filter((v) => v > 20).length) / out.length;
      results.push({ name: `drag ${label}`, ok: true, ms: +out[90].toFixed(1), p95: +out[171].toFixed(1), over: +over.toFixed(1), max: +out[179].toFixed(1), layout: +lay[90].toFixed(2), layout95: +lay[171].toFixed(2) });
    };
    const none = () => {};
    const host = $('editor-host');
    const frame = $('preview');
    let parked = [];
    const hideViews = () => {
      parked = [...host.children].filter((el) => el.hidden);
      for (const el of parked) el.remove();
    };
    const showViews = () => { for (const el of parked) host.appendChild(el); };
    const containOn = (value) => () => (host.style.contain = value);
    const containOff = () => (host.style.contain = '');
    await loop('base', none, none);
    showRight('help');
    const index = await invoke('help_index');
    for (const topic of index.topics.slice(0, 24)) await showTopic(topic.id);
    await showHome();
    showRight('page');
    await settle();
    await loop('after 24 help topics', none, none);
    for (let i = 0; i < 160; i++) typeAfter('Space is very big', String(i % 10));
    await settle();
    await loop('after 160 digits', none, none);
    await loop('after 160 digits, no hidden views', hideViews, showViews);
  }

  const failed = results.filter((r) => !r.ok);
  const report = {
    createdAt: new Date().toISOString(),
    ua: navigator.userAgent,
    lastCopied,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    lostLoads: P.lostLoads,
    lostTraces: P.lostTraces,
    rustTrace: P.lostLoads ? await invoke('test_preview_trace') : [],
    filter: filter || 'all',
    minTests: MIN_TESTS,
    errors: window.__htmllabErrors,
    results,
  };
  S.prefs.tried = [];
  await invoke('set_prefs', { patch: { tried: [], session: null } });
  await invoke('test_delete_tree', { path: parent });
  await invoke('write_log_file', { name: 'selftest-latest.json', text: JSON.stringify(report, null, 2) });
  await wait(200);
  invoke('test_quit');
}

export const __unused = [tabByPath];
