"""Sandboxed SPL host for a SkyHop level script.

SPL itself runs the program. This file only blocks host access and exposes
skyhop.get / skyhop.tag / skyhop.rotate. test.while pauses after one iteration
so the game can update skyhop.get on the next frame. Every other SPL feature,
including test.forLoop, runs through the real interpreter.
"""

from __future__ import annotations

import json
import math
import os
import random
import re
import sys
import time

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
_counters = {}
_overrides = {}
_COUNTER_DOT = re.compile(r"skyhop\s*\.\s*counter\s*\.\s*(update|read)\s*\(")


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


class _WaitSignal(Exception):
    def __init__(self, seconds):
        self.seconds = float(seconds)


def _math_floor(a):
    return int(math.floor(float(a)))


def _math_ceil(a):
    return int(math.ceil(float(a)))


class _AttrRef:
    """Handle from skyhop.get("is_affect_by_toggle") or default_toggle_state.

    Assigning a number to the variable that holds this writes that attribute.
    """

    def __init__(self, name):
        self.name = name


class _NumAttr(_AttrRef):
    """Numeric skyhop.get handle. Comparisons see the number. A later assignment writes it."""

    def __init__(self, name, value):
        super().__init__(name)
        self.value = value

    def __float__(self):
        return float(self.value)

    def __int__(self):
        return int(self.value)


def _rewrite_counter_calls(code):
    """skyhop.counter.update(...) is not a chain the SPL parser accepts."""

    def repl(match):
        which = match.group(1)
        return "skyhop.counter" + which[:1].upper() + which[1:] + "("

    return _COUNTER_DOT.sub(repl, str(code))


def _bare_name(node):
    if getattr(node, "t", None) == "ID" and isinstance(getattr(node, "v", None), str):
        return node.v
    raise Exception("counter name must be a variable name, not a value")


def _as_number(value, what):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise Exception(what + " must be a number")
    if number != number or number in (float("inf"), float("-inf")):
        raise Exception(what + " must be a number")
    return number


def _counter_box(name):
    box = _counters.get(name)
    if not box:
        raise Exception("No counter named " + str(name))
    return box


def _counter_index(box, name, index):
    if index is None:
        idx = 0
    else:
        idx = int(_as_number(index, "counter index"))
    if idx < 0 or idx >= len(box["values"]):
        raise Exception("counter " + name + " has no value at index " + str(idx))
    return idx


def _sync_counter(name):
    box = _counters[name]
    _commands.append(["counter", name, box["x"], box["y"], list(box["values"])])


def _counter_call(interp, node):
    method = node.method
    args = node.arg or []
    if method == "counter":
        if len(args) < 3:
            raise Exception("skyhop.counter(name, x, y, values...)")
        name = _bare_name(args[0])
        x = _as_number(interp.evaluate(args[1]), "counter x")
        y = _as_number(interp.evaluate(args[2]), "counter y")
        values = [_as_number(interp.evaluate(arg), "counter value") for arg in args[3:]] or [0.0]
        _counters[name] = {"x": x, "y": y, "values": values}
        _sync_counter(name)
        return 0
    if method == "counterRead":
        if not args:
            raise Exception("skyhop.counter.read(name, index)")
        name = _bare_name(args[0])
        box = _counter_box(name)
        index = interp.evaluate(args[1]) if len(args) > 1 else None
        return box["values"][_counter_index(box, name, index)]
    if method == "counterUpdate":
        if (
            len(args) == 1
            and getattr(args[0], "obj", None) == "math"
            and getattr(args[0], "method", None) == "add"
        ):
            add_args = args[0].arg or []
            if len(add_args) < 2:
                raise Exception("skyhop.counter.update(math.add(name, increment, indexes...))")
            name = _bare_name(add_args[0])
            inc = _as_number(interp.evaluate(add_args[1]), "counter increment")
            raw_indexes = [interp.evaluate(arg) for arg in add_args[2:]] or [None]
            box = _counter_box(name)
            for raw in raw_indexes:
                slot = _counter_index(box, name, raw)
                box["values"][slot] = box["values"][slot] + inc
            _sync_counter(name)
            return 0
        if len(args) < 2:
            raise Exception("skyhop.counter.update(name, value) or skyhop.counter.update(math.add(name, increment, indexes...))")
        name = _bare_name(args[0])
        value = _as_number(interp.evaluate(args[1]), "counter value")
        index = interp.evaluate(args[2]) if len(args) > 2 else None
        box = _counter_box(name)
        box["values"][_counter_index(box, name, index)] = value
        _sync_counter(name)
        return 0
    raise Exception("Unknown skyhop." + str(method))


