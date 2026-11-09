// Language wrapper for the "rust" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { rust } from '@codemirror/lang-rust';

const language = rust();

export function support() { return language; }
export const legacy = false;
