import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import {
  codeFolding,
  ensureSyntaxTree,
  foldEffect,
  foldGutter,
  foldNodeProp,
  foldState,
  foldable,
  foldedRanges,
  language,
  syntaxTree,
  unfoldAll,
  unfoldCode,
} from '@codemirror/language';

const FOLD_TITLE = 'Fold this part';
const UNFOLD_TITLE = 'Unfold this part';
const OOPS_TITLE = 'Something is wrong in here. Click to see it.';
const OOPS_ICON = '<svg class="icon s14" aria-hidden="true"><use href="#i-oops-bold"></use></svg>';
const LABEL_MAX = 40;

const AT_RULES = new Set([
  'MediaStatement', 'SupportsStatement', 'KeyframesStatement', 'ScopeStatement', 'FontFeatureStatement',
  'AtRule', 'ImportStatement', 'CharsetStatement', 'NamespaceStatement',
]);

function treeOf(state) {
  return ensureSyntaxTree(state, state.doc.length, 20) || syntaxTree(state);
}

// A tag that never closes, or a rule that is missing its "}", reaches to where the next letter would go.
function openEnded(node) {
  const last = node.lastChild;
  if (node.name === 'Element') {
    const first = node.firstChild;
    return !!first && first.name === 'OpenTag' && (!last || last.name !== 'CloseTag');
  }
  if (!last || last.type.isError) return true;
  if (last.name === 'Block' || last.name === 'KeyframeList') return openBlock(last);
  return false;
}

function openBlock(block) {
  const end = block.lastChild;
  return !end || end.name !== '}';
}

// An empty cursor must be strictly inside, or at the very end of something open-ended.
// A selection is inside when the part holds all of it.
function holds(from, to, open, sel) {
  if (!sel.empty) return from <= sel.from && sel.to <= to;
  return from < sel.head && (sel.head < to || (open && sel.head === to));
}

function lastLineOf(doc, from, to) {
  return doc.lineAt(to > from && doc.lineAt(to).from === to ? to - 1 : to);
}

function spansLines(doc, part) {
  return doc.lineAt(part.from).number < lastLineOf(doc, part.from, part.to).number;
}

function hasError(node) {
  let found = false;
  node.cursor().iterate((c) => {
    if (c.type.isError) found = true;
    return !found;
  });
  return found;
}

function tagLabel(state, element) {
  const open = element.firstChild;
  if (!open || (open.name !== 'OpenTag' && open.name !== 'SelfClosingTag')) return '';
  const name = open.getChild('TagName');
  return name ? state.sliceDoc(name.from, name.to).toLowerCase() : '';
}

export function selectorLabel(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > LABEL_MAX ? clean.slice(0, LABEL_MAX - 1).trimEnd() + '…' : clean;
}

// Where the selector of a RuleSet ends: at its Block, or at the parser's error mark while it is unfinished.
function selectorEnd(rule) {
  const block = rule.getChild('Block');
  if (block) return block.from;
  for (let c = rule.firstChild; c; c = c.nextSibling) if (c.type.isError) return c.from;
  return rule.to;
}

// "h1 {\n  col" while typing a property: CSS nesting reads "col" as a rule with no "{" yet inside the
// Block of h1. A rule like that inside another rule is a declaration being typed, not a rule. Inside an
// at-rule's Block (like @media) it is a selector being typed, so it stays a rule.
function typingDeclaration(node) {
  const block = node.parent;
  return (
    node.name === 'RuleSet' &&
    !node.getChild('Block') &&
    !!block &&
    block.name === 'Block' &&
    !!block.parent &&
    block.parent.name === 'RuleSet'
  );
}

function atLabel(state, node) {
  const match = /^@[-\w]*/.exec(state.sliceDoc(node.from, Math.min(node.to, node.from + 80)));
  return match ? match[0].toLowerCase() : '@';
}

