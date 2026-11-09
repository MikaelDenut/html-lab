import { computerName, fileManager } from './platform.js';
import { invoke } from './api.js';
import {
  S,
  activeProject,
  activeTab,
  baseName,
  dirName,
  isChanged,
  isOnDisk,
  isPage,
  kindForName,
  kindOf,
  kindOrCode,
  languageIdFor,
  newProjectId,
  pageTabOf,
  plainStyle,
  projectOf,
  sameFile,
  stampArgs,
  tabByPath,
  tabsOf,
  writeStyle,
} from './state.js';
import * as preview from './preview.js';
import { updateInside } from './inside.js';
import { firstPageOf, forgetActive, noteDocChange, renderStrip, switchTo, syncMenu, updateStatus, withSide } from './tabs.js';
import {
  cancelDialog,
  isDialogOpen,
  showNewFileDialog,
  showLinkedCssAsk,
  showMessage,
  showNewDialog,
  showTemplateDialog,
  showOpenAsk,
  showSaveAsk,
  showSaveDialog,
  showTakeOutAsk,
} from './dialogs.js';

let hooks = {};
export function initFlows(appHooks) {
  hooks = appHooks;
}

const whenEditor = () => hooks.whenEditor();

function iconFor(name) {
  return kindOrCode(name).icon;
}

function addProject({ name, kind, folder = null, hiddenFiles = [] }) {
  const project = {
    id: newProjectId(),
    name,
    kind,
    folder,
    pageTab: null,
    hiddenFiles,
    stamp: 0,
    lone: false,
    bigFolder: false,
    fromFolder: false,
    writing: Promise.resolve(),
    autosaveOff: false,
    folderRefused: false,
  };
  S.projects.set(project.id, project);
  return project;
}

function refreshLone(project) {
  const tabs = tabsOf(project);
  const onlyOthers = !project.fromFolder && tabs.length > 0 && tabs.every((t) => !kindOf(t).teaching);
  project.lone = !!project.folder && (project.bigFolder || onlyOthers);
}

async function restamp(project) {
  refreshLone(project);
  if (project.folder) project.stamp = await invoke('folder_stamp', stampArgs(project));
}

// Every path that makes tabs awaits this once, with all its file names, before its first
// addTab, which stays synchronous (newState throws for a language that is not loaded).
const loadLanguagesFor = (names) => S.ed.loadLanguages(names.map(languageIdFor));

function addTab(project, { name, path, text, style = null, onDisk = true, topicId = null, bar = null }) {
  const kind = kindOrCode(name);
  const tabStyle = style || plainStyle(kind);
  const language = languageIdFor(name);
  const state = S.ed.newState(text, language, tabStyle.indent, { teaching: !!kind.teaching, fileName: name });
  const tab = {
    path,
    name,
    projectId: project.id,
    kind: kind.id,
    language,
    style: tabStyle,
    state,
    savedDoc: onDisk ? state.doc : null,
    scroll: null,
    pageY: 0,
    topicId,
    bar,
    typed: false,
    dotShown: false,
  };
  S.tabs.push(tab);
  if (!project.pageTab && kind.isPage) project.pageTab = path;
  refreshLone(project);
  return tab;
}

const newPath = (project, file) => `__new/${project.id}/${file}`;
const realPath = (folder, file) => `${folder}/${file}`;
const pathInProject = (project, file) => (project.folder ? realPath(project.folder, file) : newPath(project, file));

const staysHidden = (f) => f.hidden && !kindOrCode(f.name).isPage;

async function openContent(content, kind, extra = {}) {
  await whenEditor();
  await loadLanguagesFor(content.files.filter((f) => !staysHidden(f)).map((f) => f.name));
  const hidden = content.files.filter(staysHidden).map(({ name, code, picture }) => ({ name, code: code || '', picture: Boolean(picture) }));
  const project = addProject({ name: content.name, kind, hiddenFiles: hidden });
  const tabs = content.files
    .filter((f) => !staysHidden(f))
    .map((f) => addTab(project, { name: f.name, path: newPath(project, f.name), text: f.code, ...extra }));
  await invoke('set_buffers', {
    files: [
      ...tabs.map((t) => ({ path: t.path, text: t.state.doc.toString() })),
      ...hidden.map((f) => ({ path: newPath(project, f.name), text: f.code, picture: f.picture })),
    ],
  });
  // New project, a sample, a template and Try it start with the side deciding for itself (WP3).
  S.sideManual = null;
  hooks.layout();
  const first = firstPageOf(project) || tabs[0];
  switchTo(first.path);
  return project;
}

