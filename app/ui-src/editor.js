import { Annotation, Compartment, EditorState, Facet, Prec, Transaction } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  tooltips,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  selectAll,
  toggleComment,
  undo,
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  ensureSyntaxTree,
  indentOnInput,
  indentRange,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, search, searchKeymap, searchPanelOpen } from '@codemirror/search';
import { autoCloseTags, html, htmlLanguage } from '@codemirror/lang-html';
import { css, cssLanguage } from '@codemirror/lang-css';
import { highlightTree, tags as t } from '@lezer/highlight';
import { colorPicker } from '@replit/codemirror-css-color-picker';
import { findMistake, mistakeHints, unfinishedTagAt } from './hints.js';
import { countMatches, countText, findPanel } from './find-panel.js';
import { cssRuleAt, foldHere, insidePath, selectRange, structureExtension, unfoldEverything, unfoldHere } from './structure.js';
import { alignPage, codeElements, elementAt, linkExtension, selectTagName, setLit } from './link-editor.js';
import { explainExtension } from './explain.js';
import { codePath } from './code-path.js';
import { legacyFolding } from './legacy-fold.js';

// The teaching languages are built in. Every other language is a chunk of its own, loaded on
// demand, one per row of LANGUAGES in core kinds.rs ("text" has none). A static map, so esbuild
// can split them.
function teachingLanguage(language) {
  switch (language) {
    case 'html':
      return { extension: html({ autoCloseTags: false }), parser: htmlLanguage.parser, hints: true, colors: false };
    case 'css':
      return { extension: css(), parser: cssLanguage.parser, hints: false, colors: true };
    default:
      return null;
  }
}

const LANGUAGE_CHUNKS = {
  javascript: () => import('./langs/javascript.js'),
  typescript: () => import('./langs/typescript.js'),
  json: () => import('./langs/json.js'),
  markdown: () => import('./langs/markdown.js'),
  xml: () => import('./langs/xml.js'),
  scss: () => import('./langs/scss.js'),
  sass: () => import('./langs/sass.js'),
  less: () => import('./langs/less.js'),
  yaml: () => import('./langs/yaml.js'),
  python: () => import('./langs/python.js'),
  php: () => import('./langs/php.js'),
  sql: () => import('./langs/sql.js'),
  cpp: () => import('./langs/cpp.js'),
  java: () => import('./langs/java.js'),
  go: () => import('./langs/go.js'),
  rust: () => import('./langs/rust.js'),
  swift: () => import('./langs/swift.js'),
  lua: () => import('./langs/lua.js'),
  shell: () => import('./langs/shell.js'),
  powershell: () => import('./langs/powershell.js'),
  ruby: () => import('./langs/ruby.js'),
  toml: () => import('./langs/toml.js'),
  ini: () => import('./langs/ini.js'),
};

const BUILT_IN = new Set(['html', 'css', 'text']);
const loaded = new Map(); // id -> wrapper module, or null for a language shown as plain text
const loading = new Map();

function loadOne(id) {
  if (BUILT_IN.has(id) || loaded.has(id)) return null;
  if (loading.has(id)) return loading.get(id);
  const chunk = LANGUAGE_CHUNKS[id];
  const wait = (chunk ? chunk() : Promise.resolve(null)).then(
    (mod) => {
      loaded.set(id, mod && typeof mod.support === 'function' ? mod : null);
    },
    (error) => {
      // A missing chunk must not stop the child from opening the file: it opens as plain
      // text, and the error still reaches the error log, so a test run fails.
      loaded.set(id, null);
      setTimeout(() => {
        throw error;
      });
    },
  );
  loading.set(id, wait);
  wait.finally(() => loading.delete(id));
  return wait;
}

export function loadLanguages(ids) {
  const waits = [...new Set(ids || [])].map(loadOne).filter(Boolean);
  return waits.length ? Promise.all(waits).then(() => undefined) : Promise.resolve();
}

export function languageLoaded(id) {
  return BUILT_IN.has(id) || loaded.has(id);
}

