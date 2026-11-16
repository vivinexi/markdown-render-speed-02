// Driver for the markdown-render-speed-02 entry: reads the case list,
// renders every case alone with the fast parser in parse.js, and writes
// the HTML strings out in the cases' order. The harness runs
// `node /bot/main.ts` (node22); outside a container MAKEFUN_INPUT_DIR
// and MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8'));
const html = new Array(cases.length);
for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
