// Language wrapper for the "sass" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { sass } from '@codemirror/lang-sass';

const language = sass({ indented: true });

export function support() { return language; }
export const legacy = false;
