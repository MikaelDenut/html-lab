import { previewBase } from './platform.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
const KEEP_TOPICS = 8;

const state = {
  container: null,
  deps: null,
  indexWait: null,
  groups: [],
  topics: [],
  topicById: new Map(),
  view: 'home',
  topicId: null,
  openGroup: 'start',
  query: '',
  home: null,
  cache: new Map(),
  seq: 0,
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const name of Object.keys(attrs)) {
      const value = attrs[name];
      if (value === false || value === null || value === undefined) continue;
      if (name === 'class') el.className = value;
      else if (name === 'style') el.style.cssText = value;
      else el.setAttribute(name, value === true ? '' : value);
    }
  }
  for (const kid of kids) {
    if (kid !== null && kid !== undefined) el.append(kid);
  }
  return el;
}

function svg(id, cls) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('class', `icon ${cls}`);
  el.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${id}`);
  el.append(use);
  return el;
}

function setIcon(el, id) {
  el.firstChild.setAttribute('href', `#i-${id}`);
}

function button(cls, onClick, ...kids) {
  const el = h('button', { class: cls, type: 'button' }, ...kids);
  el.addEventListener('click', onClick);
  return el;
}

const TILE_TOKENS = {
  '#dcf1ef': 'tile-brand',
  '#fde8dc': 'tile-html',
  '#e1ebfd': 'tile-css',
  '#e4eaf2': 'tile-gray',
  '#fef3c7': 'tile-amber',
};
const COLOR_TOKENS = {
  '#0b6e69': 'brand',
  '#c2410c': 'html',
  '#1d56c9': 'css',
  '#4a5a73': 'ink2',
  '#b45309': 'amber',
};

function cssColor(value, table) {
  if (!value) return 'transparent';
  const token = table[value.toLowerCase()];
  if (token) return `var(--${token})`;
  return value[0] === '#' ? value : `var(--${value})`;
}

function ensureIndex() {
  if (!state.indexWait) {
    state.indexWait = state.deps.helpIndex().then((index) => {
      state.groups = index.groups;
      state.topics = index.topics.map((t) => {
        const hay = `${t.title} ${t.keywords || ''}`.toLowerCase();
        return {
          ...t,
          hay,
          words: new Set(hay.split(/[^a-z0-9-]+/)),
          keywordSet: new Set((t.keywords || '').toLowerCase().split(/[^a-z0-9-]+/)),
        };
      });
      state.topicById = new Map(state.topics.map((t) => [t.id, t]));
    }).catch((err) => {
      state.indexWait = null;
      throw err;
    });
  }
  return state.indexWait;
}

function topicsOf(groupId) {
  return state.topics.filter((t) => t.group === groupId);
}

function groupOf(groupId) {
  return state.groups.find((g) => g.id === groupId) || null;
}

function activeView() {
  if (state.view === 'topic') return state.cache.get(state.topicId) || null;
  return state.home;
}

function present(view) {
  const before = activeView();
  if (before && before !== view) before.el.hidden = true;
  if (before && before !== view && before.onLeave) before.onLeave();
  if (!view.el.isConnected) state.container.append(view.el);
  view.el.hidden = false;
  if (view.onShow) view.onShow();
  view.scroller.scrollTop = view.scroll;
}

function trackScroll(view) {
  view.scroller.addEventListener('scroll', () => {
    view.scroll = view.scroller.scrollTop;
  }, { passive: true });
}

function countText(n) {
  return n === 1 ? '1 topic' : `${n} topics`;
}

function triedMark() {
  return h('span', { class: 'help-tried' }, svg('check-bold', 's16'), 'Tried');
}

function topicRow(topic) {
  return button('help-row', () => showTopic(topic.id),
    h('span', { class: 'help-row-title' }, topic.title),
    state.deps.isTried(topic.id) ? triedMark() : null,
    svg('caret-right-bold', 's14 tk-ink2'));
}

function resultList(view) {
  if (view.order) return view.order;
  const ordered = [...state.topics.filter((t) => t.kind === 'recipe'), ...state.topics.filter((t) => t.kind !== 'recipe')];
  view.order = ordered.map((topic) => ({ topic, row: makeResultRow(topic), shown: false }));
  for (const item of view.order) item.row.hidden = true;
  view.resultLine = h('div', { class: 'help-result-line' });
  view.resultEmpty = h('div', { class: 'help-nothing', hidden: true }, 'Try a word like ',
    h('b', null, 'color'), ', ', h('b', null, 'link'), ' or ', h('b', null, 'picture'), '.');
  view.results.replaceChildren(view.resultLine, ...view.order.map((item) => item.row), view.resultEmpty);
  return view.order;
}

