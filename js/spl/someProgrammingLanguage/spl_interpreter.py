"""SPL interpreter: run/evaluate AST, builtins, and stdlib."""
import base64
import copy
import heapq
import importlib.util
import json
import math
import os
import random
import re
import secrets
import sys
from collections import deque
from urllib import error as urllib_error
from urllib import request as urllib_request

from .spl_ast import (
    ASTNode,
    MethodCallNode,
    ImportNode,
    BlockNode,
    LogicNode,
    HashLiteralNode,
    TupleLiteralNode,
    SetLiteralNode,
    TryExceptNode,
    InheritNode,
    ThisAssignNode,
    ExprStmtNode,
    SliceAssignNode,
    AwaitNode,
    FuncParam,
)
from .spl_errors import (
    BreakSignal,
    ContinueSignal,
    ReturnSignal,
    SPLException,
    SPLErrorType,
    _spl_except_kind_matches,
)
from .spl_lexer import Token, tokenize
from .spl_parser import Parser
from .spl_runtime import (
    SPLArtist,
    SPLBinaryTree,
    SPLClass,
    SPLFunctionRef,
    SPLCalcFuncSpec,
    SPLHeap,
    SPLInstance,
    SPLKeyMap,
    SPLLinkedList,
    SPLListNode,
    SPLQueue,
    SPLDeque,
    SPLPriorityQueue,
    SPLSet,
    SPLStack,
    SPLTreeNode,
    _DISPATCH_SKIP,
    _MAX_LOOP_ITERATIONS,
    _c_cpp_allows_extensionless_import,
    _java_allows_extensionless_import,
    _load_java_library,
    _pqc_derive_aes_key,
    _pqc_gcm_aad,
    _pqc_pack_seal,
    _pqc_require_crypto_aes,
    _pqc_require_oqs,
    _pqc_unpack_seal,
    _py_allows_extensionless_import,
    _register_native_c_library,
    _resolve_library_import_lib,
    _iter_library_package_files,
    _extensionless_allowers,
    _LIBRARY_FILE_EXTS,
    _LIBRARY_PACKAGE_EXT,
    _NATIVE_JAVA_EXT,
    _NATIVE_SOURCE_EXTS,
    _spl_allows_extensionless_import,
    _spl_from_ascii_binary_mod,
    _spl_replace_all_ignore_case,
    _spl_replace_first_ignore_case,
    _spl_replace_last,
    _spl_replace_last_ignore_case,
    _spl_string_convert_int,
    _spl_string_slice,
    SPL_SLICE_BOUND_MAX,
    SPL_SLICE_BOUND_MIN,
    tic_best_move,
    tic_fastest_win_move,
    tic_lose_move,
)
from .spl_stdlib_json import (
    _spl_jsonable_to_spl,
    _spl_network_validate_url,
    _spl_network_urlopen,
    _spl_spl_to_jsonable,
)
from .spl_jit import try_run_forloop_jit, try_run_while_jit
from .spl_async import run_async_do_block
from .spl_stdlib_extended import (
    SPLSqlConnection,
    _network_request as _http_request,
    pkg_install,
    pkg_list,
    pkg_load,
    pkg_use,
    sql_close,
    sql_exec,
    sql_open,
    sql_query,
)

_TEST_BRANCH_ALIASES={
    "if":"ifTrue",
    "iftrue":"ifTrue","iffalse":"ifFalse",
    "elseif":"elseIfTrue",
    "elseifTrue":"elseIfTrue","elseifFalse":"elseIfFalse",
    "forloop":"forLoop",
    "While":"while",
}

# Binary logic results keyed by operator name (used by evaluate()).
_LOGIC_BINOPS = {
    "and": lambda lb, rb: 1 if (lb == 1 and rb == 1) else 0,
    "or": lambda lb, rb: 1 if (lb == 1 or rb == 1) else 0,
    "xor": lambda lb, rb: 1 if (lb != rb) else 0,
    "xnor": lambda lb, rb: 1 if (lb == rb) else 0,
    "nand": lambda lb, rb: 0 if (lb == 1 and rb == 1) else 1,
    "nor": lambda lb, rb: 1 if (lb == 0 and rb == 0) else 0,
}

def _resolve_user_file_path(rel_name):
    """Resolve a path relative to the current working directory; disallow .. and absolute paths."""
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


# =============================================================================
# INTERPRETER — AST execution: run(), evaluate(), builtins, stdlib (search: class Interpreter)
# =============================================================================

