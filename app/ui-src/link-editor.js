import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';

// The editor side of "the page lights the code": the code's element list, its line-up
// with the page's elements, and the lit lines with the line chip.

// Elements the browser makes by itself when the code leaves them out.
const BROWSER_ADDS = new Set(['html', 'head', 'body', 'tbody']);
const LOOK_AHEAD = 8;

// Start tags that make the browser close an open <p> (HTML parsing rules, "in body").
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p',
  'search', 'section', 'summary', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'listing', 'form',
  'li', 'dd', 'dt', 'plaintext', 'table', 'hr', 'xmp',
]);

// A <p> outside one of these is out of reach for the start tags above ("button scope").
const P_SCOPE = new Set([
  'applet', 'button', 'caption', 'html', 'marquee', 'object', 'table', 'td', 'th', 'template',
  'foreignobject', 'desc', 'mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml',
]);

const elementCache = new WeakMap();

export function codeElements(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 50);
  if (!tree) return null;
  let els = elementCache.get(tree);
  if (!els) {
    els = collectElements(state.doc, tree);
    elementCache.set(tree, els);
  }
  return els;
}

// Walks only Document and Element children, so it never enters tags, text or <style>/<script> content.
// Besides the elements it notes the empty elements the browser makes from a stray </p> or </br>
// (els.phantoms), so the line-up does not pair them with the next real element.
function collectElements(doc, tree) {
  const els = [];
  const phantoms = [];
  const stack = [];
  let openP = 0;
  let pEnd = -1;
  let pDepth = 0;
  let ghost = -1;

  const parentIndex = () => (stack.length ? stack[stack.length - 1].index : -1);
  const phantom = (name) => phantoms.push({ at: els.length, name, parent: parentIndex() });

  function enterElement(node) {
    const parent = parentIndex();
    const frame = { index: parent, name: '', early: false, closed: false };
    const open = node.firstChild;
    const nameNode = open && (open.name === 'OpenTag' || open.name === 'SelfClosingTag') ? open.getChild('TagName') : null;
    if (nameNode) {
      const name = doc.sliceString(nameNode.from, nameNode.to).toLowerCase();
      const close = node.lastChild;
      const closeName = close && close.name === 'CloseTag' ? close.getChild('TagName') : null;
      frame.index = els.length;
      frame.name = name;
      frame.closed = !!closeName;
      els.push({
        name,
        from: node.from,
        to: node.to,
        openTo: open.to,
        nameFrom: nameNode.from,
        nameTo: nameNode.to,
        closeFrom: closeName ? closeName.from : -1,
        closeTo: closeName ? closeName.to : -1,
        parent,
        depth: parent < 0 ? 0 : els[parent].depth + 1,
      });
      if (CLOSES_P.has(name)) {
        ghost = -1;
        if (openP > 0) markEarlyP();
      }
      if (name === 'p') openP++;
    }
    stack.push(frame);
  }

  // The browser closes a <p> here that the tree keeps open, so its </p> later makes an empty <p>.
  function markEarlyP() {
    for (let i = stack.length - 1; i >= 0; i--) {
      const frame = stack[i];
      if (frame.name === 'p') {
        frame.early = true;
        return;
      }
      if (P_SCOPE.has(frame.name)) return;
    }
  }

  function leaveElement(to) {
    const frame = stack.pop();
    if (frame.name === 'p') {
      openP--;
      if (frame.early && frame.closed) phantom('p');
      else if (!frame.closed) {
        pEnd = to;
        pDepth = stack.length;
      }
    }
    if (ghost > stack.length) ghost = -1;
  }

  function strayCloseTag(node) {
    const nameNode = node.getChild('TagName');
    const name = nameNode ? doc.sliceString(nameNode.from, nameNode.to).toLowerCase() : '';
    // The tree ended a <p> at this stray tag, but the browser skips the tag and keeps the <p> open.
    if (node.from === pEnd) ghost = pDepth;
    if (name === 'p') {
      if (ghost >= 0) ghost = -1;
      else phantom('p');
    } else if (name === 'br') {
      phantom('br');
    }
  }

  tree.iterate({
    enter(ref) {
      const name = ref.type.name;
      if (name === 'Element') {
        enterElement(ref.node);
        return true;
      }
      if (name === 'MismatchedCloseTag') strayCloseTag(ref.node);
      return name === 'Document' || ref.type.isError;
    },
    leave(ref) {
      if (ref.type.name === 'Element') leaveElement(ref.to);
    },
  });
  els.phantoms = phantoms;
  return els;
}

