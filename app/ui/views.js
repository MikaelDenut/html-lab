export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function icon(id, cls, color) {
  const klass = cls ? `icon ${cls}` : 'icon';
  const style = color ? ` style="color:var(--${color})"` : '';
  return `<svg class="${klass}"${style} aria-hidden="true"><use href="#i-${id}"></use></svg>`;
}

// A file outline with the language's letters (PY, JS, JSON ...) for a file that is not a teaching kind.
export function lettersIcon(letters, color) {
  const size = letters.length <= 2 ? 7 : letters.length === 3 ? 6 : 5;
  return `<svg class="icon s24 tab-letters" style="color:var(--${color})" viewBox="0 0 24 24" aria-hidden="true">`
    + '<path d="M5 2.8h9.4l4.8 4.8v13.6H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'
    + `<text x="12.1" y="18.4" font-size="${size}" font-weight="700" text-anchor="middle" fill="currentColor">${escapeHtml(letters)}</text>`
    + '</svg>';
}

export function tabHtml({ path, name, label, kind, kindIcon, kindColor, letters, dirty, active, tooltip }) {
  const shown = label || name;
  const cls = `tab${active ? ' active' : ''}${dirty ? ' dirty' : ''}`;
  const kindAttr = kind ? ` data-kind="${escapeHtml(kind)}"` : '';
  const dot = dirty ? '<span class="tab-dot" role="img" aria-label="Not saved yet"></span>' : '';
  return `<div class="${cls}" data-path="${escapeHtml(path)}"${kindAttr} title="${escapeHtml(tooltip || path)}">`
    + `<button class="tab-main" type="button">${letters ? lettersIcon(letters, kindColor) : icon(kindIcon, 's24', kindColor)}`
    + `<span class="tab-name">${escapeHtml(shown)}</span></button>`
    + dot
    + `<button class="tab-close" type="button" aria-label="Close ${escapeHtml(shown)}">${icon('x-bold', 's14')}</button>`
    + '</div>';
}
