// Dev only. Fake data and wiring for scripts/screens-preview.html, so each screen can be
// compared with its board. The hash picks the screen. Nothing in ui/ refers to this file.

import { installSprite } from '../ui/icons.js';
import { tabHtml, icon } from '../ui/views.js';
import * as dialogs from '../ui/dialogs.js';
import * as help from '../ui/help.js';

const PAGE_LINES = [
  '<!doctype html>', '<html>', '  <head>', '    <title>My Space Page</title>',
  '    <link rel="stylesheet" href="style.css">', '  </head>', '  <body>',
  '    <h1>Welcome to space!</h1>', '    <p>Space is very big and very dark.</p>', '',
  '    <h2>My top planets</h2>', '    <ul>', '      <li>Saturn has rings</li>',
  '      <li>Mars is red</li>', '      <li>Jupiter is huge</li>', '    </ul>', '',
  '    <p class="fact">', '      A day on Venus is longer than its year!', '    </p>', '  </body>', '</html>',
];

const SAMPLES = [
  { id: 'space-poster', title: 'Space poster', blurb: 'Style inside the page. 1 file.', style: 'inline' },
  { id: 'space-club', title: 'Space club website', blurb: 'Style in a separate file. 2 pages and 1 style file.', style: 'file' },
  { id: 'my-hobby', title: 'My hobby page', blurb: 'Style block inside the page. 1 file.', style: 'inline' },
  { id: 'pancakes', title: 'Pancake recipe', blurb: 'Style in a separate file. 1 page and 1 style file.', style: 'file' },
  { id: 'gallery', title: 'Photo gallery', blurb: 'Style in a separate file, with 3 pictures.', style: 'file' },
];

/** The packed template gallery, as the app gets it from Rust. */
async function templates() {
  globalThis.htmlLabGalleryBase = '../core/content/gallery/';
  const all = await (await fetch('../core/content/gallery/templates.json')).json();
  return all.map(({ files, name, ...summary }) => summary);
}

const KINDS = [
  { id: 'html', label: 'HTML page', blurb: 'A new page', defaultStem: 'planets', primaryExt: 'html', icon: 'html-file', colorToken: 'html', isPage: true },
  { id: 'css', label: 'CSS file', blurb: 'A place for style', defaultStem: 'more-style', primaryExt: 'css', icon: 'css-file', colorToken: 'css', isPage: false },
];

const FILE_HTML = (name) => ({ name, icon: 'html-file' });
const FILE_CSS = (name) => ({ name, icon: 'css-file' });

const HELP_GROUPS = [
  { id: 'start', title: 'Start here', line: 'What a web page is, and how to begin', tile: '#DCF1EF', color: '#0B6E69', icon: 'start-here' },
  { id: 'html', title: 'HTML', line: 'Tags that build your page', tile: '#FDE8DC', color: '#C2410C', icon: 'html-topics' },
  { id: 'ways', title: 'Three ways to add CSS', line: 'Make your page look the way you want', tile: '#E1EBFD', color: '#1D56C9', icon: 'add-css' },
  { id: 'css', title: 'CSS', line: 'Colors, fonts, spacing and layout', tile: '#E1EBFD', color: '#1D56C9', icon: 'css-topics' },
  { id: 'lookup', title: 'Look-up lists', line: 'All the tags, colors and shortcuts', tile: '#E4EAF2', color: '#4A5A73', icon: 'look-up-lists' },
];

function stubTopics(group, rows) {
  return rows.map(([title, short, keywords, kind]) => ({
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''),
    group,
    kind: kind || 'lesson',
    title,
    short,
    keywords,
  }));
}

