// Language wrapper for the "scss" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { sass } from '@codemirror/lang-sass';

const language = sass();

export function support() { return language; }
export const legacy = false;
