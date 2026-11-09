// Page side of "Seeing how it fits" (0.2.0). Runs in the preview page, bundled
// with helper.js. Everything it draws lives in one <hl-layer> with a closed
// shadow root, so the page's own CSS cannot reach inside. Outlines use document
// coordinates, so scrolling the page needs no redraw.

const BRAND = '#0B6E69';
const BLUE = '#1D56C9';
const DEPTH = ['#C2410C', BLUE, '#15803D', '#7E22CE'];
const TAG = '<hl-layer></hl-layer>';
const NUM = Symbol();
const LABEL_H = 16;
const LABEL_ROOM = 120;
const MAX_RULE = 200;
const MAX_RULE_LABELS = 20;
const MAX_BOXES = 600;
const MAX_TEXT = 3000;
const ROW = 32;
const DROP = /^(hover|focus(-within|-visible)?|active|visited|target|link|before|after|first-(line|letter))$/;
const NAME = /^(?:[\w-]|[^\0-\x7f]|\\[^])*/;
const SKIP = /^(script|style|template)$/;

// The host rules are !important: inside a shadow root that beats the page's
// own !important. Each div sets pointer-events itself, so nothing depends on
// what the host passes down.
const CSS =
  ':host{all:initial!important;display:block!important;position:absolute!important;left:0!important;' +
  'top:0!important;width:0!important;height:0!important;overflow:visible!important;' +
  'z-index:2147483647!important;pointer-events:none!important}' +
  'div{position:absolute;pointer-events:none}' +
  '.o{outline:2px solid var(--c)}' +
  '.m{background:rgba(11,110,105,.08)}' +
  '.r{outline-style:dashed}' +
  '.h{box-shadow:0 0 0 1px var(--c),0 0 0 3px #fff}' +
  '.p{box-shadow:0 0 0 2px var(--c),0 0 0 4px #fff}' +
  'b{position:absolute;left:-2px;top:-18px;padding:0 4px;border-radius:3px;' +
  'font:600 11px/16px -apple-system,system-ui,sans-serif;color:#fff;background:var(--c);white-space:nowrap}' +
  '.box{z-index:1}.rule{z-index:2}.mark{z-index:3}.hov{z-index:4}' +
  '.mark,.rule{animation:hl-gone 1ms linear 2s forwards}' +
  '@keyframes hl-gone{to{visibility:hidden}}' +
  '.cat{position:fixed;inset:0;z-index:5;pointer-events:auto;cursor:crosshair}' +
  '.eat{cursor:auto}';

// The end of the piece that starts at i: one character, an escape, a string,
// or a whole (...) or [...] group with what is nested in it.
function skip(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') j++;
    else if (c === '"' || c === "'") {
      for (j++; j < s.length && s[j] !== c; j++) if (s[j] === '\\') j++;
    } else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (depth <= 0) return j + 1;
  }
  return s.length;
}

// Leaves out what depends on the mouse, focus or history, and pseudo-elements,
// per top-level comma part. A part they leave empty, or a compound they leave
// empty before a combinator, gets "*" so the selector still runs.
export function cleanSelector(sel) {
  const parts = [];
  let out = '';
  let i = 0;
  while (i < sel.length) {
    let j = skip(sel, i);
    if (sel[i] === ',') {
      parts.push(out);
      out = '';
    } else if (sel[i] === ':') {
      const two = sel[i + 1] === ':';
      const name = sel.slice(i + (two ? 2 : 1)).match(NAME)[0];
      const k = i + (two ? 2 : 1) + name.length;
      j = sel[k] === '(' ? skip(sel, k) : k;
      if (two || (j === k && DROP.test(name.toLowerCase()))) {
        if (/^\s*$|[\s>+~]$/.test(out)) out += '*';
      } else out += sel.slice(i, j);
    } else out += sel.slice(i, j);
    i = j;
  }
  parts.push(out);
  return parts.map((p) => p.trim()).join(', ');
}

export function depthColor(depth) {
  return DEPTH[(depth - 1) % DEPTH.length];
}

// Where a label sits, relative to the top of its box: above it, or inside it
// when there is no room above `edge` (the page top, or the visible top).
export function labelTop(y, h, edge) {
  if (y - LABEL_H - 2 >= edge) return -LABEL_H - 2;
  return Math.max(0, Math.min(edge - y, h - LABEL_H));
}

// A label near the right side ends at the box's right edge instead, so it never
// makes the page wider than it is.
export function labelRight(x, pageWidth) {
  return x + LABEL_ROOM > pageWidth;
}

