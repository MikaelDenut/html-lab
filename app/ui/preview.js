import { browserName, computerName, previewBase } from './platform.js';
import { invoke } from './api.js';
import {
  S,
  activeProject,
  activeTab,
  baseName,
  dirName,
  isChanged,
  isOnDisk,
  isOther,
  isPage,
  kindForName,
  kindOf,
  kindOrCode,
  pageTabOf,
  projectOf,
  sameFile,
  stampArgs,
  tabByPath,
  tabsOf,
} from './state.js';
import * as link from './link.js';

const PICTURES = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'heic', 'tif', 'tiff', 'avif']);

const P = {
  phase: 'none',
  out: null,
  nextId: 1,
  loadId: 0,
  pendingHtml: false,
  pendingY: null,
  pendingCss: new Set(),
  sentCss: new Set(),
  lastLinks: [],
  lastMs: 0,
  showing: null,
  navSeq: 0,
  place: null,
  projectId: null,
  hasStyle: false,
  hasScript: false,
  hold: false,
  holdSpent: false,
  bigWait: false,
  retried: false,
  lostLoads: 0,
  srcFor: 0,
  againFor: 0,
  lostTraces: [],
  width: 'full',
  outKind: null,
  outDoc: null,
  loadDoc: null,
  shownDoc: null,
  pv: -1,
  lastMsg: null,
  loadWanted: false,
  other: null,
  posted: 0,
};

let iframe = null;
let empty = null;
let watchdog = 0;
let readyWait = 0;
let holdTimer = 0;
let bigTimer = 0;
let resizeObserver = null;
let host = {};

const trace = [];
function note(what) {
  trace.push(`${Date.now()} ${what}`);
  if (trace.length > 30) trace.shift();
}

export const state = P;

export function initPreview(hooks) {
  host = hooks;
  iframe = document.getElementById('preview');
  empty = document.getElementById('page-empty');
  window.addEventListener('message', onMessage);
  iframe.addEventListener('load', () => note(`frame load event, loadId ${P.loadId}`));
}

// Every message to the page goes through here, so a self-test can count them (C46).
function postNow(msg) {
  P.posted += 1;
  iframe.contentWindow.postMessage(msg, '*');
}

function send(msg) {
  P.out = msg.id;
  P.outKind = msg.t;
  armWatchdog();
  postNow(msg);
}

function pump() {
  if (!S.sideShown) return;
  if (P.phase !== 'live' || P.out !== null || S.rightView === 'help' || P.hold || P.bigWait || P.loadWanted) return;
  while (P.pendingCss.size) {
    const path = P.pendingCss.values().next().value;
    P.pendingCss.delete(path);
    const tab = tabByPath(path);
    if (!tab) continue;
    P.sentCss.add(path);
    send({ t: 'css', id: P.nextId++, file: tab.name, css: tab.state.doc.toString() });
    return;
  }
  if (P.pendingHtml) {
    P.pendingHtml = false;
    const tab = pageTabOf(S.projects.get(P.projectId));
    if (!tab) return;
    const msg = { t: 'html', id: P.nextId++, html: tab.state.doc.toString() };
    if (P.pendingY !== null) msg.y = P.pendingY;
    P.pendingY = null;
    P.outDoc = P.showing === tab.path ? tab.state.doc : null;
    send(msg);
  }
}

let pumpWaiting = false;
function pumpAfterPaint() {
  if (pumpWaiting) return;
  pumpWaiting = true;
  requestAnimationFrame(() => setTimeout(() => {
    pumpWaiting = false;
    pump();
  }, 0));
}

function clearWatchdog() {
  clearTimeout(watchdog);
  watchdog = 0;
}

function clearReadyWait() {
  clearTimeout(readyWait);
  readyWait = 0;
}

function armWatchdog() {
  clearWatchdog();
  watchdog = setTimeout(() => {
    watchdog = setTimeout(() => {
      watchdog = 0;
      if (P.out !== null) load();
    }, 100);
  }, 1000);
}