export function shownHere(template) {
  return (template.needs || []).every((condition) => {
    try {
      return CSS.supports(condition);
    } catch {
      return false;
    }
  });
}

export async function newFlow({ focusSamples = false } = {}) {
  const all = await invoke('samples');
  const samples = all.filter((s) => s.group !== 'template');
  const templates = all.filter((s) => s.group === 'template' && shownHere(s));
  let answer = await showNewDialog({ samples, templates, focusSamples });
  while (answer && answer.type === 'templates') {
    answer = await showTemplateDialog({ templates });
    if (answer && answer.type === 'back') answer = await showNewDialog({ samples, templates, focusTemplates: true });
  }
  if (!answer) return;
  if (answer.type === 'project') {
    await openContent(await invoke('new_project', { style: answer.style }), 'new');
  } else {
    await openContent(await invoke('open_sample', { id: answer.id }), 'sample');
  }
  hooks.showRight('page');
  writeSession();
}

function findOpen(path) {
  return S.tabs.find((t) => sameFile(t.path, path)) || null;
}

function tabShown(tab) {
  renderStrip();
  writeSession();
  return tab;
}

export function openPageTab(projectId, path) {
  const project = S.projects.get(projectId);
  if (!project) return null;
  const already = findOpen(path);
  if (already) return already;
  const at = project.hiddenFiles.findIndex((f) => !f.picture && newPath(project, f.name) === path);
  if (at >= 0) {
    const name = project.hiddenFiles[at].name;
    const open = () => {
      const again = project.hiddenFiles.findIndex((f) => !f.picture && newPath(project, f.name) === path);
      if (again < 0 || !S.projects.has(project.id)) return findOpen(path);
      const [file] = project.hiddenFiles.splice(again, 1);
      return tabShown(addTab(project, { name: file.name, path, text: file.code }));
    };
    return S.ed.languageLoaded(languageIdFor(name)) ? open() : loadLanguagesFor([name]).then(open);
  }
  if (!project.folder || !sameFile(dirName(path), project.folder)) return null;
  return invoke('read_files', { paths: [path] }).then(async ([file]) => {
    if (!file || typeof file.text !== 'string' || !S.projects.has(project.id)) return null;
    await loadLanguagesFor([file.name]);
    if (!S.projects.has(project.id)) return null;
    return findOpen(file.path) || tabShown(addTab(project, { name: file.name, path: file.path, text: file.text, style: file.style }));
  });
}

// File names inside a sentence are code: at most 3 of them, then how many more.
function namesList(names) {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  const parts = [];
  shown.forEach((name, i) => {
    if (i) parts.push(i === shown.length - 1 && !rest ? ' and ' : ', ');
    parts.push({ code: name });
  });
  if (rest) parts.push(` and ${rest} more`);
  return parts;
}

function messageForRead(error, names) {
  const list = namesList(names);
  const one = names.length === 1;
  if (error === 'too_big') {
    return { title: 'This file is too big for HTML Lab.', text: [...list, one ? ' is bigger than 5 MB.' : ' are bigger than 5 MB.'] };
  }
  if (error === 'not_text') {
    return one
      ? { title: 'HTML Lab cannot open this file.', text: [...list, ' is a picture or another file that is not text.'] }
      : { title: 'HTML Lab cannot open these files.', text: [...list, ' are pictures or other files that are not text.'] };
  }
  if (error === 'other_encoding') {
    return {
      title: one ? 'HTML Lab cannot read this file.' : 'HTML Lab cannot read these files.',
      text: ['HTML Lab can only open text saved as UTF-8 or UTF-16, so it does not open ', ...list, '.'],
    };
  }
  return { title: 'HTML Lab cannot open this file.', text: [`${computerName} would not let it read `, ...list, '.'] };
}

async function explainReadFailures(failures) {
  const groups = new Map();
  for (const f of failures) {
    if (!groups.has(f.error)) groups.set(f.error, []);
    groups.get(f.error).push(f.name);
  }
  for (const [error, names] of groups) {
    await showMessage({ ...messageForRead(error, names), buttons: [{ id: 'ok', label: 'OK', primary: true }] });
  }
}

export async function openFlow() {
  S.panelOpen = true;
  let picked;
  try {
    picked = await invoke('pick_files');
  } finally {
    S.panelOpen = false;
  }
  externalOpens();
  if (picked.length) await openPaths(picked);
}

