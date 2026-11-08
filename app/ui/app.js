import { invoke, listen } from './api.js';
import { browserName, browserOnlyKey, commandKey } from './platform.js';
import { S, activeTab, activeProject, pageTabOf } from './state.js';
import { installSprite } from './icons.js';
import * as preview from './preview.js';
import { nextTabPath, noteDocChange, renderStrip, switchTo, syncMenu } from './tabs.js';
import * as flows from './flows.js';
import { setDialogListener } from './dialogs.js';
import { initHelp, refreshTried, showGroup, showHome, showTopic, showWord } from './help.js';

let divider = null;

window.__htmllabErrors = [];
function reportError(kind, error) {
  const detail = error && error.stack ? error.stack : String(error);
  const text = `${new Date().toISOString()} ${kind}: ${detail}`;
  window.__htmllabErrors.push(text);
  invoke('log_error', { text }).catch(() => {});
}
window.addEventListener('error', (event) => reportError('error', event.error || event.message));
window.addEventListener('unhandledrejection', (event) => reportError('promise', event.reason));

const $ = (id) => document.getElementById(id);

let editorPromise = null;

export function whenEditor() {
  if (!editorPromise) {
    editorPromise = import('./editor.bundle.js').then((E) => {
      S.E = E;
      S.ed = E.createEditor($('editor-host'), {
        onUpdate: onEditorUpdate,
        onHintChange: () => preview.updateHeader(),
        onLearn: () => openHelpFirstTopic(),
      });
      if (!S.prefs.typingHelpers) S.ed.setTypingHelpers(false, []);
      window.__htmllabEditorReady = true;
    });
  }
  return editorPromise;
}

function onEditorUpdate(update) {
  const tab = update.view.htmllabTab;
  if (!tab) return;
  tab.state = update.state;
  if (tab.path !== S.activePath) return;
  if (update.docChanged) {
    tab.typed = true;
    noteDocChange(tab);
    preview.onKey(tab);
    flows.noteChangeForAutosave();
  } else if (update.selectionSet) {
    preview.onCursor(tab);
  }
}

let helpOpened = false;

export function layout() {
  const hasTabs = S.tabs.length > 0;
  const help = S.rightView === 'help';
  $('blank-panels').hidden = true;
  $('main').hidden = false;
  $('welcome-start').hidden = hasTabs;
  $('code-panel').hidden = !hasTabs;
  $('welcome-how').hidden = hasTabs || help;
  $('help-panel').hidden = !help;
  $('page-panel').hidden = !hasTabs;
  $('page-panel').classList.toggle('behind', help);
  $('seg-page').setAttribute('aria-pressed', String(!help));
  $('seg-help').setAttribute('aria-pressed', String(help));
  if (S.ed && hasTabs) S.ed.view.requestMeasure();
}

export function showRight(view) {
  const was = S.rightView;
  S.rightView = view;
  layout();
  if (view === 'help' && !helpOpened) {
    helpOpened = true;
    showHome();
  }
  if (view === 'page' && was === 'help') preview.onHelpHidden();
}

function openHelpView(show) {
  helpOpened = true;
  S.rightView = 'help';
  layout();
  if (show) show();
}

async function openHelpFirstTopic() {
  const index = await invoke('help_index');
  const first = index.topics.find((t) => t.group === 'start');
  openHelpView(() => (first ? showTopic(first.id) : showHome()));
}

function helpOnThisWord() {
  const tab = activeTab();
  if (!tab || !S.ed || !S.ed.view.hasFocus) return;
  const word = S.E.wordAtCursor(S.ed.view.state);
  const firstTime = !helpOpened;
  if (word) openHelpView(() => showWord(word));
  else openHelpView(firstTime ? () => showHome() : null);
}

const SIZE_MIN = 13;
const SIZE_MAX = 24;