export function urlFor(path, version) {
  const clean = path.replace(/^\/+/, '');
  return `${previewBase}${clean.split('/').map(encodeURIComponent).join('/')}?v=${version}`;
}

function pathFromUrl(href) {
  const url = new URL(href);
  const decoded = decodeURIComponent(url.pathname);
  return decoded.startsWith('/__new/') || /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
}

async function syncBuffers(project) {
  const set = [];
  const drop = [];
  for (const tab of tabsOf(project)) {
    if (!isOnDisk(tab) || isChanged(tab)) set.push({ path: tab.path, text: tab.state.doc.toString() });
    else drop.push(tab.path);
  }
  if (set.length) await invoke('set_buffers', { files: set });
  if (drop.length) await invoke('drop_buffers', { paths: drop });
}

export async function load() {
  const project = S.projects.get(P.projectId);
  if (!project || !P.showing) {
    P.loadWanted = false;
    return;
  }
  // A hidden side starts no load: it is remembered and done when the side comes back (C46).
  if (!S.sideShown) {
    P.loadWanted = true;
    note(`load wanted ${P.showing}`);
    return;
  }
  P.loadWanted = false;
  P.loadId += 1;
  const id = P.loadId;
  P.out = null;
  clearWatchdog();
  clearReadyWait();
  P.phase = 'loading';
  note(`load ${id} ${P.showing}`);
  P.pendingHtml = false;
  P.pendingY = null;
  P.pendingCss.clear();
  P.sentCss.clear();
  P.shownDoc = null;
  P.loadDoc = null;
  P.pv = -1;
  link.onPageGone();

  if (project.folder) await invoke('add_root', { folder: project.folder });
  const page = pageTabOf(project);
  const loading = page && P.showing === page.path ? page.state.doc : null;
  await syncBuffers(project);
  if (P.loadId !== id) {
    note(`load ${id} gave way to ${P.loadId}`);
    return;
  }
  // The side hid while the files were made ready: no address is set, the load is done when it comes back (C46).
  if (!S.sideShown) {
    P.loadWanted = true;
    note(`load ${id} waits for the side`);
    return;
  }
  P.loadDoc = loading;
  if (project.folder) {
    invoke('folder_stamp', stampArgs(project)).then((stamp) => {
      project.stamp = stamp;
    });
  }

  showFrame(true);
  iframe.src = urlFor(P.showing, id);
  P.srcFor = id;
  note(`src ${iframe.src}`);
  armReadyWait(id);
  updateHeader();
}

// An older page that finishes loading after the new address was set can take
// the new navigation's place, and then no ready ever comes for it. Seen on
// WebKitGTK and WebView2 when two loads start within about 30 ms. The address is
// set again at once, one time per load, instead of waiting for the retry.
function sendAgain(v) {
  const id = P.loadId;
  if (!S.sideShown || P.phase !== 'loading' || P.srcFor !== id || P.againFor === id || !(typeof v === 'number' && v < id)) return;
  P.againFor = id;
  iframe.src = `${urlFor(P.showing, id)}&again=1`;
  note(`again ${iframe.src}`);
  armReadyWait(id);
}

const FIRST_READY_MS = 3000;
const RETRY_READY_MS = 10000;

function armReadyWait(id) {
  clearReadyWait();
  const ms = P.retried ? RETRY_READY_MS : FIRST_READY_MS;
  readyWait = setTimeout(() => {
    readyWait = setTimeout(() => {
      readyWait = 0;
      if (P.loadId !== id || P.phase !== 'loading') return;
      if (!P.retried) {
        P.retried = true;
        P.lostLoads += 1;
        P.lostTraces.push(trace.slice());
        load();
      } else {
        P.retried = false;
        goEmpty();
      }
    }, 100);
  }, ms);
}

