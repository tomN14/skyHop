"""Package manager, SQL (sqlite), and extended HTTP helpers for SPL."""

from __future__ import annotations

import os
import shutil
import sqlite3
from urllib import error as urllib_error
from urllib import request as urllib_request

from .spl_errors import SPLException
from .spl_stdlib_json import _spl_jsonable_to_spl, _spl_network_urlopen, _spl_network_validate_url

_SPL_PACKAGES_DIR = ".spl_packages"


class SPLSqlConnection:
    """Handle for sql.open (sqlite3)."""

    __slots__ = ("_conn",)

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn


def _pkg_root() -> str:
    return os.path.join(os.getcwd(), _SPL_PACKAGES_DIR)


def pkg_install(interpreter, name: str, line: int = 0):
    """Install bundled lib into .spl_packages/<name>/ (copy)."""
    if not isinstance(name, str) or not name.strip():
        raise Exception("pkg.install: name must be a non-empty string")
    name = name.strip().replace("\\", "/").split("/")[-1]
    if ".." in name or name.startswith("."):
        raise Exception(f"[Line {line}] pkg.install: invalid package name {name!r}")

    from .spl_runtime import _LIBRARY_PACKAGE_EXT, _resolve_library_import_lib

    lib_path, ext = _resolve_library_import_lib(name, line)
    dest = os.path.join(_pkg_root(), name)
    os.makedirs(_pkg_root(), exist_ok=True)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    if ext == _LIBRARY_PACKAGE_EXT:
        shutil.copytree(lib_path, dest)
    elif ext == ".spl":
        os.makedirs(dest, exist_ok=True)
        shutil.copy2(lib_path, os.path.join(dest, os.path.basename(lib_path)))
    else:
        shutil.copytree(os.path.dirname(lib_path), dest, dirs_exist_ok=True)
    return 1


def pkg_load(interpreter, name: str, line: int = 0):
    """Load main .spl from an installed package (``pkg.load`` — ``use`` is a reserved keyword)."""
    return pkg_use(interpreter, name, line)


def pkg_use(interpreter, name: str, line: int = 0):
    """Load main .spl from an installed package."""
    if not isinstance(name, str) or not name.strip():
        raise Exception("pkg.load: name must be a non-empty string")
    name = name.strip()
    pkg_dir = os.path.join(_pkg_root(), name)
    if not os.path.isdir(pkg_dir):
        raise Exception(f"[Line {line}] pkg.load: package not installed: {name!r} (run pkg.install first)")
    candidates = []
    for fn in os.listdir(pkg_dir):
        if fn.endswith(".spl"):
            candidates.append(os.path.join(pkg_dir, fn))
    if not candidates:
        raise Exception(f"[Line {line}] pkg.load: no .spl file in package {name!r}")
    spl_path = sorted(candidates)[0]
    interpreter._exec_spl_file(spl_path, line)
    return None


def pkg_list():
    root = _pkg_root()
    if not os.path.isdir(root):
        return []
    return sorted(
        d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)) and not d.startswith(".")
    )


def _resolve_user_file_path(rel_name):
    if not isinstance(rel_name, str) or not rel_name.strip():
        raise Exception("file: path must be a non-empty string")
    if rel_name != rel_name.strip():
        raise Exception("file: path must not have leading or trailing whitespace")
    for part in rel_name.replace("\\", "/").split("/"):
        if part == "..":
            raise Exception("file: path must not contain '..'")
    if rel_name.startswith(("/", "\\")) or (len(rel_name) > 2 and rel_name[1] == ":"):
        raise Exception("file: path must be relative to the working directory (no absolute paths)")
    cwd = os.path.realpath(os.getcwd())
    full = os.path.realpath(os.path.join(cwd, rel_name))
    if full != cwd and not full.startswith(cwd + os.sep):
        raise Exception("file: path escapes the working directory")
    return full


def sql_open(path):
    p = _resolve_user_file_path(str(path))
    try:
        conn = sqlite3.connect(p, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return SPLSqlConnection(conn)
    except sqlite3.Error as e:
        raise SPLException("IOError", str(e)) from e


def sql_close(conn):
    if not isinstance(conn, SPLSqlConnection):
        raise Exception("sql.close expects connection from sql.open")
    try:
        conn._conn.close()
    except sqlite3.Error as e:
        raise SPLException("IOError", str(e)) from e
    return 1


def sql_query(conn, sql_text):
    if not isinstance(conn, SPLSqlConnection):
        raise Exception("sql.query expects connection from sql.open")
    if not isinstance(sql_text, str):
        raise Exception("sql.query: SQL must be a string")
    try:
        cur = conn._conn.execute(sql_text)
        rows = []
        for row in cur.fetchall():
            rows.append({k: _spl_jsonable_to_spl(row[k]) for k in row.keys()})
        return rows
    except sqlite3.Error as e:
        raise SPLException("SqlError", str(e)) from e


def sql_exec(conn, sql_text):
    if not isinstance(conn, SPLSqlConnection):
        raise Exception("sql.exec expects connection from sql.open")
    if not isinstance(sql_text, str):
        raise Exception("sql.exec: SQL must be a string")
    try:
        cur = conn._conn.execute(sql_text)
        conn._conn.commit()
        return int(cur.rowcount)
    except sqlite3.Error as e:
        raise SPLException("SqlError", str(e)) from e


def _network_request(method: str, url, body=None):
    u = _spl_network_validate_url(url, f"network.{method.lower()}")
    data = None if body is None else str(body).encode("utf-8")
    try:
        req = urllib_request.Request(
            u,
            data=data,
            method=method.upper(),
            headers={"User-Agent": "SPL/1.0", "Content-Type": "text/plain; charset=utf-8"},
        )
        with _spl_network_urlopen(req, timeout=30) as resp:
            body_out = resp.read().decode("utf-8", errors="replace")
            status = int(resp.status)
    except urllib_error.HTTPError as e:
        status = int(e.code)
        body_out = e.read().decode("utf-8", errors="replace") if e.fp else ""
    except urllib_error.URLError as e:
        reason = str(e.reason)
        if "CERTIFICATE_VERIFY_FAILED" in reason:
            reason += " (pip install certifi)"
        raise SPLException("NetworkError", reason) from e
    return {"status": status, "body": body_out}
