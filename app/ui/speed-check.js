import { invoke } from './api.js';
import { S, activeTab, tabsOf, projectOf } from './state.js';
import { switchTo } from './tabs.js';
import { cancelDialog, showMessage, showTemplateDialog } from './dialogs.js';
import { showTopic, showHome } from './help.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
const painted = async () => {
  await nextFrame();
  return nextFrame();
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scenario = { errors: [], step: 'start' };
function problem(text) {
  const line = `${scenario.step}: ${text}`;
  if (!scenario.errors.includes(line)) scenario.errors.push(line);
}

async function rest(preview) {
  await waitForLive(preview);
  await doneWaiter(preview);
  await wait(300);
}

function stats(list) {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return null;
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    n: s.length,
    median: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
  };
}

const longPage = () => {
  let body = '';
  for (let i = 0; i < 380; i++) body += `    <p>Paragraph number ${i} about planets and stars.</p>\n`;
  return `<!doctype html>\n<html>\n  <head>\n    <title>Long</title>\n  </head>\n  <body>\n    <h1>Long page</h1>\n${body}  </body>\n</html>\n`;
};

function doneWaiter(preview) {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (preview.state.out === null && !preview.state.pendingHtml && !preview.state.pendingCss.size) resolve(true);
      else if (performance.now() - started > 3000) {
        problem('the preview did not finish within 3 s');
        resolve(false);
      } else setTimeout(check, 1);
    };
    check();
  });
}

function typeAt(view, needle, text) {
  const doc = view.state.doc.toString();
  const at = doc.indexOf(needle);
  if (at < 0) problem(`"${needle}" is not in the code, so the keys went to its start`);
  const from = at < 0 ? 0 : at + needle.length;
  view.dispatch({ changes: { from, insert: text } });
}

async function letterLoop(view, preview, needle, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    typeAt(view, needle, String(i % 10));
    out.push((await painted()) - start);
    await doneWaiter(preview);
    await wait(Math.max(0, 90 - (performance.now() - start)));
  }
  return out;
}

async function typingLoop(view, preview, needle, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    typeAt(view, needle, String(i % 10));
    out.push((await painted()) - start);
    await wait(Math.max(0, 90 - (performance.now() - start)));
  }
  await doneWaiter(preview);
  return out;
}

async function burstLoop(view, preview, needle, count) {
  const out = [];
  let last = await nextFrame();
  for (let i = 0; i < count * 2; i++) {
    if (i % 2 === 0) typeAt(view, needle, String((i / 2) % 10));
    const now = await nextFrame();
    out.push(now - last);
    last = now;
  }
  await doneWaiter(preview);
  return out;
}

const hugePage = () => {
  let body = '';
  for (let i = 0; i < 4990; i++) body += `    <p>Line ${i}: a long page to read, with <b>some</b> words in it.</p>\n`;
  return `<!doctype html>\n<html>\n  <head>\n    <title>Huge</title>\n  </head>\n  <body>\n    <h1>Huge page</h1>\n${body}  </body>\n</html>\n`;
};

async function keyLoop(view, preview, needle, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    typeAt(view, needle, String(i % 10));
    await doneWaiter(preview);
    const end = await painted();
    out.push(end - start);
    await wait(Math.max(0, 90 - (performance.now() - start)));
  }
  return out;
}

async function frameLoop(frames, step) {
  const out = [];
  let last = await nextFrame();
  for (let i = 0; i < frames; i++) {
    step(i);
    const now = await nextFrame();
    out.push(now - last);
    last = now;
  }
  return out;
}

const framesOver = (list, ms) => (100 * list.filter((v) => v > ms).length) / list.length;