function onMessage(event) {
  if (!iframe || event.source !== iframe.contentWindow) return;
  const msg = event.data;
  if (!msg) return;
  P.lastMsg = { t: msg.t, at: Date.now() };
  switch (msg.t) {
    case 'ready':
      note(`ready v${msg.v}, loadId ${P.loadId}`);
      if (msg.v !== P.loadId) {
        sendAgain(msg.v);
        return;
      }
      onReady(msg);
      break;
    case 'done': {
      if (msg.id !== P.out) return;
      const kind = P.outKind;
      P.out = null;
      P.outKind = null;
      if (kind === 'html') P.shownDoc = P.outDoc;
      P.outDoc = null;
      if (typeof msg.pv === 'number') P.pv = msg.pv;
      clearWatchdog();
      P.lastMs = msg.ms;
      applyInfo(msg);
      pump();
      goToPlace();
      link.onPageDone(kind, msg);
      updateHeader();
      if (host.onDone) host.onDone(msg);
      break;
    }
    case 'fail':
      if (msg.id === P.out) load();
      break;
    case 'nav':
      onNav(msg.href);
      break;
    case 'ext':
      invoke('open_external', { url: msg.url });
      break;
    case 'scroll': {
      const tab = pageTabOf(S.projects.get(P.projectId));
      if (tab && P.showing === tab.path) tab.pageY = msg.y;
      break;
    }
    case 'key':
      if (host.onPreviewKey) host.onPreviewKey(msg.key);
      break;
    case 'probed':
      if (probes.has(msg.id)) {
        probes.get(msg.id)(msg);
        probes.delete(msg.id);
      }
      break;
    default:
      link.onHelperMessage(msg);
      break;
  }
}

function onReady(msg) {
  clearReadyWait();
  // A page that got ready while the side was hidden hears nothing; it is loaded again when the side comes back (C46).
  if (!S.sideShown) {
    P.loadWanted = true;
    note(`ready v${msg.v} while hidden`);
    return;
  }
  P.retried = false;
  P.phase = 'live';
  P.shownDoc = P.loadDoc;
  P.loadDoc = null;
  P.pv = typeof msg.pv === 'number' ? msg.pv : -1;
  const tab = pageTabOf(S.projects.get(P.projectId));
  if (tab && P.showing === tab.path) postNow({ t: 'scroll', y: tab.pageY });
  applyInfo(msg);
  pump();
  goToPlace();
  link.onPageReady(msg);
  updateHeader();
  if (host.onReady) host.onReady(msg);
}

// True when the page shows the page tab's latest text, so a page element and
// a code element can be paired (PLAN "In step"). The document is compared by
// identity: CodeMirror makes a new one on every change.
export function inSync() {
  if (!S.sideShown || P.phase !== 'live' || S.rightView === 'help') return false;
  const page = pageTabOf(S.projects.get(P.projectId));
  if (!page || P.showing !== page.path) return false;
  return P.shownDoc === page.state.doc;
}

export function pageVersion() {
  return P.pv;
}

export function showingPageTab() {
  if (!S.sideShown || P.phase !== 'live') return false;
  const tab = activeTab();
  if (tab && isOther(tab)) return false;
  const page = pageTabOf(S.projects.get(P.projectId));
  return !!page && P.showing === page.path;
}

export function linkedCss(tab) {
  return P.lastLinks.includes(tab.name);
}

// False when the page is not live or the side is hidden: the message is dropped and no reply comes.
export function postToPage(msg) {
  if (!S.sideShown || P.phase !== 'live' || !iframe || !iframe.contentWindow) return false;
  postNow(msg);
  return true;
}

function applyInfo(msg) {
  P.lastLinks = msg.links || [];
  P.hasStyle = !!msg.hasStyle;
  P.hasScript = !!msg.hasScript;
  const project = S.projects.get(P.projectId);
  if (!project) return;
  for (const name of P.lastLinks) {
    const tab = tabsOf(project).find((t) => t.name === name && kindOf(t).previewMode === 'swap');
    if (tab && (isChanged(tab) || !isOnDisk(tab)) && !P.sentCss.has(tab.path)) P.pendingCss.add(tab.path);
  }
}

