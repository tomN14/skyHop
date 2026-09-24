"""
SPL JIT — numeric loop compiler (beyond MVP).

Enable: SPL_JIT=1 run-spl script.spl
Trace:  SPL_JIT=trace run-spl script.spl   (logs compile / fallback reasons)

See JIT_ROADMAP.md for backlog.
"""

from __future__ import annotations

import os
import sys

from .spl_ast import BlockNode, LogicNode, MethodCallNode
from .spl_lexer import Token

# ---------------------------------------------------------------------------
# Bytecode VM (numeric expressions + comparisons)
# ---------------------------------------------------------------------------

_OP_CONST = 1
_OP_LOAD = 2
_OP_ADD = 3
_OP_SUB = 4
_OP_MUL = 5
_OP_DIV = 6
_OP_MOD = 7
_OP_NEG = 8
_OP_FLOOR = 9
_OP_CEIL = 10
_OP_ROUND = 11
_OP_SQRT = 12
_OP_EQ = 13
_OP_NE = 14
_OP_LT = 15
_OP_LE = 16
_OP_GT = 17
_OP_GE = 18

_MATH_EMIT = {
    ("math", "add"): _OP_ADD,
    ("math", "subtract"): _OP_SUB,
    ("math", "multiply"): _OP_MUL,
    ("math", "div"): _OP_DIV,
    ("math", "mod"): _OP_MOD,
}

_MATH_UNARY = {
    ("math", "floor"): _OP_FLOOR,
    ("math", "ceil"): _OP_CEIL,
    ("math", "round"): _OP_ROUND,
    ("math", "sqrtR"): _OP_SQRT,
}

_TEST_CMP = {
    ("test", "isEqualNumber"): _OP_EQ,
    ("test", "isGreater"): _OP_GT,
    ("test", "isLess"): _OP_LT,
}

_jit_stats = {
    "forloop_compiled": 0,
    "forloop_fallback": 0,
    "while_compiled": 0,
    "while_fallback": 0,
    "last_fallback_reason": "",
}


def _trace(msg: str) -> None:
    if jit_trace_enabled():
        sys.stderr.write(f"[SPL_JIT] {msg}\n")


def _fallback(kind: str, reason: str) -> bool:
    _jit_stats[f"{kind}_fallback"] = _jit_stats.get(f"{kind}_fallback", 0) + 1
    _jit_stats["last_fallback_reason"] = reason
    _trace(f"{kind} fallback: {reason}")
    return False


def _norm_bin(result: float, a, b):
    """Match Interpreter._normalize_numeric_result for two inputs."""
    if isinstance(a, float) or isinstance(b, float):
        return float(result)
    if isinstance(result, float) and result.is_integer():
        return int(result)
    return result


def _norm_unary(result: float, a):
    if isinstance(a, float):
        return float(result)
    if isinstance(result, float) and result.is_integer():
        return int(result)
    return result


class _NumericVM:
    """Stack machine for compiled numeric / comparison expressions."""

    __slots__ = ("code",)

    def __init__(self, code: list):
        self.code = code

    def run(self, env: dict):
        import math as _math

        stack: list = []
        for op, arg in self.code:
            if op == _OP_CONST:
                # NUMBER tokens may be int or float in the AST value.
                stack.append(arg if isinstance(arg, (int, float)) else float(arg))
            elif op == _OP_LOAD:
                v = env.get(arg)
                if v is None:
                    raise ValueError(f"jit: undefined {arg!r}")
                stack.append(v)
            elif op == _OP_NEG:
                a = stack.pop()
                stack.append(_norm_unary(-float(a), a))
            elif op == _OP_FLOOR:
                # Interpreter: math.floor → int (Python 3).
                stack.append(int(_math.floor(float(stack.pop()))))
            elif op == _OP_CEIL:
                stack.append(int(_math.ceil(float(stack.pop()))))
            elif op == _OP_ROUND:
                stack.append(int(round(float(stack.pop()))))
            elif op == _OP_SQRT:
                a = stack.pop()
                x = float(a)
                if x < 0:
                    raise ValueError("jit: sqrt of negative")
                stack.append(float(_math.sqrt(x)))
            elif op == _OP_ADD:
                b, a = stack.pop(), stack.pop()
                stack.append(_norm_bin(float(a) + float(b), a, b))
            elif op == _OP_SUB:
                b, a = stack.pop(), stack.pop()
                stack.append(_norm_bin(float(a) - float(b), a, b))
            elif op == _OP_MUL:
                b, a = stack.pop(), stack.pop()
                stack.append(_norm_bin(float(a) * float(b), a, b))
            elif op == _OP_DIV:
                b, a = stack.pop(), stack.pop()
                if float(b) == 0:
                    raise ZeroDivisionError("division by zero")
                stack.append(_norm_bin(float(a) / float(b), a, b))
            elif op == _OP_MOD:
                b, a = stack.pop(), stack.pop()
                if float(b) == 0:
                    raise ZeroDivisionError("modulo by zero")
                stack.append(_norm_bin(float(a) % float(b), a, b))
            elif op == _OP_EQ:
                b, a = stack.pop(), stack.pop()
                stack.append(1 if float(a) == float(b) else 0)
            elif op == _OP_NE:
                b, a = stack.pop(), stack.pop()
                stack.append(1 if float(a) != float(b) else 0)
            elif op == _OP_LT:
                b, a = stack.pop(), stack.pop()
                stack.append(1 if float(a) < float(b) else 0)
            elif op == _OP_LE:
                b, a = stack.pop(), stack.pop()
                stack.append(1 if float(a) <= float(b) else 0)
            elif op == _OP_GT:
                b, a = stack.pop(), stack.pop()
                stack.append(1 if float(a) > float(b) else 0)
            elif op == _OP_GE:
                b, a = stack.pop(), stack.pop()
                stack.append(1 if float(a) >= float(b) else 0)
            else:
                raise RuntimeError(f"jit: bad opcode {op}")
        if len(stack) != 1:
            raise RuntimeError("jit: stack imbalanced")
        return stack[0]