function applyTextSize(size) {
  const root = document.documentElement.style;
  root.setProperty('--code-size', `${size}px`);
  root.setProperty('--code-lh', `${Math.round(size * 1.75)}px`);
  $('size-minus').disabled = size <= SIZE_MIN;
  $('size-plus').disabled = size >= SIZE_MAX;
  if (S.ed) S.ed.remeasure(S.tabs);
}

function setTextSize(size) {
  const next = Math.min(SIZE_MAX, Math.max(SIZE_MIN, size));
  if (next === S.prefs.textSize) return;
  S.prefs.textSize = next;
  applyTextSize(next);
  invoke('set_prefs', { patch: { textSize: next } });
}

function editorCommand(fn) {
  return async () => {
    if (!activeTab()) return;
    await whenEditor();
    fn(S.ed.view);
  };
}

function toggleTyping() {
  const on = !S.prefs.typingHelpers;
  S.prefs.typingHelpers = on;
  invoke('set_prefs', { patch: { typingHelpers: on } });
  if (S.ed) S.ed.setTypingHelpers(on, S.tabs);
  syncMenu();
}

function toggleAutosave() {
  const on = !S.prefs.autosave;
  S.prefs.autosave = on;
  invoke('set_prefs', { patch: { autosave: on } });
  syncMenu();
  if (on) flows.noteChangeForAutosave();
}

const ALWAYS = new Set(['undo', 'redo', 'select-all']);

const COMMANDS = {
  new: () => flows.newFlow(),
  open: () => flows.openFlow(),
  'add-file': () => flows.addFileFlow(),
  save: () => flows.saveFlow(),
  'save-copy': () => flows.saveCopyFlow(),
  autosave: toggleAutosave,
  'close-tab': () => flows.closeTabFlow(),
  'show-folder': () => flows.showProjectFolder(),
  undo: () => S.E && S.E.runEdit(S.ed.view, 'undo'),
  redo: () => S.E && S.E.runEdit(S.ed.view, 'redo'),
  'select-all': () => S.E && S.E.runEdit(S.ed.view, 'select-all'),
  find: editorCommand((v) => S.E.runFind(v, 'find')),
  'find-next': editorCommand((v) => S.E.runFind(v, 'find-next')),
  'find-prev': editorCommand((v) => S.E.runFind(v, 'find-prev')),
  replace: editorCommand((v) => S.E.runFind(v, 'replace')),
  comment: editorCommand((v) => S.E.commentLine(v)),
  tidy: editorCommand((v) => S.E.tidy(v)),
  'my-page': () => showRight('page'),
  help: () => showRight('help'),
  bigger: () => setTextSize(S.prefs.textSize + 1),
  smaller: () => setTextSize(S.prefs.textSize - 1),
  'normal-size': () => setTextSize(16),
  'typing-helpers': toggleTyping,
  'width-phone': () => preview.setWidth('phone'),
  'width-tablet': () => preview.setWidth('tablet'),
  'width-full': () => preview.setWidth('full'),
  safari: () => flows.openInSafari(),
  'next-tab': () => {
    const p = nextTabPath(1);
    if (p) switchTo(p);
  },
  'prev-tab': () => {
    const p = nextTabPath(-1);
    if (p) switchTo(p);
  },
  'help-home': () => openHelpView(() => showHome()),
  'help-word': helpOnThisWord,
  'help-start': () => openHelpView(() => showGroup('start')),
  'help-recipes': () => openHelpView(() => showGroup('recipes')),
  'help-html': () => openHelpView(() => showGroup('html')),
  'help-ways': () => openHelpView(() => showGroup('ways')),
  'help-css': () => openHelpView(() => showGroup('css')),
  'help-lookup': () => openHelpView(() => showGroup('lookup')),
};

function runCommand(id) {
  if (S.dialogOpen && !ALWAYS.has(id)) return;
  const tabMatch = /^tab-(\d)$/.exec(id);
  if (tabMatch) {
    const tab = S.tabs[Number(tabMatch[1]) - 1];
    if (tab) switchTo(tab.path);
    return;
  }
  const command = COMMANDS[id];
  if (command) command();
}

