                                          
                                           

/**
 * TextRenderer
 * returns only the textual part of the token
 */
export class _TextRenderer                          {
  parser                                   ;
  // no need for block level renderers
  strong({ text, tokens }               )                 {
    return (tokens ? this.parser.parseInline(tokens, this) : text)                  ;
  }

  em({ text, tokens }           )                 {
    return (tokens ? this.parser.parseInline(tokens, this) : text)                  ;
  }

  codespan({ text }                 )                 {
    return text                  ;
  }

  del({ text, tokens }            )                 {
    return (tokens ? this.parser.parseInline(tokens, this) : text)                  ;
  }

  html({ text }                          )                 {
    return text                  ;
  }

  text({ text }                                          )                 {
    return text                  ;
  }

  link({ text, tokens }             )                 {
    return (tokens ? this.parser.parseInline(tokens, this) : text)                  ;
  }

  image({ text, tokens }              )                 {
    return (tokens ? this.parser.parseInline(tokens, this) : text)                  ;
  }

  br()                 {
    return ''                  ;
  }

  checkbox({ raw }                 )                 {
    return raw                  ;
  }
}
