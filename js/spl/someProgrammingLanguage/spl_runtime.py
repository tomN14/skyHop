"""SPL runtime value types and library loading (use/import, native, Java)."""
import base64
import ctypes
import hashlib
import importlib.util
import os
import re
import secrets
import shutil
import struct
import subprocess
import sys
import heapq
from collections import deque

from .spl_errors import SPLException

_spl_dir = os.path.dirname(os.path.abspath(__file__))
if _spl_dir not in sys.path:
    sys.path.insert(0, _spl_dir)

try:
    from spl_game_ttt import tic_best_move, tic_fastest_win_move, tic_lose_move
except ImportError:
    from someProgrammingLanguage.spl_game_ttt import (
        tic_best_move,
        tic_fastest_win_move,
        tic_lose_move,
    )

# stops runaway while/forLoop; high enough for real use, low enough to fail fast.
_MAX_LOOP_ITERATIONS = 100_000

# Sentinel: _dispatch_instance_member did not handle the MethodCallNode.
_DISPATCH_SKIP = object()


try:
    from spl_game_ttt import tic_best_move, tic_fastest_win_move, tic_lose_move
except ImportError:
    from someProgrammingLanguage.spl_game_ttt import (
        tic_best_move,
        tic_fastest_win_move,
        tic_lose_move,
    )


def _spl_string_convert_int(s):
    if not isinstance(s, str):
        return None
    t = s.strip()
    if not t:
        return None
    try:
        return int(t)
    except ValueError:
        return None


def _spl_replace_last(string, old, new):
    """Replace the rightmost occurrence of ``old`` in ``string``."""
    if not isinstance(string, str) or not isinstance(old, str) or not isinstance(new, str):
        return None
    if not old:
        return string
    idx = string.rfind(old)
    if idx < 0:
        return string
    return string[:idx] + new + string[idx + len(old) :]


def _spl_replace_all_ignore_case(string, old, new):
    if not isinstance(string, str) or not isinstance(old, str) or not isinstance(new, str):
        return None
    if not old:
        return string
    return re.sub(re.escape(old), lambda _m: new, string, flags=re.IGNORECASE)


def _spl_replace_first_ignore_case(string, old, new):
    if not isinstance(string, str) or not isinstance(old, str) or not isinstance(new, str):
        return None
    if not old:
        return string
    return re.sub(re.escape(old), lambda _m: new, string, count=1, flags=re.IGNORECASE)


def _spl_replace_last_ignore_case(string, old, new):
    if not isinstance(string, str) or not isinstance(old, str) or not isinstance(new, str):
        return None
    if not old:
        return string
    matches = list(re.finditer(re.escape(old), string, flags=re.IGNORECASE))
    if not matches:
        return string
    m = matches[-1]
    return string[: m.start()] + new + string[m.end() :]


# Sentinels for string.slice: "from start" / "to end" bounds (returned by string.sliceMin / string.sliceMax).
SPL_SLICE_BOUND_MIN = object()
SPL_SLICE_BOUND_MAX = object()