function showPage(tab) {
  const active = activeTab();
  if (active && active !== tab && isPage(active)) {
    host.switchTo(tab.path);
    return;
  }
  projectOf(tab).pageTab = tab.path;
  if (P.showing !== tab.path) {
    P.showing = tab.path;
    load();
  }
  updateHeader();
}

function goToPlace() {
  if (!S.sideShown || !P.place || P.phase !== 'live' || P.out !== null || P.pendingHtml) return;
  if (P.place.path !== P.showing) return;
  postNow({ t: 'place', hash: P.place.hash });
  P.place = null;
}

function onNav(href) {
  const project = S.projects.get(P.projectId);
  if (!project) return;
  P.navSeq += 1;
  const seq = P.navSeq;
  const path = pathFromUrl(href);
  const hash = new URL(href).hash;
  P.place = hash.length > 1 ? { path, hash } : null;
  const name = baseName(path);
  const open = tabsOf(project).find((t) => t.path === path);
  if (open && isPage(open)) {
    showPage(open);
    return;
  }
  const kind = kindForName(name);
  if (kind && kind.isPage) {
    const go = (tab) => {
      if (seq !== P.navSeq) return;
      if (tab) {
        showPage(tab);
        return;
      }
      P.showing = path;
      load();
    };
    const found = host.openPageTab ? host.openPageTab(project.id, path) : null;
    if (found && typeof found.then === 'function') found.then(go, () => go(null));
    else go(found);
    return;
  }
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (PICTURES.has(ext)) {
    P.loadId += 1;
    P.out = null;
    clearWatchdog();
    clearReadyWait();
    P.shownDoc = null;
    P.pv = -1;
    link.onPageGone();
    P.showing = path;
    iframe.src = urlFor(path, P.loadId);
    note(`picture ${iframe.src}`);
    P.phase = 'none';
    updateHeader();
  }
}

const SLOW_PAGE_MS = 10;
const LETTER_FIRST_MS = 4;

function restartBigWait() {
  if (P.lastMs <= SLOW_PAGE_MS) return;
  P.bigWait = true;
  clearTimeout(bigTimer);
  bigTimer = setTimeout(() => {
    P.bigWait = false;
    pump();
  }, 200);
}

function updateHold(tab, keyPressed) {
  if (keyPressed) P.holdSpent = false;
  const was = P.hold;
  let now = false;
  if (tab && isPage(tab) && !P.holdSpent) {
    now = S.E.unfinishedTagAt(tab.state.doc, tab.state.selection.main.head);
  }
  P.hold = now;
  if (now && (keyPressed || !was)) {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      P.hold = false;
      P.holdSpent = true;
      pump();
    }, 3000);
  } else if (!now) {
    clearTimeout(holdTimer);
  }
  return was && !now;
}

export function onKey(tab) {
  const kind = kindOf(tab);
  if (!kind.isPage && kind.previewMode !== 'swap') return;
  updateHold(tab, true);
  restartBigWait();
  const project = projectOf(tab);
  const page = pageTabOf(project);
  if (P.phase === 'none' && page) {
    P.projectId = project.id;
    P.showing = page.path;
    load();
    return;
  }
  if (kindOf(tab).previewMode === 'swap') {
    P.pendingCss.add(tab.path);
  } else {
    if (P.showing !== tab.path) {
      P.showing = tab.path;
      P.pendingY = tab.pageY;
    }
    P.pendingHtml = true;
  }
  if (P.lastMs > LETTER_FIRST_MS) pumpAfterPaint();
  else pump();
  updateHeader();
}

export function onCursor(tab) {
  if (updateHold(tab, false)) pump();
}

export function onLinkAdded(pageTab) {
  const project = projectOf(pageTab);
  if (project.id === P.projectId && project.pageTab === pageTab.path) {
    P.pendingHtml = true;
    pump();
  }
}

