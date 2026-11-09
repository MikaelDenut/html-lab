// Language wrapper for the "swift" row of LANGUAGES (core kinds.rs). Colours only; folding comes from editor.js (O2, C47).
import { StreamLanguage } from '@codemirror/language';
import { swift } from '@codemirror/legacy-modes/mode/swift';

const language = StreamLanguage.define(swift);

export function support() { return language; }
export const legacy = true;
