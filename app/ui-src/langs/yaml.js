// Language wrapper for the "yaml" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { yaml } from '@codemirror/lang-yaml';

const language = yaml();

export function support() { return language; }
export const legacy = false;