export async function run({ whenEditor, showRight, flows, preview, divider }) {
  const report = {
    createdAt: new Date().toISOString(),
    speedStart: S.flags.speedStart,
    ua: navigator.userAgent,
    features: {},
    rows: {},
    errors: [],
  };
  const rows = report.rows;
  scenario.errors = report.errors;
  const step = (name) => {
    scenario.step = name;
  };
  const write = async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const info = await invoke('write_log_file', { name: `speed-${stamp}.json`, text: JSON.stringify(report, null, 2) });
    await invoke('write_log_file', { name: 'speed-latest.json', text: JSON.stringify(report, null, 2) });
    return info;
  };

  try {
    await whenEditor();
    const view = new Proxy({}, {
      get(_, key) {
        const real = S.ed.view;
        const value = real[key];
        return typeof value === 'function' ? value.bind(real) : value;
      },
    });
    const f = (s) => (window.CSS && CSS.supports ? CSS.supports(s) : false);
    report.features = {
      flexbox: f('display: flex'),
      grid: f('display: grid'),
      has: f('selector(:has(a))'),
      dvh: f('height: 1dvh'),
      nesting: f('selector(& a)'),
      colorMix: f('color: color-mix(in srgb, red, blue)'),
      container: f('container-type: inline-size'),
      subgrid: f('grid-template-columns: subgrid'),
      textWrapBalance: f('text-wrap: balance'),
    };

    step('launch');
    if (S.flags.speedStart) {
      rows.launchToFirstPaint = Math.round(
        performance.timeOrigin + (window.__htmllabFirstPaint || 0) - S.flags.speedStart,
      );
      const reopened = S.tabs.length;
      rows.reopenedTabs = reopened;
      const stored = S.prefs.session && S.prefs.session.tabs ? S.prefs.session.tabs.length : 0;
      if (reopened < stored) problem(`${reopened} of the ${stored} last tabs reopened`);
    }

    step('clean start');
    for (const tab of [...S.tabs]) {
      tab.savedDoc = tab.state.doc;
    }
    while (S.tabs.length) await flows.closeTabFlow(S.tabs[0].path);

    step('open Space club');
    const content = await invoke('open_sample', { id: 'space-club' });
    await flows.__openContent(content, 'sample');
    await waitForLive(preview);
    const project = projectOf(activeTab());
    const pages = tabsOf(project);
    const page = pages.find((t) => t.name === 'my-page.html');
    const css = pages.find((t) => t.name === 'style.css');
    const planets = pages.find((t) => t.name === 'planets.html');

    switchTo(page.path);
    await waitForLive(preview);
    step('keyHtml');
    rows.keyHtml = stats(await keyLoop(view, preview, 'Space is very big', 60));
    await rest(preview);
    step('keyLetter');
    rows.keyLetter = stats(await letterLoop(view, preview, 'Space is very big', 60));
    step('keyBurst');
    const burst = await burstLoop(view, preview, 'Space is very big', 40);
    rows.keyBurst = { frames: burst.length, percentOver20: +framesOver(burst, 20).toFixed(2), ...stats(burst) };

    step('keyCss');
    switchTo(css.path);
    await painted();
    rows.keyCss = stats(await keyLoop(view, preview, 'padding: 1', 60));

    step('tabSwitch');
    S.steps = [];
    const inside = [];
    const sync = [];
    const done = [];
    for (let i = 0; i < 40; i++) {
      const target = i % 2 ? page : planets;
      const start = performance.now();
      switchTo(target.path);
      sync.push(performance.now() - start);
      await doneWaiter(preview);
      done.push(performance.now() - start);
      inside.push((await painted()) - start);
    }
    rows.tabSwitch = stats(inside);
    report.tabSwitchParts = { sync: stats(sync), done: stats(done) };
    const steps = S.steps;
    S.steps = null;
    report.tabSwitchSteps = {};
    ['editorShow', 'focus', 'stripAndStatus', 'preview', 'menu'].forEach((name, i) => {
      report.tabSwitchSteps[name] = stats(steps.map((row) => row[i]));
    });

    step('keyLong');
    const long = {
      id: 'long',
      name: 'Long page',
      files: [{ name: 'long.html', code: longPage(), hidden: false }],
    };
    await flows.__openContent(long, 'sample');
    await waitForLive(preview);
    const longTab = activeTab();
    rows.keyLong = stats(await keyLoop(view, preview, 'Long page</h1>', 60));

    step('tabSwitchOtherProject');
    const across = [];
    for (let i = 0; i < 20; i++) {
      const target = i % 2 ? longTab : page;
      const start = performance.now();
      switchTo(target.path);
      await waitForLive(preview);
      across.push((await painted()) - start);
    }
    rows.tabSwitchOtherProject = stats(across);
    switchTo(page.path);
    await waitForLive(preview);

    step('dialogOpen');
    const dialogs = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const closing = showMessage({
        title: 'Speed check',
        text: 'A dialog with scrim and shadow.',
        buttons: [{ id: 'ok', label: 'OK', primary: true }],
      });
      dialogs.push((await painted()) - start);
      cancelDialog();
      await closing;
      await nextFrame();
    }
    rows.dialogOpen = stats(dialogs);

    step('helpSwitch');
    const helps = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      showRight(i % 2 ? 'page' : 'help');
      helps.push((await painted()) - start);
    }
    rows.helpSwitch = stats(helps);

    step('helpTopicOpen');
    showRight('help');
    const index = await invoke('help_index');
    const topics = index.topics.filter((t) => t.kind === 'lesson');
    const opens = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await showTopic(topics[i % topics.length].id);
      opens.push((await painted()) - start);
    }
    rows.helpTopicOpen = stats(opens);

    step('helpSearchKey');
    showHome();
    await painted();
    await wait(300);
    const search = document.querySelector('#help-panel input');
    const word = 'background color margin padding border flex ';
    const keys = [];
    if (!search) problem('Help home has no search field');
    if (search) {
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        search.value = word.slice(0, (i % word.length) + 1);
        search.dispatchEvent(new Event('input', { bubbles: true }));
        keys.push((await painted()) - start);
      }
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    rows.helpSearchKey = stats(keys);
    showRight('page');
    await painted();
    await rest(preview);

    step('galleryOpen and galleryHover');
    const templates = (await invoke('samples')).filter((t) => t.group === 'template');
    if (templates.length < 6) problem(`only ${templates.length} templates, the step needs 6`);
    const bigShows = (i) => {
      const big = document.querySelector('.tpl-big');
      return big && big.dataset.index === String(i) && big.complete && big.naturalWidth > 0;
    };
    const until = async (ok, what) => {
      const started = performance.now();
      while (!ok() && performance.now() - started < 3000) await new Promise((resolve) => setTimeout(resolve, 1));
      if (!ok()) problem(`${what} did not show within 3 s`);
    };
    const galleryOpens = [];
    const galleryHovers = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const closing = showTemplateDialog({ templates });
      await until(() => document.querySelector('.tpl-big[data-index]'), 'the gallery preview');
      galleryOpens.push((await painted()) - start);
      if (i === 0) {
        for (let pass = 0; pass < 2; pass++) {
          const rows = [...document.querySelectorAll('.tpl-row')];
          if (rows.length !== templates.length) problem(`the gallery shows ${rows.length} rows for ${templates.length} templates`);
          for (const [at, row] of rows.entries()) {
            row.scrollIntoView({ block: 'nearest' });
            await painted();
            const hover = performance.now();
            row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await until(() => bigShows(at), `the preview of row ${at + 1}`);
            galleryHovers.push((await painted()) - hover);
          }
        }
      }
      cancelDialog();
      await closing;
      await nextFrame();
    }
    rows.galleryOpen = stats(galleryOpens);
    rows.galleryHover = stats(galleryHovers);
    step('templateOpen');
    const templateOpens = [];
    for (const tpl of templates.slice(0, 6)) {
      await rest(preview);
      const start = performance.now();
      const opened = await flows.__openContent(await invoke('open_sample', { id: tpl.id }), 'sample');
      await waitForLive(preview);
      templateOpens.push((await painted()) - start);
      if (preview.state.projectId !== opened.id) problem(`the page panel did not show ${tpl.id}`);
      flows.__closeProjectNow(opened);
    }
    rows.templateOpen = stats(templateOpens);
    if (!tabsOf(project).length || !S.tabs.includes(longTab)) throw new Error('the template step closed the Space club or the long page');
    switchTo(page.path);
    await waitForLive(preview);
    await rest(preview);

    step('dividerDrag and dividerDrop');
    const left = document.getElementById('left');
    const box = document.getElementById('main').getBoundingClientRect();
    const room = box.width - 700;
    const xAt = (i) => box.left + 330 + Math.abs(((i * 4) % (room * 2)) - room);
    divider.start();
    const drag = await frameLoop(180, (i) => divider.move(xAt(i)));
    divider.end();
    rows.dividerDrag = { frames: drag.length, percentOver20: +framesOver(drag, 20).toFixed(2), ...stats(drag) };
    report.dragFrames = drag.map((v) => Math.round(v));
    await rest(preview);
    const drops = [];
    for (let i = 0; i < 10; i++) {
      divider.start();
      divider.move(xAt(i * 37));
      const start = performance.now();
      divider.end();
      drops.push((await painted()) - start);
      await wait(120);
    }
    rows.dividerDrop = stats(drops);
    left.style.flex = '';
    await rest(preview);

    step('previewScroll');
    switchTo(longTab.path);
    await waitForLive(preview);
    const frameWin = document.getElementById('preview').contentWindow;
    const scroll = await frameLoop(120, (i) => frameWin.postMessage({ t: 'scroll', y: i * 12 }, '*'));
    rows.previewScroll = { frames: scroll.length, percentOver20: +framesOver(scroll, 20).toFixed(2), ...stats(scroll) };

    step('keyHuge');
    await flows.__openContent({ id: 'huge', name: 'Huge page', files: [{ name: 'huge.html', code: hugePage(), hidden: false }] }, 'sample');
    await waitForLive(preview);
    const hugeTab = activeTab();
    await rest(preview);
    rows.keyHuge = stats(await keyLoop(view, preview, 'Huge page</h1>', 40));
    step('keyHugeLetter');
    rows.keyHugeLetter = stats(await typingLoop(view, preview, 'Huge page</h1>', 40));
    step('codeScrollHuge');
    const codeScroll = await frameLoop(150, () => { view.scrollDOM.scrollTop += 60; });
    rows.codeScrollHuge = { frames: codeScroll.length, percentOver20: +framesOver(codeScroll, 20).toFixed(2), ...stats(codeScroll) };
    hugeTab.savedDoc = hugeTab.state.doc;
    await flows.closeTabFlow(hugeTab.path);

    step('save3Files');
    switchTo(page.path);
    await waitForLive(preview);
    const parent = await invoke('test_temp_folder', { name: 'save' });
    const firstSaved = await flows.__firstSaveTo(project, parent, 'Speed club');
    report.savedTo = firstSaved;
    const saves = [];
    for (let i = 0; i < 10; i++) {
      for (const tab of tabsOf(project)) {
        const edit = { changes: { from: 0, insert: `<!-- ${i} -->\n` } };
        if (tab.path === S.activePath) view.dispatch(edit);
        else tab.state = tab.state.update(edit).state;
      }
      const start = performance.now();
      const saved = await flows.saveFlow();
      saves.push((await painted()) - start);
      if (!saved) problem(`Save ${i + 1} did not write the files`);
      await wait(30);
    }
    rows.save3Files = stats(saves);

    const opens3 = [];
    const paths = tabsOf(project).map((t) => t.path);
    if (paths.length < 3) throw new Error(`the Open step found ${paths.length} files, wanted at least 3`);
    for (let i = 0; i < 10; i++) {
      step(`open3Files, open ${i + 1}`);
      for (const tab of tabsOf(projectOf(tabByPathSafe(paths[0])))) tab.savedDoc = tab.state.doc;
      for (const path of paths) await flows.closeTabFlow(path);
      if (paths.some(tabByPathSafe)) problem('a tab did not close before the Open');
      const start = performance.now();
      await flows.__openList(paths);
      await waitForLive(preview);
      opens3.push((await painted()) - start);
      if (!paths.every(tabByPathSafe) || !paths.includes(preview.state.showing)) problem('the files did not open and show');
    }
    rows.open3Files = stats(opens3);

    const nav = performance.getEntriesByType('navigation')[0];
    report.boot = {
      ...window.__bootMarks,
      firstPaint: window.__htmllabFirstPaint,
      nav: nav ? { responseEnd: Math.round(nav.responseEnd), domInteractive: Math.round(nav.domInteractive), domContentLoaded: Math.round(nav.domContentLoadedEventEnd) } : null,
      resources: performance.getEntriesByType('resource').map((r) => `${r.name.split('/').pop()} ${Math.round(r.startTime)}+${Math.round(r.duration)}`),
    };
    report.lostLoads = preview.state.lostLoads;
    report.lostTraces = preview.state.lostTraces;
    if (preview.state.lostLoads) report.rustTrace = await invoke('test_preview_trace');
    report.finishedAt = new Date().toISOString();
    report.idleStartsAt = Date.now();
    await write();
  } catch (error) {
    report.errors.push(String(error && error.stack ? error.stack : error));
    await write();
  }

  await wait(30000);
  invoke('test_quit');
}

function tabByPathSafe(path) {
  return S.tabs.find((t) => t.path === path);
}

async function waitForLive(preview) {
  const started = performance.now();
  while (performance.now() - started < 5000) {
    if (preview.state.phase === 'live' && preview.state.out === null) return true;
    await wait(1);
  }
  problem('the page did not go live within 5 s');
  return false;
}