export function onTabSwitch(prev, next) {
  P.holdSpent = false;
  updateHold(next, false);
  otherSeq += 1;
  const project = projectOf(next);
  const wasOther = P.other !== null;
  P.other = null;
  if (S.sideShown && isOther(next)) {
    link.onTabSwitch(prev, next);
    showForOther(next);
    updateHeader();
    return;
  }
  // After a page shown for another file, the project's own page comes back with a real load.
  const same = !wasOther && project.id === P.projectId && prev && prev.projectId === project.id;
  if (same) {
    if (isPage(next)) {
      project.pageTab = next.path;
      const was = P.showing;
      P.showing = next.path;
      if (was !== P.showing) link.onShowingChanged();
      if (P.phase === 'none') {
        load();
      } else {
        P.pendingHtml = true;
        P.pendingY = next.pageY;
      }
    }
    pump();
    link.onTabSwitch(prev, next);
    updateHeader();
    return;
  }
  if (isPage(next)) project.pageTab = next.path;
  const page = pageTabOf(project);
  P.projectId = project.id;
  if (page) {
    P.showing = page.path;
    load();
  } else {
    goEmpty();
  }
  link.onTabSwitch(prev, next);
  updateHeader();
}

export function onHelpHidden() {
  pump();
  updateHeader();
}

// A load still running when the side hides is done again when it comes back, so the page
// gets its scroll, place and Show the Boxes with the side shown (C46).
export function onSideHidden() {
  if (P.phase === 'loading') {
    P.loadWanted = true;
    clearReadyWait();
  }
  setWidthButtons(false);
  updateHeader();
}

// The side is back: the wanted load, or the messages that waited, then the header and the width.
export function onSideShown() {
  setWidthButtons(iframe.style.visibility !== 'hidden');
  const tab = activeTab();
  if (tab && isOther(tab)) {
    showForOther(tab);
    return;
  }
  P.other = null;
  const page = pageTabOf(S.projects.get(P.projectId));
  if (P.loadWanted || (P.phase === 'none' && (P.showing || page))) {
    if (!P.showing && page) P.showing = page.path;
    load();
  } else {
    pump();
  }
  updateHeader();
  if (P.width !== 'full') applyWidth();
}

// The page a file that is not a web page is shown with (WP3 step 6): (a) an open page tab
// that uses it, (b) a page in its own folder that uses it, (c) the project's page tab or any
// page in its folder, or nothing (d).
const LINK_ATTR = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;

function pageUses(page, file) {
  const base = `file:///${dirName(page.path).replace(/^\/+/, '')}/`;
  const want = `/${file.path.replace(/^\/+/, '')}`;
  for (const m of page.state.doc.toString().matchAll(LINK_ATTR)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!value || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    try {
      if (sameFile(decodeURIComponent(new URL(value, base).pathname), want)) return true;
    } catch {
      // A broken address uses nothing.
    }
  }
  return false;
}

async function relatedPage(tab) {
  const project = projectOf(tab);
  const own = pageTabOf(project);
  const pages = [
    ...(own ? [own] : []),
    ...tabsOf(project).filter((t) => t !== own && isPage(t)),
    ...S.tabs.filter((t) => t.projectId !== project.id && isPage(t)),
  ];
  const using = pages.find((page) => pageUses(page, tab));
  if (using) return { path: using.path, tab: using, project: projectOf(using), how: 'uses' };
  if (isOnDisk(tab)) {
    const list = await invoke('pages_using', { path: tab.path }).catch(() => []);
    const path = (list || []).find((p) => !tabByPath(p));
    if (path) return { path, tab: null, project, how: 'uses' };
  }
  const first = own || tabsOf(project).find(isPage);
  if (first) return { path: first.path, tab: first, project, how: 'folder' };
  if (project.folder && !project.bigFolder) {
    const plan = await invoke('plan_open', { paths: [project.folder] }).catch(() => null);
    const files = plan && plan.folders && plan.folders[0] ? plan.folders[0].files : [];
    const path = files.find((p) => kindOrCode(baseName(p)).isPage);
    if (path) return { path, tab: null, project, how: 'folder' };
  }
  return null;
}

