import { schemeBase } from './platform.js';
import { icon, escapeHtml as esc } from './views.js';

let current = null;
let listener = null;

export function setDialogListener(fn) {
  listener = fn;
}

export function isDialogOpen() {
  return current !== null;
}

export function cancelDialog() {
  if (current) current.finish(current.cancelValue);
}

export const SAVE_COPY_TEXT = {
  heading: 'Save a copy of your project',
  line: 'Your changes go into the copy. Your old folder stays as it was when you last saved.',
  button: 'Save the copy',
  extraLine: 'and everything else in your folder',
};

const FOCUSABLE = 'button, input, [tabindex="0"]';

function behind(on) {
  for (const id of ['toolbar', 'main']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.inert = on;
    if (!('inert' in HTMLElement.prototype)) {
      if (on) el.setAttribute('aria-hidden', 'true');
      else el.removeAttribute('aria-hidden');
    }
  }
}

function giveBackFocus(previous) {
  const editor = document.querySelector('#editor-host > .editor-box:not([hidden]) .cm-content');
  if (editor && editor.offsetParent !== null) {
    editor.focus({ preventScroll: true });
  } else if (previous && previous !== document.body && previous.isConnected) {
    previous.focus({ preventScroll: true });
  }
}

function stops(box) {
  return [...box.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.disabled || el.hidden) return false;
    if (el.type === 'radio' && !el.checked) return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    return el.offsetParent !== null;
  });
}

function moveTab(box, backwards) {
  const list = stops(box);
  if (!list.length) return;
  const at = list.indexOf(document.activeElement);
  let next;
  if (at === -1) next = backwards ? list.length - 1 : 0;
  else next = (at + (backwards ? -1 : 1) + list.length) % list.length;
  list[next].focus();
  if (list[next].tagName === 'INPUT' && list[next].type === 'text') list[next].select();
}

// onEnter(event), when given, decides what Enter does instead of pressing [data-primary]
// (the Change Name dialog, WP5).
function openDialog({ cls, html, cancelValue, enterPresses = true, onEnter = null, setup, firstFocus }) {
  if (current) current.finish(current.cancelValue);
  const root = document.getElementById('dialog-root');
  const previous = document.activeElement;

  const box = document.createElement('div');
  box.className = `dlg ${cls}`;
  box.tabIndex = -1;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'dlg-title');
  box.innerHTML = html;

  return new Promise((resolve) => {
    const dlg = {
      box,
      cancelValue,
      busy: false,
      onEnter: null,
      finish: null,
      get closed() {
        return current !== dlg;
      },
    };

    const onKey = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        moveTab(box, e.shiftKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!dlg.busy) dlg.finish(dlg.cancelValue);
      } else if (e.key === 'Enter' && onEnter && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        if (!dlg.busy) onEnter(e);
      } else if (e.key === 'Enter' && enterPresses && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        const primary = box.querySelector('[data-primary]');
        if (primary && !primary.disabled) primary.click();
      }
    };

    dlg.finish = (value) => {
      if (current !== dlg) return;
      current = null;
      document.removeEventListener('keydown', onKey, true);
      root.hidden = true;
      root.replaceChildren();
      behind(false);
      giveBackFocus(previous);
      if (listener) listener(false);
      resolve(value);
    };

    box.addEventListener('click', (e) => {
      const button = e.target.closest('[data-answer]');
      if (button && !button.disabled && !dlg.busy) dlg.finish(JSON.parse(button.dataset.answer));
    });

    current = dlg;
    behind(true);
    root.replaceChildren(box);
    root.hidden = false;
    document.addEventListener('keydown', onKey, true);
    if (listener) listener(true);
    if (setup) setup(dlg);

    const first = firstFocus ? box.querySelector(firstFocus) : box.querySelector('[data-primary]');
    (first || box).focus();
    if (first && first.tagName === 'INPUT') first.select();
  });
}

function answer(value) {
  return esc(JSON.stringify(value));
}

function button(label, value, primary, extraClass = '') {
  const cls = primary ? 'btn btn-primary' : 'btn btn-secondary';
  const mark = primary ? ' data-primary' : '';
  return `<button class="${cls}${extraClass ? ` ${extraClass}` : ''}" type="button"${mark} data-answer="${answer(value)}">${esc(label)}</button>`;
}

function rowIcon(file, size, fallback) {
  const id = file.icon || fallback;
  return icon(id, `${size} ic-${id}`, file.color);
}

// A title or line is a string, or a list of strings and { code } parts, so a
// file name inside a sentence can show as code.
function rich(value) {
  if (!Array.isArray(value)) return esc(value);
  return value.map((part) => (typeof part === 'string' ? esc(part) : `<code class="dlg-code">${esc(part.code)}</code>`)).join('');
}

