export const counted = { sheets: 0, pages: 0, snippets: 0, unread: [] };
export function resetCounted() {
  Object.assign(counted, { sheets: 0, pages: 0, snippets: 0, unread: [] });
}

function engineRules(css) {
  const style = document.createElement('style');
  style.media = 'not all';
  style.textContent = css;
  document.head.append(style);
  const rules = [...style.sheet.cssRules];
  style.remove();
  return rules;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      i = end === -1 ? text.length : end;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

function blocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const brace = text.indexOf('{', i);
    const semi = text.indexOf(';', i);
    if (semi !== -1 && (brace === -1 || semi < brace) && text.slice(i, semi).trim().startsWith('@')) {
      out.push({ statement: text.slice(i, semi).trim() });
      i = semi + 1;
      continue;
    }
    if (brace === -1) {
      if (text.slice(i).trim()) out.push({ stray: text.slice(i).trim() });
      break;
    }
    const end = closing(text, brace);
    out.push({ prelude: text.slice(i, brace).trim(), body: text.slice(brace + 1, end) });
    i = end + 1;
  }
  return out;
}

function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      i = end === -1 ? text.length : end;
    } else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function declarations(body) {
  return splitTop(body, ';').map((d) => {
    const colon = d.indexOf(':');
    if (colon === -1) return { bad: d };
    return {
      prop: d.slice(0, colon).trim().toLowerCase(),
      value: d.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim(),
    };
  });
}

function resolveVars(value, vars) {
  let out = value;
  for (let round = 0; round < 6 && out.includes('var('); round++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (all, name, fallback) => {
      if (vars.has(name)) return vars.get(name);
      return fallback !== undefined ? fallback : all;
    });
  }
  return out.includes('var(') ? null : out;
}

const unprefixed = (prop) => prop.replace(/^-(webkit|moz|ms|o)-/, '');

export function checkCss(css, where, vars = new Map()) {
  const problems = [];
  const text = stripComments(css);
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    if (!vars.has(m[1])) vars.set(m[1], m[2].replace(/!\s*important\s*$/i, '').trim());
  }

  const checkDeclarations = (body, at) => {
    if (body.includes('{')) {
      problems.push(`${where}: a rule inside a rule (CSS nesting) in ${at}`);
      return;
    }
    const list = declarations(body);
    const works = (d) => {
      if (d.prop.startsWith('--')) return true;
      const value = resolveVars(d.value, vars);
      if (value === null) return CSS.supports(d.prop, 'inherit');
      return CSS.supports(d.prop, value);
    };
    for (const d of list) {
      if (d.bad) {
        problems.push(`${where}: "${d.bad}" in ${at} is not a property and value`);
        continue;
      }
      if (works(d)) continue;
      const covered = list.some((o) => o !== d && !o.bad && unprefixed(o.prop) === unprefixed(d.prop) && works(o));
      if (!covered) problems.push(`${where}: ${d.prop}: ${d.value} (in ${at})`);
    }
  };

  const walk = (level, inKeyframes) => {
    const selectors = [];
    for (const b of level) {
      if (b.stray) {
        problems.push(`${where}: text outside any rule: "${b.stray.slice(0, 40)}"`);
        continue;
      }
      if (b.statement) {
        if (!/^@(charset|import|layer)\b/i.test(b.statement)) problems.push(`${where}: ${b.statement}`);
        continue;
      }
      if (inKeyframes) {
        checkDeclarations(b.body, `@keyframes ${b.prelude}`);
        continue;
      }
      if (b.prelude.startsWith('@')) {
        const name = (/^@([\w-]+)/.exec(b.prelude) || [])[1].toLowerCase();
        const kept = engineRules(`${b.prelude}{}`);
        if (!kept.length) {
          problems.push(`${where}: ${b.prelude} is not understood here`);
          continue;
        }
        if (kept[0].media && kept[0].media.mediaText === 'not all' && !/not all/.test(b.prelude)) {
          problems.push(`${where}: ${b.prelude} never matches here`);
        }
        if (name === 'keyframes' || name === '-webkit-keyframes') walk(blocks(b.body), true);
        else if (name === 'font-face') continue;
        else walk(blocks(b.body), false);
        continue;
      }
      selectors.push(b.prelude);
      checkDeclarations(b.body, b.prelude);
    }
    if (selectors.length) {
      const kept = new Set(engineRules(selectors.map((s, i) => `${s}{--n:${i}}`).join('\n'))
        .map((r) => r.style && r.style.getPropertyValue('--n').trim()));
      selectors.forEach((s, i) => {
        if (!kept.has(String(i))) problems.push(`${where}: the selector ${s} is not understood here`);
      });
    }
  };
  walk(blocks(text), false);
  return problems;
}

