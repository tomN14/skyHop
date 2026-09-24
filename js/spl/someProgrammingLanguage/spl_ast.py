"""SPL abstract syntax tree (parse tree) node types."""


class ASTNode:
    """Base class for all SPL AST nodes."""

    __slots__ = ()


class FuncParam(ASTNode):
    """functionDefine / methodDefine parameter with an optional default expression."""

    __slots__ = ("v", "t", "default", "line")

    def __init__(self, name, default, line):
        self.v = name
        self.t = "ID"
        self.default = default
        self.line = line


class MethodCallNode(ASTNode):
    __slots__ = ("obj", "method", "arg", "line", "named")

    def __init__(self, obj, method, arg, line, named=None):
        self.obj, self.method, self.arg, self.line = obj, method, arg, line
        self.named = named  # optional dict: arg name -> expression AST (e.g. key <- expr)


class ImportNode(ASTNode):
    __slots__ = ("module", "line")

    def __init__(self, module, line):
        self.module, self.line = module, line


class BlockNode(ASTNode):
    __slots__ = ("obj", "method", "args", "body", "line")

    def __init__(self, obj, method, args, body, line):
        self.obj, self.method, self.args, self.body, self.line = obj, method, args, body, line


class LogicNode(ASTNode):
    __slots__ = ("left", "operator", "right", "line")

    def __init__(self, left, operator, right, line):
        self.left, self.operator, self.right, self.line = left, operator, right, line


class HashLiteralNode(ASTNode):
    __slots__ = ("pairs", "line")

    def __init__(self, pairs, line):
        self.pairs, self.line = pairs, line


class TupleLiteralNode(ASTNode):
    __slots__ = ("elements", "line")

    def __init__(self, elements, line):
        self.elements, self.line = elements, line


class SetLiteralNode(ASTNode):
    __slots__ = ("elements", "line")

    def __init__(self, elements, line):
        self.elements, self.line = elements, line


class TryExceptNode(ASTNode):
    """Merged from error.try(): ... end; plus following error.except(...): ... end; blocks."""

    __slots__ = ("try_body", "handlers", "line")

    def __init__(self, try_body, handlers, line):
        self.try_body, self.handlers, self.line = try_body, handlers, line


class InheritNode(ASTNode):
    __slots__ = ("module", "line")

    def __init__(self, module, line):
        self.module, self.line = module, line


class ThisAssignNode(ASTNode):
    """Constructor assignment: this.fieldName = expr;"""

    __slots__ = ("field", "expr", "line")

    def __init__(self, field, expr, line):
        self.field, self.expr, self.line = field, expr, line


class ExprStmtNode(ASTNode):
    """Expression used as a statement (e.g. ``{ ... };`` hash literal in ``keymapDefine``)."""

    __slots__ = ("expr", "line")

    def __init__(self, expr, line):
        self.expr, self.line = expr, line


class SliceAssignNode(ASTNode):
    """String slice-assign sugar: ``[name] <- sl(lo, hi);`` → slice ``name`` in place."""

    __slots__ = ("name", "lo", "hi", "line")

    def __init__(self, name: str, lo, hi, line):
        self.name, self.lo, self.hi, self.line = name, lo, hi, line


class AwaitNode(ASTNode):
    """``await expr`` inside ``async.do():`` ... ``end;``."""

    __slots__ = ("expr", "line")

    def __init__(self, expr, line):
        self.expr, self.line = expr, line