const HELP_INDEX = {
  groups: HELP_GROUPS,
  topics: [
    ...stubTopics('start', [
      ['What is a web page?', 'Web page', 'tag element attribute html'],
      ['The bones of every page', 'Bones', 'skeleton doctype head body'],
      ['How to use HTML Lab', 'Using the app', 'app tabs save open'],
    ]),
    ...stubTopics('html', [
      ['Headings and paragraphs', 'Headings', 'h1 h2 p text title'],
      ['Bold, italic and line breaks', 'Bold and italic', 'strong em br comment'],
      ['Links to other pages', 'Links', 'a href link second page'],
      ['Pictures', 'Pictures', 'img image picture photo file path'],
      ['Lists', 'Lists', 'ul ol li list'],
      ['Tables', 'Tables', 'table tr td'],
      ['Page sections', 'Sections', 'header nav main footer div span'],
      ['Forms and buttons', 'Forms', 'form input button'],
      ['Special characters', 'Characters', 'entity symbol copyright'],
    ]),
    { id: 'inline-style', group: 'ways', kind: 'lesson', title: 'Inline style: change one tag', short: 'Inline style', keywords: 'style color css inline blue' },
    { id: 'style-block', group: 'ways', kind: 'lesson', title: 'Style block: change one page', short: 'Style block', keywords: 'style color css internal' },
    { id: 'style-file', group: 'ways', kind: 'lesson', title: 'Style file: change many pages', short: 'Style file', keywords: 'style.css link external color' },
    { id: 'which-style-wins', group: 'ways', kind: 'lesson', title: 'Which style wins?', short: 'Which style wins?', keywords: 'order css color win' },
    ...stubTopics('css', [
      ['Picking what to style', 'Picking', 'selector tag class id'],
      ['Colors', 'Colors', 'color hex rgb name'],
      ['Text and fonts', 'Text', 'font size family bold'],
      ['The box: margin, border, padding', 'The box', 'box space spacing'],
      ['Sizes', 'Sizes', 'width height px percent units'],
      ['Backgrounds', 'Backgrounds', 'background color image'],
      ['Flexbox: rows and columns', 'Flexbox', 'flex layout'],
      ['Grid: neat boxes', 'Grid', 'grid layout'],
      ['Hover and movement', 'Hover', 'hover'],
      ['Pages that fit a phone', 'Phone pages', 'phone mobile responsive media'],
    ]),
    { id: 'html-tags', group: 'lookup', kind: 'list', title: 'HTML tags', keywords: 'tag list' },
    { id: 'css-words', group: 'lookup', kind: 'list', title: 'CSS words', keywords: 'property list' },
    { id: 'color-names', group: 'lookup', kind: 'list', title: 'Color names', keywords: 'color list gold navy' },
    { id: 'keyboard-shortcuts', group: 'lookup', kind: 'list', title: 'Keyboard shortcuts', keywords: 'keys shortcut' },
  ],
};

const MDN = 'https://developer.mozilla.org/en-US/docs/Web';