def _get(key):
    key = str(key)
    if key in ("is_affect_by_toggle", "default_toggle_state"):
        return _AttrRef(key)
    if key == "jump_limit":
        if key in _overrides:
            return _NumAttr(key, _overrides[key])
        return _NumAttr(key, _state.get(key, -1))
    value = _state.get(key, 0)
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def _tag(x, y, sid):
    _commands.append(["tag", x, y, sid])
    return 0


def _rotate(sid, deg):
    _commands.append(["rotate", sid, deg])
    return 0


def _move(dx, dy, sid):
    _commands.append(["move", dx, dy, sid])
    return 0


def _color(hex_color, sid):
    _commands.append(["color", hex_color, sid])
    return 0


def _toggle(sid):
    _commands.append(["toggle", sid])
    return 0


def _hazard(sid):
    _commands.append(["hazard", sid])
    return 0


def _safe(sid):
    _commands.append(["safe", sid])
    return 0


def _disable_wall_jump(sid):
    _commands.append(["noWallJump", sid])
    return 0


def _wait(seconds):
    try:
        n = float(seconds)
    except (TypeError, ValueError):
        raise Exception("skyhop.wait expects a number of seconds")
    if n != n or n < 0:
        raise Exception("skyhop.wait expects a number of seconds")
    raise _WaitSignal(n)


def _kill(*args):
    if not args:
        _commands.append(["kill", "self"])
        return 0
    mode = str(args[0])
    if mode == "closest" or mode == "farthest":
        if len(args) < 3:
            raise Exception('skyhop.kill("closest", x, y) or skyhop.kill("farthest", x, y)')
        _commands.append(["kill", mode, float(args[1]), float(args[2])])
        return 0
    _commands.append(["kill", mode])
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
        math_lib = interp.library.get("math")
        if isinstance(math_lib, dict):
            math_lib["floor"] = _math_floor
            math_lib["ceil"] = _math_ceil
        self.interp = interp
        self._install_import_gate()
        self.nodes = spl["Parser"](spl["tokenize"](_rewrite_counter_calls(code))).parse()
        self.ip = 0
        self.body_ip = 0
        self.wait_until = 0
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
                    "move": _move,
                    "change_color": _color,
                    "toggle": _toggle,
                    "hazard": _hazard,
                    "safe": _safe,
                    "disable_wall_jump": _disable_wall_jump,
                    "wait": _wait,
                    "kill": _kill,
                    "random": _skyhop_random,
                }
                return None
            if isinstance(node, spl["MethodCallNode"]) and node.method == "setVar":
                name = node.obj
                new_val = interp.evaluate(node.arg[0]) if node.arg else None
                old = None
                try:
                    old = interp._scope_get(name, getattr(node, "line", 0))
                except Exception:
                    old = None
                if isinstance(old, _AttrRef):
                    written = new_val.value if isinstance(new_val, _NumAttr) else new_val
                    if old.name == "jump_limit":
                        _overrides["jump_limit"] = written
                    _commands.append(["attr", old.name, written])
                interp._scope_assign(name, new_val)
                return None
            if (
                isinstance(node, spl["MethodCallNode"])
                and node.obj == "skyhop"
                and node.method in ("counter", "counterUpdate", "counterRead")
            ):
                return _counter_call(interp, node)
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
        if self.wait_until and time.time() < self.wait_until:
            return
        self.wait_until = 0
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
            try:
                self.interp.run(node)
            except _WaitSignal as wait:
                self.ip += 1
                self.wait_until = time.time() + wait.seconds
                return
            self.ip += 1
        self.done = True

    def _step_while(self, node):
        spl = self._spl
        if not node.args:
            raise Exception("test.while requires a condition")
        body = node.body or []
        if self.body_ip <= 0:
            cond = self.interp.evaluate(node.args[0])
            if cond != 1:
                self.body_ip = 0
                self.ip += 1
                self._tick()
                return
        i = self.body_ip if self.body_ip > 0 else 0
        while i < len(body):
            try:
                self.interp.run(body[i])
            except _WaitSignal as wait:
                self.body_ip = i + 1
                self.wait_until = time.time() + wait.seconds
                return
            except spl["BreakSignal"]:
                self.body_ip = 0
                self.ip += 1
                self._tick()
                return
            except spl["ContinueSignal"]:
                self.body_ip = 0
                return
            i += 1
        self.body_ip = 0


def skyhop_open(code):
    global _session, _commands, _counters, _overrides
    _commands = []
    _counters = {}
    _overrides = {}
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