let otherSeq = 0;

async function showForOther(tab) {
  const seq = ++otherSeq;
  const found = await relatedPage(tab);
  if (seq !== otherSeq || !S.sideShown || activeTab() !== tab) return;
  const project = found ? found.project : projectOf(tab);
  if (!project || !S.projects.has(project.id)) return;
  P.other = { file: tab.path, how: found ? found.how : 'none' };
  P.projectId = project.id;
  if (!found) {
    goEmpty();
    return;
  }
  if (found.tab) project.pageTab = found.tab.path;
  const was = P.showing;
  P.showing = found.path;
  if (was !== P.showing) link.onShowingChanged();
  if (was !== P.showing || P.phase === 'none' || P.loadWanted) load();
  else pump();
  updateHeader();
  if (P.width !== 'full') applyWidth();
}

export function goEmpty() {
  note('empty');
  P.phase = 'none';
  P.loadWanted = false;
  P.loadId += 1;
  P.out = null;
  P.showing = null;
  clearWatchdog();
  clearReadyWait();
  P.lastLinks = [];
  P.hasStyle = false;
  P.hasScript = false;
  P.outKind = null;
  P.outDoc = null;
  P.loadDoc = null;
  P.shownDoc = null;
  P.pv = -1;
  link.onPageGone();
  showFrame(false);
  updateHeader();
}

export function reset() {
  P.projectId = null;
  P.other = null;
  otherSeq += 1;
  goEmpty();
  link.onAllClosed();
}

export function cssTabClosed(tab, project) {
  if (project.id !== P.projectId || !P.showing) return;
  const inUse = P.sentCss.has(tab.path) || (!project.folder && P.lastLinks.includes(tab.name));
  P.pendingCss.delete(tab.path);
  if (inUse) load();
}

export function pageTabMoved(project) {
  if (project.id !== P.projectId) return;
  const tab = activeTab();
  if (P.other && tab && isOther(tab) && S.sideShown) {
    showForOther(tab);
    return;
  }
  const page = pageTabOf(project);
  if (!page) {
    goEmpty();
    return;
  }
  const was = P.showing;
  P.showing = page.path;
  if (was !== P.showing) link.onShowingChanged();
  if (P.phase === 'none') {
    load();
  } else {
    P.pendingHtml = true;
    P.pendingY = page.pageY;
    pump();
  }
}

export function reloadAfterMove(project, pathMap) {
  if (project.id !== P.projectId) return;
  if (P.showing && pathMap.has(P.showing)) P.showing = pathMap.get(P.showing);
  if (P.other && pathMap.has(P.other.file)) P.other.file = pathMap.get(P.other.file);
  link.onPathsMoved(pathMap);
  const moved = new Set();
  for (const old of P.sentCss) moved.add(pathMap.get(old) || old);
  P.sentCss = moved;
  // A renamed style file still waiting to be sent, and a place still to go to (WP5).
  const waiting = new Set();
  for (const old of P.pendingCss) waiting.add(pathMap.get(old) || old);
  P.pendingCss = waiting;
  if (P.place && pathMap.has(P.place.path)) P.place = { ...P.place, path: pathMap.get(P.place.path) };
  load();
}

export async function onWindowFocused() {
  const project = activeProject();
  if (!project || !project.folder || S.dialogOpen || S.panelOpen) return;
  const stamp = await invoke('folder_stamp', stampArgs(project));
  if (stamp === project.stamp || S.dialogOpen || S.panelOpen) return;
  project.stamp = stamp;
  if (project.id === P.projectId && P.showing) load();
}

export async function noteWrite(project) {
  if (project.folder) project.stamp = await invoke('folder_stamp', stampArgs(project));
}

function showFrame(on) {
  empty.hidden = on;
  iframe.style.visibility = on ? '' : 'hidden';
  setWidthButtons(on && S.sideShown);
}

function setText(el, text) {
  if (el.textContent !== text) {
    el.textContent = text;
    el.title = text;
  }
}

