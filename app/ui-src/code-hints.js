// Mistake hints for JSON, JavaScript and TypeScript (0.3.0 WP6). Only the json, javascript and
// typescript language chunks import this, so the start-up bundle does not grow.
// Careful on purpose: a hint shows only when the scan below names one of three mistakes (a missing
// comma in JSON, a bracket that never closes, a quote that never closes) and the parser found an
// error there too. Anything else, or anything unclear, shows no hint.

const ERROR = '⚠';
const CLOSER = { '(': ')', '[': ']', '{': '}', '${': '}' };
const COMMA = 'Oops, a comma is missing.';
const BRACKET = 'Oops, this bracket never closes.';
const QUOTE = 'Oops, this quote never closes.';

function bracketMistake(from, to, opener) {
  return {
    from,
    to,
    title: BRACKET,
    text: [{ text: 'Add ' }, { code: CLOSER[opener] }, { text: ' where it should end.' }],
    learn: false,
  };
}

// Marks the quote and the rest of its line.
function quoteMistake(state, from, quote) {
  const line = state.doc.lineAt(from);
  const end = from + line.text.slice(from - line.from).trimEnd().length;
  return {
    from,
    to: Math.max(from + 1, end),
    title: QUOTE,
    text: [{ text: 'Add ' }, { code: quote }, { text: ' at the end of the text.' }],
    learn: false,
  };
}

function commaMistake(state, from, to, afterPos) {
  const n = state.doc.lineAt(afterPos).number;
  return {
    from,
    to,
    title: COMMA,
    text: [
      { text: 'Put a ' },
      { code: ',' },
      { text: ` at the end of line ${n}. Each item in a list needs a comma before the next one.` },
    ],
    learn: false,
  };
}

// The last position the parser marked as wrong, or -1 when the code parses fine.
function lastErrorEnd(tree) {
  let end = -1;
  tree.iterate({
    enter(ref) {
      if (ref.name === ERROR) end = Math.max(end, ref.to);
    },
  });
  return end;
}

const WORD = /[-+.0-9A-Za-z]/;
const LITERAL = /^(true|false|null|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?)$/;

// A small JSON reader that stops at the first thing it does not expect. It names a mistake only
// for the three cases above and returns null for every other problem.
function jsonMistake(state) {
  const text = state.doc.toString();
  const len = text.length;
  const top = { kind: 'top', expect: 'value', first: true, end: 0 };
  const stack = [top];
  const frame = () => stack[stack.length - 1];
  const done = (end) => {
    const f = frame();
    f.expect = 'after';
    f.end = end;
  };
  // A new item where a comma or the end of the list should be.
  const missingComma = (from, to) => {
    const f = frame();
    return f.kind === 'top' ? null : commaMistake(state, from, to, f.end);
  };
  let i = 0;
  while (i < len) {
    const c = text[i];
    const f = frame();
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < len && text[j] !== '"') {
        if (text[j] === '\n' || text[j] === '\r') break;
        if (text[j] === '\\') {
          if (j + 1 >= len || text[j + 1] === '\n' || text[j + 1] === '\r') break;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (j >= len || text[j] !== '"') return quoteMistake(state, i, '"');
      const end = j + 1;
      if (f.expect === 'after') return missingComma(i, end);
      if (f.kind === 'object' && f.expect === 'key') f.expect = 'colon';
      else if (f.expect === 'value') done(end);
      else return null;
      i = end;
    } else if (c === '{' || c === '[') {
      if (f.expect === 'after') return missingComma(i, i + 1);
      if (f.expect !== 'value') return null;
      stack.push({ kind: c === '{' ? 'object' : 'array', open: c, from: i, expect: c === '{' ? 'key' : 'value', first: true, end: i + 1 });
      i += 1;
    } else if (c === '}' || c === ']') {
      if (f.kind === 'top') return null;
      const fits = (c === '}') === (f.kind === 'object');
      const complete = f.expect === 'after' || (f.first && (f.expect === 'key' || f.expect === 'value'));
      if (!complete) return null;
      if (!fits) {
        const deeper = stack.slice(1, -1).some((s) => (c === '}') === (s.kind === 'object'));
        return deeper ? bracketMistake(f.from, f.from + 1, f.open) : null;
      }
      stack.pop();
      done(i + 1);
      i += 1;
    } else if (c === ',') {
      if (f.kind === 'top' || f.expect !== 'after') return null;
      f.expect = f.kind === 'object' ? 'key' : 'value';
      f.first = false;
      i += 1;
    } else if (c === ':') {
      if (f.expect !== 'colon') return null;
      f.expect = 'value';
      i += 1;
    } else if (WORD.test(c)) {
      let j = i + 1;
      while (j < len && WORD.test(text[j])) j += 1;
      if (!LITERAL.test(text.slice(i, j))) return null;
      if (f.expect === 'after') return missingComma(i, j);
      if (f.expect !== 'value') return null;
      done(j);
      i = j;
    } else {
      return null;
    }
  }
  const f = frame();
  if (f.kind === 'top') return null;
  const complete = f.expect === 'after' || (f.first && (f.expect === 'key' || f.expect === 'value'));
  return complete ? bracketMistake(f.from, f.from + 1, f.open) : null;
}

