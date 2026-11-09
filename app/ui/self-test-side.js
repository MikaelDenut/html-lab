// Self-tests for 0.3.0 WP3 "Hide and show the My page side" (docs/NEXT-0.3.0.md, WP3; C46).
// Uses from h: t, assert, eq, until, wait, settle, probe, openContent, sample, typeAfter, view, S, P,
// preview, flows, runCommand, switchTo, tabNamed, activeTab, activeProject, tabsOf, showRight, divider,
// waitDialog, click, modKey, $.
// Expected words come from the copy table, never from the code under test.

export const SIDE_TESTS = 12;

const HIDE = 'Hide the My page side';
const SHOW = 'Show the My page side';
const NO_PAGE_TITLE = 'This file has no page to show.';
const NO_PAGE_LINE = 'game.py is not a web page. My page shows web pages made with HTML, and this folder has none.';

export async function sideTests(h) {
  const {
    t, assert, eq, until, wait, settle, probe, openContent, sample, typeAfter, view, S, P, preview, flows,
    runCommand, switchTo, tabNamed, activeTab, activeProject, tabsOf, showRight, divider, waitDialog, click, modKey, $,
  } = h;
  const SPACE = 'space-club';

  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width >= 2 && r.height >= 2 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const button = () => $('btn-side');
  const sideClick = () => button().click();
  const sideIsHidden = (label) => {
    eq(S.sideShown, false, `${label}: S.sideShown`);
    assert(!shown($('right')), `${label}: the side still shows`);
    assert(!shown($('divider')), `${label}: the divider still shows`);
  };
  const sideIsShown = (label) => {
    eq(S.sideShown, true, `${label}: S.sideShown`);
    assert(shown($('right')), `${label}: the side does not show`);
  };
  const innerWidth = (el) => {
    const style = getComputedStyle(el);
    return el.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  };
  const content = (name, files) => ({ id: 'test', name, files: files.map(([n, code]) => ({ name: n, code, hidden: false })) });
  const PY = 'class Player:\n    def jump(self):\n        return 1\n';
  // The test Mac's window is often not the key window; Help on This Word asks whether the code has the focus.
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

  // Teeth: with #btn-side not wired, the View menu id missing from COMMANDS, #main.side-hidden not
  // hiding #right, the segs not hidden, the words not swapped, or the button moving, this fails.
  await t('the side button and View > My Page Side hide and show My page, and the button stays put', async () => {
    await sample(SPACE);
    const b = button();
    assert(!b.disabled, 'the button is disabled with a page open');
    eq(b.getAttribute('aria-pressed'), 'true', 'aria-pressed while shown');
    eq(b.title, HIDE, 'the tooltip while shown');
    eq(b.getAttribute('aria-label'), HIDE, 'the aria-label while shown');
    const before = b.getBoundingClientRect();
    const left = b.closest('.tb-left').getBoundingClientRect();
    assert(before.right <= left.right + 0.5 && before.right >= left.right - 1, `the button is not at the right end of the left toolbar: ${before.right} of ${left.right}`);
    sideClick();
    sideIsHidden('after the click');
    eq(S.sideManual, 'hidden', 'the choice by hand');
    eq(b.getAttribute('aria-pressed'), 'false', 'aria-pressed while hidden');
    eq(b.title, SHOW, 'the tooltip while hidden');
    eq(b.getAttribute('aria-label'), SHOW, 'the aria-label while hidden');
    assert(Math.abs($('left').getBoundingClientRect().width - innerWidth($('main'))) <= 1, 'the code does not take the whole width');
    eq(getComputedStyle(document.querySelector('.segs')).visibility, 'hidden', 'the My page and Help switch');
    assert(shown(document.querySelector('.brand')), 'the brand went away');
    const after = b.getBoundingClientRect();
    eq(Math.round(after.left), Math.round(before.left), 'the button moved');
    sideClick();
    sideIsShown('after the second click');
    eq(S.sideManual, null, 'the choice by hand after it matched the automatic one');
    runCommand('toggle-side');
    sideIsHidden('View > My Page Side');
    runCommand('toggle-side');
    sideIsShown('View > My Page Side again');
    eq(Math.round(b.getBoundingClientRect().left), Math.round(before.left), 'the button moved after the menu');
  });

  // Teeth: with the automatic choice always "shown", or switchTo not deciding the side, the Python
  // tab keeps the side; with it never coming back, the HTML tab check fails.
  await t('a Python tab hides the side by itself, and an HTML tab shows it again', async () => {
    const project = await openContent('Mix', [['index.html', '<!doctype html>\n<h1>Home</h1>\n'], ['game.py', PY]]);
    sideIsShown('on the page');
    switchTo(tabNamed(project, 'game.py').path);
    sideIsHidden('on game.py');
    eq(S.sideManual, null, 'nothing chosen by hand');
    assert(!button().disabled, 'the button is disabled on game.py');
    switchTo(tabNamed(project, 'index.html').path);
    sideIsShown('back on the page');
    await settle();
  });

  // Teeth: with the choice by hand cleared on every tab switch, planets.html shows the side; with it
  // never cleared when it matches the automatic one, S.sideManual stays "shown" or "hidden".
  await t('a hide by hand wins over a switch to an HTML tab, and clears when it matches the automatic choice', async () => {
    const project = await sample(SPACE);
    switchTo(tabNamed(project, 'my-page.html').path);
    sideClick();
    switchTo(tabNamed(project, 'planets.html').path);
    sideIsHidden('planets.html after a hide by hand');
    switchTo(tabNamed(project, 'style.css').path);
    sideIsHidden('style.css after a hide by hand');
    sideClick();
    sideIsShown('shown again by hand');
    eq(S.sideManual, null, 'a show that matches the automatic choice');
    const mix = await openContent('Mix', [['index.html', '<!doctype html>\n<h1>Home</h1>\n'], ['game.py', PY]]);
    switchTo(tabNamed(mix, 'game.py').path);
    sideIsHidden('game.py');
    sideClick();
    eq(S.sideManual, 'shown', 'a show on game.py');
    switchTo(tabNamed(mix, 'index.html').path);
    switchTo(tabNamed(mix, 'game.py').path);
    sideIsShown('game.py after a show by hand');
    sideClick();
    sideIsHidden('game.py hidden again');
    eq(S.sideManual, null, 'a hide that matches the automatic choice');
  });

  // Teeth: without showSide in openHelpView, in the help and my-page commands or in the ? key,
  // Help or My page opens on a hidden side and S.sideShown stays false.
  await t('Help, Help on This Word, Start here, Cmd+? and View > My Page bring a hidden side back', () => withKeyWindow(async () => {
    const project = await sample(SPACE);
    const page = tabNamed(project, 'my-page.html');
    switchTo(page.path);
    const hideAgain = (label) => {
      showRight('page');
      if (S.sideShown) sideClick();
      eq(S.sideShown, false, `${label}: hidden first`);
    };
    hideAgain('View > Help');
    runCommand('help');
    sideIsShown('View > Help');
    eq(S.rightView, 'help', 'View > Help shows Help');
    eq(S.sideManual, null, 'View > Help sets the choice as a click would');
    hideAgain('Help menu');
    runCommand('help-home');
    sideIsShown('Help > HTML Lab Help');
    eq(S.rightView, 'help', 'the Help menu shows Help');
    hideAgain('View > My Page');
    runCommand('my-page');
    sideIsShown('View > My Page');
    eq(S.rightView, 'page', 'View > My Page shows the page');
    hideAgain('Cmd+?');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true, ...modKey, shiftKey: true }));
    sideIsShown('Cmd+?');
    eq(S.rightView, 'help', 'Cmd+? shows Help');
    hideAgain('Start here');
    $('page-empty-link').click();
    sideIsShown('Start here');
    eq(S.rightView, 'help', 'Start here shows Help');
    hideAgain('Help on This Word');
    const at = view.state.doc.toString().indexOf('<h1') + 2;
    view.dispatch({ selection: { anchor: at } });
    view.focus();
    runCommand('help-word');
    await until(() => S.rightView === 'help', 'Help on This Word to show Help', 3000);
    sideIsShown('Help on This Word');
    showRight('page');
    const mix = await openContent('Mix', [['index.html', '<!doctype html>\n<h1>Home</h1>\n'], ['game.py', PY]]);
    switchTo(tabNamed(mix, 'game.py').path);
    sideIsHidden('game.py');
    runCommand('help');
    sideIsShown('View > Help on game.py');
    eq(S.sideManual, 'shown', 'View > Help on game.py sets the choice as a click would');
  }));

  // Teeth: without the reset when the last tab closes, or in openContent (New project), the side
  // stays hidden; with the button left on, the start screen check fails.
  await t('hide, close all tabs, New project: the side is shown each time', async () => {
    await sample(SPACE);
    sideClick();
    eq(S.sideShown, false, 'hidden by hand');
    flows.__closeAllNow();
    await wait(0);
    eq(S.tabs.length, 0, 'tabs left');
    eq(S.sideShown, true, 'the start screen side');
    eq(S.sideManual, null, 'the choice by hand on the start screen');
    assert(button().disabled, 'the button works on the start screen');
    assert(shown($('welcome-how')), 'How HTML Lab works does not show');
    await sample(SPACE);
    sideClick();
    eq(S.sideShown, false, 'hidden by hand again');
    const flow = flows.newFlow();
    await waitDialog('What do you want to make?');
    click('Style inside the page');
    await flow;
    await until(() => activeTab() && activeProject().kind === 'new', 'the new project');
    sideIsShown('New project');
    eq(S.sideManual, null, 'the choice by hand after New project');
    await settle();
  });

  // Teeth: remove the hidden check from pump() and the P.nextId assertion fails; remove it from
  // load() and the iframe.src assertion fails (C46).
  await t('C46: a hidden side sends nothing and loads nothing, then catches up with one load', async () => {
    const other = await openContent('Other', [['other.html', '<!doctype html>\n<h1>Other</h1>\n']]);
    const project = await sample(SPACE);
    const page = tabNamed(project, 'my-page.html');
    switchTo(page.path);
    await settle();
    sideClick();
    eq(S.sideShown, false, 'hidden by hand');
    const frame = $('preview');
    const sent = P.nextId;
    const loads = P.loadId;
    const src = frame.src;
    typeAfter('Welcome to space', ' and Zebra');
    await wait(100);
    switchTo(tabNamed(project, 'style.css').path);
    typeAfter('h1 {\n  color: gold', 'enrod');
    await wait(100);
    switchTo(tabNamed(project, 'planets.html').path);
    switchTo(tabsOf(other)[0].path);
    switchTo(page.path);
    await wait(400);
    eq(P.nextId, sent, 'messages sent to a hidden page');
    eq(P.loadId, loads, 'loads of a hidden page');
    eq(frame.src, src, 'the hidden page address');
    eq(preview.inSync(), false, 'in step while hidden');
    eq(preview.showingPageTab(), false, 'Point while hidden');
    sideClick();
    await settle();
    await wait(300);
    await settle();
    eq(P.loadId, loads + 1, 'loads after the side came back');
    eq((await probe('h1')).text, 'Welcome to space and Zebra!', 'the page shows the typed text');
    eq((await probe('h1', 'color')).value, 'rgb(218, 165, 32)', 'the page shows the typed style');
  });

  // Teeth: without the hidden check after the awaits in load(), the address is set while hidden (A);
  // without it in onReady, the scroll message is posted to the hidden page (B); without the redo in
  // onSideHidden, no load is wanted when the side hides (B). Then the page comes back with no boxes.
  await t('C46: a load already running when the side hides sends nothing, and the side comes back with the boxes on', async () => {
    const other = await openContent('Other', [['other.html', '<!doctype html>\n<h1>Other</h1>\n<p>Two</p>\n']]);
    await settle();
    eq(P.showing, tabsOf(other)[0].path, 'the page shown');
    const pressed = () => $('btn-boxes').getAttribute('aria-pressed');
    runCommand('boxes');
    await until(() => pressed() === 'true', 'Show the Boxes on');
    await until(async () => (await probe(null, null)).inspect.boxes === true, 'the boxes in the page');
    const frame = $('preview');

    // A: the side hides while load() waits for the files, before any address is set.
    const src = frame.src;
    const sentA = P.nextId;
    const postedA = P.posted;
    const going = preview.load();
    sideClick();
    eq(S.sideShown, false, 'A: hidden during the load');
    await going;
    eq(frame.src, src, 'A: the address set while hidden');
    eq(P.loadWanted, true, 'A: the load waits for the side');
    eq(P.nextId, sentA, 'A: messages sent to a hidden page');
    eq(P.posted, postedA, 'A: messages posted to a hidden page');
    const loadsA = P.loadId;
    sideClick();
    await settle();
    eq(P.loadId, loadsA + 1, 'A: loads after the side came back');

    // B: the side hides after the address is set, before the page says ready. A mutation
    // callback runs before any message from the page can, so the hide always comes first.
    let hid = null;
    let readyHidden = false;
    const heard = (event) => {
      if (hid && event.source === frame.contentWindow && event.data && event.data.t === 'ready') readyHidden = true;
    };
    const watch = new MutationObserver(() => {
      if (hid) return;
      watch.disconnect();
      sideClick();
      hid = { sent: P.nextId, posted: P.posted, loads: P.loadId, wanted: P.loadWanted, shown: S.sideShown };
    });
    window.addEventListener('message', heard);
    try {
      watch.observe(frame, { attributes: true, attributeFilter: ['src'] });
      await preview.load();
      assert(hid, 'B: the load set no address');
      eq(hid.shown, false, 'B: hidden right after the address was set');
      eq(hid.wanted, true, 'B: a running load is done again when the side comes back');
      await until(() => readyHidden, 'B: the hidden page to say ready', 6000);
      await wait(0);
      eq(P.nextId, hid.sent, 'B: messages sent to a hidden page');
      eq(P.posted, hid.posted, 'B: messages posted to a hidden page');
      eq(P.loadId, hid.loads, 'B: loads of a hidden page');
      assert(P.phase !== 'live', 'B: the hidden page went live');
    } finally {
      watch.disconnect();
      window.removeEventListener('message', heard);
    }
    sideClick();
    await settle();
    eq(P.loadId, hid.loads + 1, 'B: one fresh load after the side came back');
    eq(pressed(), 'true', 'B: the Boxes button after the side came back');
    eq((await probe(null, null)).inspect.boxes, true, 'B: the boxes in the page after the side came back');
    runCommand('boxes');
    await until(() => pressed() === 'false', 'Show the Boxes off');
  });

  // Teeth: without the !important full width for #main.side-hidden > #left, the code keeps the
  // dragged width while hidden; with the inline width cleared on hide, it does not come back.
  await t('a divider drag width is ignored while the side is hidden and comes back after', async () => {
    await sample(SPACE);
    const left = $('left');
    const line = $('divider').getBoundingClientRect();
    divider.start();
    divider.move(line.left + line.width / 2 - 100);
    divider.end();
    const dragged = Math.round(left.getBoundingClientRect().width);
    assert(left.style.flex, 'the drag left no width');
    sideClick();
    assert(Math.abs(left.getBoundingClientRect().width - innerWidth($('main'))) <= 1, `the code is ${left.getBoundingClientRect().width} px, not the whole width`);
    sideClick();
    eq(Math.round(left.getBoundingClientRect().width), dragged, 'the dragged width after the side came back');
    left.style.flex = '';
  });

  // Teeth: with pageUses always false, the label says only "Showing index.html"; with the script
  // hint pushed below the label sentence, the hint check fails.
  await t('a script file shows the open page that uses it, with the script note (WP3 step 6a)', async () => {
    const project = await openContent('Frog', [
      ['index.html', '<!doctype html>\n<html>\n<body>\n<h1>Frog Jump</h1>\n<script src="game.js"></script>\n</body>\n</html>\n'],
      ['game.js', 'let height = 0;\n'],
    ]);
    switchTo(tabNamed(project, 'game.js').path);
    sideIsHidden('game.js');
    sideClick();
    sideIsShown('game.js shown by hand');
    await until(() => $('page-label').textContent === 'Showing index.html, which uses game.js', () => `the label, saw "${$('page-label').textContent}"`, 3000);
    await until(() => $('page-hint').textContent === preview.SCRIPT_HINT, () => `the script note, saw "${$('page-hint').textContent}"`, 3000);
    eq(P.showing, tabNamed(project, 'index.html').path, 'the page shown');
    assert($('page-none').hidden, 'the no-page state shows');
    eq((await probe('h1')).text, 'Frog Jump', 'the page');
  });

  // Teeth: with the folder hint missing from hintFor, or the side going empty instead of showing the
  // project's page, this fails.
  await t('a text file shows a page from its folder with the hint (WP3 step 6c)', async () => {
    const project = await openContent('Notes', [['index.html', '<!doctype html>\n<h1>Home</h1>\n'], ['notes.txt', 'My notes\n']]);
    switchTo(tabNamed(project, 'notes.txt').path);
    sideIsHidden('notes.txt');
    sideClick();
    await until(() => $('page-label').textContent === 'Showing index.html', () => `the label, saw "${$('page-label').textContent}"`, 3000);
    await until(() => $('page-hint').textContent === 'A page from this folder', () => `the hint, saw "${$('page-hint').textContent}"`, 3000);
    assert($('page-none').hidden, 'the no-page state shows');
    eq((await probe('h1')).text, 'Home', 'the page');
  });

  // Teeth: with the no-page state left out (the empty frame shown instead), the title check fails;
  // with "Hide this side" or "Open Help" not wired, the side stays or Help does not open.
  await t('a file with no page anywhere shows the no-page side, and its button and link work (WP3 step 6d)', async () => {
    await flows.__openContent(content('Py', [['game.py', PY]]), 'new');
    await until(() => activeTab() && activeTab().name === 'game.py', 'game.py to open');
    sideIsHidden('game.py alone');
    sideClick();
    sideIsShown('game.py shown by hand');
    await until(() => !$('page-none').hidden, 'the no-page state', 3000);
    assert(!shown($('page-header')), 'the page header shows');
    eq($('page-none').querySelector('.none-title').textContent, NO_PAGE_TITLE, 'the title');
    eq($('page-none-line').textContent, NO_PAGE_LINE, 'the line');
    const code = $('page-none-line').querySelector('code');
    eq(code && code.textContent, 'game.py', 'the name in code style');
    eq($('btn-hide-side').textContent.trim(), 'Hide this side', 'the button');
    eq($('page-none-help').textContent.trim(), 'Open Help', 'the link');
    $('btn-hide-side').click();
    sideIsHidden('Hide this side');
    eq(S.sideManual, null, 'Hide this side matches the automatic choice');
    sideClick();
    await until(() => !$('page-none').hidden, 'the no-page state again', 3000);
    $('page-none-help').click();
    eq(S.rightView, 'help', 'Open Help');
    sideIsShown('Open Help');
  });

  // Teeth: without the focus move in drawSide, the focus stays on the hidden button or switch (and then
  // drops to the body); with the code always chosen, the first check fails; with the side button always
  // chosen, the second check fails.
  await t('Hide this side gives the focus to the side button, and View > My Page Side from the switch gives it to the code', async () => {
    const focusName = () => {
      const at = document.activeElement;
      return at ? at.id || at.className || at.tagName : 'nothing';
    };
    await flows.__openContent(content('Py', [['game.py', PY]]), 'new');
    await until(() => activeTab() && activeTab().name === 'game.py', 'game.py to open');
    sideClick();
    sideIsShown('game.py shown by hand');
    await until(() => !$('page-none').hidden, 'the no-page state', 3000);
    const hide = $('btn-hide-side');
    hide.focus();
    assert(document.activeElement === hide, `the focus is not on Hide this side but on ${focusName()}`);
    hide.click();
    sideIsHidden('Hide this side');
    assert(document.activeElement === button(), `after Hide this side the focus is on ${focusName()}, not the side button`);
    sideClick();
    sideIsShown('shown again');
    showRight('help');
    const seg = $('seg-help');
    seg.focus();
    assert(document.activeElement === seg, `the focus is not on the Help switch but on ${focusName()}`);
    runCommand('toggle-side');
    sideIsHidden('View > My Page Side');
    assert(view.contentDOM.contains(document.activeElement), `after View > My Page Side the focus is on ${focusName()}, not the code`);
    showRight('page');
  });
}
