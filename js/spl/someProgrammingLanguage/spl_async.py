"""Cooperative async.do / await (MVP via asyncio)."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from .spl_ast import AwaitNode, MethodCallNode
from .spl_errors import SPLException

_EXECUTOR = ThreadPoolExecutor(max_workers=8)


async def _await_interpreter_expr(interpreter, expr):
    if isinstance(expr, AwaitNode):
        expr = expr.expr
    if isinstance(expr, MethodCallNode):
        obj, method = expr.obj, expr.method
        if obj == "network" and method in ("get", "post", "put", "delete", "request"):
            arg_vals = [interpreter.evaluate(a) for a in (expr.arg or [])]
            loop = asyncio.get_running_loop()
            fn = getattr(interpreter, f"_network_{method}", None)
            if fn is None and method == "request":
                fn = interpreter._network_request
            if fn is None:
                raise Exception(f"await: network.{method} is not async-capable")
            return await loop.run_in_executor(_EXECUTOR, lambda: fn(*arg_vals))
        if obj == "sql" and method == "query":
            arg_vals = [interpreter.evaluate(a) for a in (expr.arg or [])]
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(
                _EXECUTOR, lambda: interpreter._sql_query(*arg_vals)
            )
    raise Exception(
        f"await: unsupported expression (MVP: network.get/post/put/delete/request, sql.query)"
    )


async def _run_async_body(interpreter, body):
    for stmt in body:
        if isinstance(stmt, MethodCallNode) and stmt.method == "setVar":
            if not stmt.arg:
                continue
            val = await _await_interpreter_expr(interpreter, stmt.arg[0])
            interpreter._scope_assign(stmt.obj, val)
        elif isinstance(stmt, AwaitNode):
            await _await_interpreter_expr(interpreter, stmt)
        else:
            interpreter.run(stmt, as_statement=True)


def run_async_do_block(interpreter, body, line: int):
    interpreter._async_depth += 1
    try:
        asyncio.run(_run_async_body(interpreter, body))
    except SPLException:
        raise
    except Exception as e:
        raise Exception(f"[Line {line}] async.do: {e}") from e
    finally:
        interpreter._async_depth -= 1
