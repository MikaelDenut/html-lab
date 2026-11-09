import { S as appState, activeTab, kindOf } from './state.js';

// The page and the code light each other up (PLAN "Seeing how it fits").
// Every DOM and preview touch goes through the hooks given to initLink, so
// this module also runs in node with fake hooks and a fake S.E.

const WAIT_MS = 150;
const MAX_BOXES = 600;
const KNOWN = new Set(['over', 'out', 'pick', 'names', 'ruled', 'boxed', 'pointOff']);
// The page never draws these, so a mark on one would outline nothing.
const UNSEEN = new Set(['head', 'title', 'meta', 'link', 'style', 'script', 'base', 'template', 'noscript']);

let H = null;
let S = appState;

const L = {
  point: false,
  boxes: false,
  boxCount: 0,
  names: null,
  namesPv: -1,
  askedPv: -1,
  align: null,
  alignNames: null,
  alignEls: null,
  waitOver: null,
  waitPick: null,
  litView: null,
  at: null,
  markFor: null,
  rule: null,
  ruleFor: null,
  hint: null,
  asks: [],
  dropReplies: 0,
  askedSel: null,
  sent: false,
  timer: 0,
};

export function initLink(hooks) {
  H = hooks;
  S = hooks.S || appState;
  stopTimer();
  Object.assign(L, {
    point: false,
    boxes: false,
    litView: null,
    at: null,
    markFor: null,
    rule: null,
    ruleFor: null,
    hint: null,
  });
  forgetPage();
}

const pv = () => H.pv();
const headOf = (state) => state.selection.main.head;
// A false return means the hook dropped it, so no reply will come.
const post = (msg) => H.post(msg) !== false;

function forgetPage() {
  L.names = null;
  L.namesPv = -1;
  L.askedPv = -1;
  L.align = null;
  L.alignNames = null;
  L.alignEls = null;
  L.waitOver = null;
  L.waitPick = null;
  L.asks = [];
  L.dropReplies = 0;
  L.askedSel = null;
  L.sent = false;
  L.boxCount = 0;
}

function newPage() {
  const boxHint = L.boxes && L.boxCount > MAX_BOXES;
  forgetPage();
  if (L.hint) setHint(null);
  else if (boxHint) H.updateHeader();
}

// Page names and the line-up

function namesReady() {
  return L.names !== null && L.namesPv === pv();
}

function askNames() {
  const v = pv();
  if (v < 0 || namesReady() || L.askedPv === v) return;
  if (post({ t: 'names' })) L.askedPv = v;
}

function lineUp(els) {
  if (!L.align || L.alignNames !== L.names || L.alignEls !== els) {
    L.align = S.E.alignPage(els, L.names);
    L.alignNames = L.names;
    L.alignEls = els;
  }
  return L.align;
}

function codeForChain(chain, align) {
  for (const n of chain || []) {
    const c = n >= 0 && n < align.pageToCode.length ? align.pageToCode[n] : -1;
    if (c >= 0) return c;
  }
  return -1;
}

function pageForCode(idx, els, align) {
  let c = idx;
  while (c >= 0 && c < els.length) {
    const p = c < align.codeToPage.length ? align.codeToPage[c] : -1;
    if (p >= 0) return p;
    const up = els[c].parent;
    if (!(up < c)) break;
    c = up;
  }
  return -1;
}

function onNames(msg) {
  if (msg.pv !== pv() || !Array.isArray(msg.list)) return;
  L.names = msg.list;
  L.namesPv = msg.pv;
  const over = L.waitOver;
  const pick = L.waitPick;
  L.waitOver = null;
  L.waitPick = null;
  if (over && over.pv === msg.pv) onOver(over);
  if (pick && pick.pv === msg.pv) selectPick(pick);
  tryMark();
}

// The page lights the code

function setLit(view, el) {
  if (!view) return;
  if (L.litView && L.litView !== view) S.E.setLit(L.litView, null);
  S.E.setLit(view, el);
  L.litView = el ? view : null;
}

function clearLit() {
  L.waitOver = null;
  if (L.litView) S.E.setLit(L.litView, null);
  L.litView = null;
}