function handleCommandKey(key) {
  if (S.dialogOpen) return false;
  if (key === '+' || key === '=') {
    setTextSize(S.prefs.textSize + 1);
    return true;
  }
  if (key === '?') {
    showRight('help');
    return true;
  }
  return false;
}

function wireDivider() {
  const divider = $('divider');
  const left = $('left');
  const main = $('main');
  const ghost = document.createElement('div');
  ghost.id = 'divider-ghost';
  ghost.hidden = true;
  main.append(ghost);
  let drag = null;

  function start() {
    const box = main.getBoundingClientRect();
    const line = divider.getBoundingClientRect();
    const padding = left.getBoundingClientRect().left - box.left;
    drag = {
      box,
      padding,
      half: line.width / 2,
      room: box.width - padding * 2 - line.width,
      width: left.getBoundingClientRect().width,
      next: null,
    };
    ghost.style.left = `${line.left - box.left + line.width / 2}px`;
    ghost.style.transform = 'translateX(0px)';
    ghost.hidden = false;
    $('preview').style.pointerEvents = 'none';
  }
  function move(clientX) {
    if (!drag) return;
    const width = Math.min(drag.room - 320, Math.max(320, clientX - drag.box.left - drag.padding - drag.half));
    drag.next = width;
    ghost.style.transform = `translateX(${width - drag.width}px)`;
  }
  function end() {
    if (!drag) return;
    if (drag.next !== null) left.style.flex = `0 0 ${drag.next}px`;
    drag = null;
    ghost.hidden = true;
    $('preview').style.pointerEvents = '';
    if (S.ed) S.ed.view.requestMeasure();
  }

  divider.addEventListener('pointerdown', (event) => {
    divider.setPointerCapture(event.pointerId);
    start();
    event.preventDefault();
  });
  divider.addEventListener('pointermove', (event) => move(event.clientX));
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  divider.addEventListener('dblclick', () => {
    left.style.flex = '';
    if (S.ed) S.ed.view.requestMeasure();
  });
  return { start, move, end };
}

function wireScreens() {
  $('btn-new').addEventListener('click', () => flows.newFlow());
  $('btn-open').addEventListener('click', () => flows.openFlow());
  $('btn-save').addEventListener('click', () => flows.saveFlow());
  $('seg-page').addEventListener('click', () => showRight('page'));
  $('seg-help').addEventListener('click', () => showRight('help'));

  $('w-new').addEventListener('click', () => flows.newFlow());
  $('w-open').addEventListener('click', () => flows.openFlow());
  $('w-sample').addEventListener('click', () => flows.newFlow({ focusSamples: true }));
  $('w-open-help').addEventListener('click', () => showRight('help'));

  $('tab-list').addEventListener('click', (event) => {
    const tabEl = event.target.closest('.tab');
    if (!tabEl) return;
    if (event.target.closest('.tab-close')) flows.closeTabFlow(tabEl.dataset.path);
    else switchTo(tabEl.dataset.path);
  });
  $('tab-add').addEventListener('click', () => flows.addFileFlow());

  $('btn-tidy').addEventListener('click', editorCommand((v) => S.E.tidy(v)));
  $('size-minus').addEventListener('click', () => setTextSize(S.prefs.textSize - 1));
  $('size-plus').addEventListener('click', () => setTextSize(S.prefs.textSize + 1));

  $('w-phone').addEventListener('click', () => preview.setWidth('phone'));
  $('w-tablet').addEventListener('click', () => preview.setWidth('tablet'));
  $('w-full').addEventListener('click', () => preview.setWidth('full'));
  $('btn-safari').setAttribute('aria-label', `Open this page in ${browserName}`);
  $('btn-safari').title = `Open this page in ${browserName}`;
  $('btn-safari').addEventListener('click', () => flows.openInSafari());
  $('page-empty-link').addEventListener('click', () => openHelpView(() => showGroup('start')));
  $('btn-back-help').addEventListener('click', () => showRight('help'));

  divider = wireDivider();

  document.addEventListener('contextmenu', (event) => {
    const t = event.target;
    if (t.closest && (t.closest('.cm-content') || t.closest('input') || t.closest('textarea'))) return;
    event.preventDefault();
  });

  document.addEventListener('keydown', (event) => {
    if (browserOnlyKey(event)) event.preventDefault();
    if (commandKey(event) && handleCommandKey(event.key)) event.preventDefault();
  });

  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());
}

