// Language wrapper for the "cpp" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { cpp } from '@codemirror/lang-cpp';

const language = cpp();

export function support() { return language; }
export const legacy = false;