function askHead({ title, line, tileIcon, amber }) {
  const hasLine = Array.isArray(line) ? line.length > 0 : !!line;
  return `<div class="dlg-head">
    <span class="dlg-tile${amber ? ' amber' : ''}" aria-hidden="true">${icon(tileIcon, 's34')}</span>
    <div class="dlg-head-text">
      <h2 id="dlg-title" class="dlg-title">${rich(title)}</h2>
      ${hasLine ? `<p class="dlg-line">${rich(line)}</p>` : ''}
    </div>
  </div>`;
}

function sampleRow(sample) {
  const many = sample.style === 'file';
  const pic = many ? icon('sample-project', 's26', 'css') : icon('html-file', 's26', 'html');
  return `<button class="row" type="button" data-answer="${answer({ type: 'sample', id: sample.id })}">
    ${pic}
    <span class="row-text"><span class="row-title">${esc(sample.title)}</span><span class="row-line">${esc(sample.blurb)}</span></span>
    ${icon('caret-right-bold', 's14 tk-ink2')}
  </button>`;
}

function templateGalleryRow(count) {
  return `<button class="row row-templates" type="button" data-answer="${answer({ type: 'templates' })}">
    ${icon('templates', 's26 ic-templates')}
    <span class="row-text"><span class="row-title">Template gallery</span><span class="row-line">${count} finished websites to explore and change.</span></span>
    ${icon('caret-right-bold', 's14 tk-ink2')}
  </button>`;
}

export function showNewDialog({ samples = [], templates = [], focusSamples = false, focusTemplates = false } = {}) {
  const html = `
    <h2 id="dlg-title" class="new-title">What do you want to make?</h2>
    <div class="new-body">
      <h3 class="new-group">Start a new project</h3>
      <div class="cards">
        <button class="card" type="button" data-first data-answer="${answer({ type: 'project', style: 'inline' })}">
          <span class="card-pic" aria-hidden="true">
            <span class="card-file">
              ${icon('html-file', 's34', 'html')}
              <span><span class="c-tag">&lt;h1</span><span class="c-attr"> style=</span><span class="c-str">"color: teal;"</span><span class="c-tag">&gt;</span></span>
            </span>
          </span>
          <span><span class="card-title">Style inside the page</span><span class="card-line">One file. Colors and fonts go right in your tags.</span></span>
        </button>
        <button class="card" type="button" data-answer="${answer({ type: 'project', style: 'file' })}">
          <span class="card-pic" aria-hidden="true">
            <span class="card-file">${icon('html-file', 's34', 'html')}<span>my-page.html</span></span>
            ${icon('linked-files-bold', 's22 tk-ink2')}
            <span class="card-file">${icon('css-file', 's34', 'css')}<span>style.css</span></span>
          </span>
          <span><span class="card-title">Style in a separate file</span><span class="card-line">Two files. One for your page, one for how it looks.</span></span>
        </button>
      </div>
      <h3 class="new-group second">Or open a sample project</h3>
      <div class="sample-box">${samples.map(sampleRow).join('')}${templates.length ? templateGalleryRow(templates.length) : ''}</div>
    </div>
    <div class="new-foot">
      <span class="new-foot-line">Samples open as a copy, so you can change anything you like.</span>
      <button class="btn btn-secondary btn-44" type="button" data-answer="null">Cancel</button>
    </div>`;
  return openDialog({
    cls: 'dlg-820',
    html,
    cancelValue: null,
    enterPresses: false,
    firstFocus: focusTemplates ? '.row-templates' : focusSamples ? '.sample-box .row' : '[data-first]',
  });
}

const CATEGORIES = [
  ['fun', 'Fun'],
  ['professional', 'Professional'],
  ['industrial', 'Industrial'],
  ['creative', 'Creative'],
  ['science', 'Science'],
  ['effects', 'Effects'],
];

let galleryFilter = 'all';

export function templatePreviewUrl(template, size = 'previews') {
  const base = globalThis.htmlLabGalleryBase || schemeBase('gallery');
  return `${base}${size}/${template.id.replace(/^template-/, '')}.webp`;
}

function templateRow(template, index, first) {
  return `<button class="tpl-row" type="button" data-index="${index}" data-cat="${esc(template.category)}"${first ? ' data-first' : ''}
      style="--tpl-accent: ${esc(template.accent || '#0b6e69')}"
      data-answer="${answer({ type: 'sample', id: template.id })}">
    <img class="tpl-thumb" src="${esc(templatePreviewUrl(template, 'thumbs'))}" alt="" width="80" height="50" loading="lazy">
    <span class="row-text"><span class="row-title">${esc(template.title)}</span><span class="row-line">${esc(template.blurb)}</span></span>
  </button>`;
}