function onOver(msg) {
  const page = H.pageTab();
  if (!page || activeTab() !== page || msg.pv !== pv() || !H.inSync()) {
    clearLit();
    return;
  }
  if (!namesReady()) {
    clearLit();
    L.waitOver = msg;
    askNames();
    return;
  }
  const els = S.E.codeElements(page.state);
  const idx = els ? codeForChain(msg.chain, lineUp(els)) : -1;
  if (idx < 0) clearLit();
  else setLit(page.view, els[idx]);
}

function onPick(msg) {
  setPoint(false, false);
  L.waitPick = null;
  const page = H.pageTab();
  if (!page) return;
  // Judge the step before switching: the switch sends the page again.
  const pick = msg.pv === pv() && H.inSync() ? { chain: msg.chain, pv: msg.pv, doc: page.state.doc } : null;
  if (pick) askNames();
  if (activeTab() !== page) H.switchTo(page.path);
  if (!pick) return;
  if (L.namesPv === pick.pv && L.names) selectPick(pick);
  else L.waitPick = pick;
}

function selectPick(pick) {
  const page = H.pageTab();
  if (!page || activeTab() !== page || !page.view || page.state.doc !== pick.doc) return;
  const els = S.E.codeElements(page.state);
  const idx = els ? codeForChain(pick.chain, lineUp(els)) : -1;
  if (idx >= 0) S.E.selectTagName(page.view, els[idx]);
}

// The code outlines the page

function startTimer() {
  clearTimeout(L.timer);
  L.timer = setTimeout(fire, WAIT_MS);
}

function stopTimer() {
  if (L.timer) clearTimeout(L.timer);
  L.timer = 0;
}

function fire() {
  L.timer = 0;
  if (L.markFor && L.markFor.timer) {
    L.markFor.timer = false;
    tryMark();
  }
  const rule = L.ruleFor;
  L.ruleFor = null;
  if (rule) showRule(rule);
}

// The innermost element around both ends of the selection, so a crumb that
// selects a whole element (head at its end) still means that element.
function elementIn(state, from, to) {
  if (from === to) return S.E.elementAt(state, from);
  let idx = S.E.elementAt(state, from + 1);
  const els = idx >= 0 ? S.E.codeElements(state) : null;
  while (idx >= 0 && els[idx].to < to) {
    const up = els[idx].parent;
    idx = up < idx ? up : -1;
  }
  return idx;
}

// Returns true when the cursor went into another element worth a mark.
// A move inside the same element keeps a mark that is already waiting.
function noteElement(tab, state, moved) {
  const { from, to } = state.selection.main;
  const before = L.at;
  L.at = { path: tab.path, doc: state.doc, from, to };
  if (!moved || !H.showingPage()) {
    L.markFor = null;
    return false;
  }
  const now = elementIn(state, from, to);
  if (before && before.path === tab.path && before.doc === state.doc && elementIn(state, before.from, before.to) === now) {
    return false;
  }
  L.markFor = null;
  if (now < 0) return false;
  const els = S.E.codeElements(state);
  if (!els || !els[now] || UNSEEN.has(els[now].name)) return false;
  L.markFor = { doc: state.doc, idx: now, timer: true };
  return true;
}

function tryMark() {
  const m = L.markFor;
  if (!m || m.timer) return;
  const page = H.pageTab();
  const sel = page ? page.state.selection.main : null;
  if (!page || activeTab() !== page || page.state.doc !== m.doc || elementIn(page.state, sel.from, sel.to) !== m.idx) {
    L.markFor = null;
    return;
  }
  if (!H.inSync()) return;
  if (!namesReady()) {
    askNames();
    return;
  }
  L.markFor = null;
  const els = S.E.codeElements(page.state);
  const i = els ? pageForCode(m.idx, els, lineUp(els)) : -1;
  if (i >= 0) post({ t: 'mark', i, pv: pv(), scroll: true });
}

// A CSS rule counts what it styles

function ruleTab(tab) {
  const kind = tab && kindOf(tab);
  return !!kind && (kind.isPage || kind.previewMode === 'swap');
}

function ruleContext(tab) {
  const kind = tab && kindOf(tab);
  if (!kind) return false;
  if (kind.isPage) return tab === H.pageTab() && H.showingPage();
  return kind.previewMode === 'swap' && H.linkedCss(tab);
}

function readRule(tab, state, pos) {
  if (!ruleTab(tab)) return null;
  const r = S.E.cssRuleAt(state, pos);
  return r ? { path: tab.path, doc: state.doc, from: r.from, to: r.to, sel: r.sel, ok: !!r.ok } : null;
}

