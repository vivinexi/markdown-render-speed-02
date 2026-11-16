import { _defaults } from './defaults.js';
import {
  rtrim,
  splitCells,
  findClosingBracket,
  expandTabs,
  normalizeLabel,
  decodeNumericCharacterReferences,
  trimTrailingBlankLines,
  cachedLastPossibleEmStrongCloserIndex,
  cachedLastPossibleDelCloserIndex,
} from './helpers.js';
                                        
                                         
                                                        
                                                        

// Fork helpers: cheap equivalents of split/search/replace hot spots in list().
// firstLineOf(s) === s.split('\n', 1)[0] without allocating an array.
// firstNonSpace(s) === s.search(/[^ ]/) (first char that is not a space);
// tabs count as non-space, so only char code 32 is skipped.
// Both are exact equivalents for the inputs list() passes them.
function firstLineOf(s) {
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}
function firstNonSpace(s) {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 32) i++;
  return i < s.length ? i : -1;
}
// Fork: endsWithDoubleBlankLine(s) === /\n[ \t]*\n[ \t]*$/.test(s) —
// a blank line at the end — without the regex scanning the whole string.
function endsWithDoubleBlankLine(s) {
  let i = s.length;
  while (i > 0 && (s.charCodeAt(i - 1) === 32 || s.charCodeAt(i - 1) === 9)) i--;
  if (i < 2 || s.charCodeAt(i - 1) !== 10) return false;
  i--;
  while (i > 0 && (s.charCodeAt(i - 1) === 32 || s.charCodeAt(i - 1) === 9)) i--;
  return i > 0 && s.charCodeAt(i - 1) === 10;
}
// Fork: hasSetextUnderline(s) === /\n {0,3}[=-]/.test(s) — a newline
// followed (within 3 spaces) by `=` or `-` — without the regex.
function hasSetextUnderline(s) {
  let i = s.indexOf('\n');
  while (i !== -1 && i + 1 < s.length) {
    let j = i + 1;
    let spaces = 0;
    while (spaces < 3 && s.charCodeAt(j) === 32) { j++; spaces++; }
    const c = s.charCodeAt(j);
    if (c === 61 || c === 45) return true;
    i = s.indexOf('\n', i + 1);
  }
  return false;
}

function outputLink(cap          , link                                     , raw        , lexer        , rules       )                                         {
  const href = link.href;
  const title = link.title || null;
  const text = cap[1].replace(rules.other.outputLinkReplace, '$1');
  const isImage = cap[0].charAt(0) === '!';

  const outerInLink = lexer.state.inLink;
  const outerLinkEmitted = lexer.state.linkEmitted;
  const outerInRawBlock = lexer.state.inRawBlock;
  lexer.state.inLink = true;
  lexer.state.linkEmitted = false;
  const tokens = lexer.inlineTokens(text);
  const textHasLink = lexer.state.linkEmitted;
  lexer.state.linkEmitted = outerLinkEmitted;
  lexer.state.inLink = outerInLink;

  if (!isImage) {
    // CommonMark: "Links may not contain other links, at any level of nesting."
    // Bail so the caller falls through to text and the inner link is the one kept.
    // Images are exempt: their text is flattened into an alt attribute.
    if (textHasLink) {
      // these tokens are discarded, so undo the raw-block state they opened;
      // leaving it set would suppress escaping for the text that is re-scanned
      lexer.state.inRawBlock = outerInRawBlock;
      return;
    }
    lexer.state.linkEmitted = true;
  }

  return {
    type: isImage ? 'image' : 'link',
    raw,
    href,
    title,
    text,
    tokens,
  };
}

function indentCodeCompensation(raw        , text        , rules       ) {
  const matchIndentToCode = raw.match(rules.other.indentCodeCompensation);

  if (matchIndentToCode === null) {
    return text;
  }

  const indentToCode = matchIndentToCode[1];

  return text
    .split('\n')
    .map(node => {
      const matchIndentInNode = node.match(rules.other.beginningSpace);
      if (matchIndentInNode === null) {
        return node;
      }

      const [indentInNode] = matchIndentInNode;

      // Up to the fence's own indentation is removed from each line, so a line
      // indented less than the fence loses whatever indentation it has.
      return node.slice(Math.min(indentInNode.length, indentToCode.length));
    })
    .join('\n');
}

function isLabelEndInsideToken(src        , label        , labelStart        , rules       ) {
  if (!label.includes('<')) {
    return false;
  }

  for (let i = 0; i < label.length; i++) {
    if (label[i] === '\\') {
      i++;
      continue;
    }

    if (label[i] === '`') {
      const code = rules.inline.code.exec(label.slice(i));
      if (code) {
        i += code[0].length - 1;
        continue;
      }
    }

    if (label[i] !== '<') {
      continue;
    }

    const tokenSrc = src.slice(labelStart + i);
    const token = rules.inline.tag.exec(tokenSrc) || rules.inline.autolink.exec(tokenSrc);
    if (!token) {
      continue;
    }

    if (token[0].length > label.length - i) {
      return true;
    }
    i += token[0].length - 1;
  }
  return false;
}

