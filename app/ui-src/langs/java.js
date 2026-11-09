// Language wrapper for the "java" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { java } from '@codemirror/lang-java';

const language = java();

export function support() { return language; }
export const legacy = false;
