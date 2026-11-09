// Self-tests for 0.3.0 WP4 "New file from the +, and the toolbar label" (docs/NEXT-0.3.0.md, WP4;
// C4, C9). Uses from h: t, assert, eq, until, wait, openContent, sample, doc, view, S, flows,
// runCommand, activeTab, activeProject, invoke, disk, readDisk, dialogRoot, waitDialog, click,
// setField, $.
// Expected words come from the copy table, never from the code under test.

export const NEWFILE_TESTS = 6;

const TITLE = 'Make a new file';
const MAKE = 'Make the file';
const OTHER_HINT = 'Type the whole name with its ending, like notes.md.';
const CHIPS = ['Web page .html', 'Style .css', 'Script .js', 'Text .txt', 'Other'];

export async function newFileTests(h) {
  const {
    t, assert, eq, until, wait, openContent, sample, doc, view, S, flows, runCommand, activeTab, activeProject,
    invoke, disk, readDisk, dialogRoot, waitDialog, click, setField, $,
  } = h;
  const SPACE = 'space-club';

  const hint = () => dialogRoot().querySelector('[data-hint]').textContent.trim();
  const ending = () => {
    const el = dialogRoot().querySelector('[data-ext]');
    return el.hidden ? '' : el.textContent;
  };
  const field = () => dialogRoot().querySelector('#dlg-file');
  const makeButton = () => [...dialogRoot().querySelectorAll('button')].find((b) => b.textContent.trim() === MAKE);
  const chosen = () => {
    const radio = dialogRoot().querySelector('[role="radiogroup"] input[type="radio"]:checked');
    return radio ? radio.closest('label').textContent.trim().replace(/\s+/g, ' ') : null;
  };
  const pick = async (label) => {
    const chip = [...dialogRoot().querySelectorAll('[role="radiogroup"] label')]
      .find((el) => el.textContent.trim().replace(/\s+/g, ' ') === label);
    assert(chip, `no chip "${label}"`);
    chip.click();
    await until(() => chosen() === label, `the ${label} chip to be chosen`);
  };
  const hintIs = (text) => until(() => hint() === text, () => `the hint "${text}", it says "${hint()}"`);
  const typeName = async (value, wanted) => {
    setField('#dlg-file', value);
    await hintIs(wanted);
  };
  const make = async (flow) => {
    click(MAKE);
    await flow;
    await until(() => !dialogRoot().querySelector('#dlg-file'), 'the dialog to close');
  };

  // Teeth: with `text = made.text;` taken out of addFileFlow (flows.js) the page has no starter
  // text; with `let text = '';` there set to '\n', or new_file called for every name, game.py is
  // not empty; with the Other chip keeping an ending or another hint, the Other checks fail.
  await t('+ makes a page with starter text and an empty .py file with Other', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<p>x</p>\n']]);
    eq($('tab-add').getAttribute('aria-label'), TITLE, 'the + aria-label');
    eq($('tab-add').title, TITLE, 'the + tooltip');
    const flow = flows.addFileFlow();
    await waitDialog(TITLE);
    const labels = [...dialogRoot().querySelectorAll('[role="radiogroup"] label')].map((el) => el.textContent.trim().replace(/\s+/g, ' '));
    eq(labels.join(' | '), CHIPS.join(' | '), 'the chips');
    eq(dialogRoot().querySelector('[role="radiogroup"]').getAttribute('aria-label'), 'Kind of file', 'the chips group');
    eq(dialogRoot().querySelectorAll('[role="radiogroup"] input[type="radio"]').length, 5, 'native radios');
    eq(chosen(), 'Web page .html', 'the first chip in a project with a page');
    eq(ending(), '.html', 'the ending after the field');
    await typeName('level two', 'You will get level-two.html.');
    assert(dialogRoot().querySelector('[data-hint] code'), 'the name in the hint is not code');
    await make(flow);
    eq(activeTab().name, 'level-two.html', 'the page tab');
    assert(doc().toLowerCase().includes('<!doctype html>') && doc().includes('<title>'), `no starter text: ${doc().slice(0, 60)}`);

    runCommand('add-file');
    await waitDialog(TITLE);
    await pick('Other');
    eq(ending(), '', 'Other shows no ending');
    eq(field().value, '', 'Other starts empty');
    eq(hint(), OTHER_HINT, 'the Other hint');
    assert(makeButton().disabled, 'the button is on with no name');
    await typeName('game.py', 'You will get game.py.');
    click(MAKE);
    await until(() => activeTab() && activeTab().name === 'game.py', 'game.py to open');
    eq(doc(), '', 'game.py text');
    eq(activeTab().kind, 'code', 'game.py kind');
    eq(activeTab().language, 'python', 'game.py language');
    eq(activeProject().pageTab !== null, true, 'the page stays the page');
  });

  // Teeth: with the "already ends with the ending" drop taken out of resolve (dialogs.js), game.js
  // becomes game.js.js; with startChip always 'page' in addFileFlow, the first chip is Web page;
  // with the Script default stem not "script" or the Text one not "notes", the field checks fail.
  await t('Script with game.js gives game.js, and a project with no page starts on Text', async () => {
    // A project with no page never settles a preview, so it is opened without openContent's wait.
    await flows.__openContent({ id: 'test', name: 'A', files: [{ name: 'game.py', code: 'print(1)\n', hidden: false }] }, 'new');
    await until(() => activeTab() && activeTab().name === 'game.py', 'game.py to open');
    const flow = flows.addFileFlow();
    await waitDialog(TITLE);
    eq(chosen(), 'Text .txt', 'the first chip with no web files');
    eq(field().value, 'notes', 'the Text name');
    eq(ending(), '.txt', 'the Text ending');
    await hintIs('You will get notes.txt.');
    await pick('Script .js');
    eq(ending(), '.js', 'the Script ending');
    await until(() => field().value === 'script', 'the Script name');
    await hintIs('You will get script.js.');
    await typeName('GAME.JS', 'You will get GAME.js.');
    await typeName('game.js', 'You will get game.js.');
    assert(!dialogRoot().querySelector('[data-tick-row]').offsetParent, 'a tick shows for Script');
    await make(flow);
    eq(activeTab().name, 'game.js', 'the tab');
    eq(activeTab().language, 'javascript', 'the language');
    eq(doc(), '', 'the text');
  });

  // Teeth: with the Other chip given an ending ('.txt') in showNewFileDialog, notes.md becomes
  // notes.md.txt; with Other names sent through the web cleaner, README becomes readme.
  await t('Other with notes.md gives notes.md, and a name with no dot is a text file', async () => {
    await openContent('A', [['a.html', '<!doctype html>\n<p>x</p>\n']]);
    let flow = flows.addFileFlow();
    await waitDialog(TITLE);
    await pick('Other');
    await typeName('notes.md', 'You will get notes.md.');
    await make(flow);
    eq(activeTab().name, 'notes.md', 'the md tab');
    eq(activeTab().language, 'markdown', 'the md language');
    flow = flows.addFileFlow();
    await waitDialog(TITLE);
    await pick('Other');
    await typeName('README', 'You will get README.');
    await make(flow);
    eq(activeTab().name, 'README', 'the tab with no ending');
    eq(activeTab().language, 'text', 'the language of a name with no dot');
    eq(doc(), '', 'the text');
  });

  // Teeth: with `result.taken = !(await nameFree(result.name))` in check() (dialogs.js) set to
  // false, the button stays on for a taken name; with nameProblemText's bad_char line changed,
  // the slash line fails.
  await t('a taken name or a bad name blocks the button with the copy-table line', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html><p>x</p>\n'], ['on-disk.txt', 'x']]);
    await flows.__openList([saved.paths[0]]);
    const flow = flows.addFileFlow();
    await waitDialog(TITLE);
    await pick('Text .txt');
    await typeName('on-disk', 'You already have a file called on-disk.txt.');
    assert(makeButton().disabled, 'the button is on for a taken Text name');
    await pick('Other');
    await typeName('ON-DISK.TXT', 'You already have a file called ON-DISK.TXT.');
    assert(makeButton().disabled, 'the button is on for a taken name in another case');
    await typeName('a/b.txt', 'A name cannot have / in it.');
    assert(makeButton().disabled, 'the button is on for a bad name');
    await typeName('notes.', 'A name cannot end with a dot.');
    assert(makeButton().disabled, 'the button is on for a name with a dot at the end');
    await pick('Web page .html');
    await typeName('a', 'You already have a file called a.html.');
    assert(makeButton().disabled, 'the button is on for a taken page');
    await typeName('fine', 'You will get fine.html.');
    assert(!makeButton().disabled, 'the button stays off for a free name');
    click('Cancel');
    await flow;
    eq(S.tabs.length, 1, 'a tab was made');
  });

  // Teeth: with `onDisk: !project.folder` in addFileFlow set to `onDisk: true`, the tab is not new
  // (savedDoc is set) and Save does not write it; with `mustNotExist: wasNew` in writeChanged set
  // to `mustNotExist: false`, Save overwrites the later.txt copied in (C4).
  await t('a file from the + is on disk only after Save, and Save never overwrites one copied in (C4, C9)', async () => {
    const saved = await disk(null, [['a.html', '<!doctype html>\n<p>x</p>\n']]);
    await flows.__openList(saved.paths);
    let flow = flows.addFileFlow();
    await waitDialog(TITLE);
    await pick('Script .js');
    await typeName('game', 'You will get game.js.');
    await make(flow);
    eq(activeTab().savedDoc, null, 'the new tab counts as saved');
    let files = await invoke('test_list_folder', { path: saved.folder });
    assert(!files.includes('game.js'), `game.js is on disk before Save: ${files.join(', ')}`);
    view.dispatch({ changes: { from: 0, insert: 'let x = 1;\n' }, userEvent: 'input.type' });
    await flows.saveFlow();
    files = await invoke('test_list_folder', { path: saved.folder });
    assert(files.includes('game.js'), `game.js is not on disk after Save: ${files.join(', ')}`);
    eq(await readDisk(`${saved.folder}/game.js`), 'let x = 1;\n', 'game.js on disk');

    flow = flows.addFileFlow();
    await waitDialog(TITLE);
    await pick('Text .txt');
    await typeName('later', 'You will get later.txt.');
    await make(flow);
    await invoke('test_write_bytes', { path: `${saved.folder}/later.txt`, bytes: [...new TextEncoder().encode('own text')] });
    const save = flows.saveFlow();
    await waitDialog('There is already a file called later.txt');
    click('Keep working');
    await save;
    eq(await readDisk(`${saved.folder}/later.txt`), 'own text', 'later.txt was overwritten');
  });

  // Teeth: with the @media (max-width: 1100px) rule for .tb padding taken out of style.css, the
  // side button ends about 16 px past .tb-left at 960 px; with #btn-new still "New", the label check fails.
  await t('at a 960 px window the side button stays inside the left toolbar', async () => {
    await sample(SPACE);
    eq($('btn-new').textContent.trim(), 'New project', 'the first toolbar button');
    const before = await invoke('test_window_state');
    assert(before && before.width && before.height, 'no window size');
    try {
      assert(await invoke('test_set_window_size', { width: 960, height: before.height }), 'the window size could not be set');
      await until(() => Math.abs(window.innerWidth - 960) <= 1, () => `the window to be 960 px wide, it is ${window.innerWidth}`, 3000);
      await wait(50);
      const side = $('btn-side').getBoundingClientRect();
      const left = document.querySelector('.tb-left').getBoundingClientRect();
      assert(side.right <= left.right + 0.5, `#btn-side ends at ${side.right.toFixed(1)}, .tb-left at ${left.right.toFixed(1)}`);
      assert(side.left >= $('btn-save').getBoundingClientRect().right, 'the side button overlaps Save');
      for (const id of ['btn-new', 'btn-open', 'btn-save']) {
        const el = $(id);
        assert(el.scrollWidth <= el.clientWidth + 1, `${id} cuts its label`);
      }
    } finally {
      await invoke('test_set_window_size', { width: before.width, height: before.height });
      await until(() => Math.abs(window.innerWidth - before.width) <= 1, 'the window to get its size back', 3000).catch(() => {});
    }
  });
}