function checkStyleAttribute(value, where, vars) {
  return checkCss(`x{${value}}`, where, vars).map((p) => p.replace(' (in x)', ' (in a style attribute)'));
}

export function checkHtml(html, where, vars = new Map()) {
  const problems = [];
  const text = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) problems.push(...checkCss(m[1], `${where} <style>`, vars));
  const parsed = new DOMParser().parseFromString(text, 'text/html');
  for (const el of parsed.querySelectorAll('[style]')) {
    problems.push(...checkStyleAttribute(el.getAttribute('style'), where, vars));
  }
  for (const tag of new Set([...text.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b/g)].map((x) => x[1].toLowerCase()))) {
    if (tag === 'svg' || tag === 'math' || SVG_TAGS.has(tag)) continue;
    if (document.createElement(tag) instanceof HTMLUnknownElement) problems.push(`${where}: <${tag}> is not a tag here`);
  }
  for (const m of text.matchAll(/<input\b[^>]*\btype\s*=\s*"([^"]+)"/gi)) {
    const input = document.createElement('input');
    input.type = m[1];
    if (input.type !== m[1].toLowerCase()) problems.push(`${where}: <input type="${m[1]}"> is a plain text box here`);
  }
  for (const attr of ['popover', 'popovertarget']) {
    if (new RegExp(`<[^>]+\\s${attr}(\\s|=|>)`, 'i').test(text) && !(attr in HTMLElement.prototype)) {
      problems.push(`${where}: the ${attr} attribute does nothing here`);
    }
  }
  return problems;
}

const SVG_TAGS = new Set([
  'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect', 'g', 'defs', 'use', 'symbol',
  'text', 'tspan', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'title',
  'desc', 'marker', 'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'femerge',
  'femergenode', 'feflood', 'fecomposite', 'feturbulence', 'fedisplacementmap', 'animate',
  'animatetransform', 'image', 'foreignobject', 'textpath',
]);

export function checkFiles(files, owner) {
  const problems = [];
  const vars = new Map();
  const sheets = files.filter((x) => x.name.endsWith('.css'));
  const pages = files.filter((x) => x.name.endsWith('.html'));
  counted.sheets += sheets.length;
  counted.pages += pages.length;
  for (const f of sheets) problems.push(...checkCss(f.code || '', `${owner}/${f.name}`, vars));
  for (const f of pages) problems.push(...checkHtml(f.code || '', `${owner}/${f.name}`, new Map(vars)));
  return problems;
}

function checkSnippet(lang, text, where) {
  if (!text && !lang) return [];
  if (!text || (lang !== 'css' && lang !== 'html')) {
    counted.unread.push(`${where} (lang ${JSON.stringify(lang)})`);
    return [];
  }
  counted.snippets += 1;
  if (lang === 'css') return text.includes('{') ? checkCss(text, where) : checkStyleAttribute(text, where, new Map());
  if (lang === 'html') {
    const attr = /^\s*style\s*=\s*"([^"]*)"\s*$/.exec(text);
    if (attr) return checkStyleAttribute(attr[1], where, new Map());
    return checkHtml(text, where);
  }
  return [];
}

export function checkTopic(topic) {
  const where = `help ${topic.id}`;
  const problems = [];
  for (const c of topic.code || []) problems.push(...checkSnippet(c.lang, c.text, `${where} code`));
  if (topic.insert) problems.push(...checkSnippet(topic.insert.lang, topic.insert.text, `${where} insert`));
  for (const way of topic.ways || []) {
    for (const step of way.steps || []) problems.push(...checkSnippet(step.lang, step.text, `${where} ${way.title}`));
  }
  if (topic.files) problems.push(...checkFiles(topic.files.filter((f) => typeof f.code === 'string'), where));
  if (topic.lang) {
    for (const row of topic.rows || []) problems.push(...checkSnippet(topic.lang, row.code, `${where} "${row.means}"`));
  }
  return problems;
}