function makeResultRow(topic) {
  const group = groupOf(topic.group);
  return button('help-row result', () => showTopic(topic.id),
    h('span', { class: 'help-row-title' }, topic.title),
    h('span', { class: 'help-row-group' }, group ? group.title : ''),
    svg('caret-right-bold', 's14 tk-ink2'));
}

function groupRows(groupId) {
  const rows = [];
  let section = null;
  for (const topic of topicsOf(groupId)) {
    if (topic.section && topic.section !== section) {
      section = topic.section;
      rows.push(h('div', { class: 'help-subhead' }, section));
    }
    rows.push(topicRow(topic));
  }
  return rows;
}

function paintGroups() {
  for (const part of state.home.sections) {
    const open = part.group.id === state.openGroup;
    part.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    setIcon(part.caret, open ? 'caret-down-bold' : 'caret-right-bold');
    part.rows.hidden = !open;
    if (open) part.rows.replaceChildren(...groupRows(part.group.id));
  }
}

function paintSearch() {
  const { browse, results, input } = state.home;
  if (input.value !== state.query) input.value = state.query;
  const shown = state.query.trim();
  const q = shown.toLowerCase();
  browse.hidden = Boolean(q);
  results.hidden = !q;
  if (!q) return;
  let count = 0;
  for (const item of resultList(state.home)) {
    const match = item.topic.hay.includes(q);
    if (match) count++;
    if (match !== item.shown) {
      item.shown = match;
      item.row.hidden = !match;
    }
  }
  let line = `${count} topics found`;
  if (count === 1) line = '1 topic found';
  if (count === 0) line = `No topics found for "${shown}"`;
  if (state.home.resultLine.textContent !== line) state.home.resultLine.textContent = line;
  state.home.resultEmpty.hidden = count > 0;
}

function buildHome() {
  const input = h('input', {
    type: 'text',
    'aria-label': 'Search help',
    placeholder: 'Search help, like color or link',
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
  });
  input.addEventListener('input', () => {
    state.query = input.value;
    paintSearch();
  });

  const sections = state.groups.map((group) => {
    const caret = svg('caret-right-bold', 's16 tk-ink2');
    const tile = h('span', {
      class: 'help-tile',
      'aria-hidden': 'true',
      style: `background:${cssColor(group.tile, TILE_TOKENS)};color:${cssColor(group.color, COLOR_TOKENS)}`,
    }, svg(group.icon, 's28'));
    const toggle = button('help-group', () => {
      state.openGroup = state.openGroup === group.id ? null : group.id;
      paintGroups();
    }, tile,
    h('span', { class: 'help-group-text' },
      h('span', { class: 'help-group-title' }, group.title),
      h('span', { class: 'help-group-line' }, group.line)),
    h('span', { class: 'help-group-count' }, countText(topicsOf(group.id).length)),
    caret);
    toggle.setAttribute('aria-expanded', 'false');
    const rows = h('div', { class: 'help-topics', hidden: true });
    return { group, toggle, caret, rows, el: h('div', null, toggle, rows) };
  });

  const browse = h('div', null, ...sections.map((s) => s.el));
  const results = h('div', { hidden: true });
  const scroller = h('div', { class: 'help-scroll' }, browse, results);
  const el = h('div', { class: 'help-view' },
    h('div', { class: 'help-search-bar' },
      h('label', { class: 'search' }, svg('magnifying-glass-bold', 's20'), input)),
    scroller);

  const view = { el, scroller, scroll: 0, input, browse, results, sections };
  trackScroll(view);
  return view;
}

function showHomeNow() {
  if (!state.home) state.home = buildHome();
  const view = state.home;
  paintGroups();
  paintSearch();
  present(view);
  state.view = 'home';
  state.topicId = null;
}

function plainRuns(text) {
  return [{ text, cls: '' }];
}

async function runsFor(block) {
  try {
    const runs = await state.deps.highlight(block.text, block.lang);
    return runs && runs.length ? runs : plainRuns(block.text);
  } catch {
    return plainRuns(block.text);
  }
}

function isWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9-]/.test(ch);
}

function findWord(text, word, taken) {
  let loose = -1;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(word, from);
    if (at === -1) break;
    const end = at + word.length;
    const free = !taken.some((r) => at < r.end && end > r.start);
    if (free) {
      const startOk = !isWordChar(word[0]) || !isWordChar(text[at - 1]);
      const endOk = !isWordChar(word[word.length - 1]) || !isWordChar(text[end]);
      if (startOk && endOk) return at;
      if (loose === -1) loose = at;
    }
    from = at + 1;
  }
  return loose;
}

