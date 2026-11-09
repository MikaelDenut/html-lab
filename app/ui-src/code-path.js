// The "You are inside" row for the languages that are not teaching kinds (WP2 step 10).
// JavaScript and TypeScript: classes, functions, methods and the blocks around the cursor.
// Python: classes, defs and blocks. JSON: the key path. Other languages have no row (null).
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

const LABEL_MAX = 40;

const JS_BLOCKS = {
  IfStatement: 'if',
  ForStatement: 'for',
  WhileStatement: 'while',
  DoStatement: 'do',
  SwitchStatement: 'switch',
  TryStatement: 'try',
};

const PY_BLOCKS = {
  IfStatement: 'if',
  ForStatement: 'for',
  WhileStatement: 'while',
  TryStatement: 'try',
  WithStatement: 'with',
};

function treeOf(state) {
  return ensureSyntaxTree(state, state.doc.length, 20) || syntaxTree(state);
}

function short(text) {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1)}…` : one;
}

function nameOf(state, node, ...names) {
  for (const name of names) {
    const child = node.getChild(name);
    if (child) return short(state.sliceDoc(child.from, child.to));
  }
  return '';
}

// The name a function without its own name gets from where it is kept: const jump = () => {}
// or jump: function () {}.
function keptName(state, node) {
  const parent = node.parent;
  if (!parent) return '';
  if (parent.name === 'VariableDeclaration' || parent.name === 'Property') {
    let before = node.prevSibling;
    while (before && before.name !== 'VariableDefinition' && before.name !== 'PropertyDefinition') before = before.prevSibling;
    return before ? short(state.sliceDoc(before.from, before.to)) : '';
  }
  return '';
}

function jsLabel(state, node) {
  switch (node.name) {
    case 'ClassDeclaration':
    case 'ClassExpression': {
      const name = nameOf(state, node, 'VariableDefinition');
      return name ? `class ${name}` : '';
    }
    case 'FunctionDeclaration': {
      const name = nameOf(state, node, 'VariableDefinition');
      return name ? `function ${name}` : '';
    }
    case 'FunctionExpression':
    case 'ArrowFunction': {
      const name = nameOf(state, node, 'VariableDefinition') || keptName(state, node);
      return name ? `function ${name}` : '';
    }
    case 'MethodDeclaration': {
      const name = nameOf(state, node, 'PropertyDefinition', 'PrivatePropertyDefinition');
      return name ? `method ${name}` : '';
    }
    case 'Property': {
      if (!node.getChild('ParamList')) return '';
      const name = nameOf(state, node, 'PropertyDefinition');
      return name ? `method ${name}` : '';
    }
    default:
      return JS_BLOCKS[node.name] || '';
  }
}

function pyLabel(state, node) {
  if (node.name === 'ClassDefinition') {
    const name = nameOf(state, node, 'VariableName');
    return name ? `class ${name}` : '';
  }
  if (node.name === 'FunctionDefinition') {
    const name = nameOf(state, node, 'VariableName');
    return name ? `def ${name}` : '';
  }
  return PY_BLOCKS[node.name] || '';
}

// A brace block ends before its "}"; an indented Python block reaches to the end of its last line.
function holds(node, sel, endInside) {
  if (!sel.empty) return node.from <= sel.from && sel.to <= node.to;
  return node.from < sel.head && (sel.head < node.to || (endInside && sel.head === node.to));
}

function startNode(tree, sel) {
  return sel.empty ? tree.resolveInner(sel.head, -1) : tree.resolveInner(sel.from, 1);
}

function namedPath(state, label, endInside) {
  const sel = state.selection.main;
  const items = [];
  for (let node = startNode(treeOf(state), sel); node; node = node.parent) {
    const text = label(state, node);
    if (text && holds(node, sel, endInside)) items.push({ label: text, from: node.from, to: node.to });
  }
  return items.reverse();
}

const JSON_PUNCTUATION = new Set(['[', ']', ',']);

function unquote(text) {
  try {
    const value = JSON.parse(text);
    if (typeof value === 'string') return value;
  } catch {
    // An unfinished key shows as it is typed.
  }
  return text.replace(/^"|"$/g, '');
}

function jsonPath(state) {
  const sel = state.selection.main;
  const items = [];
  let child = null;
  for (let node = startNode(treeOf(state), sel); node; child = node, node = node.parent) {
    if (!holds(node, sel, true)) continue;
    if (node.name === 'Property') {
      const key = node.getChild('PropertyName');
      if (key) items.push({ label: short(unquote(state.sliceDoc(key.from, key.to))), from: node.from, to: node.to });
    } else if (node.name === 'Array' && child) {
      let index = 0;
      let found = false;
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (JSON_PUNCTUATION.has(c.name) || c.type.isError) continue;
        if (c.from === child.from && c.to === child.to) {
          found = true;
          break;
        }
        index++;
      }
      if (found) items.push({ label: String(index), from: child.from, to: child.to });
    }
  }
  return items.reverse();
}

const PATHS = {
  javascript: (state) => namedPath(state, jsLabel, false),
  typescript: (state) => namedPath(state, jsLabel, false),
  python: (state) => namedPath(state, pyLabel, true),
  json: jsonPath,
};

// Null when the language has no row.
export function codePath(state, languageId) {
  const make = PATHS[languageId];
  if (!make) return null;
  const items = make(state);
  const kind = items.length ? 'code' : 'no-code';
  return { kind, items, key: kind + JSON.stringify(items.map((item) => item.label)) };
}
