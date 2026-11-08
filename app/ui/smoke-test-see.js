// Smoke steps for 0.2.0 "Seeing how it fits", with real pointer input in the app window.
// Uses from h: step, clickOn, clickAfter, lineWith, until, assert, eq, S, P, preview, $.
// Not used: key, wait, E.
// Starts from any state with no dialog open; opens its own Space club sample.
// Ends with that sample active, nothing folded, Point off and Show the Boxes off.

export const SEE_STEPS = 7;

function shown(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

export async function seeSteps(h) {
  const { step, clickOn, clickAfter, lineWith, until, assert, eq, S, P, preview, $ } = h;
  const view = () => S.ed.view;
  const code = () => view().state.doc.toString();
  const sel = () => view().state.selection.main;
  const active = () => S.tabs.find((t) => t.path === S.activePath) || null;
  const marks = () => [...view().dom.querySelectorAll('.cm-foldGutter .fold-mark')].filter(shown);
  const markFor = (line) => {
    if (!line) return null;
    const r = line.getBoundingClientRect();
    return marks().find((m) => {
      const b = m.getBoundingClientRect();
      const y = (b.top + b.bottom) / 2;
      return y >= r.top && y < r.bottom;
    }) || null;
  };
  const pill = () => [...view().dom.querySelectorAll('.fold-pill')].find(shown) || null;
  const dialog = () => {
    const root = $('dialog-root');
    return root && !root.hidden ? root.querySelector('.dlg') : null;
  };
  const byText = (text, scope) =>
    [...scope.querySelectorAll('button, a, [role="button"]')].find((b) => shown(b) && b.textContent.replace(/\s+/g, ' ').includes(text)) || null;
  const pressed = (id) => $(id).getAttribute('aria-pressed');
  const inspect = async () => {
    await until(() => P.phase === 'live' && P.out === null && !P.pendingHtml && P.pendingCss.size === 0, 'the page panel to finish');
    const res = await preview.__probe(null, null);
    return res && res.inspect ? res.inspect : null;
  };

  await step('Space club opens for the folding steps', async () => {
    await clickOn($('btn-new'), 'toolbar New');
    const box = await until(() => dialog(), 'the New dialog');
    await clickOn(byText('Space club website', box), '"Space club website"');
    await until(() => !dialog(), 'the dialog to close');
    await until(() => active() && active().name === 'my-page.html', 'my-page.html to be active');
    await until(() => lineWith('<ul>') && markFor(lineWith('<ul>')), 'a fold arrow on the <ul> line');
  });

  await step('A fold arrow folds a part', async () => {
    const mark = markFor(lineWith('<ul>'));
    eq(mark && mark.title, 'Fold this part', 'the arrow tooltip');
    await clickOn(mark, 'the fold arrow on the <ul> line');
    const p = await until(() => pill(), 'the fold pill');
    await until(() => p.textContent.replace(/\s+/g, ' ').trim() === '3 lines folded', `"3 lines folded", not "${p.textContent.trim()}"`);
    await until(() => !lineWith('Mars is red'), 'the list items to fold away');
    await until(() => markFor(lineWith('<ul>')) && markFor(lineWith('<ul>')).classList.contains('folded'), 'the arrow to show folded');
  });

  await step('The fold pill unfolds it', async () => {
    await clickOn(pill(), 'the fold pill');
    await until(() => !pill(), 'the pill to go');
    await until(() => lineWith('Mars is red'), 'the list items back');
    const mark = markFor(lineWith('<ul>'));
    assert(mark && !mark.classList.contains('folded'), 'the arrow still shows folded');
  });

  await step('Show the Boxes', async () => {
    await clickOn($('btn-boxes'), 'the Show the Boxes button');
    await until(() => pressed('btn-boxes') === 'true', 'the button to show pressed');
    await until(async () => {
      const v = await inspect();
      return v && v.boxes && v.boxCount > 0;
    }, 'boxes on the page');
  });

  await step('Show the Boxes off', async () => {
    await clickOn($('btn-boxes'), 'the Show the Boxes button again');
    await until(() => pressed('btn-boxes') === 'false', 'the button to show not pressed');
    await until(async () => {
      const v = await inspect();
      return v && v.boxes === false;
    }, 'no boxes on the page');
  });

  await step('Point picks a tag on the page', async () => {
    await clickOn($('btn-point'), 'the Point button');
    await until(() => pressed('btn-point') === 'true', 'Point on');
    const res = await preview.__pickAt('h1', 0);
    assert(res && res.picked, 'the page did not pick the heading');
    const at = code().indexOf('<h1');
    await until(() => sel().from === at + 1 && sel().to === at + 3, 'the h1 tag name selected');
    await until(() => pressed('btn-point') === 'false', 'Point off after the pick');
  });

  await step('A You are inside name selects its tag', async () => {
    await clickAfter('<h1>We', 'click in the heading');
    const names = () => [...$('inside-line').querySelectorAll('.inside-crumb')];
    await until(() => names().map((b) => b.textContent.trim()).join(' › ') === 'html › body › h1', 'html › body › h1 in the row');
    await clickOn(names().find((b) => b.textContent.trim() === 'body'), 'the body name');
    const text = code();
    await until(() => sel().from === text.indexOf('<body') && sel().to === text.indexOf('</body>') + 7, 'the whole body selected');
    await until(() => view().contentDOM.contains(document.activeElement), 'the focus back in the code');
  });
}
