// Language wrapper for the "go" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { go } from '@codemirror/lang-go';

const language = go();

export function support() { return language; }
export const legacy = false;