const codeColors = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket, t.bracket], class: 'c-tag' },
  { tag: t.attributeName, class: 'c-attr' },
  { tag: [t.attributeValue, t.string], class: 'c-str' },
  { tag: [t.comment, t.documentMeta, t.processingInstruction, t.separator, t.punctuation], class: 'c-dim' },
  { tag: [t.propertyName, t.definitionKeyword], class: 'c-prop' },
  { tag: [t.bool, t.null], class: 'c-bool' },
  { tag: t.regexp, class: 'c-re' },
  {
    tag: [t.number, t.unit, t.color, t.keyword, t.atom, t.literal, t.constant(t.name), t.function(t.name)],
    class: 'c-val',
  },
  { tag: [t.className, t.labelName, t.constant(t.className), t.modifier], class: 'c-tag' },
  { tag: t.typeName, class: 'c-type' },
  { tag: t.variableName, class: 'c-var' },
  { tag: t.operator, class: 'c-op' },
  { tag: t.heading, class: 'c-head' },
  { tag: t.emphasis, class: 'c-em' },
  { tag: t.link, class: 'c-link' },
  { tag: t.meta, class: 'c-meta' },
  { tag: [t.content, t.name], class: 'c-text' },
]);

const theme = EditorView.theme({
  '&.cm-editor': {
    height: '100%',
    backgroundColor: 'var(--panel)',
    color: 'var(--c-text)',
    fontSize: 'var(--code-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-code)',
    lineHeight: 'var(--code-lh)',
    overflow: 'auto',
    paddingTop: '8px',
  },
  '.cm-content': { caretColor: 'var(--brand)', padding: '0 12px 24px 0' },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--num)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': {
    width: '54px',
    boxSizing: 'border-box',
    padding: '0 16px 0 0',
    textAlign: 'right',
  },
  '.cm-activeLine': { backgroundColor: 'var(--active)' },
  // The selection is drawn under the lines, so a solid active line would hide it.
  '&.has-selection .cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-editor .cm-searchMatch': { backgroundColor: 'var(--find)', borderRadius: '3px' },
  '&.cm-editor .cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--find-now)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--brand)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--selection)' },
  '.cm-panels': {
    backgroundColor: 'var(--strip)',
    color: 'var(--ink)',
    borderBottom: '1px solid var(--line)',
    fontFamily: 'var(--font-ui)',
    fontSize: '14px',
  },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--font-ui)', fontSize: '14px' },
  '.cm-tooltip': {
    backgroundColor: 'var(--panel)',
    color: 'var(--ink)',
    border: '1px solid var(--line)',
    borderRadius: '8px',
    fontFamily: 'var(--font-code)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--active)', color: 'var(--ink)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--pair)',
    color: 'inherit',
    borderRadius: '3px',
    boxShadow: 'inset 0 0 0 1px var(--pair-line)',
  },
  // A tag with no partner happens all the time while typing; the mistake hint covers real mistakes.
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'transparent', color: 'inherit' },
});

const searchKeys = searchKeymap.filter((binding) => binding.key !== 'Mod-Shift-l');

let tipRoot = null;
function tooltipRoot() {
  if (!tipRoot) {
    tipRoot = document.createElement('div');
    tipRoot.id = 'tooltip-root';
    document.body.append(tipRoot);
  }
  return tipRoot;
}

const contentAttrs = EditorView.contentAttributes.of({
  spellcheck: 'false',
  autocorrect: 'off',
  autocapitalize: 'off',
  'aria-label': 'Code',
});

const selectionClass = EditorView.editorAttributes.compute(['selection'], (state) =>
  state.selection.ranges.some((range) => !range.empty) ? { class: 'has-selection' } : null,
);

// Esc in the code closes the Find bar. Low precedence, so an open suggestion list closes first.
const escapeClosesFind = Prec.low(
  keymap.of([{ key: 'Escape', run: (view) => searchPanelOpen(view.state) && closeSearchPanel(view) }]),
);

const helpers = new Compartment();
const measureStamp = new Compartment();
const indenting = new Compartment();
const languagePart = new Compartment();