def _compile_numeric_expr(node, *, allow_compare: bool = False) -> _NumericVM | None:
    """Compile SPL AST to numeric bytecode, or None if not eligible."""

    def emit(node) -> list | None:
        if isinstance(node, Token):
            if node.t in ("NUMBER", "BOOLEAN"):
                # Keep ints as ints so coercion matches the interpreter.
                return [(_OP_CONST, node.v)]
            if node.t == "ID":
                return [(_OP_LOAD, node.v)]
            return None
        if isinstance(node, list) and len(node) == 1:
            return emit(node[0])
        if isinstance(node, MethodCallNode):
            key = (node.obj, node.method)
            unary = _MATH_UNARY.get(key)
            if unary is not None and node.arg and len(node.arg) == 1:
                inner = emit(node.arg[0])
                if inner is None:
                    return None
                return inner + [(unary, None)]
            op = _MATH_EMIT.get(key)
            if op is not None and node.arg and len(node.arg) == 2:
                left = emit(node.arg[0])
                right = emit(node.arg[1])
                if left is None or right is None:
                    return None
                return left + right + [(op, None)]
            if allow_compare:
                cmp = _TEST_CMP.get(key)
                if cmp is not None and node.arg and len(node.arg) == 2:
                    left = emit(node.arg[0])
                    right = emit(node.arg[1])
                    if left is None or right is None:
                        return None
                    return left + right + [(cmp, None)]
            return None
        if isinstance(node, LogicNode):
            return None
        return None

    code = emit(node)
    if code is None:
        return None
    return _NumericVM(code)


# ---------------------------------------------------------------------------
# Multi-statement setVar bodies
# ---------------------------------------------------------------------------

def _is_setvar(stmt) -> MethodCallNode | None:
    if isinstance(stmt, MethodCallNode) and stmt.method == "setVar" and stmt.arg:
        return stmt
    return None


def _try_compile_setvar_stmts(body) -> list[tuple[str, _NumericVM]] | None:
    """Compile a sequence of name.setVar(numericExpr) statements."""
    if not body:
        return None
    compiled: list[tuple[str, _NumericVM]] = []
    for stmt in body:
        sv = _is_setvar(stmt)
        if sv is None:
            return None
        vm = _compile_numeric_expr(sv.arg[0])
        if vm is None:
            return None
        compiled.append((sv.obj, vm))
    return compiled


def _env_from_scopes(scopes: list) -> dict:
    """Flatten scope chain (outer → inner) into one env dict for the VM."""
    env: dict = {}
    for frame in scopes:
        env.update(frame)
    return env


def _write_back_assigns(interpreter, env: dict, names: set[str]) -> None:
    for name in names:
        if name in env:
            interpreter._scope_assign(name, env[name])


