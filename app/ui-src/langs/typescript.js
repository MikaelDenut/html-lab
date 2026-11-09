// Language wrapper for the "typescript" row of LANGUAGES (core kinds.rs). Colours, folding and mistake hints (O2, C47, WP6).
import { LanguageSupport } from '@codemirror/language';
import { javascript, typescriptLanguage, tsxLanguage } from '@codemirror/lang-javascript';

// TSX only for .tsx files; no tag closer (autoCloseTags is a teaching helper, C47).
const plain = new LanguageSupport(typescriptLanguage, javascript({ typescript: true }).support);
const tsx = new LanguageSupport(tsxLanguage, javascript({ typescript: true }).support);

export function support(fileName) { return /\.tsx$/i.test(fileName || '') ? tsx : plain; }
export const legacy = false;
// The mistake hints for this language (WP6), loaded with it so the start-up bundle stays small.
export { findMistake } from '../code-hints.js';