const BROWSER_WORDS = `Open in ${browserName}`;
export const SCRIPT_HINT = `Scripts do not run here. ${BROWSER_WORDS} to see them work.`;

// The script hint carries a button for the Open in Browser command, so a page that needs its scripts has a way out.
// The words around it shrink first, so a short header still shows the button.
function setHint(el, text) {
  if (el.textContent === text) return;
  el.title = text;
  el.classList.toggle('with-link', text === SCRIPT_HINT);
  // While the hint carries the button, the page title gives up its room first, so a narrow side still shows it.
  if (el.parentElement) el.parentElement.classList.toggle('hint-has-link', text === SCRIPT_HINT);
  if (text !== SCRIPT_HINT) {
    el.textContent = text;
    return;
  }
  const at = text.indexOf(BROWSER_WORDS);
  const words = (part, cls) => {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = part;
    return span;
  };
  const button = document.createElement('button');
  button.id = 'hint-browser';
  button.type = 'button';
  button.className = 'link';
  button.textContent = BROWSER_WORDS;
  el.replaceChildren(
    words(text.slice(0, at), 'hint-lead'),
    button,
    words(text.slice(at + BROWSER_WORDS.length), 'hint-tail'),
  );
}

function hintFor(tab, project, other) {
  if (project.folderRefused) return `${computerName} said no to this folder, so other files may be missing.`;
  const page = pageTabOf(project);
  if (P.hasScript) return SCRIPT_HINT;
  if (other && other.how === 'folder') return 'A page from this folder';
  if (project.kind === 'practice') return 'This is a practice copy';
  if (page && S.ed && S.ed.hintActive(page === tab ? S.ed.view.state : page.state)) {
    return 'The mistake changes your page too';
  }
  const seeing = link.headerHint(tab, project);
  if (seeing) return seeing;
  if (kindOf(tab).previewMode === 'swap') {
    return P.lastLinks.includes(tab.name)
      ? `${tab.name} changes how this page looks`
      : `This page does not use ${tab.name} yet`;
  }
  const pages = tabsOf(project).filter(isPage);
  if (isPage(tab) && pages[0] !== tab && !tab.typed) return 'A new tab shows a new page';
  if (pages.length === 1) {
    const linked = tabsOf(project).find((t) => kindOf(t).previewMode === 'swap' && P.lastLinks.includes(t.name));
    if (linked) return `The style comes from ${linked.name}`;
  }
  if (!P.lastLinks.length && P.hasStyle) return 'The style is inside this page';
  return 'Changes as you type';
}

export function updateHeader() {
  const label = document.getElementById('page-label');
  const hint = document.getElementById('page-hint');
  if (!label) return;
  const tab = activeTab();
  const project = activeProject();
  const other = tab && P.other && P.other.file === tab.path ? P.other : null;
  setNoPage(other && other.how === 'none' ? tab : null);
  if (!tab || !project || !P.showing) {
    setText(label, 'Nothing to show yet');
    setHint(hint, '');
    updatePracticeBar(tab);
    return;
  }
  const single = project.kind === 'practice' && tabsOf(project).length === 1;
  const shown = baseName(P.showing);
  if (other && other.how === 'uses') setText(label, `Showing ${shown}, which uses ${tab.name}`);
  else setText(label, single ? 'Showing the practice page' : `Showing ${shown}`);
  setHint(hint, hintFor(tab, project, other));
  updatePracticeBar(tab);
  updatePointButton(project);
}

// The no-page side of mockup 04, for a file with no page to show it with.
let noPageFor = null;
function setNoPage(tab) {
  const panel = document.getElementById('page-panel');
  const box = document.getElementById('page-none');
  if (!panel || !box) return;
  const name = tab ? tab.name : null;
  if (name === noPageFor) return;
  noPageFor = name;
  panel.classList.toggle('no-page', !!name);
  box.hidden = !name;
  if (!name) return;
  const code = document.createElement('code');
  code.className = 'none-code';
  code.textContent = name;
  document.getElementById('page-none-line').replaceChildren(
    code,
    ' is not a web page. My page shows web pages made with HTML, and this folder has none.',
  );
}