export async function openPaths(picked) {
  await whenEditor();
  let list = picked;
  let refused = false;
  let big = false;
  if (picked.length === 1) {
    const already = findOpen(picked[0]);
    if (already) {
      hooks.showRight('page');
      switchTo(already.path);
      return;
    }
    const scan = await invoke('scan_folder', { picked: picked[0] });
    refused = scan.refused;
    // A scan that stopped before the end of the folder counts as big too (C48).
    big = !!(scan.tooBig || scan.stoppedEarly);
    const pickedName = baseName(picked[0]);
    if (scan.isProject) {
      const answer = await showOpenAsk({
        pickedName,
        folderName: scan.folderName,
        files: scan.files.map((f) => ({ name: f.name, icon: iconFor(f.name), picked: f.picked })),
      });
      if (answer === 'all') list = scan.files.map((f) => f.path);
    } else if (scan.linkedCss && scan.linkedCss.length) {
      const answer = await showLinkedCssAsk({
        pageName: pickedName,
        files: scan.linkedCss.map((f) => ({ name: f.name, icon: iconFor(f.name) })),
      });
      if (answer === 'yes') list = [picked[0], ...scan.linkedCss.map((f) => f.path)];
    }
  }
  await openList(list, refused, { big });
}

async function openList(list, refused = false, { big = false, fromFolder = false } = {}) {
  const results = await invoke('read_files', { paths: list });
  const good = results.filter((r) => r.text !== null && r.text !== undefined);
  const bad = results.filter((r) => r.error);
  if (bad.length) await explainReadFailures(bad);
  await whenEditor();
  await loadLanguagesFor(good.map((f) => f.name));
  const wanted = good[0] ? good[0].path : null;
  let target = null;
  const touched = new Map();
  for (const file of good) {
    const open = findOpen(file.path);
    if (open) {
      target = target || open;
      continue;
    }
    const folder = dirName(file.path);
    let project = [...S.projects.values()].find((p) => p.folder && sameFile(p.folder, folder));
    if (!project) {
      project = addProject({ name: baseName(folder), kind: 'saved', folder });
      touched.set(project, { fresh: true, lone: false });
      await invoke('add_root', { folder });
    }
    if (!touched.has(project)) touched.set(project, { fresh: false, lone: project.lone });
    if (refused) project.folderRefused = true;
    if (big) project.bigFolder = true;
    if (fromFolder) project.fromFolder = true;
    const again = findOpen(file.path);
    if (again) {
      target = target || again;
      continue;
    }
    const tab = addTab(project, { name: file.name, path: file.path, text: file.text, style: file.style });
    if (file.path === wanted) target = tab;
  }
  if (target) {
    hooks.layout();
    hooks.showRight('page');
    switchTo(target.path);
    renderStrip();
    writeSession();
  }
  for (const [project, was] of touched) {
    refreshLone(project);
    if (S.projects.has(project.id) && (was.fresh || was.lone || project.lone)) await restamp(project);
  }
}

export async function droppedFiles(paths) {
  if (isDialogOpen() || S.panelOpen || !paths.length) return;
  await openPlanned(await invoke('plan_open', { paths }));
}

function showSavedLabel() {
  const button = document.getElementById('btn-save');
  const label = button.querySelector('.label');
  button.classList.add('saved');
  label.textContent = 'Saved!';
  clearTimeout(showSavedLabel.timer);
  showSavedLabel.timer = setTimeout(() => {
    button.classList.remove('saved');
    label.textContent = 'Save';
  }, 1500);
}

function fileRows(project) {
  const rows = tabsOf(project).map((t) => ({ name: t.name, icon: kindOf(t).icon }));
  for (const f of project.hiddenFiles) rows.push({ name: f.name, icon: f.picture ? 'picture' : iconFor(f.name) });
  return rows;
}

function allFiles(project) {
  const tabs = tabsOf(project);
  return {
    docs: tabs.map((t) => t.state.doc),
    files: [
      ...tabs.map((t) => ({ name: t.name, text: t.state.doc.toString(), ...writeStyle(t.style) })),
      ...project.hiddenFiles.map((f) => ({
        name: f.name,
        text: f.code,
        picture: Boolean(f.picture),
        ...writeStyle(plainStyle()),
      })),
    ],
  };
}

function rememberPlace(parent) {
  S.prefs.savePlace = parent;
  invoke('set_prefs', { patch: { savePlace: parent } });
}

