"""JSON/network value conversion helpers for the SPL interpreter stdlib."""

import os
import ssl
import sys
from urllib import request as urllib_request

from .spl_runtime import SPLSet

_network_opener = None


def _spl_network_ssl_context():
    """Build SSL context; certifi fixes macOS python.org 'certificate verify failed'."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    paths = ssl.get_default_verify_paths()
    candidates = [
        paths.cafile,
        os.path.join(sys.prefix, "etc", "openssl", "cert.pem"),
        "/etc/ssl/cert.pem",
        "/private/etc/ssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
    ]
    for cafile in candidates:
        if cafile and os.path.isfile(cafile):
            try:
                return ssl.create_default_context(cafile=cafile)
            except ssl.SSLError:
                continue
    if paths.capath and os.path.isdir(paths.capath):
        try:
            return ssl.create_default_context(capath=paths.capath)
        except ssl.SSLError:
            pass
    return ssl.create_default_context()


def _spl_network_urlopen(req, timeout=30):
    global _network_opener
    if _network_opener is None:
        ctx = _spl_network_ssl_context()
        _network_opener = urllib_request.build_opener(
            urllib_request.HTTPSHandler(context=ctx)
        )
    return _network_opener.open(req, timeout=timeout)


def _spl_jsonable_to_spl(value, depth=0):
    if depth > 64:
        raise ValueError("json: nesting too deep")
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float, str)):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    if isinstance(value, list):
        return [_spl_jsonable_to_spl(v, depth + 1) for v in value]
    if isinstance(value, dict):
        return {str(k): _spl_jsonable_to_spl(v, depth + 1) for k, v in value.items()}
    raise TypeError(f"unsupported JSON value type: {type(value).__name__}")


def _spl_spl_to_jsonable(value, depth=0):
    if depth > 64:
        raise ValueError("json.write: nesting too deep")
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return [_spl_spl_to_jsonable(v, depth + 1) for v in value]
    if isinstance(value, tuple):
        return [_spl_spl_to_jsonable(v, depth + 1) for v in value]
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if not isinstance(k, (str, int, float)):
                raise TypeError(
                    f"json.write: hash key must be string or number, got {type(k).__name__}"
                )
            out[str(k)] = _spl_spl_to_jsonable(v, depth + 1)
        return out
    if isinstance(value, SPLSet):
        return [_spl_spl_to_jsonable(v, depth + 1) for v in value]
    raise TypeError(f"json.write: cannot serialize {type(value).__name__}")


def _spl_network_validate_url(url, method_name):
    if not isinstance(url, str) or not url.strip():
        raise Exception(f"{method_name}: url must be a non-empty string")
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        raise Exception(f"{method_name}: url must start with http:// or https://")
    return u