def _spl_string_slice(lo, hi, text, line):
    """
    SPL string slice (not Python's [lo:hi]).

    - string.slice(lo, string.sliceMax(), s): from 0-based index lo through end of string.
    - string.slice(string.sliceMin(), hi, s): from start through 0-based inclusive index hi.
    - string.slice(string.sliceMin(), string.sliceMax(), s): full copy of s.
    - string.slice(lo, hi, s) with two numbers: lo is 1-based start position (first char = 1),
      hi is 0-based inclusive end index; substring is s[(lo-1) : (hi+1)].

    Returns a new string or None if text is not a str.
    """
    if text is None:
        return None
    if not isinstance(text, str):
        return None
    s = text
    n = len(s)

    def as_int(x, which):
        try:
            return int(float(x))
        except (TypeError, ValueError):
            raise Exception(
                f"[Line {line}] string.slice: {which} must be a number or slice bound"
            ) from None

    lo_is_min = lo is SPL_SLICE_BOUND_MIN
    hi_is_max = hi is SPL_SLICE_BOUND_MAX

    if lo_is_min and hi_is_max:
        return s
    if lo_is_min:
        hi0 = as_int(hi, "hi")
        if hi0 < 0 or hi0 >= n:
            raise Exception(
                f"[Line {line}] string.slice: hi {hi0} out of range for length {n}"
            )
        return s[: hi0 + 1]
    if hi_is_max:
        lo0 = as_int(lo, "lo")
        if lo0 < 0 or lo0 > n:
            raise Exception(
                f"[Line {line}] string.slice: lo {lo0} out of range for length {n}"
            )
        return s[lo0:]
    lo1 = as_int(lo, "lo")
    hi0 = as_int(hi, "hi")
    if lo1 < 1 or lo1 > n:
        raise Exception(
            f"[Line {line}] string.slice: lo (1-based start) {lo1} out of range 1..{n}"
        )
    if hi0 < 0 or hi0 >= n:
        raise Exception(
            f"[Line {line}] string.slice: hi (0-based inclusive end) {hi0} out of range 0..{n - 1}"
        )
    if hi0 < lo1 - 1:
        raise Exception(
            f"[Line {line}] string.slice: inconsistent range (1-based lo={lo1}, "
            f"0-based inclusive hi={hi0})"
        )
    a = lo1 - 1
    b = hi0 + 1
    return s[a:b]


# Post-quantum crypto (optional): pip install cryptography liboqs-python
# Or: pip install "someProgrammingLanguage[pqc]"
_PQC_MAGIC = b"SPLPQE1"
_PQC_VERSION = 1
_PQC_KDF_PREFIX = b"spl-encrypt:pqc:aes256gcm:v1"


def _pqc_require_oqs():
    try:
        import oqs
    except ImportError as e:
        raise Exception(
            "encrypt.pqc*: optional module 'oqs' (liboqs-python) is not installed. "
            "Try: pip install 'someProgrammingLanguage[pqc]' "
            "or: pip install cryptography liboqs-python"
        ) from e
    return oqs


def _pqc_require_crypto_aes():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
        from cryptography.hazmat.primitives import hashes
    except ImportError as e:
        raise Exception(
            "encrypt.pqcSeal/pqcOpen require 'cryptography' (AES-GCM + HKDF). "
            "Try: pip install 'someProgrammingLanguage[pqc]' "
            "or: pip install cryptography liboqs-python"
        ) from e
    return AESGCM, HKDF, hashes


def _pqc_derive_aes_key(shared_secret: bytes, kem_algorithm: str) -> bytes:
    _, HKDF, hashes = _pqc_require_crypto_aes()
    info = _PQC_KDF_PREFIX + b"|" + kem_algorithm.encode("utf-8")
    hkdf = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=info
    )
    return hkdf.derive(shared_secret)


def _pqc_gcm_aad(kem_alg: str, kem_ct: bytes) -> bytes:
    return kem_alg.encode("utf-8") + b"|" + kem_ct


def _pqc_pack_seal(alg: str, kem_ct: bytes, nonce: bytes, body_ct: bytes) -> str:
    alg_b = alg.encode("utf-8")
    if len(alg_b) > 65535:
        raise Exception("encrypt.pqcSeal: algorithm name too long")
    if len(nonce) != 12:
        raise Exception("encrypt.pqcSeal: internal nonce length error")
    header = struct.pack("!7sBH", _PQC_MAGIC, _PQC_VERSION, len(alg_b)) + alg_b
    mid = struct.pack("!I", len(kem_ct)) + kem_ct + nonce
    tail = struct.pack("!I", len(body_ct)) + body_ct
    return base64.b64encode(header + mid + tail).decode("ascii")