function templateShows(template) {
  return template.shows.map((line) => `<li>${icon('check', 's16')}<span>${esc(line)}</span></li>`).join('');
}

function templateList(templates, filter) {
  const firstIndex = templates.findIndex((t) => filter === 'all' || t.category === filter);
  let html = '';
  let last = null;
  templates.forEach((t, i) => {
    if (t.category !== last) {
      const label = (CATEGORIES.find(([id]) => id === t.category) || [t.category, t.category])[1];
      html += `<h3 class="tpl-cat" data-cat="${esc(t.category)}">${esc(label)}</h3>`;
      last = t.category;
    }
    html += templateRow(t, i, i === firstIndex);
  });
  return html;
}

function filterChips(templates, filter) {
  const chip = (id, label, count) =>
    `<button class="tpl-chip" type="button" data-filter="${id}" aria-pressed="${id === filter}">${esc(label)}<span class="tpl-count">${count}</span></button>`;
  return [chip('all', 'All', templates.length)]
    .concat(CATEGORIES.map(([id, label]) => [id, label, templates.filter((t) => t.category === id).length])
      .filter(([, , count]) => count > 0)
      .map(([id, label, count]) => chip(id, label, count)))
    .join('');
}

const KEEP_PREVIEWS = 8;

export function showTemplateDialog({ templates }) {
  if (galleryFilter !== 'all' && !templates.some((t) => t.category === galleryFilter)) galleryFilter = 'all';
  const firstIndex = Math.max(0, templates.findIndex((t) => galleryFilter === 'all' || t.category === galleryFilter));
  const first = templates[firstIndex];
  const html = `
    <h2 id="dlg-title" class="new-title">Template gallery</h2>
    <div class="tpl-filters" role="group" aria-label="Show templates">${filterChips(templates, galleryFilter)}</div>
    <div class="tpl-body">
      <div class="tpl-list">${templateList(templates, galleryFilter)}</div>
      <div class="tpl-side">
        <div class="tpl-frame"><img class="tpl-big" alt="${esc(`The ${first.title} template`)}"></div>
        <h3 class="tpl-name" id="tpl-name">${esc(first.title)}</h3>
        <p class="tpl-layout" id="tpl-layout">${esc(first.layout)}</p>
        <p class="tpl-what">What it shows:</p>
        <ul class="tpl-shows" id="tpl-shows">${templateShows(first)}</ul>
      </div>
    </div>
    <div class="new-foot">
      <button class="btn btn-secondary btn-44 tpl-back" type="button" data-answer="${answer({ type: 'back' })}">${icon('caret-left', 's16')}<span>Back</span></button>
      <span class="new-foot-line">Each one opens as your own copy, with all its pages and pictures.</span>
      <button class="btn btn-secondary btn-44" type="button" data-answer="null">Cancel</button>
    </div>`;
  return openDialog({
    cls: 'dlg-820 dlg-templates',
    html,
    cancelValue: null,
    enterPresses: false,
    firstFocus: '[data-first]',
    setup(dlg) {
      const big = dlg.box.querySelector('.tpl-big');
      const name = dlg.box.querySelector('#tpl-name');
      const layout = dlg.box.querySelector('#tpl-layout');
      const shows = dlg.box.querySelector('#tpl-shows');
      const list = dlg.box.querySelector('.tpl-list');
      const chips = [...dlg.box.querySelectorAll('.tpl-chip')];
      const rows = [...list.querySelectorAll('.tpl-row')];
      const heads = [...list.querySelectorAll('.tpl-cat')];
      const visibleRows = () => rows.filter((row) => !row.hidden);

      const decoded = new Map();
      const ready = (index) => {
        let job = decoded.get(index);
        if (job) {
          decoded.delete(index);
        } else {
          const img = new Image();
          img.src = templatePreviewUrl(templates[index]);
          job = (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => img);
        }
        decoded.set(index, job);
        if (decoded.size > KEEP_PREVIEWS) decoded.delete(decoded.keys().next().value);
        return job;
      };
      let wanted = -1;
      const warmAround = (index) => {
        const shown = visibleRows();
        const at = shown.findIndex((row) => Number(row.dataset.index) === index);
        for (const near of [shown[at + 1], shown[at - 1]]) if (near) ready(Number(near.dataset.index));
      };
      const show = (index) => {
        if (index === wanted || !templates[index]) return;
        wanted = index;
        const t = templates[index];
        name.textContent = t.title;
        layout.textContent = t.layout;
        shows.innerHTML = templateShows(t);
        ready(index).then(() => {
          if (wanted !== index || dlg.closed) return;
          big.src = templatePreviewUrl(t);
          big.alt = `The ${t.title} template`;
          big.dataset.index = String(index);
        });
        warmAround(index);
      };

      const oneStop = (items, item) => {
        for (const other of items) other.tabIndex = other === item ? 0 : -1;
      };
      const applyFilter = (filter) => {
        galleryFilter = filter;
        for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
        oneStop(chips, chips.find((chip) => chip.dataset.filter === filter));
        for (const row of rows) row.hidden = filter !== 'all' && row.dataset.cat !== filter;
        for (const head of heads) head.hidden = filter !== 'all';
        list.scrollTop = 0;
        const top = visibleRows()[0];
        oneStop(rows, top);
        if (top) show(Number(top.dataset.index));
      };
      applyFilter(galleryFilter);

      const filters = dlg.box.querySelector('.tpl-filters');
      filters.addEventListener('click', (e) => {
        const chip = e.target.closest('.tpl-chip');
        if (chip) applyFilter(chip.dataset.filter);
      });
      filters.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const at = chips.indexOf(document.activeElement);
        const next = chips[(at + (e.key === 'ArrowRight' ? 1 : chips.length - 1)) % chips.length];
        oneStop(chips, next);
        next.focus();
      });

      const mark = (row) => {
        if (!row) return;
        oneStop(rows, row);
        show(Number(row.dataset.index));
      };
      list.addEventListener('mouseover', (e) => {
        const row = e.target.closest('.tpl-row');
        if (row && row !== document.activeElement) row.focus({ preventScroll: true });
        mark(row);
      });
      list.addEventListener('focusin', (e) => mark(e.target.closest('.tpl-row')));
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const shown = visibleRows();
        const at = shown.indexOf(document.activeElement);
        const next = shown[(at + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length];
        next.focus();
        mark(next);
      });
      setTimeout(() => {
        if (!dlg.closed) visibleRows().slice(0, 6).forEach((row) => ready(Number(row.dataset.index)));
      }, 120);
    },
  });
}

