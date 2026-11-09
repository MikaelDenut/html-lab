// Change a file's name, and the places that use it (0.3.0 WP5, F3; mockups 05 to 09).
// C9: nothing on disk changes until the user confirms the name in its dialog. C44: the rename
// never replaces a file (core rename_file). C45: only the planned places change, each file keeps
// its style, and every file is reported on its own (C5).
//
// The steps, in the brief's order, run in the project's write queue after the auto-save timer
// is cleared: (1) plan again and compare, (2) the renamed file on disk or in memory, (3) the
// places, disk first, then the editors, (4) tab, path, kind, buffers, session, stamp, preview.
import { invoke } from './api.js';
import {
  S,
  activeTab,
  baseName,
  dirName,
  isChanged,
  isOnDisk,
  isPage,
  kindOf,
  kindOrCode,
  languageIdFor,
  languageRow,
  projectOf,
  sameFile,
  tabByPath,
  tabsOf,
  writeStyle,
} from './state.js';
import { renderStrip, setStripHooks, syncMenu, updateFooter, updateStatus, withSide, activeFor } from './tabs.js';
import * as preview from './preview.js';
import * as flows from './flows.js';
import { nameProblemText, showMessage, showRenameDialog } from './dialogs.js';
import { updateInside } from './inside.js';
import { escapeHtml as esc } from './views.js';

const TIP_HTML = 'Type a new name. Press <b>Enter</b> to change it, or <b>Esc</b> to stop.';
const ACTIVE_MS = 500;
const UNDO_MS = 15000;
const NOTE_MS = 6000;

const $ = (id) => document.getElementById(id);

// A list of strings and { code } parts as HTML, names as code.
function richHtml(parts) {
  if (!Array.isArray(parts)) return esc(parts);
  return parts.map((p) => (typeof p === 'string' ? esc(p) : `<code>${esc(p.code)}</code>`)).join('');
}

// File names in a sentence: at most 3, then how many more (as namesList in flows.js).
function namesText(names) {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  let out = '';
  shown.forEach((name, i) => {
    if (i) out += i === shown.length - 1 && !rest ? ' and ' : ', ';
    out += name;
  });
  return rest ? `${out} and ${rest} more` : out;
}

const namesIn = (project) => [...tabsOf(project).map((t) => t.name), ...project.hiddenFiles.map((f) => f.name)];
const tabEl = (path) => [...document.querySelectorAll('#tab-list .tab')].find((el) => el.dataset.path === path) || null;
const renameSpec = (changes) => ({
  changes,
  annotations: [S.E.renameEdit.of(true), S.E.Transaction.addToHistory.of(false)],
});

// ---------- the field in the tab (mockup 05) ----------

export const fieldOpen = () => !!(S.renaming && !S.renaming.pending);

// A pointerdown that closed the field must not open it again with its click.
let closedBy = null;
export const closedByPointer = (event) => closedBy === event;

// A click on the active tab's name opens the field only when that tab was active at
// pointerdown for at least 500 ms (WP5 step 6).
export const clickOpens = (path) => path === S.activePath && activeFor() >= ACTIVE_MS;

function outside(event) {
  const r = S.renaming;
  if (!r || r.pending || event.target === r.input) return;
  closedBy = event;
  cancelRename();
}

function attach(r) {
  const el = tabEl(r.path);
  if (!el) return false;
  el.classList.add('renaming');
  if (r.input.parentNode !== el) el.querySelector('.tab-main').after(r.input);
  return true;
}

