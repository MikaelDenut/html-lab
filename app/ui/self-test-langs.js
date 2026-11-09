// Self-tests for 0.3.0 WP2 "Languages" (docs/NEXT-0.3.0.md, WP2; C21, C47).
// Uses from h: t, assert, eq, until, wait, S, E, flows, runCommand, activeTab, showRight, view, doc,
// invoke, parent, freshFolder, $.
// Expected words come from the copy table and the samples below, never from the code under test.

export const LANG_TESTS = 7;

// One small sample per row of LANGUAGES. `fold` is the start of a line that opens a block.
// Lines are indented wrongly on purpose, so a Tidy that runs changes something.
export const SAMPLES = {
  javascript: {
    file: 'game.js',
    fold: 'function jump',
    text: 'function jump(height) {\nif (height > 3) {\n      console.log("High jump!");\n  }\n  return height;\n}\n',
  },
  typescript: {
    file: 'game.ts',
    fold: 'class Player',
    text: 'class Player {\nname: string = "Ada";\n    jump(height: number): number {\n  return height * 2;\n    }\n}\n',
  },
  json: {
    file: 'levels.json',
    fold: '"levels"',
    text: '{\n"levels": [\n      { "coins": 3 },\n  { "coins": 5 }\n  ]\n}\n',
  },
  markdown: {
    file: 'notes.md',
    fold: '# My game',
    text: '# My game\n\n- jump\n      - high\n- run\n\n## Rules\n\nBe kind.\n',
  },
  xml: {
    file: 'game.xml',
    fold: '<game>',
    text: '<game>\n<level number="1">\n      <coins>3</coins>\n  </level>\n</game>\n',
  },
  scss: {
    file: 'game.scss',
    fold: '.player',
    text: '.player {\ncolor: red;\n      .hat {\n  color: blue;\n    }\n}\n',
  },
  sass: {
    file: 'game.sass',
    fold: '.player',
    text: '.player\n  color: red\n  .hat\n        color: blue\n',
  },
  less: {
    file: 'game.less',
    fold: '.player',
    text: '@main: red;\n.player {\ncolor: @main;\n      .hat {\n  color: blue;\n    }\n}\n',
  },
  yaml: {
    file: 'game.yaml',
    fold: 'player:',
    text: 'player:\n  name: Ada\n  levels:\n        - 1\n        - 2\n',
  },
  python: {
    file: 'game.py',
    fold: 'class Player',
    text: 'class Player:\n    def jump(self):\n        if self.y == 0:\n                self.speed = -9\n',
  },
  php: {
    file: 'game.php',
    fold: 'function jump',
    text: '<?php\nfunction jump($height) {\nif ($height > 3) {\n      echo "High jump!";\n  }\n  return $height;\n}\n',
  },
  sql: {
    file: 'game.sql',
    fold: 'CREATE TABLE',
    text: 'CREATE TABLE players (\nid INTEGER,\n      name TEXT\n);\n',
  },
  cpp: {
    file: 'game.c',
    fold: 'int jump',
    text: '#include <stdio.h>\n\nint jump(int height) {\nif (height > 3) {\n      puts("High jump!");\n  }\n  return height;\n}\n',
  },
  java: {
    file: 'Game.java',
    fold: 'class Player',
    text: 'class Player {\nint score = 0;\n      void jump(int height) {\n  score += height;\n    }\n}\n',
  },
  go: {
    file: 'game.go',
    fold: 'func jump',
    text: 'package main\n\nfunc jump(height int) int {\nif height > 3 {\n      height = 3\n  }\n  return height\n}\n',
  },
  rust: {
    file: 'game.rs',
    fold: 'fn jump',
    text: 'fn jump(height: i32) -> i32 {\nif height > 3 {\n      return 3;\n  }\n  height\n}\n',
  },
  csharp: {
    file: 'Game.cs',
    fold: null, // plain text: the clike mode cannot load under freezePrototype
    text: 'class Player {\nint score = 0;\n      void Jump(int height) {\n  score += height;\n    }\n}\n',
  },
  kotlin: {
    file: 'Game.kt',
    fold: null, // plain text, as C#
    text: 'class Player(val name: String) {\nvar score = 0\n      fun jump(height: Int) {\n  score += height\n    }\n}\n',
  },
  swift: {
    file: 'Game.swift',
    fold: 'class Player',
    text: 'class Player {\nvar score = 0\n      func jump(height: Int) {\n  score += height\n    }\n}\n',
  },
  lua: {
    file: 'game.lua',
    fold: 'function jump',
    text: 'function jump(height)\n    if height > 3 then\nprint("High jump!")\n      end\n  return height\nend\n',
  },
  shell: {
    file: 'run.sh',
    fold: 'jump()',
    text: 'jump() {\necho "High jump!"\n      echo "again"\n}\n',
  },
  powershell: {
    file: 'run.ps1',
    fold: 'function Jump',
    text: 'function Jump {\nWrite-Output "High jump!"\n      Write-Output "again"\n}\n',
  },
  ruby: {
    file: 'game.rb',
    fold: 'def jump',
    text: 'def jump(height)\n  if height > 3\n        puts "High jump!"\n  end\nend\n',
  },
  toml: {
    file: 'game.toml',
    fold: 'levels = [',
    text: '[player]\nname = "Ada"\nlevels = [\n      1,\n  2,\n]\n',
  },
  ini: {
    file: 'game.ini',
    fold: 'colors =',
    text: '[player]\nname = Ada\ncolors =\n      red\n  blue\n',
  },
  text: {
    file: 'notes.txt',
    fold: '',
    text: 'My game\n      has levels\n  and coins\n',
  },
};

