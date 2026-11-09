// Language wrapper for the "less" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { less } from '@codemirror/lang-less';

const language = less();

export function support() { return language; }
export const legacy = false;