// Whether the state's file is a teaching kind (kind.teaching, C47). Set with the language.
const teachingFlag = Facet.define({ combine: (values) => (values.length ? values[0] : false) });

// Each file keeps its own indent: a tab, or 2 to 8 spaces. Both facets take the
// first value they get, so the file's own indent comes first in every state.
function indentFor(indent) {
  const width = Math.min(8, Math.max(2, Math.round(Number(indent && indent.width)) || 2));
  return [indentUnit.of(indent && indent.tabs ? '\t' : ' '.repeat(width)), EditorState.tabSize.of(width)];
}

// Teaching kinds get the tag closer and suggestions; other files only close their brackets (C47).
export function helpersFor(teaching, on) {
  if (!on) return [];
  if (!teaching) return [closeBrackets(), keymap.of(closeBracketsKeymap)];
  return [
    autoCloseTags,
    closeBrackets(),
    autocompletion({ icons: false }),
    keymap.of([...closeBracketsKeymap, ...completionKeymap]),
  ];
}

function makeShared() {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    drawSelection(),
    history(),
    indentOnInput(),
    bracketMatching(),
    search({ top: true, createPanel: findPanel }),
    selectionClass,
    escapeClosesFind,
    EditorView.lineWrapping,
    syntaxHighlighting(codeColors),
    theme,
    contentAttrs,
    tooltips({ parent: tooltipRoot() }),
    keymap.of([indentWithTab, ...defaultKeymap, ...searchKeys, ...historyKeymap]),
  ];
}