export function alignPage(els, pageNames) {
  const code = codeOrder(els || []);
  const page = pageNames || [];
  const pageToCode = new Int32Array(page.length).fill(-1);
  const codeToPage = new Int32Array(els ? els.length : 0).fill(-1);
  let i = 0;
  let k = 0;
  while (i < page.length && k < code.names.length) {
    const p = page[i];
    const c = code.names[k];
    if (p === c) {
      const index = code.index[k];
      if (index >= 0) {
        pageToCode[i] = index;
        codeToPage[index] = i;
      }
      i++;
      k++;
      continue;
    }
    const codeSkip = stepsTo(code.names, k, p);
    if (!codeSkip && BROWSER_ADDS.has(p)) {
      i++;
      continue;
    }
    const pageSkip = stepsTo(page, i, c);
    if (pageSkip && (!codeSkip || pageSkip <= codeSkip)) i += pageSkip;
    else if (codeSkip) k += codeSkip;
    else {
      i++;
      k++;
    }
  }
  return { pageToCode, codeToPage };
}

function stepsTo(list, at, name) {
  const end = Math.min(list.length, at + LOOK_AHEAD + 1);
  for (let j = at + 1; j < end; j++) if (list[j] === name) return j - at;
  return 0;
}

// The code's names in the order the browser meets them: the phantoms go in, and whatever sits
// inside <template> goes out, because the browser keeps template content out of the page.
function codeOrder(els) {
  const phantoms = els.phantoms || [];
  const hidden = new Uint8Array(els.length);
  const inTemplate = (parent) => parent >= 0 && (hidden[parent] === 1 || els[parent].name === 'template');
  const names = [];
  const index = [];
  let next = 0;
  for (let i = 0; i <= els.length; i++) {
    for (; next < phantoms.length && phantoms[next].at <= i; next++) {
      if (inTemplate(phantoms[next].parent)) continue;
      names.push(phantoms[next].name);
      index.push(-1);
    }
    if (i === els.length) break;
    if (inTemplate(els[i].parent)) {
      hidden[i] = 1;
      continue;
    }
    names.push(els[i].name);
    index.push(i);
  }
  return { names, index };
}

export function elementAt(state, pos) {
  const els = codeElements(state);
  if (!els) return -1;
  // The list is in document order, so the holder is the last element starting before pos or one of its parents.
  let low = 0;
  let high = els.length - 1;
  let k = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (els[mid].from < pos) {
      k = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  while (k >= 0 && pos >= els[k].to) k = els[k].parent;
  return k;
}

// True when el still names an element of this document (an old list must not light the wrong code).
function fits(state, el) {
  return (
    !!el &&
    el.from < el.to &&
    el.to <= state.doc.length &&
    el.nameFrom > el.from &&
    el.nameTo <= el.to &&
    state.sliceDoc(el.nameFrom, el.nameTo).toLowerCase() === el.name
  );
}

const setLitEffect = StateEffect.define();

const litField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (tr.docChanged) return null;
    for (const effect of tr.effects) if (effect.is(setLitEffect)) value = effect.value;
    return value;
  },
});

export function setLit(view, el) {
  if (!view) return;
  const state = view.state;
  const current = state.field(litField, false);
  if (current === undefined) return;
  const next = fits(state, el) ? el : null;
  if (current === next || (current && next && current.from === next.from && current.to === next.to)) return;
  view.dispatch({ effects: setLitEffect.of(next) });
}

export function selectTagName(view, el) {
  if (!view || !fits(view.state, el)) return;
  const scroll = offScreen(view, el.nameFrom) ? { y: 'center' } : { y: 'nearest', yMargin: 48 };
  view.dispatch({
    selection: { anchor: el.nameFrom, head: el.nameTo },
    effects: EditorView.scrollIntoView(el.nameFrom, scroll),
  });
  view.focus();
}

function offScreen(view, pos) {
  try {
    return sideOf(view, pos, view.scrollDOM.getBoundingClientRect()) !== null;
  } catch (error) {
    // The layout cannot be read while the editor is updating: judge by the drawn part instead.
    return pos < view.viewport.from || pos > view.viewport.to;
  }
}

// 'up' or 'down' when the text at pos is above or below the scroller's visible box, else null.
function sideOf(view, pos, box) {
  if (box.bottom - box.top < 1) return null;
  const block = view.lineBlockAt(pos);
  const docTop = view.documentTop;
  let top = docTop + block.top;
  let bottom = docTop + block.bottom;
  if (bottom > box.top && top < box.bottom) {
    const at = view.coordsAtPos(pos, 1);
    if (!at) return null;
    top = at.top;
    bottom = at.bottom;
  }
  const middle = (top + bottom) / 2;
  if (middle < box.top) return 'up';
  if (middle > box.bottom) return 'down';
  return null;
}

const litLine = Decoration.line({ class: 'cm-lit' });
const litFirst = Decoration.line({ class: 'cm-lit cm-lit-first' });
const litLast = Decoration.line({ class: 'cm-lit cm-lit-last' });
const litOnly = Decoration.line({ class: 'cm-lit cm-lit-first cm-lit-last' });
const litTag = Decoration.mark({ class: 'cm-lit-tag' });