def _pqc_unpack_seal(token: str) -> dict:
    try:
        raw = base64.b64decode(str(token).strip(), validate=True)
    except Exception as e:
        raise Exception(f"encrypt.pqcOpen: bundle is not valid base64 ({e})") from e
    base = 7 + 1 + 2
    if len(raw) < base:
        raise Exception("encrypt.pqcOpen: bundle truncated (header)")
    magic, ver, alen = struct.unpack("!7sBH", raw[:base])
    if magic != _PQC_MAGIC:
        raise Exception("encrypt.pqcOpen: not an SPL PQ seal bundle")
    if ver != _PQC_VERSION:
        raise Exception("encrypt.pqcOpen: unsupported bundle version")
    pos = base
    if pos + alen > len(raw):
        raise Exception("encrypt.pqcOpen: bundle truncated (algorithm name)")
    alg_b = raw[pos : pos + alen]
    pos += alen
    if pos + 4 > len(raw):
        raise Exception("encrypt.pqcOpen: bundle truncated (KEM length)")
    (klen,) = struct.unpack("!I", raw[pos : pos + 4])
    pos += 4
    if pos + klen > len(raw):
        raise Exception("encrypt.pqcOpen: bundle truncated (KEM ciphertext)")
    kem_ct = raw[pos : pos + klen]
    pos += klen
    if pos + 12 > len(raw):
        raise Exception("encrypt.pqcOpen: bundle truncated (nonce)")
    nonce = raw[pos : pos + 12]
    pos += 12
    if pos + 4 > len(raw):
        raise Exception("encrypt.pqcOpen: bundle truncated (payload length)")
    (plen,) = struct.unpack("!I", raw[pos : pos + 4])
    pos += 4
    if pos + plen != len(raw):
        raise Exception("encrypt.pqcOpen: malformed payload segment length")
    body_ct = raw[pos : pos + plen]
    try:
        alg = alg_b.decode("utf-8")
    except UnicodeDecodeError as e:
        raise Exception("encrypt.pqcOpen: bad algorithm encoding") from e
    return {"alg": alg, "kem_ct": kem_ct, "nonce": nonce, "body_ct": body_ct}


# =============================================================================
# RUNTIME TYPES & LIBRARY LOADERS — values, OOP, use/import, native/Java glue
# =============================================================================

class SPLSet:
    """Ordered unique collection; str() / print uses {a,b,c} style."""

    __slots__ = ("_items",)

    def __init__(self, iterable=()):
        self._items = []
        it = iterable._items if isinstance(iterable, SPLSet) else iterable
        for x in it:
            if x not in self._items:
                self._items.append(x)

    def append(self, item):
        if item not in self._items:
            self._items.append(item)
        return self

    def remove_value(self, item):
        if item in self._items:
            self._items.remove(item)
        return self

    def remove_index(self, idx):
        i = int(idx)
        if i < 0 or i >= len(self._items):
            raise SPLException("IndexOutOfRangeError", f"set index {i} for length {len(self._items)}")
        del self._items[i]
        return self

    def __repr__(self):
        return str(self)

    def __str__(self):
        inner = ",".join(str(x) for x in self._items)
        return "{" + inner + "}"


class SPLFunctionRef:
    """First-class reference to a user-defined function by name (resolved at call time)."""

    __slots__ = ("name",)

    def __init__(self, name: str):
        self.name = name

    def __repr__(self):
        return f"SPLFunctionRef({self.name!r})"


class SPLCalcFuncSpec:
    """Unevaluated ``function.name(...)`` passed into calculus.* for symbolic use."""

    __slots__ = ("name", "arg_exprs")

    def __init__(self, name, arg_exprs=None):
        self.name = name
        self.arg_exprs = list(arg_exprs or [])

    def __repr__(self):
        return f"SPLCalcFuncSpec({self.name!r})"


class SPLClass:
    """User-defined class: methods, field defaults/visibility, optional parent, optional constructor body."""

    __slots__ = ("name", "parent", "methods", "field_defaults", "field_visibility", "constructor_body", "keymap_entries")

    def __init__(self, name: str):
        self.name = name
        self.parent = None
        self.methods = {}
        self.field_defaults = {}
        self.field_visibility = {}
        self.constructor_body = None
        self.keymap_entries = None  # list of (single-char str, value_expr_ast) from keymapDefine.keymap

    def merge_parent(self, parent: "SPLClass"):
        self.parent = parent
        for mn, mb in parent.methods.items():
            if mn not in self.methods:
                self.methods[mn] = mb
        for fn, fv in parent.field_defaults.items():
            if fn not in self.field_defaults:
                self.field_defaults[fn] = fv
                self.field_visibility.setdefault(fn, parent.field_visibility.get(fn, "private"))
        if parent.keymap_entries is not None and self.keymap_entries is None:
            self.keymap_entries = copy.deepcopy(parent.keymap_entries)

    def method_lookup(self, name: str):
        if name in self.methods:
            return self.methods[name]
        if self.parent:
            return self.parent.method_lookup(name)
        return None