// A keyframe like "50%, 60% { ... }" has no node of its own: its selectors and Block sit side by side.
function keyframeRule(node) {
  let block = node.name === 'Block' ? node : null;
  let last = node;
  if (!block) {
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      if (next.name === 'Block') {
        block = next;
        break;
      }
      if (next.name === 'KeyframeSelector') last = next;
      else if (next.name !== ',') break;
    }
  }
  let first = block ? null : node;
  for (let prev = (block || node).prevSibling; prev; prev = prev.prevSibling) {
    if (prev.name === 'KeyframeSelector') first = prev;
    else if (prev.name !== ',') break;
  }
  if (!first) return null;
  return {
    from: first.from,
    to: block ? block.to : last.to,
    selTo: block ? block.from : last.to,
    open: !block || openBlock(block),
  };
}

function itemFor(state, node, sel) {
  const name = node.name;
  if (name === 'Element') {
    const label = tagLabel(state, node);
    return label && holds(node.from, node.to, openEnded(node), sel) ? { label, from: node.from, to: node.to } : null;
  }
  if (name === 'RuleSet') {
    if (typingDeclaration(node) || !holds(node.from, node.to, openEnded(node), sel)) return null;
    const label = selectorLabel(state.sliceDoc(node.from, Math.min(selectorEnd(node), node.from + 400)));
    return label ? { label, from: node.from, to: node.to } : null;
  }
  if (AT_RULES.has(name)) {
    return holds(node.from, node.to, openEnded(node), sel) ? { label: atLabel(state, node), from: node.from, to: node.to } : null;
  }
  if ((name === 'Block' || name === 'KeyframeSelector') && node.parent && node.parent.name === 'KeyframeList') {
    const rule = keyframeRule(node);
    if (!rule || !holds(rule.from, rule.to, rule.open, sel)) return null;
    const label = selectorLabel(state.sliceDoc(rule.from, Math.min(rule.selTo, rule.from + 400)));
    return label ? { label, from: rule.from, to: rule.to } : null;
  }
  return null;
}

export function insidePath(state) {
  const tree = treeOf(state);
  const lang = state.facet(language);
  const isCss = lang ? lang.name === 'css' : tree.type.name === 'StyleSheet';
  const sel = state.selection.main;
  const items = [];
  let rules = [];
  let node = sel.empty ? tree.resolveInner(sel.head, -1) : tree.resolveInner(sel.from, 1);
  for (; node; node = node.parent) {
    const item = itemFor(state, node, sel);
    if (item && node.name === 'Element') items.push(item);
    else if (item) rules.push(item);
    else if (node.name === 'StyleSheet') {
      items.push(...rules);
      rules = [];
    } else if (node.name === 'Styles') {
      rules = [];
    }
  }
  items.reverse();
  const kind = items.length ? (isCss ? 'rule' : 'tags') : isCss ? 'no-rule' : 'no-tag';
  return { kind, items, key: kind + JSON.stringify(items.map((item) => item.label)) };
}

function selectorHasError(rule) {
  for (let c = rule.firstChild; c; c = c.nextSibling) {
    if (c.name === 'Block') break;
    if (hasError(c)) return true;
  }
  return false;
}

export function cssRuleAt(state, pos) {
  const tree = treeOf(state);
  let best = null;
  for (const side of [-1, 1]) {
    for (let node = tree.resolveInner(pos, side); node; node = node.parent) {
      if (typingDeclaration(node)) continue;
      if ((node.name === 'RuleSet' || node.name === 'KeyframesStatement') && (!best || node.from > best.from)) best = node;
    }
  }
  if (!best || best.name !== 'RuleSet') return null;
  for (let up = best.parent; up && up.name !== 'StyleSheet'; up = up.parent) {
    if (up.name === 'KeyframesStatement' || up.name === 'Styles') return null;
  }
  const end = selectorEnd(best);
  const raw = state.sliceDoc(best.from, end);
  const sel = raw.trim();
  const selFrom = best.from + (raw.length - raw.trimStart().length);
  const ok = !!best.getChild('Block') && !!sel && !selectorHasError(best);
  return { sel, ok, from: best.from, to: best.to, selFrom, selTo: selFrom + sel.length };
}

