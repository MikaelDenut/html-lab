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

export function tabHtml({ path, name, label, kind, kindIcon, kindColor, dirty, active, tooltip }) {
  const shown = label || name;
  const cls = `tab${active ? ' active' : ''}${dirty ? ' dirty' : ''}`;
  const kindAttr = kind ? ` data-kind="${escapeHtml(kind)}"` : '';
  const dot = dirty ? '<span class="tab-dot" role="img" aria-label="Not saved yet"></span>' : '';
  return `<div class="${cls}" data-path="${escapeHtml(path)}"${kindAttr} title="${escapeHtml(tooltip || path)}">`
    + `<button class="tab-main" type="button">${icon(kindIcon, 's24', kindColor)}`
    + `<span class="tab-name">${escapeHtml(shown)}</span></button>`
    + dot
    + `<button class="tab-close" type="button" aria-label="Close ${escapeHtml(shown)}">${icon('x-bold', 's14')}</button>`
    + '</div>';
}