// Point needs the page tab's own page: a page reached by a link has no code open.
function updatePointButton(project) {
  const button = document.getElementById('btn-point');
  if (!button || iframe.style.visibility === 'hidden' || !S.sideShown) return;
  const page = pageTabOf(project);
  const tab = activeTab();
  const off = !page || P.showing !== page.path || (!!tab && isOther(tab));
  if (button.disabled !== off) button.disabled = off;
}

function updatePracticeBar(tab) {
  const bar = document.getElementById('practice-bar');
  if (!bar) return;
  const on = !!(tab && tab.topicId && tab.bar);
  if (bar.hidden === on) bar.hidden = !on;
  if (!on || bar.dataset.topic === tab.topicId) return;
  bar.dataset.topic = tab.topicId;
  const text = document.getElementById('practice-text');
  text.textContent = '';
  const lead = document.createElement('b');
  lead.textContent = 'Your turn: ';
  text.append(lead);
  tab.bar.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (part.startsWith('**')) {
      const word = document.createElement('b');
      const value = part.slice(2, -2);
      word.textContent = value;
      word.style.color = value;
      if (word.style.color) word.className = 'color-word';
      text.append(word);
    } else if (part) {
      text.append(part);
    }
  });
}

const WIDTHS = { phone: 375, tablet: 768 };

function setWidthButtons(on) {
  for (const id of ['btn-point', 'btn-boxes', 'w-phone', 'w-tablet', 'w-full', 'btn-safari']) {
    const button = document.getElementById(id);
    if (button) button.disabled = !on;
  }
}

function applyWidth() {
  const wrap = document.getElementById('page-frame-wrap');
  for (const [id, name] of [
    ['w-phone', 'phone'],
    ['w-tablet', 'tablet'],
    ['w-full', 'full'],
  ]) {
    const button = document.getElementById(id);
    if (button) button.setAttribute('aria-pressed', String(P.width === name));
  }
  const style = iframe.style;
  if (P.width === 'full') {
    wrap.classList.remove('sized');
    style.width = '';
    style.height = '';
    style.transform = '';
    style.transformOrigin = '';
    style.margin = '';
    if (resizeObserver) resizeObserver.disconnect();
    return;
  }
  // A hidden side has no room; the width is applied again when it comes back.
  const room = wrap.clientWidth;
  if (!room) return;
  wrap.classList.add('sized');
  const width = WIDTHS[P.width];
  style.width = `${width}px`;
  if (width <= room) {
    style.height = '100%';
    style.transform = '';
    style.margin = '0 auto';
  } else {
    const scale = room / width;
    style.height = `${wrap.clientHeight / scale}px`;
    style.transform = `scale(${scale})`;
    style.transformOrigin = '0 0';
    style.margin = '0';
  }
  if (!resizeObserver) resizeObserver = new ResizeObserver(() => P.width !== 'full' && applyWidth());
  resizeObserver.observe(wrap);
}

export function setWidth(name) {
  if (iframe.style.visibility === 'hidden') return;
  P.width = name;
  applyWidth();
}

const probes = new Map();

export function __probe(sel, prop, extra) {
  return ask({ ...extra, t: 'probe', sel, prop });
}

export function __hover(sel, index = 0) {
  return ask({ t: 'hover', sel, index });
}

export function __pickAt(sel, index = 0) {
  return ask({ t: 'pickAt', sel, index });
}

export function __click(sel, index = 0) {
  return ask({ t: 'click', sel, index });
}

function ask(msg) {
  const id = P.nextId++;
  return new Promise((resolve) => {
    probes.set(id, resolve);
    iframe.contentWindow.postMessage({ ...msg, id }, '*');
    setTimeout(() => {
      if (probes.has(id)) {
        probes.delete(id);
        resolve(null);
      }
    }, 2000);
  });
}

export const __nav = onNav;