const HELP_TOPICS = {
  'inline-style': {
    ...HELP_INDEX.topics.find((t) => t.id === 'inline-style'),
    explain: 'You can add style right inside a tag. It changes only that one tag.',
    code: [{ lang: 'html', text: '<p style="color: blue;">I am blue!</p>\n<p>I stay the same.</p>' }],
    legend: [{ word: 'color', tint: 'a', means: 'is what to change' }, { word: 'blue', tint: 'b', means: 'is the new look' }],
    result: { files: ['my-page.html'], height: 84 },
    insert: { lang: 'html', text: '<p style="color: blue;">I am blue!</p>' },
    turn: 'change blue to orange. Then try the word purple.',
    more: `${MDN}/HTML/Global_attributes/style`,
    pages: { 'my-page.html': '<p style="color: blue;">I am blue!</p><p>I stay the same.</p>' },
  },
  'style-block': {
    ...HELP_INDEX.topics.find((t) => t.id === 'style-block'),
    explain: 'Put a style block at the top of your page. It changes every tag of one kind, on this page only.',
    code: [{ lang: 'html', text: '<style>\n  h1 { color: green; }\n</style>\n<h1>First heading</h1>\n<h1>Second heading</h1>' }],
    legend: [{ word: 'h1', tint: 'a', means: 'is which tags to change' }, { word: 'color: green;', tint: 'b', means: 'is the new look' }],
    result: { files: ['my-page.html'], height: 130 },
    insert: { lang: 'html', text: '<style>\n  h1 { color: green; }\n</style>' },
    turn: 'change green to red. Both headings change at once!',
    more: `${MDN}/HTML/Element/style`,
    pages: { 'my-page.html': '<style>h1 { color: green; }</style><h1>First heading</h1><h1>Second heading</h1>' },
  },
  'style-file': {
    ...HELP_INDEX.topics.find((t) => t.id === 'style-file'),
    explain: 'Keep your style in its own file. Every page that links to the file gets the same look.',
    code: [
      { lang: 'html', text: '<!-- in home.html and planets.html -->\n<link rel="stylesheet" href="style.css">' },
      { lang: 'css', text: '/* in style.css */\nh1 { color: purple; }' },
    ],
    legend: [{ word: '"style.css"', tint: 'a', means: 'is the file to use' }, { word: 'color: purple;', tint: 'b', means: 'is the new look' }],
    result: { files: ['home.html', 'planets.html'], height: 72 },
    insert: { lang: 'html', text: '<link rel="stylesheet" href="style.css">' },
    turn: 'change purple to teal in style.css. Both pages change.',
    more: `${MDN}/HTML/Element/link`,
    pages: {
      'home.html': '<style>h1 { color: purple; }</style><h1>My home page</h1>',
      'planets.html': '<style>h1 { color: purple; }</style><h1>My planets page</h1>',
    },
  },
  'which-style-wins': {
    ...HELP_INDEX.topics.find((t) => t.id === 'which-style-wins'),
    explain: 'If two styles try to change the same tag, inline style wins. Between a style block and a style file, the one written last wins.',
    code: [{ lang: 'html', text: '<style>\n  p { color: green; }\n</style>\n<p style="color: red;">Who wins?</p>' }],
    legend: [{ word: 'green', tint: 'a', means: 'comes from the style block' }, { word: 'red', tint: 'b', means: 'comes from the tag, so it wins' }],
    result: { files: ['my-page.html'], height: 72 },
    insert: { lang: 'html', text: '<p style="color: red;">Who wins?</p>' },
    turn: 'delete the inline style. What color is the text now?',
    more: `${MDN}/CSS/Cascade`,
    pages: { 'my-page.html': '<style>p { color: green; }</style><p style="color: red;">Who wins?</p>' },
  },
  'html-tags': {
    ...HELP_INDEX.topics.find((t) => t.id === 'html-tags'),
    rows: [
      { code: '<h1>', means: 'A big heading', color: null },
      { code: '<p>', means: 'A paragraph of text', color: null },
      { code: '<a href="planets.html">', means: 'A link to another page', color: null },
      { code: '<img src="moon.png" alt="The moon">', means: 'A picture', color: null },
      { code: '<ul> and <li>', means: 'A list and its items', color: null },
    ],
  },
  'color-names': {
    ...HELP_INDEX.topics.find((t) => t.id === 'color-names'),
    rows: [
      { code: 'gold', means: 'A warm yellow', color: '#FFD700' },
      { code: 'navy', means: 'A very dark blue', color: '#000080' },
      { code: 'teal', means: 'A blue green', color: '#008080' },
      { code: 'white', means: 'White', color: '#FFFFFF' },
    ],
  },
};

// Same token rules as the CodePanel board. The real app uses highlightTree.
function htmlRuns(text) {
  const out = [];
  const re = /(<!--[\s\S]*?-->)|(<!doctype[^>]*>)|(<\/?[a-zA-Z][^\s>]*)|(\s+[a-zA-Z-]+=)("[^"]*")|(\/?>)|(\s*\n\s*)|([^<>]+)/g;
  let m;
  let inTag = false;
  let inStyle = false;
  while ((m = re.exec(text))) {
    if (m[1]) out.push({ text: m[1], cls: 'c-dim' });
    else if (m[2]) out.push({ text: m[2], cls: 'c-dim' });
    else if (m[3]) {
      out.push({ text: m[3], cls: 'c-tag' });
      inTag = true;
      inStyle = m[3] === '<style';
    } else if (m[4]) {
      out.push({ text: m[4], cls: 'c-attr' });
      out.push({ text: m[5], cls: 'c-str' });
    } else if (m[6]) {
      out.push({ text: m[6], cls: 'c-tag' });
      inTag = false;
    } else if (m[7]) out.push({ text: m[7], cls: 'c-text' });
    else if (inStyle && !inTag) {
      out.push(...cssRuns(m[8]));
      inStyle = false;
    } else out.push({ text: m[8], cls: 'c-text' });
  }
  return out;
}

