const tauri = window.__TAURI__;

export const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
export const listen = (name, fn) => tauri.event.listen(name, (event) => fn(event.payload));
