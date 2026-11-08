import { closeHoverTooltips, hoverTooltip } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { parseNamedColor } from '@replit/codemirror-css-color-picker';

const TAG_PARENTS = new Set(['OpenTag', 'CloseTag', 'SelfClosingTag']);
const PICTURE_ATTRS = new Set(['src', 'poster']);
const PICTURE_TYPES = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;
const LISTS = { tag: 'tags', word: 'words', color: 'colors' };

export function explainExtension({ lookup, onHelpWord, pictureFor }) {
  return hoverTooltip(explainSource({ lookup, onHelpWord, pictureFor }), { hoverTime: 600, hideOnChange: true });
}

export function explainSource({ lookup, onHelpWord, pictureFor }) {
  let rows = null;
  let rowsWait = null;

  function loadRows() {
    if (!rowsWait) {
      rowsWait = new Promise((resolve) => resolve(lookup())).then(
        (value) => {
          rows = value;
          return value;
        },
        () => {
          rowsWait = null;
          return null;
        },
      );
    }
    return rowsWait;
  }

  function wordTip(target, lists) {
    const map = lists && lists[LISTS[target.kind]];
    const row = map && map.get(target.word);
    if (!row) return null;
    return {
      pos: target.from,
      end: target.to,
      create: (view) => ({ dom: explainDom(view, row, target.word, onHelpWord) }),
    };
  }

  return (view, pos, side) => {
    const target = explainTarget(view.state, pos, side);
    if (!target) return null;
    if (target.kind === 'picture') return pictureTip(view, target, pictureFor);
    if (rows) return wordTip(target, rows);
    return loadRows().then((lists) => wordTip(target, lists));
  };
}

export function explainTarget(state, pos, side) {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 50) || syntaxTree(state);
  // Tree.resolveInner remembers its last node per tree, and from a remembered AttributeValue it
  // never enters the style="" overlay. Starting at the top node every time avoids that.
  const node = tree.topNode.resolveInner(pos, side);
  const parent = node.parent;
  if (node.name === 'TagName') {
    return parent && TAG_PARENTS.has(parent.name) ? wordTarget('tag', state, node) : null;
  }
  if (node.name === 'PropertyName') {
    return parent && parent.name === 'Declaration' ? wordTarget('word', state, node) : null;
  }
  if (node.name === 'ValueName') {
    const target = wordTarget('color', state, node);
    return parseNamedColor(target.word) && inDeclaration(node) ? target : null;
  }
  return attributePicture(state, node) || urlPicture(state, node);
}

