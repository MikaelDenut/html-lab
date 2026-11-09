import { invoke, listen } from './api.js';
import { browserName, browserOnlyKey, commandKey } from './platform.js';
import { S, activeTab, activeProject, baseName, isOther, kindOf, kindOrCode, pageTabOf, projectOf, tidyAllowed } from './state.js';
import { installSprite } from './icons.js';
import * as preview from './preview.js';
import { nextTabPath, noteDocChange, renderStrip, setSideHooks, switchTo, syncMenu, withSide } from './tabs.js';
import * as flows from './flows.js';
import { setDialogListener } from './dialogs.js';
import { initHelp, refreshTried, showGroup, showHome, showTopic, showWord } from './help.js';
import * as link from './link.js';
import { initInside, updateInside } from './inside.js';
import * as rename from './rename.js';

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
        lookup: lookupRows,
        onHelpWord: (word) => openHelpView(() => showWord(word)),
        pictureFor,
      });
      if (!S.prefs.typingHelpers) S.ed.setTypingHelpers(false, []);
      initInside({ S });
      window.__htmllabEditorReady = true;
    });
  }
  return editorPromise;
}

function onEditorUpdate(update) {
  const tab = update.view.htmllabTab;
  if (!tab) return;
  tab.state = update.state;
  // Change Name edits a tab's text with its own transactions: they are not typing, they do not
  // start the auto-save timer, and they do not end the Undo toast (WP5).
  const byRename = update.docChanged && update.transactions.every((tr) => !tr.docChanged || tr.annotation(S.E.renameEdit));
  if (update.docChanged && !byRename) rename.noteUserEdit(tab);
  if (tab.path !== S.activePath) return;
  if (update.docChanged) {
    if (!byRename) tab.typed = true;
    noteDocChange(tab);
    preview.onKey(tab);
    if (!byRename) flows.noteChangeForAutosave();
    link.onDocChange(tab);
  } else if (update.selectionSet) {
    preview.onCursor(tab);
    link.onCursorMove(tab);
  }
  if (update.docChanged || update.selectionSet) updateInside();
}

// The look-up lists, for the explanations on hover. Loaded on the first hover.
const LOOKUP_TOPICS = { tags: 'html-tags', words: 'css-words', colors: 'color-names' };

function rowKey(code) {
  return String(code || '').replace(/[<>/]/g, '').trim().toLowerCase();
}

async function lookupRows() {
  const out = {};
  for (const [part, id] of Object.entries(LOOKUP_TOPICS)) {
    const topic = await invoke('help_topic', { id });
    const map = new Map();
    for (const row of (topic && topic.rows) || []) {
      const key = rowKey(row.code);
      if (key && !map.has(key)) map.set(key, row);
    }
    out[part] = map;
  }
  return out;
}

