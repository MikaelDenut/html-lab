const ua = navigator.userAgent;
export const isMac = /Macintosh/.test(ua);
export const isWindows = /Windows/.test(ua);
export const platform = isMac ? 'mac' : isWindows ? 'windows' : 'linux';
export const schemeBase = (name) => (isWindows ? `http://${name}.localhost/` : `${name}://localhost/`);
export const previewBase = schemeBase('preview');
export const browserName = isMac ? 'Safari' : 'your browser';
export const computerName = isMac ? 'The Mac' : 'The computer';
export const fileManager = isMac ? 'Finder' : isWindows ? 'File Explorer' : 'your file manager';
export const commandKey = (event) => (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
export const browserOnlyKey = (event) =>
  !isMac && (['F3', 'F5', 'F7'].includes(event.key) || (event.ctrlKey && 'rpu'.includes(event.key.toLowerCase())));
document.documentElement.dataset.platform = platform;
