// Language wrapper for the "markdown" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';

// No list keymap, no tag closer, no tag completion, no paste-as-link: plain typing outside the teaching kinds (C47).
const language = markdown({
  base: markdownLanguage,
  addKeymap: false,
  completeHTMLTags: false,
  pasteURLAsLink: false,
  htmlTagLanguage: html({ matchClosingTags: false, autoCloseTags: false }),
});

export function support() { return language; }
export const legacy = false;