async function moveToFolder(project, saved, docs) {
  const tabs = tabsOf(project);
  const oldPaths = tabs.map((t) => t.path);
  const hiddenOld = project.hiddenFiles.map((f) => newPath(project, f.name));
  const oldFolder = project.folder;
  const pathMap = new Map();
  tabs.forEach((tab, i) => {
    const next = realPath(saved.folder, tab.name);
    pathMap.set(tab.path, next);
    if (project.pageTab === tab.path) project.pageTab = next;
    if (S.activePath === tab.path) S.activePath = next;
    tab.path = next;
    tab.savedDoc = docs[i];
  });
  project.folder = saved.folder;
  project.name = baseName(saved.folder);
  project.kind = 'saved';
  project.hiddenFiles = [];
  project.bigFolder = false;
  refreshLone(project);
  await invoke('drop_buffers', { paths: [...oldPaths, ...hiddenOld] });
  await invoke('add_root', { folder: saved.folder });
  if (oldFolder) await invoke('remove_root', { folder: oldFolder });
  renderStrip();
  updateStatus();
  syncMenu();
  writeSession();
  preview.reloadAfterMove(project, pathMap);
}

const placeName = (path) => (path ? baseName(path) : 'Documents');

async function chooseSavePlace(current) {
  S.panelOpen = true;
  try {
    const path = await invoke('pick_folder', { start: current });
    return path ? { path, name: placeName(path) } : null;
  } finally {
    S.panelOpen = false;
  }
}

let cleanSeq = 0;
async function cleanProjectName(raw) {
  const { name } = await invoke('clean_project_name', { raw, seq: ++cleanSeq });
  return name;
}

async function firstSave(project) {
  const parent = S.prefs.savePlace;
  let result = false;
  await showSaveDialog({
    name: project.name,
    place: placeName(parent),
    placePath: parent,
    files: fileRows(project),
    cleanName: cleanProjectName,
    choosePlace: chooseSavePlace,
    submit: async ({ name, parent: place }) => {
      const clean = await cleanProjectName(name);
      const { files, docs } = allFiles(project);
      try {
        const saved = await invoke('save_project', { parent: place, name: clean, files });
        rememberPlace(place);
        await moveToFolder(project, saved, docs);
        await preview.noteWrite(project);
        result = true;
        return null;
      } catch (error) {
        if (error === 'folder_exists') {
          return { error: `You already have a folder called ${clean} here. Pick another name.` };
        }
        return { error: 'HTML Lab cannot save here. Choose another place.' };
      }
    },
  });
  return result;
}

function queued(project, job) {
  const run = project.writing.then(job, job);
  project.writing = run.catch(() => {});
  return run;
}

async function writeChanged(project) {
  return queued(project, async () => {
    const tabs = tabsOf(project).filter(isChanged);
    if (!tabs.length) return { ok: true, failed: [] };
    const sent = tabs.map((tab) => ({ tab, doc: tab.state.doc, wasNew: tab.savedDoc === null }));
    const results = await invoke('write_files', {
      files: sent.map(({ tab, doc, wasNew }) => ({
        path: tab.path,
        text: doc.toString(),
        mustNotExist: wasNew,
        ...writeStyle(tab.style),
      })),
    });
    const failed = [];
    const wrote = [];
    results.forEach((res, i) => {
      const { tab, doc } = sent[i];
      if (res.ok) {
        tab.savedDoc = doc;
        wrote.push(tab.path);
      } else {
        failed.push({ tab, error: res.error });
      }
    });
    if (wrote.length) {
      await invoke('drop_buffers', {
        paths: wrote.filter((p) => {
          const tab = tabByPath(p);
          return !tab || !isChanged(tab);
        }),
      });
      await preview.noteWrite(project);
    }
    renderStrip();
    updateStatus();
    syncMenu();
    writeSession();
    return { ok: failed.length === 0, failed };
  });
}

async function detachFolder(project) {
  const oldFolder = project.folder;
  const pathMap = new Map();
  for (const tab of tabsOf(project)) {
    const next = newPath(project, tab.name);
    pathMap.set(tab.path, next);
    if (project.pageTab === tab.path) project.pageTab = next;
    if (S.activePath === tab.path) S.activePath = next;
    tab.path = next;
  }
  project.folder = null;
  project.kind = 'new';
  refreshLone(project);
  await invoke('set_buffers', { files: tabsOf(project).map((t) => ({ path: t.path, text: t.state.doc.toString() })) });
  if (oldFolder) await invoke('remove_root', { folder: oldFolder });
  renderStrip();
  updateStatus();
  syncMenu();
  writeSession();
  preview.reloadAfterMove(project, pathMap);
}

