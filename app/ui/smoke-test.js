import { invoke } from './api.js';
import { S, activeTab, activeProject } from './state.js';
import { seeSteps } from './smoke-test-see.js';

export const MIN_STEPS = 39; // 32 + SEE_STEPS (7)
const MIN_TEMPLATES = 6;

const results = [];
let shot = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function frames(n = 2) {
  for (let i = 0; i < n; i++) await frame();
}

async function until(test, label, ms = 6000) {
  const end = performance.now() + ms;
  for (;;) {
    let ok = false;
    try {
      ok = await test();
    } catch (e) {
      ok = false;
    }
    if (ok) return ok;
    if (performance.now() > end) throw new Error(`waited ${ms} ms for ${label}`);
    await wait(40);
  }
}

function describe(el) {
  if (!el) return 'nothing';
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
}

function shown(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
}

function $(id) {
  return document.getElementById(id);
}

function must(el, label) {
  if (!el) throw new Error(`${label}: not on the page`);
  if (!shown(el)) throw new Error(`${label}: not visible (${describe(el)})`);
  return el;
}

function byText(text, scope = document) {
  const all = [...scope.querySelectorAll('button, a, [role="button"]')];
  return all.find((b) => shown(b) && b.textContent.replace(/\s+/g, ' ').includes(text)) || null;
}

async function clickOn(el, label, at = null) {
  if (!el) throw new Error(`${label}: not on the page`);
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await frames(1);
  must(el, label);
  const r = el.getBoundingClientRect();
  const x = at ? at.x : r.left + r.width / 2;
  const y = at ? at.y : r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  if (!top || !(top === el || el.contains(top))) {
    throw new Error(`${label}: a click there lands on ${describe(top)}, not on ${describe(el)}`);
  }
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
  const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
  top.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...pointer, buttons: 1 }));
  const go = top.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1, detail: 1 }));
  if (go) {
    const target = top.closest('button, input, textarea, select, a[href], [tabindex], [contenteditable="true"]');
    if (target) target.focus();
  }
  top.dispatchEvent(new PointerEvent('pointerup', { ...base, ...pointer, buttons: 0 }));
  top.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0, detail: 1 }));
  top.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0, detail: 1 }));
  await frames(2);
}

async function hoverOn(el, label) {
  if (!el) throw new Error(`${label}: not on the page`);
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await frames(1);
  must(el, label);
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  if (!top || !(top === el || el.contains(top))) {
    throw new Error(`${label}: the mouse there is on ${describe(top)}, not on ${describe(el)}`);
  }
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
  top.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  top.dispatchEvent(new MouseEvent('mouseover', base));
  top.dispatchEvent(new MouseEvent('mousemove', base));
  await frames(1);
}

function typeText(text) {
  const ok = document.execCommand('insertText', false, text);
  if (!ok) throw new Error(`typing "${text}" was refused by ${describe(document.activeElement)}`);
}

function key(name, extra = {}) {
  const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 };
  const target = document.activeElement || document.body;
  const init = { key: name, code: name, keyCode: codes[name] || 0, which: codes[name] || 0, bubbles: true, cancelable: true, ...extra };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

function dialog() {
  const root = $('dialog-root');
  return root && !root.hidden ? root.querySelector('.dlg') : null;
}

function code() {
  return S.ed ? S.ed.view.state.doc.toString() : '';
}

function lineWith(text) {
  const box = document.querySelector('#editor-host > .editor-box:not([hidden])');
  if (!box) return null;
  return [...box.querySelectorAll('.cm-line')].find((line) => line.textContent.includes(text)) || null;
}

