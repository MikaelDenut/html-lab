import { refreshCanAdd } from './help.js';
import { invoke } from './api.js';
import { kindOf, projectOf, S, activeTab, activeProject, isChanged, tabByPath, tabsOf, isPage, languageRow, tidyAllowed, tidyOffText } from './state.js';
import { tabHtml } from './views.js';
import * as preview from './preview.js';
import { boxesOn } from './link.js';
import { updateInside } from './inside.js';

const STATUS_TEXT = {
  fresh: { text: 'Not saved yet', mark: 'amber' },
  sample: { text: 'Sample copy. Press Save to keep it.', mark: 'bulb' },
  practice: { text: 'Practice copy. Press Save to keep it.', mark: 'bulb' },
  saved: { text: 'Saved', mark: 'check' },
};

let lastStatus = null;

export function dotOn(tab) {
  const project = projectOf(tab);
  return project.kind === 'new' || isChanged(tab);
}

function labelFor(tab) {
  // While the Change Name dialog is open the tab shows the new name (WP5).
  if (S.renaming && S.renaming.pending && S.renaming.path === tab.path) return S.renaming.pending;
  const project = projectOf(tab);
  if (project.kind === 'practice' && tabsOf(project).length === 1) return 'Practice';
  const twin = S.tabs.some((t) => t !== tab && t.name === tab.name);
  return twin ? `${tab.name} (${project.name})` : tab.name;
}

function tooltipFor(tab) {
  return projectOf(tab).folder ? tab.path : `${tab.name}, not saved yet`;
}

let lastStrip = '';
let lastActive = null;
let activeSince = 0;

// How long the active tab has been the active one, in ms: a click on its name changes the name
// only after 500 ms, so a double-click on another tab just switches to it (WP5).
export function activeFor() {
  return lastActive === S.activePath ? performance.now() - activeSince : 0;
}

// The Change Name field lives in a tab, so a rebuild of the strip takes it out and puts it back.
let stripHooks = { before: () => {}, after: () => {} };
export function setStripHooks(hooks) {
  stripHooks = hooks;
}

export function renderStrip() {
  const list = document.getElementById('tab-list');
  if (S.activePath !== lastActive) {
    lastActive = S.activePath;
    activeSince = performance.now();
  }
  const rows = S.tabs.map((tab) => {
    const kind = kindOf(tab);
    tab.dotShown = dotOn(tab);
    return {
      path: tab.path,
      name: tab.name,
      label: labelFor(tab),
      kind: kind.id,
      kindIcon: kind.icon,
      kindColor: kind.colorToken,
      letters: kind.teaching ? '' : languageRow(tab).letters,
      dirty: tab.dotShown,
      tooltip: tooltipFor(tab),
    };
  });
  const key = JSON.stringify(rows);
  if (key !== lastStrip || list.children.length !== rows.length) {
    lastStrip = key;
    stripHooks.before();
    list.innerHTML = rows.map((row) => tabHtml({ ...row, active: row.path === S.activePath })).join('');
    stripHooks.after();
  } else {
    for (const el of list.children) el.classList.toggle('active', el.dataset.path === S.activePath);
  }
  const active = list.querySelector('.tab.active');
  if (!active) return;
  requestAnimationFrame(() => {
    if (!active.isConnected) return;
    const box = list.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < box.left) list.scrollLeft -= box.left - tab.left;
    else if (tab.right > box.right) list.scrollLeft += tab.right - box.right;
  });
}

export function updateStatus() {
  const tab = activeTab();
  if (!tab) return;
  const project = projectOf(tab);
  let row;
  if (project.kind === 'new') row = STATUS_TEXT.fresh;
  else if (project.kind === 'sample') row = STATUS_TEXT.sample;
  else if (project.kind === 'practice') row = STATUS_TEXT.practice;
  else row = isChanged(tab) ? STATUS_TEXT.fresh : STATUS_TEXT.saved;
  if (row === lastStatus) return;
  lastStatus = row;
  const text = document.getElementById('status-text');
  text.textContent = row.text;
  text.title = row.text;
  document.getElementById('status-mark').dataset.state = row.mark;
}

