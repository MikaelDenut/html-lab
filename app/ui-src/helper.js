import morphdom from 'morphdom';

const me = document.currentScript;
if (me) me.remove();

const parentWin = window.parent;
const version = Number(new URLSearchParams(location.search).get('v')) || 0;
const pageDir = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
const overrides = new Map();

function post(msg) {
  parentWin.postMessage(msg, '*');
}

function localFileOf(href) {
  try {
    const url = new URL(href, document.baseURI);
    if (url.protocol !== location.protocol || url.host !== location.host) return null;
    const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    if (dir !== pageDir) return null;
    return decodeURIComponent(url.pathname.slice(dir.length));
  } catch (e) {
    return null;
  }
}

function isStylesheet(link) {
  return (link.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet');
}

function report(doc) {
  const links = [];
  for (const link of doc.querySelectorAll('link[href]')) {
    if (!isStylesheet(link)) continue;
    const file = localFileOf(link.getAttribute('href'));
    if (file && !links.includes(file)) links.push(file);
  }
  for (const style of doc.querySelectorAll('style[data-hl-file]')) {
    const file = style.getAttribute('data-hl-file');
    if (!links.includes(file)) links.push(file);
  }
  return {
    links,
    hasStyle: !!doc.querySelector('[style], style:not([data-hl-file])'),
    hasScript: !!doc.querySelector('script'),
  };
}

function applyOverride(doc, file, css) {
  for (const style of doc.querySelectorAll('style[data-hl-file]')) {
    if (style.getAttribute('data-hl-file') === file && style.textContent !== css) style.textContent = css;
  }
  for (const link of Array.from(doc.querySelectorAll('link[href]'))) {
    if (!isStylesheet(link) || localFileOf(link.getAttribute('href')) !== file) continue;
    const style = doc.createElement('style');
    style.setAttribute('data-hl-file', file);
    style.textContent = css;
    link.replaceWith(style);
  }
}

function morphOptions() {
  return {
    onBeforeElUpdated(from, to) {
      return !from.isEqualNode(to);
    },
  };
}

function updateHtml(msg) {
  const start = performance.now();
  try {
    const doc = new DOMParser().parseFromString(msg.html, 'text/html');
    if (doc.compatMode !== document.compatMode) {
      post({ t: 'fail', id: msg.id });
      return;
    }
    for (const [file, css] of overrides) applyOverride(doc, file, css);
    morphdom(document.documentElement, doc.documentElement, morphOptions());
    if (typeof msg.y === 'number') window.scrollTo(0, msg.y);
    post({ t: 'done', id: msg.id, ms: performance.now() - start, ...report(document) });
  } catch (e) {
    post({ t: 'fail', id: msg.id });
  }
}

function updateCss(msg) {
  const start = performance.now();
  try {
    overrides.set(msg.file, msg.css);
    applyOverride(document, msg.file, msg.css);
    post({ t: 'done', id: msg.id, ms: performance.now() - start, ...report(document) });
  } catch (e) {
    post({ t: 'fail', id: msg.id });
  }
}

function probe(msg) {
  const el = msg.sel ? document.querySelector(msg.sel) : null;
  post({
    t: 'probed',
    id: msg.id,
    html: document.documentElement.outerHTML,
    url: location.href,
    y: window.scrollY,
    w: window.innerWidth,
    found: !!el,
    text: el ? el.textContent : null,
    value: el && msg.prop ? getComputedStyle(el).getPropertyValue(msg.prop) : null,
    natural: el && 'naturalWidth' in el ? el.naturalWidth : null,
  });
}

function testClick(msg) {
  const el = document.querySelectorAll(msg.sel)[msg.index || 0] || null;
  if (el) el.click();
  post({ t: 'probed', id: msg.id, found: !!el, url: location.href });
}

window.addEventListener('message', (event) => {
  if (event.source !== parentWin) return;
  const msg = event.data;
  if (!msg) return;
  if (msg.t === 'html') updateHtml(msg);
  else if (msg.t === 'css') updateCss(msg);
  else if (msg.t === 'scroll') window.scrollTo(0, msg.y);
  else if (msg.t === 'probe') probe(msg);
  else if (msg.t === 'click') testClick(msg);
  else if (msg.t === 'place') goToPlace(msg.hash);
});

function goToPlace(hash) {
  const id = decodeURIComponent(hash.slice(1));
  if (document.getElementById(id) || document.getElementsByName(id)[0]) location.hash = hash;
  else window.scrollTo(0, 0);
}

document.addEventListener(
  'click',
  (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href], area[href]') : null;
    if (!link) return;
    const raw = link.getAttribute('href');
    if (raw.startsWith('#')) return;
    let url;
    try {
      url = new URL(link.href);
    } catch (e) {
      event.preventDefault();
      return;
    }
    if (url.protocol === location.protocol && url.host === location.host) {
      if (url.pathname === location.pathname && url.hash) {
        event.preventDefault();
        const id = decodeURIComponent(url.hash.slice(1));
        const place = document.getElementById(id) || document.getElementsByName(id)[0];
        if (place) place.scrollIntoView();
        else if (id === 'top') window.scrollTo(0, 0);
        return;
      }
      event.preventDefault();
      post({ t: 'nav', href: url.href });
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      event.preventDefault();
      post({ t: 'ext', url: url.href });
    } else {
      event.preventDefault();
    }
  },
  true,
);

document.addEventListener('contextmenu', (event) => event.preventDefault());

document.addEventListener(
  'keydown',
  (event) => {
    const mac = /Macintosh/.test(navigator.userAgent);
    if (!mac && (['F3', 'F5', 'F7'].includes(event.key) || (event.ctrlKey && 'rpu'.includes(event.key.toLowerCase())))) {
      event.preventDefault();
      return;
    }
    if ((mac ? event.metaKey : event.ctrlKey) && (event.key === '+' || event.key === '=' || event.key === '?')) {
      event.preventDefault();
      post({ t: 'key', key: event.key });
    }
  },
  true,
);

let scrollQueued = false;
window.addEventListener(
  'scroll',
  () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      post({ t: 'scroll', y: window.scrollY });
    });
  },
  { passive: true },
);

const STYLE_WAIT_MS = 500;

function whenStyled(done) {
  const waiting = [...document.querySelectorAll('link[rel~="stylesheet" i]')].filter((link) => !link.sheet);
  let left = waiting.length;
  if (!left) {
    done();
    return;
  }
  let called = false;
  const finish = () => {
    if (called) return;
    called = true;
    clearTimeout(cap);
    done();
  };
  const cap = setTimeout(finish, STYLE_WAIT_MS);
  const one = () => {
    left -= 1;
    if (left === 0) finish();
  };
  for (const link of waiting) {
    link.addEventListener('load', one, { once: true });
    link.addEventListener('error', one, { once: true });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  whenStyled(() => post({ t: 'ready', v: version, ...report(document) }));
});
