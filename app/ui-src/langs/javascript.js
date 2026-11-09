// Language wrapper for the "javascript" row of LANGUAGES (core kinds.rs). Colours, folding and mistake hints (O2, C47, WP6).
import { LanguageSupport } from '@codemirror/language';
import { javascript, jsxLanguage } from '@codemirror/lang-javascript';

// JSX parsing without the tag closer that javascript({ jsx: true }) adds: autoCloseTags is a teaching helper (C47).
const language = new LanguageSupport(jsxLanguage, javascript().support);

export function support() { return language; }
export const legacy = false;
// The mistake hints for this language (WP6), loaded with it so the start-up bundle stays small.
export { findMistake } from '../code-hints.js';
