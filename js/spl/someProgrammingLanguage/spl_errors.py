"""SPL execution signals and typed runtime errors."""


class ReturnSignal(Exception):
    def __init__(self,value): self.value=value

class BreakSignal(Exception):
    pass

class ContinueSignal(Exception):
    pass


class SPLException(Exception):
    """Typed error visible to SPL error.except handlers (match on .kind)."""

    __slots__ = ("kind", "spl_line", "spl_trace", "spl_message")

    def __init__(self, kind, message="", spl_line=0, spl_trace=None):
        self.kind = kind
        self.spl_line = spl_line
        self.spl_message = message or ""
        # Snapshot of interpreter call frames at raise time (list of dicts).
        self.spl_trace = list(spl_trace) if spl_trace else []
        msg = f"{kind}"
        if message:
            msg = f"{kind}: {message}"
        if spl_line:
            msg = f"[Line {spl_line}] {msg}"
        super().__init__(msg)

    def format_with_trace(self) -> str:
        """Human-readable error plus optional SPL stack frames (newest call last)."""
        lines = [f"Error: {self}"]
        if not self.spl_trace:
            return lines[0]
        lines.append("SPL stack (most recent call last):")
        for frame in self.spl_trace:
            kind = frame.get("kind", "?")
            line = frame.get("line") or 0
            loc = f"line {line}" if line else "line ?"
            if kind == "function":
                name = frame.get("name", "?")
                file = frame.get("file")
                where = f" in {file}" if file else ""
                lines.append(f"  {loc}{where}: function {name}")
            elif kind == "method":
                cls = frame.get("class", "?")
                meth = frame.get("name", "?")
                file = frame.get("file")
                where = f" in {file}" if file else ""
                lines.append(f"  {loc}{where}: method {cls}.{meth}")
            elif kind == "module":
                path = frame.get("path") or frame.get("file") or "?"
                lines.append(f"  {loc}: module {path}")
            else:
                detail = frame.get("name") or frame.get("path") or ""
                lines.append(f"  {loc}: {kind} {detail}".rstrip())
        return "\n".join(lines)


class SPLErrorType:
    """First-class SPL error kind for error.except(error.SomeError) (not a string)."""

    __slots__ = ("name",)

    def __init__(self, name: str):
        self.name = name

    def __str__(self):
        return self.name

    __repr__ = __str__


def _spl_except_kind_matches(want, spl_kind: str) -> bool:
    if isinstance(want, SPLErrorType):
        return want.name == spl_kind
    return str(want) == spl_kind
