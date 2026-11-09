// Folding for the stream (legacy) modes, which carry no fold information of their own.
// A line that ends with an opening bracket folds to its partner; any other line folds over
// the lines after it that are indented deeper.
import { countColumn } from '@codemirror/state';
import { foldService, matchBrackets } from '@codemirror/language';

const SCAN_LINES = 10000;
const OPENER = /[{[(][ \t]*$/;

function depthOf(text, tabSize) {
  return countColumn(/^[ \t]*/.exec(text)[0], tabSize);
}

function bracketFold(state, line) {
  const open = OPENER.exec(line.text);
  if (!open) return null;
  const at = line.from + open.index;
  const match = matchBrackets(state, at, 1);
  if (!match || !match.matched || !match.end) return null;
  return state.doc.lineAt(match.end.from).number > line.number ? { from: at + 1, to: match.end.from } : null;
}

function indentFold(state, line) {
  const doc = state.doc;
  const depth = depthOf(line.text, state.tabSize);
  const last = Math.min(doc.lines, line.number + SCAN_LINES);
  let end = null;
  for (let n = line.number + 1; n <= last; n++) {
    const next = doc.line(n);
    if (!next.text.trim()) continue;
    if (depthOf(next.text, state.tabSize) <= depth) break;
    end = next;
  }
  return end ? { from: line.to, to: end.to } : null;
}

export const legacyFolding = foldService.of((state, from) => {
  const line = state.doc.lineAt(from);
  if (!line.text.trim()) return null;
  return bracketFold(state, line) || indentFold(state, line);
});
