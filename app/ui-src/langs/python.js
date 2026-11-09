// Language wrapper for the "python" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { python } from '@codemirror/lang-python';

const language = python();

export function support() { return language; }
export const legacy = false;
