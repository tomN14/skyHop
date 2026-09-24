"""SPL parser: tokens → AST (see spl_ast)."""

from .spl_ast import (
    AwaitNode,
    BlockNode,
    ExprStmtNode,
    FuncParam,
    HashLiteralNode,
    ImportNode,
    InheritNode,
    LogicNode,
    MethodCallNode,
    SetLiteralNode,
    SliceAssignNode,
    ThisAssignNode,
    TryExceptNode,
    TupleLiteralNode,
)
from .spl_lexer import Token

# =============================================================================
# PARSER HELPERS — clearer parse errors (used by Parser.consume)
# =============================================================================

_PARSE_TOKEN_LABELS = {
    "SEMICOLON": "semicolon ';'",
    "COLON": "colon ':'",
    "LPAREN": "left parenthesis '('",
    "RPAREN": "right parenthesis ')'",
    "LBRACKET": "left bracket '['",
    "RBRACKET": "right bracket ']'",
    "LBRACE": "left brace '{'",
    "RBRACE": "right brace '}'",
    "DOT": "dot '.'",
    "COMMA": "comma ','",
    "END": "keyword 'end'",
    "USE": "keyword 'use'",
    "LEFTARROW": "operator '<-'",
    "CODEKW": "keyword 'code'",
    "EOF": "end of file",
}


def _spl_format_token(tok):
    if tok is None:
        return "end of file"
    if tok.t == "ID":
        return f"identifier '{tok.v}'"
    if tok.t in _PARSE_TOKEN_LABELS:
        return _PARSE_TOKEN_LABELS[tok.t]
    if tok.t in ("STRING", "NUMBER", "BOOLEAN"):
        return f"{tok.t.lower()} {tok.v!r}"
    return f"{tok.t} ({tok.v!r})"


def _spl_parse_expect_hint(expected_type, got_type):
    if expected_type == "SEMICOLON" and got_type == "COLON":
        return "statements end with ';'; ':' starts a block body"
    if expected_type == "END" and got_type == "SEMICOLON":
        return "close the block with 'end' before the next statement"
    if expected_type == "COLON" and got_type == "SEMICOLON":
        return "put ':' after the header before the block body"
    return None


# =============================================================================
# PARSER — Token stream → AST nodes  (search: class Parser)
# =============================================================================