export function createEditor(host, callbacks) {
  let restTimer = 0;
  const wakeCaret = () => {
    host.classList.remove('caret-still');
    clearTimeout(restTimer);
    restTimer = setTimeout(() => host.classList.add('caret-still'), 5000);
  };
  const shared = makeShared();
  const hints = mistakeHints({ onChange: callbacks.onHintChange, onLearn: callbacks.onLearn });
  const mistakeOf = (state) => {
    const value = state.field(hints.field, false);
    return value ? value.mistake : null;
  };
  const folding = structureExtension({ mistakeOf });
  const teachingSeeing = [
    linkExtension(),
    explainExtension({
      lookup: callbacks.lookup,
      onHelpWord: callbacks.onHelpWord,
      pictureFor: callbacks.pictureFor,
    }),
  ];
  let typingOn = true;

  const updates = EditorView.updateListener.of((update) => {
    if ((update.selectionSet || update.focusChanged) && update.view.hasFocus) wakeCaret();
    if (callbacks.onUpdate) callbacks.onUpdate(update);
  });

  const perTeaching = new Map();
  function teachingExtensions(language) {
    if (!perTeaching.has(language)) {
      const info = teachingLanguage(language);
      perTeaching.set(language, [
        info.extension,
        info.hints ? hints.extension : [],
        info.colors ? colorPicker : [],
        teachingSeeing,
      ]);
    }
    return perTeaching.get(language);
  }

  // Throws for a language whose chunk is not loaded, so a path that forgot loadLanguages fails
  // a test instead of showing the file without colours.
  function languageExtensions(language, teaching, fileName) {
    if (!languageLoaded(language)) throw new Error(`the language ${language} is not loaded`);
    const part = [teachingFlag.of(!!teaching)];
    if (teaching && teachingLanguage(language)) return [part, teachingExtensions(language)];
    if (language === 'html' || language === 'css') return [part, teachingLanguage(language).extension];
    const mod = loaded.get(language);
    if (!mod) return part;
    // JSON, JavaScript and TypeScript chunks bring their own mistake finder (code-hints.js, WP6).
    const finder = mod.findMistake ? hints.forDetector(mod.findMistake) : [];
    return [part, mod.support(fileName || ''), mod.legacy ? legacyFolding : [], finder];
  }

  function newState(text, language, indent, { teaching = false, fileName = '' } = {}) {
    const langExt = languageExtensions(language, teaching, fileName);
    return EditorState.create({
      doc: text,
      extensions: [
        indenting.of(indentFor(indent)),
        shared,
        helpers.of(helpersFor(teaching, typingOn)),
        measureStamp.of([]),
        languagePart.of(langExt),
        folding,
        updates,
      ],
    });
  }

  function applyEffects(tab, effects) {
    if (tab.view) tab.view.dispatch({ effects });
    else tab.state = tab.state.update({ effects }).state;
  }

  function makeView(state, hidden = false) {
    const box = document.createElement('div');
    box.className = 'editor-box';
    box.hidden = hidden;
    host.append(box);
    const made = new EditorView({ state, parent: box });
    made.htmllabBox = box;
    made.contentDOM.addEventListener('focus', wakeCaret);
    made.contentDOM.addEventListener('keydown', wakeCaret);
    made.contentDOM.addEventListener('mousedown', wakeCaret);
    return made;
  }
  const blank = makeView(newState('', 'html', null, { teaching: true }));
  let current = blank;

  function showView(next) {
    if (next === current) return;
    current.htmllabBox.hidden = true;
    next.htmllabBox.hidden = false;
    current = next;
  }

  return {
    get view() {
      return current;
    },
    newState,
    loadLanguages,
    languageLoaded,
    // Same state, so undo history and folds survive (a rename that changes the type, WP5).
    setLanguage(tab, id, { teaching, fileName } = {}) {
      const state = tab.view ? tab.view.state : tab.state;
      const teach = teaching === undefined ? state.facet(teachingFlag) : !!teaching;
      const effects = [
        languagePart.reconfigure(languageExtensions(id, teach, fileName === undefined ? tab.name : fileName)),
        helpers.reconfigure(helpersFor(teach, typingOn)),
      ];
      applyEffects(tab, effects);
      tab.language = id;
    },
    show(tab) {
      if (!tab.view) {
        tab.view = makeView(tab.state, true);
        tab.view.htmllabTab = tab;
        showView(tab.view);
        return;
      }
      if (tab.view.state !== tab.state) {
        const keep = tab.view.scrollSnapshot();
        tab.view.setState(tab.state);
        tab.view.dispatch({ effects: keep });
      }
      showView(tab.view);
    },
    showBlank() {
      showView(blank);
    },
    drop(tab) {
      if (!tab.view) return;
      if (current === tab.view) showView(blank);
      tab.view.destroy();
      tab.view.htmllabBox.remove();
      tab.view = null;
    },
    setTypingHelpers(on, tabs) {
      typingOn = on;
      for (const tab of tabs) {
        const state = tab.view ? tab.view.state : tab.state;
        applyEffects(tab, helpers.reconfigure(helpersFor(state.facet(teachingFlag), on)));
      }
    },
    remeasure(tabs) {
      const effect = measureStamp.reconfigure(EditorView.theme({}));
      blank.dispatch({ effects: effect });
      for (const tab of tabs) if (tab.view) tab.view.dispatch({ effects: effect });
    },
    setText(tabState, text) {
      return tabState.update({ changes: { from: 0, to: tabState.doc.length, insert: text } }).state;
    },
    hintActive(state) {
      const value = state.field(hints.field, false);
      return !!(value && value.mistake);
    },
  };
}

export function runEdit(view, action) {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    document.execCommand(action === 'select-all' ? 'selectAll' : action);
    return;
  }
  if (!view.hasFocus) return;
  if (action === 'undo') undo(view);
  else if (action === 'redo') redo(view);
  else selectAll(view);
}

export function runFind(view, action) {
  if (action === 'find' || action === 'replace') {
    openSearchPanel(view);
    if (action === 'replace') {
      const field = view.dom.querySelector('.cm-panel input[name="replace"]');
      if (field) field.focus();
    }
  } else if (action === 'find-next') {
    findNext(view);
  } else if (action === 'find-prev') {
    findPrevious(view);
  }
}

export function commentLine(view) {
  toggleComment(view);
}