// Where a box label may go, in the order tried: above the box, then inside its
// top, each at the left and then at the right. Rects are in page coordinates.
export function labelSpots(x, y, w, h, edge, width, pageWidth) {
  const above = labelTop(y, h, edge);
  const inside = Math.max(0, Math.min(edge - y, h - LABEL_H));
  const sides = labelRight(x, pageWidth) ? [true] : [false, true];
  const spots = [];
  for (const top of above === inside ? [above] : [above, inside]) {
    for (const right of sides) {
      const l = right ? x + w - width : x - 2;
      spots.push({ top, right, l, t: y + top, r: l + width, b: y + top + LABEL_H });
    }
  }
  return spots;
}

export const labelWidth = (name) => name.length * 7 + 8;

// Rects bucketed by rows of the page, so a label is tested only against what is near it.
export function rectRows() {
  const rows = new Map();
  const span = (a, f) => {
    for (let i = Math.floor(a.t / ROW); i <= Math.floor(a.b / ROW); i++) f(i);
  };
  return {
    add(a) {
      span(a, (i) => (rows.get(i) || rows.set(i, []).get(i)).push(a));
    },
    hits(a) {
      let hit = false;
      span(a, (i) => {
        for (const b of rows.get(i) || []) {
          if (a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1) hit = true;
        }
      });
      return hit;
    },
  };
}

export function numberElements(list, own) {
  const els = [];
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (own(el)) continue;
    el[NUM] = els.length;
    els.push(el);
  }
  return els;
}

export function numberOf(els, el) {
  const i = el[NUM];
  return els[i] === el ? i : -1;
}

const nameOf = (el) => el.localName.toLowerCase();