function saveErrorText(code, name) {
  if (code === 'folder_exists') return `You already have a folder called ${name} here. Pick another name.`;
  if (code === 'cannot_write') return 'HTML Lab cannot save here. Choose another place.';
  return code;
}

export function showSaveDialog({
  heading = 'Save your project',
  line = 'HTML Lab makes a folder and puts all your files in it.',
  button: buttonLabel = 'Save my project',
  name = '',
  place = 'Documents',
  placePath = '',
  files = [],
  extraLine = '',
  cleanName,
  choosePlace,
  submit,
}) {
  const rows = files.map((f) => `<div class="get-file">${rowIcon(f, 's20', 'html-file')}<span>${esc(f.name)}</span></div>`).join('');
  const html = `
    <h2 id="dlg-title" class="dlg-title-big">${esc(heading)}</h2>
    <p class="dlg-line-big">${esc(line)}</p>
    <label class="dlg-label" for="dlg-name">Project name</label>
    <div class="field"><input id="dlg-name" type="text" value="${esc(name)}" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></div>
    <p class="dlg-note warn" data-msg role="status" hidden></p>
    <div class="dlg-label place-label">Save it in</div>
    <div class="place-row">
      ${icon('project-folder', 's24 tk-brand')}
      <span class="place-name" data-place>${esc(place)}</span>
      <button class="place-btn" type="button" data-choose>Choose a place</button>
    </div>
    <div class="get-box">
      <div class="get-title">You will get</div>
      <div class="get-folder">${icon('project-folder', 's22 tk-brand')}<span class="get-folder-name" data-folder></span></div>
      <div class="get-files">${rows}</div>
      ${extraLine ? `<div class="get-extra">${esc(extraLine)}</div>` : ''}
    </div>
    <div class="dlg-btns m20">
      ${button('Cancel', null, false)}
      <button class="btn btn-primary" type="button" data-primary data-ok>${esc(buttonLabel)}</button>
    </div>`;

  return openDialog({
    cls: 'dlg-560',
    html,
    cancelValue: null,
    firstFocus: '#dlg-name',
    setup(dlg) {
      const { box } = dlg;
      const input = box.querySelector('#dlg-name');
      const msg = box.querySelector('[data-msg]');
      const folder = box.querySelector('[data-folder]');
      const placeEl = box.querySelector('[data-place]');
      const ok = box.querySelector('[data-ok]');

      let seq = 0;
      let clean = name.trim().replace(/[/:]/g, '-');
      let parent = placePath;
      let placeName = place;
      let error = '';

      function paint() {
        folder.textContent = `${placeName} / ${clean || '...'}`;
        const text = error || (clean ? '' : 'Your project needs a name.');
        msg.textContent = text;
        msg.hidden = !text;
        ok.disabled = !clean || dlg.busy;
      }

      async function cleanNow() {
        const mine = ++seq;
        const value = await cleanName(input.value);
        return mine === seq && !dlg.closed ? value : null;
      }

      input.addEventListener('input', async () => {
        const value = await cleanNow();
        if (value === null) return;
        clean = value;
        error = '';
        paint();
      });

      box.querySelector('[data-choose]').addEventListener('click', async () => {
        if (dlg.busy) return;
        const picked = await choosePlace(parent);
        if (!picked || dlg.closed) return;
        parent = picked.path;
        placeName = picked.name;
        placeEl.textContent = placeName;
        error = '';
        paint();
      });

      ok.addEventListener('click', async () => {
        if (dlg.busy) return;
        dlg.busy = true;
        paint();
        const value = await cleanNow();
        if (value === null || !value) {
          if (dlg.closed) return;
          dlg.busy = false;
          if (value === '') clean = '';
          paint();
          return;
        }
        clean = value;
        let reply;
        try {
          reply = await submit({ name: value, parent });
        } catch {
          reply = { error: 'cannot_write' };
        }
        if (dlg.closed) return;
        dlg.busy = false;
        if (!reply) {
          dlg.finish({ name: value, parent });
          return;
        }
        error = saveErrorText(reply.error, value);
        paint();
        input.focus();
        input.select();
      });

      paint();
      cleanNow().then((value) => {
        if (value === null) return;
        clean = value;
        paint();
      });
    },
  });
}