class Interpreter:
    def __init__(self):
        # Scope chain: _scopes[0] is module/global; inner frames are block/function locals.
        self._scopes = [{"null": None}]
        self.funcs={}
        self.classes = {}
        self._class_def_stack = []
        self._instance_this_stack = []
        # Stack of real paths for SPL files currently executing (top = innermost use/inherit).
        # Enables use/inherit to resolve sibling paths next to the running script without copying to lib/.
        self._spl_file_stack = []
        self.if_stack=[]
        self._function_run_depth = 0
        self._async_depth = 0
        # SPL call stack for error traces: {kind, name?, class?, path?, file?, line}
        self._call_frames = []
        self._file_read_handles={}
        # Optional methods on plain lists, e.g. melody.rhythm([...]) from use music.audio.
        self._list_methods = {}
        self._roast_disclaimer_done = False
        self._roast_mode = None
        self._roast_halt = False
        self._roast_after_run = False
        # Args after the .spl path when launched via main/run-spl (sys.argv[2:]).
        self._cli_args = []
        self.library={
            "math":{"add":self._math_add,
                    "subtract":self._math_subtract,
                    "multiply":self._math_multiply,
                    "div":self._math_div,
                    "mod":self._math_mod,
                    "sqrtR":lambda a: math.sqrt(float(a)) if float(a)>=0 else None,
                    "sqrtI":lambda a: math.sqrt(float(a)) if float(a)>=0 else str(math.sqrt(-float(a)))+"i",
                    "floor":lambda a: math.floor(float(a)),
                    "ceil":lambda a: math.ceil(float(a)),
                    "round":lambda a: round(float(a)),
                    "stdround":lambda a: math.trunc(float(a) + (0.5 if float(a) >= 0 else -0.5)),
                    "subsets":self._math_subsets,
                    "addsum":self._math_addsum},
            "user":{"ask":lambda msg: input(str(msg))},
            "cli":{"argCount": lambda: len(self._cli_args),
                   "arg": self._cli_arg},
            "string":{"concatenate":lambda a,b: str(a)+str(b) if isinstance(a,str) and isinstance(b,str) else None,
                      "length":lambda s: len(str(s)) if isinstance(s,str) else None,
                      "convertInt": lambda s: _spl_string_convert_int(s),
                      "convertFloat":lambda string: float(string) if isinstance(string,str) else None,
                      "getChar":self._string_get_char,
                      "lowercase":lambda string: string.lower() if isinstance(string,str) else None,
                      "uppercase":lambda string: string.upper() if isinstance(string,str) else None,
                      "trim":lambda string: string.strip() if isinstance(string,str) else None,
                      "padLeft":lambda string,length,char: string.ljust(int(length),str(char)) if isinstance(string,str) and isinstance(length,int) and isinstance(char,str) else None,
                      "padRight":lambda string,length,char: string.rjust(int(length),str(char)) if isinstance(string,str) and isinstance(length,int) and isinstance(char,str) else None,
                      "padBoth":lambda string,length,char: string.center(int(length),str(char)) if isinstance(string,str) and isinstance(length,int) and isinstance(char,str) else None,
                      "padLeftIgnoreCase":lambda string,length,char: string.ljust(int(length),str(char)) if isinstance(string,str) and isinstance(length,int) and isinstance(char,str) else None,
                      "padRightIgnoreCase":lambda string,length,char: string.rjust(int(length),str(char)) if isinstance(string,str) and isinstance(length,int) and isinstance(char,str) else None,
                      "padBothIgnoreCase":lambda string,length,char: string.center(int(length),str(char)) if isinstance(string,str) and isinstance(length,int) and isinstance(char,str) else None,
                      "replaceAllIgnoreCase": _spl_replace_all_ignore_case,
                      "replaceFirstIgnoreCase": _spl_replace_first_ignore_case,
                      "replaceLastIgnoreCase": _spl_replace_last_ignore_case,
                      "reverse":lambda s: s[::-1] if isinstance(s,str) else None,
                      "toAsciiBinary":lambda s: "".join(format(ord(c), "08b") for c in s) if isinstance(s,str) else None,
                      "fromAsciiBinaryMod":lambda s,m: _spl_from_ascii_binary_mod(s,m),
                      "slice": self.lib_string_slice,
                      "sliceMin": lambda: SPL_SLICE_BOUND_MIN,
                      "sliceMax": lambda: SPL_SLICE_BOUND_MAX},
            "float":{"convertInt":self._float_convert_int},
            "random":{"randint":self._random_randint,
                      "randfloat":self._random_randfloat},
            "test":{"isEqual":lambda a,b:1 if a==b else 0,
                    "isEqualNumber":lambda a,b:1 if float(a)==float(b) else 0,
                    "isEqualString":lambda a,b:1 if str(a)==str(b) else 0,
                    "isEven":lambda n:1 if float(n)%2==0 else 0,
                    "isOdd":lambda n:1 if float(n)%2!=0 else 0,
                    "isGreater":lambda a,b:1 if float(a)>float(b) else 0,
                    "isLess":lambda a,b:1 if float(a)<float(b) else 0,
                    "find":lambda string,substring: string.find(substring) if isinstance(string,str) and isinstance(substring,str) else None,
                    "replaceAll":lambda string,old,new: string.replace(old,new) if isinstance(string,str) and isinstance(old,str) and isinstance(new,str) else None,
                    "replaceFirst":lambda string,old,new: string.replace(old,new,1) if isinstance(string,str) and isinstance(old,str) and isinstance(new,str) else None,
                    "replaceLast": _spl_replace_last,
                    "replaceAllIgnoreCase": _spl_replace_all_ignore_case,
                    "replaceFirstIgnoreCase": _spl_replace_first_ignore_case,
                    "replaceLastIgnoreCase": _spl_replace_last_ignore_case,
                    "isNull":lambda x:1 if x is None else 0,
                    "assertTrue":self._test_assert_true,
                    "assertFalse":self._test_assert_false,
                    "assertEqual":self._test_assert_equal,
                    "assertEqualNumber":self._test_assert_equal_number},
            "null":{"coalesce":self._null_coalesce},
            "enum":{"name":self._enum_name,
                    "equals":self._enum_equals},
            "list":{"createList":self.lib_create_list,
                    "get":self.lib_list_get,
                    "remove":self.lib_list_remove,
                    "removeAll":self.lib_list_remove_all,
                    "change":self.lib_list_change,
                    "copy":self.lib_list_deep_copy,
                    "append":self.lib_list_append,
                    "contains":self.lib_list_contains,
                    "length":lambda lst: len(lst) if isinstance(lst, list) else None,
                    "sort":self.lib_list_sort,
                    "iterable":lambda: "__list_iterable_marker__",
                    "iterate":lambda: "__list_iterate_marker__",
                    "returnTheFourthElementIfItExistsAndTheElementAtTheSecondIndexIfItExistsIfAndOnlyIfTheTodayIsAThursdayAndTheValueOfTheFifthElementIfItExistsIsAPrimeNumberrGreaterThanOneMillion": self.lib_list_return_thursday_fourth_and_second_index_iff_fifth_prime},
            "hash":{"getValue":self._hash_get_value,
                    "getKey":self._hash_get_key,
                    "add":self._hash_add,
                    "delete":self._hash_delete},
            "type":{"isNumber":lambda x:1 if isinstance(x,(int,float)) and not isinstance(x,bool) else 0,
                    "isString":lambda x:1 if isinstance(x,str) else 0,
                    "isBoolean":lambda x:1 if isinstance(x,int) and (x==0 or x==1) else 0,
                    "isList":lambda x:1 if isinstance(x,list) else 0,
                    "isTuple":lambda x:1 if isinstance(x,tuple) else 0,
                    "isSet":lambda x:1 if isinstance(x,SPLSet) else 0,
                    "isFunctionRef":lambda x:1 if isinstance(x,SPLFunctionRef) else 0,
                    "isNull":lambda x:1 if x is None else 0,
                    "isHash":lambda x:1 if isinstance(x,dict) else 0,
                    "isInstance":lambda x:1 if isinstance(x,SPLInstance) else 0,
                    "isClass":lambda x:1 if isinstance(x,SPLClass) else 0,
                    "isStack":lambda x:1 if isinstance(x,SPLStack) else 0,
                    "isQueue":lambda x:1 if isinstance(x,SPLQueue) else 0,
                    "isDeque":lambda x:1 if isinstance(x,SPLDeque) else 0,
                    "isPriorityQueue":lambda x:1 if isinstance(x,SPLPriorityQueue) else 0,
                    "isSqlConnection":lambda x:1 if isinstance(x,SPLSqlConnection) else 0,
                    "isLinkedList":lambda x:1 if isinstance(x,SPLLinkedList) else 0,
                    "isHeap":lambda x:1 if isinstance(x,SPLHeap) else 0,
                    "isTree":lambda x:1 if isinstance(x,SPLBinaryTree) else 0,
                    "isTreeNode":lambda x:1 if isinstance(x,SPLTreeNode) else 0,
                    "isArtist":lambda x:1 if isinstance(x,SPLArtist) else 0},
            "file":{"readline":self._file_readline,
                    "write":self._file_write,
                    "append":self._file_append,
                    "read":self._file_read,
                    "exists":self._file_exists,
                    "isfile":self._file_isfile,
                    "isdir":self._file_isdir,
                    "size":self._file_size,
                    "listdir":self._file_listdir,
                    "join":self._file_join,
                    "rename":self._file_rename,
                    "delete":self._file_delete,
                    "mkdir":self._file_mkdir,
                    "close":self._file_close},
            "json":{"read":self._json_read,
                    "write":self._json_write},
            "network":{"get":self._network_get,
                       "post":self._network_post,
                       "put":self._network_put,
                       "delete":self._network_delete,
                       "request":self._network_request},
            "tuple":{"createTuple":self.lib_tuple_create,
                     "get":self.lib_tuple_get},
            "set":{"createSet":self.lib_set_create,
                   "append":self.lib_set_append,
                   "remove":self.lib_set_remove,
                   "removeByIndex":self.lib_set_remove_by_index},
            "error":{
                "DivisionByZeroError":lambda:SPLErrorType("DivisionByZeroError"),
                "IndexOutOfRangeError":lambda:SPLErrorType("IndexOutOfRangeError"),
                "UndefinedVariableError":lambda:SPLErrorType("UndefinedVariableError"),
                "FileNotFoundError":lambda:SPLErrorType("FileNotFoundError"),
                "IOError":lambda:SPLErrorType("IOError"),
                "JsonParseError":lambda:SPLErrorType("JsonParseError"),
                "NetworkError":lambda:SPLErrorType("NetworkError"),
                "SqlError":lambda:SPLErrorType("SqlError"),
                "AssertionError":lambda:SPLErrorType("AssertionError"),
            },
            "pkg":{
                "install":lambda name: pkg_install(self, name),
                "load":lambda name: pkg_load(self, name),
                "list":lambda: pkg_list(),
            },
            "sql":{
                "open":sql_open,
                "close":sql_close,
                "query":sql_query,
                "exec":sql_exec,
            },
            "stack":{
                "push":lambda s,v:self._stack_push(s,v),
                "pop":lambda s:self._stack_pop(s),
                "peek":lambda s:self._stack_peek(s),
                "size":lambda s:self._stack_size(s),
                "isEmpty":lambda s:self._stack_is_empty(s),
            },
            "queue":{
                "enqueue":lambda q,v:self._queue_enqueue(q,v),
                "dequeue":lambda q:self._queue_dequeue(q),
                "peekFront":lambda q:self._queue_peek_front(q),
                "size":lambda q:self._queue_size(q),
                "isEmpty":lambda q:self._queue_is_empty(q),
            },
            "deque":{
                "pushFront":lambda d,v:self._deque_push_front(d,v),
                "pushBack":lambda d,v:self._deque_push_back(d,v),
                "popFront":lambda d:self._deque_pop_front(d),
                "popBack":lambda d:self._deque_pop_back(d),
                "peekFront":lambda d:self._deque_peek_front(d),
                "peekBack":lambda d:self._deque_peek_back(d),
                "size":lambda d:self._deque_size(d),
                "isEmpty":lambda d:self._deque_is_empty(d),
            },
            "priorityQueue":{
                "push":lambda pq,p,v:self._pq_push(pq,p,v),
                "pop":lambda pq:self._pq_pop(pq),
                "peek":lambda pq:self._pq_peek(pq),
                "size":lambda pq:self._pq_size(pq),
                "isEmpty":lambda pq:self._pq_is_empty(pq),
            },
            "linkedList":{
                "appendFront":lambda lst,v:self._linked_list_append_front(lst,v),
                "appendBack":lambda lst,v:self._linked_list_append_back(lst,v),
                "popFront":lambda lst:self._linked_list_pop_front(lst),
                "popBack":lambda lst:self._linked_list_pop_back(lst),
                "makeCircular":lambda lst:self._linked_list_make_circular(lst),
                "isCircular":lambda lst:self._linked_list_is_circular(lst),
                "size":lambda lst:self._linked_list_size(lst),
                "isEmpty":lambda lst:self._linked_list_is_empty(lst),
                "peekFront":lambda lst:self._linked_list_peek_front(lst),
                "peekBack":lambda lst:self._linked_list_peek_back(lst),
            },
            "heap":{
                "push":lambda h,v:self._heap_push(h,v),
                "popTop":lambda h:self._heap_pop_top(h),
                "peekTop":lambda h:self._heap_peek_top(h),
                "size":lambda h:self._heap_size(h),
                "isEmpty":lambda h:self._heap_is_empty(h),
            },
            "tree":{
                "newNode":lambda v:self._tree_new_node(v),
                "insertBST":lambda t,v:self._tree_insert_bst(t,v),
                "setLeft":lambda n,c:self._tree_set_left(n,c),
                "setRight":lambda n,c:self._tree_set_right(n,c),
                "setRoot":lambda t,r:self._tree_set_root(t,r),
                "getRoot":lambda t:self._tree_get_root(t),
                "preorder":lambda t:self._tree_preorder(t),
                "inorder":lambda t:self._tree_inorder(t),
                "postorder":lambda t:self._tree_postorder(t),
                "levelOrder":lambda t:self._tree_level_order(t),
            },
            "game":{
                "ticBestMove": self.lib_game_tic_best_move,
                "ticFastestWinMove": self.lib_game_tic_fastest_win_move,
                "ticLoseMove": self.lib_game_tic_lose_move,
            },
            "encrypt": {
                "pqcKemAlgorithms": self.lib_encrypt_pqc_kem_algorithms,
                "pqcSigAlgorithms": self.lib_encrypt_pqc_sig_algorithms,
                "pqcKemKeypair": self.lib_encrypt_pqc_kem_keypair,
                "pqcSeal": self.lib_encrypt_pqc_seal,
                "pqcOpen": self.lib_encrypt_pqc_open,
                "pqcSignKeypair": self.lib_encrypt_pqc_sign_keypair,
                "pqcSign": self.lib_encrypt_pqc_sign,
                "pqcVerify": self.lib_encrypt_pqc_verify,
            },
        }

    @property
    def vars(self):
        """Module-level global bindings (same dict as the root of the scope chain). Host code may read/write this."""
        return self._scopes[0]

    def _scope_push_empty(self):
        self._scopes.append({})

    def _scope_push_bindings(self, bindings: dict):
        self._scopes.append(dict(bindings))

    def _scope_pop(self):
        if len(self._scopes) <= 1:
            raise RuntimeError("internal error: cannot pop global scope")
        self._scopes.pop()

    def _scope_assign(self, name: str, value):
        """Assign: update innermost existing binding for name, else define in innermost frame."""
        scopes = self._scopes
        for i in range(len(scopes) - 1, -1, -1):
            frame = scopes[i]
            if name in frame:
                frame[name] = value
                return
        scopes[-1][name] = value

    def _scope_get(self, name: str, line=None):
        scopes = self._scopes
        inner = scopes[-1]
        if name in inner:
            return inner[name]
        for i in range(len(scopes) - 2, -1, -1):
            frame = scopes[i]
            if name in frame:
                return frame[name]
        cls = self.classes.get(name)
        if cls is not None:
            return cls
        self._raise_spl("UndefinedVariableError", f"undefined variable '{name}'", line or 0)

    def _normalize_numeric_result(self, result, inputs):
        # keep integer results as ints unless any input was explicitly decimal.
        if any(isinstance(v,float) for v in inputs):
            return float(result)
        if isinstance(result,float) and result.is_integer():
            return int(result)
        return result

    @staticmethod
    def _spl_logical_bool(v):
        """Truth value for logic operators (and/or/not/…): null is falsy; non-zero numbers truthy."""
        if v is None:
            return 0
        return 1 if v != 0 else 0

    def _null_coalesce(self, a, b):
        """First non-null value (SQL-style COALESCE for two arguments)."""
        return b if a is None else a

    def _enum_create_enum(self, mapping, name_token):
        """Bind a name→int hash as an enum table (same representation as hash)."""
        line = getattr(name_token, "line", 0)
        if not isinstance(mapping, dict):
            raise Exception(f"[Line {line}] enum.createEnum requires a hash as first argument")
        if not isinstance(name_token, Token) or name_token.t != "ID":
            raise Exception(f"[Line {line}] enum.createEnum second argument must be a variable name (identifier)")
        h = dict(mapping)
        self._scope_assign(name_token.v, h)
        return h

    def _enum_name(self, enum_h, value):
        if not isinstance(enum_h, dict):
            raise Exception("enum.name expects (enumHash, numericValue)")
        return self._hash_get_key(value, enum_h)

    def _enum_equals(self, a, b):
        if a is None and b is None:
            return 1
        if a is None or b is None:
            return 0
        try:
            return 1 if float(a) == float(b) else 0
        except (TypeError, ValueError):
            return 1 if a == b else 0

    def _ds_bind_name(self, name_token, value):
        if not isinstance(name_token, Token) or name_token.t != "ID":
            raise Exception(
                f"[Line {name_token.line}] expected variable name (identifier)"
            )
        self._scope_assign(name_token.v, value)
        return value

    def _stack_push(self, s, v):
        if not isinstance(s, SPLStack):
            raise Exception("stack.push expects stack")
        s._items.append(v)
        return v

    def _stack_pop(self, s):
        if not isinstance(s, SPLStack):
            raise Exception("stack.pop expects stack")
        if not s._items:
            return None
        return s._items.pop()

    def _stack_peek(self, s):
        if not isinstance(s, SPLStack):
            raise Exception("stack.peek expects stack")
        if not s._items:
            return None
        return s._items[-1]

    def _stack_size(self, s):
        if not isinstance(s, SPLStack):
            raise Exception("stack.size expects stack")
        return len(s._items)

    def _stack_is_empty(self, s):
        if not isinstance(s, SPLStack):
            raise Exception("stack.isEmpty expects stack")
        return 1 if len(s._items) == 0 else 0

    def _queue_enqueue(self, q, v):
        if not isinstance(q, SPLQueue):
            raise Exception("queue.enqueue expects queue")
        q._dq.append(v)
        return v

    def _queue_dequeue(self, q):
        if not isinstance(q, SPLQueue):
            raise Exception("queue.dequeue expects queue")
        if not q._dq:
            return None
        return q._dq.popleft()

    def _queue_peek_front(self, q):
        if not isinstance(q, SPLQueue):
            raise Exception("queue.peekFront expects queue")
        if not q._dq:
            return None
        return q._dq[0]

    def _queue_size(self, q):
        if not isinstance(q, SPLQueue):
            raise Exception("queue.size expects queue")
        return len(q._dq)

    def _queue_is_empty(self, q):
        if not isinstance(q, SPLQueue):
            raise Exception("queue.isEmpty expects queue")
        return 1 if len(q._dq) == 0 else 0

    def _deque_push_front(self, d, v):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.pushFront expects deque")
        d._dq.appendleft(v)
        return v

    def _deque_push_back(self, d, v):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.pushBack expects deque")
        d._dq.append(v)
        return v

    def _deque_pop_front(self, d):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.popFront expects deque")
        if not d._dq:
            return None
        return d._dq.popleft()

    def _deque_pop_back(self, d):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.popBack expects deque")
        if not d._dq:
            return None
        return d._dq.pop()

    def _deque_peek_front(self, d):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.peekFront expects deque")
        if not d._dq:
            return None
        return d._dq[0]

    def _deque_peek_back(self, d):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.peekBack expects deque")
        if not d._dq:
            return None
        return d._dq[-1]

    def _deque_size(self, d):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.size expects deque")
        return len(d._dq)

    def _deque_is_empty(self, d):
        if not isinstance(d, SPLDeque):
            raise Exception("deque.isEmpty expects deque")
        return 1 if len(d._dq) == 0 else 0

    def _pq_push(self, pq, priority, value):
        if not isinstance(pq, SPLPriorityQueue):
            raise Exception("priorityQueue.push expects priority queue")
        pq._counter += 1
        heapq.heappush(pq._data, (float(priority), pq._counter, value))
        return value

    def _pq_pop(self, pq):
        if not isinstance(pq, SPLPriorityQueue):
            raise Exception("priorityQueue.pop expects priority queue")
        if not pq._data:
            return None
        return heapq.heappop(pq._data)[2]

    def _pq_peek(self, pq):
        if not isinstance(pq, SPLPriorityQueue):
            raise Exception("priorityQueue.peek expects priority queue")
        if not pq._data:
            return None
        return pq._data[0][2]

    def _pq_size(self, pq):
        if not isinstance(pq, SPLPriorityQueue):
            raise Exception("priorityQueue.size expects priority queue")
        return len(pq._data)

    def _pq_is_empty(self, pq):
        if not isinstance(pq, SPLPriorityQueue):
            raise Exception("priorityQueue.isEmpty expects priority queue")
        return 1 if len(pq._data) == 0 else 0

    def _test_assert_true(self, cond, message=""):
        if cond != 1:
            self._raise_spl("AssertionError", str(message) or "assertTrue failed")
        return 1

    def _test_assert_false(self, cond, message=""):
        if cond != 0:
            self._raise_spl("AssertionError", str(message) or "assertFalse failed")
        return 1

    def _test_assert_equal(self, a, b, message=""):
        if a != b:
            msg = str(message) if message else f"assertEqual failed: {a!r} != {b!r}"
            self._raise_spl("AssertionError", msg)
        return 1

    def _test_assert_equal_number(self, a, b, message=""):
        if float(a) != float(b):
            msg = str(message) if message else f"assertEqualNumber failed: {a!r} != {b!r}"
            self._raise_spl("AssertionError", msg)
        return 1

    def _sql_query(self, conn, sql_text):
        return sql_query(conn, sql_text)

    def _linked_list_append_front(self, lst, v):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.appendFront expects linked list")
        n = SPLListNode(v)
        if lst.head is None:
            lst.head = lst.tail = n
        else:
            n.next = lst.head
            lst.head.prev = n
            lst.head = n
        lst._size += 1
        return v

    def _linked_list_append_back(self, lst, v):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.appendBack expects linked list")
        n = SPLListNode(v)
        if lst.tail is None:
            lst.head = lst.tail = n
        else:
            lst.tail.next = n
            n.prev = lst.tail
            lst.tail = n
        lst._size += 1
        return v

    def _linked_list_pop_front(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.popFront expects linked list")
        if lst.head is None:
            return None
        if lst._circular and lst._size == 1:
            v = lst.head.value
            lst.head = lst.tail = None
            lst._circular = False
            lst._size = 0
            return v
        if lst._circular:
            old = lst.head
            v = old.value
            lst.head = old.next
            lst.tail.next = lst.head
            lst.head.prev = lst.tail
            old.next = old.prev = None
            lst._size -= 1
            return v
        v = lst.head.value
        if lst.head == lst.tail:
            lst.head = lst.tail = None
        else:
            lst.head = lst.head.next
            lst.head.prev = None
        lst._size -= 1
        return v

    def _linked_list_pop_back(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.popBack expects linked list")
        if lst.tail is None:
            return None
        if lst._circular and lst._size == 1:
            v = lst.tail.value
            lst.head = lst.tail = None
            lst._circular = False
            lst._size = 0
            return v
        if lst._circular:
            old = lst.tail
            v = old.value
            lst.tail = old.prev
            lst.tail.next = lst.head
            lst.head.prev = lst.tail
            old.next = old.prev = None
            lst._size -= 1
            return v
        v = lst.tail.value
        if lst.head == lst.tail:
            lst.head = lst.tail = None
        else:
            lst.tail = lst.tail.prev
            lst.tail.next = None
        lst._size -= 1
        return v

    def _linked_list_make_circular(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.makeCircular expects linked list")
        if lst.head is None or lst._circular:
            return lst
        lst.tail.next = lst.head
        lst.head.prev = lst.tail
        lst._circular = True
        return lst

    def _linked_list_is_circular(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.isCircular expects linked list")
        return 1 if lst._circular else 0

    def _linked_list_size(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.size expects linked list")
        return lst._size

    def _linked_list_is_empty(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.isEmpty expects linked list")
        return 1 if lst._size == 0 else 0

    def _linked_list_peek_front(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.peekFront expects linked list")
        if lst.head is None:
            return None
        return lst.head.value

    def _linked_list_peek_back(self, lst):
        if not isinstance(lst, SPLLinkedList):
            raise Exception("linkedList.peekBack expects linked list")
        if lst.tail is None:
            return None
        return lst.tail.value

    def _heap_push(self, h, v):
        if not isinstance(h, SPLHeap):
            raise Exception("heap.push expects heap")
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise Exception("heap.push expects a numeric value")
        fv = float(v)
        if h._min:
            heapq.heappush(h._data, (fv, v))
        else:
            heapq.heappush(h._data, (-fv, v))
        return v

    def _heap_pop_top(self, h):
        if not isinstance(h, SPLHeap):
            raise Exception("heap.popTop expects heap")
        if not h._data:
            return None
        return heapq.heappop(h._data)[1]

    def _heap_peek_top(self, h):
        if not isinstance(h, SPLHeap):
            raise Exception("heap.peekTop expects heap")
        if not h._data:
            return None
        return h._data[0][1]

    def _heap_size(self, h):
        if not isinstance(h, SPLHeap):
            raise Exception("heap.size expects heap")
        return len(h._data)

    def _heap_is_empty(self, h):
        if not isinstance(h, SPLHeap):
            raise Exception("heap.isEmpty expects heap")
        return 1 if len(h._data) == 0 else 0

    def _tree_insert_bst_node(self, node, value):
        if node is None:
            return SPLTreeNode(value)
        try:
            if value < node.value:
                node.left = self._tree_insert_bst_node(node.left, value)
            else:
                node.right = self._tree_insert_bst_node(node.right, value)
        except TypeError as e:
            raise Exception(f"tree.insertBST requires comparable values: {e}") from e
        return node

    def _tree_insert_bst(self, t, value):
        if not isinstance(t, SPLBinaryTree):
            raise Exception("tree.insertBST expects tree")
        t.root = self._tree_insert_bst_node(t.root, value)
        return value

    def _tree_new_node(self, value):
        return SPLTreeNode(value)

    def _tree_set_left(self, node, child):
        if not isinstance(node, SPLTreeNode):
            raise Exception("tree.setLeft expects tree node")
        node.left = None if child is None else child
        return child

    def _tree_set_right(self, node, child):
        if not isinstance(node, SPLTreeNode):
            raise Exception("tree.setRight expects tree node")
        node.right = None if child is None else child
        return child

    def _tree_set_root(self, t, root):
        if not isinstance(t, SPLBinaryTree):
            raise Exception("tree.setRoot expects tree")
        t.root = None if root is None else root
        return root

    def _tree_get_root(self, t):
        if not isinstance(t, SPLBinaryTree):
            raise Exception("tree.getRoot expects tree")
        return t.root

    def _tree_preorder_collect(self, node):
        if node is None:
            return []
        return (
            [node.value]
            + self._tree_preorder_collect(node.left)
            + self._tree_preorder_collect(node.right)
        )

    def _tree_inorder_collect(self, node):
        if node is None:
            return []
        return (
            self._tree_inorder_collect(node.left)
            + [node.value]
            + self._tree_inorder_collect(node.right)
        )

    def _tree_postorder_collect(self, node):
        if node is None:
            return []
        return (
            self._tree_postorder_collect(node.left)
            + self._tree_postorder_collect(node.right)
            + [node.value]
        )

    def _tree_level_order_collect(self, t):
        if not isinstance(t, SPLBinaryTree):
            raise Exception("tree.levelOrder expects tree")
        if t.root is None:
            return []
        out = []
        q = deque([t.root])
        while q:
            n = q.popleft()
            out.append(n.value)
            if n.left is not None:
                q.append(n.left)
            if n.right is not None:
                q.append(n.right)
        return out

    def _tree_preorder(self, t):
        if not isinstance(t, SPLBinaryTree):
            raise Exception("tree.preorder expects tree")
        return self._tree_preorder_collect(t.root)

    def _tree_inorder(self, t):
        if not isinstance(t, SPLBinaryTree):
            raise Exception("tree.inorder expects tree")
        return self._tree_inorder_collect(t.root)

    def _tree_postorder(self, t):
        if not isinstance(t, SPLBinaryTree):
            raise Exception("tree.postorder expects tree")
        return self._tree_postorder_collect(t.root)

    def _tree_level_order(self, t):
        return self._tree_level_order_collect(t)

    def _string_get_char(self, string, index):
        if not isinstance(string, str) or not isinstance(index, (int, float)):
            return None
        idx = int(index)
        if idx < 0 or idx >= len(string):
            raise SPLException("IndexOutOfRangeError", f"string index {idx} for length {len(string)}")
        return string[idx]

    def lib_string_slice(self, lo, hi, text):
        """Substring with SPL slicing rules (see guides/slicing.html). Arguments: lo, hi, string."""
        return _spl_string_slice(lo, hi, text, 0)

    def _keymap_create_keymap(self, node, line):
        if not node.arg or len(node.arg) != 1:
            raise Exception(f"[Line {line}] keymap.createKeyMap requires (variableName)")
        name_arg = node.arg[0]
        if not isinstance(name_arg, Token) or name_arg.t != "ID":
            raise Exception(f"[Line {line}] keymap.createKeyMap name must be an identifier")
        if not self._class_def_stack:
            raise Exception(f"[Line {line}] keymap.createKeyMap only allowed inside classDefine")
        cls = self._class_def_stack[-1]
        km = SPLKeyMap(cls)
        self._scope_assign(name_arg.v, km)
        return km

    def _string_sorted(self, node, line):
        pos_args = [self.evaluate(a) for a in (node.arg or [])]
        named = getattr(node, "named", None) or {}
        named_eval = {k: self.evaluate(v) for k, v in named.items()}
        s = pos_args[0] if len(pos_args) > 0 else None
        if s is None:
            raise Exception(f"[Line {line}] string.sorted requires the string as first argument")
        if not isinstance(s, str):
            raise Exception(f"[Line {line}] string.sorted: first argument must be a string")
        km = named_eval.get("key")
        if km is None and len(pos_args) > 1:
            km = pos_args[1]
        rev = named_eval.get("reverse")
        if rev is None and len(pos_args) > 2:
            rev = pos_args[2]
        if km is None:
            raise Exception(
                f"[Line {line}] string.sorted requires key (second positional or name key <- keymap)"
            )
        if not isinstance(km, SPLKeyMap):
            raise Exception(
                f"[Line {line}] string.sorted: key must be a keymap from keymap.createKeyMap"
            )
        if rev is None:
            rev = 0
        if isinstance(rev, bool):
            reverse_bool = rev
        else:
            reverse_bool = float(rev) != 0
        cls = km.spl_class
        entries = cls.keymap_entries
        if not entries:
            raise Exception(f"[Line {line}] string.sorted: class has no keymapDefine.keymap body")
        curr = {}
        km.curr = curr
        inst = SPLInstance(cls)
        for fn, fv in cls.field_defaults.items():
            inst.fields[fn] = copy.deepcopy(fv)
        for fn in ("string1", "string", "s"):
            if fn in cls.field_defaults or fn in inst.fields:
                inst.fields[fn] = s
        inst.fields["keymap"] = km
        bindings = {"this": inst}
        for k, v in inst.fields.items():
            bindings[k] = v
        self._scope_push_bindings(bindings)
        try:
            for ch, expr_ast in entries:
                km.curr = curr
                curr[ch] = self.evaluate(expr_ast)
        finally:
            self._scope_pop()
        for c in s:
            if c not in curr:
                raise Exception(
                    f"[Line {line}] string.sorted: character {c!r} has no keymap entry"
                )
        weights = {i: curr[s[i]] for i in range(len(s))}
        idx_sorted = sorted(
            range(len(s)),
            key=lambda i: (weights[i], i),
            reverse=reverse_bool,
        )
        return "".join(s[i] for i in idx_sorted)

    def _math_add(self,a,b):
        af=float(a); bf=float(b)
        return self._normalize_numeric_result(af+bf,(a,b))

    def _math_subtract(self,a,b):
        af=float(a); bf=float(b)
        return self._normalize_numeric_result(af-bf,(a,b))

    def _math_multiply(self,a,b):
        af=float(a); bf=float(b)
        return self._normalize_numeric_result(af*bf,(a,b))

    def _math_div(self, a, b):
        af = float(a)
        bf = float(b)
        if bf == 0:
            self._raise_spl("DivisionByZeroError", "division by zero")
        return self._normalize_numeric_result(af / bf, (a, b))

    def _math_mod(self,a,b):
        af=float(a); bf=float(b)
        if bf==0:
            return None
        return self._normalize_numeric_result(af%bf,(a,b))

    def _math_collection_items(self, coll, name):
        if isinstance(coll, list):
            return coll
        if isinstance(coll, tuple):
            return list(coll)
        if isinstance(coll, SPLSet):
            return list(coll._items)
        raise Exception(f"{name} expects a list, set, or tuple")

    def _math_subsets(self, coll):
        """Power set of a list (also accepts set/tuple). Each subset is an SPL set."""
        if isinstance(coll, list):
            items = coll
        elif isinstance(coll, tuple):
            items = list(coll)
        elif isinstance(coll, SPLSet):
            items = list(coll._items)
        else:
            raise Exception("math.subsets expects a list (or set/tuple)")
        n = len(items)
        if n > 20:
            raise Exception("math.subsets: at most 20 elements")
        out = []
        for mask in range(1 << n):
            chosen = [items[i] for i in range(n) if mask & (1 << i)]
            out.append(SPLSet(chosen))
        return out

    def _math_addsum(self, coll):
        """Sum of all numeric elements in a list, set, or tuple."""
        items = self._math_collection_items(coll, "math.addsum")
        total = 0
        for x in items:
            if isinstance(x, bool) or not isinstance(x, (int, float)):
                raise Exception("math.addsum: all elements must be numeric")
            total = self._math_add(total, x)
        return total

    def _hash_get_value(self, key, h):
        # O(1) average: single dict lookup (hash table under the hood).
        if not isinstance(h, dict):
            raise Exception("hash.getValue expects (key, hash)")
        k = key
        if isinstance(k, float) and not isinstance(k, bool) and k.is_integer():
            k = int(k)
        if k in h:
            return h[k]
        return h.get(key)

    def _hash_get_key(self, value, h):
        # O(n): must scan entries when searching by value.
        if not isinstance(h, dict):
            raise Exception("hash.getKey expects (value, hash)")
        for k, v in h.items():
            if v == value:
                return k
        return None

    def _hash_add(self, pair, h):
        if not isinstance(h, dict):
            raise Exception("hash.add expects ((key, value), hash)")
        if not isinstance(pair, tuple) or len(pair) != 2:
            raise Exception("hash.add first argument must be (key, value)")
        k, v = pair[0], pair[1]
        h[k] = v
        return h

    def _hash_delete(self, key, h):
        if not isinstance(h, dict):
            raise Exception("hash.delete expects (key, hash)")
        h.pop(key, None)
        return h

    def _cli_arg(self, index):
        if isinstance(index, bool) or not isinstance(index, (int, float)):
            raise Exception("cli.arg expects a numeric index")
        i = int(index)
        if i < 0 or i >= len(self._cli_args):
            raise Exception(f"cli.arg index {i} out of range (have {len(self._cli_args)} args)")
        return self._cli_args[i]

    def _float_convert_int(self, value):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise Exception("float.convertInt expects a numeric value")
        fval=float(value)
        if not fval.is_integer():
            raise Exception(f"float.convertInt requires a whole-number float, got {value!r}")
        return int(fval)

    def _random_randint(self, lower, upper):
        if isinstance(lower, bool) or isinstance(upper, bool):
            raise Exception("random.randint expects numeric bounds")
        lo, hi = int(lower), int(upper)
        if lo > hi:
            raise Exception("random.randint: lower must be <= upper")
        return random.randint(lo, hi)

    def _random_randfloat(self, lower, upper):
        if isinstance(lower, bool) or isinstance(upper, bool):
            raise Exception("random.randfloat expects numeric bounds")
        a, b = float(lower), float(upper)
        if a > b:
            raise Exception("random.randfloat: lower must be <= upper")
        return random.uniform(a, b)

    def _file_close_read_handle(self, path):
        fh = self._file_read_handles.pop(path, None)
        if fh is not None:
            try:
                fh.close()
            except OSError:
                pass

    def _current_spl_file(self):
        if self._spl_file_stack:
            return self._spl_file_stack[-1]
        return None

    def _push_call_frame(self, frame: dict):
        if "file" not in frame and "path" not in frame:
            cur = self._current_spl_file()
            if cur:
                frame = {**frame, "file": cur}
        self._call_frames.append(frame)

    def _pop_call_frame(self):
        if self._call_frames:
            self._call_frames.pop()

    def _attach_trace(self, exc: SPLException) -> SPLException:
        """Attach a snapshot of the current SPL call stack to an exception."""
        if not exc.spl_trace and self._call_frames:
            exc.spl_trace = list(self._call_frames)
        return exc

    def _raise_spl(self, kind, message="", spl_line=0):
        raise self._attach_trace(SPLException(kind, message, spl_line, self._call_frames))

    def _file_readline(self, rel):
        p = _resolve_user_file_path(str(rel))
        if p not in self._file_read_handles:
            try:
                self._file_read_handles[p] = open(p, "r", encoding="utf-8", newline="")
            except FileNotFoundError as e:
                self._raise_spl("FileNotFoundError", str(e))
            except OSError as e:
                self._raise_spl("IOError", str(e))
        fh = self._file_read_handles[p]
        line = fh.readline()
        if line == "":
            return ""
        if line.endswith("\n"):
            line = line[:-1]
        if line.endswith("\r"):
            line = line[:-1]
        return line

    def _file_write(self, text, rel):
        p = _resolve_user_file_path(str(rel))
        self._file_close_read_handle(p)
        try:
            with open(p, "w", encoding="utf-8", newline="\n") as out:
                out.write(str(text))
        except OSError as e:
            self._raise_spl("IOError", str(e))

    def _file_append(self, text, rel):
        p = _resolve_user_file_path(str(rel))
        self._file_close_read_handle(p)
        try:
            need_nl = os.path.isfile(p) and os.path.getsize(p) > 0
            with open(p, "a", encoding="utf-8", newline="\n") as out:
                if need_nl:
                    out.write("\n")
                out.write(str(text))
        except OSError as e:
            self._raise_spl("IOError", str(e))

    def _file_read(self, rel):
        p = _resolve_user_file_path(str(rel))
        self._file_close_read_handle(p)
        try:
            with open(p, encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError as e:
            self._raise_spl("FileNotFoundError", str(e))
        except OSError as e:
            self._raise_spl("IOError", str(e))

    def _file_exists(self, rel):
        p = _resolve_user_file_path(str(rel))
        return 1 if os.path.exists(p) else 0

    def _file_isfile(self, rel):
        p = _resolve_user_file_path(str(rel))
        return 1 if os.path.isfile(p) else 0

    def _file_isdir(self, rel):
        p = _resolve_user_file_path(str(rel))
        return 1 if os.path.isdir(p) else 0

    def _file_size(self, rel):
        p = _resolve_user_file_path(str(rel))
        try:
            return int(os.path.getsize(p))
        except FileNotFoundError as e:
            self._raise_spl("FileNotFoundError", str(e))
        except OSError as e:
            self._raise_spl("IOError", str(e))

    def _file_listdir(self, rel="."):
        p = _resolve_user_file_path(str(rel) if rel is not None else ".")
        if not os.path.isdir(p):
            if not os.path.exists(p):
                self._raise_spl("FileNotFoundError", f"not a directory: {rel}")
            self._raise_spl("IOError", f"not a directory: {rel}")
        try:
            return sorted(os.listdir(p))
        except OSError as e:
            self._raise_spl("IOError", str(e))

    def _file_join(self, *parts):
        if not parts:
            raise Exception("file.join requires at least one path segment")
        segs = [str(p) for p in parts]
        joined = "/".join(s.replace("\\", "/").strip("/") for s in segs if str(s) != "")
        # Validate the joined relative path stays sandboxed.
        _resolve_user_file_path(joined if joined else ".")
        return joined if joined else "."

    def _file_rename(self, old_rel, new_rel):
        src = _resolve_user_file_path(str(old_rel))
        dst = _resolve_user_file_path(str(new_rel))
        self._file_close_read_handle(src)
        self._file_close_read_handle(dst)
        try:
            os.rename(src, dst)
        except FileNotFoundError as e:
            self._raise_spl("FileNotFoundError", str(e))
        except OSError as e:
            self._raise_spl("IOError", str(e))
        return 1

    def _file_delete(self, rel):
        p = _resolve_user_file_path(str(rel))
        self._file_close_read_handle(p)
        try:
            if os.path.isdir(p) and not os.path.islink(p):
                os.rmdir(p)
            else:
                os.remove(p)
        except FileNotFoundError as e:
            self._raise_spl("FileNotFoundError", str(e))
        except OSError as e:
            self._raise_spl("IOError", str(e))
        return 1

    def _file_mkdir(self, rel):
        p = _resolve_user_file_path(str(rel))
        try:
            os.makedirs(p, exist_ok=True)
        except OSError as e:
            self._raise_spl("IOError", str(e))
        return 1

    def _file_close(self, rel):
        p = _resolve_user_file_path(str(rel))
        self._file_close_read_handle(p)
        return 1

    def _json_read(self, rel):
        p = _resolve_user_file_path(str(rel))
        try:
            with open(p, encoding="utf-8") as f:
                raw = f.read()
        except FileNotFoundError as e:
            raise SPLException("FileNotFoundError", str(e)) from e
        except OSError as e:
            raise SPLException("IOError", str(e)) from e
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise SPLException(
                "JsonParseError",
                f"{rel}: {e.msg} (line {e.lineno}, column {e.colno})",
            ) from e
        try:
            return _spl_jsonable_to_spl(data)
        except (TypeError, ValueError) as e:
            raise SPLException("JsonParseError", str(e)) from e

    def _json_write(self, value, rel):
        p = _resolve_user_file_path(str(rel))
        self._file_close_read_handle(p)
        try:
            payload = json.dumps(
                _spl_spl_to_jsonable(value),
                indent=2,
                ensure_ascii=False,
            )
        except (TypeError, ValueError) as e:
            raise Exception(f"json.write: {e}") from e
        try:
            with open(p, "w", encoding="utf-8", newline="\n") as out:
                out.write(payload)
                if not payload.endswith("\n"):
                    out.write("\n")
        except OSError as e:
            raise SPLException("IOError", str(e)) from e
        return 1

    def _network_get(self, url):
        u = _spl_network_validate_url(url, "network.get")
        try:
            req = urllib_request.Request(u, method="GET", headers={"User-Agent": "SPL/1.0"})
            with _spl_network_urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                status = int(resp.status)
        except urllib_error.HTTPError as e:
            status = int(e.code)
            body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        except urllib_error.URLError as e:
            reason = str(e.reason)
            if "CERTIFICATE_VERIFY_FAILED" in reason:
                reason += (
                    " (install CA certs: pip install certifi, or on macOS run "
                    "Python's 'Install Certificates.command')"
                )
            raise SPLException("NetworkError", reason) from e
        return {"status": status, "body": body}

    def _network_post(self, url, body):
        u = _spl_network_validate_url(url, "network.post")
        data = str(body).encode("utf-8")
        try:
            req = urllib_request.Request(
                u,
                data=data,
                method="POST",
                headers={
                    "User-Agent": "SPL/1.0",
                    "Content-Type": "text/plain; charset=utf-8",
                },
            )
            with _spl_network_urlopen(req, timeout=30) as resp:
                out_body = resp.read().decode("utf-8", errors="replace")
                status = int(resp.status)
        except urllib_error.HTTPError as e:
            status = int(e.code)
            out_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        except urllib_error.URLError as e:
            reason = str(e.reason)
            if "CERTIFICATE_VERIFY_FAILED" in reason:
                reason += (
                    " (install CA certs: pip install certifi, or on macOS run "
                    "Python's 'Install Certificates.command')"
                )
            raise SPLException("NetworkError", reason) from e
        return {"status": status, "body": out_body}

    def _network_put(self, url, body):
        return _http_request("PUT", url, body)

    def _network_delete(self, url):
        return _http_request("DELETE", url)

    def _network_request(self, method, url, body=None):
        return _http_request(method, url, body)

    def lib_game_tic_best_move(self, board, ai, hu):
        """Minimax optimal empty cell via ``spl_game_ttt.tic_best_move``."""
        return tic_best_move(board, ai, hu)

    def lib_game_tic_fastest_win_move(self, board, ai, hu):
        """Minimax preferring fastest win via ``spl_game_ttt.tic_fastest_win_move``."""
        return tic_fastest_win_move(board, ai, hu)

    def lib_game_tic_lose_move(self, board, ai, hu):
        """Minimax inverted (try to lose) via ``spl_game_ttt.tic_lose_move``."""
        return tic_lose_move(board, ai, hu)

    def lib_encrypt_pqc_kem_algorithms(self):
        oqs_mod = _pqc_require_oqs()
        return ",".join(sorted(oqs_mod.get_enabled_kem_mechanisms()))

    def lib_encrypt_pqc_sig_algorithms(self):
        oqs_mod = _pqc_require_oqs()
        return ",".join(sorted(oqs_mod.get_enabled_sig_mechanisms()))

    def lib_encrypt_pqc_kem_keypair(self, algorithm):
        """List [recipientPublicKeyBase64, recipientSecretKeyBase64] for the KEM mechanism name."""
        oqs_mod = _pqc_require_oqs()
        alg = str(algorithm).strip()
        with oqs_mod.KeyEncapsulation(alg) as kem:
            pk = kem.generate_keypair()
            sk = kem.export_secret_key()
        return [
            base64.b64encode(pk).decode("ascii"),
            base64.b64encode(sk).decode("ascii"),
        ]

    def lib_encrypt_pqc_seal(self, algorithm, recipient_pk_b64, plaintext):
        """
        PQ KEM (liboqs) + HKDF-SHA256 + AES-256-GCM. Bundle encoding is opaque base64 ``SPLPQE1``.
        Plaintext must be SPL string content (stored as UTF-8).
        """
        AESGCM, _, _ = _pqc_require_crypto_aes()
        oqs_mod = _pqc_require_oqs()
        if plaintext is None:
            raise Exception("encrypt.pqcSeal: plaintext must be a string (not null)")
        alg = str(algorithm).strip()
        try:
            pk_raw = base64.b64decode(str(recipient_pk_b64).strip(), validate=True)
        except Exception as e:
            raise Exception(f"encrypt.pqcSeal: bad recipient public key base64 ({e})") from e
        pt = str(plaintext).encode("utf-8")
        with oqs_mod.KeyEncapsulation(alg) as kem:
            kem_ct, ss = kem.encap_secret(pk_raw)
        key = _pqc_derive_aes_key(ss, alg)
        nonce = secrets.token_bytes(12)
        aes = AESGCM(key)
        aad = _pqc_gcm_aad(alg, kem_ct)
        body_ct = aes.encrypt(nonce, pt, aad)
        return _pqc_pack_seal(alg, kem_ct, nonce, body_ct)

    def lib_encrypt_pqc_open(self, algorithm, recipient_sk_b64, bundle_b64):
        from cryptography.exceptions import InvalidTag

        AESGCM, _, _ = _pqc_require_crypto_aes()
        oqs_mod = _pqc_require_oqs()
        parts = _pqc_unpack_seal(bundle_b64)
        alg_requested = str(algorithm).strip()
        if alg_requested != parts["alg"]:
            raise Exception(
                "encrypt.pqcOpen: algorithm name does not match bundle "
                f"(requested {alg_requested!r}, bundle has {parts['alg']!r})"
            )
        kem_ct = parts["kem_ct"]
        try:
            sk_raw = base64.b64decode(str(recipient_sk_b64).strip(), validate=True)
        except Exception as e:
            raise Exception(f"encrypt.pqcOpen: bad secret key base64 ({e})") from e
        with oqs_mod.KeyEncapsulation(parts["alg"], sk_raw) as kem:
            ss = kem.decap_secret(kem_ct)
        key = _pqc_derive_aes_key(ss, parts["alg"])
        aes = AESGCM(key)
        aad = _pqc_gcm_aad(parts["alg"], kem_ct)
        try:
            pt = aes.decrypt(parts["nonce"], parts["body_ct"], aad)
        except InvalidTag as e:
            raise Exception(
                "encrypt.pqcOpen: AES-GCM authentication failed "
                "(wrong key, algorithm, or tampering)"
            ) from e
        try:
            return pt.decode("utf-8")
        except UnicodeDecodeError as e:
            raise Exception("encrypt.pqcOpen: plaintext is not valid UTF-8") from e

    def lib_encrypt_pqc_sign_keypair(self, algorithm):
        oqs_mod = _pqc_require_oqs()
        alg = str(algorithm).strip()
        with oqs_mod.Signature(alg) as sig:
            pk = sig.generate_keypair()
            sk = sig.export_secret_key()
        return [
            base64.b64encode(pk).decode("ascii"),
            base64.b64encode(sk).decode("ascii"),
        ]

    def lib_encrypt_pqc_sign(self, algorithm, secret_key_b64, message):
        oqs_mod = _pqc_require_oqs()
        alg = str(algorithm).strip()
        msg = str(message).encode("utf-8") if message is not None else b""
        try:
            sk_raw = base64.b64decode(str(secret_key_b64).strip(), validate=True)
        except Exception as e:
            raise Exception(f"encrypt.pqcSign: bad secret key base64 ({e})") from e
        with oqs_mod.Signature(alg, sk_raw) as sig:
            signature = sig.sign(msg)
        return base64.b64encode(signature).decode("ascii")

    def lib_encrypt_pqc_verify(self, algorithm, public_key_b64, message, signature_b64):
        oqs_mod = _pqc_require_oqs()
        alg = str(algorithm).strip()
        msg = str(message).encode("utf-8") if message is not None else b""
        try:
            pk_raw = base64.b64decode(str(public_key_b64).strip(), validate=True)
            sig_raw = base64.b64decode(str(signature_b64).strip(), validate=True)
        except Exception:
            return 0
        try:
            with oqs_mod.Signature(alg) as ver:
                ok = ver.verify(msg, sig_raw, pk_raw)
        except Exception:
            return 0
        return 1 if ok else 0

    def lib_create_list(self, items, name_token):
        evaluated=[self.evaluate(i) for i in items]
        name=name_token if isinstance(name_token,str) else name_token.v
        self._scope_assign(name, evaluated)
        return evaluated
    def lib_list_get(self,index,list_var):
        idx=int(index)
        if idx < 0 or idx >= len(list_var):
            raise SPLException("IndexOutOfRangeError", f"list index {idx} for length {len(list_var)}")
        return list_var[idx]
    def lib_list_remove(self,element,list_var):
        if element in list_var: list_var.remove(element)
    def lib_list_remove_all(self,element,list_var):
        while element in list_var: list_var.remove(element)
    def lib_list_change(self,index,new_value,list_var):
        idx = int(index)
        if idx < 0 or idx >= len(list_var):
            raise SPLException("IndexOutOfRangeError", f"list index {idx} for length {len(list_var)}")
        list_var[idx] = new_value
    def lib_list_deep_copy(self,list_var,new_name_token):
        new_list=copy.deepcopy(list_var)
        name=new_name_token if isinstance(new_name_token,str) else new_name_token.v
        self._scope_assign(name, new_list)
        return new_list
    def lib_list_append(self,item,list_var): list_var.append(item); return list_var
    def lib_list_contains(self, item, list_var):
        if not isinstance(list_var, list):
            raise Exception("list.contains expects (item, list)")
        return 1 if item in list_var else 0

    @staticmethod
    def _spl_is_prime_gt_one_million(n):
        if isinstance(n, bool) or not isinstance(n, (int, float)):
            return False
        if isinstance(n, float):
            if not n.is_integer():
                return False
            n = int(n)
        else:
            n = int(n)
        if n <= 1_000_000:
            return False
        if n % 2 == 0:
            return n == 2
        d = 3
        while d * d <= n:
            if n % d == 0:
                return False
            d += 2
        return True

    def lib_list_return_thursday_fourth_and_second_index_iff_fifth_prime(
        self, list_var
    ):
        """
        Return [element at index 2, fourth element at index 3] iff today is Thursday
        and list[4] exists and is prime > 1_000_000; else null.
        """
        if not isinstance(list_var, list):
            raise Exception(
                "list.returnTheFourthElementIfItExistsAndTheElementAtTheSecondIndex"
                "IfItExistsIfAndOnlyIfTheTodayIsAThursdayAndTheValueOfTheFifthElement"
                "IfItExistsIsAPrimeNumberrGreaterThanOneMillion expects a list"
            )
        from datetime import date

        if date.today().weekday() != 3:
            return None
        if len(list_var) <= 4:
            return None
        fifth = list_var[4]
        if not self._spl_is_prime_gt_one_million(fifth):
            return None
        out = []
        if len(list_var) > 2:
            out.append(list_var[2])
        if len(list_var) > 3:
            out.append(list_var[3])
        return out if out else None

    def _spl_truthy_reverse(self, reverse_arg):
        """SPL booleans are 0/1; accept int/float/bool."""
        if isinstance(reverse_arg, bool):
            return reverse_arg
        if isinstance(reverse_arg, (int, float)):
            return int(reverse_arg) != 0
        return bool(reverse_arg)

    def lib_list_sort(self, list_var, key_name, reverse_arg):
        """In-place sort. key: alpha, numeric, ascii, utf-8, utf-16, utf-32. reverse: truthy = descending."""
        if not isinstance(list_var, list):
            raise Exception("list.sort expects a list as first argument")
        raw = str(key_name).strip().lower().replace("_", "-")
        key_aliases = {
            "alpha": "alpha",
            "numeric": "numeric",
            "ascii": "ascii",
            "utf-8": "utf-8",
            "utf8": "utf-8",
            "utf-16": "utf-16",
            "utf16": "utf-16",
            "utf-32": "utf-32",
            "utf32": "utf-32",
        }
        if raw not in key_aliases:
            raise Exception(
                "list.sort key must be one of: alpha, numeric, ascii, utf-8, utf-16, utf-32; "
                f"got {key_name!r}"
            )
        mode = key_aliases[raw]
        rev = self._spl_truthy_reverse(reverse_arg)

        def key_fn(x):
            if mode == "alpha":
                return str(x)
            if mode == "numeric":
                return float(x)
            if mode == "ascii":
                return tuple(map(ord, str(x)))
            s = str(x)
            if mode == "utf-8":
                return s.encode("utf-8")
            if mode == "utf-16":
                return s.encode("utf-16-le")
            if mode == "utf-32":
                return s.encode("utf-32-le")
            raise RuntimeError("lib_list_sort: internal unknown mode")

        try:
            list_var.sort(key=key_fn, reverse=rev)
        except (TypeError, ValueError) as e:
            raise Exception(f"list.sort failed: {e}") from e
        return list_var

    def _function_ref(self, arg_expr, line):
        """Build SPLFunctionRef: identifier is the function name; other expressions must evaluate to a string name."""
        if isinstance(arg_expr, Token) and arg_expr.t == "ID":
            name = arg_expr.v
        else:
            name = self.evaluate(arg_expr)
            if not isinstance(name, str):
                raise Exception(
                    f"[Line {line}] function.ref expects a function name (identifier or string), "
                    f"got {type(name).__name__}"
                )
        return SPLFunctionRef(name)

    @staticmethod
    def _param_name(p):
        return p.v if hasattr(p, "v") else str(p)

    @staticmethod
    def _arity_bounds(params):
        n_all = len(params)
        n_req = 0
        for p in params:
            if getattr(p, "default", None) is None:
                n_req += 1
        return n_req, n_all

    def _arity_error(self, kind, name, n_req, n_all, n_got, line):
        if n_req == n_all:
            msg = f"{kind}.{name} expects {n_all} args, got {n_got}"
        elif n_req == 0:
            msg = f"{kind}.{name} expects at most {n_all} args, got {n_got}"
        else:
            msg = f"{kind}.{name} expects {n_req} to {n_all} args, got {n_got}"
        raise Exception(f"[Line {line}] {msg}")

    def _push_param_scope(self, params, arg_vals, line, kind, name, extra=None):
        """Push a call frame, bind provided args, then evaluate omitted defaults left-to-right."""
        n_req, n_all = self._arity_bounds(params)
        n_got = len(arg_vals)
        if n_got < n_req or n_got > n_all:
            self._arity_error(kind, name, n_req, n_all, n_got, line)
        frame = dict(extra or {})
        self._scopes.append(frame)
        for i, p in enumerate(params):
            pname = self._param_name(p)
            if i < n_got:
                frame[pname] = arg_vals[i]
            else:
                frame[pname] = self.evaluate(p.default)

    def _invoke_user_function(self, fn_name, arg_vals, line):
        """Run a user-defined function body; returns the value from return.* or None."""
        if fn_name not in self.funcs:
            raise Exception(f"[Line {line}] Error: Undefined Function: {fn_name}")
        params, body = self.funcs[fn_name]
        self._push_param_scope(params, arg_vals, line, "function", fn_name)
        old_if = self.if_stack
        self.if_stack = []
        self._function_run_depth += 1
        self._push_call_frame({"kind": "function", "name": fn_name, "line": line})
        try:
            try:
                for sub in body:
                    try:
                        self.run(sub, True)
                    except BreakSignal:
                        raise Exception("Error: test.break used outside of a loop")
                    except ContinueSignal:
                        raise Exception("Error: test.continue used outside of a loop")
            except ReturnSignal as rs:
                return rs.value
            except SPLException as e:
                raise self._attach_trace(e)
            return None
        finally:
            self._pop_call_frame()
            self._function_run_depth -= 1
            self.if_stack = old_if
            self._scope_pop()

    def _spl_inst_uses_alltypes_return_method(self, inst: SPLInstance) -> bool:
        """True if inst's return method is the same (params, body) as class AllTypes."""
        at = self.classes.get("AllTypes")
        if not at:
            return False
        ref = at.methods.get("return")
        if not ref:
            return False
        m = inst.cls.method_lookup("return")
        return m is not None and m is ref

    def _field_visibility_for(self, cls: SPLClass, name: str) -> str:
        vis = cls.field_visibility.get(name)
        if vis:
            return vis
        if cls.parent:
            return self._field_visibility_for(cls.parent, name)
        return "private"

    def _instance_get_field(
        self, inst: SPLInstance, field_name: str, line, allow_private: bool
    ):
        vis = self._field_visibility_for(inst.cls, field_name)
        if vis == "private" and not allow_private:
            raise Exception(f"[Line {line}] private field {field_name!r}")
        if field_name in inst.fields:
            return inst.fields[field_name]
        if field_name in inst.cls.field_defaults:
            return inst.cls.field_defaults[field_name]
        raise Exception(f"[Line {line}] unknown field {field_name!r} on instance")

    def _dispatch_instance_member(self, node: MethodCallNode, as_statement: bool = False):
        """Instance method call or field read; _DISPATCH_SKIP if not applicable."""
        if node.obj in self.library or node.obj == "method":
            return _DISPATCH_SKIP
        if node.method in ("setVar", "public", "private"):
            return _DISPATCH_SKIP
        if node.obj == "this":
            if not self._instance_this_stack:
                raise Exception(f"[Line {node.line}] this.{node.method} outside of class")
            inst = self._instance_this_stack[-1]
        else:
            try:
                val = self._scope_get(node.obj, node.line)
            except SPLException:
                return _DISPATCH_SKIP
            if hasattr(val, "call_method") and callable(getattr(val, "call_method", None)):
                arg_vals = [self.evaluate(a) for a in (node.arg or [])]
                return val.call_method(node.method, arg_vals, node.line)
            if isinstance(val, list):
                fn = self._list_methods.get(node.method)
                if fn is not None:
                    arg_vals = [self.evaluate(a) for a in (node.arg or [])]
                    return fn(val, arg_vals, node.line)
            if not isinstance(val, SPLInstance):
                return _DISPATCH_SKIP
            inst = val
        arg_vals = [self.evaluate(a) for a in (node.arg or [])]
        m = inst.cls.method_lookup(node.method)
        if m is not None:
            return self._invoke_instance_method(
                inst, node.method, arg_vals, node.line, as_statement
            )
        if len(arg_vals) == 0:
            allow_private = node.obj == "this" or (
                self._instance_this_stack and self._instance_this_stack[-1] is inst
            )
            return self._instance_get_field(inst, node.method, node.line, allow_private)
        raise Exception(
            f"[Line {node.line}] No method {node.method!r} on class {inst.cls.name!r}"
        )

    def _instantiate_class(self, var_name: str, class_name: str, line):
        cls = self.classes.get(class_name)
        if cls is None:
            raise Exception(f"[Line {line}] No class named {class_name!r}")
        inst = SPLInstance(cls)
        for fn, fv in cls.field_defaults.items():
            inst.fields[fn] = copy.deepcopy(fv)
        self._instance_this_stack.append(inst)
        self._scope_push_bindings({"this": inst})
        try:
            if cls.constructor_body:
                for sub in cls.constructor_body:
                    self.run(sub, False)
        finally:
            self._scope_pop()
            self._instance_this_stack.pop()
        self._scope_assign(var_name, inst)
        return inst

    def _invoke_instance_method(
        self,
        inst: SPLInstance,
        method_name: str,
        arg_vals,
        line,
        as_statement: bool = False,
    ):
        m = inst.cls.method_lookup(method_name)
        if not m:
            raise Exception(
                f"[Line {line}] No method {method_name!r} on class {inst.cls.name!r}"
            )
        params, body = m
        self._push_param_scope(
            params, arg_vals, line, "method", method_name, extra={"this": inst}
        )
        self._instance_this_stack.append(inst)
        old_if = self.if_stack
        self.if_stack = []
        self._push_call_frame(
            {
                "kind": "method",
                "name": method_name,
                "class": inst.cls.name,
                "line": line,
            }
        )
        try:
            try:
                for sub in body:
                    try:
                        self.run(sub, as_statement)
                    except BreakSignal:
                        raise Exception("Error: test.break used outside of a loop")
                    except ContinueSignal:
                        raise Exception("Error: test.continue used outside of a loop")
            except ReturnSignal as rs:
                if (
                    as_statement
                    and method_name == "return"
                    and self._spl_inst_uses_alltypes_return_method(inst)
                ):
                    raise rs
                return rs.value
            except SPLException as e:
                raise self._attach_trace(e)
            return None
        finally:
            self._pop_call_frame()
            self.if_stack = old_if
            self._scope_pop()
            self._instance_this_stack.pop()

    def _coerce_name_literal(self, expr, line):
        if isinstance(expr, Token) and expr.t == "ID":
            return expr.v
        if isinstance(expr, Token) and expr.t == "STRING":
            return expr.v
        v = self.evaluate(expr)
        if not isinstance(v, str):
            raise Exception(
                f"[Line {line}] expected identifier or string name, got {type(v).__name__}"
            )
        return v

    def _path_is_under(self, path: str, base_real: str) -> bool:
        path = os.path.realpath(path)
        base_real = os.path.realpath(base_real)
        return path == base_real or path.startswith(base_real + os.sep)

    def _try_resolve_import_beside_current_spl(self, module_name, line):
        """If an SPL file is executing, try a file/folder in the same directory before lib/."""
        if not self._spl_file_stack:
            return None
        if not module_name or module_name.strip() != module_name:
            return None
        if ".." in module_name or module_name.startswith(("/", "\\")):
            return None
        base_dir = os.path.dirname(self._spl_file_stack[-1])
        base_real = os.path.realpath(base_dir)
        if "." in module_name:
            cand = os.path.realpath(os.path.join(base_dir, module_name))
            if not self._path_is_under(cand, base_real):
                raise Exception(f"[Line {line}] import path escapes directory")
            ext = os.path.splitext(module_name)[1].lower()
            if os.path.isfile(cand) and ext in _LIBRARY_FILE_EXTS:
                return cand, ext
            if ".." in module_name.split("."):
                return None
            nested = os.path.realpath(os.path.join(base_dir, module_name.replace(".", os.sep)))
            if not self._path_is_under(nested, base_real):
                return None
            if os.path.isdir(nested) and _iter_library_package_files(nested):
                return nested, _LIBRARY_PACKAGE_EXT
            found = []
            for file_ext, allow_fn in _extensionless_allowers():
                path = nested + file_ext
                if os.path.isfile(path) and allow_fn(path):
                    found.append((path, file_ext))
            if len(found) == 1:
                return found[0]
            return None
        pkg_path = os.path.realpath(os.path.join(base_dir, module_name))
        pkg_candidate = None
        if self._path_is_under(pkg_path, base_real) and os.path.isdir(pkg_path):
            if _iter_library_package_files(pkg_path):
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
            path = os.path.realpath(os.path.join(base_dir, rel))
            if not self._path_is_under(path, base_real):
                continue
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
                f"[Line {line}] Ambiguous use {module_name!r}: multiple libraries opt in ({kinds}); "
                f"use an explicit file extension in the use statement"
            )
        if len(candidates) == 1:
            ext, path = candidates[0]
            return path, ext
        return None

    def _resolve_library_import(self, module_name, line):
        """Resolve use/inherit: try same directory as the executing SPL file, then lib/."""
        local = self._try_resolve_import_beside_current_spl(module_name, line)
        if local is not None:
            return local
        return _resolve_library_import_lib(module_name, line)

    def _load_library_path(self, lib_path, ext, line):
        """Load one library file, or every loadable file in a library package folder."""
        if ext == _LIBRARY_PACKAGE_EXT:
            files = _iter_library_package_files(lib_path)
            if not files:
                raise Exception(f"[Line {line}] Library package is empty: {lib_path}")
            for path, file_ext in files:
                self._load_library_path(path, file_ext, line)
            return
        if ext == ".py":
            real = os.path.realpath(lib_path)
            # Path-stable module key so re-use / second Interpreter does not re-exec
            # (re-exec would create duplicate AST classes and break isinstance).
            mod_name = "spl_lib_" + re.sub(r"[^A-Za-z0-9_]", "_", real)
            pymod = sys.modules.get(mod_name)
            if pymod is None:
                spec = importlib.util.spec_from_file_location(mod_name, real)
                if spec is None or spec.loader is None:
                    raise Exception(f"[Line {line}] Cannot load Python library: {lib_path}")
                pymod = importlib.util.module_from_spec(spec)
                sys.modules[mod_name] = pymod
                try:
                    spec.loader.exec_module(pymod)
                except Exception:
                    sys.modules.pop(mod_name, None)
                    raise
            reg = getattr(pymod, "spl_register", None)
            if callable(reg):
                reg(self)
            return
        if ext in _NATIVE_SOURCE_EXTS:
            _register_native_c_library(self, lib_path, ext, line)
            return
        if ext == _NATIVE_JAVA_EXT:
            _load_java_library(self, lib_path, line)
            return
        self._exec_spl_file(lib_path, line)
        if os.path.splitext(os.path.basename(lib_path))[0] == "roast":
            self._roast_activate(line)

    def _is_uneval_calculus_func_arg(self, a):
        """True when calculus.* should receive an SPL function symbolically."""
        if isinstance(a, MethodCallNode) and a.obj == "function":
            return a.method in self.funcs
        return False

    def _wrap_calculus_func_arg(self, a):
        """Build SPLCalcFuncSpec for unevaluated function.name(...)."""
        return SPLCalcFuncSpec(a.method, list(a.arg or []))

    def _run_inherit(self, module_path: str, line):
        if not self._class_def_stack:
            raise Exception(f"[Line {line}] inherit only allowed inside classDefine")
        lib_path, ext = self._resolve_library_import(module_path, line)
        if ext != ".spl":
            raise Exception(f"[Line {line}] inherit expects a .spl file")
        classes_before = set(self.classes.keys())
        self._exec_spl_file(lib_path, line)
        classes_after = set(self.classes.keys())
        new_ones = classes_after - classes_before
        if not new_ones:
            raise Exception(f"[Line {line}] inherit: no new class defined in {module_path!r}")
        parent_name = sorted(new_ones)[-1]
        parent = self.classes[parent_name]
        self._class_def_stack[-1].merge_parent(parent)

    def _exec_spl_file(self, lib_path, line):
        lib_path = os.path.realpath(lib_path)
        self._spl_file_stack.append(lib_path)
        self._push_call_frame(
            {"kind": "module", "path": lib_path, "file": lib_path, "line": line}
        )
        try:
            with open(lib_path, encoding="utf-8") as f:
                src = f.read()
            for sub in Parser(tokenize(src)).parse():
                try:
                    self.run(sub)
                except BreakSignal:
                    raise Exception("Error: test.break used outside of a loop")
                except ContinueSignal:
                    raise Exception("Error: test.continue used outside of a loop")
                except SPLException as e:
                    raise self._attach_trace(e)
        finally:
            stem = os.path.splitext(os.path.basename(lib_path))[0]
            if stem == "regex":
                self._register_spl_namespace_library(
                    "regex", ("match", "search", "findAll", "replace", "split", "group", "groupNamed")
                )
            if stem == "roast":
                self._register_spl_namespace_library(
                    "roast",
                    (
                        "roll",
                        "randomBits",
                        "showDisclaimer",
                        "crashMessage",
                        "rejectMessage",
                        "afterRunLine",
                    ),
                )
                if not self._roast_disclaimer_done and "roast_showDisclaimer" in self.funcs:
                    self._invoke_user_function("roast_showDisclaimer", [], line)
                    self._roast_disclaimer_done = True
            self._pop_call_frame()
            self._spl_file_stack.pop()

    def _register_spl_namespace_library(self, namespace: str, methods: tuple):
        """Bind functionDefine.{namespace}_{method} into library[namespace][method]."""
        bucket = self.library.setdefault(namespace, {})
        for method in methods:
            fn_name = f"{namespace}_{method}"
            if fn_name not in self.funcs:
                raise Exception(
                    f"SPL library {namespace}.{method}: missing functionDefine.{fn_name}"
                )

            def _make_bound(fn):
                return lambda *args, _fn=fn: self._invoke_user_function(_fn, list(args), 0)

            bucket[method] = _make_bound(fn_name)

    def _roast_activate(self, line):
        """After use roast.spl, roll once: crash, halt program, or defer insult until finish."""
        if self._roast_mode is not None:
            return
        if "roast_roll" not in self.funcs:
            return
        mode = float(self._invoke_user_function("roast_roll", [], line))
        self._roast_mode = mode
        if mode == 0:
            msg = self._invoke_user_function("roast_crashMessage", [], line)
            raise Exception(str(msg))
        if mode == 2:
            msg = self._invoke_user_function("roast_rejectMessage", [], line)
            self._typed_print("string", [msg], line)
            self._roast_halt = True
            return
        self._roast_after_run = True

    def finish_roast(self):
        """Print deferred roast line when mode 1 (run + insult) completed."""
        if not self._roast_after_run:
            return
        if "roast_afterRunLine" not in self.funcs:
            self._roast_after_run = False
            return
        line = self._invoke_user_function("roast_afterRunLine", [], 0)
        self._typed_print("string", [line], 0)
        self._roast_after_run = False

    def lib_tuple_create(self, tup, name_token):
        if not isinstance(tup, tuple):
            raise Exception("tuple.createTuple expects a (a,b,...) tuple literal as the first argument")
        if isinstance(name_token, Token) and name_token.t == "ID":
            name = name_token.v
        elif isinstance(name_token, str):
            name = name_token
        else:
            raise Exception("tuple.createTuple second argument must be a variable name or string")
        self._scope_assign(name, tup)
        return tup

    def lib_tuple_get(self, index, tup):
        if not isinstance(tup, tuple):
            raise Exception("tuple.get expects a tuple value")
        idx = int(index)
        if idx < 0 or idx >= len(tup):
            raise SPLException("IndexOutOfRangeError", f"tuple index {idx} for length {len(tup)}")
        return tup[idx]

    def lib_set_create(self, raw, name_token):
        if isinstance(name_token, Token) and name_token.t == "ID":
            name = name_token.v
        elif isinstance(name_token, str):
            name = name_token
        else:
            raise Exception("set.createSet second argument must be a variable name or string")
        if isinstance(raw, SPLSet):
            s = SPLSet(raw._items)
        elif isinstance(raw, (list, tuple)):
            s = SPLSet(raw)
        elif isinstance(raw, dict) and len(raw) == 0:
            s = SPLSet()
        else:
            raise Exception(
                "set.createSet expects a {a,b,...} set literal, or [] list, or an existing SPL set"
            )
        self._scope_assign(name, s)
        return s

    def lib_set_append(self, item, s):
        if not isinstance(s, SPLSet):
            raise Exception("set.append expects a set value")
        s.append(item)
        return s

    def lib_set_remove(self, item, s):
        if not isinstance(s, SPLSet):
            raise Exception("set.remove expects a set value")
        s.remove_value(item)
        return s

    def lib_set_remove_by_index(self, index, s):
        if not isinstance(s, SPLSet):
            raise Exception("set.removeByIndex expects a set value")
        s.remove_index(index)
        return s

    def _eval_with_bound_var(self,var_name,var_value,expr):
        self._scope_push_bindings({var_name: var_value})
        try:
            return self.evaluate(expr)
        finally:
            self._scope_pop()

    def _extract_list_binding(self,binding_expr,expected_marker):
        if not isinstance(binding_expr,MethodCallNode):
            raise Exception("list.convert* first argument must be like x.setVar(list.iterable) or x.setVar(list.iterate)")
        if binding_expr.method!="setVar" or not binding_expr.arg or len(binding_expr.arg)!=1:
            raise Exception("list.convert* first argument must be a setVar call")
        marker_expr=binding_expr.arg[0]
        if not isinstance(marker_expr,MethodCallNode) or marker_expr.obj!="list":
            raise Exception("list.convert* binding must assign list.iterable or list.iterate")
        if marker_expr.method!=expected_marker:
            raise Exception(f"Expected list.{expected_marker} in binding, got list.{marker_expr.method}")
        return binding_expr.obj

    def _list_convert(self,var_name,fn_expr,list_var):
        if not isinstance(list_var,list):
            raise Exception("list.convert expects a list argument")
        for i,item in enumerate(list_var):
            list_var[i]=self._eval_with_bound_var(var_name,item,fn_expr)
        return list_var

    def _list_convert_if(self,var_name,fn_expr,cond_expr,list_var,should_convert_when_true,use_index=False):
        if not isinstance(list_var,list):
            raise Exception("list.convertIf* expects a list argument")
        for i,item in enumerate(list_var):
            bound_value=i if use_index else item
            cond=self._eval_with_bound_var(var_name,bound_value,cond_expr)
            cond_true=(cond!=0)
            if cond_true==should_convert_when_true:
                list_var[i]=self._eval_with_bound_var(var_name,bound_value,fn_expr)
        return list_var

    def _typed_print(self,method,arg_vals,line):
        if not arg_vals:
            raise Exception(f"[Line {line}] print.{method} requires an argument")
        val=arg_vals[0]
        if method=="string":
            if not isinstance(val,str):
                raise Exception(f"[Line {line}] print.string expected str, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="number":
            if not isinstance(val,(int,float)) or isinstance(val,bool):
                raise Exception(f"[Line {line}] print.number expected int or float, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="boolean":
            if val not in (0,1):
                raise Exception(f"[Line {line}] print.boolean expected 0 or 1, got {val!r}")
            print(int(val))
            return None
        if method=="list":
            if not isinstance(val,list):
                raise Exception(f"[Line {line}] print.list expected list, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="hash":
            if not isinstance(val,dict):
                raise Exception(f"[Line {line}] print.hash expected dict, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="tuple":
            if not isinstance(val,tuple):
                raise Exception(f"[Line {line}] print.tuple expected tuple, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="set":
            if not isinstance(val,SPLSet):
                raise Exception(f"[Line {line}] print.set expected set, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="functionRef":
            if not isinstance(val, SPLFunctionRef):
                raise Exception(f"[Line {line}] print.functionRef expected function ref, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="instance":
            if not isinstance(val, SPLInstance):
                raise Exception(f"[Line {line}] print.instance expected instance, got {type(val).__name__}: {val!r}")
            print(f"<instance {val.cls.name}>")
            return None
        if method=="class":
            if not isinstance(val, SPLClass):
                raise Exception(f"[Line {line}] print.class expected class, got {type(val).__name__}: {val!r}")
            print(f"<class {val.name}>")
            return None
        if method=="stack":
            if not isinstance(val, SPLStack):
                raise Exception(f"[Line {line}] print.stack expected stack, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="queue":
            if not isinstance(val, SPLQueue):
                raise Exception(f"[Line {line}] print.queue expected queue, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="deque":
            if not isinstance(val, SPLDeque):
                raise Exception(f"[Line {line}] print.deque expected deque, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="priorityQueue":
            if not isinstance(val, SPLPriorityQueue):
                raise Exception(f"[Line {line}] print.priorityQueue expected priority queue, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="linkedList":
            if not isinstance(val, SPLLinkedList):
                raise Exception(f"[Line {line}] print.linkedList expected linked list, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="heap":
            if not isinstance(val, SPLHeap):
                raise Exception(f"[Line {line}] print.heap expected heap, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="tree":
            if not isinstance(val, SPLBinaryTree):
                raise Exception(f"[Line {line}] print.tree expected tree, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        if method=="treeNode":
            if not isinstance(val, SPLTreeNode):
                raise Exception(f"[Line {line}] print.treeNode expected tree node, got {type(val).__name__}: {val!r}")
            print(val)
            return None
        raise Exception(f"[Line {line}] unknown print.{method}")

    def run(self, node, as_statement=None):
        if as_statement is None:
            as_statement = self._function_run_depth > 0
        if self._roast_halt and self._function_run_depth == 0:
            return None
        if isinstance(node,ImportNode):
            lib_path, ext = self._resolve_library_import(node.module, node.line)
            self._load_library_path(lib_path, ext, node.line)
            return None
        if isinstance(node, InheritNode):
            self._run_inherit(node.module, node.line)
            return None
        if isinstance(node, ThisAssignNode):
            if not self._instance_this_stack:
                raise Exception(
                    f"[Line {node.line}] this.{node.field} = ... only allowed inside constructorDefine or methodDefine (no active this)"
                )
            inst = self._instance_this_stack[-1]
            inst.fields[node.field] = self.evaluate(node.expr)
            return None
        if isinstance(node, SliceAssignNode):
            cur = self._scope_get(node.name, node.line)
            if not isinstance(cur, str):
                raise Exception(
                    f"[Line {node.line}] [{node.name}] <- sl(...): variable must currently hold a string"
                )
            lo_e = self.evaluate(node.lo)
            hi_e = self.evaluate(node.hi)
            sliced = _spl_string_slice(lo_e, hi_e, cur, node.line)
            if sliced is None:
                raise Exception(f"[Line {node.line}] [{node.name}] <- sl(...): slice failed")
            self._scope_assign(node.name, sliced)
            return None
        if isinstance(node, ExprStmtNode):
            self.evaluate(node.expr)
            return None
        if isinstance(node, TryExceptNode):
            self._scope_push_empty()
            try:
                try:
                    for sub in node.try_body:
                        self.run(sub, as_statement)
                except ReturnSignal:
                    raise
                except BreakSignal:
                    raise
                except ContinueSignal:
                    raise
                except SPLException as e:
                    for handler_args, handler_body in node.handlers:
                        if not handler_args:
                            raise Exception(
                                f"[Line {node.line}] error.except requires an error type, e.g. error.DivisionByZeroError or \"DivisionByZeroError\""
                            )
                        want = self.evaluate(handler_args[0])
                        if _spl_except_kind_matches(want, e.kind):
                            self._scope_push_empty()
                            try:
                                for sub in handler_body:
                                    self.run(sub, as_statement)
                            finally:
                                self._scope_pop()
                            return None
                    raise e
                return None
            finally:
                self._scope_pop()
        if isinstance(node,BlockNode):
            if node.obj == "classDefine":
                name = node.method
                cls = SPLClass(name)
                self._class_def_stack.append(cls)
                try:
                    for sub in node.body:
                        self.run(sub, as_statement)
                finally:
                    self._class_def_stack.pop()
                self.classes[name] = cls
                return None
            if node.obj == "errorDefine":
                ename = node.method
                self.library["error"][ename] = (lambda nm=ename: (lambda: SPLErrorType(nm)))()
                self._scopes[0][ename] = SPLErrorType(ename)
                for sub in node.body:
                    self.run(sub, as_statement)
                return None
            if node.obj == "methodDefine":
                if not self._class_def_stack:
                    raise Exception(
                        f"[Line {node.line}] methodDefine.{node.method} only allowed inside classDefine"
                    )
                cls = self._class_def_stack[-1]
                params = []
                for p in node.args:
                    if isinstance(p, Token) and p.t == "ID":
                        params.append(p)
                    elif isinstance(p, FuncParam):
                        params.append(p)
                    else:
                        raise Exception(
                            f"[Line {node.line}] methodDefine parameters must be identifiers or default.NAME.setVar(value)"
                        )
                cls.methods[node.method] = (params, node.body)
                return None
            if node.obj == "constructorDefine":
                if not self._class_def_stack:
                    raise Exception(
                        f"[Line {node.line}] constructorDefine only allowed inside classDefine"
                    )
                self._class_def_stack[-1].constructor_body = node.body
                return None
            if node.obj == "keymapDefine" and node.method == "keymap":
                if not self._class_def_stack:
                    raise Exception(
                        f"[Line {node.line}] keymapDefine.keymap only allowed inside classDefine"
                    )
                if len(node.body) != 1:
                    raise Exception(
                        f"[Line {node.line}] keymapDefine.keymap expects a single {{ ... }} statement"
                    )
                stmt = node.body[0]
                if not isinstance(stmt, ExprStmtNode):
                    raise Exception(
                        f"[Line {node.line}] keymapDefine.keymap body must be a hash literal {{ ... }}"
                    )
                expr = stmt.expr
                if not isinstance(expr, HashLiteralNode):
                    raise Exception(
                        f"[Line {node.line}] keymapDefine.keymap body must be a hash literal {{ ... }}"
                    )
                pairs = []
                for k_expr, v_expr in expr.pairs:
                    k = self.evaluate(k_expr)
                    if not isinstance(k, str) or len(k) != 1:
                        raise Exception(
                            f"[Line {expr.line}] keymap key must be a single-character string, got {k!r}"
                        )
                    pairs.append((k, v_expr))
                self._class_def_stack[-1].keymap_entries = pairs
                return None
            if node.obj=="functionDefine":
                params = []
                for p in node.args:
                    if isinstance(p, Token) and p.t == "ID":
                        params.append(p)
                    elif isinstance(p, FuncParam):
                        params.append(p)
                    else:
                        raise Exception(
                            f"[Line {node.line}] functionDefine parameters must be identifiers or default.NAME.setVar(value)"
                        )
                self.funcs[node.method] = (params, node.body)
                return None
            if node.obj == "async" and node.method == "do":
                run_async_do_block(self, node.body, node.line)
                return None
            if node.obj=="test":
                m=_TEST_BRANCH_ALIASES.get(node.method,node.method)
                if m=="forLoop":
                    if len(node.args)<3:
                        raise Exception(f"[Line {node.line}] test.forLoop requires (start, end, varName)")
                    if try_run_forloop_jit(self, node):
                        return None
                    start=self.evaluate(node.args[0])
                    end=self.evaluate(node.args[1])
                    vt=node.args[2]
                    if not isinstance(vt,Token) or vt.t!="ID":
                        raise Exception(f"[Line {node.line}] test.forLoop third argument must be a variable name")
                    name=vt.v
                    cur=float(start)
                    endv=float(end)
                    iter_guard=0
                    self._scope_push_empty()
                    try:
                        while cur<=endv+1e-12:
                            if iter_guard>=_MAX_LOOP_ITERATIONS:
                                raise Exception(f"[Line {node.line}] test.forLoop exceeded maximum iterations ({_MAX_LOOP_ITERATIONS})")
                            iter_guard+=1
                            self._scope_assign(name, cur)
                            for sub in node.body:
                                try:
                                    self.run(sub, as_statement)
                                except ContinueSignal:
                                    break
                                except BreakSignal:
                                    return None
                            cur+=1.0
                        return None
                    finally:
                        self._scope_pop()
                if m=="while":
                    if not node.args:
                        raise Exception(f"[Line {node.line}] test.while requires a condition")
                    if try_run_while_jit(self, node):
                        return None
                    iter_guard=0
                    self._scope_push_empty()
                    try:
                        while True:
                            cond=self.evaluate(node.args[0])
                            if cond!=1:
                                break
                            if iter_guard>=_MAX_LOOP_ITERATIONS:
                                raise Exception(f"[Line {node.line}] test.while exceeded maximum iterations ({_MAX_LOOP_ITERATIONS})")
                            iter_guard+=1
                            for sub in node.body:
                                try:
                                    self.run(sub, as_statement)
                                except ContinueSignal:
                                    break
                                except BreakSignal:
                                    return None
                        return None
                    finally:
                        self._scope_pop()
                if m=="ifTrue":
                    cond=self.evaluate(node.args[0]) if node.args else 0
                    executed=False
                    if cond==1:
                        executed=True
                        self._scope_push_empty()
                        try:
                            for sub in node.body:
                                self.run(sub, as_statement)
                        finally:
                            self._scope_pop()
                    self.if_stack.append(executed)
                    return cond
                if m=="ifFalse":
                    cond=self.evaluate(node.args[0]) if node.args else 0
                    executed=False
                    if cond==0:
                        executed=True
                        self._scope_push_empty()
                        try:
                            for sub in node.body:
                                self.run(sub, as_statement)
                        finally:
                            self._scope_pop()
                    self.if_stack.append(executed)
                    return cond
                if m in ["elseIfTrue","elseIfFalse"]:
                    if not self.if_stack: return 0
                    if self.if_stack[-1]: return 0
                    cond=self.evaluate(node.args[0]) if node.args else 0
                    should_execute=(m=="elseIfTrue" and cond==1) or (m=="elseIfFalse" and cond==0)
                    if should_execute:
                        self.if_stack[-1]=True
                        self._scope_push_empty()
                        try:
                            for sub in node.body:
                                self.run(sub, as_statement)
                        finally:
                            self._scope_pop()
                    return cond if should_execute else 0
                if m=="else":
                    if not self.if_stack: return 0
                    if not self.if_stack[-1]:
                        self._scope_push_empty()
                        try:
                            for sub in node.body:
                                self.run(sub, as_statement)
                        finally:
                            self._scope_pop()
                    self.if_stack.pop()
                    return 1
            if node.obj=="random":
                if node.method=="run":
                    if not node.args:
                        raise Exception(f"[Line {node.line}] random.run requires a probability in [0,1]")
                    p = float(self.evaluate(node.args[0]))
                    if p < 0 or p > 1:
                        raise Exception(f"[Line {node.line}] random.run probability must be between 0 and 1, got {p!r}")
                    if random.random() < p:
                        self._scope_push_empty()
                        try:
                            for sub in node.body:
                                self.run(sub, as_statement)
                        finally:
                            self._scope_pop()
                    return None
            if node.obj == "error":
                raise Exception(
                    f"[Line {node.line}] error.try(): ... end; must be paired with error.except(error.ErrorType): ... end; (adjacent statements)."
                )

        if isinstance(node,MethodCallNode):
            if node.obj=="test" and node.method in ("break","Break"):
                raise BreakSignal()
            if node.obj=="test" and node.method in ("continue","Continue"):
                raise ContinueSignal()
            if node.obj == "test" and node.method == "pass":
                return None
            if node.obj == "keymap" and node.method == "createKeyMap":
                return self._keymap_create_keymap(node, node.line)
            if node.obj == "string" and node.method == "sorted":
                return self._string_sorted(node, node.line)
            try:
                km_obj = self._scope_get(node.obj, node.line)
            except SPLException:
                km_obj = None
            else:
                if isinstance(km_obj, SPLKeyMap):
                    if node.method == "curr":
                        if node.arg:
                            raise Exception(
                                f"[Line {node.line}] keymap.curr takes no arguments (use hash.getValue(k, keymap.curr))"
                            )
                        return km_obj.curr
                    raise Exception(
                        f"[Line {node.line}] SPLKeyMap only exposes .curr for hash.getValue (no .{node.method})"
                    )
            if node.obj=="list" and node.method=="convert":
                if not node.arg or len(node.arg)!=3:
                    raise Exception(f"[Line {node.line}] list.convert requires (var.setVar(list.iterable), function, list_var)")
                var_name=self._extract_list_binding(node.arg[0],"iterable")
                fn_expr=node.arg[1]
                target_list=self.evaluate(node.arg[2])
                return self._list_convert(var_name,fn_expr,target_list)
            if node.obj=="list" and node.method=="convertIfTrue":
                if not node.arg or len(node.arg)!=4:
                    raise Exception(f"[Line {node.line}] list.convertIfTrue requires (var.setVar(list.iterable), function, condition, list_var)")
                var_name=self._extract_list_binding(node.arg[0],"iterable")
                fn_expr=node.arg[1]
                cond_expr=node.arg[2]
                target_list=self.evaluate(node.arg[3])
                return self._list_convert_if(var_name,fn_expr,cond_expr,target_list,True,use_index=False)
            if node.obj=="list" and node.method=="convertIfFalse":
                if not node.arg or len(node.arg)!=4:
                    raise Exception(f"[Line {node.line}] list.convertIfFalse requires (var.setVar(list.iterable), function, condition, list_var)")
                var_name=self._extract_list_binding(node.arg[0],"iterable")
                fn_expr=node.arg[1]
                cond_expr=node.arg[2]
                target_list=self.evaluate(node.arg[3])
                return self._list_convert_if(var_name,fn_expr,cond_expr,target_list,False,use_index=False)
            if node.obj=="list" and node.method=="convertIfTrueIndex":
                if not node.arg or len(node.arg)!=4:
                    raise Exception(f"[Line {node.line}] list.convertIfTrueIndex requires (var.setVar(list.iterate), function, condition, list_var)")
                var_name=self._extract_list_binding(node.arg[0],"iterate")
                fn_expr=node.arg[1]
                cond_expr=node.arg[2]
                target_list=self.evaluate(node.arg[3])
                return self._list_convert_if(var_name,fn_expr,cond_expr,target_list,True,use_index=True)
            if node.obj=="list" and node.method=="convertIfFalseIndex":
                if not node.arg or len(node.arg)!=4:
                    raise Exception(f"[Line {node.line}] list.convertIfFalseIndex requires (var.setVar(list.iterate), function, condition, list_var)")
                var_name=self._extract_list_binding(node.arg[0],"iterate")
                fn_expr=node.arg[1]
                cond_expr=node.arg[2]
                target_list=self.evaluate(node.arg[3])
                return self._list_convert_if(var_name,fn_expr,cond_expr,target_list,False,use_index=True)
            if node.obj=="hash" and node.method=="createHashTable":
                if not node.arg or len(node.arg)!=2:
                    raise Exception(f"[Line {node.line}] hash.createHashTable requires ({{key:value pairs}}, name)")
                hash_val=self.evaluate(node.arg[0])
                if not isinstance(hash_val,dict):
                    raise Exception(f"[Line {node.line}] First argument to hash.createHashTable must be a hash literal")
                name_arg=node.arg[1]
                if isinstance(name_arg,Token) and name_arg.t=="ID":
                    name=name_arg.v
                else:
                    name=self.evaluate(name_arg)
                if not isinstance(name,str):
                    raise Exception(f"[Line {node.line}] hash.createHashTable name must be a variable identifier or string")
                self._scope_assign(name, hash_val)
                return hash_val
            if node.obj == "enum" and node.method == "createEnum":
                if not node.arg or len(node.arg) != 2:
                    raise Exception(
                        f"[Line {node.line}] enum.createEnum requires ({{name: value, ...}}, variableName)"
                    )
                mapping = self.evaluate(node.arg[0])
                name_arg = node.arg[1]
                if isinstance(name_arg, Token) and name_arg.t == "ID":
                    return self._enum_create_enum(mapping, name_arg)
                raise Exception(
                    f"[Line {node.line}] enum.createEnum second argument must be a variable identifier"
                )
            if node.obj == "tuple" and node.method == "createTuple":
                if not node.arg or len(node.arg) != 2:
                    raise Exception(
                        f"[Line {node.line}] tuple.createTuple requires ((tuple literal), variableName)"
                    )
                tup = self.evaluate(node.arg[0])
                name_arg = node.arg[1]
                if isinstance(name_arg, Token) and name_arg.t == "ID":
                    return self.lib_tuple_create(tup, name_arg)
                return self.lib_tuple_create(tup, self.evaluate(name_arg))
            if node.obj == "set" and node.method == "createSet":
                if not node.arg or len(node.arg) != 2:
                    raise Exception(
                        f"[Line {node.line}] set.createSet requires ({{set literal}} or list, variableName)"
                    )
                raw = self.evaluate(node.arg[0])
                name_arg = node.arg[1]
                if isinstance(name_arg, Token) and name_arg.t == "ID":
                    return self.lib_set_create(raw, name_arg)
                return self.lib_set_create(raw, self.evaluate(name_arg))
            if node.obj == "list" and node.method == "createList":
                if not node.arg or len(node.arg) != 2:
                    raise Exception(
                        f"[Line {node.line}] list.createList requires ([items], variableName)"
                    )
                items_val = self.evaluate(node.arg[0])
                if not isinstance(items_val, list):
                    raise Exception(
                        f"[Line {node.line}] list.createList first argument must be a list literal"
                    )
                name_arg = node.arg[1]
                if isinstance(name_arg, Token) and name_arg.t == "ID":
                    name = name_arg.v
                else:
                    name = self.evaluate(name_arg)
                    if not isinstance(name, str):
                        raise Exception(
                            f"[Line {node.line}] list.createList name must be an identifier or string"
                        )
                self._scope_assign(name, list(items_val))
                return self._scope_get(name, node.line)
            if node.obj == "stack" and node.method == "createStack":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] stack.createStack requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] stack.createStack name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLStack())
            if node.obj == "queue" and node.method == "createQueue":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] queue.createQueue requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] queue.createQueue name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLQueue())
            if node.obj == "deque" and node.method == "createDeque":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] deque.createDeque requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] deque.createDeque name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLDeque())
            if node.obj == "priorityQueue" and node.method == "createPriorityQueue":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] priorityQueue.createPriorityQueue requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] priorityQueue.createPriorityQueue name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLPriorityQueue())
            if node.obj == "linkedList" and node.method == "createLinkedList":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] linkedList.createLinkedList requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] linkedList.createLinkedList name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLLinkedList())
            if node.obj == "heap" and node.method in ("createHeap", "createMinHeap"):
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] heap.{node.method} requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] heap.{node.method} name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLHeap(min_heap=True))
            if node.obj == "heap" and node.method == "createMaxHeap":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] heap.createMaxHeap requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] heap.createMaxHeap name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLHeap(min_heap=False))
            if node.obj == "tree" and node.method == "createTree":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(
                        f"[Line {node.line}] tree.createTree requires (variableName)"
                    )
                name_arg = node.arg[0]
                if not isinstance(name_arg, Token) or name_arg.t != "ID":
                    raise Exception(
                        f"[Line {node.line}] tree.createTree name must be a variable identifier"
                    )
                return self._ds_bind_name(name_arg, SPLBinaryTree())
            if node.obj == "function" and node.method == "ref":
                if not node.arg or len(node.arg) != 1:
                    raise Exception(f"[Line {node.line}] function.ref expects one argument")
                return self._function_ref(node.arg[0], node.line)
            if node.obj == "function" and node.method == "call":
                if not node.arg:
                    raise Exception(
                        f"[Line {node.line}] function.call expects (ref, ...)"
                    )
                ref_val = self.evaluate(node.arg[0])
                if not isinstance(ref_val, SPLFunctionRef):
                    raise Exception(
                        f"[Line {node.line}] function.call first argument must be function.ref(...)"
                    )
                call_args = [self.evaluate(a) for a in node.arg[1:]]
                return self._invoke_user_function(ref_val.name, call_args, node.line)
            if node.obj == "class" and node.method == "createObj":
                if not node.arg or len(node.arg) != 2:
                    raise Exception(
                        f"[Line {node.line}] class.createObj requires (variableName, className)"
                    )
                vn = self._coerce_name_literal(node.arg[0], node.line)
                cn = self._coerce_name_literal(node.arg[1], node.line)
                return self._instantiate_class(vn, cn, node.line)
            if node.obj == "method":
                if not self._instance_this_stack:
                    raise Exception(
                        f"[Line {node.line}] method.{node.method} outside of instance method"
                    )
                inst = self._instance_this_stack[-1]
                arg_vals_m = [self.evaluate(a) for a in (node.arg or [])]
                return self._invoke_instance_method(
                    inst, node.method, arg_vals_m, node.line, as_statement
                )
            if node.method == "setVar" and self._class_def_stack:
                if not node.arg:
                    raise Exception(f"[Line {node.line}] {node.obj}.setVar requires a value")
                val = self.evaluate(node.arg[0])
                c = self._class_def_stack[-1]
                c.field_defaults[node.obj] = copy.deepcopy(val)
                c.field_visibility.setdefault(node.obj, "private")
                return val
            if node.method == "public" and self._class_def_stack:
                self._class_def_stack[-1].field_visibility[node.obj] = "public"
                return None
            if node.method == "private" and self._class_def_stack:
                self._class_def_stack[-1].field_visibility[node.obj] = "private"
                return None
            dispatched = self._dispatch_instance_member(node, as_statement)
            if dispatched is not _DISPATCH_SKIP:
                return dispatched
            if node.obj == "calculus" and node.method in (
                "derivative",
                "integral",
                "limit",
                "simplify",
                "expand",
            ):
                arg_vals = []
                for i, a in enumerate(node.arg or []):
                    if i == 0 and self._is_uneval_calculus_func_arg(a):
                        arg_vals.append(self._wrap_calculus_func_arg(a))
                    else:
                        arg_vals.append(self.evaluate(a))
            else:
                arg_vals = [self.evaluate(a) for a in (node.arg or [])]
            if node.obj == "error" and node.method == "raise":
                if len(arg_vals) != 2:
                    raise Exception(
                        f"[Line {node.line}] error.raise requires (errorType, message)"
                    )
                k, msg = arg_vals[0], arg_vals[1]
                if isinstance(k, SPLErrorType):
                    kind_str = k.name
                elif isinstance(k, str):
                    kind_str = k
                else:
                    raise Exception(
                        f"[Line {node.line}] error.raise first argument must be SPLErrorType or string, got {type(k).__name__}"
                    )
                self._raise_spl(kind_str, str(msg), node.line)
            if node.obj=="return":
                m=node.method
                val=arg_vals[0] if arg_vals else None
                if m=="string":
                    if not isinstance(val,str):
                        raise Exception(f"[Line {node.line}] return.string expected str, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="number":
                    if not isinstance(val,(int,float)) or isinstance(val,bool):
                        raise Exception(f"[Line {node.line}] return.number expected int or float, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="boolean":
                    if val is None:
                        raise ReturnSignal(None)
                    if val not in (0,1):
                        raise Exception(f"[Line {node.line}] return.boolean expected 0 or 1, got {val!r}")
                    raise ReturnSignal(1 if val else 0)
                if m=="list":
                    if not isinstance(val, list):
                        raise Exception(f"[Line {node.line}] return.list expected list, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="hash":
                    if not isinstance(val, dict):
                        raise Exception(f"[Line {node.line}] return.hash expected dict, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="tuple":
                    if not isinstance(val, tuple):
                        raise Exception(f"[Line {node.line}] return.tuple expected tuple, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="set":
                    if not isinstance(val, SPLSet):
                        raise Exception(f"[Line {node.line}] return.set expected set, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="functionRef":
                    if not isinstance(val, SPLFunctionRef):
                        raise Exception(f"[Line {node.line}] return.functionRef expected function ref, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="instance":
                    if not isinstance(val, SPLInstance):
                        raise Exception(f"[Line {node.line}] return.instance expected instance, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="class":
                    if not isinstance(val, SPLClass):
                        raise Exception(f"[Line {node.line}] return.class expected class, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="stack":
                    if not isinstance(val, SPLStack):
                        raise Exception(f"[Line {node.line}] return.stack expected stack, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="queue":
                    if not isinstance(val, SPLQueue):
                        raise Exception(f"[Line {node.line}] return.queue expected queue, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="deque":
                    if not isinstance(val, SPLDeque):
                        raise Exception(f"[Line {node.line}] return.deque expected deque, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="priorityQueue":
                    if not isinstance(val, SPLPriorityQueue):
                        raise Exception(f"[Line {node.line}] return.priorityQueue expected priority queue, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="linkedList":
                    if not isinstance(val, SPLLinkedList):
                        raise Exception(f"[Line {node.line}] return.linkedList expected linked list, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="heap":
                    if not isinstance(val, SPLHeap):
                        raise Exception(f"[Line {node.line}] return.heap expected heap, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="tree":
                    if not isinstance(val, SPLBinaryTree):
                        raise Exception(f"[Line {node.line}] return.tree expected tree, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                if m=="treeNode":
                    if not isinstance(val, SPLTreeNode):
                        raise Exception(f"[Line {node.line}] return.treeNode expected tree node, got {type(val).__name__}: {val!r}")
                    raise ReturnSignal(val)
                raise Exception(f"[Line {node.line}] unknown return.{m}")
            if node.method=="setVar":
                self._scope_assign(node.obj, arg_vals[0])
                return arg_vals[0]
            if node.obj=="print" and node.method in (
                "string",
                "number",
                "boolean",
                "list",
                "hash",
                "tuple",
                "set",
                "functionRef",
                "instance",
                "class",
                "stack",
                "queue",
                "deque",
                "priorityQueue",
                "linkedList",
                "heap",
                "tree",
                "treeNode",
            ):
                return self._typed_print(node.method,arg_vals,node.line)
            if node.obj=="function":
                if node.method not in self.funcs:
                    raise Exception(f"[Line {node.line}] Error: Undefined Function: {node.method}")
                return self._invoke_user_function(node.method, arg_vals, node.line)
            if node.obj in self.library:
                bucket = self.library[node.obj]
                fn = bucket.get(node.method)
                if fn is None:
                    raise Exception(
                        f"[Line {node.line}] unknown library method {node.obj}.{node.method}"
                    )
                try:
                    return fn(*arg_vals)
                except SPLException as e:
                    if not e.spl_line and node.line:
                        raise self._attach_trace(
                            SPLException(e.kind, e.spl_message, node.line, e.spl_trace or self._call_frames)
                        ) from e
                    raise self._attach_trace(e)

        return None

    def evaluate(self, arg):
        _eval = self.evaluate
        if type(arg) is Token:
            if arg.t == "ID":
                return self._scope_get(arg.v, arg.line)
            return arg.v
        if isinstance(arg, LogicNode):
            if arg.operator == "not":
                r = _eval(arg.right)
                b = self._spl_logical_bool(r)
                return 0 if b == 1 else 1
            l = _eval(arg.left) if arg.left is not None else 0
            r = _eval(arg.right)
            lb = self._spl_logical_bool(l)
            rb = self._spl_logical_bool(r)
            op_fn = _LOGIC_BINOPS.get(arg.operator)
            if op_fn is None:
                raise Exception(f"[Line {arg.line}] Unknown logical operator: {arg.operator}")
            return op_fn(lb, rb)
        if isinstance(arg, (MethodCallNode, BlockNode)):
            return self.run(arg, as_statement=False)
        if isinstance(arg, AwaitNode):
            raise Exception(
                f"[Line {arg.line}] await is only allowed inside async.do(): ... end;"
            )
        if isinstance(arg, list):
            return [_eval(i) for i in arg]
        if isinstance(arg, HashLiteralNode):
            out = {}
            for k_expr, v_expr in arg.pairs:
                key = _eval(k_expr)
                val = _eval(v_expr)
                try:
                    out[key] = val
                except TypeError as e:
                    raise Exception(f"[Line {arg.line}] Hash key must be immutable/hashable: {key!r}") from e
            return out
        if isinstance(arg, SetLiteralNode):
            return SPLSet(_eval(e) for e in arg.elements)
        if isinstance(arg, TupleLiteralNode):
            return tuple(_eval(e) for e in arg.elements)
        return arg