function cssRuns(text) {
  const out = [];
  const re = /(\/\*[\s\S]*?\*\/)|([a-z-]+)(\s*:\s*)([^;]+)(;)|([^\s{}]+)|(\s+|[{}])/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) out.push({ text: m[1], cls: 'c-dim' });
    else if (m[2]) {
      out.push({ text: m[2], cls: 'c-prop' });
      out.push({ text: m[3], cls: 'c-dim' });
      out.push({ text: m[4], cls: 'c-val' });
      out.push({ text: m[5], cls: 'c-dim' });
    } else if (m[6]) out.push({ text: m[6], cls: 'c-tag' });
    else out.push({ text: m[7], cls: 'c-dim' });
  }
  return out;
}

function pageUrl(html) {
  return URL.createObjectURL(new Blob([`<!doctype html><html><body>${html}</body></html>`], { type: 'text/html' }));
}

const TRIED = new Set(['inline-style']);

/** A topic from the real Help file, for screens of topics the stub has no data for. */
async function realTopic(id) {
  const all = await (await fetch('../core/content/help.json')).json();
  return all.topics.find((t) => t.id === id) || null;
}

const helpDeps = {
  helpIndex: async () => HELP_INDEX,
  helpTopic: async (id) => HELP_TOPICS[id] || (await realTopic(id)) || {
    ...HELP_INDEX.topics.find((t) => t.id === id),
    explain: 'Not in the stub data.',
    code: [{ lang: 'html', text: '<p>Not in the stub data.</p>' }],
    legend: [],
    result: null,
    turn: 'pick one of the four drawn topics.',
  },
  highlight: async (code, lang) => (lang === 'css' ? cssRuns(code) : htmlRuns(code)),
  onTryIt: (id) => console.log('Try it', id),
  onAddToCode: (insert) => console.log('Add to my code', insert),
  canAdd: () => ({ ok: !location.hash.includes('noadd'), reason: 'Open a CSS file first.' }),
  isTried: (id) => TRIED.has(id),
  copyText: () => {},
  openExternal: (url) => console.log('Open', url),
  resultUrl: (id, file) => {
    const topic = HELP_TOPICS[id];
    return pageUrl(topic && topic.pages ? topic.pages[file] : '<p>Stub</p>');
  },
};

