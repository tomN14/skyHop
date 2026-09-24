/**
 * Loads the real SPL interpreter (Pyodide) and the sandboxed SkyHop host.
 * Level scripts then get SPL's own functions, including test.forLoop.
 * File, network, SQL, package, and system calls stay blocked in the host.
 */
(function () {
  const base =
    document.currentScript && document.currentScript.src
      ? new URL('spl/', document.currentScript.src)
      : new URL('js/spl/', window.location.href);
  const FILES = [
    'someProgrammingLanguage/__init__.py',
    'someProgrammingLanguage/spl_ast.py',
    'someProgrammingLanguage/spl_async.py',
    'someProgrammingLanguage/spl_errors.py',
    'someProgrammingLanguage/spl_game_ttt.py',
    'someProgrammingLanguage/spl_interpreter.py',
    'someProgrammingLanguage/spl_jit.py',
    'someProgrammingLanguage/spl_lexer.py',
    'someProgrammingLanguage/spl_parser.py',
    'someProgrammingLanguage/spl_runtime.py',
    'someProgrammingLanguage/spl_stdlib_extended.py',
    'someProgrammingLanguage/spl_stdlib_json.py',
    'skyhop_host.py',
  ];
  let loading = null;
  let api = null;

  function mkdirP(py, dir) {
    const bits = String(dir).split('/').filter(Boolean);
    let cur = '';
    for (let i = 0; i < bits.length; i++) {
      cur += '/' + bits[i];
      try {
        py.FS.mkdir(cur);
      } catch (err) {
        /* already created */
      }
    }
  }

  function ensure() {
    if (api) return Promise.resolve(api);
    if (loading) return loading;
    loading = (async function () {
      const { loadPyodide } = await import('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs');
      const py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/' });
      for (let i = 0; i < FILES.length; i++) {
        const rel = FILES[i];
        const res = await fetch(new URL(rel, base));
        if (!res.ok) throw new Error('Could not load SPL file ' + rel);
        const text = await res.text();
        const full = '/skyhop/' + rel;
        mkdirP(py, full.split('/').slice(0, -1).join('/'));
        py.FS.writeFile(full, text);
      }
      const host = py.FS.readFile('/skyhop/skyhop_host.py', { encoding: 'utf8' });
      py.runPython('import os\nos.chdir("/skyhop")');
      try {
        py.globals.set('__file__', '/skyhop/skyhop_host.py');
      } catch (err) {
        /* host falls back to /skyhop */
      }
      py.runPython(host);
      const openFn = py.globals.get('skyhop_open');
      const tickFn = py.globals.get('skyhop_tick');
      api = {
        open: function (code) {
          return JSON.parse(openFn(String(code || '')));
        },
        tick: function (state) {
          return JSON.parse(tickFn(JSON.stringify(state || {})));
        },
      };
      return api;
    })().catch(function (err) {
      loading = null;
      throw err;
    });
    return loading;
  }

  window.SkyHopSplReal = { ensure: ensure };
})();