async function clickAfter(text, label) {
  const line = must(lineWith(text), `${label}: line with "${text}"`);
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node;
  let found = false;
  let joined = '';
  const nodes = [];
  while ((node = walker.nextNode())) {
    nodes.push([node, joined.length]);
    joined += node.data;
  }
  const end = joined.indexOf(text) + text.length;
  for (const [n, start] of nodes) {
    if (end > start && end <= start + n.data.length) {
      range.setStart(n, end - start - 1);
      range.setEnd(n, end - start);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`${label}: "${text}" not found in the line`);
  const r = range.getBoundingClientRect();
  await clickOn(line, label, { x: r.right - 0.5, y: r.top + r.height / 2 });
  await until(() => S.ed.view.contentDOM.contains(document.activeElement), `${label}: the editor to take focus`, 2000);
  const head = S.ed.view.state.selection.main.head;
  const want = code().indexOf(text) + text.length;
  if (Math.abs(head - want) > 1) throw new Error(`${label}: the caret went to ${head}, not ${want}`);
  if (head !== want) S.ed.view.dispatch({ selection: { anchor: want } });
}

async function settled(preview) {
  const P = preview.state;
  await until(
    () => P.phase === 'live' && P.out === null && !P.pendingHtml && P.pendingCss.size === 0,
    `the page panel to finish (phase ${P.phase})`,
  );
}

async function probe(preview, sel, prop) {
  await settled(preview);
  const res = await preview.__probe(sel, prop);
  if (!res) throw new Error(`the page panel did not answer about ${sel}`);
  return res;
}

async function step(name, fn) {
  const row = { name, ok: true };
  const errorsBefore = window.__htmllabErrors.length;
  const start = performance.now();
  try {
    await fn();
  } catch (e) {
    row.ok = false;
    row.error = String(e && e.message ? e.message : e);
  }
  const errors = window.__htmllabErrors.slice(errorsBefore);
  if (errors.length) {
    row.ok = false;
    row.error = `${row.error ? `${row.error}; ` : ''}script error: ${errors[0].slice(0, 300)}`;
  }
  row.ms = Math.round(performance.now() - start);
  await wait(150);
  await frames(2);
  shot += 1;
  const file = `smoke-${String(shot).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
  row.shot = (await invoke('test_snapshot', { name: file }).catch(() => false)) ? file : null;
  results.push(row);
}

function present(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return r.width >= 2 && r.height >= 2 && style.visibility !== 'hidden' && style.display !== 'none';
}

function topicTitle() {
  const title = [...$('help-panel').querySelectorAll('h1, h2')].find(shown);
  return title ? title.textContent.trim() : '';
}

async function nextTopic(label) {
  const before = topicTitle();
  await clickOn([...$('help-panel').querySelectorAll('button.next')].find(present), label);
  await until(() => topicTitle() && topicTitle() !== before, `${label}: a new topic after "${before}"`);
  await frames(2);
}

async function newFrom(cardText, label) {
  await clickOn($('btn-new'), `${label}: New in the toolbar`);
  const box = await until(() => dialog(), `${label}: the New dialog`);
  await clickOn(byText(cardText, box), `${label}: "${cardText}"`);
  await until(() => !dialog(), `${label}: the dialog to close`);
}

export async function run({ preview }) {
  const temp = await invoke('test_temp_folder', { name: 'smoke' });

  await step('Welcome screen', async () => {
    must($('welcome-start'), 'Welcome');
    must($('w-new'), 'Welcome New');
    must($('w-open'), 'Welcome Open');
    must($('w-sample'), 'Welcome sample');
    must($('btn-new'), 'toolbar New');
    must($('seg-help'), 'toolbar Help');
  });

  await step('Help from Welcome', async () => {
    await clickOn($('seg-help'), 'toolbar Help');
    must($('help-panel'), 'Help panel');
    await until(() => [...$('help-panel').querySelectorAll('.help-group, .help-row')].some(shown), 'Help groups or topics to show');
  });

  await step('Back to My page on Welcome', async () => {
    await clickOn($('seg-page'), 'toolbar My page');
    must($('welcome-start'), 'Welcome');
  });

  await step('Welcome sample button', async () => {
    await clickOn($('w-sample'), 'Welcome "open a sample"');
    const box = await until(() => dialog(), 'the New dialog');
    must(byText('Space club website', box), 'the samples');
    await clickOn(byText('Cancel', box), 'Cancel');
    await until(() => !dialog(), 'the dialog to close');
    must($('welcome-start'), 'Welcome again');
  });

  await step('New dialog', async () => {
    await clickOn($('btn-new'), 'toolbar New');
    const box = await until(() => dialog(), 'the New dialog');
    for (const text of ['Style inside the page', 'Style in a separate file', 'Space poster', 'Photo gallery']) {
      must(byText(text, box), `New dialog "${text}"`);
    }
  });

  await step('Style inside the page opens', async () => {
    await clickOn(byText('Style inside the page', dialog()), '"Style inside the page"');
    await until(() => !dialog(), 'the dialog to close');
    await until(() => S.tabs.length === 1, 'one tab');
    await until(() => shown($('code-panel')), 'the code panel');
    await until(() => lineWith('<h1'), 'the code to show an h1 line');
    must($('preview'), 'page panel');
    const h1 = await probe(preview, 'h1');
    if (!h1.found) throw new Error('the page panel shows no h1');
  });

  await step('Typing changes the page', async () => {
    await clickAfter('teal;">My new page', 'click at the end of the heading text');
    typeText(' and more');
    await until(async () => ((await probe(preview, 'h1')).text || '').includes('and more'), 'the page to show "and more"');
    must(document.querySelector('.tab.active .tab-dot'), 'the not-saved dot');
  });

  await step('Mistake hint for an unfinished tag', async () => {
    await clickAfter('and more', 'click after the new words');
    key('Enter');
    typeText('<h2>Unfinished');
    await until(() => [...document.querySelectorAll('.hint-box')].some(shown), 'a mistake hint', 4000);
  });

  await step('Help home', async () => {
    await clickOn($('seg-help'), 'toolbar Help');
    must($('help-panel'), 'Help panel');
    await until(() => [...$('help-panel').querySelectorAll('.help-group, .help-row')].some(shown), 'Help to show');
  });

  await step('A Help topic opens', async () => {
    const panel = $('help-panel');
    let row = [...panel.querySelectorAll('.help-row')].find(shown);
    if (!row) {
      await clickOn([...panel.querySelectorAll('.help-group')].find(shown), 'first Help group');
      row = await until(() => [...panel.querySelectorAll('.help-row')].find(shown), 'a topic row');
    }
    await clickOn(row, 'first topic row');
    await until(() => [...panel.querySelectorAll('.btn-try')].find(shown), 'the Try it button');
  });

  await step('Try it opens a practice page', async () => {
    const tabs = S.tabs.length;
    await clickOn([...$('help-panel').querySelectorAll('.btn-try')].find(shown), 'Try it');
    await until(() => S.tabs.length > tabs, 'a practice tab');
    await until(() => shown($('practice-bar')), 'the practice bar');
    must($('preview'), 'page panel');
    await settled(preview);
  });

  await step('Back to the topic', async () => {
    await clickOn($('btn-back-help'), 'Back to Help');
    await until(() => [...$('help-panel').querySelectorAll('.btn-try')].find(shown), 'the topic again');
  });

  await step('Next topic', async () => {
    await nextTopic('Next topic');
  });

  await step('Add to my code', async () => {
    const panel = $('help-panel');
    let add = [...panel.querySelectorAll('.btn-add')].find(present);
    for (let i = 0; !add && i < 6; i++) {
      await nextTopic('Next topic, looking for Add to my code');
      add = [...panel.querySelectorAll('.btn-add')].find(present);
    }
    if (!add) throw new Error('no topic with Add to my code in the first seven');
    const before = code();
    await clickOn(add, 'Add to my code');
    await until(() => code() !== before || dialog(), 'the code to change or a question');
    if (/^\s*<!doctype/i.test(before) && !/^\s*<!doctype/i.test(code())) {
      throw new Error(`the block went in front of <!doctype>: ${code().slice(0, 60)}`);
    }
    if (dialog()) {
      const box = dialog();
      await clickOn(byText('Cancel', box) || byText('OK', box) || box.querySelector('[data-primary]'), 'answer the question');
      await until(() => !dialog(), 'the question to close');
    }
  });

  await step('Tidy', async () => {
    await clickOn($('seg-page'), 'toolbar My page');
    const before = code();
    await clickOn($('btn-tidy'), 'Tidy');
    await frames(3);
    if (!code().trim()) throw new Error('Tidy left no code');
    if (code().replace(/\s+/g, '') !== before.replace(/\s+/g, '')) throw new Error('Tidy changed more than spaces');
  });

  await step('Help search', async () => {
    await clickOn($('seg-help'), 'toolbar Help');
    const panel = $('help-panel');
    let input = panel.querySelector('input[aria-label="Search help"]');
    if (!shown(input)) {
      const back = [...panel.querySelectorAll('button.quiet')].find(
        (b) => shown(b) && !b.classList.contains('next') && !b.classList.contains('more'),
      );
      await clickOn(back, 'the back link to Help home');
      input = await until(() => {
        const found = panel.querySelector('input[aria-label="Search help"]');
        return shown(found) ? found : null;
      }, 'the search box');
    }
    await clickOn(input, 'search box');
    typeText('color');
    await until(() => [...panel.querySelectorAll('.help-row.result')].some(shown), 'search results');
    await clickOn([...panel.querySelectorAll('.help-row.result')].find(shown), 'first result');
    await until(() => [...panel.querySelectorAll('.topic-body')].some(shown) && !shown(input), 'the result topic');
  });

  await step('My page again', async () => {
    await clickOn($('seg-page'), 'toolbar My page');
    must($('page-panel'), 'page panel');
    must($('preview'), 'page');
  });

  await step('Style in a separate file opens two tabs', async () => {
    const tabs = S.tabs.length;
    await newFrom('Style in a separate file', 'two files');
    await until(() => S.tabs.length === tabs + 2, 'two new tabs');
    await until(async () => (await probe(preview, 'h1', 'color')).value === 'rgb(0, 128, 128)', 'the heading teal from style.css');
  });

  await step('Editing style.css changes the page', async () => {
    const tab = [...document.querySelectorAll('.tab[data-kind="css"]')].find(shown);
    await clickOn(tab && tab.querySelector('.tab-main'), 'the style.css tab');
    await until(() => activeTab() && activeTab().name === 'style.css', 'style.css to be active');
    await until(() => lineWith('teal'), 'the CSS to show');
    const line = lineWith('teal');
    const text = line.textContent;
    const at = text.indexOf('teal');
    await clickAfter(text.slice(0, at + 4), 'click after teal');
    for (let i = 0; i < 4; i++) key('Backspace');
    typeText('red');
    await until(async () => (await probe(preview, 'h1', 'color')).value === 'rgb(255, 0, 0)', 'the heading to turn red');
  });

  await step('A sample opens', async () => {
    await newFrom('Space club website', 'sample');
    await until(() => activeProject() && activeProject().kind === 'sample', 'the sample project');
    const h1 = await probe(preview, 'h1');
    if (!h1.found) throw new Error('the sample page shows no h1');
  });

  await step('Photo gallery shows its pictures', async () => {
    await newFrom('Photo gallery', 'gallery');
    await until(async () => (await probe(preview, 'img')).natural > 0, 'a picture to load');
  });

  await step('Width buttons', async () => {
    await clickOn($('w-phone'), 'phone width');
    await until(async () => (await probe(preview, 'body')).w < 500, 'a phone-wide page');
    const phone = (await probe(preview, 'body')).w;
    await clickOn($('w-full'), 'full width');
    await until(async () => (await probe(preview, 'body')).w > phone + 50, 'a full-width page');
  });

  await step('Text size', async () => {
    const before = S.prefs.textSize;
    await clickOn($('size-plus'), 'text size plus');
    await until(() => S.prefs.textSize === before + 1, 'a bigger text size');
    await until(() => {
      const line = lineWith('<body>');
      return line && Math.abs(line.getBoundingClientRect().height - S.ed.view.defaultLineHeight) < 1.5;
    }, 'the editor to measure the bigger line height');
    await clickAfter('<body>', 'the body line at the bigger size');
    await clickOn($('size-minus'), 'text size minus');
    await until(() => S.prefs.textSize === before, 'the text size back');
  });

  await step('Template gallery shows a preview under the mouse', async () => {
    await clickOn($('btn-new'), 'toolbar New');
    const box = await until(() => dialog(), 'the New dialog');
    await clickOn(box.querySelector('.row-templates'), 'the Template gallery row');
    const gallery = await until(() => (dialog() && dialog().querySelector('.tpl-list') ? dialog() : null), 'the gallery view');
    const all = gallery.querySelector('.tpl-chip[data-filter="all"]');
    if (all.getAttribute('aria-pressed') !== 'true') await clickOn(all, 'the All filter');
    const rows = [...gallery.querySelectorAll('.tpl-row')];
    if (rows.length < MIN_TEMPLATES) throw new Error(`only ${rows.length} templates in the gallery`);
    for (let i = 0; i < rows.length; i++) {
      await hoverOn(rows[i], `template row ${i + 1}`);
      const thumb = rows[i].querySelector('.tpl-thumb');
      await until(() => thumb.complete && thumb.naturalWidth > 0, `the small picture of row ${i + 1}`);
      const big = await until(() => gallery.querySelector(`.tpl-big[data-index="${i}"]`), `the preview of row ${i + 1}`);
      must(big, `the preview of row ${i + 1}`);
      await until(() => big.complete && big.naturalWidth > 0, `the preview picture of row ${i + 1}`);
      const title = rows[i].querySelector('.row-title').textContent;
      if ($('tpl-name').textContent !== title) throw new Error(`the name says "${$('tpl-name').textContent}", not "${title}"`);
    }
    for (const chip of gallery.querySelectorAll('.tpl-chip')) {
      await clickOn(chip, `the ${chip.dataset.filter} filter`);
      const visible = [...gallery.querySelectorAll('.tpl-row')].filter((r) => r.offsetParent !== null);
      if (visible.length !== Number(chip.querySelector('.tpl-count').textContent)) {
        throw new Error(`the ${chip.dataset.filter} filter shows ${visible.length} rows, its number says ${chip.querySelector('.tpl-count').textContent}`);
      }
    }
    await clickOn(all, 'the All filter');
    await hoverOn(rows[1], 'template row 2');
  });

  await step('Back from the gallery, then a template opens', async () => {
    await clickOn(dialog().querySelector('.tpl-back'), 'Back');
    await until(() => dialog() && document.activeElement && document.activeElement.classList.contains('row-templates'), 'New again, on the gallery row');
    await clickOn(dialog().querySelector('.row-templates'), 'the Template gallery row');
    const gallery = await until(() => (dialog() && dialog().querySelector('.tpl-list') ? dialog() : null), 'the gallery view');
    const row = gallery.querySelectorAll('.tpl-row')[1];
    await clickOn(row, 'the second template');
    await until(() => !dialog(), 'the gallery to close');
    await until(() => activeProject() && activeProject().kind === 'sample' && activeTab().name === 'index.html', 'the template on its home page');
    must(document.querySelector('.tab.active'), 'the index.html tab');
    if (!(await probe(preview, '[aria-current="page"]')).found) throw new Error('the page shows no menu');
    const img = await probe(preview, 'img');
    if (img.found) await until(async () => (await probe(preview, 'img')).natural > 0, 'its first picture');
  });

  await step('The template menu opens each page in its tab, and the home link goes back', async () => {
    const project = activeProject();
    const pages = S.tabs.filter((t) => t.projectId === project.id && t.name.endsWith('.html')).map((t) => t.name);
    if (pages.length < 3 || pages[0] !== 'index.html') throw new Error(`the page tabs are ${pages.join(', ')}`);
    for (const name of pages.slice(1)) {
      const go = await preview.__click(`a[href="${name}"]`);
      if (!go || !go.found) throw new Error(`no menu link to ${name}`);
      await until(() => activeTab().name === name, `${name} to become the active tab`);
      if (!(await probe(preview, `a[aria-current="page"][href="${name}"]`)).found) throw new Error(`the page panel does not show ${name}`);
      const home = await preview.__click('a[href="index.html"]');
      if (!home || !home.found) throw new Error(`${name} has no link home`);
      await until(() => activeTab().name === 'index.html', `index.html again after ${name}`);
      if (!(await probe(preview, 'a[aria-current="page"][href="index.html"]')).found) throw new Error(`the home page did not come back after ${name}`);
    }
  });

  await step('Change the template and save it', async () => {
    const id = (await invoke('samples')).filter((s) => s.group === 'template')[1].id;
    const want = (await invoke('open_sample', { id })).files.map((f) => f.name);
    const project = activeProject();
    const style = S.tabs.find((t) => t.projectId === project.id && t.name === 'style.css');
    const tab = style && [...document.querySelectorAll('.tab')].find((el) => el.dataset.path === style.path);
    await clickOn(tab && tab.querySelector('.tab-main'), 'the style.css tab');
    await until(() => activeTab() && activeTab().name === 'style.css', 'style.css to be active');
    const line = await until(() => {
      const box = document.querySelector('#editor-host > .editor-box:not([hidden])');
      return box && [...box.querySelectorAll('.cm-line')].find((l) => /^\s*--[\w-]+\s*:\s*[^;]+;/.test(l.textContent));
    }, 'a colour line in :root');
    const m = /^(\s*(--[\w-]+)\s*:\s*)([^;]+);/.exec(line.textContent);
    await clickAfter(`${m[1]}${m[3]}`.trim(), 'click after the first colour');
    for (let i = 0; i < m[3].length; i++) key('Backspace');
    typeText('#123456');
    await until(async () => String((await probe(preview, 'html', m[2])).value).trim() === '#123456', `the page to take ${m[2]}: #123456`);
    if (!temp) throw new Error('no temp folder for the save');
    S.prefs.savePlace = temp;
    await clickOn($('btn-save'), 'Save in the toolbar');
    const box = await until(() => dialog(), 'the Save dialog');
    const name = box.querySelector('#dlg-name');
    await clickOn(name, 'the name box');
    name.select();
    typeText('Smoke template');
    await clickOn(box.querySelector('[data-primary]'), 'Save my project');
    await until(() => !dialog(), 'the Save dialog to close', 8000);
    await until(() => activeProject().folder, 'the template to have a folder', 8000);
    const files = await invoke('test_list_folder', { path: activeProject().folder });
    const missing = want.filter((f) => !files.includes(f));
    if (missing.length) throw new Error(`the saved template has no ${missing.join(', ')}`);
  });

  await step('Add a new file', async () => {
    await newFrom('Style inside the page', 'a new project');
    await until(() => activeProject() && activeProject().kind === 'new', 'a new project');
    await clickOn($('tab-add'), 'the + button');
    const box = await until(() => dialog(), 'the Add a new file dialog');
    await clickOn(box.querySelector('#dlg-file'), 'the file name box');
    typeText('about');
    await clickOn(byText('Add this file', box), 'Add this file');
    await until(() => !dialog(), 'the dialog to close');
    await until(() => activeTab() && activeTab().name === 'about.html', 'about.html to open');
  });

  await step('Many tabs stay readable', async () => {
    const list = $('tab-list');
    const box = list.getBoundingClientRect();
    const tabs = [...list.querySelectorAll('.tab')];
    if (tabs.length < 5) throw new Error(`only ${tabs.length} tabs open, the check needs 5`);
    for (const tab of tabs) {
      const r = tab.getBoundingClientRect();
      if (r.right <= box.left || r.left >= box.right) continue;
      const name = tab.querySelector('.tab-name').getBoundingClientRect();
      if (r.left >= box.left - 1 && r.right <= box.right + 1 && name.width < 40) {
        throw new Error(`the tab "${tab.textContent.trim()}" shows only ${Math.round(name.width)} px of its name`);
      }
    }
    const active = list.querySelector('.tab.active').getBoundingClientRect();
    if (active.left < box.left - 1 || active.right > box.right + 1) throw new Error('the active tab is cut off at the edge');
  });

  await step('Save the project', async () => {
    if (!temp) throw new Error('no temp folder for the save');
    S.prefs.savePlace = temp;
    await clickOn($('btn-save'), 'Save in the toolbar');
    const box = await until(() => dialog(), 'the Save dialog');
    const name = box.querySelector('#dlg-name');
    await clickOn(name, 'the name box');
    name.select();
    typeText('Smoke club');
    await clickOn(box.querySelector('[data-primary]'), 'Save my project');
    await until(() => !dialog(), 'the Save dialog to close', 8000);
    await until(() => activeProject().folder, 'the project to have a folder', 8000);
    const files = await invoke('test_list_folder', { path: activeProject().folder });
    if (!files.includes('about.html')) throw new Error(`the saved folder holds ${files.join(', ')}`);
  });

  await step('Closing a changed tab asks first', async () => {
    await clickAfter('</h1>', 'click after the heading tag');
    typeText(' ');
    await frames(3);
    const tab = document.querySelector('.tab.active');
    await clickOn(tab && tab.querySelector('.tab-close'), 'the tab close button');
    const box = await until(() => dialog(), 'the close question');
    await clickOn(byText('Keep working', box), 'Keep working');
    await until(() => !dialog(), 'the question to close');
    if (!document.querySelector('.tab.active')) throw new Error('the tab went away');
  });

  await seeSteps({
    step, clickOn, clickAfter, lineWith, key, wait, until,
    assert: (cond, message) => {
      if (!cond) throw new Error(message || 'assertion failed');
    },
    eq: (a, b, message) => {
      if (a !== b) throw new Error(`${message || 'expected equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
    },
    S, E: S.E, P: preview.state, preview, $,
  });

  await step('No script errors', async () => {
    if (window.__htmllabErrors.length) throw new Error(window.__htmllabErrors.join('\n').slice(0, 600));
  });

  const failed = results.filter((r) => !r.ok);
  const report = {
    createdAt: new Date().toISOString(),
    ua: navigator.userAgent,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    lostLoads: preview.state.lostLoads,
    lostTraces: preview.state.lostTraces,
    rustTrace: preview.state.lostLoads ? await invoke('test_preview_trace') : [],
    keyWindow: document.hasFocus(),
    errors: window.__htmllabErrors,
    minSteps: MIN_STEPS,
    results,
  };
  await invoke('set_prefs', { patch: { session: null, tried: [], savePlace: null } });
  if (temp) await invoke('test_delete_tree', { path: temp });
  await invoke('write_log_file', { name: 'smoke-latest.json', text: JSON.stringify(report, null, 2) });
  await wait(200);
  invoke('test_quit');
}