function legendRanges(texts, legend) {
  const perBlock = texts.map(() => []);
  legend.forEach((item, index) => {
    for (let b = 0; b < texts.length; b += 1) {
      const at = findWord(texts[b], item.word, perBlock[b]);
      if (at !== -1) {
        perBlock[b].push({ start: at, end: at + item.word.length, tint: item.tint, index, el: null });
        return;
      }
    }
  });
  for (const ranges of perBlock) ranges.sort((x, y) => x.start - y.start);
  return perBlock;
}

function runNode(text, cls) {
  return cls ? h('span', { class: cls }, text) : document.createTextNode(text);
}

function blockNode(runs, ranges) {
  const root = h('div', { class: 'code-block' });
  let pos = 0;
  let r = 0;
  for (const run of runs) {
    let i = 0;
    while (i < run.text.length) {
      const abs = pos + i;
      while (r < ranges.length && ranges[r].end <= abs) r += 1;
      const range = r < ranges.length ? ranges[r] : null;
      const inside = range !== null && abs >= range.start;
      let stop = run.text.length;
      if (range) stop = Math.min(stop, i + (inside ? range.end : range.start) - abs);
      const piece = run.text.slice(i, stop);
      if (inside) {
        if (!range.el) {
          range.el = h('span', { class: `tint tint-${range.tint}` });
          root.append(range.el);
        }
        range.el.append(runNode(piece, run.cls));
      } else {
        root.append(runNode(piece, run.cls));
      }
      i = stop;
    }
    pos += run.text.length;
  }
  return root;
}

function legendNode(legend, perBlock) {
  const marks = new Map();
  for (const ranges of perBlock) {
    for (const range of ranges) marks.set(range.index, range.el);
  }
  const items = legend.map((item, index) => {
    const chip = h('span', { class: `legend-word tint-${item.tint}` });
    const mark = marks.get(index);
    if (mark) chip.append(...[...mark.childNodes].map((n) => n.cloneNode(true)));
    else chip.append(item.word);
    return h('div', { class: 'legend-item' }, chip, h('span', { class: 'legend-means' }, item.means));
  });
  return h('div', { class: 'legend' }, ...items);
}

function codeRow(runs, ranges, text) {
  return h('div', { class: 'code-row' }, blockNode(runs, ranges), copyButton(text));
}

function copyButton(text) {
  const mark = svg('copy-bold', 's16');
  const label = h('span', null, 'Copy');
  let timer = 0;
  const el = button('copy-btn', () => {
    state.deps.copyText(text);
    setIcon(mark, 'check-bold');
    label.textContent = 'Copied!';
    el.classList.add('done');
    clearTimeout(timer);
    timer = setTimeout(() => {
      setIcon(mark, 'copy-bold');
      label.textContent = 'Copy';
      el.classList.remove('done');
    }, 1500);
  }, mark, label);
  return el;
}

function richText(text) {
  return text.split('**').map((part, i) => (i % 2 ? h('code', { class: 'say-code' }, part) : part));
}

function resultSrc(topicId, file) {
  if (state.deps.resultUrl) return state.deps.resultUrl(topicId, file);
  return `${previewBase}__help/${encodeURIComponent(topicId)}/${encodeURIComponent(file)}`;
}

function resultNode(topic) {
  const result = topic.result;
  if (!result || !result.files || !result.files.length) return null;
  const frames = result.files.map((file) => {
    const frame = document.createElement('iframe');
    frame.className = 'result-frame';
    frame.setAttribute('sandbox', '');
    frame.setAttribute('title', `What you see: ${file}`);
    frame.setAttribute('tabindex', '-1');
    frame.style.height = `${result.height}px`;
    frame.setAttribute('src', resultSrc(topic.id, file));
    return frame;
  });
  return h('div', { class: 'result-box' },
    h('div', { class: 'result-title' }, 'What you see'),
    ...frames);
}

function backLink(groupId) {
  const group = groupOf(groupId);
  return button('quiet', () => showGroup(groupId),
    svg('caret-left-bold', 's14'),
    group ? group.title : 'Help');
}