// The copy-table field message ("Change a name") for a problem from check_name. A name or a
// character inside the sentence is code. `name` is the name that was checked.
export function nameProblemText(problem, name) {
  switch (problem.code) {
    case 'bad_char':
      return ['A name cannot have ', { code: problem.char }, ' in it.'];
    case 'space_edge':
      return 'A name cannot start or end with a space.';
    case 'dots':
      return 'A name cannot end with a dot.';
    case 'reserved':
      return [{ code: name }, ' is a name the computer keeps for itself. Pick another name.'];
    case 'too_long':
      return 'This name is too long. Make it shorter.';
    default:
      return 'Type a name first.';
  }
}

const NEW_FILE_NO_NAME = 'Your file needs a name.';
const NEW_FILE_OTHER_HINT = 'Type the whole name with its ending, like notes.md.';
const asciiLower = (text) => text.replace(/[A-Z]+/g, (part) => part.toLowerCase());

// Make a new file (0.3.0 WP4, mockup 11). The chips are native radios, so arrow keys move
// between them. Web page and Style take their ending and default name from the teaching
// kinds and go through the web cleaner; every other name goes through check_name as typed.
export function showNewFileDialog({ kinds, startChip, cssName = null, pageName = null, cleanName, checkName, nameFree }) {
  const page = kinds.find((k) => k.isPage);
  const style = kinds.find((k) => k.previewMode === 'swap');
  const chips = [
    page && { id: 'page', label: 'Web page', ending: `.${page.primaryExt}`, stem: page.defaultStem, kind: page },
    style && { id: 'style', label: 'Style', ending: `.${style.primaryExt}`, stem: style.defaultStem, kind: style },
    { id: 'script', label: 'Script', ending: '.js', stem: 'script', kind: null },
    { id: 'text', label: 'Text', ending: '.txt', stem: 'notes', kind: null },
    { id: 'other', label: 'Other', ending: '', stem: '', kind: null },
  ].filter(Boolean);
  const first = chips.find((c) => c.id === startChip) || chips[0];
  const chipHtml = chips.map((c) => `
      <label class="nf-chip" data-chip="${c.id}">
        <input type="radio" name="dlg-kind" value="${c.id}"${c === first ? ' checked' : ''}>
        <span class="nf-face">${esc(c.label)}${c.ending ? ` <code class="nf-end">${esc(c.ending)}</code>` : ''}</span>
      </label>`).join('');
  const html = `
    <div class="dlg-head nf-head">
      <span class="dlg-tile" aria-hidden="true">${icon('file-plus', 's34')}</span>
      <h2 id="dlg-title" class="dlg-title">Make a new file</h2>
    </div>
    <label class="dlg-label nf-label" for="dlg-file">Name</label>
    <div class="field mono"><input id="dlg-file" type="text" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"><span class="field-ext" data-ext></span></div>
    <div class="nf-chips" role="radiogroup" aria-label="Kind of file">${chipHtml}</div>
    <p class="dlg-note nf-hint" data-hint role="status"></p>
    <label class="tick-row" data-tick-row><input type="checkbox" data-tick checked><span class="tick-text" data-tick-text></span></label>
    <div class="dlg-btns m22">
      ${button('Cancel', null, false)}
      <button class="btn btn-primary" type="button" data-primary data-ok>Make the file</button>
    </div>`;

  return openDialog({
    cls: 'dlg-600',
    html,
    cancelValue: null,
    firstFocus: '#dlg-file',
    setup(dlg) {
      const { box } = dlg;
      const input = box.querySelector('#dlg-file');
      const extEl = box.querySelector('[data-ext]');
      const hint = box.querySelector('[data-hint]');
      const ok = box.querySelector('[data-ok]');
      const tickRow = box.querySelector('[data-tick-row]');
      const tick = box.querySelector('[data-tick]');
      const tickText = box.querySelector('[data-tick-text]');

      let chip = first;
      let typed = false;
      let seq = 0;
      // null while the first check runs; then { empty } | { problem, name } | { name, kind, stem, taken }
      let found = null;

      // A teaching kind for a name, from the kinds table (an Other name may end in .html).
      function webKind(name) {
        const dot = name.lastIndexOf('.');
        if (dot <= 0) return null;
        const ext = asciiLower(name.slice(dot + 1));
        return kinds.find((k) => k.extensions.includes(ext)) || null;
      }

      function tickWording() {
        if (chip.id === 'page') return cssName ? `Use ${cssName} on this page` : '';
        if (chip.id === 'style') return pageName ? `Link it to ${pageName}, so the page uses it` : '';
        return '';
      }

      function paint() {
        extEl.textContent = chip.ending;
        extEl.hidden = !chip.ending;
        let text = '';
        let warn = false;
        if (found && found.empty) {
          text = chip.id === 'other' ? NEW_FILE_OTHER_HINT : NEW_FILE_NO_NAME;
          warn = chip.id !== 'other';
        } else if (found && found.problem) {
          text = nameProblemText(found.problem, found.name);
          warn = true;
        } else if (found && found.taken) {
          text = ['You already have a file called ', { code: found.name }, '.'];
          warn = true;
        } else if (found) {
          text = ['You will get ', { code: found.name }, '.'];
        }
        hint.innerHTML = rich(text);
        hint.classList.toggle('warn', warn);
        ok.disabled = !found || !!(found.empty || found.problem || found.taken);
        const wording = tickWording();
        tickText.textContent = wording;
        tickRow.hidden = !wording;
      }

      async function resolve(raw, forChip) {
        if (forChip.kind) {
          const stem = await cleanName(raw);
          if (!stem) return { empty: true };
          return { name: stem + forChip.ending, kind: forChip.kind, stem };
        }
        let base = raw;
        const end = forChip.ending;
        if (end && asciiLower(base.slice(-end.length)) === end) base = base.slice(0, -end.length);
        if (!base.trim()) return { empty: true };
        const wanted = base + end;
        const checked = await checkName(wanted);
        if (!checked.name) {
          return checked.problem.code === 'empty' ? { empty: true } : { problem: checked.problem, name: wanted };
        }
        const kind = webKind(checked.name);
        const stem = kind ? checked.name.slice(0, checked.name.lastIndexOf('.')) : null;
        return { name: checked.name, kind, stem };
      }

      // Runs the checks for the field as it is now; the newest call wins. Returns the
      // result when the file can be made, else null.
      async function check() {
        const mine = ++seq;
        const forChip = chip;
        const result = await resolve(input.value, forChip);
        if (mine !== seq || dlg.closed) return null;
        if (result.name && !result.problem) {
          result.taken = !(await nameFree(result.name));
          if (mine !== seq || dlg.closed) return null;
        }
        found = result;
        paint();
        return result.empty || result.problem || result.taken ? null : { ...result, chip: forChip };
      }

      async function applyDefault() {
        const forChip = chip;
        input.value = forChip.stem;
        if (document.activeElement === input) input.select();
        await check();
        if (dlg.closed || typed || chip !== forChip || !found || !found.taken) return;
        input.value = '';
        await check();
      }

      input.addEventListener('input', () => {
        typed = true;
        check();
      });

      for (const radio of box.querySelectorAll('input[type="radio"]')) {
        radio.addEventListener('change', () => {
          chip = chips.find((c) => c.id === radio.value) || chip;
          paint();
          if (typed) check();
          else applyDefault();
        });
      }

      ok.addEventListener('click', async () => {
        const result = await check();
        if (!result) return;
        dlg.finish({
          chip: result.chip.id,
          kind: result.kind ? result.kind.id : null,
          stem: result.stem,
          file: result.name,
          tick: !tickRow.hidden && tick.checked,
        });
      });

      paint();
      applyDefault();
    },
  });
}

