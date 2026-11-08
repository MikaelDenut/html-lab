export const S = {
  config: null,
  kinds: new Map(),
  prefs: null,
  flags: {},
  tabs: [],
  projects: new Map(),
  activePath: null,
  rightView: 'page',
  ed: null,
  E: null,
  dialogOpen: false,
  panelOpen: false,
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
export const kindOf = (tab) => S.kinds.get(tab.kind);
export const isPage = (tab) => kindOf(tab).isPage;
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
export const sameFile = (a, b) => a.toLowerCase() === b.toLowerCase();
