// Self-tests for 0.3.0 WP5 "Change a file's name, and the places that use it" (docs/NEXT-0.3.0.md,
// WP5; C9, C44, C45, C5, C43). Uses from h: t, assert, eq, until, wait, settle, probe, clickLink,
// sample, doc, view, typeAfter, S, P, flows, runCommand, switchTo, tabNamed, activeTab, tabsOf,
// invoke, disk, readDisk, parent, freshFolder, dialogRoot, waitDialog, click, setField, isDialogOpen,
// baseName, $.
// Expected words come from the copy table, never from the code under test.
import { isChanged } from './state.js';
import { menuState } from './tabs.js';
import * as rename from './rename.js';

export const RENAME_TESTS = 18;

const TIP = 'Type a new name. Press Enter to change it, or Esc to stop.';
const COMIC = 'template-comic';

export async function renameTests(h) {
  const {
    assert, eq, until, wait, settle, probe, clickLink, sample, doc, view, typeAfter, S, P, flows, runCommand,
    switchTo, tabNamed, activeTab, tabsOf, invoke, disk, readDisk, parent, freshFolder, dialogRoot,
    waitDialog, click, setField, isDialogOpen, baseName, $,
  } = h;
  // The test Mac's window is often not the key window, and Cmd+Z acts only when the code has the focus.
  const withKeyWindow = async (fn) => {
    const had = Object.prototype.hasOwnProperty.call(document, 'hasFocus');
    const old = document.hasFocus;
    document.hasFocus = () => true;
    try {
      return await fn();
    } finally {
      if (had) document.hasFocus = old;
      else delete document.hasFocus;
    }
  };
  // No field, toast or Undo is left for the next test, whatever this one did.
  const t = (name, fn) => h.t(name, async () => {
    try {
      return await fn();
    } finally {
      rename.__reset();
    }
  });

  const field = () => document.querySelector('#tab-list .tab-rename');
  const tip = () => $('rename-tip').textContent;
  const toastText = () => ($('rename-toast').hidden ? '' : $('rename-toast-text').textContent);
  const tabEl = (tab) => [...document.querySelectorAll('#tab-list .tab')].find((el) => el.dataset.path === tab.path);
  const hasDot = (tab) => !!tabEl(tab).querySelector('.tab-dot');
  const press = (el, key, extra = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
  const list = (folder) => invoke('test_list_folder', { path: folder });
  const write = (path, text) => invoke('test_write_bytes', { path, bytes: [...new TextEncoder().encode(text)] });
  const count = (text, part) => text.split(part).length - 1;

  const openField = async (tab) => {
    switchTo(tab.path);
    runCommand('rename');
    await until(field, 'the Change Name field');
  };
  const typeName = (value) => {
    const el = field();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const tipIs = (text) => until(() => tip() === text, () => `the tooltip "${text}", it says "${tip()}"`);
  // The field, the new name, Enter, and the dialog for it.
  const askFor = async (tab, name) => {
    await openField(tab);
    typeName(name);
    await tipIs(TIP);
    press(field(), 'Enter');
    await waitDialog(`Change the name to ${name}?`);
  };
  const untick = async () => {
    const tick = dialogRoot().querySelector('[data-tick]');
    assert(tick && tick.checked, 'the tick is not on at first');
    tick.click();
    await until(() => !dialogRoot().querySelector('[data-warn]').hidden, 'the amber warning');
  };
  const finished = () => until(() => !isDialogOpen() && toastText(), 'the toast after Change Name');
  const renameTo = async (tab, name, { tick = true } = {}) => {
    await askFor(tab, name);
    if (!tick) await untick();
    click(tick ? 'Change the name' : 'Change only the file name');
    await finished();
    return toastText();
  };
  // A copy of the comic template, saved: index.html, style.css, story.html, heroes.html.
  const comic = async () => {
    const project = await sample(COMIC);
    await flows.__firstSaveTo(project, parent, freshFolder());
    await settle();
    return project;
  };

  // Teeth: with `if (ticked) {` in doRename (rename.js) set to `if (false) {`, index.html keeps
  // story.html on disk and in its tab; with `entries.forEach((e, i) => results.set(e, got[i]))`
  // taken out of changePlaces, the closed heroes.html is not counted ("3 places ... in 2 files")
  // and the open tabs keep their old saved text, so they show changes.
  await t('Change Name on a comic copy changes story.html and its 4 places, on disk and in the tabs, and My page follows the links', async () => {
    const project = await comic();
    const folder = project.folder;
    await flows.closeTabFlow(tabNamed(project, 'heroes.html').path);
    const story = tabNamed(project, 'story.html');
    await openField(story);
    eq(field().value, 'story.html', 'the field starts with the name');
    eq([field().selectionStart, field().selectionEnd].join('-'), '0-5', 'the part before the dot is chosen');
    eq(field().getAttribute('aria-label'), 'New name for story.html', 'the field aria-label');
    eq(field().getAttribute('aria-describedby'), 'rename-tip', 'the field aria-describedby');
    eq($('rename-tip').getAttribute('role'), 'status', 'the tooltip role');
    eq(tip(), TIP, 'the tooltip');
    assert(!field().closest('.tab-main'), 'the field is inside the tab button');
    typeName('tale.html');
    press(field(), 'Enter');
    await waitDialog('Change the name to tale.html?');
    eq(dialogRoot().querySelector('.dlg-line').textContent,
      '4 places in this project use the old name story.html. If they keep the old name, those links stop working.', 'the dialog line');
    eq(dialogRoot().querySelectorAll('.rn-place').length, 4, 'the places');
    eq(dialogRoot().querySelector('.rn-tick-text').textContent, 'Change these 4 places too', 'the tick');
    eq(dialogRoot().querySelector('.rn-tick-small').textContent, 'HTML Lab writes tale.html in each of them and saves those files.', 'the tick small line');
    assert($('tab-list').textContent.includes('tale.html'), 'the tab does not show the new name while the dialog is open');
    click('Change the name');
    await finished();
    eq(toastText(), 'Name changed. 4 places now say tale.html, in 3 files.', 'the toast');
    eq($('rename-toast').getAttribute('role'), 'status', 'the toast role');
    const files = await list(folder);
    assert(files.includes('tale.html') && !files.includes('story.html'), `the folder holds ${files.join(', ')}`);
    const index = await readDisk(`${folder}/index.html`);
    eq(count(index, 'href="tale.html"'), 2, 'index.html on disk');
    assert(!index.includes('story.html'), 'index.html on disk still says story.html');
    const heroes = await readDisk(`${folder}/heroes.html`);
    assert(heroes.includes('<a href="tale.html">Story</a>') && !heroes.includes('story.html'), 'heroes.html on disk');
    assert((await readDisk(`${folder}/tale.html`)).includes('<a href="tale.html" aria-current="page">'), 'tale.html on disk');
    eq(activeTab().name, 'tale.html', 'the tab name');
    eq(activeTab().path, `${folder}/tale.html`, 'the tab path');
    eq(count(tabNamed(project, 'index.html').state.doc.toString(), 'href="tale.html"'), 2, 'the index.html tab');
    assert(doc().includes('<a href="tale.html" aria-current="page">'), 'the tale.html tab');
    assert(!S.tabs.some(isChanged), 'a tab shows changes after Change Name');
    assert((await probe('a[href="tale.html"][aria-current="page"]')).found, 'My page does not show tale.html');
    await clickLink('a[href="index.html"]');
    eq(activeTab().name, 'index.html', 'the link home');
    await clickLink('a[href="tale.html"]');
    eq(activeTab().name, 'tale.html', 'the editor follows the renamed link');
    eq(baseName(P.showing), 'tale.html', 'My page follows the renamed link');
  });

  // Teeth: with `warn.hidden = on;` in paintTick (dialogs.js) taken out, the warning stays hidden;
  // with `box.querySelector('[data-only]').hidden = on;` taken out, "Change only the file name"
  // never shows and click() finds no such button.
  await t('Change Name unticked changes only the file name, with the amber warning and the toast that counts the old places', async () => {
    const project = await comic();
    const folder = project.folder;
    const before = await readDisk(`${folder}/index.html`);
    await askFor(tabNamed(project, 'story.html'), 'tale.html');
    await untick();
    eq(dialogRoot().querySelector('[data-warn]').getAttribute('role'), 'alert', 'the warning role');
    eq(dialogRoot().querySelector('[data-warn]').textContent.trim(),
      'Are you sure? The 4 places will still say story.html, so those links will not work any more. You will have to change them yourself.', 'the warning');
    const only = [...dialogRoot().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Change only the file name');
    assert(only && !only.hidden, 'no amber button');
    assert(!only.hasAttribute('data-primary'), 'the amber button carries data-primary');
    assert(only.classList.contains('btn-amber'), 'the button is not amber');
    eq(document.activeElement, dialogRoot().querySelector('[data-tick]'), 'focus after the tick changed');
    click('Change only the file name');
    await finished();
    eq(toastText(), 'Name changed. 4 places still say story.html.', 'the toast');
    const files = await list(folder);
    assert(files.includes('tale.html') && !files.includes('story.html'), `the folder holds ${files.join(', ')}`);
    eq(await readDisk(`${folder}/index.html`), before, 'index.html on disk changed');
    eq(count(tabNamed(project, 'index.html').state.doc.toString(), 'href="story.html"'), 2, 'the index.html tab changed');
  });

  // Teeth: with `t.savedDoc = textFor(t, savedText.get(t));` in changePlaces (rename.js) taken out,
  // the index.html tab's saved text keeps story.html, so it shows the unsaved dot.
  await t('after Change Name a clean open tab that used the old name shows no unsaved dot', async () => {
    const project = await comic();
    const index = tabNamed(project, 'index.html');
    await renameTo(tabNamed(project, 'story.html'), 'tale.html');
    assert(index.state.doc.toString().includes('href="tale.html"'), 'the index.html tab was not changed');
    assert(!isChanged(index), 'index.html counts as changed');
    assert(!hasDot(index), 'index.html shows the unsaved dot');
  });

  // Teeth: with `t.savedDoc = textFor(t, savedText.get(t));` in changePlaces (rename.js) taken out,
  // undoing the user's own edit leaves story.html in the saved text, so the dot stays.
  await t('a changed tab that used the old name keeps its own edit unsaved, and undoing that edit takes its dot away', () => withKeyWindow(async () => {
    const project = await comic();
    const folder = project.folder;
    const index = tabNamed(project, 'index.html');
    switchTo(index.path);
    typeAfter('<h1', ' title="Zq"');
    assert(hasDot(index), 'no dot after typing');
    await renameTo(tabNamed(project, 'story.html'), 'tale.html');
    const text = index.state.doc.toString();
    assert(text.includes(' title="Zq"') && count(text, 'href="tale.html"') === 2, 'the index.html tab');
    assert(isChanged(index) && hasDot(index), 'the own edit is no longer unsaved');
    const onDisk = await readDisk(`${folder}/index.html`);
    assert(count(onDisk, 'href="tale.html"') === 2 && !onDisk.includes('Zq'), 'index.html on disk');
    switchTo(index.path);
    view.focus();
    runCommand('undo');
    await until(() => !index.state.doc.toString().includes('Zq'), 'the own edit to go');
    assert(index.state.doc.toString().includes('href="tale.html"'), 'Undo took the new name away');
    await until(() => !hasDot(index), 'the dot to go after undoing the own edit');
    assert(!isChanged(index), 'index.html still counts as changed');
  }));

  // Teeth: with `S.E.Transaction.addToHistory.of(false)` taken out of renameSpec (rename.js), Cmd+Z
  // in index.html undoes the rename's edit and story.html comes back. With Undo doing nothing
  // (the `undo` command in app.js set to `undo: () => {},`), the typed part never goes.
  await t('Cmd+Z in a tab that Change Name changed does not bring back the old name', () => withKeyWindow(async () => {
    const project = await comic();
    const index = tabNamed(project, 'index.html');
    await renameTo(tabNamed(project, 'story.html'), 'tale.html');
    switchTo(index.path);
    // A typed part first: the first Cmd+Z must take it away, so Cmd+Z is known to run here.
    typeAfter('<h1', ' title="Zq"');
    view.focus();
    runCommand('undo');
    await until(() => !doc().includes('Zq'), 'the first Cmd+Z to take the typed part away');
    runCommand('undo');
    await wait(50);
    eq(count(doc(), 'href="tale.html"'), 2, 'the new name in index.html');
    assert(!doc().includes('story.html'), 'Cmd+Z brought back story.html');
  }));

  // Teeth: with `else await flows.queued(owner, run);` in changePlaces (rename.js) set to
  // `else { /* other projects left out */ }`, css/style.css keeps ../theme.css on disk and in its
  // saved text, so its tab counts as changed and the disk check fails.
  await t('css/style.css open as its own tab is changed too, and a Save keeps the new name', async () => {
    const saved = await disk(null, [
      ['index.html', '<!doctype html>\n<link rel="stylesheet" href="theme.css">\n<link rel="stylesheet" href="css/style.css">\n<p>x</p>\n'],
      ['theme.css', 'p { color: teal; }\n'],
    ]);
    await invoke('test_make_folder', { path: `${saved.folder}/css` });
    await write(`${saved.folder}/css/style.css`, '@import url("../theme.css");\nh1 { color: red; }\n');
    await flows.__openList([`${saved.folder}/index.html`, `${saved.folder}/theme.css`]);
    await flows.__openList([`${saved.folder}/css/style.css`]);
    const css = S.tabs.find((x) => x.path === `${saved.folder}/css/style.css`);
    const theme = S.tabs.find((x) => x.name === 'theme.css');
    assert(css && theme && css.projectId !== theme.projectId, 'css/style.css is not a tab of its own project');
    eq(await renameTo(theme, 'colors.css'), 'Name changed. 2 places now say colors.css, in 2 files.', 'the toast');
    assert(css.state.doc.toString().startsWith('@import url("../colors.css");'), 'the css/style.css tab');
    assert(!isChanged(css), 'css/style.css counts as changed');
    eq(await readDisk(`${saved.folder}/css/style.css`), '@import url("../colors.css");\nh1 { color: red; }\n', 'css/style.css on disk');
    switchTo(css.path);
    typeAfter('color: red;', ' }\nh2 { color: blue;');
    await flows.saveFlow();
    const after = await readDisk(`${saved.folder}/css/style.css`);
    assert(after.startsWith('@import url("../colors.css");') && after.includes('h2 { color: blue;'), `css/style.css after Save: ${after}`);
  });

  // Teeth: with the kept-endings branch in rewrite_one (core files.rs) refused, that is
  // `decode_text(&original)` in it set to `decode_text(b"\0")`, page.html is "changed on disk",
  // keeps cat.css, and the toast lists it.
  await t('an open, unchanged tab of a file with mixed line endings is changed too and keeps every ending (C45)', async () => {
    const saved = await disk(null, [['page.html', '<!doctype html>\n'], ['cat.css', 'p { color: teal; }\n']]);
    const mixed = '<!doctype html>\r\n<link rel="stylesheet" href="cat.css">\n<p>a</p>\r\n<p>b</p>\r\n';
    await write(`${saved.folder}/page.html`, mixed);
    await flows.__openList([`${saved.folder}/page.html`, `${saved.folder}/cat.css`]);
    const page = S.tabs.find((x) => x.name === 'page.html');
    const cat = S.tabs.find((x) => x.name === 'cat.css');
    assert(page && cat && !isChanged(page), 'page.html is not open, or it shows changes');
    eq(await renameTo(cat, 'kitty.css'), 'Name changed. 1 place now says kitty.css.', 'the toast');
    eq(await readDisk(`${saved.folder}/page.html`), mixed.replace('cat.css', 'kitty.css'), 'page.html on disk');
    assert(page.state.doc.toString().includes('href="kitty.css"'), 'the page.html tab');
    assert(!isChanged(page) && !hasDot(page), 'page.html shows changes');
  });

  // Teeth: with `if (memory) {` in doRename (rename.js) set to `if (true) {`, nothing moves on disk
  // and a.html is still in the folder.
  await t('a changed tab keeps its edits unsaved under its new name, and only the disk copy moves (C9)', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html>\n<p>x</p>\n'], ['b.html', '<!doctype html>\n<a href="a.html">A</a>\n']]);
    await flows.__openList(saved.paths);
    const a = S.tabs.find((x) => x.name === 'a.html');
    switchTo(a.path);
    typeAfter('<p>x', 'y');
    eq(await renameTo(a, 'c.html'), 'Name changed. 1 place now says c.html.', 'the toast');
    const files = await list(saved.folder);
    assert(files.includes('c.html') && !files.includes('a.html'), `the folder holds ${files.join(', ')}`);
    eq(await readDisk(`${saved.folder}/c.html`), '<!doctype html>\n<p>x</p>\n', 'c.html on disk');
    eq(a.name, 'c.html', 'the tab name');
    assert(isChanged(a) && hasDot(a) && doc().includes('<p>xy'), 'the edit is not unsaved any more');
    await flows.saveFlow();
    eq(await readDisk(`${saved.folder}/c.html`), '<!doctype html>\n<p>xy</p>\n', 'c.html after Save');
    eq(await readDisk(`${saved.folder}/b.html`), '<!doctype html>\n<a href="c.html">A</a>\n', 'b.html on disk');
  });

  // Teeth: with `const memory = !project.folder || tab.savedDoc === null;` in doRename (rename.js)
  // set to `const memory = !project.folder;`, rename_file finds no notes.txt and the failure message
  // shows instead of the toast.
  await t('+ makes notes.txt, Change Name to todo.txt before Save, and Save writes only todo.txt', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html>\n<p>x</p>\n']]);
    await flows.__openList(saved.paths);
    const flow = flows.addFileFlow();
    await waitDialog('Make a new file');
    const chip = [...dialogRoot().querySelectorAll('[role="radiogroup"] label')].find((el) => el.textContent.trim().replace(/\s+/g, ' ') === 'Text .txt');
    chip.click();
    setField('#dlg-file', 'notes');
    await until(() => dialogRoot().querySelector('[data-hint]').textContent.trim() === 'You will get notes.txt.', 'the notes.txt hint');
    click('Make the file');
    await flow;
    await until(() => activeTab() && activeTab().name === 'notes.txt', 'notes.txt to open');
    await askFor(activeTab(), 'todo.txt');
    eq(dialogRoot().querySelector('.dlg-line').textContent, 'No other file in this project uses the name notes.txt, so nothing else needs to change.', 'the dialog line');
    assert(!dialogRoot().querySelector('[data-tick]'), 'a tick shows with no places');
    click('Change the name');
    await finished();
    eq(toastText(), 'Name changed.', 'the toast');
    let files = await list(saved.folder);
    assert(!files.includes('notes.txt') && !files.includes('todo.txt'), `a file is on disk before Save: ${files.join(', ')}`);
    typeAfter('', 'milk');
    await flows.saveFlow();
    files = await list(saved.folder);
    assert(files.includes('todo.txt') && !files.includes('notes.txt'), `the folder holds ${files.join(', ')}`);
    eq(await readDisk(`${saved.folder}/todo.txt`), 'milk', 'todo.txt on disk');
  });

  // Teeth: with `if (rec.disk.length) {` before the restore in undoSteps (rename.js) set to
  // `if (false) {`, heroes.html keeps tale.html on disk; with the `e.changes.invert(e.startDoc)`
  // transaction taken out, the index.html tab keeps tale.html.
  await t('Undo puts the old name back on disk and in every tab', async () => {
    const project = await comic();
    const folder = project.folder;
    const index = tabNamed(project, 'index.html');
    const indexText = index.state.doc.toString();
    await flows.closeTabFlow(tabNamed(project, 'heroes.html').path);
    const heroes = await readDisk(`${folder}/heroes.html`);
    const indexDisk = await readDisk(`${folder}/index.html`);
    const story = tabNamed(project, 'story.html');
    await renameTo(story, 'tale.html');
    eq(menuState().undoRename, true, 'File > Undo Change Name is off while the toast shows');
    const undo = $('rename-undo');
    assert(!undo.hidden && undo.textContent.trim() === 'Undo', 'no Undo button');
    undo.click();
    await until(() => toastText() === 'The old name is back.', () => `the Undo toast, it says "${toastText()}"`);
    assert($('rename-undo').hidden, 'Undo still offered');
    eq(menuState().undoRename, false, 'File > Undo Change Name is still on');
    const files = await list(folder);
    assert(files.includes('story.html') && !files.includes('tale.html'), `the folder holds ${files.join(', ')}`);
    eq(await readDisk(`${folder}/heroes.html`), heroes, 'heroes.html on disk');
    eq(await readDisk(`${folder}/index.html`), indexDisk, 'index.html on disk');
    eq(index.state.doc.toString(), indexText, 'the index.html tab');
    eq(story.name, 'story.html', 'the tab name');
    eq(story.path, `${folder}/story.html`, 'the tab path');
    assert(!S.tabs.some(isChanged), 'a tab shows changes after Undo');
  });

  // Teeth: with `if (rec && (rec.tab === tab || rec.tabs.some((e) => e.tab === tab))) endUndo();`
  // in noteUserEdit (rename.js) taken out, the toast and Undo stay after the typing; with the
  // `check: true` block in undoSteps taken out, Undo renames tale.html back to story.html although
  // heroes.html changed on disk.
  await t('Undo is refused after an edit of the user\'s own, and after a file changed on disk', async () => {
    let project = await comic();
    let folder = project.folder;
    await renameTo(tabNamed(project, 'story.html'), 'tale.html');
    switchTo(tabNamed(project, 'index.html').path);
    typeAfter('<h1', ' title="Zq"');
    await until(() => !toastText(), 'the toast to go after typing');
    eq(menuState().undoRename, false, 'File > Undo Change Name after typing');
    runCommand('undo-rename');
    await wait(100);
    let files = await list(folder);
    assert(files.includes('tale.html') && !files.includes('story.html'), `Undo ran after typing: ${files.join(', ')}`);

    flows.__closeAllNow();
    project = await comic();
    folder = project.folder;
    await flows.closeTabFlow(tabNamed(project, 'heroes.html').path);
    await renameTo(tabNamed(project, 'story.html'), 'tale.html');
    await write(`${folder}/heroes.html`, 'changed by someone else');
    $('rename-undo').click();
    await until(() => toastText() === 'A file changed after the new name, so the old name cannot come back by itself.', () => `the refusal, the toast says "${toastText()}"`);
    files = await list(folder);
    assert(files.includes('tale.html') && !files.includes('story.html'), `Undo ran: ${files.join(', ')}`);
    eq(await readDisk(`${folder}/heroes.html`), 'changed by someone else', 'heroes.html on disk');
  });

  // Teeth: with `if (toast.record && openedOutside(toast.record)) endUndo();` taken out of the
  // strip hook after() (rename.js), the toast still offers Undo after heroes.html opens.
  await t('opening a file that Change Name wrote ends Undo, so its tab always shows what is on disk', async () => {
    const project = await comic();
    const folder = project.folder;
    await flows.closeTabFlow(tabNamed(project, 'heroes.html').path);
    await renameTo(tabNamed(project, 'story.html'), 'tale.html');
    assert(!$('rename-undo').hidden, 'no Undo button after the change of name');
    await flows.__openList([`${folder}/heroes.html`]);
    const heroes = await until(() => S.tabs.find((x) => x.name === 'heroes.html'), 'heroes.html to open');
    await until(() => !toastText(), 'the toast to go when heroes.html opens');
    eq(menuState().undoRename, false, 'File > Undo Change Name after heroes.html opened');
    runCommand('undo-rename');
    await wait(100);
    const files = await list(folder);
    assert(files.includes('tale.html') && !files.includes('story.html'), `Undo ran: ${files.join(', ')}`);
    const onDisk = await readDisk(`${folder}/heroes.html`);
    assert(onDisk.includes('<a href="tale.html">Story</a>'), 'heroes.html on disk lost the new name');
    eq(heroes.state.doc.toString(), onDisk, 'the heroes.html tab and the disk');
    assert(!isChanged(heroes), 'heroes.html shows changes');
  });

  // Teeth: with `except: r.old` in check (rename.js) set to `except: null`, the field says
  // "You already have a file called Notes.txt." and Enter opens no dialog.
  await t('a case-only Change Name, notes.txt to Notes.txt', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html>\n<p>x</p>\n'], ['notes.txt', 'milk\n']]);
    await flows.__openList(saved.paths);
    const notes = S.tabs.find((x) => x.name === 'notes.txt');
    eq(await renameTo(notes, 'Notes.txt'), 'Name changed.', 'the toast');
    const files = await list(saved.folder);
    assert(files.includes('Notes.txt') && !files.includes('notes.txt'), `the folder holds ${files.join(', ')}`);
    eq(await readDisk(`${saved.folder}/Notes.txt`), 'milk\n', 'Notes.txt on disk');
    eq(notes.name, 'Notes.txt', 'the tab name');
  });

  // Teeth: with `if (!project || project.kind === 'practice') return false;` in renameFlow (rename.js)
  // set to `if (!project) return false;`, the field opens on the practice tab.
  await t('a practice tab cannot be renamed', async () => {
    const index = await invoke('help_index');
    await flows.tryIt(index.topics.find((x) => x.title.startsWith('Inline style')).id);
    await settle();
    eq(menuState().renamable, false, 'File > Change Name is on for a practice tab');
    runCommand('rename');
    await wait(700);
    const name = document.querySelector('#tab-list .tab.active .tab-name');
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) name.dispatchEvent(new MouseEvent(type, { bubbles: true, detail: 1 }));
    name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    press(document.querySelector('#tab-list .tab.active .tab-main'), 'Enter');
    await wait(100);
    assert(!field(), 'a field opened on the practice tab');
  });

  // Teeth: with the focused-button branch taken out of onEnter in showRenameDialog (dialogs.js),
  // Enter on "Keep the old name" presses "Change the name" and story.html is renamed.
  await t('Tab to Keep the old name and Enter changes nothing on disk', async () => {
    const project = await comic();
    const folder = project.folder;
    const before = await readDisk(`${folder}/index.html`);
    await askFor(tabNamed(project, 'story.html'), 'tale.html');
    for (let i = 0; i < 6 && document.activeElement.textContent.trim() !== 'Keep the old name'; i++) press(document.activeElement, 'Tab');
    eq(document.activeElement.textContent.trim(), 'Keep the old name', 'Tab never reached Keep the old name');
    press(document.activeElement, 'Enter');
    await until(() => !isDialogOpen(), 'the dialog to close');
    await wait(100);
    const files = await list(folder);
    assert(files.includes('story.html') && !files.includes('tale.html'), `the folder holds ${files.join(', ')}`);
    eq(await readDisk(`${folder}/index.html`), before, 'index.html on disk');
    eq(activeTab().name, 'story.html', 'the tab name');
    assert(!toastText(), 'a toast shows');
    assert(view.dom.contains(document.activeElement), 'focus is not back in the editor');
  });

  // Teeth: with `if (!tabByPath(r.path) || !attach(r)) {` in the strip hook after() (rename.js) set
  // to `if (true) {`, the rebuild when the dot goes cancels the field.
  await t('the Change Name field stays open through an auto-save that clears a dot', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html>\n<p>x</p>\n']]);
    await flows.__openList(saved.paths);
    const a = activeTab();
    S.prefs.autosave = true;
    typeAfter('<p>x', 'y');
    assert(hasDot(a), 'no dot after typing');
    await openField(a);
    typeName('b.html');
    await until(async () => (await readDisk(saved.paths[0])).includes('<p>xy'), 'the auto-save', 3500);
    await until(() => !hasDot(a), 'the dot to go');
    assert(field() && field().isConnected, 'the field went with the auto-save');
    eq(field().value, 'b.html', 'the field text');
    eq(document.activeElement, field(), 'the field lost focus');
    press(field(), 'Escape');
    await until(() => !field(), 'Esc to close the field');
    eq(a.name, 'a.html', 'the tab name after Esc');
    assert(view.dom.contains(document.activeElement), 'focus is not back in the editor after Esc');
  });

  // Teeth: with `bad = true;` taken out of the taken branch in paintTip (rename.js), aria-invalid
  // stays false; with `if (found.problem || found.taken) return;` in commit taken out, Enter on a
  // taken name opens the dialog.
  await t('the Change Name field gives the copy-table line for a taken or bad name, and Enter then does nothing', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html>\n<p>x</p>\n'], ['b.html', '<!doctype html>\n']]);
    await flows.__openList([saved.paths[0]]);
    await openField(activeTab());
    typeName('b.html');
    await tipIs('You already have a file called b.html.');
    eq(field().getAttribute('aria-invalid'), 'true', 'aria-invalid for a taken name');
    press(field(), 'Enter');
    await wait(200);
    assert(!isDialogOpen(), 'Enter opened a dialog for a taken name');
    typeName('notes/a.txt');
    await tipIs('A name cannot have / in it.');
    typeName('');
    await tipIs('Type a name first.');
    typeName('My Page.html');
    await tipIs('You will get my-page.html.');
    eq(field().getAttribute('aria-invalid'), 'false', 'aria-invalid for a good name');
    typeName('a.html');
    await tipIs(TIP);
    press(field(), 'Enter');
    await until(() => !field(), 'Enter on the same name to close the field');
    await wait(100);
    assert(!isDialogOpen(), 'the same name opened a dialog');
    eq(tabsOf(S.projects.get(activeTab().projectId)).length, 1, 'tabs');
  });

  // Teeth: with `|| (!kind.teaching && fromName !== toName)` taken out of applyName (rename.js),
  // app.tsx keeps the plain TypeScript parser: no JSXElement in the tree, and the bracket hint shows.
  await t('Change Name from app.ts to app.tsx reads TSX, so valid TSX shows no bracket hint', async () => {
    const plain = 'const n: number = 1;\n';
    const tsx = 'const A = () => <p>Hi (there</p>;\n';
    const saved = await disk(null, [['app.ts', plain]]);
    await flows.__openList(saved.paths);
    const app = activeTab();
    eq(app.name, 'app.ts', 'the tab');
    const setText = (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input.type' });
    const nodes = () => {
      const names = new Set();
      S.E.ensureSyntaxTree(view.state, view.state.doc.length, 5000).iterate({ enter: (n) => { names.add(n.name); } });
      return names;
    };
    // The control: a .ts file does not read <p> as a tag.
    setText(tsx);
    assert(!nodes().has('JSXElement'), 'app.ts reads TSX');
    setText(plain);
    assert(!isChanged(app), 'app.ts shows changes');
    eq(await renameTo(app, 'app.tsx'), 'Name changed.', 'the toast');
    eq(app.language, 'typescript', 'the language');
    switchTo(app.path);
    setText(tsx);
    assert(nodes().has('JSXElement'), 'app.tsx does not read TSX');
    // The hint looks 800 ms after the last change.
    await wait(1200);
    const hinted = view.dom.querySelector('.hint-box');
    assert(!hinted && !S.ed.hintActive(view.state), `a hint on valid TSX: ${hinted ? hinted.textContent : ''}`);
  });
}