function fileRow(file, fallback) {
  const tag = file.picked ? '<span class="file-tag">You picked this</span>' : '';
  return `<div class="file-row${file.picked ? ' picked' : ''}">${rowIcon(file, 's24', fallback)}<span class="file-name">${esc(file.name)}</span>${tag}</div>`;
}

export function showOpenAsk({ pickedName, folderName, files }) {
  const html = `
    ${askHead({
    title: 'Open all the files in this folder?',
    line: `You picked ${pickedName}. Its folder, ${folderName}, looks like a project: its HTML and CSS files go together.`,
    tileIcon: 'open',
  })}
    <div class="file-list">${files.map((f) => fileRow(f, 'html-file')).join('')}</div>
    <div class="dlg-btns m22">
      ${button('Just this file', 'one', false)}
      ${button(`Open all ${files.length} files`, 'all', true)}
    </div>`;
  return openDialog({ cls: 'dlg-560', html, cancelValue: 'one' });
}

export function showLinkedCssAsk({ pageName, files }) {
  const list = files.map((f) => (typeof f === 'string' ? { name: f } : f));
  const one = list.length === 1;
  const title = one ? `Open ${list[0].name} too?` : 'Open its style files too?';
  const line = one
    ? `${pageName} uses ${list[0].name}. Open it so you can change it.`
    : `${pageName} uses these files. Open them so you can change them.`;
  const yes = one ? `Open ${list[0].name} too` : `Open ${list.length} files too`;
  const rows = one ? '' : `<div class="file-list">${list.map((f) => fileRow(f, 'css-file')).join('')}</div>`;
  const html = `
    ${askHead({ title, line, tileIcon: 'open' })}
    ${rows}
    <div class="dlg-btns m22">
      ${button('Just this page', 'no', false)}
      ${button(yes, 'yes', true)}
    </div>`;
  return openDialog({ cls: 'dlg-560', html, cancelValue: 'no' });
}

