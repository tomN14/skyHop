"""Sandboxed SPL host for a SkyHop level script.

SPL itself runs the program. This file only blocks host access and exposes
skyhop.get / skyhop.tag / skyhop.rotate. test.while pauses after one iteration
so the game can update skyhop.get on the next frame. Every other SPL feature,
including test.forLoop, runs through the real interpreter.
"""

from __future__ import annotations

import json
import os
import random
import sys

try:
    _HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    _HERE = "/skyhop"
if not os.path.isdir(os.path.join(_HERE, "someProgrammingLanguage")):
    _HERE = "/skyhop"
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

BLOCKED = ("file", "network", "sql", "user", "cli", "json", "pkg")

_session = None
_state = {}
_commands = []


def _stub_module(name):
    """Pyodide's browser build omits some stdlib modules the interpreter imports."""
    import types

    try:
        __import__(name)
    except ImportError:
        sys.modules[name] = types.ModuleType(name)


def _import_spl():
    import types

    # The game runtime (Pyodide 0.27) has no ssl or sqlite3. The interpreter
    # imports both while loading. Network and SQL stay blocked, so a name-only
    # stub is enough to let scripts start.
    _stub_module("ssl")
    try:
        import sqlite3  # noqa: F401
    except ImportError:
        stub = types.ModuleType("sqlite3")

        class _Conn:
            pass

        stub.Connection = _Conn
        sys.modules["sqlite3"] = stub
    from someProgrammingLanguage.spl_ast import BlockNode, ImportNode, MethodCallNode
    from someProgrammingLanguage.spl_errors import BreakSignal, ContinueSignal
    from someProgrammingLanguage.spl_interpreter import Interpreter
    from someProgrammingLanguage.spl_lexer import tokenize
    from someProgrammingLanguage.spl_parser import Parser

    return {
        "BlockNode": BlockNode,
        "ImportNode": ImportNode,
        "MethodCallNode": MethodCallNode,
        "BreakSignal": BreakSignal,
        "ContinueSignal": ContinueSignal,
        "Interpreter": Interpreter,
        "tokenize": tokenize,
        "Parser": Parser,
    }


def _get(key):
    value = _state.get(str(key), 0)
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def _tag(x, y, sid):
    _commands.append(["tag", x, y, sid])
    return 0


def _rotate(sid, deg):
    _commands.append(["rotate", sid, deg])
    return 0


def _skyhop_random(*args):
    if len(args) >= 2:
        lo, hi = int(args[0]), int(args[1])
        if lo > hi:
            raise Exception("skyhop.random: lower must be <= upper")
        return random.randint(lo, hi)
    n = int(args[0]) if args else 0
    if n <= 0:
        raise Exception("skyhop.random expects a positive upper bound")
    return random.randint(0, n - 1)


class SandboxSession:
    def __init__(self, code):
        spl = _import_spl()
        self._spl = spl
        interp = spl["Interpreter"]()
        for name in BLOCKED:
            interp.library.pop(name, None)
        self.interp = interp
        self._install_import_gate()
        self.nodes = spl["Parser"](spl["tokenize"](code)).parse()
        self.ip = 0
        self.done = False
        self.error = None
        if (
            not self.nodes
            or not isinstance(self.nodes[0], spl["ImportNode"])
            or self.nodes[0].module != "skyhop"
        ):
            self.error = "Script must start with use skyhop;"
            self.done = True

    def _install_import_gate(self):
        spl = self._spl
        interp = self.interp
        original = interp.run

        def run(node, as_statement=None):
            if isinstance(node, spl["ImportNode"]):
                if node.module != "skyhop":
                    raise Exception("SkyHop sandbox blocks use " + str(node.module))
                interp.library["skyhop"] = {
                    "get": _get,
                    "tag": _tag,
                    "rotate": _rotate,
                    "random": _skyhop_random,
                }
                return None
            if isinstance(node, (spl["MethodCallNode"], spl["BlockNode"])) and node.obj in BLOCKED:
                raise Exception(node.obj + "." + node.method + " is blocked in the SkyHop sandbox")
            return original(node, as_statement)

        interp.run = run

    def tick(self):
        if self.done:
            return
        try:
            self._tick()
        except Exception as exc:
            self.error = str(exc)
            self.done = True

    def _tick(self):
        spl = self._spl
        while self.ip < len(self.nodes):
            node = self.nodes[self.ip]
            if (
                isinstance(node, spl["BlockNode"])
                and node.obj == "test"
                and node.method == "while"
            ):
                self._step_while(node)
                return
            self.interp.run(node)
            self.ip += 1
        self.done = True

    def _step_while(self, node):
        spl = self._spl
        if not node.args:
            raise Exception("test.while requires a condition")
        cond = self.interp.evaluate(node.args[0])
        if cond != 1:
            self.ip += 1
            self._tick()
            return
        for sub in node.body:
            try:
                self.interp.run(sub)
            except spl["BreakSignal"]:
                self.ip += 1
                self._tick()
                return
            except spl["ContinueSignal"]:
                return


def skyhop_open(code):
    global _session, _commands
    _commands = []
    try:
        _session = SandboxSession(str(code))
    except Exception as exc:
        _session = None
        return json.dumps({"ok": False, "error": str(exc)})
    if _session.error:
        return json.dumps({"ok": False, "error": _session.error})
    return json.dumps({"ok": True})


def skyhop_tick(state_json):
    global _state, _commands
    _commands = []
    if _session is None:
        return json.dumps({"done": True, "error": "No script is open", "commands": []})
    try:
        _state = json.loads(state_json) if state_json else {}
    except Exception:
        _state = {}
    if not isinstance(_state, dict):
        _state = {}
    _session.tick()
    return json.dumps(
        {
            "done": bool(_session.done),
            "error": _session.error,
            "commands": _commands,
        }
    )
