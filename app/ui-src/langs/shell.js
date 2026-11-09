// Language wrapper for the "shell" row of LANGUAGES (core kinds.rs). Colours only; folding comes from editor.js (O2, C47).
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';

const language = StreamLanguage.define(shell);

export function support() { return language; }
export const legacy = true;
