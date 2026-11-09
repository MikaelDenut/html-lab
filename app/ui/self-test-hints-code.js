// Self-tests for 0.3.0 WP6 "Mistake hints for JSON, JavaScript and TypeScript" (docs/NEXT-0.3.0.md, WP6).
// Uses from h: t, assert, eq, until, wait, view, S, flows, runCommand, switchTo, activeTab, tabsOf.
// Expected words come from the copy table, never from the code under test.

export const CODE_HINT_TESTS = 8;

const COMMA = 'Oops, a comma is missing.';
const BRACKET = 'Oops, this bracket never closes.';
const QUOTE = 'Oops, this quote never closes.';
const commaText = (n) => `Put a , at the end of line ${n}. Each item in a list needs a comma before the next one.`;
const bracketText = (closer) => `Add ${closer} where it should end.`;
const quoteText = (quote) => `Add ${quote} at the end of the text.`;
const OOPS_TITLE = 'Something is wrong in here. Click to see it.';

// The mockup's file (10-json-hint): line 4 misses its comma.
const LEVELS =
  '{\n  "levels": [\n    {\n      "name": "Pond"\n      "coins": 12,\n      "night": false\n    },\n' +
  '    {\n      "name": "River",\n      "coins": 20,\n      "night": true\n    }\n  ]\n}\n';

// Ten files with no mistake. Brackets and quotes inside strings, comments, regular expressions,
// templates and JSX must not count.
const VALID = [
  ['levels.json', LEVELS.replace('"Pond"', '"Pond",')],
  ['mix.json', '{"a": [], "b": {}, "c": [1, -2.5, 3e4], "d": null, "e": true, "f": "x \\" y"}\n'],
  ['signs.json', '["(", "[", "{", "a, b", "\\\\"]\n'],
  ['text.js', 'const r = /[(]/g;\nconst s = `a ${ {x: 1}.x } b`;\nconst t = `line one\nline two`;\n'],
  ['view.js', 'const A = () => <p className="x">Hello (world {n}</p>;\n'],
  ['player.js', '// a ( comment\n/* { [ */\nclass A {\n  #x = 1;\n  get x() { return this.#x; }\n}\n'],
  ['quotes.js', "const q = 'it\\'s';\nconst d = \"say \\\"hi\\\"\";\nconst e = a ? (b) : [c];"],
  ['box.ts', 'interface Box<T> {\n  items: T[];\n  get(i: number): T | undefined;\n}\nconst m: Map<string, number[]> = new Map();\n'],
  ['scores.ts', 'type Scores = { [name: string]: number };\nconst add = (a: number, b: number): number => a + b;\nenum Dir { Up, Down }\n'],
  ['app.tsx', 'const App = (): JSX.Element => <div>{[1, 2].map((n) => <b key={n}>{n}</b>)}</div>;\n'],
];
const LANGUAGE = { json: 'json', js: 'javascript', ts: 'typescript', tsx: 'typescript' };