async function explainWriteFailure(project, failed) {
  const gone = failed.find((f) => f.error === 'folder_gone');
  if (gone) {
    const answer = await showMessage({
      title: 'HTML Lab cannot find your folder.',
      text: `${project.name} was moved or deleted. Your work is still here in HTML Lab.`,
      buttons: [
        { id: 'keep', label: 'Keep working' },
        { id: 'new', label: 'Save it somewhere new', primary: true },
      ],
    });
    if (answer !== 'new') return false;
    await detachFolder(project);
    return firstSave(project);
  }
  const taken = failed.find((f) => f.error === 'file_exists');
  if (taken) {
    await showMessage({
      title: 'Some of your work was not saved.',
      text: `There is already a file called ${taken.tab.name} in your folder. Your work is still here in HTML Lab.`,
      buttons: [{ id: 'keep', label: 'Keep working', primary: true }],
    });
    return false;
  }
  const names = failed.map((f) => f.tab.name).join(', ');
  const answer = await showMessage({
    title: 'Some of your work was not saved.',
    text: `${names} could not be saved. Your work is still here in HTML Lab.`,
    buttons: [
      { id: 'keep', label: 'Keep working' },
      { id: 'again', label: 'Try again', primary: true },
    ],
  });
  if (answer !== 'again') return false;
  return saveProjectNow(project);
}

async function saveProjectNow(project) {
  if (!project.folder) return firstSave(project);
  const result = await writeChanged(project);
  if (result.ok) {
    project.autosaveOff = false;
    return true;
  }
  const recovered = await explainWriteFailure(project, result.failed);
  if (recovered) project.autosaveOff = false;
  return recovered;
}

export async function saveFlow() {
  const project = activeProject();
  if (!project) return false;
  const hadFolder = !!project.folder;
  const ok = await saveProjectNow(project);
  if (ok && hadFolder) showSavedLabel();
  return ok;
}

export async function saveCopyFlow() {
  const project = activeProject();
  if (!project) return;
  if (!project.folder) {
    await saveFlow();
    return;
  }
  const parent = dirName(project.folder);
  let tooBig = false;
  await showSaveDialog({
    heading: 'Save a copy of your project',
    line: 'Your changes go into the copy. Your old folder stays as it was when you last saved.',
    button: 'Save the copy',
    name: `${project.name} copy`,
    place: placeName(parent),
    placePath: parent,
    files: fileRows(project),
    extraLine: 'and everything else in your folder',
    cleanName: cleanProjectName,
    choosePlace: chooseSavePlace,
    submit: async ({ name, parent: place }) => {
      const clean = await cleanProjectName(name);
      const { files, docs } = allFiles(project);
      try {
        const saved = await invoke('save_copy', { folder: project.folder, parent: place, name: clean, files });
        await moveToFolder(project, saved, docs);
        await preview.noteWrite(project);
        return null;
      } catch (error) {
        if (error === 'folder_exists') {
          return { error: `You already have a folder called ${clean} here. Pick another name.` };
        }
        if (error === 'too_big') {
          tooBig = true;
          return null;
        }
        return { error: 'HTML Lab cannot save here. Choose another place.' };
      }
    },
  });
  if (tooBig) {
    await showMessage({
      title: 'This project is too big to copy here.',
      text: `Copy the folder in ${fileManager} instead.`,
      buttons: [{ id: 'ok', label: 'OK', primary: true }],
    });
  }
}

let autosaveTimer = 0;
let autosaveWaiting = false;

async function autosaveNow() {
  clearTimeout(autosaveTimer);
  autosaveTimer = 0;
  autosaveWaiting = false;
  if (!S.prefs.autosave) return;
  if (S.dialogOpen) {
    autosaveWaiting = true;
    return;
  }
  for (const project of [...S.projects.values()]) {
    if (!project.folder || project.autosaveOff || !tabsOf(project).some(isChanged)) continue;
    const result = await writeChanged(project);
    if (!result.ok) {
      project.autosaveOff = true;
      await explainWriteFailure(project, result.failed);
    }
  }
}

export function noteChangeForAutosave() {
  if (!S.prefs.autosave) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveNow, 2000);
}

export function onWindowBlurred() {
  if (S.prefs.autosave && autosaveTimer) autosaveNow();
}

export function onDialogClosed() {
  if (autosaveWaiting) autosaveNow();
  externalOpens();
}

let externalBusy = false;
let externalAgain = false;