export function selectRange(view, from, to) {
  const length = view.state.doc.length;
  const anchor = Math.max(0, Math.min(from, length));
  const head = Math.max(0, Math.min(to, length));
  view.dispatch({
    selection: { anchor, head },
    effects: EditorView.scrollIntoView(anchor, { y: 'nearest', yMargin: 48 }),
  });
  view.focus();
}

// ---------- Folding

function isFolded(state, range) {
  let found = false;
  foldedRanges(state).between(range.from, range.from, (a, b) => {
    if (a === range.from && b === range.to) found = true;
  });
  return found;
}

// The part Fold This Part folds: the one whose arrow is on the cursor's line, or else the innermost
// part around the cursor. A part that is already folded gives way to the next one out.
export function foldRangeAt(state, pos) {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  const onLine = foldable(state, line.from, line.to);
  if (onLine && !isFolded(state, onLine)) return onLine;
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    const prop = node.type.prop(foldNodeProp);
    const range = prop ? prop(node, state) : null;
    if (range && doc.lineAt(range.to).number > doc.lineAt(range.from).number && !isFolded(state, range)) return range;
  }
  return null;
}

export function foldedLineCount(doc, range) {
  return Math.max(1, doc.lineAt(range.to).number - doc.lineAt(range.from).number - 1);
}

export function pillText(lines) {
  return lines === 1 ? '1 line folded' : `${lines} lines folded`;
}

// True when the fold hides the mistake's underline or its hint box (a block widget at the end of its line).
export function mistakeInFold(doc, mistake, range) {
  if (!mistake) return false;
  if (mistake.from < range.to && mistake.to > range.from) return true;
  const hintAt = doc.lineAt(Math.min(mistake.to, doc.length)).to;
  return hintAt > range.from && hintAt < range.to;
}

export function paintPill(pill, lines, oops) {
  const text = pillText(lines);
  const title = oops ? OOPS_TITLE : UNFOLD_TITLE;
  if (pill.title !== title) pill.title = title;
  if (pill.classList.contains('oops') !== oops) pill.classList.toggle('oops', oops);
  const icon = pill.firstChild && pill.firstChild.nodeType === 1 ? pill.firstChild : null;
  if (oops && !icon) pill.insertAdjacentHTML('afterbegin', OOPS_ICON);
  else if (!oops && icon) icon.remove();
  const label = pill.lastChild && pill.lastChild.nodeType === 3 ? pill.lastChild : null;
  if (!label) pill.append(text);
  else if (label.data !== text) label.data = text;
}

export function foldMark(open) {
  const mark = document.createElement('span');
  mark.className = open ? 'fold-mark' : 'fold-mark folded';
  mark.title = open ? FOLD_TITLE : UNFOLD_TITLE;
  mark.innerHTML = `<svg class="icon s14" aria-hidden="true"><use href="#i-${open ? 'caret-down' : 'caret-right'}-bold"></use></svg>`;
  return mark;
}

function foldsChanged(update) {
  return update.startState.field(foldState, false) !== update.state.field(foldState, false);
}

// The pill text and its Oops look are set when a part folds. This keeps them right afterwards, when the
// text inside changes, the mistake comes or goes, or a pill is drawn again.
function pillKeeper(mistakeOf) {
  const request = {
    read(view) {
      const { state } = view;
      if (!foldedRanges(state).size) return null;
      const mistake = mistakeOf(state);
      const found = [];
      for (const pill of view.contentDOM.querySelectorAll('.fold-pill')) {
        const pos = view.posAtDOM(pill);
        let range = null;
        foldedRanges(state).between(pos, pos, (a, b) => {
          if (a === pos) range = { from: a, to: b };
        });
        if (range) found.push({ pill, lines: foldedLineCount(state.doc, range), oops: mistakeInFold(state.doc, mistake, range) });
      }
      return found;
    },
    write(found) {
      if (found) for (const p of found) paintPill(p.pill, p.lines, p.oops);
    },
  };
  const plugin = ViewPlugin.fromClass(
    class {
      update(update) {
        if (!foldedRanges(update.state).size) return;
        if (
          update.docChanged ||
          update.viewportChanged ||
          foldsChanged(update) ||
          mistakeOf(update.startState) !== mistakeOf(update.state)
        ) {
          update.view.requestMeasure(request);
        }
      }
    },
  );
  return { request, plugin };
}