export async function codeHintTests(h) {
  const { t, assert, eq, until, wait, view, S, flows, runCommand, switchTo, activeTab, tabsOf } = h;

  const content = (name, files) => ({ id: 'test', name, files: files.map(([n, code]) => ({ name: n, code, hidden: false })) });
  const open = async (files) => {
    const project = await flows.__openContent(content('Code', files), 'new');
    const first = files[0][0];
    switchTo(tabsOf(project).find((tab) => tab.name === first).path);
    await until(() => activeTab() && activeTab().name === first, `${first} to open`);
    return project;
  };
  const doc = () => view.state.doc.toString();
  const replace = (from, to) => {
    const at = doc().indexOf(from);
    assert(at >= 0, `"${from}" not in the code`);
    view.dispatch({ changes: { from: at, to: at + from.length, insert: to }, selection: { anchor: at + to.length }, userEvent: 'input.type' });
  };
  const box = () => view.dom.querySelector('.hint-box');
  // The hint waits 800 ms after the last change.
  const hintFor = (title) =>
    until(() => box() && box().querySelector('.hint-title').textContent === title && box(), () => `the hint "${title}", saw "${box() ? box().textContent : 'none'}"`, 3000);
  const read = (b) => ({
    text: b.querySelector('.hint-text').textContent,
    codes: [...b.querySelectorAll('.hint-text code')].map((c) => c.textContent),
    learn: !!b.querySelector('[data-act="learn"]'),
    hide: !!b.querySelector('[data-act="hide"]'),
  });
  const marked = () => [...view.dom.querySelectorAll('.cm-mistake')].map((m) => m.textContent).join('');
  const gone = (label) =>
    until(() => !box() && !S.ed.hintActive(view.state) && !view.dom.querySelector('.cm-mistake'), `${label}: the hint to go`, 3000);
  const checkHint = async (title, text, code, mark) => {
    const b = await hintFor(title);
    const seen = read(b);
    eq(seen.text, text, 'the hint text');
    eq(seen.codes.join(' '), code, 'the code part');
    assert(!seen.learn, 'a Learn about tags button on a code hint');
    assert(seen.hide, 'no Hide this hint button');
    eq(marked(), mark, 'the marked code');
    eq(view.dom.querySelectorAll('.hint-box').length, 1, 'only the first mistake shows');
    return b;
  };

  // Teeth: with a new item after a finished one not named a missing comma (code-hints.js returns
  // null there), the line number taken from the next item, the Learn button shown for code hints,
  // or the json chunk not exporting findMistake, this fails.
  await t('WP6: a missing comma in JSON shows the hint, and it goes when the comma is there', async () => {
    await open([['levels.json', LEVELS]]);
    const b = await checkHint(COMMA, commaText(4), ',', '"coins"');
    // Under the line with the marked item, above the next line (mockup 10).
    const lineWith = (text) => [...view.contentDOM.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(text));
    const above = lineWith('"coins": 12,').getBoundingClientRect();
    const below = lineWith('"night": false').getBoundingClientRect();
    const r = b.getBoundingClientRect();
    assert(r.top >= above.bottom - 1 && r.bottom <= below.top + 1, `the hint is not between the "coins" and "night" lines: ${r.top}-${r.bottom}, ${above.bottom}, ${below.top}`);
    replace('"Pond"', '"Pond",');
    await gone('comma added');
  });

  // Teeth: with a JSON closer that fits a bracket further out not traced back to the bracket that
  // never closed, or the closer looked up wrongly, this fails.
  await t('WP6: a JSON bracket that never closes shows the hint, and it goes when closed', async () => {
    await open([['levels.json', '{\n  "name": "Pond",\n  "coins": [1, 2, 3\n}\n']]);
    await checkHint(BRACKET, bracketText(']'), ']', '[');
    replace('3\n}', '3]\n}');
    await gone('bracket closed');
  });

  // Teeth: with JSON strings allowed to run past the end of the line, this fails.
  await t('WP6: a JSON quote that never closes shows the hint, and it goes when closed', async () => {
    await open([['levels.json', '{\n  "name": "Pond,\n  "coins": 12\n}\n']]);
    await checkHint(QUOTE, quoteText('"'), '"', '"Pond,');
    replace('"Pond,', '"Pond",');
    await gone('quote closed');
  });

  // Teeth: with a script closer that fits a bracket further out not traced back to the bracket
  // that never closed, or the javascript chunk not adding the finder, this fails.
  await t('WP6: a JavaScript bracket that never closes shows the hint, and it goes when closed', async () => {
    await open([['game.js', 'function jump(height) {\n  if (height > 3 {\n    return 1;\n  }\n  return 0;\n}\n']]);
    await checkHint(BRACKET, bracketText(')'), ')', '(');
    replace('3 {', '3) {');
    await gone('bracket closed');
  });

  // Teeth: with the script scan not checking that a String ends with its quote, this fails.
  await t('WP6: a JavaScript quote that never closes shows the hint, and it goes when closed', async () => {
    await open([['game.js', 'const name = "Ada;\nconsole.log(name);\n']]);
    await checkHint(QUOTE, quoteText('"'), '"', '"Ada;');
    replace('"Ada;', '"Ada";');
    await gone('quote closed');
  });

  // Teeth: with a bracket still open at the end of the file left without a hint, or the typescript
  // chunk not adding the finder, this fails.
  await t('WP6: a TypeScript bracket that never closes shows the hint, and it goes when closed', async () => {
    const text = 'class Player {\n  name: string = "Ada";\n  jump(height: number): number {\n    return height * 2;\n  }\n';
    await open([['game.ts', text]]);
    await checkHint(BRACKET, bracketText('}'), '}', '{');
    view.dispatch({ changes: { from: view.state.doc.length, insert: '}\n' }, userEvent: 'input.type' });
    await gone('bracket closed');
  });

  // Teeth: with the escaped-quote rule turned around (a plain closing quote read as escaped),
  // brackets in strings, comments, regular expressions or JSX text counted, or a hint shown
  // without the parser's error, this fails.
  await t('WP6: ten files with no mistake show no hint (JSON, JavaScript, TypeScript, mixed with a page)', async () => {
    const project = await open([...VALID, ['index.html', '<!doctype html>\n<h1>Home</h1>\n']]);
    let seen = 0;
    for (const [name] of VALID) {
      const tab = tabsOf(project).find((x) => x.name === name);
      assert(tab, `${name} did not open`);
      eq(tab.language, LANGUAGE[name.split('.').pop()], `${name}: the language`);
      switchTo(tab.path);
      await until(() => activeTab() && activeTab().path === tab.path && tab.view, `${name} to show`);
      seen += 1;
    }
    eq(seen, 10, 'samples seen');
    // Every view checks 800 ms after it was made; the last one was made just now.
    await wait(1200);
    for (const [name] of VALID) {
      const tab = tabsOf(project).find((x) => x.name === name);
      const hinted = tab.view.dom.querySelector('.hint-box');
      assert(!hinted, `${name}: ${hinted ? hinted.textContent : ''}`);
      assert(!S.ed.hintActive(tab.view.state), `${name}: a mistake was found`);
    }
  });

  // Teeth: with the fold pills reading the mistake only for teaching kinds (HTML), or the code
  // hints given a field the pills do not read, the pill never turns Oops and this fails.
  await t('WP6: a JSON mistake inside a folded part turns the pill Oops, and its click shows the hint', async () => {
    await open([['levels.json', LEVELS]]);
    const at = doc().indexOf('"levels"');
    view.dispatch({ selection: { anchor: at + 1 } });
    runCommand('fold');
    const pills = () => [...view.dom.querySelectorAll('.fold-pill')];
    await until(() => pills().length === 1, 'the fold');
    const pill = await until(() => pills().find((p) => p.classList.contains('oops')), 'an Oops pill', 3000);
    eq(pill.title, OOPS_TITLE, 'the Oops tooltip');
    const use = pill.querySelector('use');
    assert(use && /oops/.test(use.getAttribute('href') || ''), 'the Oops pill has no oops icon');
    pill.click();
    await until(() => pills().length === 0, 'the part to unfold');
    await hintFor(COMMA);
  });
}
