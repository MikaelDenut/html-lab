// Language wrapper for the "lua" row of LANGUAGES (core kinds.rs). Colours only; folding comes from editor.js (O2, C47).
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';

const language = StreamLanguage.define(lua);

export function support() { return language; }
export const legacy = true;