export function showSaveAsk({ fileName, count, wholeFile = false }) {
  const several = !fileName && count > 0;
  let title = `Save ${fileName} before closing?`;
  let line = 'You changed this file. If you do not save it, your new changes will be gone.';
  if (several) {
    title = 'Save your work before closing?';
    line = `You changed ${count} files. If you do not save them, your new changes will be gone.`;
  } else if (wholeFile) {
    line = 'You changed this file. If you do not save it, the whole file will be gone from your project.';
  }
  const html = `
    ${askHead({ title, line, tileIcon: 'save' })}
    <div class="dlg-btns">
      ${button("Don't save", 'discard', false)}
      ${button('Keep working', 'cancel', false)}
      ${button('Save my work', 'save', true)}
    </div>`;
  return openDialog({ cls: 'dlg-540', html, cancelValue: 'cancel' });
}

export function showTakeOutAsk({ fileName }) {
  const html = `
    ${askHead({
    title: `Take ${fileName} out of your project?`,
    line: 'Pages that use it will not find it any more.',
    tileIcon: 'oops-hint',
    amber: true,
  })}
    <div class="dlg-btns">
      ${button('Keep it', 'keep', true)}
      ${button('Take it out', 'remove', false)}
    </div>`;
  return openDialog({ cls: 'dlg-540', html, cancelValue: 'keep' });
}

export function showMessage({ title, text, buttons }) {
  const list = buttons && buttons.length ? buttons : [{ id: 'ok', label: 'OK', primary: true }];
  const primary = list.find((b) => b.primary) || list[list.length - 1];
  const other = list.find((b) => b !== primary);
  const html = `
    ${askHead({ title, line: text, tileIcon: 'oops-hint', amber: true })}
    <div class="dlg-btns">${list.map((b) => button(b.label, b.id, b === primary)).join('')}</div>`;
  return openDialog({ cls: 'dlg-540', html, cancelValue: (other || primary).id });
}

