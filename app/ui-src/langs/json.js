// Language wrapper for the "json" row of LANGUAGES (core kinds.rs). Colours, folding and mistake hints (O2, C47, WP6).
import { json } from '@codemirror/lang-json';

const language = json();

export function support() { return language; }
export const legacy = false;
// The mistake hints for this language (WP6), loaded with it so the start-up bundle stays small.
export { findMistake } from '../code-hints.js';
