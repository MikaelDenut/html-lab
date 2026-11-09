export const S = {
  config: null,
  kinds: new Map(),
  prefs: null,
  flags: {},
  tabs: [],
  projects: new Map(),
  activePath: null,
  rightView: 'page',
  sideShown: true,
  sideManual: null,
  ed: null,
  E: null,
  dialogOpen: false,
  panelOpen: false,
  // Change Name (WP5): the open name field, and whether the toast offers Undo.
  renaming: null,
  renameUndo: false,
};

let nextProject = 1;
export function newProjectId() {
  return `p${nextProject++}`;
}

export const activeTab = () => S.tabs.find((t) => t.path === S.activePath) || null;
export const tabByPath = (path) => S.tabs.find((t) => t.path === path) || null;
export const projectOf = (tab) => (tab ? S.projects.get(tab.projectId) || null : null);
export const activeProject = () => projectOf(activeTab());
export const tabsOf = (project) => S.tabs.filter((t) => t.projectId === project.id);
export const kindOf = (tab) => S.kinds.get(tab.kind) || S.config.codeKind;
export const isPage = (tab) => !!kindOf(tab).isPage;
// A file that is neither a page nor a style file: the My page side hides by itself for it (WP3).
export const isOther = (tab) => !isPage(tab) && kindOf(tab).previewMode !== 'swap';
export const pageTabOf = (project) => (project && project.pageTab ? tabByPath(project.pageTab) : null);

export const isChanged = (tab) => tab.savedDoc === null || !tab.state.doc.eq(tab.savedDoc);

export const isOnDisk = (tab) => {
  const project = projectOf(tab);
  return !!(project && project.folder && tab.savedDoc !== null);
};

export const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);
export const dirName = (path) => path.slice(0, path.lastIndexOf('/'));
export const extOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};
export const kindForName = (name) => {
  const ext = extOf(name);
  for (const kind of S.config.kinds) {
    if (kind.extensions.includes(ext)) return kind;
  }
  return null;
};
export const kindOrCode = (name) => kindForName(name) || S.config.codeKind;

// Mirrors language_for_name in core kinds.rs: a whole name first, then the extension in any
// case, then the text row. The extension is what follows the last dot, but a name like .env
// that starts with its only dot has none. Only A to Z change case, as eq_ignore_ascii_case does.
const asciiLower = (text) => text.replace(/[A-Z]+/g, (part) => part.toLowerCase());
const extensionOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? null : asciiLower(name.slice(dot + 1));
};
export const languageForName = (name) => {
  const rows = S.config.languages;
  const lower = asciiLower(name);
  const byName = rows.find((row) => row.names.some((n) => asciiLower(n) === lower));
  if (byName) return byName;
  const ext = extensionOf(name);
  const byExt = ext === null ? null : rows.find((row) => row.extensions.includes(ext));
  return byExt || rows.find((row) => row.id === 'text');
};
// The editor language of a file: a teaching kind's own language, or its LANGUAGES row.
export const languageIdFor = (name) => {
  const kind = kindOrCode(name);
  return kind.teaching ? kind.language : languageForName(name).id;
};
export const languageRow = (tab) =>
  S.config.languages.find((row) => row.id === tab.language) || S.config.languages.find((row) => row.id === 'text');
export const tidyAllowed = (tab) => !!kindOf(tab).teaching || languageRow(tab).tidy === 'on';
// The copy-table sentence for a file whose Tidy is off.
export const tidyOffText = (tab) =>
  languageRow(tab).tidy === 'off-meaning'
    ? `Tidy is off for ${languageRow(tab).label} files, because spaces change what the code means.`
    : `Tidy does not know how to tidy ${languageRow(tab).label} files yet.`;

// How a file is written back: its own BOM, encoding and line ending. The editor
// itself always holds LF text.
export const plainStyle = (kind) => ({
  bom: false,
  encoding: 'utf8',
  eol: 'lf',
  finalNewline: true,
  indent: { tabs: false, width: kind && kind.teaching ? 2 : 4 },
});
export const writeStyle = (style) => ({
  bom: !!(style && style.bom),
  encoding: (style && style.encoding) || 'utf8',
  eol: (style && style.eol) || 'lf',
});

// A project opened alone in a huge folder, or made only of other text files,
// watches just its own files, so a window focus never walks the folder (C48).
export const stampArgs = (project) => {
  const files = project.lone ? tabsOf(project).filter((t) => t.savedDoc !== null).map((t) => t.path) : [];
  return files.length ? { folder: project.folder, files } : { folder: project.folder };
};
export const sameFile = (a, b) => a.toLowerCase() === b.toLowerCase();