export function foldHere(view) {
  const { state } = view;
  if (!state.field(foldState, false)) return false;
  const head = state.selection.main.head;
  const range = foldRangeAt(state, head);
  if (!range) return false;
  const spec = { effects: [foldEffect.of(range), EditorView.announce.of(pillText(foldedLineCount(state.doc, range)))] };
  // A selection head inside a fold unfolds it again, so the cursor goes to the fold start.
  if (head > range.from && head < range.to) {
    spec.selection = { anchor: range.from };
    spec.scrollIntoView = true;
  }
  view.dispatch(spec);
  return true;
}

export function unfoldHere(view) {
  return unfoldCode(view);
}

export function unfoldEverything(view) {
  return unfoldAll(view);
}

// ---------- Section band

const arrowEffect = StateEffect.define();

const BAND = {
  'cm-band': Decoration.line({ class: 'cm-band' }),
  'cm-band cm-band-first': Decoration.line({ class: 'cm-band cm-band-first' }),
  'cm-band cm-band-last': Decoration.line({ class: 'cm-band cm-band-last' }),
  'cm-band cm-band-first cm-band-last': Decoration.line({ class: 'cm-band cm-band-first cm-band-last' }),
};

function bandClass(first, last) {
  return 'cm-band' + (first ? ' cm-band-first' : '') + (last ? ' cm-band-last' : '');
}

// The element or rule a fold range belongs to: what the band covers while the mouse is on its arrow.
export function foldPart(state, range) {
  for (let node = syntaxTree(state).resolveInner(range.from, -1); node; node = node.parent) {
    const prop = node.type.prop(foldNodeProp);
    const made = prop ? prop(node, state) : null;
    if (made && made.from === range.from && made.to === range.to) {
      if (node.name === 'Block' && node.parent && node.parent.name === 'KeyframeList') {
        const rule = keyframeRule(node);
        if (rule) return { from: rule.from, to: rule.to };
      }
      const part = node.name === 'Element' || !node.parent ? node : node.parent;
      return { from: part.from, to: part.to };
    }
  }
  return { from: range.from, to: range.to };
}

// The band for the cursor: on a tag name of an element, or in the selector of a CSS rule, spanning 2+ lines.
export function cursorBand(state) {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const tree = treeOf(state);
  for (const side of [-1, 1]) {
    const node = tree.resolveInner(sel.head, side);
    const tag = node.parent;
    if (node.name === 'TagName' && tag && (tag.name === 'OpenTag' || tag.name === 'CloseTag')) {
      const element = tag.parent;
      return element && element.name === 'Element' && spansLines(state.doc, element)
        ? { from: element.from, to: element.to }
        : null;
    }
  }
  const rule = cssRuleAt(state, sel.head);
  if (rule && sel.head >= rule.selFrom && sel.head <= rule.selTo && spansLines(state.doc, rule)) {
    return { from: rule.from, to: rule.to };
  }
  return null;
}

// A line whose start sits inside a fold is drawn as part of the line where that fold starts.
function visualLineStart(state, pos) {
  for (let guard = 0; guard < 64; guard++) {
    let hiddenBy = -1;
    foldedRanges(state).between(pos, pos, (a, b) => {
      if (a < pos && pos <= b && (hiddenBy < 0 || a < hiddenBy)) hiddenBy = a;
    });
    if (hiddenBy < 0) return pos;
    pos = state.doc.lineAt(hiddenBy).from;
  }
  return pos;
}