async function openPlanned(plan) {
  for (const folder of plan.folders) await openList(folder.files, false, { fromFolder: true });
  if (plan.files.length) await openPaths(plan.files);
  if (plan.emptyFolders.length) {
    const one = plan.emptyFolders.length === 1;
    await showMessage({
      title: [...namesList(plan.emptyFolders), one ? ' has no files HTML Lab can open.' : ' have no files HTML Lab can open.'],
      text: 'HTML Lab opens web pages and other text files.',
      buttons: [{ id: 'ok', label: 'OK', primary: true }],
    });
  }
  if (plan.others.length) {
    await showMessage({ ...messageForRead('not_text', plan.others), buttons: [{ id: 'ok', label: 'OK', primary: true }] });
  }
}

export async function externalOpens() {
  if (externalBusy) {
    externalAgain = true;
    return;
  }
  externalBusy = true;
  try {
    do {
      externalAgain = false;
      await whenEditor();
      if (isDialogOpen() || S.panelOpen) return;
      const paths = await invoke('take_open_requests');
      if (paths.length) await openPlanned(await invoke('plan_open', { paths }));
    } while (externalAgain);
  } finally {
    externalBusy = false;
  }
}

async function autosaveSilently(project) {
  if (!S.prefs.autosave || !project.folder) return;
  await writeChanged(project);
}

// The + and File > New File... (0.3.0 WP4). HTML and CSS get new_file's starter text; every
// other file starts empty with the full name. Either way the tab is new (savedDoc null), so
// Save and Save Automatically write it with mustNotExist and never overwrite a file (C4).
export async function addFileFlow() {
  const tab = activeTab();
  const project = projectOf(tab);
  if (!project) return;
  const tabs = tabsOf(project);
  const styleTabs = tabs.filter((t) => kindOf(t).previewMode === 'swap');
  const cssTab = styleTabs.find((t) => t.name === 'style.css') || styleTabs[0] || null;
  const page = pageTabOf(project);
  const hasWeb = tabs.some((t) => kindOf(t).teaching) || project.hiddenFiles.some((f) => kindForName(f.name));
  let seq = 0;
  const answer = await showNewFileDialog({
    kinds: S.config.kinds,
    startChip: hasWeb ? 'page' : 'text',
    cssName: cssTab ? cssTab.name : null,
    pageName: page ? page.name : null,
    cleanName: async (raw) => (await invoke('clean_file_name', { raw, seq: ++seq })).stem,
    checkName: (name) => invoke('check_name', { old: '', new: name }),
    nameFree: (file) =>
      invoke('file_name_free', { tabs: tabsOf(project).map((t) => t.name), folder: project.folder, file }),
  });
  if (!answer) return;
  const kind = answer.kind ? S.kinds.get(answer.kind) : null;
  let text = '';
  if (kind) {
    const css = kind.isPage && answer.tick ? (cssTab ? cssTab.name : null) : null;
    const made = await invoke('new_file', { kind: answer.kind, stem: answer.stem, css });
    if (!made) return;
    text = made.text;
  }
  const path = pathInProject(project, answer.file);
  await loadLanguagesFor([answer.file]);
  if (!S.projects.has(project.id)) return;
  const added = addTab(project, { name: answer.file, path, text, onDisk: !project.folder });
  await invoke('set_buffers', { files: [{ path, text }] });

  if (kind && !kind.isPage && answer.tick && page) {
    const insert = await invoke('add_link', { html: page.state.doc.toString(), cssFile: answer.file });
    if (insert) applyLink(page, insert);
  }
  switchTo(added.path);
  writeSession();
}

function applyLink(page, insert) {
  const changes = S.E.insertLineChange(page.state, insert.line, insert.text);
  if (page.view) page.view.dispatch({ changes });
  else page.state = page.state.update({ changes }).state;
  noteDocChange(page);
  preview.onLinkAdded(page);
}

function removeTab(tab) {
  const at = S.tabs.indexOf(tab);
  if (at < 0) return;
  const project = projectOf(tab);
  const wasActive = tab.path === S.activePath;
  invoke('drop_buffers', { paths: [tab.path] });
  S.tabs.splice(at, 1);
  S.ed.drop(tab);

  const rest = tabsOf(project);
  refreshLone(project);
  if (!rest.length) {
    if (project.folder) invoke('remove_root', { folder: project.folder });
    if (project.hiddenFiles.length) {
      invoke('drop_buffers', { paths: project.hiddenFiles.map((f) => newPath(project, f.name)) });
    }
  }
  if (kindOf(tab).previewMode === 'swap') preview.cssTabClosed(tab, project);

  if (project.pageTab === tab.path) {
    const nextPage = rest.find(isPage) || null;
    project.pageTab = nextPage ? nextPage.path : null;
    preview.pageTabMoved(project);
  }
  if (!rest.length) S.projects.delete(project.id);
  if (!S.tabs.length) S.sideManual = null;

  if (wasActive) {
    forgetActive();
    const next = S.tabs[at] || S.tabs[at - 1] || null;
    if (next) {
      switchToAfterClose(next, tab);
    } else {
      preview.reset();
      updateInside();
    }
  }
  renderStrip();
  updateStatus();
  syncMenu();
  hooks.layout();
  writeSession();
}