// Lines of el that lie in ranges (the view's visibleRanges), plus marks on both tag names.
// Exported for the node tests; the app reaches it only through linkExtension().
export function litDecorations(state, el, ranges) {
  if (!fits(state, el)) return Decoration.none;
  const doc = state.doc;
  const first = doc.lineAt(el.from).number;
  const last = lastLineOf(doc, el, first);
  const marks = [];
  let next = first;
  for (const range of ranges) {
    const end = Math.min(last, doc.lineAt(range.to).number);
    for (let n = Math.max(next, doc.lineAt(range.from).number); n <= end; n++) {
      const kind = n === first ? (n === last ? litOnly : litFirst) : n === last ? litLast : litLine;
      marks.push(kind.range(doc.line(n).from));
      next = n + 1;
    }
  }
  marks.push(litTag.range(el.nameFrom, el.nameTo));
  if (el.closeFrom >= 0 && el.closeTo <= doc.length) marks.push(litTag.range(el.closeFrom, el.closeTo));
  return Decoration.set(marks, true);
}

// An element without a closing tag ends where the next one starts, often on the next line's indent.
function lastLineOf(doc, el, first) {
  let line = doc.lineAt(el.to);
  if (el.closeFrom >= 0) return line.number;
  while (line.number > first && !/\S/.test(doc.sliceString(line.from, Math.min(el.to, line.to)))) {
    line = doc.line(line.number - 1);
  }
  return line.number;
}

function litOf(state) {
  return state.field(litField, false) || null;
}

class LitView {
  constructor(view) {
    this.view = view;
    this.lit = litOf(view.state);
    this.deco = this.lit ? litDecorations(view.state, this.lit, view.visibleRanges) : Decoration.none;
    this.chip = null;
    this.chipText = null;
    this.chipIcon = null;
    this.shown = '';
    this.dead = false;
    this.measureRequest = { key: this, read: (v) => this.read(v), write: (m) => this.write(m) };
    if (this.lit) view.requestMeasure(this.measureRequest);
  }

  update(update) {
    const lit = litOf(update.state);
    const changed = lit !== this.lit;
    this.lit = lit;
    if (changed || (lit && update.viewportChanged)) {
      this.deco = lit ? litDecorations(update.state, lit, update.view.visibleRanges) : Decoration.none;
    }
    if (!lit) this.removeChip();
    else if (changed || update.viewportChanged || update.geometryChanged) this.measure();
  }

  measure() {
    this.view.requestMeasure(this.measureRequest);
  }

  read(view) {
    const lit = this.lit;
    if (this.dead || !lit || !fits(view.state, lit)) return null;
    const box = view.scrollDOM.getBoundingClientRect();
    const side = sideOf(view, lit.nameFrom, box);
    if (!side) return null;
    const outer = view.dom.getBoundingClientRect();
    return {
      side,
      line: view.state.doc.lineAt(lit.nameFrom).number,
      top: Math.round(box.top - outer.top),
      bottom: Math.round(outer.bottom - box.bottom),
    };
  }

  write(m) {
    if (this.dead || !m || !this.lit) {
      this.removeChip();
      return;
    }
    const key = m.side + ' ' + m.line + ' ' + m.top + ' ' + m.bottom;
    if (key === this.shown) return;
    this.shown = key;
    if (!this.chip) this.makeChip();
    const up = m.side === 'up';
    this.chip.className = up ? 'lit-chip lit-chip-up' : 'lit-chip lit-chip-down';
    this.chipText.textContent = 'Line ' + m.line;
    this.chipIcon.setAttribute('href', up ? '#i-caret-up-bold' : '#i-caret-down-bold');
    // The scroller's box, not the editor's, so an open Find bar never sits under the chip.
    this.chip.style.top = up ? m.top + 8 + 'px' : '';
    this.chip.style.bottom = up ? '' : m.bottom + 8 + 'px';
  }

  makeChip() {
    const chip = document.createElement('button');
    chip.type = 'button';
    const text = document.createElement('span');
    text.className = 'lit-chip-text';
    chip.append(text);
    chip.insertAdjacentHTML('beforeend', '<svg class="icon s14" aria-hidden="true"><use href="#i-caret-down-bold"></use></svg>');
    chip.addEventListener('mousedown', (event) => event.preventDefault());
    chip.addEventListener('click', () => {
      if (this.lit) selectTagName(this.view, this.lit);
    });
    this.view.dom.append(chip);
    this.chip = chip;
    this.chipText = text;
    this.chipIcon = chip.querySelector('use');
  }

  removeChip() {
    if (!this.chip) return;
    this.chip.remove();
    this.chip = null;
    this.chipText = null;
    this.chipIcon = null;
    this.shown = '';
  }

  destroy() {
    this.dead = true;
    this.removeChip();
  }
}

const litPlugin = ViewPlugin.fromClass(LitView, {
  decorations: (value) => value.deco,
  eventObservers: {
    scroll() {
      if (this.lit) this.measure();
    },
  },
});

const linkParts = [litField, litPlugin];

export function linkExtension() {
  return linkParts;
}