def _run_jit_forloop(
    interpreter,
    *,
    start: float,
    end: float,
    loop_name: str,
    stmts: list[tuple[str, _NumericVM]],
    line: int,
) -> bool:
    from .spl_errors import SPLException
    from .spl_interpreter import _MAX_LOOP_ITERATIONS

    env = _env_from_scopes(interpreter._scopes)
    assign_names = {name for name, _ in stmts}
    cur = float(start)
    endv = float(end)
    n = 0
    while cur <= endv + 1e-12:
        if n >= _MAX_LOOP_ITERATIONS:
            raise Exception(
                f"[Line {line}] test.forLoop exceeded maximum iterations ({_MAX_LOOP_ITERATIONS})"
            )
        n += 1
        env[loop_name] = cur
        try:
            for name, vm in stmts:
                env[name] = vm.run(env)
        except ZeroDivisionError as e:
            raise SPLException("DivisionByZeroError", str(e), line) from e
        except ValueError as e:
            raise Exception(f"[Line {line}] jit: {e}") from e
        cur += 1.0
    assign_names.add(loop_name)
    _write_back_assigns(interpreter, env, assign_names)
    return True


def _run_jit_while(
    interpreter,
    *,
    cond_vm: _NumericVM,
    stmts: list[tuple[str, _NumericVM]],
    line: int,
) -> bool:
    from .spl_errors import SPLException
    from .spl_interpreter import _MAX_LOOP_ITERATIONS

    env = _env_from_scopes(interpreter._scopes)
    assign_names = {name for name, _ in stmts}
    n = 0
    while True:
        try:
            if cond_vm.run(env) != 1:
                break
        except ZeroDivisionError as e:
            raise SPLException("DivisionByZeroError", str(e), line) from e
        if n >= _MAX_LOOP_ITERATIONS:
            raise Exception(
                f"[Line {line}] test.while exceeded maximum iterations ({_MAX_LOOP_ITERATIONS})"
            )
        n += 1
        try:
            for name, vm in stmts:
                env[name] = vm.run(env)
        except ZeroDivisionError as e:
            raise SPLException("DivisionByZeroError", str(e), line) from e
        except ValueError as e:
            raise Exception(f"[Line {line}] jit: {e}") from e
    _write_back_assigns(interpreter, env, assign_names)
    return True


def try_run_forloop_jit(interpreter, node: BlockNode) -> bool:
    """
    Compile test.forLoop when every body statement is name.setVar(numericExpr).
    Returns True when handled (caller should skip interpreted loop).
    """
    if not jit_enabled():
        return False
    if node.obj != "test" or node.method not in ("forLoop", "forloop"):
        return False
    if len(node.args) < 3:
        return _fallback("forloop", "missing args")
    vt = node.args[2]
    if not isinstance(vt, Token) or vt.t != "ID":
        return _fallback("forloop", "loop var not identifier")
    loop_name = vt.v

    stmts = _try_compile_setvar_stmts(node.body)
    if stmts is None:
        return _fallback("forloop", "body not all numeric setVar")

    start = interpreter.evaluate(node.args[0])
    end = interpreter.evaluate(node.args[1])
    interpreter._scope_push_empty()
    try:
        _trace(f"forLoop compiled ({len(stmts)} stmt(s), var={loop_name})")
        _jit_stats["forloop_compiled"] += 1
        return _run_jit_forloop(
            interpreter,
            start=float(start),
            end=float(end),
            loop_name=loop_name,
            stmts=stmts,
            line=node.line,
        )
    finally:
        interpreter._scope_pop()


def try_run_while_jit(interpreter, node: BlockNode) -> bool:
    """
    Compile test.while when condition is a numeric comparison
    (test.isEqualNumber / isLess / isGreater) and body is numeric setVars.
    """
    if not jit_enabled():
        return False
    if node.obj != "test" or node.method != "while":
        return False
    if not node.args:
        return _fallback("while", "missing condition")

    cond_vm = _compile_numeric_expr(node.args[0], allow_compare=True)
    if cond_vm is None:
        return _fallback("while", "condition not numeric compare")

    stmts = _try_compile_setvar_stmts(node.body)
    if stmts is None:
        return _fallback("while", "body not all numeric setVar")

    interpreter._scope_push_empty()
    try:
        _trace(f"while compiled ({len(stmts)} stmt(s))")
        _jit_stats["while_compiled"] += 1
        return _run_jit_while(
            interpreter,
            cond_vm=cond_vm,
            stmts=stmts,
            line=node.line,
        )
    finally:
        interpreter._scope_pop()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def jit_enabled() -> bool:
    v = os.environ.get("SPL_JIT", "0").strip().lower()
    return v in ("1", "true", "yes", "on", "trace")


def jit_trace_enabled() -> bool:
    return os.environ.get("SPL_JIT", "0").strip().lower() == "trace"


def jit_stats() -> dict:
    return {
        "enabled": jit_enabled(),
        "trace": jit_trace_enabled(),
        **_jit_stats,
    }