function switchToAfterClose(next, closed) {
  S.activePath = next.path;
  S.ed.show(next);
  updateInside();
  if (!S.dialogOpen) S.ed.view.focus();
  withSide(() => preview.onTabSwitch(closed, next));
}

export async function closeTabFlow(path) {
  const tab = path ? tabByPath(path) : activeTab();
  if (!tab || tab.closing) return;
  tab.closing = true;
  try {
    await closeTabSteps(tab);
  } finally {
    tab.closing = false;
  }
}

async function closeTabSteps(tab) {
  const stillOpen = () => S.tabs.includes(tab);
  const project = projectOf(tab);
  if (isChanged(tab) && project.folder) await autosaveSilently(project);
  if (!stillOpen()) return;
  const others = tabsOf(project).filter((t) => t !== tab);

  if (isChanged(tab)) {
    const lostWhole = !project.folder && others.length > 0;
    const answer = await showSaveAsk({ fileName: tab.name, wholeFile: lostWhole });
    if (answer === 'cancel' || !stillOpen()) return;
    if (answer === 'save') {
      const ok = await saveProjectNow(project);
      if (!ok || !stillOpen()) return;
    }
  } else if (!project.folder && others.length > 0) {
    const answer = await showTakeOutAsk({ fileName: tab.name });
    if (answer !== 'remove' || !stillOpen()) return;
  }
  removeTab(tab);
}

let quitBusy = false;

export async function onCloseRequested() {
  invoke('close_ack');
  if (quitBusy) return;
  quitBusy = true;
  try {
    cancelDialog();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (S.prefs.autosave) {
      for (const project of [...S.projects.values()]) await autosaveSilently(project);
    }
    const changed = S.tabs.filter(isChanged);
    if (changed.length) {
      const answer =
        changed.length === 1
          ? await showSaveAsk({ fileName: changed[0].name })
          : await showSaveAsk({ count: changed.length });
      if (answer === 'cancel') return;
      if (answer === 'save') {
        const projects = [...new Set(changed.map((t) => projectOf(t)))];
        for (const project of projects) {
          const ok = await saveProjectNow(project);
          if (!ok) return;
        }
      }
    }
    invoke('quit_now');
  } finally {
    quitBusy = false;
  }
}

export async function tryIt(topicId) {
  await whenEditor();
  const existing = S.tabs.find((t) => t.topicId === topicId);
  markTried(topicId);
  S.sideManual = null;
  hooks.showRight('page');
  if (existing) {
    switchTo(existing.path);
    return;
  }
  const [content, topic] = await Promise.all([
    invoke('open_practice', { topicId }),
    invoke('help_topic', { id: topicId }),
  ]);
  if (!content) return;
  await openContent(content, 'practice', { topicId, bar: topic ? topic.bar : null });
  writeSession();
}

function markTried(topicId) {
  if (S.prefs.tried.includes(topicId)) return;
  S.prefs.tried.push(topicId);
  invoke('set_prefs', { patch: { tried: S.prefs.tried } });
  hooks.onTriedChanged();
}

export function canAdd(language) {
  const tab = activeTab();
  if (!tab) return { ok: false, reason: 'Open a page first.' };
  if (kindOf(tab).language === language) return { ok: true, reason: '' };
  const wanted = S.config.kinds.find((k) => k.language === language);
  return { ok: false, reason: wanted ? wanted.openFirst : 'Open a page first.' };
}

export function addToCode({ text, lang }) {
  if (!activeTab()) return;
  const view = S.ed.view;
  const place = placeForBlock(view.state.doc.toString(), view.state.selection.main, text, lang);
  if (place === null) S.E.insertBlock(view, text);
  else {
    view.dispatch({
      changes: { from: place.at, insert: place.insert },
      selection: { anchor: place.at + place.insert.length - (place.insert.endsWith('\n') ? 1 : 0) },
      scrollIntoView: true,
      userEvent: 'input.paste',
    });
    view.focus();
  }
}