function addButton(topic) {
  const insert = topic.insert;
  if (!insert) return { el: null, refresh() {}, reset() {} };
  const mark = svg('plus-bold', 's18 tk-brand');
  const label = h('span', null, 'Add to my code');
  let added = false;
  const el = button('btn btn-secondary btn-add', () => {
    const can = state.deps.canAdd(insert.lang);
    if (!can.ok) {
      paint();
      return;
    }
    state.deps.onAddToCode({ lang: insert.lang, text: insert.text });
    added = true;
    paint();
  }, mark, label);

  function paint() {
    setIcon(mark, added ? 'check-bold' : 'plus-bold');
    label.textContent = added ? 'Added to my code' : 'Add to my code';
    const can = state.deps.canAdd(insert.lang);
    el.classList.toggle('off', !can.ok);
    if (can.ok) {
      el.removeAttribute('aria-disabled');
      el.removeAttribute('title');
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('title', can.reason || '');
    }
  }

  el.addEventListener('mouseenter', paint);
  el.addEventListener('focus', paint);

  return {
    el,
    refresh: paint,
    reset() {
      added = false;
      paint();
    },
  };
}

function nextButton(topic) {
  const list = topicsOf(topic.group);
  const at = list.findIndex((t) => t.id === topic.id);
  const last = at === list.length - 1;
  const next = last ? list[0] : list[at + 1];
  const label = last ? 'Back to the first topic' : `Next: ${next.short}`;
  return button('quiet next', () => showTopic(next.id), label, svg('arrow-right-bold', 's16'));
}

async function buildLesson(topic) {
  const blocks = topic.code || [];
  const legend = topic.legend || [];
  const allRuns = await Promise.all(blocks.map(runsFor));
  const perBlock = legendRanges(blocks.map((b) => b.text), legend);
  const codeBox = h('div', { class: 'code-box' }, ...allRuns.map((runs, b) => codeRow(runs, perBlock[b], blocks[b].text)));
  const legendEl = legend.length ? legendNode(legend, perBlock) : null;

  const list = topicsOf(topic.group);
  const add = addButton(topic);
  const tryIt = button('btn btn-primary btn-try', () => state.deps.onTryIt(topic.id), svg('try-it', 's26'), 'Try it');

  const scroller = h('div', { class: 'topic-body' },
    h('h2', { class: 'topic-title' }, topic.title),
    h('p', { class: 'topic-explain' }, topic.explain),
    codeBox,
    legendEl,
    resultNode(topic),
    h('div', { class: 'topic-actions' }, tryIt, add.el),
    h('div', { class: 'turn-box' },
      svg('your-turn', 's28 tk-brand'),
      h('div', { class: 'turn-text' }, h('span', { class: 'turn-lead' }, 'Your turn:'), ` ${topic.turn}`)));

  const more = topic.more
    ? button('quiet more', () => state.deps.openExternal(topic.more), svg('arrow-square-out-bold', 's16'), 'Read more online')
    : null;

  const el = h('div', { class: 'help-view', hidden: true },
    h('div', { class: 'topic-head' },
      backLink(topic.group),
      h('span', { class: 'topic-count' }, `Topic ${list.findIndex((t) => t.id === topic.id) + 1} of ${list.length}`)),
    scroller,
    h('div', { class: 'topic-foot' }, more, nextButton(topic)));

  const view = { el, scroller, scroll: 0, onShow: add.refresh, onLeave: add.reset };
  trackScroll(view);
  return view;
}

async function stepNodes(step) {
  const say = h('p', { class: 'way-say' }, ...richText(step.say));
  if (!step.text) return [say];
  const runs = await runsFor({ text: step.text, lang: step.lang });
  return [say, h('div', { class: 'code-box' }, codeRow(runs, [], step.text))];
}

async function buildRecipe(topic) {
  const list = topicsOf(topic.group);
  const ways = await Promise.all((topic.ways || []).map(async (way) => {
    const steps = await Promise.all(way.steps.map(stepNodes));
    return h('section', { class: 'way' },
      way.title ? h('h3', { class: 'way-title' }, way.title) : null,
      ...steps.flat());
  }));
  const tip = topic.tip
    ? h('div', { class: 'turn-box recipe-tip' },
      svg('your-turn', 's28 tk-brand'),
      h('div', { class: 'turn-text' }, h('span', { class: 'turn-lead' }, 'Tip:'), ' ', ...richText(topic.tip)))
    : null;
  const scroller = h('div', { class: 'topic-body' },
    h('h2', { class: 'topic-title' }, topic.title),
    h('p', { class: 'topic-explain' }, ...richText(topic.explain)),
    resultNode(topic),
    ...ways,
    tip);
  const learn = topic.learn
    ? button('quiet more', () => showTopic(topic.learn), svg('help-bold', 's16'), 'Learn how it works')
    : h('span');
  const el = h('div', { class: 'help-view', hidden: true },
    h('div', { class: 'topic-head' },
      backLink(topic.group),
      h('span', { class: 'topic-count' }, `Topic ${list.findIndex((t) => t.id === topic.id) + 1} of ${list.length}`)),
    scroller,
    h('div', { class: 'topic-foot' }, learn, nextButton(topic)));
  const view = { el, scroller, scroll: 0 };
  trackScroll(view);
  return view;
}