// The lines Tidy works on: the selected lines, or every line. A selection that ends at the
// start of a line leaves that line out.
function tidyLines(state) {
  const sel = state.selection.main;
  if (sel.empty) return { from: 0, to: state.doc.length };
  const first = state.doc.lineAt(sel.from);
  let last = state.doc.lineAt(sel.to);
  if (sel.to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
  return { from: first.from, to: last.to };
}

// The string nodes of the grammars Tidy works on (Java text blocks, PHP heredocs and nowdocs,
// JS and TS template literals, C++ and Rust raw strings, Go raw strings, Python strings).
// The spaces at the start of a line inside one are part of the text.
const TIDY_STRING_NODES = new Set([
  'String',
  'StringLiteral',
  'TemplateString',
  'TextBlock',
  'HeredocString',
  'NowdocString',
  'RawString',
  'FormatString',
]);

// True when the line that starts at pos is inside a string that began on an earlier line, or
// inside <pre> or <textarea>. resolveInner also enters mounted trees, so the HTML in a PHP file
// and the JS in a <script> are checked too.
function tidyKeepsLine(state, tree, pos) {
  for (let node = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (node.from >= pos) continue;
    if (TIDY_STRING_NODES.has(node.name)) return true;
    if (node.name === 'Element') {
      const open = node.firstChild;
      const nameNode = open && open.name === 'OpenTag' && pos > open.to ? open.getChild('TagName') : null;
      const name = nameNode ? state.sliceDoc(nameNode.from, nameNode.to).toLowerCase() : '';
      if (name === 'pre' || name === 'textarea') return true;
    }
  }
  return false;
}

// Tidy only changes the indents, with the file's own indent unit (the indenting compartment).
export function tidyChanges(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  if (!tree) return null;
  const changes = [];
  const { from, to } = tidyLines(state);
  indentRange(state, from, to).iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (tidyKeepsLine(state, tree, fromA)) return;
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return changes.length ? changes : null;
}

export function tidy(view) {
  const changes = tidyChanges(view.state);
  if (changes) view.dispatch({ changes, userEvent: 'input.indent' });
}

export function wordAtCursor(state) {
  const { from, to, empty } = state.selection.main;
  if (!empty) {
    const text = state.sliceDoc(from, to);
    return /^[A-Za-z0-9-]+$/.test(text) ? text.toLowerCase() : '';
  }
  const line = state.doc.lineAt(from);
  const offset = from - line.from;
  const before = /[A-Za-z0-9-]*$/.exec(line.text.slice(0, offset))[0];
  const after = /^[A-Za-z0-9-]*/.exec(line.text.slice(offset))[0];
  return (before + after).toLowerCase();
}

export function insertBlock(view, text) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  const indent = /^[ \t]*/.exec(line.text)[0];
  const insert = text.split('\n').map((part, i) => (i === 0 || !part ? part : indent + part)).join('\n');
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
  view.focus();
}

export function insertLineChange(state, lineIndex, text) {
  const lineNo = Math.min(lineIndex + 1, state.doc.lines + 1);
  if (lineNo > state.doc.lines) return { from: state.doc.length, insert: '\n' + text };
  const line = state.doc.line(lineNo);
  return { from: line.from, insert: text + '\n' };
}

// Help shows only teaching code (C47).
export function highlightRuns(code, language) {
  const info = teachingLanguage(language);
  if (!info) return [{ text: code, cls: '' }];
  const tree = info.parser.parse(code);
  const runs = [];
  let at = 0;
  highlightTree(tree, codeColors, (from, to, classes) => {
    if (from > at) runs.push({ text: code.slice(at, from), cls: 'c-text' });
    runs.push({ text: code.slice(from, to), cls: classes });
    at = to;
  });
  if (at < code.length) runs.push({ text: code.slice(at), cls: 'c-text' });
  return runs;
}

export { findMistake, unfinishedTagAt, EditorView, ensureSyntaxTree, countMatches, countText };
export { codePath, cssRuleAt, foldHere, insidePath, selectRange, unfoldEverything, unfoldHere };
export { alignPage, codeElements, elementAt, selectTagName, setLit };

export { runScopeHandlers } from '@codemirror/view';
export { undo, redo, Transaction };

// Marks the edits Change Name makes in a tab (0.3.0 WP5): they are not typing, and the
// Undo toast does not count them as a change of the user's own.
export const renameEdit = Annotation.define();