const FAKE_DELAY = 0;
const later = (value) => new Promise((resolve) => { setTimeout(() => resolve(value), FAKE_DELAY); });
const cleanFile = (raw) => later(raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').replace(/\.(html?|css)$/, ''));
const cleanProject = (raw) => later(raw.trim().replace(/[/:]/g, '-'));
const TAKEN_FILES = new Set(['my-page.html', 'style.css']);

function saveArgs(extra) {
  return {
    name: 'Space club',
    place: 'Documents',
    placePath: '/fake/Documents',
    files: [FILE_HTML('my-page.html'), FILE_HTML('planets.html'), FILE_CSS('style.css')],
    cleanName: cleanProject,
    choosePlace: async () => ({ path: '/fake/Desktop', name: 'Desktop' }),
    submit: async ({ name }) => (name === 'Space club' ? { error: 'folder_exists' } : null),
    ...extra,
  };
}

// ---------- The skeleton in each state ----------

function show(id, on) {
  document.getElementById(id).hidden = !on;
}

function setSave(enabled) {
  document.getElementById('btn-save').disabled = !enabled;
}

function fakeEditor(lines, activeLine, mistakeLine) {
  const host = document.getElementById('editor-host');
  const rows = lines.map((text, i) => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;min-height:var(--code-lh);${i === activeLine ? 'background:var(--active);' : ''}`;
    const num = document.createElement('span');
    num.textContent = String(i + 1);
    num.style.cssText = `flex:none;width:54px;box-sizing:border-box;padding-right:16px;text-align:right;color:${i === activeLine ? 'var(--ink)' : 'var(--num)'}`;
    const code = document.createElement('span');
    code.style.whiteSpace = 'pre';
    for (const run of htmlRuns(text)) {
      const piece = document.createElement('span');
      piece.className = run.cls;
      piece.textContent = run.text;
      code.append(piece);
    }
    if (i === mistakeLine) {
      code.lastChild.className += ' cm-mistake';
      code.lastChild.previousSibling.className += ' cm-mistake';
    }
    row.append(num, code);
    return row;
  });
  const wrap = document.createElement('div');
  wrap.style.paddingTop = '8px';
  wrap.append(...rows);
  host.replaceChildren(wrap);
  if (mistakeLine >= 0) {
    const hint = document.createElement('div');
    hint.innerHTML = '<div class="hint-box"><span class="hint-icon">'
      + '<svg width="28" height="28" aria-hidden="true"><use href="#i-oops"></use></svg></span><div class="hint-body">'
      + '<div class="hint-title">Oops, this tag never closes.</div>'
      + '<div class="hint-text">A closing tag needs a slash. Try <code>&lt;/h1&gt;</code> here.</div>'
      + '<div class="hint-links"><button class="hint-link" data-act="learn">Learn about tags</button>'
      + '<button class="hint-link" data-act="hide">Hide this hint</button></div></div></div>';
    rows[mistakeLine].after(hint.firstChild);
  }
}

function fakeTabs(active, dirtyName) {
  const tabs = [
    ['my-page.html', 'html-file', 'html'],
    ['planets.html', 'html-file', 'html'],
    ['style.css', 'css-file', 'css'],
  ];
  document.getElementById('tab-list').innerHTML = tabs.map(([name, kindIcon, kindColor]) => tabHtml({
    path: `/fake/Space club/${name}`,
    name,
    label: name,
    kind: kindColor,
    kindIcon,
    kindColor,
    dirty: name === dirtyName,
    active: name === active,
    tooltip: `/fake/Space club/${name}`,
  })).join('');
}

function setStatus(state, text) {
  document.getElementById('status-mark').dataset.state = state;
  const el = document.getElementById('status-text');
  el.textContent = text;
  el.title = text;
}

function setPageHeader(label, hint) {
  document.getElementById('page-label').textContent = label;
  const el = document.getElementById('page-hint');
  el.textContent = hint;
  el.title = hint;
}

const SPACE_PAGE = '<style>body{background:#0b1d3a;color:white;font-family:Verdana,sans-serif}h1{color:gold}'
  + '.fact{background:#1e3a6e;padding:12px;border-radius:8px}</style><h1>Welcome to space!</h1>'
  + '<p>Space is very big and very dark.</p><h2>My top planets</h2><ul><li>Saturn has rings</li>'
  + '<li>Mars is red</li><li>Jupiter is huge</li></ul><p class="fact">A day on Venus is longer than its year!</p>';

function showMainScreen({ mistake = false, practice = false, empty = false } = {}) {
  show('welcome-start', false);
  show('welcome-how', false);
  show('code-panel', true);
  show('page-panel', true);
  setSave(true);
  fakeTabs('my-page.html', mistake ? 'my-page.html' : null);
  if (mistake) {
    const broken = PAGE_LINES.slice();
    broken[7] = '    <h1>Welcome to space!<h1>';
    fakeEditor(broken, 7, 7);
    setStatus('amber', 'Not saved yet');
    setPageHeader('Showing my-page.html', 'The mistake changes your page too');
  } else {
    fakeEditor(PAGE_LINES, 8, -1);
    setStatus('check', 'Saved');
    setPageHeader('Showing my-page.html', 'Changes as you type');
  }
  document.getElementById('preview').src = pageUrl(SPACE_PAGE);
  if (empty) {
    show('page-empty', true);
    setPageHeader('Nothing to show yet', '');
    document.getElementById('w-phone').disabled = true;
    document.getElementById('w-tablet').disabled = true;
    document.getElementById('w-full').disabled = true;
    document.getElementById('btn-safari').disabled = true;
  }
  if (practice) {
    document.getElementById('preview').src = pageUrl('<p style="color: blue;">I am blue!</p><p>I stay the same.</p>');
    setStatus('bulb', 'Practice copy. Press Save to keep it.');
    setPageHeader('Showing the practice page', 'This is a practice copy');
    show('practice-bar', true);
    document.getElementById('practice-text').innerHTML = '<b>Your turn: </b>change <b style="color: blue">blue</b> to <b style="color: orange">orange</b> and watch this side change.';
  }
}

function showHelpScreen() {
  showMainScreen();
  document.getElementById('page-panel').classList.add('behind');
  show('help-panel', true);
  document.getElementById('seg-page').setAttribute('aria-pressed', 'false');
  document.getElementById('seg-help').setAttribute('aria-pressed', 'true');
  help.initHelp(document.getElementById('help-panel'), helpDeps);
}

function typeInSearch(q) {
  const input = document.querySelector('.search input');
  input.value = q;
  input.dispatchEvent(new Event('input'));
}

function log(promise) {
  promise.then((value) => {
    console.log('Dialog answer:', value);
    const out = document.createElement('div');
    out.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:200;padding:6px 10px;border-radius:8px;background:#14233C;color:#fff;font:13px Menlo,monospace';
    out.textContent = `Answer: ${JSON.stringify(value)}`;
    document.body.append(out);
  });
}

// ---------- Screens ----------

const SCREENS = {
  welcome: () => {},
  blank: () => show('blank-panels', true),
  drop: () => show('drop-overlay', true),
  main: () => showMainScreen(),
  mistake: () => showMainScreen({ mistake: true }),
  practice: () => showMainScreen({ practice: true }),
  empty: () => showMainScreen({ empty: true }),
  new: () => log(dialogs.showNewDialog({ samples: SAMPLES })),
  'new-samples': () => log(dialogs.showNewDialog({ samples: SAMPLES, focusSamples: true })),
  'new-templates': async () => log(dialogs.showNewDialog({ samples: SAMPLES, templates: await templates(), focusTemplates: true })),
  templates: async () => {
    log(dialogs.showTemplateDialog({ templates: await templates() }));
  },
  save: () => {
    showMainScreen();
    log(dialogs.showSaveDialog(saveArgs({ submit: async () => null })));
  },
  'save-taken': () => {
    showMainScreen();
    log(dialogs.showSaveDialog(saveArgs()));
    document.querySelector('.dlg [data-ok]').click();
  },
  'save-empty': () => {
    showMainScreen();
    log(dialogs.showSaveDialog(saveArgs({ name: '' })));
  },
  'save-many': () => {
    showMainScreen();
    const files = [];
    for (let i = 1; i <= 12; i += 1) files.push(FILE_HTML(`page-${i}.html`));
    files.push(FILE_CSS('style.css'), { name: 'moon.png', icon: 'picture' });
    log(dialogs.showSaveDialog(saveArgs({ files })));
  },
  'save-copy': () => {
    showMainScreen();
    log(dialogs.showSaveDialog(saveArgs({ ...dialogs.SAVE_COPY_TEXT, name: 'Space club copy', submit: async () => null })));
  },
  addfile: () => {
    showMainScreen();
    log(dialogs.showAddFileDialog({
      kinds: KINDS,
      kindDefault: 'html',
      cssName: 'style.css',
      pageName: 'my-page.html',
      cleanName: cleanFile,
      nameFree: async (file) => !TAKEN_FILES.has(file),
    }));
  },
  'addfile-css': () => {
    showMainScreen();
    log(dialogs.showAddFileDialog({
      kinds: KINDS,
      kindDefault: 'css',
      cssName: 'style.css',
      pageName: 'my-page.html',
      cleanName: cleanFile,
      nameFree: async (file) => !TAKEN_FILES.has(file),
    }));
  },
  'addfile-taken': () => {
    showMainScreen();
    log(dialogs.showAddFileDialog({
      kinds: KINDS,
      kindDefault: 'html',
      cssName: null,
      pageName: null,
      cleanName: cleanFile,
      nameFree: async (file) => file !== 'planets.html',
    }));
  },
  open: () => log(dialogs.showOpenAsk({
    pickedName: 'my-page.html',
    folderName: 'Space club',
    files: [{ ...FILE_HTML('my-page.html'), picked: true }, FILE_HTML('planets.html'), FILE_CSS('style.css')],
  })),
  'open-many': () => {
    const files = [{ ...FILE_HTML('my-page.html'), picked: true }];
    for (let i = 1; i <= 19; i += 1) files.push(FILE_HTML(`page-${i}.html`));
    log(dialogs.showOpenAsk({ pickedName: 'my-page.html', folderName: 'Space club', files }));
  },
  'linked-one': () => log(dialogs.showLinkedCssAsk({ pageName: 'my-page.html', files: [FILE_CSS('style.css')] })),
  'linked-many': () => log(dialogs.showLinkedCssAsk({ pageName: 'my-page.html', files: [FILE_CSS('style.css'), FILE_CSS('more-style.css')] })),
  saveask: () => {
    showMainScreen();
    log(dialogs.showSaveAsk({ fileName: 'style.css' }));
  },
  'saveask-whole': () => {
    showMainScreen();
    log(dialogs.showSaveAsk({ fileName: 'style.css', wholeFile: true }));
  },
  'saveask-several': () => {
    showMainScreen();
    log(dialogs.showSaveAsk({ count: 3 }));
  },
  takeout: () => {
    showMainScreen();
    log(dialogs.showTakeOutAsk({ fileName: 'style.css' }));
  },
  message: () => {
    showMainScreen();
    log(dialogs.showMessage({
      title: 'Some of your work was not saved.',
      text: 'style.css could not be saved. Your work is still here in HTML Lab.',
      buttons: [{ id: 'keep', label: 'Keep working' }, { id: 'retry', label: 'Try again', primary: true }],
    }));
  },
  'help-home': async () => {
    showHelpScreen();
    await help.showHome();
  },
  'help-group': async () => {
    showHelpScreen();
    await help.showGroup('ways');
  },
  'help-search': async () => {
    showHelpScreen();
    await help.showHome();
    typeInSearch('color');
  },
  'help-none': async () => {
    showHelpScreen();
    await help.showHome();
    typeInSearch('zebra');
  },
  'help-word': async () => {
    showHelpScreen();
    await help.showWord('h1');
  },
  'help-how-html': async () => {
    showHelpScreen();
    await help.showTopic('how-html');
  },
  'help-how-css': async () => {
    showHelpScreen();
    await help.showTopic('how-css');
  },
  'help-inline': async () => {
    showHelpScreen();
    await help.showTopic('inline-style');
  },
  'help-block': async () => {
    showHelpScreen();
    await help.showTopic('style-block');
  },
  'help-file': async () => {
    showHelpScreen();
    await help.showTopic('style-file');
  },
  'help-wins': async () => {
    showHelpScreen();
    await help.showTopic('which-style-wins');
  },
  'help-noadd': async () => {
    showHelpScreen();
    await help.showTopic('inline-style');
  },
  'help-list': async () => {
    showHelpScreen();
    await help.showTopic('html-tags');
  },
  'help-colors': async () => {
    showHelpScreen();
    await help.showTopic('color-names');
  },
};

function listScreens() {
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
  document.body.innerHTML = '<div style="padding:24px"><h1 style="font-size:24px;margin-bottom:12px">HTML Lab screens, dev only</h1>'
    + Object.keys(SCREENS).map((name) => `<div style="line-height:26px"><a href="#${name}">${name}</a></div>`).join('')
    + '</div>';
}

async function boot() {
  const name = location.hash.slice(1);
  window.addEventListener('hashchange', () => location.reload());
  if (!SCREENS[name]) {
    listScreens();
    return;
  }
  const page = await (await fetch('../ui/index.html')).text();
  const skeleton = new DOMParser().parseFromString(page, 'text/html');
  document.body.innerHTML = skeleton.body.innerHTML;
  installSprite();
  await SCREENS[name]();
}

boot();