class SPLInstance:
    __slots__ = ("cls", "fields")

    def __init__(self, cls: SPLClass):
        self.cls = cls
        self.fields = {}


class SPLKeyMap:
    """Runtime handle for a class keymap; ``curr`` is the hash built during key evaluation / string.sorted."""

    __slots__ = ("spl_class", "curr")

    def __init__(self, spl_class: SPLClass):
        self.spl_class = spl_class
        self.curr = {}


class SPLStack:
    """LIFO stack; values pushed/popped at the top (end of internal list)."""

    __slots__ = ("_items",)

    def __init__(self):
        self._items = []

    def __repr__(self):
        return f"<stack {self._items!r}>"


class SPLQueue:
    """FIFO queue (deque)."""

    __slots__ = ("_dq",)

    def __init__(self):
        self._dq = deque()

    def __repr__(self):
        return f"<queue {list(self._dq)!r}>"


class SPLDeque:
    """Double-ended queue (same backing as queue; deque.* API)."""

    __slots__ = ("_dq",)

    def __init__(self):
        self._dq = deque()

    def __repr__(self):
        return f"<deque {list(self._dq)!r}>"


class SPLPriorityQueue:
    """Min-priority queue: lower priority number pops first; ties FIFO."""

    __slots__ = ("_data", "_counter")

    def __init__(self):
        self._data = []
        self._counter = 0

    def __repr__(self):
        return f"<priorityQueue {self._data!r}>"


class SPLListNode:
    __slots__ = ("value", "prev", "next")

    def __init__(self, value):
        self.value = value
        self.prev = None
        self.next = None


class SPLLinkedList:
    """Doubly linked list; optional circular link via linkedList.makeCircular."""

    __slots__ = ("head", "tail", "_circular", "_size")

    def __init__(self):
        self.head = None
        self.tail = None
        self._circular = False
        self._size = 0

    def __repr__(self):
        return f"<linkedList size={self._size} circular={self._circular}>"


class SPLHeap:
    """Binary heap: min-heap (heapq) or max-heap (negated numeric keys)."""

    __slots__ = ("_min", "_data")

    def __init__(self, min_heap: bool = True):
        self._min = min_heap
        self._data = []

    def __repr__(self):
        return f"<heap {'min' if self._min else 'max'} {self._data!r}>"


class SPLTreeNode:
    __slots__ = ("value", "left", "right")

    def __init__(self, value):
        self.value = value
        self.left = None
        self.right = None

    def __repr__(self):
        return f"<treeNode {self.value!r}>"


class SPLBinaryTree:
    __slots__ = ("root",)

    def __init__(self):
        self.root = None

    def __repr__(self):
        return f"<tree root={self.root!r}>"


