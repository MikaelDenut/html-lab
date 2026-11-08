// The Find bar above the code. It replaces CodeMirror's own search panel, which is made for
// programmers (regexp, by word, match case). Kids get two boxes, plain words and a count.
import { runScopeHandlers } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search';

// Counting stops here, so a huge page with a one-letter search stays fast.
const COUNT_CAP = 999;

function make(tag, className, attrs = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function field(name, placeholder) {
  const input = make('input', 'find-field', {
    type: 'text',
    name,
    placeholder,
    'aria-label': placeholder,
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
  });
  return input;
}

function button(label, name, onClick, extra = '') {
  const b = make('button', `btn btn-secondary find-btn ${extra}`.trim(), { type: 'button', name });
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// How many matches there are, and which one is picked. Exported for the tests.
export function countMatches(state, query) {
  if (!query.valid) return { total: 0, at: 0, capped: false };
  const sel = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let at = 0;
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total += 1;
    if (r.value.from === sel.from && r.value.to === sel.to) at = total;
    if (total > COUNT_CAP) return { total: COUNT_CAP, at: 0, capped: true };
  }
  return { total, at, capped: false };
}

export function countText({ total, at, capped }, hasText) {
  if (!hasText) return '';
  if (capped) return `${COUNT_CAP}+ found`;
  if (total === 0) return 'Not found';
  if (at) return `${at} of ${total}`;
  return total === 1 ? '1 found' : `${total} found`;
}

export function findPanel(view) {
  let query = getSearchQuery(view.state);

  const search = field('search', 'Find a word');
  search.setAttribute('main-field', 'true');
  const replace = field('replace', 'Change it to');
  search.value = query.search;
  replace.value = query.replace;

  const commit = () => {
    const next = new SearchQuery({ search: search.value, replace: replace.value, literal: true });
    if (!next.eq(query)) view.dispatch({ effects: setSearchQuery.of(next) });
  };
  search.addEventListener('input', commit);
  replace.addEventListener('input', commit);

  const run = (command) => () => {
    commit();
    command(view);
  };

  const count = make('span', 'find-count', { 'aria-live': 'polite' });
  const close = make('button', 'find-close', { type: 'button', name: 'close', 'aria-label': 'Close the Find bar', title: 'Close (Esc)' });
  close.textContent = '×';
  close.addEventListener('click', () => closeSearchPanel(view));

  const rowFind = make('div', 'find-row');
  rowFind.append(
    search,
    button('Back', 'prev', run(findPrevious)),
    button('Next', 'next', run(findNext)),
    count,
    close,
  );
  const rowChange = make('div', 'find-row');
  rowChange.append(
    replace,
    button('Change', 'replace', run(replaceNext)),
    button('Change all', 'replaceAll', run(replaceAll)),
  );

  const dom = make('div', 'hl-find', { role: 'search', 'aria-label': 'Find and change' });
  dom.append(rowFind, rowChange);

  dom.addEventListener('keydown', (event) => {
    // Esc, Cmd+G, Cmd+Shift+G and the rest of the search keys.
    if (runScopeHandlers(view, event, 'search-panel')) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.target === search) {
      event.preventDefault();
      run(event.shiftKey ? findPrevious : findNext)();
    } else if (event.target === replace) {
      event.preventDefault();
      run(replaceNext)();
    }
  });

  const recount = (state) => {
    const result = countMatches(state, query);
    count.textContent = countText(result, query.search !== '');
    count.classList.toggle('none', query.search !== '' && result.total === 0);
  };

  return {
    dom,
    top: true,
    mount() {
      // Typing right after Cmd+F must land here, never in the code.
      search.select();
      recount(view.state);
    },
    update(update) {
      const fresh = getSearchQuery(update.state);
      const changed = !fresh.eq(query);
      if (changed) {
        query = fresh;
        if (search.value !== fresh.search) search.value = fresh.search;
        if (replace.value !== fresh.replace) replace.value = fresh.replace;
      }
      if (changed || update.docChanged || update.selectionSet) recount(update.state);
    },
  };
}