class Parser:
    def __init__(self,tokens): self.tokens, self.pos = tokens,0
    def consume(self, expected_type=None):
        token = self.tokens[self.pos]
        if expected_type and token.t != expected_type:
            want = _PARSE_TOKEN_LABELS.get(expected_type, expected_type)
            got = _spl_format_token(token)
            hint = _spl_parse_expect_hint(expected_type, token.t)
            msg = f"[Line {token.line}] parse: expected {want}, found {got}"
            if hint:
                msg += f"; {hint}"
            raise Exception(msg)
        self.pos += 1
        return token
    def peek(self,offset=0):
        if self.pos+offset>=len(self.tokens): return self.tokens[-1]
        return self.tokens[self.pos+offset]

    def parse_expression(self):
        if self.tokens[self.pos].t=="LBRACKET":
            self.consume("LBRACKET")
            elements=[]
            if self.tokens[self.pos].t!="RBRACKET":
                elements.append(self.parse_expression())
                while self.tokens[self.pos].t=="COMMA":
                    self.consume("COMMA")
                    elements.append(self.parse_expression())
            self.consume("RBRACKET")
            return elements
        if self.tokens[self.pos].t=="LBRACE":
            return self.parse_brace_literal()
        return self.parse_logic_nor()

    def parse_brace_literal(self):
        """`{k: v, ...}` hash literal or `{a, b, ...}` set literal (no duplicates at runtime)."""
        start = self.consume("LBRACE")
        if self.tokens[self.pos].t == "RBRACE":
            self.consume("RBRACE")
            return HashLiteralNode([], start.line)
        first = self.parse_expression()
        if self.tokens[self.pos].t == "COLON":
            self.consume("COLON")
            val = self.parse_expression()
            pairs = [(first, val)]
            while self.tokens[self.pos].t == "COMMA":
                self.consume("COMMA")
                key = self.parse_expression()
                self.consume("COLON")
                val = self.parse_expression()
                pairs.append((key, val))
            self.consume("RBRACE")
            return HashLiteralNode(pairs, start.line)
        elements = [first]
        while self.tokens[self.pos].t == "COMMA":
            self.consume("COMMA")
            elements.append(self.parse_expression())
        self.consume("RBRACE")
        return SetLiteralNode(elements, start.line)

    def parse_logic_nor(self):
        left=self.parse_logic_xor_xnor()
        while self.tokens[self.pos].t=="NOR":
            op=self.consume("NOR")
            right=self.parse_logic_xor_xnor()
            left=LogicNode(left,op.v,right,op.line)
        return left

    def parse_logic_xor_xnor(self):
        left=self.parse_logic_or()
        while self.tokens[self.pos].t in ("XOR","XNOR"):
            op=self.consume()
            right=self.parse_logic_or()
            left=LogicNode(left,op.v,right,op.line)
        return left

    def parse_logic_or(self):
        left=self.parse_logic_and()
        while self.tokens[self.pos].t=="OR":
            op=self.consume("OR")
            right=self.parse_logic_and()
            left=LogicNode(left,op.v,right,op.line)
        return left

    def parse_logic_and(self):
        left=self.parse_logic_nand()
        while self.tokens[self.pos].t=="AND":
            op=self.consume("AND")
            right=self.parse_logic_nand()
            left=LogicNode(left,op.v,right,op.line)
        return left

    def parse_logic_nand(self):
        left=self.parse_logic_not()
        while self.tokens[self.pos].t=="NAND":
            op=self.consume("NAND")
            right=self.parse_logic_not()
            left=LogicNode(left,op.v,right,op.line)
        return left

    def parse_logic_not(self):
        if self.tokens[self.pos].t == "AWAIT":
            line = self.consume("AWAIT").line
            operand = self.parse_logic_not()
            return AwaitNode(operand, line)
        if self.tokens[self.pos].t=="NOT":
            op=self.consume("NOT")
            operand=self.parse_logic_not()
            return LogicNode(None,op.v,operand,op.line)
        return self.parse_logic_primary()

    def parse_logic_primary(self):
        if self.tokens[self.pos].t=="LPAREN":
            line=self.tokens[self.pos].line
            self.consume("LPAREN")
            if self.tokens[self.pos].t=="RPAREN":
                self.consume("RPAREN")
                return TupleLiteralNode([], line)
            first=self.parse_expression()
            if self.tokens[self.pos].t=="COMMA":
                elements=[first]
                while self.tokens[self.pos].t=="COMMA":
                    self.consume("COMMA")
                    elements.append(self.parse_expression())
                self.consume("RPAREN")
                return TupleLiteralNode(elements, line)
            self.consume("RPAREN")
            return first
        if self.tokens[self.pos].t=="ID" and self.peek(1).t=="DOT":
            # Allow property-like member tokens in expressions (e.g. list.iterable).
            if self.peek(3).t!="LPAREN":
                token_start=self.tokens[self.pos]
                obj=self.consume("ID").v
                self.consume("DOT")
                method=self.consume("ID").v
                return MethodCallNode(obj,method,[],token_start.line)
            return self.parse_method_call()
        return self.consume()

    def _parse_call_arguments(self):
        """Parse ``( ... )`` → positional args, optional ``name <- expr`` named args, and whether ``(`` was present."""
        args = []
        named = {}
        if self.tokens[self.pos].t != "LPAREN":
            return args, named, False
        self.consume("LPAREN")
        if self.tokens[self.pos].t == "RPAREN":
            self.consume("RPAREN")
            return args, named, True
        while True:
            if self.tokens[self.pos].t == "ID" and self.peek(1).t == "LEFTARROW":
                nk = self.consume("ID").v
                self.consume("LEFTARROW")
                named[nk] = self.parse_expression()
            else:
                args.append(self.parse_expression())
            if self.tokens[self.pos].t == "COMMA":
                self.consume("COMMA")
                continue
            if self.tokens[self.pos].t == "RPAREN":
                self.consume("RPAREN")
                break
            raise Exception(
                f"[Line {self.tokens[self.pos].line}] Expected ',' or ')' in argument list"
            )
        return args, named, True

    def _parse_function_params(self):
        """Parse ``functionDefine`` / ``methodDefine`` ``(params)``, including ``default.NAME.setVar(expr)``."""
        args = []
        if self.tokens[self.pos].t != "LPAREN":
            return args, {}, False
        self.consume("LPAREN")
        if self.tokens[self.pos].t == "RPAREN":
            self.consume("RPAREN")
            return args, {}, True
        seen_default = False
        names = set()
        while True:
            p = self._parse_function_param()
            if p.v in names:
                raise Exception(
                    f"[Line {p.line}] duplicate parameter name {p.v!r}"
                )
            names.add(p.v)
            has_default = getattr(p, "default", None) is not None
            if has_default:
                seen_default = True
            elif seen_default:
                raise Exception(
                    f"[Line {p.line}] non-default parameter {p.v!r} cannot follow a default parameter"
                )
            args.append(p)
            if self.tokens[self.pos].t == "COMMA":
                self.consume("COMMA")
                continue
            if self.tokens[self.pos].t == "RPAREN":
                self.consume("RPAREN")
                break
            raise Exception(
                f"[Line {self.tokens[self.pos].line}] Expected ',' or ')' in parameter list"
            )
        return args, {}, True

    def _parse_function_param(self):
        tok = self.tokens[self.pos]
        if tok.t != "ID":
            raise Exception(
                f"[Line {tok.line}] function parameter must be a name or default.NAME.setVar(value), found {_spl_format_token(tok)}"
            )
        if tok.v == "default" and self.peek(1).t == "DOT":
            if not (
                self.peek(2).t == "ID"
                and self.peek(3).t == "DOT"
                and self.peek(4).t == "ID"
                and self.peek(4).v == "setVar"
                and self.peek(5).t == "LPAREN"
            ):
                raise Exception(
                    f"[Line {tok.line}] default parameter must be written default.NAME.setVar(value)"
                )
            line = self.consume("ID").line
            self.consume("DOT")
            name_tok = self.consume("ID")
            self.consume("DOT")
            self.consume("ID")
            self.consume("LPAREN")
            expr = self.parse_expression()
            self.consume("RPAREN")
            return FuncParam(name_tok.v, expr, name_tok.line or line)
        return self.consume("ID")

    def parse_method_call(self):
        token_start=self.tokens[self.pos]
        obj=self.consume("ID").v
        self.consume("DOT")
        method=self.consume("ID").v
        if obj in ("functionDefine", "methodDefine"):
            args, named, had_paren = self._parse_function_params()
        else:
            args, named, had_paren = self._parse_call_arguments()
        if not had_paren and not args and not named:
            if self.tokens[self.pos].t not in ("COLON", "SEMICOLON"):
                raise Exception(
                    f"[Line {self.tokens[self.pos].line}] Expected '(' or ':' or ';' after {obj}.{method}"
                )

        if self.tokens[self.pos].t=="COLON":
            colon_tok = self.consume("COLON")
            colon_line = colon_tok.line
            # Keep call arguments for blocks that need them (conditions, params, random.run probability).
            param_tokens=(
                args
                if obj
                in (
                    "functionDefine",
                    "test",
                    "random",
                    "methodDefine",
                    "classDefine",
                    "errorDefine",
                )
                or (obj == "error" and method == "except")
                else []
            )
            body = self._parse_block_body_after_colon(token_start.line, colon_line)
            return BlockNode(obj, method, param_tokens, body, token_start.line)

        return MethodCallNode(obj, method, args, token_start.line, named if named else None)

    def _parse_block_body_after_colon(self, start_line: int, colon_line: int) -> list:
        """
        After ``obj.method(...):`` or ``name ... <- code:``.

        If the next statement starts on the **same line** as the colon, the body is a
        **single** statement and no trailing ``end`` is required.

        If the next token is on a **later line**, use classic ``... end`` block parsing.
        """
        if self.tokens[self.pos].t == "EOF":
            raise Exception(
                f"[Line {colon_line}] parse: expected a statement or 'end' after ':' (block is empty)"
            )
        if self.tokens[self.pos].line > colon_line:
            body = self._parse_block_body(start_line)
            self.consume("END")
            return body
        stmt = self.parse_statement()
        if stmt is None:
            raise Exception(
                f"[Line {colon_line}] parse: expected a statement on this line after ':'"
            )
        return [stmt]

    def _parse_block_body(self, start_line):
        """Statements until matching end; does not consume the closing END."""
        body = []
        depth = 1
        while depth > 0:
            if self.tokens[self.pos].t == "EOF":
                raise Exception(
                    f"[Line {start_line}] parse: unclosed block (add a matching 'end;' before end of file)"
                )
            if (
                self.tokens[self.pos].t == "ID"
                and self.peek(1).t == "DOT"
                and self.peek(4).t == "COLON"
            ):
                depth += 1
            if self.tokens[self.pos].t == "END":
                depth -= 1
                if depth == 0:
                    break
            stmt = self.parse_statement()
            if stmt:
                body.append(stmt)
        return body

    def _starts_function_alias(self) -> bool:
        """True for ``fname arg1 ... <- code:`` (not ``x <- expr`` assignment)."""
        p = self.pos
        if p >= len(self.tokens) or self.tokens[p].t != "ID":
            return False
        p += 1
        while p < len(self.tokens) and self.tokens[p].t == "ID":
            p += 1
        if p >= len(self.tokens) or self.tokens[p].t != "LEFTARROW":
            return False
        p += 1
        if p >= len(self.tokens) or self.tokens[p].t != "CODEKW":
            return False
        p += 1
        return p < len(self.tokens) and self.tokens[p].t == "COLON"

    def parse_use_module_path(self):
        parts=[self.consume("ID").v]
        while self.tokens[self.pos].t=="DOT":
            self.consume("DOT")
            if self.tokens[self.pos].t != "ID":
                raise Exception(
                    f"[Line {self.tokens[self.pos].line}] parse: expected an identifier after '.' in use/inherit path"
                )
            parts.append(self.consume("ID").v)
        return ".".join(parts)

    def parse_statement(self):
        if self.tokens[self.pos].t=="EOF": return None
        if self.tokens[self.pos].t=="SEMICOLON":
            self.consume("SEMICOLON"); return None
        if self.tokens[self.pos].t=="USE":
            token_start=self.consume("USE")
            module=self.parse_use_module_path()
            self.consume("SEMICOLON")
            return ImportNode(module,token_start.line)
        if self.tokens[self.pos].t == "ID" and self.tokens[self.pos].v == "inherit":
            line = self.consume("ID").line
            module = self.parse_use_module_path()
            self.consume("SEMICOLON")
            return InheritNode(module, line)
        if self.tokens[self.pos].t == "QMARK" and self.peek(1).t == "LPAREN":
            line = self.consume("QMARK").line
            self.consume("LPAREN")
            cond = self.parse_expression()
            self.consume("RPAREN")
            self.consume("LEFTARROW")
            run_tok = self.consume("ID")
            if run_tok.v != "run":
                raise Exception(
                    f"[Line {run_tok.line}] ?(cond) <- run: expects keyword 'run' after '<-', got {run_tok.v!r}"
                )
            colon_tok = self.consume("COLON")
            body = self._parse_block_body_after_colon(line, colon_tok.line)
            return BlockNode("test", "ifTrue", [cond], body, line)
        if (
            self.tokens[self.pos].t == "ID"
            and self.tokens[self.pos].v == "constructorDefine"
            and self.peek(1).t == "LPAREN"
        ):
            line = self.consume("ID").line
            self.consume("LPAREN")
            self.consume("RPAREN")
            colon_tok = self.consume("COLON")
            body = self._parse_block_body_after_colon(line, colon_tok.line)
            return BlockNode("constructorDefine", "run", [], body, line)
        if (
            self.tokens[self.pos].t == "ID"
            and self.tokens[self.pos].v == "this"
            and self.peek(1).t == "DOT"
            and self.peek(2).t == "ID"
            and self.peek(3).t == "ASSIGN"
        ):
            line = self.consume("ID").line
            self.consume("DOT")
            field = self.consume("ID").v
            self.consume("ASSIGN")
            expr = self.parse_expression()
            self.consume("SEMICOLON")
            return ThisAssignNode(field, expr, line)
        if (
            self.tokens[self.pos].t == "LBRACKET"
            and self.peek(1).t == "ID"
            and self.peek(2).t == "RBRACKET"
            and self.peek(3).t == "LEFTARROW"
            and self.peek(4).t == "ID"
            and self.peek(4).v == "sl"
            and self.peek(5).t == "LPAREN"
        ):
            line_sl = self.tokens[self.pos].line
            self.consume("LBRACKET")
            vn = self.consume("ID").v
            self.consume("RBRACKET")
            self.consume("LEFTARROW")
            slkw = self.consume("ID")
            if slkw.v != "sl":
                raise Exception(
                    f"[Line {slkw.line}] Expected sl after '[' {vn} ] <- ..., got {slkw.v!r}"
                )
            self.consume("LPAREN")
            lo_ast = self.parse_expression()
            self.consume("COMMA")
            hi_ast = self.parse_expression()
            self.consume("RPAREN")
            if self.tokens[self.pos].t == "SEMICOLON":
                self.consume("SEMICOLON")
            return SliceAssignNode(vn, lo_ast, hi_ast, line_sl)
        if self.tokens[self.pos].t == "LBRACE":
            line = self.tokens[self.pos].line
            expr = self.parse_expression()
            if self.tokens[self.pos].t == "SEMICOLON":
                self.consume("SEMICOLON")
            return ExprStmtNode(expr, line)
        if self._starts_function_alias():
            token_start = self.tokens[self.pos]
            fname = self.consume("ID").v
            arg_tokens = []
            while self.tokens[self.pos].t == "ID":
                arg_tokens.append(self.consume("ID"))
            self.consume("LEFTARROW")
            self.consume("CODEKW")
            colon_tok = self.consume("COLON")
            body = self._parse_block_body_after_colon(token_start.line, colon_tok.line)
            return BlockNode("functionDefine", fname, arg_tokens, body, token_start.line)
        if self.tokens[self.pos].t == "ID" and self.peek(1).t == "LEFTARROW":
            token_start = self.tokens[self.pos]
            name = self.consume("ID").v
            self.consume("LEFTARROW")
            expr = self.parse_expression()
            if self.tokens[self.pos].t == "SEMICOLON":
                self.consume("SEMICOLON")
            return MethodCallNode(name, "setVar", [expr], token_start.line)
        node=self.parse_method_call()
        if self.tokens[self.pos].t=="SEMICOLON": self.consume("SEMICOLON")
        return node

    def parse(self):
        nodes=[]
        while self.tokens[self.pos].t!="EOF":
            stmt=self.parse_statement()
            if stmt: nodes.append(stmt)
        return self._merge_try_except(nodes)

    def _merge_try_except(self, stmts):
        out = []
        i = 0
        n = len(stmts)
        while i < n:
            s = stmts[i]
            if isinstance(s, BlockNode) and s.obj == "error" and s.method == "try":
                handlers = []
                j = i + 1
                while j < n:
                    nxt = stmts[j]
                    if (
                        isinstance(nxt, BlockNode)
                        and nxt.obj == "error"
                        and nxt.method == "except"
                    ):
                        handlers.append((nxt.args, nxt.body))
                        j += 1
                    else:
                        break
                out.append(TryExceptNode(s.body, handlers, s.line))
                i = j
            else:
                out.append(s)
                i += 1
        return out