class SPLArtist:
    """Turtle graphics handle (``use graphics;`` → ``graphics.icon`` → ``artist.forward(10);``)."""

    __slots__ = ("_turtle", "_screen")

    _ALIASES = {
        "fd": "forward",
        "bk": "backward",
        "rt": "right",
        "lt": "left",
        "pu": "penup",
        "pd": "pendown",
        "up": "penup",
        "down": "pendown",
        "seth": "setheading",
        "ht": "hideturtle",
        "st": "showturtle",
        "home": "home",
    }

    def __init__(self):
        try:
            import turtle
        except ImportError as e:
            raise Exception(
                "graphics: Python turtle module unavailable (install tkinter for your Python)"
            ) from e
        try:
            self._turtle = turtle.Turtle()
            self._screen = self._turtle.getscreen()
            self._screen.title("SPL Graphics")
        except Exception as e:
            raise Exception(f"graphics: could not open turtle display ({e})") from e

    def __repr__(self):
        return "<artist>"

    @staticmethod
    def _coerce_arg(v):
        if v is None:
            return None
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v
        if isinstance(v, (int, float)):
            return v
        if isinstance(v, list):
            return [SPLArtist._coerce_arg(x) for x in v]
        if isinstance(v, tuple):
            return tuple(SPLArtist._coerce_arg(x) for x in v)
        return v

    def call_method(self, name: str, arg_vals, line: int):
        meth = self._ALIASES.get(name, name)
        if meth == "done":
            import turtle

            turtle.done()
            return None
        if meth == "title":
            if len(arg_vals) != 1:
                raise Exception(f"[Line {line}] artist.title expects (text)")
            self._screen.title(str(arg_vals[0]))
            return None
        if meth == "bgcolor":
            if len(arg_vals) != 1:
                raise Exception(f"[Line {line}] artist.bgcolor expects (color)")
            self._screen.bgcolor(self._coerce_arg(arg_vals[0]))
            return None
        if meth == "screensize":
            if len(arg_vals) not in (2, 3):
                raise Exception(f"[Line {line}] artist.screensize expects (width, height) or (width, height, bg)")
            args = [self._coerce_arg(a) for a in arg_vals]
            self._screen.screensize(*args)
            return None

        t = self._turtle
        fn = getattr(t, meth, None)
        if fn is None or not callable(fn):
            raise Exception(f"[Line {line}] artist: unknown method {name!r}")
        args = [self._coerce_arg(a) for a in arg_vals]
        try:
            result = fn(*args)
        except TypeError as e:
            raise Exception(
                f"[Line {line}] artist.{name} argument mismatch ({len(args)} given): {e}"
            ) from e
        except Exception as e:
            raise Exception(f"[Line {line}] artist.{name}: {e}") from e
        if result is None:
            return None
        if isinstance(result, tuple):
            return list(result)
        return result


def _resolve_library_path(relative_name, line):
    """relative_name is the path after lib/ (may include dots, e.g. new_math.spl)."""
    if not relative_name or relative_name.strip() != relative_name:
        raise Exception(f"[Line {line}] Invalid library path")
    if ".." in relative_name or relative_name.startswith(("/", "\\")):
        raise Exception(f"[Line {line}] Invalid library path (no .. or absolute paths)")
    lib_root = os.path.realpath(os.path.join(_spl_dir, "lib"))
    lib_path = os.path.realpath(os.path.join(lib_root, relative_name))
    if lib_path != lib_root and not lib_path.startswith(lib_root + os.sep):
        raise Exception(f"[Line {line}] Library path escapes lib directory")
    return lib_path


# Libraries may opt in to extensionless `use name` by declaring at the top of the file:
#   SPL: reqFileExtension.setVar(false);
#   Python: reqFileExtension = False
#   C: #include <stdbool.h> and bool reqFileExtension = false;
#   C++: bool reqFileExtension = false;
#   Java: boolean reqFileExtension = false;
_REQ_SPL_EXT_RE = re.compile(
    r"reqFileExtension\s*\.\s*setVar\s*\(\s*(false|true)\s*\)",
    re.IGNORECASE,
)
_REQ_PY_EXT_RE = re.compile(
    r"^\s*reqFileExtension\s*=\s*(False|True)\b",
    re.MULTILINE,
)
_REQ_C_CXX_BOOL_EXT_RE = re.compile(
    r"(?:^|\n)\s*(?:static\s+)?bool\s+reqFileExtension\s*=\s*(false|true)\s*;",
    re.MULTILINE,
)
_REQ_JAVA_BOOL_EXT_RE = re.compile(
    r"\bboolean\s+reqFileExtension\s*=\s*(false|true)\s*;",
    re.MULTILINE,
)


def _spl_allows_extensionless_import(lib_path):
    try:
        with open(lib_path, encoding="utf-8") as f:
            head = f.read(16000)
    except OSError:
        return False
    m = _REQ_SPL_EXT_RE.search(head)
    if not m:
        return False
    return m.group(1).lower() == "false"


def _py_allows_extensionless_import(lib_path):
    try:
        with open(lib_path, encoding="utf-8") as f:
            head = f.read(16000)
    except OSError:
        return False
    m = _REQ_PY_EXT_RE.search(head)
    if not m:
        return False
    return m.group(1) == "False"


