// Language wrapper for the "php" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { php } from '@codemirror/lang-php';
import { htmlLanguage } from '@codemirror/lang-html';

// The HTML around the PHP is parsed for colours, without the HTML tag closer (C47).
const language = php({ baseLanguage: htmlLanguage });

export function support() { return language; }
export const legacy = false;
