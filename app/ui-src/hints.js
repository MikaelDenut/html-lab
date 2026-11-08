import { StateEffect, StateField, RangeSet } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';

const MAY_OMIT_CLOSE = new Set([
  'p', 'li', 'dt', 'dd', 'option', 'optgroup', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'colgroup', 'caption',
  'html', 'head', 'body',
]);

const ERROR = '⚠';
const NEVER_CLOSES = 'Oops, this tag never closes.';
const NOT_FINISHED = 'Oops, this tag is not finished.';

export function unfinishedTagAt(doc, pos) {
  const before = doc.sliceString(Math.max(0, pos - 2000), pos);
  const lastLt = before.lastIndexOf('<');
  if (lastLt < 0 || lastLt < before.lastIndexOf('>')) return false;
  const next = before[lastLt + 1] ?? doc.sliceString(pos, pos + 1);
  if (!next || !/[a-zA-Z/!]/.test(next)) return false;
  const after = doc.sliceString(pos, Math.min(doc.length, pos + 2000));
  const nextGt = after.indexOf('>');
  const nextLt = after.indexOf('<');
  if (nextGt < 0) return true;
  return nextLt >= 0 && nextLt < nextGt;
}

function tagNameOf(state, tagNode) {
  const name = tagNode.getChild('TagName');
  return name ? state.sliceDoc(name.from, name.to) : '';
}

function hasError(node) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === ERROR) return true;
  }
  return false;
}

function treeHasError(node) {
  let found = false;
  node.cursor().iterate((c) => {
    if (c.name === ERROR) found = true;
    return !found;
  });
  return found;
}

function notFinished(state, tag) {
  let quote = false;
  for (let c = tag.firstChild; c; c = c.nextSibling) {
    if (c.name !== 'Attribute') continue;
    const value = c.getChild('AttributeValue');
    if (value && treeHasError(value)) quote = true;
    if (!value && hasError(c)) quote = quote || state.sliceDoc(c.from, c.to).includes('"');
  }
  const text = quote
    ? [{ text: 'This tag has a quote that never closes.' }]
    : [{ text: 'A tag ends with ' }, { code: '>' }, { text: '. Try adding one here.' }];
  return { from: tag.from, to: tag.to, title: NOT_FINISHED, text };
}

export function findMistake(state, tree) {
  let found = null;
  tree.iterate({
    enter(ref) {
      if (found) return false;
      const node = ref.node;
      if (ref.name === 'OpenTag' || ref.name === 'CloseTag' || ref.name === 'SelfClosingTag') {
        if (hasError(node)) {
          found = notFinished(state, node);
          return false;
        }
        return false;
      }
      if (ref.name !== 'Element') return true;
      const open = node.firstChild;
      if (!open || open.name !== 'OpenTag' || hasError(open)) return true;
      const last = node.lastChild;
      if (last && last.name === 'CloseTag') return true;
      const name = tagNameOf(state, open);
      if (!name || MAY_OMIT_CLOSE.has(name.toLowerCase())) return true;
      for (let c = open.nextSibling; c; c = c.nextSibling) {
        if (c.name === 'Element') {
          const inner = c.firstChild;
          if (inner && inner.name === 'OpenTag' && !hasError(inner) && tagNameOf(state, inner) === name) {
            found = {
              from: inner.from,
              to: inner.to,
              title: NEVER_CLOSES,
              text: [{ text: 'A closing tag needs a slash. Try ' }, { code: `</${name}>` }, { text: ' here.' }],
            };
            return false;
          }
        }
      }
      found = {
        from: open.from,
        to: open.to,
        title: NEVER_CLOSES,
        text: [{ text: 'Add ' }, { code: `</${name}>` }, { text: ' where it should end.' }],
      };
      return false;
    },
  });
  return found;
}

const setMistake = StateEffect.define();
const hideMistake = StateEffect.define();

class HintWidget extends WidgetType {
  constructor(mistake, callbacks) {
    super();
    this.mistake = mistake;
    this.callbacks = callbacks;
  }

  eq(other) {
    return other.mistake.title === this.mistake.title && textKey(other.mistake) === textKey(this.mistake);
  }