export function initInspect({ post }) {
  const groups = {};
  const last = {};
  let host = null;
  let root = null;
  let pv = 0;
  let els = null;
  let point = false;
  let boxesOn = false;
  let hovEl = null;
  let hovPv = -1;
  let markEl = null;
  let ruleSel = null;
  let ruleCount = null;
  let boxCount = 0;
  let boxLabels = 0;
  let labelsOverText = 0;
  let inside = false;
  let target = null;
  let mouseX = 0;
  let mouseY = 0;
  let pickX = 0;
  let pickY = 0;
  let hoverQueued = false;
  let redrawQueued = false;
  let pageW = 0;
  let pageH = 0;

  const own = (node) =>
    !!node && (node === host || (node.localName === 'style' && node.hasAttribute('data-hl-fonts')));
  const numbers = () => els || (els = numberElements(document.getElementsByTagName('*'), own));

  function chainOf(el) {
    const list = numbers();
    const chain = [];
    for (let e = el; e; e = e.parentElement) {
      const i = numberOf(list, e);
      if (i >= 0) chain.push(i);
    }
    return chain;
  }

  function query(sel) {
    try {
      return [...document.querySelectorAll(sel)].filter((el) => !own(el));
    } catch (e) {
      return null;
    }
  }

  function group(name) {
    if (!host) {
      host = document.createElement('hl-layer');
      root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = '<style>' + CSS + '</style>';
      root.addEventListener('animationend', (e) => {
        const n = e.target.className;
        if (groups[n] === e.target) drop(n);
      });
    }
    if (!groups[name]) {
      const g = document.createElement('div');
      g.className = name;
      root.appendChild(g);
      groups[name] = g;
    }
    if (!host.isConnected) document.documentElement.appendChild(host);
    return groups[name];
  }

  function drop(name) {
    const g = groups[name];
    if (g) {
      g.remove();
      groups[name] = null;
      last[name] = '';
    }
    if (host && !Object.values(groups).some(Boolean)) host.remove();
  }

  // Clamped to the page's own size: a box of something the page clips must not
  // make the page scroll further. An element no longer in the page has an
  // empty box, so it draws nothing.
  // `place`, when given, picks the label's spot from the box's page rect.
  function outline(el, color, label, edge, cls, r = el.getBoundingClientRect(), place = null) {
    const x = Math.max(r.left + scrollX, 0);
    const y = Math.max(r.top + scrollY, 0);
    const w = Math.min(r.right + scrollX, pageW) - x;
    const h = Math.min(r.bottom + scrollY, pageH) - y;
    if (!(w > 0 && h > 0)) return '';
    let s = `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;--c:${color}">`;
    if (label) {
      const name = nameOf(el);
      const spot = place ? place(x, y, w, h, name) : { top: labelTop(y, h, edge), right: labelRight(x, pageW) };
      const side = spot.right ? ';left:auto;right:0' : '';
      s += `<b style="top:${spot.top}px${side}">${name.replace(/</g, '&lt;')}</b>`;
    }
    return s + '</div>';
  }

  // The lines of text on the page, so a box label can keep off the letters.
  function textRows() {
    const rows = rectRows();
    if (!document.body) return rows;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let count = 0;
    for (let n = walker.nextNode(); n && count < MAX_TEXT; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p || SKIP.test(p.localName) || !/\S/.test(n.data)) continue;
      count++;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) {
          rows.add({ l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY });
        }
      }
    }
    return rows;
  }

  function ruleOutlines() {
    let s = '';
    let k = 0;
    for (const el of query(ruleSel) || []) {
      if (k >= MAX_RULE) break;
      const one = outline(el, BLUE, k < MAX_RULE_LABELS, scrollY, 'o r');
      if (one) {
        s += one;
        k++;
      }
    }
    return s;
  }

  function boxOutlines() {
    let s = '';
    let n = 0;
    const text = textRows();
    const labels = rectRows();
    boxLabels = 0;
    labelsOverText = 0;
    // The first spot clear of text and of other labels, else the first clear of
    // text, else the first. A label over a letter hides the very word it names.
    const place = (x, y, w, h, name) => {
      const spots = labelSpots(x, y, w, h, 0, labelWidth(name), pageW);
      const spot =
        spots.find((a) => !text.hits(a) && !labels.hits(a)) || spots.find((a) => !text.hits(a)) || spots[0];
      labels.add(spot);
      boxLabels++;
      if (text.hits(spot)) labelsOverText++;
      return spot;
    };
    const walk = (parent, depth) => {
      for (let el = parent.firstElementChild; el && n <= MAX_BOXES; el = el.nextElementSibling) {
        if (SKIP.test(el.localName) || own(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && ++n <= MAX_BOXES) {
          s += outline(el, depthColor(depth), r.width >= 40 && r.height >= 16, 0, 'o', r, place);
        }
        walk(el, depth + 1);
      }
    };
    if (document.body) walk(document.body, 1);
    // The walk stops past MAX_BOXES: the app only needs to know there are more.
    boxCount = n;
    post({ t: 'boxed', count: n, pv });
    return s;
  }

  function drawn(name) {
    if (name === 'hov') return hovEl ? outline(hovEl, BRAND, point, scrollY, point ? 'h p' : 'h') : '';
    if (name === 'mark') return groups.mark && markEl ? outline(markEl, BRAND, true, scrollY, 'o m') : '';
    if (name === 'rule') return groups.rule ? ruleOutlines() : '';
    return boxesOn ? boxOutlines() : '';
  }

  // All reads first, then all writes: one layout per paint.
  function paint(names) {
    const s = document.scrollingElement || document.documentElement;
    pageW = s.scrollWidth;
    pageH = s.scrollHeight;
    const html = names.map(drawn);
    names.forEach((name, i) => {
      if (!html[i]) drop(name);
      else if (last[name] !== html[i]) {
        group(name).innerHTML = html[i];
        last[name] = html[i];
      }
    });
  }

  function queueRedraw() {
    // Only what draws outlines needs a redraw: the Point catcher does not.
    if (redrawQueued || !(boxesOn || groups.mark || groups.rule || groups.hov)) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      // Old outlines go before measuring, so they cannot hold the page at a
      // size it no longer has. The groups stay, so a vanish keeps its clock.
      const names = ['box', 'rule', 'mark', 'hov'];
      for (const n of names) {
        if (groups[n]) {
          groups[n].textContent = '';
          last[n] = '';
        }
      }
      paint(names);
    });
  }

  function under(x, y) {
    for (const el of document.elementsFromPoint(x, y)) if (!own(el)) return el;
    return null;
  }

  function setHover(el) {
    if (el !== hovEl || hovPv !== pv) {
      hovEl = el;
      hovPv = pv;
      post({ t: 'over', chain: chainOf(el), pv });
    }
    paint(['hov']);
  }

  function queueHover() {
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!inside) return;
      const el = point || !target || own(target) ? under(mouseX, mouseY) : target;
      if (el && el.isConnected) setHover(el);
    });
  }

  function setPoint(on, eat) {
    if (on === point) return;
    point = on;
    if (on) {
      if (!groups.cat) group('cat').addEventListener('click', onCatch);
      groups.cat.className = 'cat';
    } else if (eat && groups.cat) {
      // The catcher stays until the mouse moves, so the second click of a
      // double click cannot follow a link under it.
      groups.cat.className = 'cat eat';
    } else drop('cat');
    if (inside) queueHover();
    else if (hovEl) paint(['hov']);
  }

  function pick(el, eat) {
    post({ t: 'pick', chain: el ? chainOf(el) : [], pv });
    setPoint(false, eat);
  }

  function onCatch(e) {
    if (!point) return drop('cat');
    pickX = e.clientX;
    pickY = e.clientY;
    pick(under(pickX, pickY), true);
  }

  function mark(msg) {
    if (msg.pv !== pv) return;
    drop('mark');
    markEl = msg.i == null ? null : numbers()[msg.i] || null;
    if (!markEl) return;
    const r = markEl.getBoundingClientRect();
    const away = r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth;
    if (msg.scroll && away && r.width && r.height) markEl.scrollIntoView({ block: 'center' });
    group('mark');
    paint(['mark']);
  }

  function rule(msg) {
    if (msg.sel == null) {
      drop('rule');
      ruleSel = null;
      ruleCount = null;
      return;
    }
    const sel = cleanSelector(String(msg.sel));
    const list = query(sel);
    ruleCount = list ? list.length : 0;
    if (msg.show) {
      drop('rule');
      ruleSel = sel;
      group('rule');
      paint(['rule']);
    } else if (sel !== ruleSel) drop('rule');
    post({ t: 'ruled', count: ruleCount, ok: !!list, pv });
  }

  function setBoxes(on) {
    boxesOn = on;
    const how = on ? 'addEventListener' : 'removeEventListener';
    // A picture that loads after the boxes are drawn moves things.
    document[how]('load', queueRedraw, true);
    document[how]('error', queueRedraw, true);
    if (!on) return drop('box');
    paint(['box']);
  }

  function testHook(msg) {
    const list = query(msg.sel);
    const el = (list && list[msg.index || 0]) || null;
    let picked = false;
    if (el && msg.t === 'hover') setHover(el);
    else if (el && point) {
      pick(el, false);
      picked = true;
    }
    post({ t: 'probed', id: msg.id, found: !!el, picked });
  }

  // Any outline moves when the page width changes. With nothing showing,
  // queueRedraw returns at once.
  window.addEventListener('resize', queueRedraw);

  document.addEventListener(
    'mousemove',
    (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      target = e.target;
      inside = true;
      if (!point && groups.cat && (Math.abs(mouseX - pickX) > 3 || Math.abs(mouseY - pickY) > 3)) drop('cat');
      queueHover();
    },
    { passive: true },
  );

  document.addEventListener('mouseout', (e) => {
    if (e.relatedTarget) return;
    inside = false;
    hovEl = null;
    if (!point) drop('cat');
    drop('hov');
    post({ t: 'out' });
  });

  return {
    onMessage(msg) {
      const t = msg.t;
      if (t === 'point') setPoint(!!msg.on);
      else if (t === 'boxes') setBoxes(!!msg.on);
      else if (t === 'mark') mark(msg);
      else if (t === 'rule') rule(msg);
      else if (t === 'names') post({ t: 'names', list: numbers().map(nameOf), pv });
      else if (t === 'hover' || t === 'pickAt') testHook(msg);
      else return false;
      return true;
    },
    afterUpdate(kind) {
      if (kind !== 'css') {
        pv++;
        els = null;
      }
      // A new <body> from the morph lands after the layer; the layer goes back
      // to the end so it stays above the page.
      const html = document.documentElement;
      if (host && host.isConnected && html.lastChild !== host) html.appendChild(host);
      // The hover outline goes on a change and comes back with the next mouse
      // move, so typing with the mouse resting on the page measures nothing.
      if (kind !== 'ready' && hovEl) {
        hovEl = null;
        hovPv = -1;
        drop('hov');
      }
      queueRedraw();
    },
    get pv() {
      return pv;
    },
    get pointing() {
      return point;
    },
    keepNode: own,
    ownNode: own,
    stripLayer(html) {
      const i = host && host.isConnected ? html.lastIndexOf(TAG) : -1;
      return i < 0 ? html : html.slice(0, i) + html.slice(i + TAG.length);
    },
    probeInfo(msg) {
      const num = (el) => {
        const i = el && el.isConnected ? numberOf(numbers(), el) : -1;
        return i < 0 ? null : i;
      };
      const shown = (g) => !!g && getComputedStyle(g).visibility !== 'hidden';
      const out = {
        inspect: {
          pv,
          point,
          boxes: boxesOn,
          boxCount: boxesOn ? boxCount : 0,
          boxLabels: boxesOn ? boxLabels : 0,
          labelsOverText: boxesOn ? labelsOverText : 0,
          hover: num(hovEl),
          mark: num(markEl),
          markShown: shown(groups.mark),
          ruleShown: shown(groups.rule),
          ruleCount,
          layer: !!host && host.isConnected,
        },
      };
      if (msg && msg.names) {
        const list = numbers();
        out.names = list.map(nameOf);
        out.ids = list.map((el) => el.getAttribute('id') || '');
        out.pv = pv;
      }
      return out;
    },
    onKeydown(e) {
      if (!point || e.key !== 'Escape') return false;
      setPoint(false);
      post({ t: 'pointOff' });
      return true;
    },
  };
}
