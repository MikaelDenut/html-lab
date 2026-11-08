// The "You are inside" row under the code: the tags (or CSS rule) that hold the cursor.

const LEAD = 'You are inside:';
const NO_TAG = 'You are not inside a tag here.';
const NO_RULE = 'You are not inside a rule here.';

let S = null;
let host = null;
let frame = 0;
let shown = null; // key of what the row shows, '' while it is empty
let width = -1;

export function initInside({ S: state }) {
  S = state;
  host = document.getElementById('inside-line');
  if (!host) return;
  host.addEventListener('mousedown', keepFocus);
  host.addEventListener('click', onClick);
  if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(host);
}

export function updateInside() {
  if (frame || !host) return;
  frame = requestAnimationFrame(render);
}

function tabView() {
  const view = S && S.ed ? S.ed.view : null;
  return view && view.htmllabTab && S.E && S.E.insidePath ? view : null;
}

function render() {
  frame = 0;
  const view = tabView();
  if (!view) {
    if (shown !== '') host.textContent = '';
    shown = '';
    return;
  }
  const path = S.E.insidePath(view.state);
  if (path.key === shown) return;
  shown = path.key;
  draw(path);
}

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  if (text) el.textContent = text;
  return el;
}

function separator() {
  const el = span('inside-sep', '›');
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function draw(path) {
  host.textContent = '';
  if (!path.items.length) {
    host.append(span('inside-none', path.kind === 'no-rule' ? NO_RULE : NO_TAG));
    return;
  }
  const crumbs = span('inside-crumbs', '');
  crumbs.append(span('inside-more', '…'), separator());
  path.items.forEach((item, i) => {
    if (i) crumbs.append(separator());
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inside-crumb';
    button.dataset.i = String(i);
    button.textContent = item.label;
    crumbs.append(button);
  });
  host.append(span('inside-lead', LEAD), crumbs);
  fit(crumbs);
}

// widths: the "…", its separator, then crumb, separator, crumb ... crumb. Returns how many of the
// first crumbs give way to the "…" so the rest fits in room; 0 when all fit or only one is left.
export function crumbsToDrop(widths, room) {
  let total = 0;
  for (let i = 2; i < widths.length; i++) total += widths[i];
  if (total <= room + 0.5) return 0;
  total += widths[0] + widths[1];
  let drop = 0;
  for (let i = 2; total > room + 0.5 && i < widths.length - 1; i += 2) {
    total -= widths[i] + widths[i + 1];
    drop++;
  }
  return drop;
}

// One layout read: every width at once, then only removals.
function fit(crumbs) {
  const kids = Array.from(crumbs.children);
  const widths = kids.map((kid) => kid.getBoundingClientRect().width);
  const drop = crumbsToDrop(widths, crumbs.clientWidth);
  if (!drop) {
    kids[0].remove();
    kids[1].remove();
    return;
  }
  for (let i = 2; i < 2 + drop * 2; i++) kids[i].remove();
}

function keepFocus(event) {
  if (event.target.closest && event.target.closest('.inside-crumb')) event.preventDefault();
}

function onClick(event) {
  const button = event.target.closest ? event.target.closest('.inside-crumb') : null;
  const view = tabView();
  if (!button || !view) return;
  const path = S.E.insidePath(view.state);
  const item = path.items[Number(button.dataset.i)];
  if (path.key !== shown) updateInside();
  if (item && item.label === button.textContent) S.E.selectRange(view, item.from, item.to);
}

function onResize(entries) {
  const next = Math.round(entries[entries.length - 1].contentRect.width);
  if (next === width) return;
  width = next;
  if (host.querySelector('.inside-crumb')) {
    shown = null;
    updateInside();
  }
}
