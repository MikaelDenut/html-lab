// Language wrapper for the "ini" row of LANGUAGES (core kinds.rs). Colours only; folding comes from editor.js (O2, C47).
import { StreamLanguage } from '@codemirror/language';
import { properties } from '@codemirror/legacy-modes/mode/properties';

const language = StreamLanguage.define(properties);

export function support() { return language; }
export const legacy = true;