// The NAME in the picture messages: the last part of the path, decoded.
export function pictureName(src) {
  const path = src.split(/[?#]/)[0];
  const part = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function wordTarget(kind, state, node) {
  return { kind, word: state.sliceDoc(node.from, node.to).toLowerCase(), from: node.from, to: node.to };
}

function inDeclaration(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (n.name === 'Declaration') return true;
    if (n.name === 'Block' || n.name === 'Styles' || n.name === 'StyleSheet') return false;
  }
  return false;
}

function attributePicture(state, node) {
  let value = node;
  if (value.name !== 'AttributeValue' && value.name !== 'UnquotedAttributeValue') {
    value = node.parent;
    if (!value || value.name !== 'AttributeValue') return null;
  }
  const nameNode = value.parent && value.parent.getChild('AttributeName');
  if (!nameNode || !PICTURE_ATTRS.has(state.sliceDoc(nameNode.from, nameNode.to).toLowerCase())) return null;
  const text = state.sliceDoc(value.from, value.to);
  const src = value.name === 'AttributeValue' ? unquote(text) : text.trim();
  return pictureTarget(src, value.from, value.to);
}

function urlPicture(state, node) {
  const call = node.name === 'CallLiteral' ? node : node.parent;
  if (!call || call.name !== 'CallLiteral' || !inDeclaration(call)) return null;
  const tag = call.getChild('CallTag');
  if (!tag || state.sliceDoc(tag.from, tag.to).toLowerCase() !== 'url') return null;
  let src = null;
  for (let c = call.firstChild; c; c = c.nextSibling) {
    if (c.type.isError) return null;
    if (c.name === 'StringLiteral') src = unquote(state.sliceDoc(c.from, c.to));
    else if (c.name === 'ParenthesizedContent') src = state.sliceDoc(c.from, c.to).trim();
  }
  return pictureTarget(src, call.from, call.to);
}

// "cat.png" or 'cat.png' without its quotes. Null when the closing quote is missing.
function unquote(text) {
  const quote = text.charAt(0);
  if ((quote !== '"' && quote !== "'") || text.length < 2 || text.charAt(text.length - 1) !== quote) return null;
  return text.slice(1, -1).trim();
}

function pictureTarget(src, from, to) {
  return src && isPicture(src) ? { kind: 'picture', src, from, to } : null;
}

// A video, a page, a style file or a font is not a picture, and "cannot find" would be untrue
// for it. So only a data:image address, a picture type, or a name with no type at all count.
function isPicture(src) {
  if (/^data:/i.test(src)) return /^data:image\//i.test(src);
  const name = pictureName(src);
  return name !== '' && (name.indexOf('.') < 0 || PICTURE_TYPES.test(name));
}

function pictureTip(view, target, pictureFor) {
  const src = target.src;
  let found = null;
  if (/^data:/i.test(src)) found = { url: src, inline: true };
  else if (/^https?:/i.test(src)) found = { internet: true };
  else if (pictureFor) {
    try {
      found = pictureFor(view, src);
    } catch {
      return null;
    }
  }
  const tip = (value) => {
    if (!value || !(value.internet || value.url || value.unsaved)) return null;
    return {
      pos: target.from,
      end: target.to,
      create: (v) => ({ dom: pictureDom(v, value, src) }),
    };
  };
  return found && typeof found.then === 'function' ? found.then(tip, () => null) : tip(found);
}

function pictureDom(view, found, src) {
  const dom = element('div', 'picture-tip');
  if (found.internet) {
    dom.append(message('This picture is on the internet.'));
    return dom;
  }
  const missing = () => {
    const name = pictureName(src);
    return message(
      found.unsaved
        ? `Save your project first. Then put ${name} in its folder.`
        : `HTML Lab cannot find ${name} in this folder.`,
    );
  };
  if (!found.url) {
    dom.append(missing());
    return dom;
  }
  const img = element('img', 'picture-img');
  img.alt = '';
  // Dragging the picture into the code would paste its preview:// address.
  img.draggable = false;
  img.addEventListener(
    'error',
    () => {
      // A broken data: address has no file name to tell him about, so the tooltip just goes.
      if (!found.inline) img.replaceWith(missing());
      else if (dom.isConnected) view.dispatch({ effects: closeHoverTooltips });
    },
    { once: true },
  );
  img.src = found.url;
  dom.append(img);
  return dom;
}

function explainDom(view, row, word, onHelpWord) {
  const dom = element('div', 'explain-tip');
  const head = element('div', 'explain-head');
  if (row.color) {
    const swatch = element('span', 'explain-swatch');
    swatch.style.background = row.color;
    head.append(swatch);
  }
  const code = element('code', 'explain-code');
  code.textContent = row.code;
  head.append(code);
  const means = element('div', 'explain-means');
  means.textContent = row.means;
  const more = element('button', 'explain-more');
  more.type = 'button';
  more.textContent = 'More in Help';
  // Keep the focus and the cursor in the code, as Help on This Word does from the menu.
  more.addEventListener('mousedown', (event) => event.preventDefault());
  more.addEventListener('click', () => {
    view.dispatch({ effects: closeHoverTooltips });
    if (onHelpWord) onHelpWord(word);
  });
  dom.append(head, means, more);
  return dom;
}

function message(text) {
  const p = element('p', 'picture-msg');
  p.textContent = text;
  return p;
}

function element(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