/**
 * Tokenizer
 */
export class _Tokenizer                                                 {
  options                                             ;
  rules        ; // set by the lexer
  lexer                                       ; // set by the lexer

  constructor(options                                              ) {
    this.options = options || _defaults;
  }

  space(src        )                           {
    const cap = this.rules.block.newline.exec(src);
    if (cap && cap[0].length > 0) {
      return {
        type: 'space',
        raw: cap[0],
      };
    }
  }

  code(src        )                          {
    const cap = this.rules.block.code.exec(src);
    if (cap) {
      const raw = this.options.pedantic
        ? cap[0]
        : trimTrailingBlankLines(cap[0]);
      const text = raw.replace(this.rules.other.codeRemoveIndent, '');
      return {
        type: 'code',
        raw,
        codeBlockStyle: 'indented',
        text,
      };
    }
  }

  fences(src        )                          {
    const cap = this.rules.block.fences.exec(src);
    if (cap) {
      const raw = cap[0];
      const text = indentCodeCompensation(raw, cap[3] || '', this.rules);

      return {
        type: 'code',
        raw,
        lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, '$1') : cap[2],
        text,
      };
    }
  }

  heading(src        )                             {
    const cap = this.rules.block.heading.exec(src);
    if (cap) {
      let text = cap[2].trim();

      // remove trailing #s
      if (this.rules.other.endingHash.test(text)) {
        const trimmed = rtrim(text, '#');
        if (this.options.pedantic) {
          text = trimmed.trim();
        } else if (!trimmed || this.rules.other.endingSpaceTabChar.test(trimmed)) {
          // CommonMark requires a space or tab before trailing #s
          text = trimmed.trim();
        }
      }

      return {
        type: 'heading',
        raw: rtrim(cap[0], '\n'),
        depth: cap[1].length,
        text,
        tokens: this.lexer.inline(text),
      };
    }
  }

  hr(src        )                        {
    const cap = this.rules.block.hr.exec(src);
    if (cap) {
      return {
        type: 'hr',
        raw: rtrim(cap[0], '\n'),
      };
    }
  }

  blockquote(src        )                                {
    const cap = this.rules.block.blockquote.exec(src);
    if (cap) {
      let lines = rtrim(cap[0], '\n').split('\n');
      let raw = '';
      let text = '';
      const tokens          = [];

      while (lines.length > 0) {
        let inBlockquote = false;
        const currentLines = [];

        let i;
        for (i = 0; i < lines.length; i++) {
          // get lines up to a continuation
          if (this.rules.other.blockquoteStart.test(lines[i])) {
            currentLines.push(lines[i]);
            inBlockquote = true;
          } else if (!inBlockquote) {
            currentLines.push(lines[i]);
          } else {
            break;
          }
        }
        lines = lines.slice(i);

        const currentRaw = currentLines.join('\n');
        const currentText = currentRaw
          // a tab after the block quote marker runs to the next tab stop, and
          // the marker only consumes one space of it; the rest is content
          .replace(
            this.rules.other.blockquoteMarkerWhitespace,
            (_, marker        , whitespace        ) => marker + expandTabs(whitespace, marker.length),
          )
          // precede setext continuation with 4 spaces so it isn't a setext
          .replace(this.rules.other.blockquoteSetextReplace, '\n    $1')
          .replace(this.rules.other.blockquoteSetextReplace2, '');
        raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
        text = text ? `${text}\n${currentText}` : currentText;

        // parse blockquote lines as top level tokens
        // merge paragraphs if this is a continuation
        const top = this.lexer.state.top;
        this.lexer.state.top = true;
        this.lexer.blockTokens(currentText, tokens, true);
        this.lexer.state.top = top;

        // if there is no continuation then we are done
        if (lines.length === 0) {
          break;
        }

        const lastToken = tokens.at(-1);

        if (lastToken?.type === 'code' || lastToken?.type === 'heading' || lastToken?.type === 'hr' || lastToken?.type === 'html' || lastToken?.type === 'table') {
          // blockquote continuation cannot be preceded by a code block, heading, hr, html block or table
          break;
        } else if (lastToken?.type === 'blockquote') {
          // include continuation in nested blockquote
          const oldToken = lastToken                     ;
          // The continuation lines belong to the same nesting frame as the
          // nested blockquote, which already had one '>' marker stripped, so
          // strip one marker from them too. Otherwise a restated marker after a
          // lazy line is re-parsed as a spurious deeper blockquote.
          const continuation = lines.join('\n');
          const newText = oldToken.raw + '\n' + continuation.replace(this.rules.other.blockquoteSetextReplace2, '');
          const newToken = this.blockquote(newText) ;
          tokens[tokens.length - 1] = newToken;

          // Only include continuation lines the nested blockquote actually
          // consumed. Unconsumed trailing lines must stay out of `raw` so the
          // lexer can still tokenize them (paragraph, next blockquote, etc.).
          const leftover = newText.substring(newToken.raw.length).replace(/^\n/, '');
          const leftoverCount = leftover ? leftover.split('\n').length : 0;
          const consumed = leftoverCount ? lines.slice(0, -leftoverCount) : lines;
          if (consumed.length > 0) {
            raw = `${raw}\n${consumed.join('\n')}`;
          }
          text = text.substring(0, text.length - oldToken.text.length) + newToken.text;

          // A leftover line that starts with '>' still belongs to this
          // blockquote; any other leftover line ends it.
          lines = lines.slice(consumed.length);
          if (lines.length > 0 && this.rules.other.blockquoteStart.test(lines[0])) {
            continue;
          }
          break;
        } else if (lastToken?.type === 'list') {
          // include continuation in nested list
          const oldToken = lastToken               ;
          const newText = oldToken.raw + '\n' + lines.join('\n');
          const newToken = this.list(newText) ;
          tokens[tokens.length - 1] = newToken;

          // The list raw has no '>' markers, so it cannot be cut out of `raw`.
          // Count the continuation lines the list took and add those lines instead.
          const consumedCount = newToken.raw.length > oldToken.raw.length
            ? newText.slice(oldToken.raw.length + 1, newToken.raw.length).split('\n').length
            : 0;
          if (consumedCount > 0) {
            const consumed = lines.slice(0, consumedCount).join('\n');
            raw = `${raw}\n${consumed}`;
            text = `${text}\n${consumed}`;
          }
          lines = lines.slice(consumedCount);
          continue;
        }
      }

      return {
        type: 'blockquote',
        raw,
        tokens,
        text,
      };
    }
  }

  list(src        )                          {
    let cap = this.rules.block.list.exec(src);
    if (cap) {
      // src is only consumed from the front, so every raw below is a slice of
      // listSrc rather than a string built up line by line
      const listSrc = src;
      const taken = () => listSrc.length - src.length;
      let bull = cap[1].trim();
      const isordered = bull.length > 1;

      const list              = {
        type: 'list',
        raw: '',
        ordered: isordered,
        start: isordered ? +bull.slice(0, -1) : '',
        loose: false,
        items: [],
      };

      bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;

      if (this.options.pedantic) {
        bull = isordered ? bull : '[*+-]';
      }

      // Get next list item
      const itemRegex = this.rules.other.listItemRegex(bull);
      let endsWithBlankLine = false;
      // Check if current bullet point can start a new List Item
      while (src) {
        let endEarly = false;
        let itemContents = '';
        if (!(cap = itemRegex.exec(src))) {
          break;
        }

        if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
          break;
        }

        const itemStart = taken();
        src = src.substring(cap[0].length);

        const firstLine = firstLineOf(cap[2]);
        const bulletIndent = cap[1].length;
        let line = this.options.pedantic
          ? expandTabs(firstLine, bulletIndent)
          // Fork: leadingSpaceTab only matches at the start; skip the regex
          // when the line starts with a non-space, non-tab char.
          : (firstLine.charCodeAt(0) === 32 || firstLine.charCodeAt(0) === 9)
            ? firstLine.replace(this.rules.other.leadingSpaceTab, whitespace => expandTabs(whitespace, bulletIndent))
            : firstLine;
        let nextLine = firstLineOf(src);
        let blankLine = !line.trim();

        let indent = 0;
        if (this.options.pedantic) {
          indent = 2;
          itemContents = line.trimStart();
        } else if (blankLine) {
          indent = bulletIndent + 1;
        } else {
          indent = firstNonSpace(line); // Find first non-space char
          indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
          itemContents = line.slice(indent);
          indent += bulletIndent;
        }

        if (blankLine && this.rules.other.blankLine.test(nextLine)) { // Items begin with at most one blank line
          src = src.substring(nextLine.length + 1);
          endEarly = true;
        }

        if (!endEarly) {
          const nextBulletRegex = this.rules.other.nextBulletRegex(indent);
          const hrRegex = this.rules.other.hrRegex(indent);
          const fencesBeginRegex = this.rules.other.fencesBeginRegex(indent);
          const headingBeginRegex = this.options.pedantic
            ? this.rules.other.pedanticHeadingBeginRegex(indent)
            : this.rules.other.headingBeginRegex(indent);
          const htmlBeginRegex = this.rules.other.htmlBeginRegex(indent);
          const blockquoteBeginRegex = this.rules.other.blockquoteBeginRegex(indent);

          // Check if following lines should be included in List Item
          while (src) {
            const rawLine = firstLineOf(src);
            let nextLineWithoutTabs;
            nextLine = rawLine;

            // Re-align to follow commonmark nesting rules
            if (this.options.pedantic) {
              nextLine = nextLine.replace(this.rules.other.listReplaceNesting, '  ');
              nextLineWithoutTabs = nextLine;
            } else {
              // Fork: leadingSpaceTab only matches at the start; skip the
              // regex when the line starts with a non-space, non-tab char.
              nextLineWithoutTabs = (nextLine.charCodeAt(0) === 32 || nextLine.charCodeAt(0) === 9)
                ? nextLine.replace(this.rules.other.leadingSpaceTab, whitespace => expandTabs(whitespace))
                : nextLine;
            }

            // Fork: the six break-tests below are all anchored
            // `^ {0,indent}` and each needs a specific first marker char.
            // Find that char once and only run the regex(es) it can match;
            // plain lines skip all six. (A leading tab, or more than
            // `indent` leading spaces, matches none of them.)
            let marker = '';
            {
              let k = 0;
              while (k < nextLine.length && nextLine.charCodeAt(k) === 32) k++;
              if (k <= indent && k < nextLine.length) marker = nextLine[k];
            }
            if (
              marker === '`' || marker === '~' ? fencesBeginRegex.test(nextLine)
                : marker === '#' ? headingBeginRegex.test(nextLine)
                : marker === '<' ? htmlBeginRegex.test(nextLine)
                : marker === '>' ? blockquoteBeginRegex.test(nextLine)
                : marker === '*' ? (nextBulletRegex.test(nextLine) || hrRegex.test(nextLine))
                : marker === '+' ? nextBulletRegex.test(nextLine)
                : marker === '-' ? (nextBulletRegex.test(nextLine) || hrRegex.test(nextLine))
                : marker === '_' ? hrRegex.test(nextLine)
                : marker >= '0' && marker <= '9' ? nextBulletRegex.test(nextLine)
                : false
            ) {
              break;
            }

            // Fork: trim the line once per iteration (it is blank-tested
            // twice below).
            const nextLineIsBlank = !nextLine.trim();
            if (firstNonSpace(nextLineWithoutTabs) >= indent || nextLineIsBlank) { // Dedent if possible
              itemContents += '\n' + nextLineWithoutTabs.slice(indent);
            } else {
              // not enough indentation
              if (blankLine) {
                break;
              }

              // paragraph continuation unless last line was a different block level element
              // Fork: the tab replace is identity when the line has no tab.
              if (firstNonSpace(line.includes('\t') ? line.replace(this.rules.other.tabCharGlobal, '    ') : line) >= 4) { // indented code block
                break;
              }
              if (fencesBeginRegex.test(line)) {
                break;
              }
              if (headingBeginRegex.test(line)) {
                break;
              }
              if (htmlBeginRegex.test(line)) {
                break;
              }
              if (hrRegex.test(line)) {
                break;
              }

              // A lazy continuation can look like a setext underline after
              // list indentation is removed. Keep it in the paragraph.
              const setextContinuation = !this.options.pedantic
                && /^ {0,3}(?:=+|-+) *$/.test(nextLine)
                && this.rules.block.lheading.test(`${line}\n${nextLine}`);
              const continuation = setextContinuation
                ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
                : nextLine;
              itemContents += '\n' + continuation;
            }

            blankLine = nextLineIsBlank;

            src = src.substring(rawLine.length + 1);
            line = nextLineWithoutTabs.slice(indent);
          }
        }

        // The loops above appended a '\n' the source may not have had. It could
        // only land on the item that exhausts src, whose raw is trimmed below,
        // and after which nothing reads endsWithBlankLine
        const raw = listSrc.slice(itemStart, taken());

        if (!list.loose) {
          // If the previous item ended with a blank line, the list is loose
          if (endsWithBlankLine) {
            list.loose = true;
          } else if (endsWithDoubleBlankLine(raw)) {
            endsWithBlankLine = true;
          }
        }

        list.items.push({
          type: 'list_item',
          raw,
          task: !!this.options.gfm && this.rules.other.listIsTask.test(itemContents),
          loose: false,
          text: itemContents,
          tokens: [],
        });
      }

      // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
      const lastItem = list.items.at(-1);
      if (lastItem) {
        lastItem.raw = lastItem.raw.trimEnd();
        lastItem.text = lastItem.text.trimEnd();
      } else {
        // not a list since there were no items
        return;
      }
      list.raw = listSrc.slice(0, taken()).trimEnd();

      // Item child tokens handled here at end because we needed to have the final item to trim it first
      // First pass: tokenize items and finalize list.loose from spacers before placing checkboxes
      for (const item of list.items) {
        this.lexer.state.top = false;
        item.tokens = this.lexer.blockTokens(item.text, []);

        if (!list.loose) {
          // Check if list should be loose
          const spacers = item.tokens.filter(t => t.type === 'space');
          const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => this.rules.other.anyLine.test(t.raw));

          list.loose = hasMultipleLineBreaks;
        }
      }

      // Second pass: place task checkboxes using the final list.loose
      for (const item of list.items) {
        const itemToken = item.tokens[0];
        if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
          // Remove checkbox markdown from item tokens
          item.text = item.text.replace(this.rules.other.listReplaceTask, '');
          itemToken.raw = itemToken.raw.replace(this.rules.other.listReplaceTask, '');
          itemToken.text = itemToken.text.replace(this.rules.other.listReplaceTask, '');
          for (let i = this.lexer.inlineQueue.length - 1; i >= 0; i--) {
            if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[i].src)) {
              this.lexer.inlineQueue[i].src = this.lexer.inlineQueue[i].src.replace(this.rules.other.listReplaceTask, '');
              break;
            }
          }

          const taskRaw = this.rules.other.listTaskCheckbox.exec(item.raw);
          if (taskRaw) {
            const checkboxToken                  = {
              type: 'checkbox',
              raw: taskRaw[0] + ' ',
              checked: taskRaw[0] !== '[ ]',
            };
            item.checked = checkboxToken.checked;
            if (list.loose) {
              if (item.tokens[0] && ['paragraph', 'text'].includes(item.tokens[0].type) && 'tokens' in item.tokens[0] && item.tokens[0].tokens) {
                item.tokens[0].raw = checkboxToken.raw + item.tokens[0].raw;
                item.tokens[0].text = checkboxToken.raw + item.tokens[0].text;
                item.tokens[0].tokens.unshift(checkboxToken);
              } else {
                item.tokens.unshift({
                  type: 'paragraph',
                  raw: checkboxToken.raw,
                  text: checkboxToken.raw,
                  tokens: [checkboxToken],
                });
              }
            } else {
              item.tokens.unshift(checkboxToken);
            }
          }
        } else if (item.task) {
          item.task = false;
        }
      }

      // Set all items to loose if list is loose
      if (list.loose) {
        for (const item of list.items) {
          item.loose = true;
          for (const token of item.tokens) {
            if (token.type === 'text') {
              token.type = 'paragraph';
            }
          }
        }
      }

      return list;
    }
  }

  html(src        )                          {
    const cap = this.rules.block.html.exec(src);
    if (cap) {
      const raw = trimTrailingBlankLines(cap[0]);
      const token              = {
        type: 'html',
        block: true,
        raw,
        pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
        text: raw,
      };
      return token;
    }
  }

  def(src        )                         {
    const cap = this.rules.block.def.exec(src);
    if (cap) {
      // outside angle brackets a link destination holds only balanced parentheses
      if (!this.rules.other.startAngleBracket.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) {
        return;
      }

      const tag = normalizeLabel(cap[1]);
      const href = cap[2] ? cap[2].replace(this.rules.other.hrefBrackets, '$1').replace(this.rules.inline.anyPunctuation, '$1') : '';
      const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, '$1') : cap[3];
      return {
        type: 'def',
        tag,
        raw: rtrim(cap[0], '\n'),
        href,
        title,
      };
    }
  }

  table(src        )                           {
    // Fork: a table needs a header line and a delimiter row, so it
    // needs a newline; without one the big regex cannot match.
    if (src.indexOf("\n") === -1) {
      return;
    }
    const cap = this.rules.block.table.exec(src);
    if (!cap) {
      return;
    }

    if (!this.rules.other.tableDelimiter.test(cap[2])) {
      // delimiter row must have a pipe (|) or colon (:) otherwise it is a setext heading
      return;
    }

    const headers = splitCells(cap[1]);
    const aligns = cap[2].replace(this.rules.other.tableAlignChars, '').split('|');
    const rows = cap[3]?.trim() ? cap[3].replace(this.rules.other.tableRowBlankLine, '').split('\n') : [];

    const item               = {
      type: 'table',
      raw: rtrim(cap[0], '\n'),
      header: [],
      align: [],
      rows: [],
    };

    if (headers.length !== aligns.length) {
      // header and align columns must be equal, rows can be different.
      return;
    }

    for (const align of aligns) {
      if (this.rules.other.tableAlignRight.test(align)) {
        item.align.push('right');
      } else if (this.rules.other.tableAlignCenter.test(align)) {
        item.align.push('center');
      } else if (this.rules.other.tableAlignLeft.test(align)) {
        item.align.push('left');
      } else {
        item.align.push(null);
      }
    }

    for (let i = 0; i < headers.length; i++) {
      item.header.push({
        text: headers[i],
        tokens: this.lexer.inline(headers[i]),
        header: true,
        align: item.align[i],
      });
    }

    for (const row of rows) {
      item.rows.push(splitCells(row, item.header.length).map((cell, i) => {
        return {
          text: cell,
          tokens: this.lexer.inline(cell),
          header: false,
          align: item.align[i],
        };
      }));
    }

    return item;
  }

  lheading(src        )                             {
    // Fork: a setext underline needs a newline followed (within 3 spaces)
    // by `=` or `-`; without that pattern anywhere the big regex cannot
    // match, so skip it. A manual scan (indexOf for the newlines) is
    // exactly equivalent to /\n {0,3}[=-]/ and cheaper than the regex.
    if (!hasSetextUnderline(src)) {
      return;
    }
    const cap = this.rules.block.lheading.exec(src);
    if (cap) {
      const text = cap[1].trim();
      return {
        type: 'heading',
        raw: rtrim(cap[0], '\n'),
        depth: cap[2].charAt(0) === '=' ? 1 : 2,
        text,
        tokens: this.lexer.inline(text),
      };
    }
  }

  paragraph(src        )                               {
    const cap = this.rules.block.paragraph.exec(src);
    if (cap) {
      const text = cap[1].charAt(cap[1].length - 1) === '\n'
        ? cap[1].slice(0, -1)
        : cap[1];
      return {
        type: 'paragraph',
        raw: cap[0],
        text,
        tokens: this.lexer.inline(text),
      };
    }
  }

  text(src        )                          {
    const cap = this.rules.block.text.exec(src);
    if (cap) {
      return {
        type: 'text',
        raw: cap[0],
        text: cap[0],
        tokens: this.lexer.inline(cap[0]),
      };
    }
  }

  escape(src        )                            {
    const cap = this.rules.inline.escape.exec(src);
    if (cap) {
      return {
        type: 'escape',
        raw: cap[0],
        text: cap[1],
      };
    }
  }

  tag(src        )                         {
    const cap = this.rules.inline.tag.exec(src);
    if (cap) {
      if (!this.lexer.state.inLink && this.rules.other.startATag.test(cap[0])) {
        this.lexer.state.inLink = true;
      } else if (this.lexer.state.inLink && this.rules.other.endATag.test(cap[0])) {
        this.lexer.state.inLink = false;
      }
      if (!this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(cap[0])) {
        this.lexer.state.inRawBlock = true;
      } else if (this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(cap[0])) {
        this.lexer.state.inRawBlock = false;
      }

      return {
        type: 'html',
        raw: cap[0],
        inLink: this.lexer.state.inLink,
        inRawBlock: this.lexer.state.inRawBlock,
        block: false,
        text: cap[0],
      };
    }
  }

  link(src        )                                         {
    // The link regex backtracks quadratically over unterminated-link inputs
    // like '[a](b'.repeat(n): at every '[' its greedy unquoted-href run
    // re-partitions the whole remainder while hunting for a ')' that never
    // comes. inlineTokens anchors one paren scan per run in
    // state.linkParenPossible; when it is false the regex cannot match, so
    // bail out before running it.
    if (this.lexer.state.linkParenPossible === false) {
      return undefined;
    }
    const cap = this.rules.inline.link.exec(src);
    if (cap) {
      const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
      if (!this.options.pedantic && isLabelEndInsideToken(src, cap[1], labelStart, this.rules)) {
        return;
      }

      const trimmedUrl = cap[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(trimmedUrl)) {
        // commonmark requires matching angle brackets
        if (!(this.rules.other.endAngleBracket.test(trimmedUrl))) {
          return;
        }

        // ending angle bracket cannot be escaped
        const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
        if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
          return;
        }
      } else {
        // find closing parenthesis
        const lastParenIndex = findClosingBracket(cap[2], '()');
        if (lastParenIndex === -2) {
          // more open parens than closed
          return;
        }

        if (lastParenIndex > -1) {
          const start = cap[0].indexOf('!') === 0 ? 5 : 4;
          const linkLen = start + cap[1].length + lastParenIndex;
          cap[2] = cap[2].substring(0, lastParenIndex);
          cap[0] = cap[0].substring(0, linkLen).trim();
          cap[3] = '';
        }
      }
      // The ')' that ends the match is the link closer only when it is not
      // escaped. `[foo](/url\)` has no closer; that paren is destination text.
      const unescaped = rtrim(cap[0].slice(0, -1), '\\');
      if ((cap[0].length - unescaped.length) % 2 === 0) {
        return;
      }
      let href = cap[2];
      let title = '';
      if (this.options.pedantic) {
        // split pedantic href and title
        const link = this.rules.other.pedanticHrefTitle.exec(href);

        if (link) {
          href = link[1];
          title = link[3];
        }
      } else {
        title = cap[3] ? cap[3].slice(1, -1) : '';
      }

      href = href.trim();
      if (this.rules.other.startAngleBracket.test(href)) {
        if (this.options.pedantic && !(this.rules.other.endAngleBracket.test(trimmedUrl))) {
          // pedantic allows starting angle bracket without ending angle bracket
          href = href.slice(1);
        } else {
          href = href.slice(1, -1);
        }
      }
      return outputLink(cap, {
        href: href ? href.replace(this.rules.inline.anyPunctuation, '$1') : href,
        title: title ? title.replace(this.rules.inline.anyPunctuation, '$1') : title,
      }, cap[0], this.lexer, this.rules);
    }
  }

  reflink(src        , links       )                                                       {
    let cap;
    if ((cap = this.rules.inline.reflink.exec(src))
      || (cap = this.rules.inline.nolink.exec(src))) {
      const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
      if (!this.options.pedantic && isLabelEndInsideToken(src, cap[1], labelStart, this.rules)) {
        return;
      }

      const link = links[normalizeLabel(cap[2] || cap[1])];
      if (!link) {
        const text = cap[0].charAt(0);
        return {
          type: 'text',
          raw: text,
          text,
        };
      }
      return outputLink(cap, link, cap[0], this.lexer, this.rules);
    }
  }

  emStrong(src        , maskedSrc        , prevChar = '')                                        {
    let match = this.rules.inline.emStrongLDelim.exec(src);
    if (!match) return;
    if (!match[1] && !match[2] && !match[3] && !match[4]) return;

    const delimChar = match[0][0];
    // A mid-run opener (for example the second star of an unmatched `**`) must
    // only pair with a delimiter that can only close, otherwise it steals the
    // opener of a later span (`**a*b*c` must be `**a<em>b</em>c`).
    const midRun = prevChar === delimChar;

    // The start of this delimiter run may already be behind src, either taken
    // as text after the whole run failed to match or used to close an earlier
    // span. Flanking and rules 9-10 are about the whole run, so find its start.
    // Pedantic follows markdown.pl, which has no such rules.
    const srcStart = maskedSrc.length - src.length;
    let runStart = srcStart;
    while (!this.options.pedantic && runStart > 0 && maskedSrc[runStart - 1] === delimChar) {
      runStart--;
    }
    // Fork: the last code point before the run, without spreading the
    // slice into an array — a low surrogate as the last unit means the
    // char is the two-unit pair ending there.
    let runPrevChar = '';
    if (runStart > 0) {
      const c = maskedSrc.charCodeAt(runStart - 1);
      runPrevChar = (c >= 0xDC00 && c <= 0xDFFF && runStart >= 2)
        ? maskedSrc.slice(runStart - 2, runStart)
        : maskedSrc[runStart - 1];
    }
    // The other delimiter character counts as punctuation here (`_**a*`)
    const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || !!this.rules.inline.punctuation.exec(runPrevChar);
    if (runStart < srcStart) {
      prevChar = runPrevChar;
    }
    const prevPunct = runStart < srcStart ? runPrevPunct : !!this.rules.inline.punctuation.exec(prevChar);

    // _ can't be between two alphanumerics. \p{L}\p{N} includes non-english alphabet/numbers as well
    if (match[4] && prevChar.match(this.rules.other.unicodeAlphaNumeric)) return;

    const nextChar = match[1] || match[3] || '';

    if (!nextChar || !prevChar || prevPunct) {
      // unicode Regex counts emoji as 1 char; spread into array for proper count (used multiple times below)
      let lLength = match[0].length - 1;
      const lastUnit = match[0].charCodeAt(match[0].length - 1);
      if (lastUnit >= 0xDC00 && lastUnit <= 0xDFFF) lLength--;
      let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;

      // Rules 9-10 count the whole run, and also apply when the opener could
      // close as well (`a*b**`, where `*` is both left- and right-flanking).
      const runLength = srcStart - runStart + lLength;
      const openerCanClose = !this.options.pedantic && !!runPrevChar.trim()
        && (!!nextChar || (delimChar === '*' && !runPrevPunct));
      if (delimChar !== '*' && delimChar !== '_') return;
      const endReg = delimChar === '*' ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      const lastPossibleEmStrongCloserIndex = cachedLastPossibleEmStrongCloserIndex(this, maskedSrc, delimChar);
      const emStrongCloserWindowStart = maskedSrc.length - src.length + lLength;
      if (lastPossibleEmStrongCloserIndex < emStrongCloserWindowStart) return;
      // Clip maskedSrc to same section of string as src (move to lexer?)
      maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
      const lastPossibleEmStrongCloserIndexInWindow = lastPossibleEmStrongCloserIndex - emStrongCloserWindowStart;
      endReg.lastIndex = 0;

      while ((match = endReg.exec(maskedSrc)) !== null) {
        if (match.index > lastPossibleEmStrongCloserIndexInWindow) break;
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];

        if (!rDelim) continue; // skip single * in __abc*abc__

        rLength = rDelim.length;

        if (match[3] || match[4]) { // found another Left Delim
          delimTotal += rLength;
          continue;
        } else if (match[5] || match[6] || openerCanClose) { // either Left or Right Delim
          if (midRun && (match[5] || match[6])) {
            // A mid-run opener cannot close against an ambiguous delimiter that
            // can also open; that delimiter opens its own emphasis span instead.
            break;
          }
          if (runLength % 3 && !((runLength + rLength) % 3)) {
            midDelimTotal += rLength;
            continue; // CommonMark Emphasis Rules 9-10
          }
        }

        delimTotal -= rLength;

        if (delimTotal > 0) continue; // Haven't found enough closing delimiters

        // Remove extra characters. *a*** -> *a*
        rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
        // char length can be >1 for unicode characters;
        const lastCharLength = match[0].codePointAt(0) > 0xFFFF ? 2 : 1;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

        // Create `em` if smallest delimiter has odd char count. *a***
        if (Math.min(lLength, rLength) % 2) {
          const text = raw.slice(1, -1);
          return {
            type: 'em',
            raw,
            text,
            tokens: this.lexer.inlineTokens(text),
          };
        }

        // Create 'strong' if smallest delimiter has even char count. **a***
        const text = raw.slice(2, -2);
        return {
          type: 'strong',
          raw,
          text,
          tokens: this.lexer.inlineTokens(text),
        };
      }
    }
  }

  codespan(src        )                              {
    const cap = this.rules.inline.code.exec(src);
    if (cap) {
      let text = cap[2].replace(this.rules.other.newLineCharGlobal, ' ');
      const hasNonSpaceChars = this.rules.other.nonSpaceChar.test(text);
      const hasSpaceCharsOnBothEnds = this.rules.other.startingSpaceChar.test(text) && this.rules.other.endingSpaceChar.test(text);
      if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
        text = text.substring(1, text.length - 1);
      }
      return {
        type: 'codespan',
        raw: cap[0],
        text,
      };
    }
  }

  br(src        )                        {
    const cap = this.rules.inline.br.exec(src);
    if (cap) {
      return {
        type: 'br',
        raw: cap[0],
      };
    }
  }

  del(src        , maskedSrc        , prevChar = '')                         {
    let match = this.rules.inline.delLDelim.exec(src);
    if (!match) return;

    const nextChar = match[1] || '';

    if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
      // unicode Regex counts emoji as 1 char; spread into array for proper count
      let lLength = match[0].length - 1;
      const lastUnit = match[0].charCodeAt(match[0].length - 1);
      if (lastUnit >= 0xDC00 && lastUnit <= 0xDFFF) lLength--;
      let rDelim, rLength, delimTotal = lLength;

      const endReg = this.rules.inline.delRDelim;
      const lastPossibleDelCloserIndex = cachedLastPossibleDelCloserIndex(this, maskedSrc);
      const delCloserWindowStart = maskedSrc.length - src.length + lLength;
      if (lastPossibleDelCloserIndex < delCloserWindowStart) return;
      // Clip maskedSrc to same section of string as src
      maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
      const lastPossibleDelCloserIndexInWindow = lastPossibleDelCloserIndex - delCloserWindowStart;
      endReg.lastIndex = 0;

      while ((match = endReg.exec(maskedSrc)) !== null) {
        if (match.index > lastPossibleDelCloserIndexInWindow) break;
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];

        if (!rDelim) continue;

        rLength = rDelim.length;

        if (rLength !== lLength) continue;

        if (match[3] || match[4]) { // found another Left Delim
          delimTotal += rLength;
          continue;
        }

        delimTotal -= rLength;

        if (delimTotal > 0) continue; // Haven't found enough closing delimiters

        // Remove extra characters
        rLength = Math.min(rLength, rLength + delimTotal);
        // char length can be >1 for unicode characters
        const lastCharLength = match[0].codePointAt(0) > 0xFFFF ? 2 : 1;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

        // Create del token - only single ~ or double ~~ supported
        const text = raw.slice(lLength, -lLength);
        return {
          type: 'del',
          raw,
          text,
          tokens: this.lexer.inlineTokens(text),
        };
      }
    }
  }

  autolink(src        )                          {
    const cap = this.rules.inline.autolink.exec(src);
    if (cap) {
      let text, href;
      if (cap[2] === '@') {
        text = cap[1];
        href = 'mailto:' + text;
      } else {
        text = cap[1];
        href = text;
      }

      return {
        type: 'link',
        raw: cap[0],
        text,
        href,
        autolink: true,
        tokens: [
          {
            type: 'text',
            raw: text,
            text,
          },
        ],
      };
    }
  }

  url(src        )                          {
    let cap;
    if (cap = this.rules.inline.url.exec(src)) {
      let text, href;
      if (cap[2] === '@') {
        text = cap[0];
        href = 'mailto:' + text;
      } else {
        // do extended autolink path validation
        let prevCapZero;
        do {
          prevCapZero = cap[0];
          cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? '';
        } while (prevCapZero !== cap[0]);
        text = cap[0];
        if (cap[1] === 'www.') {
          href = 'http://' + cap[0];
        } else {
          href = cap[0];
        }
      }
      return {
        type: 'link',
        raw: cap[0],
        text,
        href,
        autolink: true,
        tokens: [
          {
            type: 'text',
            raw: text,
            text,
          },
        ],
      };
    }
  }

  inlineText(src        )                          {
    const cap = this.rules.inline.text.exec(src);
    if (cap) {
      const escaped = this.lexer.state.inRawBlock;
      return {
        type: 'text',
        raw: cap[0],
        // raw HTML keeps whatever it was written with, everywhere else a numeric
        // character reference stands for the character itself
        text: escaped ? cap[0] : decodeNumericCharacterReferences(cap[0]),
        escaped,
      };
    }
  }
}