async function buildHowList(topic) {
  const rows = await Promise.all((topic.rows || []).map(async (row) => {
    const runs = await runsFor({ text: row.code, lang: topic.lang });
    return h('section', { class: 'how-row' },
      h('h3', { class: 'way-title' }, row.means),
      row.tip ? h('p', { class: 'way-say' }, ...richText(row.tip)) : null,
      h('div', { class: 'code-box' }, codeRow(runs, [], row.code)));
  }));
  const scroller = h('div', { class: 'topic-body' },
    h('h2', { class: 'topic-title' }, topic.title),
    ...rows);
  const el = h('div', { class: 'help-view', hidden: true },
    h('div', { class: 'topic-head' }, backLink(topic.group)),
    scroller);
  const view = { el, scroller, scroll: 0 };
  trackScroll(view);
  return view;
}

function buildList(topic) {
  if (topic.lang) return buildHowList(topic);
  const rows = (topic.rows || []).map((row) => {
    const swatch = row.color ? h('span', { class: 'swatch', style: `background:${row.color}` }) : null;
    return h('tr', null,
      h('td', { class: 'lookup-code' }, swatch, row.code),
      h('td', { class: 'lookup-means' }, row.means));
  });
  const scroller = h('div', { class: 'topic-body' },
    h('h2', { class: 'topic-title' }, topic.title),
    h('table', { class: 'lookup' }, h('tbody', null, ...rows)));
  const el = h('div', { class: 'help-view', hidden: true },
    h('div', { class: 'topic-head' }, backLink(topic.group)),
    scroller);
  const view = { el, scroller, scroll: 0 };
  trackScroll(view);
  return view;
}

async function topicView(topicId) {
  const hit = state.cache.get(topicId);
  if (hit) return hit;
  const topic = await state.deps.helpTopic(topicId);
  if (!topic) return null;
  let built;
  if (topic.kind === 'list') built = await buildList(topic);
  else if (topic.kind === 'recipe') built = await buildRecipe(topic);
  else built = await buildLesson(topic);
  const again = state.cache.get(topicId);
  if (again) return again;
  state.cache.set(topicId, built);
  return built;
}

function touchCache(topicId, view) {
  state.cache.delete(topicId);
  state.cache.set(topicId, view);
  if (state.cache.size <= KEEP_TOPICS) return;
  for (const [id, old] of state.cache) {
    if (old !== view) {
      old.el.remove();
      state.cache.delete(id);
      break;
    }
  }
}

export function initHelp(container, deps) {
  state.container = container;
  state.deps = deps;
}

async function showCurrent() {
  if (state.view === 'topic' && state.topicId) return showTopic(state.topicId);
  return showHome();
}

export async function showHome() {
  const mine = ++state.seq;
  await ensureIndex();
  if (mine !== state.seq) return;
  showHomeNow();
}

export async function showGroup(groupId) {
  const mine = ++state.seq;
  await ensureIndex();
  if (mine !== state.seq) return;
  state.openGroup = groupId;
  state.query = '';
  showHomeNow();
  requestAnimationFrame(() => {
    if (state.view !== 'home' || !state.home) return;
    const part = state.home.sections.find((s) => s.group.id === groupId);
    if (part) part.el.scrollIntoView({ block: 'nearest' });
  });
}

export async function showTopic(topicId) {
  const mine = ++state.seq;
  await ensureIndex();
  const view = await topicView(topicId);
  if (mine !== state.seq || !view) return;
  present(view);
  state.view = 'topic';
  state.topicId = topicId;
  touchCache(topicId, view);
}

export async function showWord(word) {
  const w = (word || '').trim().toLowerCase();
  if (!w) return showCurrent();
  const mine = ++state.seq;
  await ensureIndex();
  if (mine !== state.seq) return undefined;
  const match = state.topics.find((t) => t.kind === 'lesson' && t.keywordSet.has(w))
    || state.topics.find((t) => t.kind === 'lesson' && t.words.has(w))
    || state.topics.find((t) => t.kind === 'recipe' && t.words.has(w))
    || state.topics.find((t) => t.kind === 'list' && t.words.has(w));
  if (match) return showTopic(match.id);
  state.query = w;
  showHomeNow();
  return undefined;
}

export function refreshTried() {
  if (state.home) paintGroups();
}

export function refreshCanAdd() {
  const view = activeView();
  if (view && view.onShow) view.onShow();
}