const OPENERS = new Set(['(', '[', '{', 'InterpolationStart']);
const CLOSERS = { ')': ')', ']': ']', '}': '}', InterpolationEnd: '}' };

// True when the text ends with its own quote, and that quote is not escaped.
function closes(text, quote) {
  if (text.length < 2 || text[text.length - 1] !== quote) return false;
  let slashes = 0;
  for (let p = text.length - 2; p >= 1 && text[p] === '\\'; p--) slashes += 1;
  return slashes % 2 === 0;
}

function scriptMistake(state, tree) {
  let quote = null;
  const tokens = [];
  tree.iterate({
    enter(ref) {
      if (quote) return false;
      const name = ref.name;
      if (name === 'String' || name === 'TemplateString') {
        const text = state.sliceDoc(ref.from, ref.to);
        const q = text[0];
        const ok = name === 'String' ? q === '"' || q === "'" : q === '`';
        if (ok && !closes(text, q)) {
          quote = { from: ref.from, q };
          return false;
        }
        return name === 'TemplateString';
      }
      if (ref.from === ref.to) return true;
      if (OPENERS.has(name)) tokens.push({ open: name === 'InterpolationStart' ? '${' : name, from: ref.from, to: ref.to });
      else if (CLOSERS[name]) tokens.push({ close: CLOSERS[name], from: ref.from, to: ref.to });
      return true;
    },
  });
  if (quote) return quoteMistake(state, quote.from, quote.q);
  const stack = [];
  for (const tok of tokens) {
    if (tok.open) {
      stack.push(tok);
      continue;
    }
    const last = stack[stack.length - 1];
    if (last && CLOSER[last.open] === tok.close) {
      stack.pop();
      continue;
    }
    // A closer that fits a bracket further out: the bracket in between never closes. A closer
    // that fits nothing is an extra one, which is a different mistake: no hint.
    if (last && stack.some((s) => CLOSER[s.open] === tok.close)) return bracketMistake(last.from, last.to, last.open);
    return null;
  }
  const last = stack[stack.length - 1];
  return last ? bracketMistake(last.from, last.to, last.open) : null;
}

export function findMistake(state, tree) {
  const top = tree.type.name;
  const mistake = top === 'JsonText' ? jsonMistake(state) : top === 'Script' ? scriptMistake(state, tree) : null;
  if (!mistake) return null;
  // A script string that does not end with its quote is always wrong, even where the parser lets
  // it pass (on the last line). Every other mistake needs the parser to agree: an error at or after it.
  if (top === 'Script' && mistake.title === QUOTE) return mistake;
  return lastErrorEnd(tree) >= mistake.from ? mistake : null;
}
