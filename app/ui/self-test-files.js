// Self-tests for 0.3.0 WP1 "Any text file, saved exactly as it was" (docs/NEXT-0.3.0.md, WP1; C43, C48).
// Uses from h: t, assert, eq, until, wait, settle, probe, openContent, doc, typeAfter, view, S, E, P,
// preview, flows, switchTo, tabNamed, activeTab, activeProject, tabsOf, showRight, parent, freshFolder,
// disk, clickLink, dialogRoot, waitDialog, click, setField, dialogGone.
// Expected bytes are always written out by hand here, never made by the code under test.
import { invoke } from './api.js';

export const FILE_TESTS = 10;

// Only for strings of plain ASCII letters written in this file.
export function ascii(text) {
  return [...text].map((c) => {
    const code = c.charCodeAt(0);
    if (code > 127) throw new Error(`not ASCII: ${c}`);
    return code;
  });
}

export function hex(bytes) {
  return (bytes || []).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export async function fileTests(h) {
  const { t, assert, eq, until, wait, settle, probe, openContent, doc, typeAfter, view, S, E, P, preview, flows } = h;
  const { switchTo, tabNamed, activeTab, activeProject, tabsOf, showRight, parent, freshFolder, disk, clickLink } = h;
  const { dialogRoot, waitDialog, click, clickOn, setField, dialogGone } = h;

  const folder = async (stem) => {
    const dir = `${parent}/${stem}-${freshFolder()}`;
    assert(await invoke('test_make_folder', { path: dir }), `the folder ${dir} was not made`);
    return dir;
  };
  const write = async (path, bytes) => {
    assert(await invoke('test_write_bytes', { path, bytes }), `${path} was not written`);
  };
  const same = async (path, want, label) => {
    const got = await invoke('test_read_bytes', { path });
    assert(Array.isArray(got), `${label}: no bytes read from ${path}`);
    if (got.length !== want.length || got.some((b, i) => b !== want[i])) {
      throw new Error(`${label}: got ${hex(got)}, wanted ${hex(want)}`);
    }
  };

  // Teeth: with no eol sent from writeChanged, or openList not passing the read style to addTab,
  // the saved file comes back with LF endings.
  await t('a CRLF file opened with Open keeps its CRLF endings when saved (C43)', async () => {
    const dir = await folder('crlf-open');
    const path = `${dir}/a.html`;
    await write(path, ascii('<!doctype html>\r\n<p>x</p>\r\n'));
    await flows.openPaths([path]);
    await settle();
    eq(activeTab().name, 'a.html', 'the open file');
    typeAfter('<p>x', 'y');
    await flows.saveFlow();
    await same(path, ascii('<!doctype html>\r\n<p>xy</p>\r\n'), 'a.html on disk');
  });

  // Teeth: with no eol sent from writeChanged, or openPageTab not passing the read style to addTab,
  // b.html comes back with LF endings.
  await t('a CRLF page opened by a link keeps its CRLF endings when saved (C43)', async () => {
    const dir = await folder('crlf-link');
    await write(`${dir}/index.html`, ascii('<!doctype html>\r\n<a href="b.html">Go</a>\r\n'));
    await write(`${dir}/b.html`, ascii('<!doctype html>\r\n<h1>Bee</h1>\r\n'));
    await flows.__openList([`${dir}/index.html`]);
    showRight('page');
    await settle();
    await clickLink('a[href="b.html"]');
    await until(() => activeTab() && activeTab().name === 'b.html', 'the link to open b.html as a tab');
    typeAfter('<h1>Bee', 's');
    await flows.saveFlow();
    await same(`${dir}/b.html`, ascii('<!doctype html>\r\n<h1>Bees</h1>\r\n'), 'b.html on disk');
    await same(`${dir}/index.html`, ascii('<!doctype html>\r\n<a href="b.html">Go</a>\r\n'), 'index.html on disk');
  });

  // Teeth: with no eol sent from writeChanged, or restoreSession not passing the read style to addTab,
  // r.html comes back with LF endings.
  await t('a CRLF file from a restored session keeps its CRLF endings when saved (C43)', async () => {
    const dir = await folder('crlf-session');
    const path = `${dir}/r.html`;
    await write(path, ascii('<!doctype html>\r\n<p>r</p>\r\n'));
    assert(await flows.restoreSession({ tabs: [path], active: path }), 'the session did not open');
    await settle();
    eq(activeTab().name, 'r.html', 'the restored tab');
    typeAfter('<p>r', 's');
    await flows.saveFlow();
    await same(path, ascii('<!doctype html>\r\n<p>rs</p>\r\n'), 'r.html on disk');
  });

  // Teeth: with the style left out of allFiles, both copies come back as UTF-8 with LF and no BOM.
  await t('Save a Copy keeps a CRLF file with a BOM and a UTF-16 LE file as they were (C43)', async () => {
    const dir = await folder('copy-style');
    // page.html: UTF-8 with a BOM and CRLF, "<p>ä</p>\r\n<p>y</p>\r\n".
    const page = [0xef, 0xbb, 0xbf, 0x3c, 0x70, 0x3e, 0xc3, 0xa4, 0x3c, 0x2f, 0x70, 0x3e, 0x0d, 0x0a,
      0x3c, 0x70, 0x3e, 0x79, 0x3c, 0x2f, 0x70, 0x3e, 0x0d, 0x0a];
    // notes.txt: UTF-16 LE with a BOM and CRLF, "äb\r\ncd\r\n".
    const notes = [0xff, 0xfe, 0xe4, 0x00, 0x62, 0x00, 0x0d, 0x00, 0x0a, 0x00, 0x63, 0x00, 0x64, 0x00, 0x0d, 0x00, 0x0a, 0x00];
    await write(`${dir}/page.html`, page);
    await write(`${dir}/notes.txt`, notes);
    await flows.__openList([`${dir}/page.html`, `${dir}/notes.txt`]);
    await settle();
    const project = activeProject();
    eq(tabsOf(project).map((x) => x.name).join(' '), 'page.html notes.txt', 'the tabs');
    switchTo(tabNamed(project, 'page.html').path);
    typeAfter('<p>ä', 'z');
    switchTo(tabNamed(project, 'notes.txt').path);
    eq(doc(), 'äb\ncd\n', 'the UTF-16 text in the editor');
    typeAfter('äb', 'z');
    const flow = flows.saveCopyFlow();
    await waitDialog('Save a copy of your project');
    const name = `Copy ${freshFolder()}`;
    setField('input[type="text"]', name);
    await clickOn('Save the copy');
    await flow;
    await dialogGone();
    const copy = activeProject().folder;
    assert(copy.endsWith(`/${name}`), `the copy is ${copy}`);
    // "<p>äz</p>\r\n<p>y</p>\r\n" with its BOM.
    await same(`${copy}/page.html`, [0xef, 0xbb, 0xbf, 0x3c, 0x70, 0x3e, 0xc3, 0xa4, 0x7a, 0x3c, 0x2f, 0x70, 0x3e, 0x0d, 0x0a,
      0x3c, 0x70, 0x3e, 0x79, 0x3c, 0x2f, 0x70, 0x3e, 0x0d, 0x0a], 'page.html in the copy');
    // "äbz\r\ncd\r\n" in UTF-16 LE with its BOM.
    await same(`${copy}/notes.txt`, [0xff, 0xfe, 0xe4, 0x00, 0x62, 0x00, 0x7a, 0x00, 0x0d, 0x00, 0x0a, 0x00,
      0x63, 0x00, 0x64, 0x00, 0x0d, 0x00, 0x0a, 0x00], 'notes.txt in the copy');
    await same(`${dir}/page.html`, page, 'the old page.html');
    await same(`${dir}/notes.txt`, notes, 'the old notes.txt');
  });

  // Teeth: with the 2,000 cap taken out of scan_folder or folder_stamp, the counts go over 2,000;
  // with project.lone not sent as files to folder_stamp, the focus reads the folder again.
  await t('a file in a folder of 20,000 files: one read of at most 2,000 entries, and a focus stats at most 2,000 (C48)', async () => {
    const dir = `${parent}/huge-${freshFolder()}`;
    try {
      assert(await invoke('test_make_tree', { path: dir, count: 20000 }), 'the 20,000 files were not made');
      await write(`${dir}/a.html`, ascii('<!doctype html>\n<p>big</p>\n'));
      await invoke('test_fs_counts', { reset: true });
      let start = performance.now();
      await flows.openPaths([`${dir}/a.html`]);
      await settle();
      const openMs = Math.round(performance.now() - start);
      eq(activeTab().name, 'a.html', 'the open file');
      eq(tabsOf(activeProject()).length, 1, 'tabs of the project');
      const opened = await invoke('test_fs_counts', { reset: true });
      eq(opened.readDirs, 1, 'folder reads on open');
      assert(opened.entriesRead <= 2000, `${opened.entriesRead} entries read on open`);
      start = performance.now();
      await preview.onWindowFocused();
      const focusMs = Math.round(performance.now() - start);
      const focused = await invoke('test_fs_counts', { reset: true });
      assert(focused.stats <= 2000, `${focused.stats} stats on a window focus`);
      eq(focused.readDirs, 0, 'folder reads on a window focus');
      return `information only: open ${openMs} ms (${opened.readDirs} folder read, ${opened.entriesRead} entries, ${opened.stats} stats); `
        + `focus ${focusMs} ms (${focused.stats} stats)`;
    } finally {
      flows.__closeAllNow();
      await invoke('test_delete_tree', { path: dir });
    }
  });

  // Teeth: with scan.stoppedEarly not counted as big in openPaths, or stopped_early not set in
  // scan_folder, the project is not lone and folder_stamp reads the folder a second time.
  await t('a page in a folder of 20,000 web files: the scan stops early and the folder is read once (C48)', async () => {
    const dir = `${parent}/huge-pages-${freshFolder()}`;
    try {
      assert(await invoke('test_make_tree', { path: dir, count: 20000, ext: 'html' }), 'the 20,000 pages were not made');
      await write(`${dir}/a.html`, ascii('<!doctype html>\n<p>big</p>\n'));
      await invoke('test_fs_counts', { reset: true });
      await flows.openPaths([`${dir}/a.html`]);
      await settle();
      eq(activeTab().name, 'a.html', 'the open file');
      eq(tabsOf(activeProject()).length, 1, 'tabs of the project');
      const opened = await invoke('test_fs_counts', { reset: true });
      eq(opened.readDirs, 1, 'folder reads on open');
      assert(opened.entriesRead <= 2000, `${opened.entriesRead} entries read on open`);
      await preview.onWindowFocused();
      const focused = await invoke('test_fs_counts', { reset: true });
      eq(focused.readDirs, 0, 'folder reads on a window focus');
      assert(focused.stats <= 2000, `${focused.stats} stats on a window focus`);
    } finally {
      flows.__closeAllNow();
      await invoke('test_delete_tree', { path: dir });
    }
  });

  // Teeth: without the other_encoding branch in messageForRead, the message says the computer would not let it read the file.
  await t('a file in another encoding gives its own message and opens nothing', async () => {
    const dir = await folder('latin');
    // "café" and a line break in Latin-1: 0xe9 is not UTF-8 here.
    await write(`${dir}/latin.txt`, [0x63, 0x61, 0x66, 0xe9, 0x0a]);
    const flow = flows.openPaths([`${dir}/latin.txt`]);
    await waitDialog('HTML Lab cannot read this file.');
    const text = dialogRoot().textContent;
    assert(text.includes('HTML Lab can only open text saved as UTF-8 or UTF-16, so it does not open latin.txt.'), text);
    const name = dialogRoot().querySelector('.dlg-line code');
    eq(name && name.textContent, 'latin.txt', 'the name in code style');
    click('OK');
    await flow;
    eq(S.tabs.length, 0, 'tabs opened');
  });

  // Teeth: with notes.txt counted against the project again (the 0.2.1 rule), Open offers only the linked CSS.
  await t('a page with style.css and notes.txt beside it opens as a two-file project', async () => {
    const saved = await disk(null, [
      ['a.html', '<!doctype html><link rel="stylesheet" href="style.css"><p>a</p>\n'],
      ['style.css', 'p { color: red; }\n'],
      ['notes.txt', 'x'],
    ]);
    const flow = flows.openPaths([`${saved.folder}/a.html`]);
    await waitDialog('Open all the files in this folder?');
    eq(dialogRoot().querySelectorAll('.file-row').length, 2, 'files in the list');
    assert(!dialogRoot().textContent.includes('notes.txt'), 'notes.txt is in the list');
    click('Open all 2 files');
    await flow;
    eq(S.tabs.map((x) => x.name).join(' '), 'a.html style.css', 'the tabs');
    eq((await probe('p', 'color')).value, 'rgb(255, 0, 0)', 'the style');
  });

  // Teeth: with addTab not passing the file's indent to newState, Tab in tabs.txt adds two spaces.
  await t('each file indents its own way: a tab, 4 spaces, and 2 spaces for a new page', async () => {
    const dir = await folder('indent');
    await write(`${dir}/tabs.txt`, ascii('a\n\tb\n\tc\n'));
    await write(`${dir}/four.txt`, ascii('a\n    b\n    c\n    d\n'));
    await flows.__openList([`${dir}/tabs.txt`, `${dir}/four.txt`]);
    const project = activeProject();
    const key = (init) => E.runScopeHandlers(view, new KeyboardEvent('keydown', init), 'editor');
    const tabAtStart = () => {
      view.dispatch({ selection: { anchor: 0 } });
      assert(key({ key: 'Tab', keyCode: 9 }), 'Tab was not handled');
    };
    switchTo(tabNamed(project, 'tabs.txt').path);
    tabAtStart();
    eq(doc().slice(0, 2), '\ta', 'tabs.txt after Tab');
    switchTo(tabNamed(project, 'four.txt').path);
    tabAtStart();
    eq(doc().slice(0, 5), '    a', 'four.txt after Tab');
    await openContent('A', [['a.html', '<p>x</p>\n']]);
    tabAtStart();
    eq(doc().slice(0, 5), '  <p>', 'a new page after Tab');
  });

  // Teeth: without the kind check at the top of preview.onKey, typing in notes.txt sends a page message.
  await t('typing in a text file leaves the page alone', async () => {
    const dir = await folder('text-tab');
    await write(`${dir}/a.html`, ascii('<!doctype html>\n<h1>Page</h1>\n'));
    await write(`${dir}/notes.txt`, ascii('<h1>Notes</h1>\n'));
    await flows.__openList([`${dir}/a.html`, `${dir}/notes.txt`]);
    await settle();
    const project = activeProject();
    const page = tabNamed(project, 'a.html');
    switchTo(tabNamed(project, 'notes.txt').path);
    await settle();
    const sent = P.nextId;
    const loads = P.loadId;
    typeAfter('<h1>Notes', '!');
    await wait(300);
    eq(P.nextId, sent, 'messages to the page');
    eq(P.loadId, loads, 'page loads');
    eq(P.showing, page.path, 'what the page shows');
    eq((await probe('h1')).text, 'Page', 'the page');
    assert(S.tabs.length === 2, 'tabs');
  });
}
