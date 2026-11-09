// Language wrapper for the "toml" row of LANGUAGES (core kinds.rs). Colours only; folding comes from editor.js (O2, C47).
import { StreamLanguage } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';

const language = StreamLanguage.define(toml);

export function support() { return language; }
export const legacy = true;
