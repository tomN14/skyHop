"""SPL lexer: source text → token stream."""

import re


def _decode_spl_string_escapes(inner, line):
    """Decode escape sequences inside a double-quoted string body (no surrounding quotes)."""
    out = []
    i = 0
    n = len(inner)
    while i < n:
        if inner[i] != "\\":
            out.append(inner[i])
            i += 1
            continue
        if i + 1 >= n:
            raise Exception(f"[Line {line}] Unterminated escape at end of string")
        c = inner[i + 1]
        if c == "n":
            out.append("\n")
        elif c == "'":
            out.append("'")
        elif c == '"':
            out.append('"')
        elif c == "\\":
            out.append("\\")
        elif c == "t":
            out.append("\t")
        elif c == "r":
            out.append("\r")
        else:
            raise Exception(f"[Line {line}] Unknown escape sequence: \\{c}")
        i += 2
    return "".join(out)


# =============================================================================
# LEXER — source text → list[Token]  (search: tokenize)
# =============================================================================

TOKEN_SPEC = [
    ('COMMENT',   r'#comment:.*'),
    ('NUMBER',    r'-?\d+(\.\d*)?'),
    ('STRING',    r'"(?:[^"\\]|\\.)*"'),
    ('BOOLEAN',   r'\b(true|false)\b'),
    ('NOT',       r'\bnot\b'),
    ('NAND',      r'\bnand\b'),
    ('AND',       r'\band\b'),
    ('NOR',       r'\bnor\b'),
    ('XNOR',      r'\bxnor\b'),
    ('XOR',       r'\bxor\b'),
    ('OR',        r'\bor\b'),
    ('DOT',       r'\.'),
    ('LPAREN',    r'\('),
    ('RPAREN',    r'\)'),
    ('COLON',     r':'),
    ('END',       r'end\b'),
    ('USE',       r'use\b'),
    ('AWAIT',     r'\bawait\b'),
    ('CODEKW',    r'\bcode\b'),
    ('LEFTARROW', r'<-'),
    ('ASSIGN',    r'='),
    ('ID',        r'[A-Za-z_][A-Za-z0-9_]*'),
    ('SEMICOLON', r';'),
    ('NEWLINE',   r'\n'),
    ('SKIP',      r'[ \t]+'),
    ('COMMA',     r','),
    ('LBRACKET',  r'\['),
    ('RBRACKET',  r'\]'),
    ('LBRACE',    r'\{'),
    ('RBRACE',    r'\}'),
    ('QMARK',     r'\?'),
    ('ERROR',     r'.'),
]

class Token:
    def __init__(self, t, v, line):
        self.t, self.v, self.line = t, v, line


def tokenize(code):
    tok_regex = '|'.join('(?P<%s>%s)' % pair for pair in TOKEN_SPEC)
    tokens, line_num = [], 1
    for mo in re.finditer(tok_regex, code):
        kind, val = mo.lastgroup, mo.group()
        if kind in ['COMMENT','SKIP']: continue
        elif kind == 'NEWLINE': line_num += 1; continue
        elif kind == "ERROR":
            raise Exception(
                f"[Line {line_num}] lexer: unexpected character {val!r}; "
                "check string quotes, semicolons, and that identifiers start with a letter"
            )
        elif kind == 'BOOLEAN': val = 1 if val=='true' else 0
        elif kind == 'NUMBER': val = float(val) if '.' in val else int(val)
        elif kind == 'STRING':
            val = _decode_spl_string_escapes(val[1:-1], line_num)
        tokens.append(Token(kind,val,line_num))
    tokens.append(Token("EOF",None,line_num))
    return tokens
