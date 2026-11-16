// parse.js — an optimized fork of marked 18.1.3.
//
// This entry is a fork of marked (https://github.com/markedjs/marked,
// v18.1.3, MIT License — see LICENSE for full attribution). The forked core
// lives in ./marked/ (converted from marked's TypeScript sources, behavior
// unchanged); this module wires it for speed.
//
// What makes it faster than marked itself (all output-preserving):
//  1. One lexer, tokenizer, parser and renderer are created once and reused
//     across calls instead of being rebuilt (with fresh options spreads,
//     rules objects and renderer instances) on every parse() call. The
//     lexer state that is per-document (tokens, link definitions, inline
//     queue, inLink/inRawBlock/top flags) is reset explicitly before each
//     call, exactly as the constructor sets it up.
//  2. The Marked-class wrapper is bypassed: parse() calls Lexer.lex and
//     Parser.parse directly with the shared default options (gfm on,
//     async off), skipping the per-call option spreads, onError closure
//     and hook/walkTokens checks (none are configured).
//  3. Further optimizations live inside ./marked/ (marked `// Fork:`
//     notes): a carriage-return fast path, list-tokenizer hot-path work
//     (memoized list regexes, first-marker-char dispatch, one trim per
//     line, manual firstLineOf), inline plain-text fast paths (a
//     trigger-free run shortcut plus a first-character dispatch that
//     skips the inline rule chain), hoisted extension lookups, guarded
//     replacements in #maskSrc (plus a hasLinkDefs gate on reflink
//     masking), manual equivalents of three whole-string regexes
//     (endsWithDoubleBlankLine, hasSetextUnderline), a cleanUrl fast
//     path, and spread-free code-point counting in emStrong/del.
//
// parse() is stateless per call: no cache, no memo across calls, nothing
// written anywhere. Every call returns exactly the HTML marked 18.1.3
// renders for the same input with its default options.

import { _Lexer } from './marked/Lexer.js';
import { _Parser } from './marked/Parser.js';
import { _getDefaults } from './marked/defaults.js';

// Shared default options (marked's defaults: gfm on, async off, no
// extensions, hooks, renderer or tokenizer overrides). The Lexer and
// Parser constructors attach the shared tokenizer/renderer to this
// object once; nothing else mutates it.
const OPTIONS = _getDefaults();
const lexer = new _Lexer(OPTIONS);
const parser = new _Parser(OPTIONS);

/** The HTML marked 18.1.3 renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  if (typeof markdown !== 'string') {
    throw new Error('marked(): input parameter is of type '
      + Object.prototype.toString.call(markdown) + ', string expected');
  }

  // Reset the per-document lexer state (the same fields the constructor
  // initializes). The tokenizer, its rules and the parser/renderer are
  // shared and stateless between calls.
  lexer.tokens = [];
  lexer.tokens.links = Object.create(null);
  lexer.hasLinkDefs = false;
  lexer.inlineQueue = [];
  lexer.state = {
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
    top: true,
  };

  return parser.parse(lexer.lex(markdown));
}
