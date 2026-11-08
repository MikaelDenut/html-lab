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

function openDialog({ cls, html, cancelValue, enterPresses = true, setup, firstFocus }) {
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

function askHead({ title, line, tileIcon, amber }) {
  return `<div class="dlg-head">
    <span class="dlg-tile${amber ? ' amber' : ''}" aria-hidden="true">${icon(tileIcon, 's34')}</span>
    <div class="dlg-head-text">
      <h2 id="dlg-title" class="dlg-title">${esc(title)}</h2>
      <p class="dlg-line">${esc(line)}</p>
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

export function showAddFileDialog({ kinds, kindDefault, cssName = null, pageName = null, cleanName, nameFree }) {
  const startKind = kinds.find((k) => k.id === kindDefault) || kinds[0];
  const choices = kinds.map((k) => `
    <label class="choice${k === startKind ? ' on' : ''}" data-kind="${esc(k.id)}">
      <input type="radio" name="dlg-kind" value="${esc(k.id)}"${k === startKind ? ' checked' : ''}>
      ${icon(k.icon, 's30', k.colorToken)}
      <span><span class="choice-title">${esc(k.label)}</span><span class="choice-line">${esc(k.blurb)}</span></span>
    </label>`).join('');
  const html = `
    <h2 id="dlg-title" class="dlg-title-big add-title">Add a new file</h2>
    <div class="choices" role="radiogroup" aria-label="Kind of file">${choices}</div>
    <label class="dlg-label add-name-label" for="dlg-file">File name</label>
    <div class="field mono"><input id="dlg-file" type="text" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"><span class="field-ext" data-ext></span></div>
    <p class="dlg-note" data-hint role="status"></p>
    <label class="tick-row" data-tick-row><input type="checkbox" data-tick checked><span class="tick-text" data-tick-text></span></label>
    <div class="dlg-btns m22">
      ${button('Cancel', null, false)}
      <button class="btn btn-primary" type="button" data-primary data-ok>Add this file</button>
    </div>`;

  return openDialog({
    cls: 'dlg-560',
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

      let kind = startKind;
      let typed = false;
      let seq = 0;
      let stem = '';
      let taken = false;

      function ext() {
        return `.${kind.primaryExt}`;
      }

      function tickWording() {
        if (kind.isPage) return cssName ? `Use ${cssName} on this page` : '';
        return pageName ? `Link it to ${pageName}, so the page uses it` : '';
      }

      function paint() {
        extEl.textContent = ext();
        const file = stem + ext();
        let text = `You will get ${file}`;
        if (!stem) text = 'Your file needs a name.';
        else if (taken) text = `You already have a file called ${file}.`;
        hint.textContent = text;
        hint.classList.toggle('warn', !stem || taken);
        ok.disabled = !stem || taken;
        const wording = tickWording();
        tickText.textContent = wording;
        tickRow.hidden = !wording;
        for (const label of box.querySelectorAll('.choice')) {
          label.classList.toggle('on', label.dataset.kind === kind.id);
        }
      }

      async function check() {
        const mine = ++seq;
        const forKind = kind;
        const value = await cleanName(input.value);
        if (mine !== seq || dlg.closed) return null;
        if (!value) {
          stem = '';
          taken = false;
          paint();
          return null;
        }
        const free = await nameFree(value + `.${forKind.primaryExt}`);
        if (mine !== seq || dlg.closed) return null;
        stem = value;
        taken = !free;
        paint();
        return free ? { kind: forKind, stem: value } : null;
      }

      async function applyDefault() {
        const mine = ++seq;
        const forKind = kind;
        input.value = forKind.defaultStem;
        stem = forKind.defaultStem;
        taken = false;
        paint();
        if (document.activeElement === input) input.select();
        const free = await nameFree(`${forKind.defaultStem}.${forKind.primaryExt}`);
        if (free || mine !== seq || dlg.closed) return;
        input.value = '';
        stem = '';
        paint();
      }

      input.addEventListener('input', () => {
        typed = true;
        check();
      });

      for (const radio of box.querySelectorAll('input[type="radio"]')) {
        radio.addEventListener('change', () => {
          kind = kinds.find((k) => k.id === radio.value) || kind;
          paint();
          if (typed) check();
          else applyDefault();
        });
      }

      ok.addEventListener('click', async () => {
        const result = await check();
        if (!result) return;
        const file = result.stem + `.${result.kind.primaryExt}`;
        dlg.finish({
          kind: result.kind.id,
          stem: result.stem,
          file,
          tick: !tickRow.hidden && tick.checked,
        });
      });

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
