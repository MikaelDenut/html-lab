// Language wrapper for the "ruby" row of LANGUAGES (core kinds.rs). Colours only; folding comes from editor.js (O2, C47).
import { StreamLanguage } from '@codemirror/language';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';

const language = StreamLanguage.define(ruby);

export function support() { return language; }
export const legacy = true;