// Where the tooltip finds a picture: the same address the page uses.
function pictureFor(view, src) {
  const tab = view.htmllabTab;
  if (!tab) return null;
  const value = src.trim();
  if (!value) return null;
  if (/^https?:/i.test(value) || value.startsWith('//')) return { internet: true };
  if (/^data:image\//i.test(value)) return { url: value };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  let url;
  try {
    url = new URL(value, preview.urlFor(tab.path, 0));
  } catch (e) {
    return null;
  }
  url.search = '';
  url.hash = '';
  return projectOf(tab).folder ? { url: url.href } : { unsaved: true, url: url.href };
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
  withSide(() => {});
}

// The My page side (WP3). It follows the active tab by itself: shown for pages and style
// files, hidden for other files. A click of the user's own wins until it matches that again.
// The start screen always shows it.
const autoSide = () => {
  const tab = activeTab();
  return !tab || !isOther(tab);
};

function sideWanted() {
  if (!S.tabs.length) return true;
  return S.sideManual === null ? autoSide() : S.sideManual === 'shown';
}

const SIDE_HIDE = 'Hide the My page side';
const SIDE_SHOW = 'Show the My page side';

// A side that hides with the focus in it, or in the My page and Help switch, gives the focus to the
// side button when a side button hid it, else to the code, so it never drops to the window (WP3).
let sideByButton = false;
function sideHasFocus() {
  const at = document.activeElement;
  return !!at && ($('right').contains(at) || !!at.closest('.segs'));
}

function drawSide(was) {
  const shown = S.sideShown;
  const button = $('btn-side');
  const words = shown ? SIDE_HIDE : SIDE_SHOW;
  if (button.title !== words) {
    button.title = words;
    button.setAttribute('aria-label', words);
  }
  // layout() and every tab switch come here, so only a real change touches the button.
  if (button.getAttribute('aria-pressed') !== String(shown)) button.setAttribute('aria-pressed', String(shown));
  if (button.disabled !== !S.tabs.length) button.disabled = !S.tabs.length;
  if (was === shown) return;
  const focusOut = !shown && sideHasFocus();
  $('main').classList.toggle('side-hidden', !shown);
  $('toolbar').classList.toggle('side-hidden', !shown);
  if (focusOut) {
    if (sideByButton) button.focus();
    else if (S.ed && S.tabs.length) S.ed.view.focus();
  }
  if (shown) preview.onSideShown();
  else preview.onSideHidden();
  syncMenu();
  if (S.ed && S.tabs.length) S.ed.view.requestMeasure();
}

function toggleSide() {
  if (!S.tabs.length) return;
  const next = !S.sideShown;
  S.sideManual = next === autoSide() ? null : next ? 'shown' : 'hidden';
  withSide(() => {});
  flows.writeSession();
}

function sideButtonClick() {
  sideByButton = true;
  try {
    toggleSide();
  } finally {
    sideByButton = false;
  }
}

// Help and My page are on the side, so asking for them brings a hidden side back, as a click would.
function showSide() {
  if (S.tabs.length && !S.sideShown) toggleSide();
}

export function showRight(view) {
  const was = S.rightView;
  S.rightView = view;
  if (view === 'help' && was !== 'help') link.onHelpShown();
  layout();
  if (view === 'help' && !helpOpened) {
    helpOpened = true;
    showHome();
  }
  if (view === 'page' && was === 'help') preview.onHelpHidden();
}

function openHelpView(show) {
  showSide();
  helpOpened = true;
  if (S.rightView !== 'help') {
    S.rightView = 'help';
    link.onHelpShown();
  }
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
  if (!tab || !kindOf(tab).teaching || !S.ed || !S.ed.view.hasFocus) return;
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

// Tidy that is off for the file's language changes nothing, from the button or the menu.
async function tidyNow() {
  const tab = activeTab();
  if (!tab || !tidyAllowed(tab)) return;
  await whenEditor();
  if (activeTab() === tab) S.E.tidy(S.ed.view);
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

// Point and Show the Boxes act on the page, so the page comes back first when Help shows.
// A hidden side has no page to act on.
function seeOnPage(fn) {
  if (!activeTab() || !S.sideShown) return;
  if (S.rightView === 'help') showRight('page');
  fn();
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
  rename: () => rename.renameFlow(),
  'undo-rename': () => rename.undoRename(),
  undo: () => S.E && S.E.runEdit(S.ed.view, 'undo'),
  redo: () => S.E && S.E.runEdit(S.ed.view, 'redo'),
  'select-all': () => S.E && S.E.runEdit(S.ed.view, 'select-all'),
  find: editorCommand((v) => S.E.runFind(v, 'find')),
  'find-next': editorCommand((v) => S.E.runFind(v, 'find-next')),
  'find-prev': editorCommand((v) => S.E.runFind(v, 'find-prev')),
  replace: editorCommand((v) => S.E.runFind(v, 'replace')),
  comment: editorCommand((v) => S.E.commentLine(v)),
  tidy: tidyNow,
  fold: editorCommand((v) => S.E.foldHere(v)),
  unfold: editorCommand((v) => S.E.unfoldHere(v)),
  'unfold-all': editorCommand((v) => S.E.unfoldEverything(v)),
  point: () => seeOnPage(() => link.togglePoint()),
  boxes: () => seeOnPage(() => link.toggleBoxes()),
  'my-page': () => {
    showSide();
    showRight('page');
  },
  help: () => {
    showSide();
    showRight('help');
  },
  'toggle-side': toggleSide,
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
  // Undo, Redo and Select All act on the Change Name field; any other command stops it first.
  if (!ALWAYS.has(id)) rename.cancelRename();
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
  if (key === '+' || key === '=' || key === '?') rename.cancelRename();
  if (key === '+' || key === '=') {
    setTextSize(S.prefs.textSize + 1);
    return true;
  }
  if (key === '?') {
    showSide();
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
    if (!S.sideShown) return;
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
  $('btn-side').addEventListener('click', sideButtonClick);
  $('seg-page').addEventListener('click', () => showRight('page'));
  $('seg-help').addEventListener('click', () => showRight('help'));

  $('w-new').addEventListener('click', () => flows.newFlow());
  $('w-open').addEventListener('click', () => flows.openFlow());
  $('w-sample').addEventListener('click', () => flows.newFlow({ focusSamples: true }));
  $('w-open-help').addEventListener('click', () => showRight('help'));

  // Change Name (WP5): a single click on the name of the tab that was already the active one
  // at pointerdown, for 500 ms or more, opens the field; Enter on the focused active tab too.
  let downOk = null;
  $('tab-list').addEventListener('pointerdown', (event) => {
    const tabEl = event.target.closest('.tab');
    const path = tabEl && tabEl.dataset.path;
    downOk = path && !rename.closedByPointer(event) && rename.clickOpens(path) ? path : null;
  });
  $('tab-list').addEventListener('click', (event) => {
    const tabEl = event.target.closest('.tab');
    if (!tabEl || event.target.closest('.tab-rename')) return;
    const path = tabEl.dataset.path;
    const opens = downOk === path && event.detail <= 1 && event.target.closest('.tab-name');
    downOk = null;
    if (event.target.closest('.tab-close')) flows.closeTabFlow(path);
    else if (opens && rename.renameFlow(path)) return;
    else switchTo(path);
  });
  $('tab-list').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || !event.target.closest('.tab-main')) return;
    const tabEl = event.target.closest('.tab');
    if (tabEl.dataset.path !== S.activePath) return;
    event.preventDefault();
    rename.renameFlow(tabEl.dataset.path);
  });
  $('tab-add').addEventListener('click', () => flows.addFileFlow());

  $('btn-tidy').addEventListener('click', tidyNow);
  $('size-minus').addEventListener('click', () => setTextSize(S.prefs.textSize - 1));
  $('size-plus').addEventListener('click', () => setTextSize(S.prefs.textSize + 1));

  $('btn-point').addEventListener('click', () => link.togglePoint());
  $('btn-boxes').addEventListener('click', () => link.toggleBoxes());
  $('w-phone').addEventListener('click', () => preview.setWidth('phone'));
  $('w-tablet').addEventListener('click', () => preview.setWidth('tablet'));
  $('w-full').addEventListener('click', () => preview.setWidth('full'));
  $('btn-safari').setAttribute('aria-label', `Open this page in ${browserName}`);
  $('btn-safari').title = `Open this page in ${browserName}`;
  $('btn-safari').addEventListener('click', () => flows.openInSafari());
  $('page-hint').addEventListener('click', (event) => {
    if (event.target.closest('#hint-browser')) flows.openInSafari();
  });
  $('page-empty-link').addEventListener('click', () => openHelpView(() => showGroup('start')));
  $('btn-hide-side').addEventListener('click', sideButtonClick);
  $('page-none-help').addEventListener('click', () => openHelpView(() => showHome()));
  $('btn-back-help').addEventListener('click', () => showRight('help'));

  divider = wireDivider();

  document.addEventListener('contextmenu', (event) => {
    const t = event.target;
    if (t.closest && (t.closest('.cm-content') || t.closest('input') || t.closest('textarea'))) return;
    event.preventDefault();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !S.dialogOpen && link.pointOn()) link.togglePoint();
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

// The blank screen before a restore has one panel when the side comes back hidden: hidden by
// hand, or left to itself on a file that is not a web page. A test run never uses the saved side.
function restoresHidden(session, flags) {
  const testRun = flags.selfTest || flags.smokeTest || flags.speedCheck;
  const side = testRun ? null : session.side;
  if (side === 'hidden' || side === 'shown') return side === 'hidden';
  const active = session.active || session.tabs[0];
  const kind = kindOrCode(baseName(active));
  return !kind.isPage && kind.previewMode !== 'swap';
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
  S.kinds.set(config.codeKind.id, config.codeKind);
  S.prefs = prefs;
  S.flags = flags;

  applyTextSize(prefs.textSize);
  const restoring = !!(prefs.session && prefs.session.tabs && prefs.session.tabs.length);
  if (restoring) {
    $('main').hidden = true;
    $('blank-panels').hidden = false;
    $('blank-panels').classList.toggle('one', restoresHidden(prefs.session, flags));
  }
  // Point goes off and the lit lines clear while the page can still hear it.
  setSideHooks({ wanted: sideWanted, hiding: () => link.onHelpShown(), draw: drawSide });

  wireScreens();
  wireNative();
  preview.initPreview({
    switchTo: (path) => switchTo(path),
    openPageTab: (projectId, path) => flows.openPageTab(projectId, path),
    onPreviewKey: (key) => handleCommandKey(key),
  });
  link.initLink({
    S,
    post: (msg) => preview.postToPage(msg),
    inSync: () => preview.inSync(),
    pv: () => preview.pageVersion(),
    pageTab: () => pageTabOf(S.projects.get(preview.state.projectId)),
    showingPage: () => preview.showingPageTab(),
    linkedCss: (tab) => S.sideShown && preview.linkedCss(tab),
    switchTo: (path) => switchTo(path),
    updateHeader: () => preview.updateHeader(),
    setPressed: (id, on) => {
      const button = $(id);
      if (button) button.setAttribute('aria-pressed', String(on));
    },
    syncMenu: () => syncMenu(),
  });
  flows.initFlows({ whenEditor, layout, showRight, onTriedChanged: () => refreshTried() });
  rename.initRename();
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