// Line starts and classes for the band over part, limited to the given visible ranges.
export function bandLines(state, part, ranges) {
  const doc = state.doc;
  const firstLine = doc.lineAt(part.from);
  const lastLine = lastLineOf(doc, part.from, part.to);
  const out = [];
  if (firstLine.number >= lastLine.number) return out;
  const lastStart = visualLineStart(state, lastLine.from);
  for (const range of ranges) {
    const lo = Math.max(range.from, firstLine.from);
    const hi = Math.min(range.to, lastLine.to);
    if (lo > hi) continue;
    let line = doc.lineAt(lo);
    if (line.from < lo) {
      if (line.number >= lastLine.number) continue;
      line = doc.line(line.number + 1);
    }
    while (line.from <= hi) {
      // A line that starts where a fold ends (or inside it) is drawn on the fold's own line.
      if (line.from === firstLine.from || visualLineStart(state, line.from) === line.from) {
        out.push([line.from, bandClass(line.from === firstLine.from, line.from === lastStart)]);
      }
      if (line.number >= lastLine.number) break;
      line = doc.line(line.number + 1);
    }
  }
  return out;
}

function arrowPart(view, pos) {
  const { state } = view;
  if (pos > state.doc.length) return null;
  const line = view.lineBlockAt(pos);
  let range = null;
  foldedRanges(state).between(line.from, line.to, (a, b) => {
    if (!range || range.from > a) range = { from: a, to: b };
  });
  range = range || foldable(state, line.from, line.to);
  return range ? foldPart(state, range) : null;
}

function buildBand(view, arrow) {
  const part = (arrow !== null && arrowPart(view, arrow)) || cursorBand(view.state);
  if (!part) return Decoration.none;
  const builder = new RangeSetBuilder();
  for (const [pos, cls] of bandLines(view.state, part, view.visibleRanges)) builder.add(pos, pos, BAND[cls]);
  return builder.finish();
}

const bandView = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.arrow = null;
      this.decorations = buildBand(view, null);
    }
    update(update) {
      let changed =
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        foldsChanged(update) ||
        syntaxTree(update.startState) !== syntaxTree(update.state);
      if (this.arrow !== null && update.docChanged) this.arrow = update.changes.mapPos(this.arrow);
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(arrowEffect)) {
            this.arrow = effect.value;
            changed = true;
          }
        }
      }
      if (changed) this.decorations = buildBand(update.view, this.arrow);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function setArrow(view, pos) {
  const plugin = view.plugin(bandView);
  if (plugin && plugin.arrow !== pos) view.dispatch({ effects: arrowEffect.of(pos) });
}

const gutterOptions = {
  markerDOM: foldMark,
  domEventHandlers: {
    mouseover(view, line, event) {
      const target = event.target;
      const element = target && target.closest ? target.closest('.cm-gutterElement') : null;
      setArrow(view, element && element.querySelector('.fold-mark') ? line.from : null);
      return false;
    },
    mouseleave(view) {
      setArrow(view, null);
      return false;
    },
  },
};

export function structureExtension({ mistakeOf } = {}) {
  const getMistake = (state) => (mistakeOf && mistakeOf(state)) || null;
  const keeper = pillKeeper(getMistake);
  return [
    codeFolding({
      preparePlaceholder: (state, range) => ({
        lines: foldedLineCount(state.doc, range),
        oops: mistakeInFold(state.doc, getMistake(state), range),
      }),
      placeholderDOM(view, onclick, prepared) {
        const pill = document.createElement('span');
        pill.className = 'fold-pill';
        pill.onclick = onclick;
        paintPill(pill, prepared ? prepared.lines : 1, !!(prepared && prepared.oops));
        view.requestMeasure(keeper.request);
        return pill;
      },
    }),
    foldGutter(gutterOptions),
    keeper.plugin,
    bandView,
  ];
}
