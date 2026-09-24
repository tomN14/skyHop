"""Run a level script on the real SPL interpreter, one while-iteration per tick.

SkyHop does not implement a second language. This host loads SPL, rejects every
import except ``use skyhop``, and removes filesystem, network, SQL, package,
and system libraries. ``test.while`` yields after each iteration so the game
can sample player state on later frames.

The browser cannot run CPython, so play uses js/skyhop-spl.js with the same
rules. This module is the check that those rules match SPL itself.
"""

from __future__ import annotations

import os
import sys

_DEFAULT_ROOT = os.path.join(os.path.expanduser("~"), "Desktop", "SomeProjectFolder")
BLOCKED = ("file", "network", "sql", "user", "cli", "json", "pkg")


def _import_spl():
    root = os.environ.get("SKYHOP_SPL_ROOT", _DEFAULT_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
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


class SkyHopApi:
    """Game-side values the script can read and the objects it can retag."""

    def __init__(self, get_fn, tag_fn, rotate_fn):
        self.get_fn = get_fn
        self.tag_fn = tag_fn
        self.rotate_fn = rotate_fn

    def get(self, key):
        value = self.get_fn(str(key))
        if isinstance(value, bool):
            return 1 if value else 0
        return value

    def tag(self, x, y, sid):
        self.tag_fn(x, y, sid)
        return 0

    def rotate(self, sid, deg):
        self.rotate_fn(sid, deg)
        return 0

    def random(self, *args):
        import random

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
    def __init__(self, code, api: SkyHopApi):
        spl = _import_spl()
        self._spl = spl
        interp = spl["Interpreter"]()
        for name in BLOCKED:
            interp.library.pop(name, None)
        self.interp = interp
        self.api = api
        self._install_import_gate()
        self.nodes = spl["Parser"](spl["tokenize"](code)).parse()
        self.ip = 0
        self.while_node = None
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
        api = self.api
        original = interp.run

        def run(node, as_statement=None):
            if isinstance(node, spl["ImportNode"]):
                if node.module != "skyhop":
                    raise Exception(f"SkyHop sandbox blocks use {node.module}")
                interp.library["skyhop"] = {
                    "get": api.get,
                    "tag": api.tag,
                    "rotate": api.rotate,
                    "random": api.random,
                }
                return None
            if isinstance(node, (spl["MethodCallNode"], spl["BlockNode"])) and node.obj in BLOCKED:
                raise Exception(f"{node.obj}.{node.method} is blocked in the SkyHop sandbox")
            return original(node, as_statement)

        interp.run = run

    def tick(self):
        if self.done:
            return self
        try:
            self._tick()
        except Exception as exc:
            self.error = str(exc)
            self.done = True
        return self

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
                return
            except spl["ContinueSignal"]:
                return


def _demo():
    jumps = {"frame": 0, "flags": [0, 0, 1, 1]}
    tagged = []
    rotated = []

    def get_fn(key):
        if key == "is_player_jumping":
            i = min(jumps["frame"], len(jumps["flags"]) - 1)
            jumps["frame"] += 1
            return jumps["flags"][i]
        if key == "stage_time_limit":
            return -1
        if key == "jump_limit":
            return -1
        return 0

    code = """
use skyhop;
skyhop.tag(420, 315, 1);
test.while(1):
    test.ifTrue(skyhop.get("is_player_jumping")):
        skyhop.rotate(1, 90);
        test.break;
    end;
end;
"""
    session = SandboxSession(
        code,
        SkyHopApi(get_fn, lambda x, y, sid: tagged.append((x, y, sid)), lambda sid, deg: rotated.append((sid, deg))),
    )
    for _ in range(8):
        session.tick()
        if session.done:
            break
    if session.error:
        raise SystemExit("script error: " + session.error)
    if tagged != [(420, 315, 1)]:
        raise SystemExit("tag mismatch " + repr(tagged))
    if rotated != [(1, 90)]:
        raise SystemExit("rotate mismatch " + repr(rotated))
    if not session.done:
        raise SystemExit("script should finish after the first jump")

    blocked = SandboxSession(
        "use skyhop;\nuse file;\n",
        SkyHopApi(get_fn, lambda *a: None, lambda *a: None),
    )
    for _ in range(4):
        blocked.tick()
        if blocked.done:
            break
    if not blocked.error or "blocks use file" not in blocked.error:
        raise SystemExit("use file should be blocked, got " + repr(blocked.error))

    sneaky = SandboxSession(
        'use skyhop;\nfile.read("x");\n',
        SkyHopApi(get_fn, lambda *a: None, lambda *a: None),
    )
    for _ in range(4):
        sneaky.tick()
        if sneaky.done:
            break
    if not sneaky.error or "blocked" not in sneaky.error:
        raise SystemExit("file.read should be blocked, got " + repr(sneaky.error))
    print("ok")


if __name__ == "__main__":
    _demo()