function sameRule(a, b) {
  if (!a || !b) return a === b;
  if (a.path !== b.path || a.sel !== b.sel || a.ok !== b.ok) return false;
  return a.doc !== b.doc || (a.from === b.from && a.to === b.to);
}

function setHint(hint) {
  const was = L.hint;
  if (was === hint || (was && hint && was.path === hint.path && was.kind === hint.kind && was.n === hint.n)) return;
  L.hint = hint;
  H.updateHeader();
}

function askRule(sel, show) {
  L.askedSel = sel;
  L.sent = true;
  if (post({ t: 'rule', sel, show })) {
    L.asks.push(sel);
    if (L.asks.length > 64) L.asks.shift();
  }
}

function clearOutlines() {
  if (!L.sent) return;
  L.sent = false;
  // Replies to asks sent before the clear still come back, in order. They are
  // older than the clear, so they must not set the hint.
  L.dropReplies += L.asks.length;
  L.asks = [];
  L.askedSel = null;
  post({ t: 'rule', sel: null });
}

function leaveRule() {
  L.ruleFor = null;
  clearOutlines();
  setHint(null);
}

// Returns true when a rule now waits for the 150 ms wait.
function noteRule(tab, state, pos, moved) {
  const before = L.rule;
  const now = readRule(tab, state, pos);
  L.rule = now;
  if (sameRule(before, now)) return false;
  if (!now) {
    leaveRule();
    return false;
  }
  if (!ruleContext(tab)) {
    L.ruleFor = null;
    setHint(null);
    return false;
  }
  if (moved) {
    L.ruleFor = now;
    return true;
  }
  // Typing: no wait and no outlines. A finished selector is counted after the next page update.
  if (!now.ok) {
    clearOutlines();
    setHint({ path: now.path, kind: 'finish' });
  }
  return false;
}

function showRule(rule) {
  const tab = activeTab();
  if (!tab || tab.path !== rule.path || !sameRule(rule, L.rule) || !ruleContext(tab)) return;
  if (!rule.ok) {
    clearOutlines();
    setHint({ path: rule.path, kind: 'finish' });
    return;
  }
  askRule(rule.sel, true);
}

function reaskRule(always) {
  const rule = L.rule;
  const tab = activeTab();
  if (!rule || !rule.ok || L.ruleFor || !tab || tab.path !== rule.path || !ruleContext(tab)) return;
  // Skip only while a count for this rule is shown: after a "finish" hint or a
  // clear, the same selector must be asked again.
  const counted = L.hint && L.hint.kind === 'count' && L.hint.path === rule.path;
  if (!always && rule.sel === L.askedSel && counted) return;
  askRule(rule.sel, false);
}

function onRuled(msg) {
  if (L.dropReplies > 0) {
    L.dropReplies -= 1;
    return;
  }
  const sel = L.asks.shift();
  if (sel === undefined || msg.pv !== pv()) return;
  const rule = L.rule;
  const tab = activeTab();
  if (!rule || !rule.ok || rule.sel !== sel || !tab || tab.path !== rule.path) return;
  setHint(msg.ok ? { path: rule.path, kind: 'count', n: msg.count || 0 } : null);
}

// Point and Show the Boxes

function setPoint(on, tell) {
  if (L.point === on) return;
  L.point = on;
  if (tell) post({ t: 'point', on });
  H.setPressed('btn-point', on);
  H.syncMenu();
}

function onBoxed(msg) {
  if (!L.boxes) return;
  const was = L.boxCount > MAX_BOXES;
  L.boxCount = msg.count || 0;
  if ((L.boxCount > MAX_BOXES) !== was) H.updateHeader();
}

// Entry points for preview.js, app.js and tabs.js

export function onHelperMessage(msg) {
  const known = !!msg && KNOWN.has(msg.t);
  if (!known || !H || !S.E) return known;
  if (msg.t === 'over') onOver(msg);
  // The lit lines and the chip stay when the mouse leaves the page, so the mouse
  // can reach the chip. A cursor move, a change or the next hover clears them.
  else if (msg.t === 'out') L.waitOver = null;
  else if (msg.t === 'pick') onPick(msg);
  else if (msg.t === 'names') onNames(msg);
  else if (msg.t === 'ruled') onRuled(msg);
  else if (msg.t === 'boxed') onBoxed(msg);
  else setPoint(false, false);
  return true;
}

