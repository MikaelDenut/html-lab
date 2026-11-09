// Language wrapper for the "sql" row of LANGUAGES (core kinds.rs). Colours and folding only (O2, C47).
import { sql } from '@codemirror/lang-sql';

const language = sql();

export function support() { return language; }
export const legacy = false;
