// Language wrapper for the "xml" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { xml } from '@codemirror/lang-xml';

// No tag closer: autoCloseTags is a teaching helper (C47).
const language = xml({ autoCloseTags: false });

export function support() { return language; }
export const legacy = false;