export function onPageReady() {
  if (!H) return;
  setPoint(false, false);
  clearLit();
  newPage();
  if (L.boxes) post({ t: 'boxes', on: true });
  H.syncMenu();
  reaskRule(true);
  tryMark();
}

export function onPageDone(kind) {
  if (!H) return;
  reaskRule(kind === 'html');
  tryMark();
}

export function onPageGone() {
  if (!H) return;
  setPoint(false, false);
  clearLit();
  newPage();
  H.syncMenu();
}

// Another page shows without a full load (a tab switch inside one project, or
// the page tab closed). Point turns off, as on a load.
export function onShowingChanged() {
  if (!H) return;
  setPoint(false, true);
  clearLit();
  H.syncMenu();
}

// After the first Save or Save a Copy the tabs have new paths.
export function onPathsMoved(pathMap) {
  if (!H) return;
  for (const key of ['at', 'rule', 'hint']) {
    const v = L[key];
    if (v && pathMap.has(v.path)) L[key] = { ...v, path: pathMap.get(v.path) };
  }
}

export function onCursorMove(tab) {
  if (!H || !tab || !S.E) return;
  const state = tab.state;
  const pos = headOf(state);
  clearLit();
  let wait = false;
  if (tab === H.pageTab()) wait = noteElement(tab, state, true);
  if (noteRule(tab, state, pos, true)) wait = true;
  if (wait) startTimer();
  else if (!L.markFor && !L.ruleFor) stopTimer();
}

export function onDocChange(tab) {
  if (!H || !tab || !S.E) return;
  const state = tab.state;
  const pos = headOf(state);
  L.ruleFor = null;
  if (tab === H.pageTab()) noteElement(tab, state, false);
  else L.markFor = null;
  noteRule(tab, state, pos, false);
  if (!L.markFor && !L.ruleFor) stopTimer();
}

export function onTabSwitch(prev, next) {
  if (!H) return;
  clearLit();
  L.waitPick = null;
  L.markFor = null;
  L.ruleFor = null;
  stopTimer();
  if (!next) return;
  if (!prev || prev.projectId !== next.projectId) setPoint(false, true);
  const state = next.state;
  const pos = headOf(state);
  const { from, to } = state.selection.main;
  L.at = { path: next.path, doc: state.doc, from, to };
  clearOutlines();
  const rule = S.E ? readRule(next, state, pos) : null;
  L.rule = rule;
  if (!rule || !ruleContext(next)) {
    setHint(null);
  } else if (!rule.ok) {
    setHint({ path: next.path, kind: 'finish' });
  } else {
    setHint(null);
    askRule(rule.sel, false);
  }
}

export function onHelpShown() {
  if (!H) return;
  setPoint(false, true);
  clearLit();
}

export function togglePoint() {
  if (!H) return;
  if (L.point) setPoint(false, true);
  else if (H.showingPage()) setPoint(true, true);
}

export function toggleBoxes() {
  if (!H) return;
  L.boxes = !L.boxes;
  L.boxCount = 0;
  post({ t: 'boxes', on: L.boxes });
  H.setPressed('btn-boxes', L.boxes);
  H.syncMenu();
  H.updateHeader();
}

// The last tab closed: Show the Boxes ends with it, so the next page starts plain.
export function onAllClosed() {
  if (!H || !L.boxes) return;
  L.boxes = false;
  L.boxCount = 0;
  H.setPressed('btn-boxes', false);
  H.syncMenu();
  H.updateHeader();
}

export function pointOn() {
  return L.point;
}

export function boxesOn() {
  return L.boxes;
}

export function headerHint(tab, project) {
  if (!H || !tab || !project) return null;
  if (L.boxes && L.boxCount > MAX_BOXES) return 'Showing the first 600 boxes';
  const hint = L.hint;
  if (!hint || hint.path !== tab.path || !ruleContext(tab)) return null;
  if (hint.kind === 'finish') return 'Finish this rule to see what it styles.';
  if (hint.n === 0) return 'This rule does not style anything on this page yet';
  if (hint.n === 1) return 'This rule styles 1 thing on this page';
  return `This rule styles ${hint.n} things on this page`;
}