function wireNative() {
  listen('menu', runCommand);
  listen('close-requested', () => flows.onCloseRequested());
  listen('window-focused', () => preview.onWindowFocused());
  listen('window-blurred', () => flows.onWindowBlurred());
  listen('drag-state', (state) => {
    const on = state === 'enter' && !S.dialogOpen && !S.panelOpen;
    $('drop-overlay').hidden = !on;
  });
  listen('files-dropped', (paths) => flows.droppedFiles(paths));
  listen('open-requested', () => flows.externalOpens());
}

function fontsReady(capMs) {
  return Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, capMs))]);
}

async function boot() {
  const marks = { boot: performance.now() };
  window.__bootMarks = marks;
  installSprite();
  const [config, prefs, flags] = await Promise.all([
    invoke('get_app_config'),
    invoke('get_prefs'),
    invoke('get_launch_flags'),
  ]);
  marks.invokes = performance.now();
  S.config = config;
  for (const kind of config.kinds) S.kinds.set(kind.id, kind);
  S.prefs = prefs;
  S.flags = flags;

  applyTextSize(prefs.textSize);
  const restoring = !!(prefs.session && prefs.session.tabs && prefs.session.tabs.length);
  if (restoring) {
    $('main').hidden = true;
    $('blank-panels').hidden = false;
  }

  wireScreens();
  wireNative();
  preview.initPreview({
    switchTo: (path) => switchTo(path),
    openPageTab: (projectId, path) => flows.openPageTab(projectId, path),
    onPreviewKey: (key) => handleCommandKey(key),
  });
  flows.initFlows({ whenEditor, layout, showRight, onTriedChanged: () => refreshTried() });
  initHelp($('help-panel'), {
    helpIndex: () => invoke('help_index'),
    helpTopic: (id) => invoke('help_topic', { id }),
    highlight: async (code, lang) => {
      await whenEditor();
      return S.E.highlightRuns(code, lang);
    },
    onTryIt: (topicId) => flows.tryIt(topicId),
    onAddToCode: (insert) => flows.addToCode(insert),
    canAdd: (lang) => flows.canAdd(lang),
    isTried: (id) => S.prefs.tried.includes(id),
    openExternal: (url) => invoke('open_external', { url }),
    copyText: (text) => invoke('copy_text', { text }),
  });
  setDialogListener((open) => {
    S.dialogOpen = open;
    syncMenu();
    if (!open) {
      if (S.ed && activeTab()) S.ed.view.focus();
      flows.onDialogClosed();
    }
  });

  syncMenu();
  marks.wired = performance.now();
  await fontsReady(200);
  marks.fonts = performance.now();
  invoke('show_window');
  window.__htmllabFirstPaint = performance.now();

  await whenEditor();
  if (restoring) {
    const ok = await flows.restoreSession(prefs.session).catch(() => false);
    if (!ok) layout();
  }
  flows.externalOpens();
  if (flags.speedCheck) {
    const mod = await import('./speed-check.js');
    mod.run({ whenEditor, showRight, setTextSize, flows, preview, divider });
  } else if (flags.selfTest) {
    const mod = await import('./self-test.js');
    mod.run({ whenEditor, showRight, setTextSize, flows, preview, runCommand, divider, selfTest: flags.selfTest, helpers: { renderStrip, pageTabOf, activeProject } });
  } else if (flags.smokeTest) {
    const mod = await import('./smoke-test.js');
    mod.run({ preview });
  }
}

boot();