def _c_cpp_allows_extensionless_import(lib_path):
    try:
        with open(lib_path, encoding="utf-8") as f:
            head = f.read(16000)
    except OSError:
        return False
    m = _REQ_C_CXX_BOOL_EXT_RE.search(head)
    if not m:
        return False
    return m.group(1).lower() == "false"


def _java_allows_extensionless_import(lib_path):
    try:
        with open(lib_path, encoding="utf-8") as f:
            head = f.read(16000)
    except OSError:
        return False
    m = _REQ_JAVA_BOOL_EXT_RE.search(head)
    if not m:
        return False
    return m.group(1).lower() == "false"


_LIBRARY_PACKAGE_EXT = ".pkg"
_LIBRARY_FILE_EXTS = {".spl", ".py", ".c", ".cpp", ".cc", ".cxx", ".java"}


def _extensionless_allowers():
    return (
        (".spl", _spl_allows_extensionless_import),
        (".py", _py_allows_extensionless_import),
        (".c", _c_cpp_allows_extensionless_import),
        (".cpp", _c_cpp_allows_extensionless_import),
        (".cc", _c_cpp_allows_extensionless_import),
        (".cxx", _c_cpp_allows_extensionless_import),
        (".java", _java_allows_extensionless_import),
    )


def _resolve_dotted_nested_lib(module_name, line):
    """Resolve ``use encrypt.py`` (literal file) or ``use music.audio`` (lib/music/audio.py)."""
    if ".." in module_name.split("."):
        raise Exception(f"[Line {line}] Invalid library path (no ..)")
    literal = _resolve_library_path(module_name, line)
    ext = os.path.splitext(module_name)[1].lower()
    if os.path.isfile(literal):
        if ext in _LIBRARY_FILE_EXTS:
            return literal, ext
        raise Exception(
            f"[Line {line}] Cannot open library {module_name!r}: unknown extension {ext or '(none)'}"
        )
    rel = module_name.replace(".", "/")
    pkg = _resolve_library_path(rel, line)
    if os.path.isdir(pkg) and _iter_library_package_files(pkg):
        return pkg, _LIBRARY_PACKAGE_EXT
    found = []
    for file_ext, allow_fn in _extensionless_allowers():
        path = _resolve_library_path(rel + file_ext, line)
        if os.path.isfile(path) and allow_fn(path):
            found.append((path, file_ext))
    if len(found) == 1:
        return found[0]
    if len(found) > 1:
        kinds = ", ".join(module_name + e for _, e in found)
        raise Exception(
            f"[Line {line}] Ambiguous use {module_name!r}: multiple nested libraries ({kinds})"
        )
    raise Exception(
        f"[Line {line}] Cannot open library: {literal} "
        f"(also tried lib/{rel}.py / .spl as a nested module)"
    )


def _iter_library_package_files(dir_path):
    """Return sorted (path, ext) for loadable library files directly in a package folder."""
    entries = []
    try:
        names = os.listdir(dir_path)
    except OSError:
        return entries
    for name in sorted(names):
        if name.startswith(".") or name == "__pycache__":
            continue
        full = os.path.join(dir_path, name)
        if not os.path.isfile(full):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext in _LIBRARY_FILE_EXTS:
            entries.append((full, ext))
    return entries


