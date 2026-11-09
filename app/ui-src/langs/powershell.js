// Language wrapper for the "powershell" row of LANGUAGES (core kinds.rs). Colours only; folding comes from editor.js (O2, C47).
import { StreamLanguage } from '@codemirror/language';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';

const language = StreamLanguage.define(powerShell);

export function support() { return language; }
export const legacy = true;