// Change the name (0.3.0 WP5, mockups 06, 07, 09). The places come from find_references:
// [{ file, line, lineText, lineFrom, lineTo }] with lineFrom/lineTo marking the old name in
// lineText. extra: [line, ...] (type change, a page that stops being a page). The tick is on at
// first; unticked, the amber warning and the amber "Change only the file name" show. That button
// never carries data-primary: Enter on a button presses it, Enter elsewhere presses "Change the
// name" when ticked and "Keep the old name" when unticked, and Esc always keeps the old name.
// submit(ticked) runs while the dialog is busy and gives { places, capped } to show a new list,
// or { value } to close with that value. -> 'keep' | value
export function showRenameDialog({ oldName, newName, places, capped, saved, extra = [], submit }) {
  const old = { code: oldName };
  function lineFor(n, stopped) {
    if (n > 1) return [`${n} places in this project use the old name `, old, '. If they keep the old name, those links stop working.'];
    if (n === 1) return ['1 place in this project uses the old name ', old, '. If it keeps the old name, that link stops working.'];
    if (stopped) return ['HTML Lab did not find ', old, ' in the first 2,000 files. Other files may still use it.'];
    return ['No other file in this project uses the name ', old, ', so nothing else needs to change.'];
  }
  function placeRow(place) {
    const text = place.lineText || '';
    const from = Math.max(0, Math.min(text.length, place.lineFrom));
    const to = Math.max(from, Math.min(text.length, place.lineTo));
    return `<div class="rn-place">
      <span class="rn-file">${esc(place.file)}</span>
      <span class="rn-line">line ${esc(place.line)}</span>
      <span class="rn-code">${esc(text.slice(0, from))}<mark class="rn-old">${esc(text.slice(from, to))}</mark>${esc(text.slice(to))}</span>
    </div>`;
  }
  function bodyHtml(list, stopped) {
    const n = list.length;
    const notes = [];
    if (n && stopped) notes.push('HTML Lab looked at the first 2,000 files only. Other files may still use the old name.');
    notes.push(...extra);
    const tickText = n > 1 ? `Change these ${n} places too` : 'Change this place too';
    const small = saved ? `HTML Lab writes ${newName} in each of them and saves those files.` : `HTML Lab writes ${newName} in each of them.`;
    return `
    <div class="dlg-head">
      <span class="dlg-tile amber" aria-hidden="true">${icon('pencil-simple', 's34')}</span>
      <div class="dlg-head-text">
        <h2 id="dlg-title" class="dlg-title">${esc(`Change the name to ${newName}?`)}</h2>
        <p class="dlg-line">${rich(lineFor(n, stopped))}</p>
      </div>
    </div>
    ${n ? `<div class="file-list rn-places">${list.map(placeRow).join('')}</div>` : ''}
    ${notes.map((note) => `<p class="dlg-note rn-note">${esc(note)}</p>`).join('')}
    ${n ? `<label class="rn-tick"><input type="checkbox" data-tick checked><span class="rn-tick-words"><span class="rn-tick-text">${esc(tickText)}</span><span class="rn-tick-small">${esc(small)}</span></span></label>` : ''}
    <div class="rn-warn" data-warn role="alert" hidden></div>
    <div class="dlg-btns m22">
      ${button('Keep the old name', 'keep', false)}
      <button class="btn btn-primary" type="button" data-primary data-go>Change the name</button>
      <button class="btn btn-amber" type="button" data-only hidden>Change only the file name</button>
    </div>`;
  }
  function warnHtml(n) {
    const words = n > 1
      ? `The ${n} places will still say ${oldName}, so those links will not work any more. You will have to change them yourself.`
      : `That place will still say ${oldName}, so that link will not work any more. You will have to change it yourself.`;
    return `${icon('oops-hint-bold', 's22')}<span><b>Are you sure?</b> ${esc(words)}</span>`;
  }

  let ref = null;
  return openDialog({
    cls: 'dlg-640 dlg-rename',
    html: bodyHtml(places, capped),
    cancelValue: 'keep',
    onEnter: () => {
      const { box } = ref;
      const focused = document.activeElement;
      if (focused && focused.tagName === 'BUTTON' && box.contains(focused)) {
        if (!focused.disabled) focused.click();
        return;
      }
      const tick = box.querySelector('[data-tick]');
      const target = !tick || tick.checked ? box.querySelector('[data-go]') : box.querySelector('[data-answer]');
      if (target && !target.disabled) target.click();
    },
    setup(dlg) {
      ref = dlg;
      const { box } = dlg;
      let count = places.length;

      function paintTick() {
        const tick = box.querySelector('[data-tick]');
        const on = !tick || tick.checked;
        const warn = box.querySelector('[data-warn]');
        warn.innerHTML = on ? '' : warnHtml(count);
        warn.hidden = on;
        box.querySelector('[data-go]').hidden = !on;
        box.querySelector('[data-only]').hidden = on;
      }

      async function go() {
        if (dlg.busy) return;
        const tick = box.querySelector('[data-tick]');
        const ticked = !!(tick && tick.checked);
        dlg.busy = true;
        box.classList.add('busy');
        for (const b of box.querySelectorAll('button, input')) b.disabled = true;
        let reply;
        try {
          reply = await submit(ticked);
        } catch {
          reply = { value: { fail: 'cannot_write' } };
        }
        if (dlg.closed) return;
        dlg.busy = false;
        box.classList.remove('busy');
        if (reply && reply.places) {
          count = reply.places.length;
          box.innerHTML = bodyHtml(reply.places, reply.capped);
          paintTick();
          box.querySelector('[data-go]').focus();
          return;
        }
        dlg.finish(reply ? reply.value : 'keep');
      }

      box.addEventListener('change', (e) => {
        if (!e.target.matches('[data-tick]')) return;
        paintTick();
        e.target.focus();
      });
      box.addEventListener('click', (e) => {
        if (e.target.closest('[data-go], [data-only]')) go();
      });
      paintTick();
    },
  });
}