  toDOM(view) {
    const box = document.createElement('div');
    box.className = 'hint-box';
    box.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'hint-icon';
    icon.innerHTML = '<svg width="28" height="28" aria-hidden="true"><use href="#i-oops"></use></svg>';
    box.append(icon);
    const body = document.createElement('div');
    body.className = 'hint-body';
    const title = document.createElement('div');
    title.className = 'hint-title';
    title.textContent = this.mistake.title;
    const text = document.createElement('div');
    text.className = 'hint-text';
    for (const part of this.mistake.text) {
      if (part.code) {
        const code = document.createElement('code');
        code.textContent = part.code;
        text.append(code);
      } else {
        text.append(part.text);
      }
    }
    const links = document.createElement('div');
    links.className = 'hint-links';
    const learn = document.createElement('button');
    learn.className = 'hint-link';
    learn.dataset.act = 'learn';
    learn.textContent = 'Learn about tags';
    learn.addEventListener('click', () => this.callbacks.onLearn && this.callbacks.onLearn());
    const hide = document.createElement('button');
    hide.className = 'hint-link';
    hide.dataset.act = 'hide';
    hide.textContent = 'Hide this hint';
    hide.addEventListener('click', () => view.dispatch({ effects: hideMistake.of(null) }));
    links.append(learn, hide);
    body.append(title, text, links);
    box.append(body);
    return box;
  }

  ignoreEvent() {
    return true;
  }
}

function textKey(mistake) {
  return mistake.text.map((p) => p.code || p.text).join('');
}

const markDeco = Decoration.mark({ class: 'cm-mistake' });

export function mistakeHints(callbacks) {
  const field = StateField.define({
    create() {
      return { mistake: null, hiddenKey: null, deco: Decoration.none };
    },
    update(value, tr) {
      let { mistake, hiddenKey, deco } = value;
      deco = deco.map(tr.changes);
      if (mistake && tr.docChanged) {
        const from = tr.changes.mapPos(mistake.from, 1);
        const to = tr.changes.mapPos(mistake.to, -1);
        mistake = to > from ? { ...mistake, from, to } : null;
        if (!mistake) deco = Decoration.none;
      }
      for (const e of tr.effects) {
        if (e.is(setMistake)) {
          mistake = e.value;
          deco = build(tr.state, mistake, hiddenKey, callbacks);
        } else if (e.is(hideMistake) && mistake) {
          hiddenKey = keyOf(tr.state, mistake);
          deco = build(tr.state, mistake, hiddenKey, callbacks);
        }
      }
      return { mistake, hiddenKey, deco };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.timer = 0;
        this.schedule();
      }
      update(update) {
        if (update.docChanged || update.selectionSet) this.schedule();
      }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.check(), 800);
      }
      check() {
        const state = this.view.state;
        if (unfinishedTagAt(state.doc, state.selection.main.head)) return;
        const tree = ensureSyntaxTree(state, state.doc.length, 100);
        if (!tree) return;
        const next = findMistake(state, tree);
        const current = state.field(field).mistake;
        const same =
          (!next && !current) ||
          (next && current && next.from === current.from && next.to === current.to && textKey(next) === textKey(current));
        if (!same) this.view.dispatch({ effects: setMistake.of(next) });
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
  );

  const listener = EditorView.updateListener.of((update) => {
    const before = update.startState.field(field, false);
    const after = update.state.field(field, false);
    if (callbacks.onChange && (before ? !!before.mistake : false) !== (after ? !!after.mistake : false)) {
      callbacks.onChange();
    }
  });

  return { extension: [field, plugin, listener], field };
}

function keyOf(state, mistake) {
  return mistake.title + '|' + state.sliceDoc(mistake.from, mistake.to);
}

function build(state, mistake, hiddenKey, callbacks) {
  if (!mistake) return Decoration.none;
  const ranges = [markDeco.range(mistake.from, mistake.to)];
  if (keyOf(state, mistake) !== hiddenKey) {
    const line = state.doc.lineAt(mistake.to);
    ranges.push(Decoration.widget({ widget: new HintWidget(mistake, callbacks), block: true, side: 1 }).range(line.to));
  }
  return RangeSet.of(ranges, true);
}