// The copy table, Tidy rows.
const offSentence = (tidy, label) =>
  tidy === 'off-meaning'
    ? `Tidy is off for ${label} files, because spaces change what the code means.`
    : `Tidy does not know how to tidy ${label} files yet.`;

const leadingGone = (text) => text.split('\n').map((line) => line.replace(/^[ \t]+/, '')).join('\n');

export async function langTests(h) {
  const { t, assert, eq, until, wait, S, E, flows, runCommand, activeTab, showRight, view, doc, invoke, parent, freshFolder, $ } = h;

  const encode = (text) => Array.from(new TextEncoder().encode(text));
  const writeFile = async (name, text) => {
    const dir = `${parent}/langs-${freshFolder()}`;
    assert(await invoke('test_make_folder', { path: dir }), `the folder ${dir} was not made`);
    const path = `${dir}/${name}`;
    assert(await invoke('test_write_bytes', { path, bytes: encode(text) }), `${path} was not written`);
    return path;
  };
  const openFile = async (name, text) => {
    const path = await writeFile(name, text);
    await flows.__openList([path]);
    await until(() => activeTab() && activeTab().name === name, `${name} to be the active tab`);
    return path;
  };
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width >= 2 && r.height >= 2 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const box = () => S.ed.view.dom;
  const lineWith = (text) => [...box().querySelectorAll('.cm-line')].find((line) => line.textContent.startsWith(text)) || null;
  const markFor = (line) => {
    if (!line) return null;
    const r = line.getBoundingClientRect();
    return [...box().querySelectorAll('.cm-foldGutter .fold-mark')].filter(shown).find((m) => {
      const b = m.getBoundingClientRect();
      const y = (b.top + b.bottom) / 2;
      return y >= r.top && y < r.bottom;
    }) || null;
  };
  const insideText = () => {
    const row = $('inside-line');
    const lead = row.querySelector('.inside-lead');
    const none = row.querySelector('.inside-none');
    if (none) return none.textContent.trim();
    const crumbs = [...row.querySelectorAll('.inside-crumb')].map((b) => b.textContent.trim());
    return lead ? `${lead.textContent.trim()} ${crumbs.join(' › ')}` : row.textContent.trim();
  };
  const caretAt = (needle, k = 0) => {
    const at = doc().indexOf(needle);
    assert(at >= 0, `"${needle}" not in the doc`);
    view.dispatch({ selection: { anchor: at + k } });
  };
  const completionShown = () => [...document.querySelectorAll('.cm-tooltip-autocomplete')].some(shown);
  const typeHere = (text) => {
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' });
  };
  const restOn = async (needle, k = 2) => {
    const at = doc().indexOf(needle) + k;
    assert(at >= k, `"${needle}" not in the doc`);
    view.dispatch({ effects: E.EditorView.scrollIntoView(at, { y: 'center' }) });
    await wait(50);
    const r = view.coordsAtPos(at, 1);
    assert(r, `position ${at} is not on screen`);
    const x = r.left + 1;
    const y = (r.top + r.bottom) / 2;
    const target = document.elementFromPoint(x, y);
    assert(target && view.contentDOM.contains(target), `the mouse at ${at} is not on the code`);
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, view: window }));
  };
  const tipShown = () => [...document.querySelectorAll('.explain-tip, .picture-tip')].some(shown);
  // Typing as a key press does it, so the bracket closer (an input handler) sees it.
  const typeThrough = (text) => {
    const { from, to } = view.state.selection.main;
    const make = () =>
      view.state.update({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' });
    for (const handler of view.state.facet(E.EditorView.inputHandler)) {
      if (handler(view, from, to, text, make)) return;
    }
    view.dispatch(make());
  };
  // The test Mac's window is often not the key window, and Help on This Word asks whether the
  // code has the focus. Only the window's answer is replaced, for the length of fn.
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

  // Teeth: with a row missing from LANGUAGES, a wrong label or letters, a language chunk not given
  // folding (legacy rows without the fold service), Tidy left on for an off row (python changes),
  // or Tidy gated off for an on row (nothing changes), this fails.
  await t('every language opens with its label, letters, folding and Tidy rule (C21)', async () => {
    const rows = S.config.languages;
    let seen = 0;
    const problems = [];
    for (const row of rows) {
      const sample = SAMPLES[row.id];
      if (!sample) {
        problems.push(`${row.id}: no sample`);
        continue;
      }
      seen++;
      try {
        await openFile(sample.file, sample.text);
        await until(() => $('lang-label').textContent === row.label && !$('lang-label').hidden, `${row.id}: the label "${row.label}"`, 3000);
        const letters = document.querySelector('.tab.active .tab-letters text');
        eq(letters && letters.textContent, row.letters, `${row.id}: the tab letters`);
        if (sample.fold) {
          await until(() => markFor(lineWith(sample.fold)), `${row.id}: a fold arrow on "${sample.fold}"`, 3000);
        }
        const tidy = $('btn-tidy');
        const before = doc();
        if (row.tidy === 'on') {
          assert(!tidy.hasAttribute('aria-disabled'), `${row.id}: Tidy is greyed`);
          tidy.click();
          await until(() => doc() !== before, `${row.id}: Tidy to change the indents`, 2000);
          eq(leadingGone(doc()), leadingGone(before), `${row.id}: Tidy changed more than indents`);
          const once = doc();
          tidy.click();
          await wait(50);
          eq(doc(), once, `${row.id}: a second Tidy changed the text`);
        } else {
          const want = offSentence(row.tidy, row.label);
          eq(tidy.getAttribute('aria-disabled'), 'true', `${row.id}: aria-disabled`);
          assert(!tidy.disabled, `${row.id}: Tidy has the disabled attribute`);
          eq(tidy.title, want, `${row.id}: the Tidy tooltip`);
          const why = document.getElementById(tidy.getAttribute('aria-describedby') || '');
          eq(why && why.textContent, want, `${row.id}: the Tidy description`);
          tidy.focus();
          eq(document.activeElement, tidy, `${row.id}: Tidy takes focus`);
          tidy.click();
          runCommand('tidy');
          await wait(100);
          eq(doc(), before, `${row.id}: Tidy changed an off file`);
        }
      } catch (error) {
        problems.push(String(error && error.message ? error.message : error));
      }
      flows.__closeAllNow();
      await wait(0);
    }
    assert(!problems.length, problems.join('; '));
    eq(seen, rows.length, 'rows seen');
    eq(rows.length, 26, 'rows in LANGUAGES');
  });

  // Teeth: with setTypingHelpers giving every tab the teaching helpers (autocompletion), or newState
  // ignoring the tab's kind, "pri" in game.py pops up Python's suggestions after the toggle.
  await t('Typing Helpers off and on with a .py tab: "pri" gives no suggestions (C47)', async () => {
    await openFile('page.html', '<!doctype html>\n<body>\n\n</body>\n');
    caretAt('<body>\n', 7);
    view.focus();
    typeHere('<di');
    await until(completionShown, 'suggestions in the page, so the check can see them', 2000);
    flows.__closeAllNow();
    await openFile('game.py', 'score = 0\n\n');
    runCommand('typing-helpers');
    eq(S.prefs.typingHelpers, false, 'helpers off');
    runCommand('typing-helpers');
    eq(S.prefs.typingHelpers, true, 'helpers on');
    caretAt('score = 0\n', 11);
    view.focus();
    typeHere('pri');
    await wait(700);
    assert(!completionShown(), 'suggestions popped up in a Python file');
    typeThrough('(');
    assert(doc().includes('pri()'), `a bracket did not close: ${JSON.stringify(doc())}`);
  });

  // Teeth: with inside.js using the tag path for every file, or codePath not walking classes,
  // functions, methods, defs and keys, a row reads "You are not inside a tag here." or misses a name;
  // with the row shown for YAML, the last check fails.
  await t('You are inside: function names in JS, a key path in JSON, defs in Python, no row for YAML', async () => {
    await openFile('game.js', 'class Player {\n  jump(height) {\n    if (height > 3) {\n      go();\n    }\n  }\n}\nfunction fall() {\n  return 1;\n}\n');
    caretAt('go();', 1);
    await until(() => insideText() === 'You are inside: class Player › method jump › if', () => `JS row, saw "${insideText()}"`, 2000);
    caretAt('return 1', 2);
    await until(() => insideText() === 'You are inside: function fall', () => `JS row in fall, saw "${insideText()}"`, 2000);
    flows.__closeAllNow();
    await openFile('levels.json', '{"levels": [{"coins": 1}, {"coins": 2}]}\n');
    caretAt('"coins": 2', 9);
    await until(() => insideText() === 'You are inside: levels › 1 › coins', () => `JSON row, saw "${insideText()}"`, 2000);
    flows.__closeAllNow();
    await openFile('game.py', 'class Player:\n    def jump(self):\n        if self.y == 0:\n            self.speed = -9\n');
    caretAt('self.speed', 4);
    await until(() => insideText() === 'You are inside: class Player › def jump › if', () => `Python row, saw "${insideText()}"`, 2000);
    assert(!$('inside-line').hidden, 'the row is hidden for Python');
    flows.__closeAllNow();
    await openFile('game.yaml', 'player:\n  name: Ada\n');
    caretAt('Ada', 1);
    await until(() => $('inside-line').hidden, 'the row to hide for YAML', 2000);
  });

  // Teeth: with the teaching gates gone (explainExtension for every language, helpOnThisWord without
  // the kind check, inside.js without the kind check), the <table> in game.php shows its explanation,
  // Help opens for "table" in game.js, or the row says "You are not inside a tag here.".
  await t('Hover explanations, Help on This Word and the tag row do nothing outside HTML and CSS (C47)', () => withKeyWindow(async () => {
    await openFile('page.html', '<!doctype html>\n<table>\n<tr><td>x</td></tr>\n</table>\n');
    caretAt('<table', 2);
    view.focus();
    runCommand('help-word');
    await until(() => S.rightView === 'help', 'Help on This Word in a page, so the check can see it', 3000);
    showRight('page');
    await restOn('<table', 2);
    await until(tipShown, 'an explanation in a page, so the check can see it', 3000);
    flows.__closeAllNow();
    await wait(50);
    await openFile('game.php', '<?php echo 1; ?>\n<table>\n<tr><td>x</td></tr>\n</table>\n');
    await restOn('<table', 2);
    await wait(1200);
    assert(!tipShown(), 'an explanation in a PHP file');
    flows.__closeAllNow();
    await openFile('game.js', 'const table = 1;\nfunction jump() {\n  return table;\n}\n');
    caretAt('const table', 8);
    view.focus();
    runCommand('help-word');
    await wait(400);
    eq(S.rightView, 'page', 'Help on This Word in a JS file');
    await restOn('table', 2);
    await wait(1200);
    assert(!tipShown(), 'an explanation in a JS file');
    caretAt('const', 1);
    await wait(100);
    eq(insideText(), '', 'the row outside every function');
  }));

  // Teeth: with Tidy re-indenting the whole file while a selection is set, or using two spaces
  // instead of the file's own tab, the lines outside the selection or the tab check fail.
  await t('Tidy in a JS file re-indents only the selected lines, with the file\'s own tab', async () => {
    const head = 'function a() {\n\tone();\n\tif (x) {\n\t\tthree();\n\t}\n      four();\n}\n';
    await openFile('tidy.js', `${head}function b() {\n      two();\n}\n`);
    const start = doc().indexOf('function b');
    view.dispatch({ selection: { anchor: start, head: doc().length } });
    $('btn-tidy').click();
    await until(() => doc().includes('\n\ttwo();'), () => `the selected lines with a tab, saw ${JSON.stringify(doc())}`, 2000);
    assert(doc().startsWith(head), `lines outside the selection changed: ${JSON.stringify(doc())}`);
  });

  // Teeth: with Tidy re-indenting lines that start inside a string (tidyKeepsLine without the
  // string node check), the lines inside the Java text block or the PHP heredoc change.
  await t('Tidy leaves the lines inside a Java text block, a PHP heredoc and a JS template literal alone', async () => {
    const cases = [
      [
        'Card.java',
        'class Player {\nint score = 0;\n    String card = """\n        <p>\n          hi\n        </p>\n        """;\n}\n',
        /\n[ \t]+int score = 0;\n/,
        '\n        <p>\n          hi\n        </p>\n        """;\n',
      ],
      [
        'card.php',
        '<?php\nfunction card() {\n$n = 1;\n  $s = <<<EOT\n  one\n    two\n  EOT;\n  return $s;\n}\n',
        /\n[ \t]+\$n = 1;\n/,
        '\n  one\n    two\n  EOT;\n',
      ],
      [
        'card.js',
        'function card() {\nconst n = 1;\n  const s = `<p>\n      hi\n  </p>`;\n  return s;\n}\n',
        /\n[ \t]+const n = 1;\n/,
        '\n      hi\n  </p>`;\n',
      ],
    ];
    const problems = [];
    for (const [name, text, tidied, kept] of cases) {
      try {
        await openFile(name, text);
        $('btn-tidy').click();
        await until(() => tidied.test(doc()), () => `${name}: a normal line to be re-indented, saw ${JSON.stringify(doc())}`, 2000);
        assert(doc().includes(kept), `${name}: Tidy changed the string: ${JSON.stringify(doc())}`);
      } catch (error) {
        problems.push(String(error && error.message ? error.message : error));
      }
      flows.__closeAllNow();
      await wait(0);
    }
    assert(!problems.length, problems.join('; '));
  });

  // Teeth: with the <pre> check only in files whose top language is HTML, the lines inside <pre>
  // in page.php change.
  await t('Tidy leaves <pre> alone in a PHP file', async () => {
    await openFile('page.php', '<?php $n = 1; ?>\n<body>\n<div>\n<p>hi</p>\n</div>\n<pre>\n  a\n      b\n</pre>\n</body>\n');
    $('btn-tidy').click();
    await until(() => /\n[ \t]+<p>hi<\/p>\n/.test(doc()), () => `a normal line to be re-indented, saw ${JSON.stringify(doc())}`, 2000);
    assert(doc().includes('\n  a\n      b\n</pre>\n'), `Tidy changed the <pre> lines: ${JSON.stringify(doc())}`);
  });
}