const HEAD_BLOCK = /^\s*<(title|meta|link|style|base)\b/i;

export function placeForBlock(doc, selection, text, lang) {
  if (selection.from !== 0 || selection.to !== 0 || !doc.trim()) return null;
  const lineStart = (i) => doc.lastIndexOf('\n', i - 1) + 1;
  const indentAt = (i) => /^[ \t]*/.exec(doc.slice(lineStart(i)))[0];
  const block = (indent) => text.split('\n').map((part) => (part ? indent + part : part)).join('\n') + '\n';
  if (lang === 'css') {
    const gap = doc.endsWith('\n\n') ? '' : doc.endsWith('\n') ? '\n' : '\n\n';
    return { at: doc.length, insert: gap + block('') };
  }
  if (!/^\s*<(!doctype|html)/i.test(doc)) return null;
  const lower = doc.toLowerCase();
  const closing = HEAD_BLOCK.test(text) ? lower.indexOf('</head>') : lower.lastIndexOf('</body>');
  if (closing >= 0) {
    const at = lineStart(closing);
    return { at, insert: block(`${indentAt(closing)}  `) };
  }
  const html = /<html[^>]*>/i.exec(doc);
  if (HEAD_BLOCK.test(text) && html) {
    const end = doc.indexOf('\n', html.index);
    const at = end < 0 ? doc.length : end + 1;
    return { at, insert: block(`${indentAt(html.index)}  `) };
  }
  return null;
}

// The side's own choice goes with the tabs; with no tab on disk nothing is kept (WP3).
export function writeSession() {
  const tabs = S.tabs.filter(isOnDisk).map((t) => t.path);
  const active = tabs.includes(S.activePath) ? S.activePath : null;
  const session = tabs.length ? { tabs, active, side: S.sideManual } : null;
  S.prefs.session = session;
  invoke('set_prefs', { patch: { session } });
}

export async function restoreSession(session) {
  await whenEditor();
  const results = await invoke('read_files', { paths: session.tabs });
  const good = results.filter((r) => r.text !== null && r.text !== undefined);
  if (!good.length) return false;
  await loadLanguagesFor(good.map((f) => f.name));
  const touched = new Set();
  for (const file of good) {
    const folder = dirName(file.path);
    let project = [...S.projects.values()].find((p) => p.folder && sameFile(p.folder, folder));
    if (!project) {
      project = addProject({ name: baseName(folder), kind: 'saved', folder });
      await invoke('add_root', { folder });
    }
    touched.add(project);
    if (!findOpen(file.path)) addTab(project, { name: file.name, path: file.path, text: file.text, style: file.style });
  }
  for (const project of touched) await restamp(project);
  const wanted = (session.active && findOpen(session.active)) || S.tabs[0];
  const project = projectOf(wanted);
  if (isPage(wanted)) project.pageTab = wanted.path;
  const testRun = S.flags.selfTest || S.flags.smokeTest || S.flags.speedCheck;
  S.sideManual = !testRun && (session.side === 'shown' || session.side === 'hidden') ? session.side : null;
  hooks.layout();
  switchTo(wanted.path);
  writeSession();
  return true;
}

export function showProjectFolder() {
  const project = activeProject();
  if (project && project.folder) invoke('show_folder', { path: project.folder });
}

export async function openInSafari() {
  const tab = activeTab();
  const project = projectOf(tab);
  if (!project) return;
  if (!project.folder || tabsOf(project).some(isChanged)) {
    const ok = await saveProjectNow(project);
    if (!ok) return;
  }
  const page = pageTabOf(project);
  if (page) await invoke('open_in_safari', { path: page.path });
}

// For Change Name (rename.js, 0.3.0 WP5): its steps run in the project's write queue, after the
// auto-save timer is cleared, so no save can write the old name back. The auto-save also waits
// while its Undo is offered.
export function clearAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = 0;
  autosaveWaiting = false;
}
export { queued, refreshLone, pathInProject, newPath, loadLanguagesFor, findOpen };

export const __openContent = openContent;
export const __openList = openList;

export function __closeAllNow() {
  while (S.tabs.length) removeTab(S.tabs[0]);
}

export function __closeProjectNow(project) {
  for (const tab of [...tabsOf(project)]) removeTab(tab);
}

export async function __firstSaveTo(project, parent, name) {
  const { files, docs } = allFiles(project);
  const saved = await invoke('save_project', { parent, name, files });
  await moveToFolder(project, saved, docs);
  await preview.noteWrite(project);
  return saved.folder;
}