def _resolve_library_import_lib(module_name, line):
    """Resolve under someProgrammingLanguage/lib/ only. Returns (real_path, ext_lower)."""
    if not module_name or module_name.strip() != module_name:
        raise Exception(f"[Line {line}] Invalid library path")
    if "." in module_name:
        return _resolve_dotted_nested_lib(module_name, line)
    pkg_path = _resolve_library_path(module_name, line)
    pkg_candidate = None
    if os.path.isdir(pkg_path) and _iter_library_package_files(pkg_path):
        pkg_candidate = (pkg_path, _LIBRARY_PACKAGE_EXT)
    extensionless_checks = [
        (".spl", module_name + ".spl", _spl_allows_extensionless_import),
        (".py", module_name + ".py", _py_allows_extensionless_import),
        (".c", module_name + ".c", _c_cpp_allows_extensionless_import),
        (".cpp", module_name + ".cpp", _c_cpp_allows_extensionless_import),
        (".cc", module_name + ".cc", _c_cpp_allows_extensionless_import),
        (".cxx", module_name + ".cxx", _c_cpp_allows_extensionless_import),
        (".java", module_name + ".java", _java_allows_extensionless_import),
    ]
    candidates = []
    for ext, rel, allow_fn in extensionless_checks:
        path = _resolve_library_path(rel, line)
        if os.path.isfile(path) and allow_fn(path):
            candidates.append((ext, path))
    if pkg_candidate is not None and candidates:
        kinds = ", ".join(
            [f"{module_name}/"] + [f"{module_name}{e}" for e, _ in candidates]
        )
        raise Exception(
            f"[Line {line}] Ambiguous use {module_name!r}: both a library folder and extensionless file(s) exist ({kinds}); "
            f"use an explicit file extension or rename one of them"
        )
    if pkg_candidate is not None:
        return pkg_candidate
    if len(candidates) > 1:
        kinds = ", ".join(f"{module_name}{e}" for e, _ in candidates)
        raise Exception(
            f"[Line {line}] Ambiguous use {module_name!r}: multiple libraries opt in to extensionless import ({kinds}); "
            f"use an explicit file extension in the use statement"
        )
    if len(candidates) == 1:
        ext, path = candidates[0]
        return path, ext
    raise Exception(
        f"[Line {line}] Cannot resolve use {module_name!r}: include the file extension (e.g. {module_name}.spl), "
        f"use a library folder lib/{module_name}/, "
        f"or add an opt-in (SPL: reqFileExtension.setVar(false); Python: reqFileExtension = False; "
        f"C/C++: bool reqFileExtension = false; Java: boolean reqFileExtension = false;)"
    )


_NATIVE_SOURCE_EXTS = {".c", ".cpp", ".cc", ".cxx"}
_NATIVE_JAVA_EXT = ".java"


def _native_build_root():
    """User cache for compiled .so / Java classes — keeps site-packages clean after pip install."""
    if sys.platform == "win32":
        preferred = os.path.join(
            os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
            "someProgrammingLanguage",
            "native_build",
        )
    else:
        xdg = os.environ.get("XDG_CACHE_HOME")
        if xdg:
            preferred = os.path.join(xdg, "someProgrammingLanguage", "native_build")
        else:
            preferred = os.path.join(
                os.path.expanduser("~"), ".cache", "someProgrammingLanguage", "native_build"
            )
    fallback = os.path.join(_spl_dir, "lib", ".spl_native_build")
    for path in (preferred, fallback):
        try:
            os.makedirs(path, exist_ok=True)
            return path
        except OSError:
            continue
    raise OSError("Could not create native build cache directory")


