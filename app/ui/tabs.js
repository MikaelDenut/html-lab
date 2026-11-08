import { refreshCanAdd } from './help.js';
import { invoke } from './api.js';
import { kindOf, projectOf, S, activeTab, activeProject, isChanged, tabByPath, tabsOf, isPage } from './state.js';
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
  const project = projectOf(tab);
  if (project.kind === 'practice' && tabsOf(project).length === 1) return 'Practice';
  const twin = S.tabs.some((t) => t !== tab && t.name === tab.name);
  return twin ? `${tab.name} (${project.name})` : tab.name;
}

function tooltipFor(tab) {
  return projectOf(tab).folder ? tab.path : `${tab.name}, not saved yet`;
}

let lastStrip = '';

export function renderStrip() {
  const list = document.getElementById('tab-list');
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
      dirty: tab.dotShown,
      tooltip: tooltipFor(tab),
    };
  });
  const key = JSON.stringify(rows);
  if (key !== lastStrip || list.children.length !== rows.length) {
    lastStrip = key;
    list.innerHTML = rows.map((row) => tabHtml({ ...row, active: row.path === S.activePath })).join('');
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

let lastMenu = '';
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
  };
  const key = JSON.stringify(state);
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
  if (mark) mark.push(performance.now());
  preview.onTabSwitch(prev, next);
  if (mark) mark.push(performance.now());
  if (S.rightView === 'help') refreshCanAdd();
  syncMenu();
  if (mark) {
    mark.push(performance.now());
    S.steps.push(mark.slice(1).map((t, i) => t - mark[i]));
  }
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
