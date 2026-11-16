import { _Tokenizer } from './Tokenizer.js';
import { _defaults } from './defaults.js';
import { other, block, inline } from './rules.js';
import { beginEmStrongDelCloserScan, endEmStrongDelCloserScan, normalizeLabel, decodeNumericCharacterReferences } from './helpers.js';

// Fork: any inline trigger. See the fast path in inlineTokens.
const inlineTrigger = /[`\\<\[*_~!]| {2}\n|www\.|:\/\/|@/;
                                                             
                                                        

/**
 * Block Lexer
 */
export class _Lexer                                                 {
  tokens            ;
  options                                             ;
  state   
                    
                        
                                                                        
                         
       
                                                                       
                                                                         
                                             
       
                               
                 
   ;

         inlineQueue                                    ;

          tokenizer                                          ;

  constructor(options                                              ) {
    // TokenList cannot be created in one go
    this.tokens = []                         ;
    this.tokens.links = Object.create(null);
    this.options = options || _defaults;
    this.options.tokenizer = this.options.tokenizer || new _Tokenizer                              ();
    this.tokenizer = this.options.tokenizer;
    this.tokenizer.options = this.options;
    this.tokenizer.lexer = this;
    this.inlineQueue = [];
    this.state = {
      inLink: false,
      inRawBlock: false,
      linkEmitted: false,
      linkParenPossible: true,
      top: true,
    };

    const rules = {
      other,
      block: block.normal,
      inline: inline.normal,
    };

    if (this.options.pedantic) {
      rules.block = block.pedantic;
      rules.inline = inline.pedantic;
    } else if (this.options.gfm) {
      rules.block = block.gfm;
      if (this.options.breaks) {
        rules.inline = inline.breaks;
      } else {
        rules.inline = inline.gfm;
      }
    }
    this.tokenizer.rules = rules;
  }

  /**
   * Expose Rules
   */
  static get rules() {
    return {
      block,
      inline,
    };
  }

  /**
   * Static Lex Method
   */
  static lex                                                (src        , options                                              ) {
    const lexer = new _Lexer                              (options);
    return lexer.lex(src);
  }

  /**
   * Static Lex Inline Method
   */
  static lexInline                                                (src        , options                                              ) {
    const lexer = new _Lexer                              (options);
    return lexer.inlineTokens(src);
  }

  /**
   * Preprocessing
   */
  lex(src        ) {
    // Fork: most inputs have no carriage returns; indexOf is far cheaper
    // than a global regex replace over the whole string.
    if (src.indexOf('\r') !== -1) {
      src = src.replace(other.carriageReturn, '\n');
    }

    this.blockTokens(src, this.tokens);

    for (let i = 0; i < this.inlineQueue.length; i++) {
      const next = this.inlineQueue[i];
      // an inline <pre>, <code>, <kbd> or <script> left open ends with the block
      // holding it; carried over, it would stop every later block's text from
      // being escaped
      this.state.inRawBlock = false;
      this.inlineTokens(next.src, next.tokens);
    }
    this.inlineQueue = [];

    return this.tokens;
  }

  /**
   * Lexing
   */
                                                                                      
                                                                                            
  blockTokens(src        , tokens          = [], lastParagraphClipped = false) {
    this.tokenizer.lexer = this;
    // Fork: hoist the extensions lookup out of the per-token loop (it is
    // null with the default options, so this only removes property walks).
    const extensions = this.options.extensions;
    if (this.options.pedantic) {
      src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
    }

    let srcLength = Infinity;
    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }

      let token                            ;

      if (extensions?.block?.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }

      // newline
      if (token = this.tokenizer.space(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (token.raw.length === 1 && lastToken !== undefined) {
          // if there's a single \n as a spacer, it's terminating the last line,
          // so move it there so that we don't get unnecessary paragraph tags
          lastToken.raw += '\n';
        } else {
          tokens.push(token);
        }
        continue;
      }

      // code
      if (token = this.tokenizer.code(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        // An indented code block cannot interrupt a paragraph.
        if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue.at(-1) .src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      // fences
      if (token = this.tokenizer.fences(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // heading
      if (token = this.tokenizer.heading(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // hr
      if (token = this.tokenizer.hr(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // blockquote
      if (token = this.tokenizer.blockquote(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // list
      if (token = this.tokenizer.list(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // html
      if (token = this.tokenizer.html(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // def
      if (token = this.tokenizer.def(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.raw;
          this.inlineQueue.at(-1) .src = lastToken.text;
        } else {
          // The first definition of a label wins, but a later one still consumes its text
          if (!this.tokens.links[token.tag]) {
            this.tokens.links[token.tag] = {
              href: token.href,
              title: token.title,
            };
            // Fork: #maskSrc only needs the reflink masking when a link
            // definition exists at all (the links object itself is always
            // truthy, so it cannot serve as the test).
            this.hasLinkDefs = true;
          }
          tokens.push(token);
        }
        continue;
      }

      // table (gfm)
      if (token = this.tokenizer.table(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // lheading
      if (token = this.tokenizer.lheading(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // top-level paragraph
      // prevent paragraph consuming extensions by clipping 'src' to extension start
      let cutSrc = src;
      if (extensions?.startBlock) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        extensions.startBlock.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === 'number' && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
        const lastToken = tokens.at(-1);
        if (lastParagraphClipped && lastToken?.type === 'paragraph') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1) .src = lastToken.text;
        } else {
          tokens.push(token);
        }
        lastParagraphClipped = cutSrc.length !== src.length;
        src = src.substring(token.raw.length);
        continue;
      }

      // text
      if (token = this.tokenizer.text(src)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1) .src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      if (src) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }

    this.state.top = true;
    return tokens;
  }

  inline(src        , tokens          = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }

  /**
   * Does this link text hold a link already? An image does not count: an image
   * may hold a link, a link may not.
   */
          linkInText(text        )          {
    if (!text.includes('[')) {
      return false;
    }

    const linkRule = this.tokenizer.rules.inline.link;
    for (const match of text.matchAll(this.tokenizer.rules.inline.blockSkip)) {
      // blockSkip also matches code spans and html, and the `!` of an image is
      // left out of the match, so read the character before it.
      if (linkRule.test(match[0]) && text.charAt(match.index - 1) !== '!') {
        return true;
      }
    }

    for (const match of text.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
      const match0 = match[0];
      const refStart = match0.lastIndexOf('[');
      if (match0.charAt(0) === '!' || !Object.hasOwn(this.tokens.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
        continue;
      }
      // a candidate holding a link is not a link either, so it does not count
      if (refStart > 1 && this.linkInText(match0.slice(1, refStart - 1))) {
        continue;
      }
      return true;
    }

    return false;
  }

  /**
   * Lexing/Compiling
   */
  inlineTokens(src        , tokens          = [])          {
    // Fork fast path: a run with no inline markup at all is a single text
    // token. Every inline rule needs one of these to fire anywhere in the
    // run: ` \ < [ * _ ~ ! (escape/tag/link/reflink/emStrong/codespan/del/
    // autolink), two spaces before a newline (br), `www.`, `://` or `@`
    // (url/email autolinks). With none present the text rule consumes the
    // whole run in one match, so emit that token directly and skip the
    // masking scan, the closer scan and the per-iteration rule attempts.
    // This is exactly the token inlineText would produce for the run.
    if (src && !inlineTrigger.test(src)) {
      const inRawBlock = this.state.inRawBlock;
      const text = inRawBlock ? src : decodeNumericCharacterReferences(src);
      const lastToken = tokens.at(-1);
      if (lastToken?.type === 'text') {
        lastToken.raw += src;
        lastToken.text += text;
      } else {
        tokens.push({ type: 'text', raw: src, text, escaped: inRawBlock });
      }
      return tokens;
    }
    this.tokenizer.lexer = this;
    // One paren scan per inline run, shared with Tokenizer.link: without a
    // ')' ahead the link regex cannot match, and skipping it avoids its
    // quadratic backtracking over unterminated-link inputs like
    // `'[a](b'.repeat(n)`. A nested run receives a substring of the outer
    // run, so if the outer had no ')' neither does this substring — skip
    // the scan in that case.
    const prevLinkParenPossible = this.state.linkParenPossible;
    this.state.linkParenPossible = prevLinkParenPossible && src.includes(')');
    try {
      return this.#inlineTokensInner(src, tokens);
    } finally {
      // A nested run (e.g. a link label) anchored on its own substring;
      // restore the outer run's flag for the rest of its loop.
      this.state.linkParenPossible = prevLinkParenPossible;
    }
  }

  #inlineTokensInner(src        , tokens         )          {
    // The masked source is only read by emStrong and del, which need a *, _ or
    // ~ to start. Skip building it for a run without one, unless a custom
    // tokenizer or an emStrongMask hook may read it.
    const maskedSrc = src.includes('*') || src.includes('_') || src.includes('~')
      || this.options.hooks?.emStrongMask
      || this.tokenizer.emStrong !== _Tokenizer.prototype.emStrong
      || this.tokenizer.del !== _Tokenizer.prototype.del
      ? this.#maskSrc(src)
      : src;

    // One scan of this maskedSrc for the last emphasis, strong, and
    // strikethrough closers, shared by every opener in the pass. Popped
    // when the pass ends so the source is not retained (#4099).
    beginEmStrongDelCloserScan(this.tokenizer, maskedSrc);
    try {
      return this.#tokenizeInlines(src, maskedSrc, tokens);
    } finally {
      endEmStrongDelCloserScan(this.tokenizer);
    }
  }

  #tokenizeInlines(src        , maskedSrc        , tokens         )          {
    // Fork: hoist the extensions lookup (see blockTokens).
    const extensions = this.options.extensions;
    let keepPrevChar = false;
    let prevChar = '';
    let srcLength = Infinity;
    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }

      if (!keepPrevChar) {
        prevChar = '';
      }
      keepPrevChar = false;

      let token                            ;

      // Fork: if the run starts with a char no inline rule can start on,
      // skip the rule attempts and go straight to text. Rule starters are
      // `\ < [ ! * _ ` ~ (escape/tag/link/reflink/emStrong/codespan/del/
      // autolink), a space followed by another space (br), and the
      // characters a url/email can start with (letters, digits, `.` `+`
      // `-`). Anything else — punctuation like `) , : ; ? > @ / = " '`,
      // newlines, tabs, control chars and non-ASCII — cannot start a rule,
      // so the text rule is the only one that can match here. The text
      // handling below is the same as the text branch at the end of the
      // loop.
      {
        const c0 = src.charCodeAt(0);
        const plainStart = !(
          c0 === 92 || c0 === 60 || c0 === 91 || c0 === 33 || c0 === 42 ||
          c0 === 95 || c0 === 96 || c0 === 126 ||
          (c0 >= 48 && c0 <= 57) || (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) ||
          c0 === 46 || c0 === 43 || c0 === 45 ||
          (c0 === 32 && src.charCodeAt(1) === 32)
        );
        if (plainStart) {
          let cutSrc = src;
          if (extensions?.startInline) {
            let startIndex = Infinity;
            const tempSrc = src.slice(1);
            let tempStart;
            extensions.startInline.forEach((getStartIndex) => {
              tempStart = getStartIndex.call({ lexer: this }, tempSrc);
              if (typeof tempStart === 'number' && tempStart >= 0) {
                startIndex = Math.min(startIndex, tempStart);
              }
            });
            if (startIndex < Infinity && startIndex >= 0) {
              cutSrc = src.substring(0, startIndex + 1);
            }
          }
          if (token = this.tokenizer.inlineText(cutSrc)) {
            src = src.substring(token.raw.length);
            if (token.raw.slice(-1) !== '_') {
              prevChar = token.raw.slice(-1);
            }
            keepPrevChar = true;
            const lastToken = tokens.at(-1);
            if (lastToken?.type === 'text') {
              lastToken.raw += token.raw;
              lastToken.text += token.text;
            } else {
              tokens.push(token);
            }
            continue;
          }
          if (src) {
            this.infiniteLoopError(src.charCodeAt(0));
            break;
          }
          continue;
        }
      }

      // extensions
      if (extensions?.inline?.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }

      // escape
      if (token = this.tokenizer.escape(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // tag
      if (token = this.tokenizer.tag(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // link
      if (token = this.tokenizer.link(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // reflink, nolink
      if (token = this.tokenizer.reflink(src, this.tokens.links)) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (token.type === 'text' && lastToken?.type === 'text') {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      // em & strong
      if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // code
      if (token = this.tokenizer.codespan(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // br
      if (token = this.tokenizer.br(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // del (gfm)
      if (token = this.tokenizer.del(src, maskedSrc, prevChar)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // autolink
      if (token = this.tokenizer.autolink(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // url (gfm)
      if (!this.state.inLink && (token = this.tokenizer.url(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      // text
      // prevent inlineText consuming extensions by clipping 'src' to extension start
      let cutSrc = src;
      if (extensions?.startInline) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        extensions.startInline.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === 'number' && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (token = this.tokenizer.inlineText(cutSrc)) {
        src = src.substring(token.raw.length);
        if (token.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
          prevChar = token.raw.slice(-1);
        }
        keepPrevChar = true;
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      if (src) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }

    return tokens;
  }

  /**
   * Mask links, code, html and escapes so emStrong and del do not see their
   * delimiters inside them.
   */
  #maskSrc(src        )         {
    // String with links masked to avoid interference with em and strong
    let maskedSrc = src;

    // Mask out reflinks
    if (this.hasLinkDefs && src.includes('[')) {
      const reflinkSearch = this.tokenizer.rules.inline.reflinkSearch;
      const maskReflink = (match0        )         => {
        const refStart = match0.lastIndexOf('[');
        if (!Object.hasOwn(this.tokens.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
          return match0;
        }
        // CommonMark: "Links may not contain other links, at any level of
        // nesting." A candidate whose text already holds one never becomes a
        // link, so flattening the whole span would hide the emphasis that
        // does still apply inside it. Mask the links it holds instead.
        // Images are exempt: their text is flattened into an alt attribute.
        if (refStart > 1 && match0.charAt(0) !== '!') {
          const text = match0.slice(1, refStart - 1);
          if (this.linkInText(text)) {
            return '[' + text.replace(reflinkSearch, maskReflink)
              + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(match0.length - 2) + ']';
      };
      maskedSrc = maskedSrc.replace(reflinkSearch, maskReflink);
    }

    // Mask out escaped characters.
    // Every mask must keep the length it replaces: emStrong and del line
    // maskedSrc up with src by slicing from the end. `anyPunctuation` matches
    // unicode punctuation, so an escaped astral character is 3 code units.
    // A backslash inside a code span is literal, not an escape. Mask the
    // backticks inside the span instead, so blockSkip still skips all of it.
    // Fork: this regex can only match a code span (needs a backtick) or an
    // escaped punctuation (needs a backslash); without either it is identity.
    if (maskedSrc.includes('`') || maskedSrc.includes('\\')) {
      maskedSrc = maskedSrc.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode, (match0, code, punct) => {
        if (punct) {
          return '+'.repeat(match0.length);
        }
        if (code) {
          return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
        }
        return match0;
      });
    }

    // Mask out other blocks
    // Fork: blockSkip matches a link (needs `[`), a code span (needs a
    // backtick) or html (needs `<`); without any of those it is identity.
    if (maskedSrc.includes('[') || maskedSrc.includes('`') || maskedSrc.includes('<')) {
      maskedSrc = maskedSrc.replace(this.tokenizer.rules.inline.blockSkip, (match0, _link, context) => {
        const offset = context ? context.length : 0;
        return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
      });
    }

    // Mask out blocks from extensions
    maskedSrc = this.options.hooks?.emStrongMask?.call({ lexer: this }, maskedSrc) ?? maskedSrc;

    return maskedSrc;
  }

          infiniteLoopError(byte        ) {
    const errMsg = 'Infinite loop on byte: ' + byte;
    if (this.options.silent) {
      console.error(errMsg);
    } else {
      throw new Error(errMsg);
    }
  }
}