def _compile_native_shared(lib_path, ext, line):
    """Compile lib_path to a cached .so (Linux/macOS) shared object; returns path to .so."""
    with open(lib_path, "rb") as f:
        digest = hashlib.md5(f.read()).hexdigest()[:14]
    stem = os.path.splitext(os.path.basename(lib_path))[0]
    out_dir = os.path.join(_native_build_root(), f"{stem}_{digest}")
    os.makedirs(out_dir, exist_ok=True)
    out_so = os.path.join(out_dir, f"lib{stem}.so")
    include_dir = os.path.join(_spl_dir, "include")
    if os.path.isfile(out_so) and os.path.getmtime(out_so) >= os.path.getmtime(lib_path):
        return out_so
    cc = shutil.which("cc") or shutil.which("gcc") or shutil.which("clang")
    cxx = shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")
    if ext == ".c":
        if not cc:
            raise Exception(f"[Line {line}] No C compiler found (cc, gcc, or clang) for native library")
        cmd = [cc, "-shared", "-fPIC", "-O2", f"-I{include_dir}", "-o", out_so, os.path.abspath(lib_path)]
    else:
        if not cxx:
            raise Exception(f"[Line {line}] No C++ compiler found (c++, g++, or clang++) for native library")
        cmd = [
            cxx,
            "-shared",
            "-fPIC",
            "-O2",
            "-std=c++17",
            f"-I{include_dir}",
            "-o",
            out_so,
            os.path.abspath(lib_path),
        ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        msg = (r.stderr or r.stdout or "").strip() or "(no compiler output)"
        raise Exception(f"[Line {line}] Native compile failed:\n{msg}")
    return out_so


def _register_native_c_library(interpreter, lib_path, ext, line):
    so_path = _compile_native_shared(lib_path, ext, line)
    lib = ctypes.CDLL(so_path)
    SplAdd = ctypes.CFUNCTYPE(
        None,
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.CFUNCTYPE(ctypes.c_double),
    )

    @SplAdd
    def add_cb(ns_b, name_b, fn):
        ns = ns_b.decode("utf-8")
        name = name_b.decode("utf-8")

        def pyfn():
            return float(fn())

        interpreter.library.setdefault(ns, {})[name] = pyfn

    try:
        spl_register = lib.spl_register
    except AttributeError as e:
        raise Exception(
            f"[Line {line}] Native library must export spl_register (see include/spl_native.h)"
        ) from e
    spl_register.argtypes = [SplAdd]
    spl_register.restype = None
    spl_register(add_cb)


def _ensure_java_spl_host(jbuild, line):
    spl_host = os.path.join(_spl_dir, "lib", "SPLHost.java")
    if not os.path.isfile(spl_host):
        raise Exception(f"[Line {line}] Missing bundled SPLHost.java")
    spl_cls = os.path.join(jbuild, "SPLHost.class")
    if not os.path.isfile(spl_cls) or os.path.getmtime(spl_host) > os.path.getmtime(spl_cls):
        r = subprocess.run(
            ["javac", "-encoding", "UTF-8", "-d", jbuild, spl_host],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            msg = (r.stderr or r.stdout or "").strip() or "(no javac output)"
            raise Exception(f"[Line {line}] javac SPLHost.java failed:\n{msg}")


def _load_java_library(interpreter, lib_path, line):
    try:
        import jpype
        import jpype.imports
    except ImportError as e:
        raise Exception(
            f"[Line {line}] Java libraries need jpype1: pip install jpype1 "
            f"(or pip install 'someProgrammingLanguage[java]')"
        ) from e
    javac = shutil.which("javac")
    java = shutil.which("java")
    if not javac or not java:
        raise Exception(f"[Line {line}] javac/java not found on PATH for Java library import")
    with open(lib_path, encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"public\s+class\s+(\w+)\b", src)
    if not m:
        raise Exception(f"[Line {line}] Java library must declare one public class")
    class_name = m.group(1)
    jbuild = os.path.join(_native_build_root(), "java_classes")
    os.makedirs(jbuild, exist_ok=True)
    _ensure_java_spl_host(jbuild, line)
    r = subprocess.run(
        ["javac", "-encoding", "UTF-8", "-cp", jbuild, "-d", jbuild, os.path.abspath(lib_path)],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        msg = (r.stderr or r.stdout or "").strip() or "(no javac output)"
        raise Exception(f"[Line {line}] javac failed:\n{msg}")
    jbuild_abs = os.path.abspath(jbuild)
    if not jpype.isJVMStarted():
        jpype.startJVM(jpype.getDefaultJVMPath(), classpath=[jbuild_abs])

    spl_host_cls = jpype.JClass("SPLHost")

    @jpype.JImplements(spl_host_cls)
    class HostImpl:
        @jpype.JOverride
        def registerDoubleVoid(self, ns, name, supplier):
            ns = str(ns)
            name = str(name)

            def pyfn():
                return float(supplier.get())

            interpreter.library.setdefault(ns, {})[name] = pyfn

    host = HostImpl()
    user_cls = jpype.JClass(class_name)
    user_cls.splRegister(host)


def _spl_from_ascii_binary_mod(s, m):
    if not isinstance(s, str) or m is None:
        return None
    if not s:
        return 0
    if not all(c in "01" for c in s):
        return 0
    try:
        return int(s, 2) % int(m)
    except ValueError:
        return 0