function placeTip() {
  const r = S.renaming;
  const tip = $('rename-tip');
  const el = r && tabEl(r.path);
  if (!tip || !el) return;
  const panel = $('code-panel').getBoundingClientRect();
  const box = el.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.round(box.left - panel.left))}px`;
  tip.style.top = `${Math.round(box.bottom - panel.top + 6)}px`;
}

function paintTip(r) {
  const tip = $('rename-tip');
  const f = r.found;
  let html = TIP_HTML;
  let bad = false;
  if (f && f.problem) {
    html = richHtml(nameProblemText(f.problem, f.name));
    bad = true;
  } else if (f && f.taken) {
    html = richHtml(['You already have a file called ', { code: f.name }, '.']);
    bad = true;
  } else if (f && f.cleaned) {
    html = richHtml(['You will get ', { code: f.name }, '.']);
  }
  if (tip.innerHTML !== html) tip.innerHTML = html;
  tip.classList.toggle('bad', bad);
  r.input.setAttribute('aria-invalid', String(bad));
}

function closeField(r) {
  document.removeEventListener('pointerdown', outside, true);
  const el = r.input.closest('.tab');
  if (el) el.classList.remove('renaming');
  r.input.remove();
  const tip = $('rename-tip');
  tip.hidden = true;
  tip.textContent = '';
}

// The renderStrip hooks: a rebuild takes the field out, so it goes back with its focus and
// selection; it is cancelled only when its tab is gone.
setStripHooks({
  before() {
    const r = S.renaming;
    if (!r || r.pending || !r.input.isConnected) return;
    r.focused = document.activeElement === r.input;
    r.sel = [r.input.selectionStart, r.input.selectionEnd, r.input.selectionDirection];
  },
  after() {
    // A tab opens on every rebuild, so this is where a file Change Name wrote shows up in a new tab.
    if (toast.record && openedOutside(toast.record)) endUndo();
    const r = S.renaming;
    if (!r || r.pending) return;
    if (!tabByPath(r.path) || !attach(r)) {
      cancelRename();
      return;
    }
    if (r.focused) {
      r.input.focus({ preventScroll: true });
      if (r.sel) r.input.setSelectionRange(...r.sel);
    }
    placeTip();
  },
});

// File > Change Name..., Enter on the focused active tab, or a click on its name.
// A practice copy keeps its name. Returns whether the field opened.
export function renameFlow(path = S.activePath) {
  if (S.dialogOpen || S.renaming) return false;
  const tab = tabByPath(path);
  if (!tab || tab.path !== S.activePath) return false;
  const project = projectOf(tab);
  if (!project || project.kind === 'practice') return false;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-rename';
  input.spellcheck = false;
  for (const [k, v] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off']]) input.setAttribute(k, v);
  input.value = tab.name;
  input.setAttribute('aria-label', `New name for ${tab.name}`);
  input.setAttribute('aria-describedby', 'rename-tip');
  input.setAttribute('aria-invalid', 'false');
  const r = { path: tab.path, old: tab.name, input, seq: 0, found: null, pending: null, focused: true, sel: null, committing: false };
  S.renaming = r;
  input.addEventListener('input', () => check(r));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commit(r);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelRename({ focusEditor: true });
    }
  });
  document.addEventListener('pointerdown', outside, true);
  if (!attach(r)) {
    cancelRename();
    return false;
  }
  const dot = tab.name.lastIndexOf('.');
  input.focus();
  input.setSelectionRange(0, dot > 0 ? dot : tab.name.length);
  const tip = $('rename-tip');
  tip.hidden = false;
  paintTip(r);
  placeTip();
  check(r);
  syncMenu();
  return true;
}

// Esc, a pointerdown outside the field, a menu command or an app key: the old name stays.
export function cancelRename({ focusEditor = false } = {}) {
  const r = S.renaming;
  if (!r || r.pending) return;
  closeField(r);
  S.renaming = null;
  renderStrip();
  syncMenu();
  if (focusEditor && S.ed && activeTab() && !S.dialogOpen) S.ed.view.focus();
}

// The name as the field holds it now: cleaned (check_name), and free (file_name_free with the
// old name as except, so only a case-only change of its own name passes). The newest call wins.
async function check(r) {
  const mine = ++r.seq;
  const raw = r.input.value;
  const tab = tabByPath(r.path);
  const project = tab && projectOf(tab);
  const checked = await invoke('check_name', { old: r.old, new: raw });
  if (S.renaming !== r || mine !== r.seq) return null;
  let found;
  if (!checked.name) {
    found = { problem: checked.problem, name: raw };
  } else if (checked.name === r.old) {
    found = { name: checked.name, same: true, cleaned: checked.name !== raw };
  } else {
    const free = project
      ? await invoke('file_name_free', { tabs: namesIn(project), folder: project.folder, file: checked.name, except: r.old })
      : false;
    if (S.renaming !== r || mine !== r.seq) return null;
    found = { name: checked.name, taken: !free, cleaned: checked.name !== raw };
  }
  r.found = found;
  paintTip(r);
  return found;
}

async function commit(r) {
  if (r.committing) return;
  r.committing = true;
  let found = null;
  for (let i = 0; i < 5 && !found && S.renaming === r && !r.pending; i++) found = await check(r);
  r.committing = false;
  if (!found || S.renaming !== r || r.pending) return;
  if (found.same) {
    cancelRename({ focusEditor: true });
    return;
  }
  if (found.problem || found.taken) return;
  const tab = tabByPath(r.path);
  if (!tab) {
    cancelRename();
    return;
  }
  r.pending = found.name;
  closeField(r);
  renderStrip();
  try {
    await confirmAndRename(tab, found.name);
  } finally {
    if (S.renaming === r) S.renaming = null;
    renderStrip();
    updateStatus();
    syncMenu();
    if (S.ed && activeTab() && !S.dialogOpen) S.ed.view.focus();
  }
}

// ---------- the plan ----------

// The file type a name has, as the "Type changes" line names it.
function typeLabel(name) {
  const kind = kindOrCode(name);
  return kind.teaching ? kind.label : languageRow({ language: languageIdFor(name) }).label;
}

const relName = (root, path) => (path.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? path.slice(root.length + 1) : path);

// Every place that uses the tab's name. docPlan: in the editors' text (open tabs, and hidden files
// of a project with no folder) and in the closed files under the project folder; savedPlan: in
// the saved text of open tabs whose text differs from it, which is what is on disk.
async function planFor(tab, newName) {
  const project = projectOf(tab);
  const root = project.folder || `__new/${project.id}`;
  const prefix = `${root}/`.toLowerCase();
  const tabs = project.folder
    ? S.tabs.filter((t) => projectOf(t).folder && t.path.toLowerCase().startsWith(prefix))
    : tabsOf(project);
  const hidden = project.folder
    ? []
    : project.hiddenFiles.filter((f) => !f.picture).map((f) => ({ path: flows.newPath(project, f.name), text: f.code || '' }));
  const docPlan = await invoke('find_references', {
    root,
    target: tab.path,
    newName,
    open: [...tabs.map((t) => ({ path: t.path, text: t.state.doc.toString() })), ...hidden],
    walk: !!project.folder,
  });
  const changed = tabs.filter((t) => t.savedDoc !== null && !t.state.doc.eq(t.savedDoc));
  const savedPlan = changed.length
    ? await invoke('find_references', {
      root,
      target: tab.path,
      newName,
      open: changed.map((t) => ({ path: t.path, text: t.savedDoc.toString() })),
      walk: false,
    })
    : { files: [], capped: false };
  return { root, tabs, docPlan, savedPlan, capped: docPlan.capped };
}

function placesOf(plan) {
  const out = [];
  for (const file of plan.docPlan.files) {
    for (const span of file.spans) {
      out.push({ file: relName(plan.root, file.path), line: span.line, lineText: span.lineText, lineFrom: span.lineFrom, lineTo: span.lineTo });
    }
  }
  return out;
}

const placesKey = (plan) => JSON.stringify(
  [plan.docPlan, plan.savedPlan].map((p) => p.files.map((f) => [f.path, f.spans.map((s) => [s.from, s.to, s.oldText])])),
);

const countPlaces = (plan) => plan.docPlan.files.reduce((n, f) => n + f.spans.length, 0);

// A text with the spans (UTF-16 offsets) replaced, or null when a span does not hold its old text.
function splice(text, spans) {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  let out = '';
  let at = 0;
  for (const s of sorted) {
    if (s.from < at || text.slice(s.from, s.to) !== s.oldText) return null;
    out += text.slice(at, s.from) + s.newText;
    at = s.to;
  }
  return out + text.slice(at);
}

// A Text for a tab's savedDoc from a string: the doc itself when they are equal.
function textFor(tab, text) {
  return text === tab.state.doc.toString() ? tab.state.doc : S.ed.setText(tab.state, text).doc;
}

// ---------- the dialog and doing it ----------

async function confirmAndRename(tab, newName) {
  const project = projectOf(tab);
  const oldName = tab.name;
  await flows.loadLanguagesFor([newName]);
  if (!S.tabs.includes(tab)) return;
  let plan = await planFor(tab, newName);
  const extra = [];
  const from = typeLabel(tab.name);
  const to = typeLabel(newName);
  if (from !== to) extra.push(`The file type changes from ${from} to ${to}.`);
  if (kindOf(tab).isPage && !kindOrCode(newName).isPage) {
    extra.push(`${newName} will not be a web page any more, so My page will not show it.`);
  }
  const answer = await showRenameDialog({
    oldName: tab.name,
    newName,
    places: placesOf(plan),
    capped: plan.capped,
    saved: !!project.folder,
    extra,
    submit: async (ticked) => {
      const outcome = await doRename(tab, newName, plan, ticked);
      if (outcome.replan) {
        plan = outcome.replan;
        return { places: placesOf(plan), capped: plan.capped };
      }
      return { value: outcome };
    },
  });
  if (!answer || answer === 'keep' || answer.fail) restartAutosave();
  if (!answer || answer === 'keep') return;
  if (answer.fail) {
    await showFailure({ name: newName, old: oldName, ...answer });
    return;
  }
  showToast(toastText(answer), answer.record);
}

async function showFailure({ fail, name, old }) {
  let title = 'HTML Lab could not change the name.';
  let text = [{ code: old }, ' keeps its old name.'];
  if (fail === 'file_exists') {
    title = ['You already have a file called ', { code: name }, '.'];
    text = 'The name did not change.';
  } else if (fail === 'not_found') {
    title = ['HTML Lab cannot find ', { code: old }, ' any more, so the name did not change.'];
    text = '';
  }
  await showMessage({ title, text, buttons: [{ id: 'ok', label: 'OK', primary: true }] });
}

function doRename(tab, newName, firstPlan, ticked) {
  const project = projectOf(tab);
  endUndo();
  flows.clearAutosave();
  return flows.queued(project, async () => {
    await forgetting;
    if (!S.tabs.includes(tab)) return { fail: 'not_found', name: newName, old: tab.name };
    const plan = await planFor(tab, newName);
    if (placesKey(plan) !== placesKey(firstPlan)) return { replan: plan };
    const oldPath = tab.path;
    const oldName = tab.name;
    const memory = !project.folder || tab.savedDoc === null;

    // The renamed file. A tab never written moves in memory only; the next Save writes the new
    // name with mustNotExist. Its own unsaved edits stay unsaved under the new name (C9).
    let newPath;
    if (memory) {
      const free = await invoke('file_name_free', { tabs: namesIn(project), folder: project.folder, file: newName, except: oldName });
      if (!free) return { fail: 'file_exists', name: newName, old: oldName };
      newPath = `${dirName(oldPath)}/${newName}`;
    } else {
      try {
        // The new path keeps the folder as the project spells it; only the name comes back.
        const got = await invoke('rename_file', { from: oldPath, to: `${dirName(oldPath)}/${newName}` });
        newPath = `${dirName(oldPath)}/${baseName(got)}`;
      } catch (error) {
        return { fail: String(error), name: newName, old: oldName };
      }
    }

    const record = {
      tab, project, oldPath, oldName, newPath, newName, memory, tabs: [], disk: [], hidden: [], projects: new Set([project]),
    };
    let done = { places: 0, files: new Set(), failed: [] };
    if (ticked) {
      done = await changePlaces(plan, record);
      if (done.rollback) {
        if (!memory) await invoke('rename_file', { from: newPath, to: oldPath }).catch(() => {});
        return { fail: 'cannot_write', name: newName, old: oldName };
      }
    }
    const moved = applyName(tab, project, oldPath, newPath, newName);
    await finish(record, moved, oldPath, newPath);
    record.renamedDoc = tab.state.doc;
    record.renamedSaved = tab.savedDoc;
    for (const e of record.tabs) {
      e.afterDoc = e.tab.state.doc;
      e.afterSaved = e.tab.savedDoc;
    }
    return {
      oldName, newName, ticked, total: countPlaces(plan), places: done.places, files: done.files.size, failed: done.failed, record,
    };
  });
}

// The places, when ticked. Disk first, each file in the write queue of the project it belongs
// to: closed files with their decoded text, open tabs with their saved text (C6). Only if that
// cannot run at all (the folder is gone) is every written file put back. Then the editors,
// with transactions Cmd+Z never undoes, after a check that each span still holds its old text.
async function changePlaces(plan, record) {
  const { project, oldPath, newPath } = record;
  const at = (path) => (path === oldPath ? newPath : path);
  const byPath = new Map(plan.tabs.map((t) => [t.path, t]));
  const docFiles = new Map(plan.docPlan.files.map((f) => [f.path, f]));
  const savedFiles = new Map(plan.savedPlan.files.map((f) => [f.path, f]));
  const hiddenAt = (path) => project.hiddenFiles.find((f) => !f.picture && flows.newPath(project, f.name) === path) || null;
  const failed = new Set();
  const files = new Set();
  let places = 0;

  const jobs = new Map();
  const add = (owner, entry) => {
    if (!jobs.has(owner)) jobs.set(owner, []);
    jobs.get(owner).push(entry);
  };
  for (const file of plan.docPlan.files) {
    if (byPath.has(file.path) || hiddenAt(file.path)) continue;
    add(project, { file, write: { path: file.path, open: false, size: file.size, hash: file.hash, spans: file.spans } });
  }
  for (const t of plan.tabs) {
    const owner = projectOf(t);
    if (t.savedDoc === null || !owner.folder) continue;
    const ref = t.state.doc.eq(t.savedDoc) ? docFiles.get(t.path) : savedFiles.get(t.path);
    if (!ref) continue;
    add(owner, {
      tab: t,
      write: {
        path: at(t.path), open: true, size: ref.size, hash: ref.hash, spans: ref.spans, text: t.savedDoc.toString(), ...writeStyle(t.style),
      },
    });
  }

  const results = new Map();
  let gone = false;
  for (const [owner, entries] of jobs) {
    const run = async () => {
      const got = await invoke('rewrite_references', { plan: entries.map((e) => e.write) });
      entries.forEach((e, i) => results.set(e, got[i]));
    };
    try {
      if (owner === project) await run();
      else await flows.queued(owner, run);
    } catch {
      gone = true;
    }
    record.projects.add(owner);
  }
  const written = [...results.values()].filter((r) => r && r.ok).map((r) => ({ path: r.path, size: r.size, hash: r.hash }));
  if (gone || [...results.values()].some((r) => r && r.error === 'folder_gone')) {
    if (written.length) await invoke('restore_references', { files: written, check: false }).catch(() => {});
    forget();
    return { rollback: true };
  }
  record.disk = written;

  const savedText = new Map();
  for (const [entry, result] of results) {
    const name = relName(plan.root, entry.file ? entry.file.path : entry.tab.path);
    if (!result || !result.ok) {
      failed.add(name);
      continue;
    }
    if (entry.tab) savedText.set(entry.tab, result.text);
    else {
      places += entry.file.spans.length;
      files.add(entry.file.path);
    }
  }

  for (const t of plan.tabs) {
    const ref = docFiles.get(t.path);
    const owner = projectOf(t);
    const entry = { tab: t, changes: null, startDoc: null, beforeSaved: t.savedDoc };
    if (ref) {
      const state = t.view ? t.view.state : t.state;
      const text = state.doc.toString();
      if (ref.spans.every((s) => text.slice(s.from, s.to) === s.oldText)) {
        const tr = state.update(renameSpec(ref.spans.map((s) => ({ from: s.from, to: s.to, insert: s.newText }))));
        if (t.view) t.view.dispatch(tr);
        else t.state = tr.state;
        entry.changes = tr.changes;
        entry.startDoc = tr.startState.doc;
        places += ref.spans.length;
        files.add(t.path);
      } else {
        failed.add(relName(plan.root, t.path));
      }
    }
    if (savedText.has(t)) {
      t.savedDoc = textFor(t, savedText.get(t));
    } else if (t.savedDoc !== null && !owner.folder) {
      // A project with no folder: its saved text is in memory, changed the same way.
      const clean = entry.startDoc ? entry.startDoc.eq(t.savedDoc) : false;
      const spans = clean ? ref.spans : (savedFiles.get(t.path) || { spans: [] }).spans;
      const next = spans.length ? splice(t.savedDoc.toString(), spans) : null;
      if (next !== null) t.savedDoc = textFor(t, next);
    }
    if (entry.changes || t.savedDoc !== entry.beforeSaved) {
      record.tabs.push(entry);
      record.projects.add(owner);
    }
  }

  for (const file of plan.docPlan.files) {
    const hidden = hiddenAt(file.path);
    if (!hidden) continue;
    const next = splice(hidden.code || '', file.spans);
    if (next === null) {
      failed.add(hidden.name);
      continue;
    }
    record.hidden.push({ file: hidden, before: hidden.code || '', after: next });
    hidden.code = next;
    places += file.spans.length;
    files.add(file.path);
  }
  return { places, files, failed: [...failed] };
}

// The tab takes its new name, path and kind (the language goes through the Compartment, so its
// undo history stays), and the project's page tab and the active path follow it.
function applyName(tab, project, fromPath, toPath, toName) {
  const was = kindOf(tab);
  const kind = kindOrCode(toName);
  const language = languageIdFor(toName);
  const fromName = tab.name;
  tab.name = toName;
  tab.path = toPath;
  tab.kind = kind.id;
  // A language can follow the name itself (TypeScript is TSX only in a .tsx file), so a new name
  // sets the language again even when its row stays the same.
  if (language !== tab.language || !!was.teaching !== !!kind.teaching || (!kind.teaching && fromName !== toName)) {
    S.ed.setLanguage(tab, language, { teaching: !!kind.teaching, fileName: toName });
  }
  let pageMoved = false;
  if (project.pageTab === fromPath) {
    if (kind.isPage) project.pageTab = toPath;
    else {
      const next = tabsOf(project).find((t) => t !== tab && isPage(t));
      project.pageTab = next ? next.path : null;
      pageMoved = true;
    }
  } else if (!project.pageTab && kind.isPage) {
    project.pageTab = toPath;
    pageMoved = true;
  }
  if (S.activePath === fromPath) S.activePath = toPath;
  flows.refreshLone(project);
  return { kindChanged: was.id !== kind.id || !!was.isPage !== !!kind.isPage, pageMoved };
}

// Buffers (the old key dropped, the new one set while the text is not what is on disk), the
// session, the folder stamps and the preview, after a change of name either way.
async function finish(record, moved, fromPath, toPath) {
  const { tab, project } = record;
  const tabs = new Set([tab, ...record.tabs.map((e) => e.tab)]);
  const set = [];
  const drop = [fromPath];
  for (const t of tabs) {
    if (!S.tabs.includes(t)) continue;
    if (!isOnDisk(t) || isChanged(t)) set.push({ path: t.path, text: t.state.doc.toString() });
    else drop.push(t.path);
  }
  for (const h of record.hidden) set.push({ path: flows.newPath(project, h.file.name), text: h.file.code });
  await invoke('drop_buffers', { paths: drop });
  if (set.length) await invoke('set_buffers', { files: set });
  for (const p of record.projects) {
    if (p.folder && S.projects.has(p.id)) await preview.noteWrite(p);
  }
  flows.writeSession();
  renderStrip();
  updateStatus();
  updateFooter();
  updateInside();
  syncMenu();
  const pathMap = new Map([[fromPath, toPath]]);
  for (const p of record.projects) preview.reloadAfterMove(p, pathMap);
  if (moved.kindChanged && S.activePath === tab.path) withSide(() => preview.onTabSwitch(tab, tab));
  else if (moved.pageMoved) preview.pageTabMoved(project);
}

// The auto-save waits while Undo is offered, so Undo finds every file as the change left it.
function restartAutosave() {
  if (S.tabs.some(isChanged)) flows.noteChangeForAutosave();
}

function toastText(o) {
  if (!o.ticked) {
    if (!o.total) return 'Name changed.';
    return o.total === 1 ? `Name changed. 1 place still says ${o.oldName}.` : `Name changed. ${o.total} places still say ${o.oldName}.`;
  }
  if (o.failed.length) return `Name changed. These files still say ${o.oldName}: ${namesText(o.failed)}.`;
  if (!o.places) return 'Name changed.';
  if (o.places === 1) return `Name changed. 1 place now says ${o.newName}.`;
  return `Name changed. ${o.places} places now say ${o.newName}, in ${o.files} ${o.files === 1 ? 'file' : 'files'}.`;
}

// ---------- the toast and Undo (mockup 08) ----------

const toast = { record: null, timer: 0 };

// The bytes Rust keeps for Undo are let go of when Undo is over; the next change of name waits
// for that, so it never loses the bytes it keeps itself.
let forgetting = Promise.resolve();
function forget() {
  forgetting = invoke('forget_rewrites').catch(() => {});
}

function showToast(text, record) {
  const box = $('rename-toast');
  clearTimeout(toast.timer);
  toast.record = record || null;
  $('rename-toast-text').textContent = text;
  $('rename-undo').hidden = !record;
  box.hidden = false;
  S.renameUndo = !!record;
  syncMenu();
  toast.timer = setTimeout(record ? endUndo : hideToast, record ? UNDO_MS : NOTE_MS);
}

function hideToast() {
  clearTimeout(toast.timer);
  const box = $('rename-toast');
  if (box.contains(document.activeElement) && S.ed && activeTab()) S.ed.view.focus();
  box.hidden = true;
}

// Undo is over: 15 seconds went by, the user changed a touched file, or another name changed.
function endUndo() {
  if (!toast.record) return;
  toast.record = null;
  S.renameUndo = false;
  hideToast();
  forget();
  syncMenu();
  restartAutosave();
}

// A file Change Name wrote, open in a tab the change did not know (opened after it). Undo would
// put the old bytes on disk under that tab, which would still show the new text as saved.
function openedOutside(rec) {
  const known = new Set([rec.tab, ...rec.tabs.map((e) => e.tab)]);
  return S.tabs.some((t) => !known.has(t) && rec.disk.some((d) => sameFile(d.path, t.path)));
}

// From the editor: a change of the user's own (not one Change Name made) in a touched file.
export function noteUserEdit(tab) {
  const rec = toast.record;
  if (rec && (rec.tab === tab || rec.tabs.some((e) => e.tab === tab))) endUndo();
}

export const undoOffered = () => !!toast.record;

// The Undo button and File > Undo Change Name: the same steps backwards, in the write queue,
// only when every touched file is still as the change of name left it.
export async function undoRename() {
  const rec = toast.record;
  if (!rec) return false;
  toast.record = null;
  S.renameUndo = false;
  clearTimeout(toast.timer);
  $('rename-undo').hidden = true;
  syncMenu();
  flows.clearAutosave();
  const still = S.projects.has(rec.project.id) ? await flows.queued(rec.project, () => undoSteps(rec)).catch(() => false) : false;
  const back = still !== false;
  forget();
  restartAutosave();
  let text = 'A file changed after the new name, so the old name cannot come back by itself.';
  if (back) text = still.length ? `The old name is back. These files still say ${rec.newName}: ${namesText(still)}.` : 'The old name is back.';
  showToast(text, null);
  if (S.ed && activeTab() && !S.dialogOpen) S.ed.view.focus();
  return back;
}

const sameText = (a, b) => a === b || (!!a && !!b && a.eq(b));

// false when Undo cannot run and nothing changed; otherwise the names of the files that still
// say the new name, because their old bytes could not be written back.
async function undoSteps(rec) {
  const { tab, project } = rec;
  if (!S.tabs.includes(tab) || tab.path !== rec.newPath) return false;
  if (openedOutside(rec)) return false;
  if (!tab.state.doc.eq(rec.renamedDoc) || !sameText(tab.savedDoc, rec.renamedSaved)) return false;
  for (const e of rec.tabs) {
    if (!S.tabs.includes(e.tab) || !e.tab.state.doc.eq(e.afterDoc) || !sameText(e.tab.savedDoc, e.afterSaved)) return false;
  }
  for (const h of rec.hidden) {
    if (!project.hiddenFiles.includes(h.file) || h.file.code !== h.after) return false;
  }
  if (rec.disk.length) {
    const checks = await invoke('restore_references', { files: rec.disk, check: true });
    if (checks.some((c) => !c.ok)) return false;
  }

  let oldPath = rec.oldPath;
  if (rec.memory) {
    const free = await invoke('file_name_free', { tabs: namesIn(project), folder: project.folder, file: rec.oldName, except: rec.newName });
    if (!free) return false;
  } else {
    try {
      const got = await invoke('rename_file', { from: rec.newPath, to: rec.oldPath });
      oldPath = `${dirName(rec.newPath)}/${baseName(got)}`;
    } catch {
      return false;
    }
  }
  // A file whose old bytes could not go back keeps the new name on disk, so its tab keeps that
  // saved text: the old name in the editor then shows as a change still to save.
  const notBack = new Set();
  if (rec.disk.length) {
    const files = rec.disk.map((d) => (d.path === rec.newPath ? { ...d, at: oldPath } : d));
    const back = await invoke('restore_references', { files, check: false });
    back.forEach((b, i) => {
      if (!b.ok) notBack.add(rec.disk[i].path);
    });
  }
  for (const e of rec.tabs) {
    if (e.changes) {
      const state = e.tab.view ? e.tab.view.state : e.tab.state;
      const tr = state.update(renameSpec(e.changes.invert(e.startDoc)));
      if (e.tab.view) e.tab.view.dispatch(tr);
      else e.tab.state = tr.state;
    }
    if (!notBack.has(e.tab.path)) e.tab.savedDoc = e.beforeSaved;
  }
  for (const h of rec.hidden) h.file.code = h.before;
  const moved = applyName(tab, project, rec.newPath, oldPath, rec.oldName);
  await finish(rec, moved, rec.newPath, oldPath);
  const root = project.folder || '';
  return [...notBack].map((path) => relName(root, path === rec.newPath ? oldPath : path));
}

export function initRename() {
  $('rename-undo').addEventListener('click', () => undoRename());
}

// For the self-tests: no field, no toast and no Undo left over for the next test.
export function __reset() {
  const r = S.renaming;
  if (r) {
    closeField(r);
    S.renaming = null;
  }
  clearTimeout(toast.timer);
  toast.record = null;
  S.renameUndo = false;
  $('rename-toast').hidden = true;
  $('rename-undo').hidden = true;
  forget();
}
