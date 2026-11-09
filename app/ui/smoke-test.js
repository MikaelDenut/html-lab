import { invoke } from './api.js';
import { S, activeTab, activeProject } from './state.js';
import * as flows from './flows.js';
import { seeSteps } from './smoke-test-see.js';

export const MIN_STEPS = 49; // 37 + SEE_STEPS (7) + RENAME_STEPS (5)
const MIN_TEMPLATES = 42; // every template that ships; a missing one fails the run (T2)

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

// A picture in the middle of a step, named after the step that comes next, so the hidden side
// is seen although every step that hides it shows it again before it ends.
async function picture(label) {
  await wait(150);
  await frames(2);
  const file = `smoke-${String(shot + 1).padStart(2, '0')}-${label}.png`;
  await invoke('test_snapshot', { name: file }).catch(() => false);
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

  await step('Make a new file from the +', async () => {
    await newFrom('Style inside the page', 'a new project');
    await until(() => activeProject() && activeProject().kind === 'new', 'a new project');
    await clickOn($('tab-add'), 'the + button');
    const box = await until(() => dialog() && dialog().textContent.includes('Make a new file') && dialog(), 'the Make a new file dialog');
    const name = box.querySelector('#dlg-file');
    await clickOn(name, 'the Name box');
    name.select();
    typeText('about');
    await until(() => box.textContent.includes('You will get about.html.'), 'the hint to say about.html');
    await picture('make-a-new-file-dialog');
    await clickOn(byText('Make the file', box), 'Make the file');
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

  // WP3 (mockups 01 to 04). These steps come after every step that needs the page. A step that
  // hides the side shows it again with a real click before it ends, also when it fails.
  const sideButton = () => $('btn-side');
  const sideShown = () => present($('right'));
  const showSideAgain = async (label) => {
    if (!S.sideShown) await clickOn(sideButton(), `${label}: the side button, to show the side again`);
  };

  await step('The side button hides My page and brings it back', async () => {
    try {
      const button = must(sideButton(), 'the side button');
      if (button.title !== 'Hide the My page side') throw new Error(`the tooltip says ${button.title}`);
      const before = button.getBoundingClientRect();
      await clickOn(button, 'the side button');
      if (sideShown() || S.sideShown) throw new Error('the side did not hide');
      if (present(document.querySelector('.segs'))) throw new Error('the My page and Help switch still shows');
      must(document.querySelector('.brand'), 'the brand');
      const left = $('left').getBoundingClientRect();
      const main = $('main').getBoundingClientRect();
      if (main.right - left.right > 13) throw new Error(`the code ends ${Math.round(main.right - left.right)} px before the window edge`);
      if (sideButton().title !== 'Show the My page side') throw new Error(`the tooltip says ${sideButton().title}`);
      if (Math.round(sideButton().getBoundingClientRect().left) !== Math.round(before.left)) throw new Error('the side button moved');
      await picture('side-hidden-by-hand');
      await clickOn(sideButton(), 'the side button again');
      if (!sideShown() || !S.sideShown) throw new Error('the side did not come back');
      await settled(preview);
      must($('preview'), 'the page');
    } finally {
      await showSideAgain('side button');
    }
  });

  // WP2 (mockup 02). The files arrive the way a drop brings them; everything after that is real clicks.
  const GAME_PY = '# A tiny jumping game\nimport random\n\nGRAVITY = 0.5\nJUMP = -9\n\nclass Player:\n'
    + '    def __init__(self, name):\n        self.name = name\n        self.y = 0\n        self.speed = 0\n\n'
    + '    def jump(self):\n        if self.y == 0:\n            self.speed = JUMP\n            print(f"{self.name} jumps!")\n\n'
    + '    def fall(self):\n        self.speed += GRAVITY\n        self.y = min(0, self.y + self.speed)\n';
  const LEVELS_JSON = '{\n"levels": [\n      { "coins": 3 },\n  { "coins": 5 }\n  ]\n}\n';
  const dropFile = async (name, text, label) => {
    if (!temp) throw new Error('no temp folder for the language files');
    const dir = `${temp}/language-${name.replace(/\W/g, '-')}`;
    if (!(await invoke('test_make_folder', { path: dir }))) throw new Error(`${label}: the folder was not made`);
    const path = `${dir}/${name}`;
    const ok = await invoke('test_write_bytes', { path, bytes: Array.from(new TextEncoder().encode(text)) });
    if (!ok) throw new Error(`${label}: ${name} was not written`);
    await flows.droppedFiles([path]);
    await until(() => activeTab() && activeTab().name === name, `${label}: ${name} to open`);
    const tab = document.querySelector('.tab.active');
    await clickOn(tab && tab.querySelector('.tab-main'), `${label}: the ${name} tab`);
    return must(document.querySelector('.tab.active'), `${label}: the active tab`);
  };
  const insideRow = () => {
    const row = $('inside-line');
    const crumbs = [...row.querySelectorAll('.inside-crumb')].map((b) => b.textContent.trim()).join(' › ');
    return row.hidden ? '' : crumbs;
  };

  await step('A Python file shows its language, and Tidy says why it is off', async () => {
    try {
      await pythonStep();
    } finally {
      await showSideAgain('Python');
    }
  });

  async function pythonStep() {
    const tab = await dropFile('game.py', GAME_PY, 'Python');
    if (sideShown() || S.sideShown) throw new Error('the side did not hide by itself for a Python file');
    const room = $('main').getBoundingClientRect().right - $('left').getBoundingClientRect().right;
    if (room > 13) throw new Error(`the code ends ${Math.round(room)} px before the window edge`);
    const letters = tab.querySelector('.tab-letters text');
    if (!letters || letters.textContent !== 'PY') throw new Error(`the tab shows ${letters ? letters.textContent : 'no letters'}`);
    const label = must($('lang-label'), 'the language label');
    if (label.textContent !== 'Python') throw new Error(`the label says ${label.textContent}`);
    const tidy = must($('btn-tidy'), 'Tidy');
    if (tidy.getAttribute('aria-disabled') !== 'true') throw new Error('Tidy is not greyed');
    if (tidy.title !== 'Tidy is off for Python files, because spaces change what the code means.') throw new Error(`Tidy says ${tidy.title}`);
    if (label.getBoundingClientRect().right > tidy.getBoundingClientRect().left + 1) throw new Error('the label is not left of Tidy');
    await clickAfter('if self.y == 0:', 'click after the if line');
    await until(() => insideRow() === 'class Player › def jump › if', () => `the inside row, saw "${insideRow()}"`, 3000);
    const before = code();
    await clickOn(tidy, 'the greyed Tidy');
    await frames(3);
    if (code() !== before) throw new Error('the greyed Tidy changed the code');
    await picture('python-side-hidden-by-itself');
  }

  await step('With no page in its folder, the side says so, and Hide this side hides it', async () => {
    try {
      if (!activeTab() || activeTab().name !== 'game.py') throw new Error('game.py is not the active tab');
      if (!S.sideShown) await clickOn(sideButton(), 'the side button');
      const box = await until(() => present($('page-none')) && $('page-none'), 'the no-page side', 4000);
      const title = box.querySelector('.none-title').textContent;
      if (title !== 'This file has no page to show.') throw new Error(`the title says ${title}`);
      const line = $('page-none-line').textContent;
      const want = 'game.py is not a web page. My page shows web pages made with HTML, and this folder has none.';
      if (line !== want) throw new Error(`the line says ${line}`);
      must($('page-none-help'), 'Open Help');
      await clickOn(must($('btn-hide-side'), 'Hide this side'), 'Hide this side');
      if (sideShown() || S.sideShown) throw new Error('Hide this side did not hide the side');
      await clickOn(sideButton(), 'the side button');
      await until(() => present($('page-none')), 'the no-page side again', 4000);
    } finally {
      await showSideAgain('no page');
    }
  });

  await step('A JSON file shows its key path, and Tidy fixes its indents', async () => {
    const tab = await dropFile('levels.json', LEVELS_JSON, 'JSON');
    const letters = tab.querySelector('.tab-letters text');
    if (!letters || letters.textContent !== 'JSON') throw new Error(`the tab shows ${letters ? letters.textContent : 'no letters'}`);
    const label = must($('lang-label'), 'the language label');
    if (label.textContent !== 'JSON') throw new Error(`the label says ${label.textContent}`);
    await clickAfter('{ "coins": 5', 'click after the second coins');
    await until(() => insideRow() === 'levels › 1 › coins', () => `the inside row, saw "${insideRow()}"`, 3000);
    const tidy = must($('btn-tidy'), 'Tidy');
    if (tidy.hasAttribute('aria-disabled')) throw new Error('Tidy is greyed for JSON');
    const before = code();
    await clickOn(tidy, 'Tidy');
    await until(() => code() !== before, 'Tidy to change the indents', 3000);
    const lead = (needle) => /^[ \t]*/.exec(code().split('\n').find((line) => line.includes(needle)))[0];
    const strip = (text) => text.replace(/^[ \t]+/gm, '');
    if (strip(code()) !== strip(before)) throw new Error(`Tidy changed more than indents: ${JSON.stringify(code())}`);
    if (lead('"coins": 3') !== lead('"coins": 5') || lead('"coins": 3').length <= lead('"levels"').length) {
      throw new Error(`the coins lines are not lined up inside levels: ${JSON.stringify(code())}`);
    }
  });

  const FROG_PAGE = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Frog Jump</title>\n</head>\n'
    + '<body>\n<h1>Frog Jump</h1>\n<p>Press any key to make the frog jump.</p>\n<div id="frog"></div>\n'
    + '<script src="game.js"></script>\n</body>\n</html>\n';
  const FROG_JS = "// Make the frog jump when a key is pressed\nconst frog = document.querySelector('#frog');\nlet height = 0;\n\n"
    + 'function jump() {\n  if (height > 0) {\n    return;\n  }\n  height = 120;\n}\n\n'
    + "document.addEventListener('keydown', jump);\n";

  await step('A script file shows the page that uses it, with the script note', async () => {
    try {
      if (!temp) throw new Error('no temp folder for the frog files');
      const dir = `${temp}/frog-jump`;
      if (!(await invoke('test_make_folder', { path: dir }))) throw new Error('the frog folder was not made');
      const bytes = (text) => Array.from(new TextEncoder().encode(text));
      if (!(await invoke('test_write_bytes', { path: `${dir}/index.html`, bytes: bytes(FROG_PAGE) }))) throw new Error('index.html was not written');
      if (!(await invoke('test_write_bytes', { path: `${dir}/game.js`, bytes: bytes(FROG_JS) }))) throw new Error('game.js was not written');
      await flows.droppedFiles([`${dir}/game.js`]);
      await until(() => activeTab() && activeTab().name === 'game.js', 'game.js to open');
      if (S.tabs.some((t) => t.name === 'index.html' && t.path.startsWith(dir))) throw new Error('index.html opened as a tab');
      if (S.sideShown) await clickOn(sideButton(), 'the side button, to hide the side');
      if (sideShown()) throw new Error('the side did not hide');
      await clickOn(sideButton(), 'the side button, to show the side');
      await until(() => $('page-label').textContent === 'Showing index.html, which uses game.js', () => `the label, saw "${$('page-label').textContent}"`, 6000);
      await settled(preview);
      await until(() => $('page-hint').textContent === preview.SCRIPT_HINT, () => `the script note, saw "${$('page-hint').textContent}"`, 4000);
      const h1 = await probe(preview, 'h1');
      if (h1.text !== 'Frog Jump') throw new Error(`the page shows ${h1.text}`);
    } finally {
      await showSideAgain('script file');
    }
  });

  // WP5 (mockups 05 to 08): Change Name through real pointer events and keys.
  const RENAME_TIP = 'Type a new name. Press Enter to change it, or Esc to stop.';
  const renameDir = temp ? `${temp}/rename-club` : null;
  const renameField = () => document.querySelector('#tab-list .tab-rename');
  const renameToast = () => ($('rename-toast').hidden ? '' : $('rename-toast-text').textContent);

  // Teeth: with the `opens && rename.renameFlow(path)` branch taken out of the #tab-list click
  // handler (app.js), the click only switches tabs and no field shows.
  await step('Change Name: a click on the name of the active tab opens the field', async () => {
    if (!renameDir) throw new Error('no temp folder for the rename files');
    if (!(await invoke('test_make_folder', { path: renameDir }))) throw new Error('the rename folder was not made');
    const bytes = (text) => Array.from(new TextEncoder().encode(text));
    const page = '<!doctype html>\n<html lang="en">\n<head>\n<title>Club</title>\n</head>\n<body>\n'
      + '<nav><a href="about.html">About</a></nav>\n<h1>Our club</h1>\n<p><a href="about.html">Read about us</a></p>\n</body>\n</html>\n';
    const about = '<!doctype html>\n<html lang="en">\n<head>\n<title>About</title>\n</head>\n<body>\n<h1>About us</h1>\n<a href="index.html">Home</a>\n</body>\n</html>\n';
    if (!(await invoke('test_write_bytes', { path: `${renameDir}/index.html`, bytes: bytes(page) }))) throw new Error('index.html was not written');
    if (!(await invoke('test_write_bytes', { path: `${renameDir}/about.html`, bytes: bytes(about) }))) throw new Error('about.html was not written');
    await flows.droppedFiles([`${renameDir}/index.html`, `${renameDir}/about.html`]);
    const aboutTab = () => [...document.querySelectorAll('#tab-list .tab')].find((el) => el.dataset.path === `${renameDir}/about.html`);
    await until(() => aboutTab(), 'the about.html tab');
    await clickOn(aboutTab().querySelector('.tab-main'), 'the about.html tab');
    await until(() => activeTab() && activeTab().name === 'about.html', 'about.html to be the active tab');
    await wait(700);
    await clickOn(aboutTab().querySelector('.tab-name'), 'the name of the active tab');
    const field = must(await until(() => renameField(), 'the Change Name field'), 'the Change Name field');
    if (document.activeElement !== field) throw new Error(`the focus is on ${describe(document.activeElement)}`);
    if (field.value !== 'about.html') throw new Error(`the field says ${field.value}`);
    must($('rename-tip'), 'the tooltip');
    if ($('rename-tip').textContent !== RENAME_TIP) throw new Error(`the tooltip says ${$('rename-tip').textContent}`);
  });

  // Teeth: with `input.setSelectionRange(0, dot > 0 ? dot : tab.name.length)` in renameFlow
  // (rename.js) set to `input.select()`, typing gives team, not team.html.
  await step('Change Name: a new name and Enter show the places that use it', async () => {
    const field = must(renameField(), 'the Change Name field');
    if (field.selectionStart !== 0 || field.selectionEnd !== 5) throw new Error('the part before the dot is not chosen');
    typeText('team');
    if (field.value !== 'team.html') throw new Error(`the field says ${field.value}`);
    await until(() => $('rename-tip').textContent === RENAME_TIP, 'the tooltip after typing');
    key('Enter');
    const box = await until(() => dialog() && dialog().textContent.includes('Change the name to team.html?') && dialog(), 'the Change Name dialog');
    const places = box.querySelectorAll('.rn-place');
    if (places.length !== 2) throw new Error(`the dialog lists ${places.length} places`);
    must(box.querySelector('[data-tick]'), 'the tick');
    if (!box.querySelector('[data-tick]').checked) throw new Error('the tick is off at first');
    must(byText('Change the name', box), 'Change the name');
  });

  // Teeth: with `warn.hidden = on;` taken out of paintTick (dialogs.js), the warning is never
  // visible and must() fails.
  await step('Change Name: unticked, the amber warning and Change only the file name show', async () => {
    const box = must(dialog(), 'the Change Name dialog');
    await clickOn(box.querySelector('[data-tick]'), 'the tick');
    const warn = must(box.querySelector('[data-warn]'), 'the amber warning');
    if (!warn.textContent.includes('Are you sure? The 2 places will still say about.html')) throw new Error(`the warning says ${warn.textContent.trim()}`);
    must(byText('Change only the file name', box), 'Change only the file name');
    if (present(box.querySelector('[data-go]'))) throw new Error('Change the name still shows');
    if (document.activeElement !== box.querySelector('[data-tick]')) throw new Error(`the focus is on ${describe(document.activeElement)}`);
  });

  // Teeth: with `#rename-toast { position: absolute; ... }` given `bottom: -200px`, the toast is
  // off the panel and must() fails; with showToast not called in confirmAndRename (rename.js),
  // no toast comes.
  await step('Change Name: Change the name gives the toast with Undo', async () => {
    const box = must(dialog(), 'the Change Name dialog');
    await clickOn(box.querySelector('[data-tick]'), 'the tick again');
    await clickOn(byText('Change the name', box), 'Change the name');
    await until(() => !dialog(), 'the dialog to close', 8000);
    await until(() => renameToast(), 'the toast');
    must($('rename-toast'), 'the toast');
    if (renameToast() !== 'Name changed. 2 places now say team.html, in 1 file.') throw new Error(`the toast says ${renameToast()}`);
    must($('rename-undo'), 'Undo');
    const files = await invoke('test_list_folder', { path: renameDir });
    if (!files.includes('team.html') || files.includes('about.html')) throw new Error(`the folder holds ${files.join(', ')}`);
    if (!activeTab() || activeTab().name !== 'team.html') throw new Error('the tab does not say team.html');
  });

  // Teeth: with `$('rename-undo').addEventListener('click', ...)` taken out of initRename
  // (rename.js), the click does nothing and the toast never says the old name is back.
  await step('Change Name: Undo puts the old name back', async () => {
    await clickOn($('rename-undo'), 'Undo');
    await until(() => renameToast() === 'The old name is back.', () => `the toast after Undo, saw "${renameToast()}"`);
    const files = await invoke('test_list_folder', { path: renameDir });
    if (!files.includes('about.html') || files.includes('team.html')) throw new Error(`the folder holds ${files.join(', ')}`);
    if (!activeTab() || activeTab().name !== 'about.html') throw new Error('the tab does not say about.html');
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
