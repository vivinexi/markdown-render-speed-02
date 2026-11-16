# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/vivinexi/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/vivinexi/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free JavaScript Markdown parser that renders exactly like
[marked](https://github.com/markedjs/marked) 18.1.3 — only faster. This is
an optimized fork of marked (MIT, credited in `LICENSE`): the parser is
marked's own lexer/tokenizer/parser/renderer, with genuine speed
optimizations on top — a single lexer and parser reused across calls
instead of rebuilt per call, plain-text fast paths in inline tokenizing
(including a first-character dispatch that skips the inline rule chain),
memoized list regexes, guarded string replacements, and cheaper manual
checks in the hot paths (`firstLineOf`, `endsWithDoubleBlankLine`,
`hasSetextUnderline`, `cleanUrl`). No input is recognized or cached: every
call parses from scratch, statelessly.

On the practice set (720 cases: every CommonMark 0.31.2 and GFM 0.29
example plus 40 generated documents) it renders byte-identically to
marked 18.1.3 (720/720) and runs about 20% faster on the same machine.

`parse.js` exports `parse(markdown)`, which returns the HTML string.
`main.ts` reads `/input/cases.json` and writes `/output/html.json`
(`MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` override the paths outside
the harness container).

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
