import { Compartment, EditorState, Prec } from '@codemirror/state';
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

function languageFor(language) {
  switch (language) {
    case 'html':
      return { extension: html({ autoCloseTags: false }), parser: htmlLanguage.parser, hints: true, colors: false };
    case 'css':
      return { extension: css(), parser: cssLanguage.parser, hints: false, colors: true };
    default:
      return { extension: [], parser: null, hints: false, colors: false };
  }
}

const codeColors = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket, t.bracket], class: 'c-tag' },
  { tag: t.attributeName, class: 'c-attr' },
  { tag: [t.attributeValue, t.string], class: 'c-str' },
  { tag: [t.comment, t.documentMeta, t.processingInstruction, t.separator, t.punctuation], class: 'c-dim' },
  { tag: [t.propertyName, t.definitionKeyword], class: 'c-prop' },
  {
    tag: [t.number, t.unit, t.color, t.keyword, t.atom, t.bool, t.literal, t.constant(t.name), t.function(t.name)],
    class: 'c-val',
  },
  { tag: [t.className, t.labelName, t.constant(t.className), t.modifier], class: 'c-tag' },
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
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--active)', color: 'inherit' },
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

function helpersOn() {
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
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
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
  let typingOn = true;

  const updates = EditorView.updateListener.of((update) => {
    if ((update.selectionSet || update.focusChanged) && update.view.hasFocus) wakeCaret();
    if (callbacks.onUpdate) callbacks.onUpdate(update);
  });

  const perLanguage = new Map();
  function languageExtensions(language) {
    if (!perLanguage.has(language)) {
      const info = languageFor(language);
      perLanguage.set(language, [
        info.extension,
        info.hints ? hints.extension : [],
        info.colors ? colorPicker : [],
      ]);
    }
    return perLanguage.get(language);
  }

  function newState(text, language) {
    return EditorState.create({
      doc: text,
      extensions: [shared, helpers.of(typingOn ? helpersOn() : []), measureStamp.of([]), languageExtensions(language), updates],
    });
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
  const blank = makeView(newState('', 'html'));
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
      const effect = helpers.reconfigure(on ? helpersOn() : []);
      for (const tab of tabs) {
        if (tab.view) tab.view.dispatch({ effects: effect });
        else tab.state = tab.state.update({ effects: effect }).state;
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

export function tidyChanges(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  if (!tree) return null;
  const keep = [];
  tree.iterate({
    enter(ref) {
      if (ref.name !== 'Element') return true;
      const node = ref.node;
      const open = node.firstChild;
      if (!open || open.name !== 'OpenTag') return true;
      const nameNode = open.getChild('TagName');
      const name = nameNode ? state.sliceDoc(nameNode.from, nameNode.to).toLowerCase() : '';
      if (name === 'pre' || name === 'textarea') {
        keep.push([open.to, node.to]);
        return false;
      }
      return true;
    },
  });
  const changes = [];
  indentRange(state, 0, state.doc.length).iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (keep.some(([from, to]) => fromA > from && fromA <= to)) return;
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

export function highlightRuns(code, language) {
  const info = languageFor(language);
  if (!info.parser) return [{ text: code, cls: '' }];
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

export { runScopeHandlers } from '@codemirror/view';
export { undo, redo };