const TIDY_TITLE = 'Fix the indents in this file';
let lastFooter = '';

// The language label and Tidy, for the active tab. Tidy that is off stays focusable
// (aria-disabled, not disabled) and says why (WP2 step 9).
export function updateFooter() {
  const tab = activeTab();
  if (!tab) return;
  const teaching = !!kindOf(tab).teaching;
  const label = teaching ? '' : languageRow(tab).label;
  const off = tidyAllowed(tab) ? '' : tidyOffText(tab);
  const key = `${label}|${off}`;
  if (key === lastFooter) return;
  lastFooter = key;
  const lang = document.getElementById('lang-label');
  lang.textContent = label;
  lang.hidden = !label;
  const tidy = document.getElementById('btn-tidy');
  document.getElementById('tidy-off').textContent = off;
  tidy.title = off || TIDY_TITLE;
  if (off) {
    tidy.setAttribute('aria-disabled', 'true');
    tidy.setAttribute('aria-describedby', 'tidy-off');
  } else {
    tidy.removeAttribute('aria-disabled');
    tidy.removeAttribute('aria-describedby');
  }
}

let lastMenu = '';
let menuNow = null;
// The menu state last sent, for the tests.
export function menuState() {
  return menuNow;
}

export function syncMenu() {
  const project = activeProject();
  const state = {
    hasTabs: S.tabs.length > 0,
    hasFolder: !!(project && project.folder),
    dialogOpen: S.dialogOpen,
    anyChanged: S.tabs.some(isChanged),
    typingHelpers: S.prefs.typingHelpers,
    autosave: S.prefs.autosave,
    boxes: boxesOn(),
    pointable: preview.showingPageTab(),
    sideShown: S.sideShown,
    // A practice copy keeps its name; Undo Change Name only while the toast offers Undo (WP5).
    renamable: !!(project && project.kind !== 'practice'),
    undoRename: !!S.renameUndo,
  };
  const key = JSON.stringify(state);
  menuNow = state;
  if (key === lastMenu) return;
  lastMenu = key;
  invoke('set_menu_state', { menuState: state });
  const save = document.getElementById('btn-save');
  save.disabled = !state.hasTabs;
}

export function noteDocChange(tab) {
  if (dotOn(tab) !== tab.dotShown) renderStrip();
  updateStatus();
  syncMenu();
}

export function switchTo(path, { focus = true } = {}) {
  const next = tabByPath(path);
  if (!next) return;
  const prev = activeTab();
  if (prev === next) {
    if (focus && !S.dialogOpen) S.ed.view.focus();
    return;
  }
  const mark = S.steps ? [performance.now()] : null;
  S.activePath = path;
  S.ed.show(next);
  updateInside();
  if (mark) mark.push(performance.now());
  if (focus && !S.dialogOpen) S.ed.view.focus();
  if (mark) mark.push(performance.now());
  lastStatus = null;
  renderStrip();
  updateStatus();
  updateFooter();
  if (mark) mark.push(performance.now());
  withSide(() => preview.onTabSwitch(prev, next));
  if (mark) mark.push(performance.now());
  if (S.rightView === 'help') refreshCanAdd();
  syncMenu();
  if (mark) {
    mark.push(performance.now());
    S.steps.push(mark.slice(1).map((t, i) => t - mark[i]));
  }
}

// The My page side is decided before the preview hears of a tab switch, so a hidden side
// pauses it at once, and drawn after, so a side that comes back loads only once (WP3).
let side = { wanted: () => S.sideShown, hiding: () => {}, draw: () => {} };
export function setSideHooks(hooks) {
  side = hooks;
}

export function withSide(fn) {
  const was = S.sideShown;
  const next = side.wanted();
  if (was && !next) side.hiding();
  S.sideShown = next;
  fn();
  side.draw(was);
}

export function forgetActive() {
  S.activePath = null;
}

export function nextTabPath(step) {
  const at = S.tabs.findIndex((t) => t.path === S.activePath);
  if (at < 0 || S.tabs.length < 2) return null;
  return S.tabs[(at + step + S.tabs.length) % S.tabs.length].path;
}

export function firstPageOf(project) {
  return tabsOf(project).find(isPage) || null;
}
