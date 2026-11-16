import { _defaults } from './defaults.js';
import {
  cleanUrl,
  escapeHtmlEntities,
} from './helpers.js';
import { other } from './rules.js';
                                                        
                                          
                                           

/**
 * Renderer
 */
export class _Renderer                                                 {
  options                                             ;
  parser                                        ; // set by the parser
  constructor(options                                              ) {
    this.options = options || _defaults;
  }

  space(token              )                 {
    return ''                  ;
  }

  code({ text, lang, escaped }             )                 {
    const langString = (lang || '').match(other.notSpaceStart)?.[0];

    // An empty code block has no content, so it must not gain a newline.
    const code = text ? text.replace(other.endingNewline, '') + '\n' : '';

    if (!langString) {
      return '<pre><code>'
        + (escaped ? code : escapeHtmlEntities(code, true))
        + '</code></pre>\n'                  ;
    }

    return '<pre><code class="language-'
      + escapeHtmlEntities(langString)
      + '">'
      + (escaped ? code : escapeHtmlEntities(code, true))
      + '</code></pre>\n'                  ;
  }

  blockquote({ tokens }                   )                 {
    const body = this.parser.parse(tokens);
    return `<blockquote>\n${body}</blockquote>\n`                  ;
  }

  html({ text }                          )                 {
    return text                  ;
  }

  def(token            )                 {
    return ''                  ;
  }

  heading({ tokens, depth }                )                 {
    return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>\n`                  ;
  }

  hr(token           )                 {
    return '<hr>\n'                  ;
  }

  list(token             )                 {
    const ordered = token.ordered;
    const start = token.start;

    let body = '';
    for (let j = 0; j < token.items.length; j++) {
      const item = token.items[j];
      body += this.listitem(item);
    }

    const type = ordered ? 'ol' : 'ul';
    const startAttr = (ordered && start !== 1) ? (' start="' + start + '"') : '';
    return '<' + type + startAttr + '>\n' + body + '</' + type + '>\n'                  ;
  }

  listitem(item                 )                 {
    return `<li>${this.parser.parse(item.tokens)}</li>\n`                  ;
  }

  checkbox({ checked }                 )                 {
    return '<input '
      + (checked ? 'checked="" ' : '')
      + 'disabled="" type="checkbox"> '                  ;
  }

  paragraph({ tokens }                  )                 {
    return `<p>${this.parser.parseInline(tokens)}</p>\n`                  ;
  }

  table(token              )                 {
    let header = '';

    // header
    let cell = '';
    for (let j = 0; j < token.header.length; j++) {
      cell += this.tablecell(token.header[j]);
    }
    header += this.tablerow({ text: cell                 });

    let body = '';
    for (let j = 0; j < token.rows.length; j++) {
      const row = token.rows[j];

      cell = '';
      for (let k = 0; k < row.length; k++) {
        cell += this.tablecell(row[k]);
      }

      body += this.tablerow({ text: cell                 });
    }
    if (body) body = `<tbody>${body}</tbody>`;

    return '<table>\n'
      + '<thead>\n'
      + header
      + '</thead>\n'
      + body
      + '</table>\n'                  ;
  }

  tablerow({ text }                               )                 {
    return `<tr>\n${text}</tr>\n`                  ;
  }

  tablecell(token                  )                 {
    const content = this.parser.parseInline(token.tokens);
    const type = token.header ? 'th' : 'td';
    const tag = token.align
      ? `<${type} align="${token.align}">`
      : `<${type}>`;
    return tag + content + `</${type}>\n`                  ;
  }

  /**
   * span level renderer
   */
  strong({ tokens }               )                 {
    return `<strong>${this.parser.parseInline(tokens)}</strong>`                  ;
  }

  em({ tokens }           )                 {
    return `<em>${this.parser.parseInline(tokens)}</em>`                  ;
  }

  codespan({ text }                 )                 {
    return `<code>${escapeHtmlEntities(text, true)}</code>`                  ;
  }

  br(token           )                 {
    return '<br>'                  ;
  }

  del({ tokens }            )                 {
    return `<del>${this.parser.parseInline(tokens)}</del>`                  ;
  }

  link({ href, title, text, tokens, autolink }             )                 {
    // References are not resolved inside an autolink, so every `&` there is
    // literal. Elsewhere only an `&` that cannot start one needs escaping.
    const parsedText = autolink
      ? escapeHtmlEntities(text, true)
      : this.parser.parseInline(tokens)          ;
    const cleanHref = cleanUrl(href);
    if (cleanHref === null) {
      return parsedText                  ;
    }
    href = escapeHtmlEntities(cleanHref, autolink);
    let out = '<a href="' + href + '"';
    if (title) {
      out += ' title="' + (escapeHtmlEntities(title)) + '"';
    }
    out += '>' + parsedText + '</a>';
    return out                  ;
  }

  image({ href, title, text, tokens }              )                 {
    if (tokens) {
      text = this.parser.parseInline(tokens, this.parser.textRenderer)          ;
    }
    const cleanHref = cleanUrl(href);
    if (cleanHref === null) {
      return escapeHtmlEntities(text)                  ;
    }
    href = cleanHref;

    let out = `<img src="${escapeHtmlEntities(href)}" alt="${escapeHtmlEntities(text)}"`;
    if (title) {
      out += ` title="${escapeHtmlEntities(title)}"`;
    }
    out += '>';
    return out                  ;
  }

  text(token                             )                 {
    return 'tokens' in token && token.tokens
      ? this.parser.parseInline(token.tokens)                             
      : ('escaped' in token && token.escaped ? token.text                   : escapeHtmlEntities(token.text)                  );
  }
}
