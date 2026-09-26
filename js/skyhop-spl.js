/**
 * Sandboxed host for level scripts written in SPL.
 * SPL is the language (use, <-, test.while, test.ifTrue, test.break, calls).
 * SkyHop only exposes the game API. file, network, sql, packages, and system
 * calls are rejected. A test.while body runs one iteration per game frame so
 * a loop can watch the player without freezing the stage.
 */
(function (root) {
  const MAX_STEPS = 100000;
  const TAG_PX = 0.75;
  const BLOCKED = {
    file: 1,
    network: 1,
    sql: 1,
    user: 1,
    cli: 1,
    json: 1,
    pkg: 1,
    os: 1,
    system: 1,
    process: 1,
    ffi: 1,
    native: 1,
  };
  const TEST_ALIAS = {
    if: 'ifTrue',
    iftrue: 'ifTrue',
    iffalse: 'ifFalse',
    elseif: 'elseIfTrue',
    elseifTrue: 'elseIfTrue',
    elseifFalse: 'elseIfFalse',
    While: 'while',
    forloop: 'forLoop',
  };

  function formatCoord(n) {
    if (!Number.isFinite(n)) return '?';
    const r = Math.round(n * 100) / 100;
    return String(r);
  }

  function objectCenter(stage, kind, obj) {
    if (!obj) return null;
    if (kind === 'fireball') {
      const pos = Number(obj.pos) || 0;
      if (obj.from === 'left') return { x: 0, y: pos };
      if (obj.from === 'right') return { x: Number(stage.worldW) || 0, y: pos };
      if (obj.from === 'top') return { x: pos, y: 0 };
      return { x: pos, y: Number(stage.worldH) || 0 };
    }
    if (kind === 'spawn' || kind === 'coin' || obj.w == null || obj.h == null) {
      return { x: Number(obj.x) || 0, y: Number(obj.y) || 0 };
    }
    return {
      x: Number(obj.x) + Number(obj.w) / 2,
      y: Number(obj.y) + Number(obj.h) / 2,
    };
  }

  function eachObject(stage, fn) {
    if (!stage) return;
    if (stage.spawn) fn('spawn', stage.spawn);
    if (stage.goal) fn('goal', stage.goal);
    const lists = [
      ['platform', 'platforms'],
      ['mover', 'movingPlatforms'],
      ['spike', 'spikes'],
      ['lava', 'lava'],
      ['coin', 'coins'],
      ['number', 'numbers'],
      ['text', 'texts'],
      ['gravity', 'gravityArrows'],
      ['portal', 'portals'],
      ['switch', 'switches'],
      ['blackout', 'blackouts'],
      ['fireball', 'fireballEmitters'],
    ];
    for (let i = 0; i < lists.length; i++) {
      const kind = lists[i][0];
      const arr = stage[lists[i][1]];
      if (!arr) continue;
      for (let j = 0; j < arr.length; j++) {
        if (arr[j]) fn(kind, arr[j]);
      }
    }
  }

  function tagObject(stage, x, y, sid) {
    const tx = Number(x);
    const ty = Number(y);
    const id = Number(sid);
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(id)) {
      throw new Error('skyhop.tag expects (x, y, id)');
    }
    let best = null;
    let bestD = TAG_PX;
    eachObject(stage, function (kind, obj) {
      const c = objectCenter(stage, kind, obj);
      if (!c) return;
      const d = Math.hypot(c.x - tx, c.y - ty);
      if (d <= bestD) {
        bestD = d;
        best = obj;
      }
    });
    if (!best) {
      throw new Error('No object at center (' + formatCoord(tx) + ', ' + formatCoord(ty) + ')');
    }
    best.sid = id;
    applyStickyToggle(stage, best);
    return id;
  }

  function applyStickyToggle(stage, obj) {
    const sticky = stage && stage.splAttrSticky;
    if (!sticky || !obj || obj.sid == null || obj.sid === '') return;
    if (sticky.is_affect_by_toggle != null) {
      if (Number(sticky.is_affect_by_toggle) === 0) delete obj.affectByToggle;
      else obj.affectByToggle = true;
    }
    if (sticky.default_toggle_state != null) {
      obj.defaultToggleState = Number(sticky.default_toggle_state) === 0 ? 0 : 1;
    }
    if (obj.affectByToggle && Number(obj.defaultToggleState) === 0) obj.toggleOff = true;
    else delete obj.toggleOff;
  }

  function applyToggleDefaults(stage) {
    if (!stage) return;
    delete stage.splAttrSticky;
    eachObject(stage, function (_kind, obj) {
      delete obj.toggleOff;
      if (obj.affectByToggle && Number(obj.defaultToggleState) === 0) obj.toggleOff = true;
    });
  }

  const runtimeCounters = new WeakMap();

  function clearCounters(stage) {
    if (stage) runtimeCounters.delete(stage);
  }

  function countersOf(stage) {
    return stage ? runtimeCounters.get(stage) || null : null;
  }

  function counterMap(stage) {
    let map = runtimeCounters.get(stage);
    if (!map) {
      map = Object.create(null);
      runtimeCounters.set(stage, map);
    }
    return map;
  }

  function counterSlot(stage, name, index) {
    const box = counterMap(stage)[String(name)];
    if (!box) throw new Error('No counter named ' + name);
    const idx = index == null ? 0 : Math.trunc(Number(index));
    if (!Number.isFinite(idx) || idx < 0 || idx >= box.values.length) {
      throw new Error('counter ' + name + ' has no value at index ' + idx);
    }
    return { box: box, idx: idx };
  }

  function counterCreate(stage, name, x, y, values) {
    const key = String(name || '');
    if (!key) throw new Error('skyhop.counter needs a name');
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('skyhop.counter expects a position');
    const src = values && values.length ? values : [0];
    const nums = [];
    for (let i = 0; i < src.length; i++) {
      const n = Number(src[i]);
      if (!Number.isFinite(n)) throw new Error('skyhop.counter values must be numbers');
      nums.push(n);
    }
    counterMap(stage)[key] = { x: px, y: py, values: nums };
    return 0;
  }

  function counterAdd(stage, name, inc, indexes) {
    const amount = Number(inc);
    if (!Number.isFinite(amount)) throw new Error('counter increment must be a number');
    const slots = indexes && indexes.length ? indexes : [0];
    for (let i = 0; i < slots.length; i++) {
      const slot = counterSlot(stage, name, slots[i]);
      slot.box.values[slot.idx] += amount;
    }
    return 0;
  }

  function counterSet(stage, name, value, index) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('counter value must be a number');
    const slot = counterSlot(stage, name, index == null ? 0 : index);
    slot.box.values[slot.idx] = n;
    return 0;
  }

  function counterRead(stage, name, index) {
    const slot = counterSlot(stage, name, index == null ? 0 : index);
    return slot.box.values[slot.idx];
  }

  function scriptContacts(stage, body, resolveRect) {
    const side = [];
    const other = [];
    const seen = Object.create(null);
    if (!stage || !body) return side;
    const pad = 6;
    const probe = {
      x: body.x - pad,
      y: body.y - pad,
      w: body.w + pad * 2,
      h: body.h + pad * 2,
    };
    const midY = body.y + body.h / 2;
    eachObject(stage, function (kind, obj) {
      if (kind !== 'platform' && kind !== 'mover') return;
      if (obj.sid == null || obj.sid === '') return;
      if (obj.affectByToggle && obj.toggleOff) return;
      let rect = resolveRect ? resolveRect(kind, obj) : null;
      if (!rect) rect = { x: Number(obj.x), y: Number(obj.y), w: Number(obj.w), h: Number(obj.h) };
      if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) return;
      if (probe.x + probe.w <= rect.x || probe.x >= rect.x + rect.w) return;
      if (probe.y + probe.h <= rect.y || probe.y >= rect.y + rect.h) return;
      const sid = Number(obj.sid);
      if (!Number.isFinite(sid) || seen[sid]) return;
      seen[sid] = 1;
      const sideHit = midY > rect.y + 4 && midY < rect.y + rect.h - 4;
      if (sideHit) side.push(sid);
      else other.push(sid);
    });
    return side.concat(other);
  }

  function setToggleAttr(stage, name, value) {
    if (name !== 'is_affect_by_toggle' && name !== 'default_toggle_state') {
      throw new Error('Unknown toggle attribute ' + name);
    }
    if (!stage.splAttrSticky) stage.splAttrSticky = {};
    stage.splAttrSticky[name] = Number(value) === 0 ? 0 : 1;
    eachObject(stage, function (_kind, obj) {
      if (obj.sid == null || obj.sid === '') return;
      applyStickyToggle(stage, obj);
    });
    return 0;
  }

  function objectsWithSid(stage, sid) {
    const want = Number(sid);
    const found = [];
    eachObject(stage, function (_kind, obj) {
      if (Number(obj.sid) === want) found.push(obj);
    });
    return found;
  }

  function rotate90(obj, dir) {
    const sign = dir < 0 ? -1 : 1;
    if (obj.w == null || obj.h == null) {
      obj.rot = ((Number(obj.rot) || 0) + 90 * sign + 3600) % 360;
      return;
    }
    const cx = Number(obj.x) + Number(obj.w) / 2;
    const cy = Number(obj.y) + Number(obj.h) / 2;
    const nw = Number(obj.h);
    const nh = Number(obj.w);
    obj.w = nw;
    obj.h = nh;
    obj.x = cx - nw / 2;
    obj.y = cy - nh / 2;
    obj.rot = ((Number(obj.rot) || 0) + 90 * sign + 3600) % 360;
  }

  function rotateObject(stage, sid, deg) {
    const objs = objectsWithSid(stage, sid);
    if (!objs.length) throw new Error('No object with script id ' + sid);
    const steps = Math.round(Number(deg) / 90);
    if (!Number.isFinite(steps) || steps === 0) return 0;
    const n = Math.abs(steps);
    const dir = steps < 0 ? -1 : 1;
    for (let k = 0; k < objs.length; k++) {
      for (let i = 0; i < n; i++) rotate90(objs[k], dir);
    }
    return steps * 90;
  }

  function moveObjects(stage, dx, dy, sid) {
    const mx = Number(dx);
    const my = Number(dy);
    if (!Number.isFinite(mx) || !Number.isFinite(my)) throw new Error('skyhop.move expects (x, y, id)');
    const objs = objectsWithSid(stage, sid);
    if (!objs.length) throw new Error('No object with script id ' + sid);
    for (let i = 0; i < objs.length; i++) {
      const obj = objs[i];
      if (obj.x != null && obj.x !== '') obj.x = Number(obj.x) + mx;
      if (obj.y != null && obj.y !== '') obj.y = Number(obj.y) + my;
      if (obj.pos != null && obj.from) {
        if (obj.from === 'left' || obj.from === 'right') obj.pos = Number(obj.pos) + my;
        else obj.pos = Number(obj.pos) + mx;
      }
    }
    return 0;
  }

  function colorObjects(stage, hex, sid) {
    let raw = String(hex == null ? '' : hex).trim();
    if (/^[0-9a-fA-F]{6}$/.test(raw)) raw = '#' + raw;
    if (!/^#[0-9a-fA-F]{6}$/.test(raw)) {
      throw new Error('skyhop.change_color expects a hex color like #ff8800');
    }
    const objs = objectsWithSid(stage, sid);
    if (!objs.length) throw new Error('No object with script id ' + sid);
    for (let i = 0; i < objs.length; i++) {
      objs[i].color = raw;
      delete objs[i].rainbow;
    }
    return 0;
  }

  function toggleObjects(stage, sid) {
    const objs = objectsWithSid(stage, sid);
    if (!objs.length) throw new Error('No object with script id ' + sid);
    let any = false;
    for (let i = 0; i < objs.length; i++) {
      const obj = objs[i];
      if (!obj.affectByToggle) continue;
      any = true;
      if (obj.toggleOff) delete obj.toggleOff;
      else obj.toggleOff = true;
    }
    if (!any) throw new Error('Script id ' + sid + ' is not affected by toggle');
    return 0;
  }

  function hazardObjects(stage, sid) {
    const objs = objectsWithSid(stage, sid);
    if (!objs.length) throw new Error('No object with script id ' + sid);
    for (let i = 0; i < objs.length; i++) objs[i].hazardous = true;
    return 0;
  }

  function safeObjects(stage, sid) {
    const objs = objectsWithSid(stage, sid);
    if (!objs.length) throw new Error('No object with script id ' + sid);
    for (let i = 0; i < objs.length; i++) delete objs[i].hazardous;
    return 0;
  }

  function disableWallJumpObjects(stage, sid) {
    const objs = objectsWithSid(stage, sid);
    if (!objs.length) throw new Error('No object with script id ' + sid);
    for (let i = 0; i < objs.length; i++) objs[i].noWallJump = true;
    return 0;
  }

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;
    const n = src.length;
    function push(t, v) {
      tokens.push({ t: t, v: v, line: line });
    }
    while (i < n) {
      const c = src[i];
      if (c === '\n') {
        line++;
        i++;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\r') {
        i++;
        continue;
      }
      if (src.startsWith('#comment:', i)) {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (src.startsWith('<-', i)) {
        push('ARROW');
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        let s = '';
        while (i < n && src[i] !== '"') {
          if (src[i] === '\\') {
            const e = src[i + 1];
            if (e === 'n') s += '\n';
            else if (e === 't') s += '\t';
            else if (e === 'r') s += '\r';
            else if (e === '"' || e === '\\' || e === "'") s += e;
            else throw new Error('Line ' + line + ': bad escape');
            i += 2;
            continue;
          }
          if (src[i] === '\n') line++;
          s += src[i];
          i++;
        }
        if (src[i] !== '"') throw new Error('Line ' + line + ': unterminated string');
        i++;
        push('STRING', s);
        continue;
      }
      if (c === '-' || (c >= '0' && c <= '9')) {
        if (c === '-' && !(src[i + 1] >= '0' && src[i + 1] <= '9')) {
          throw new Error('Line ' + line + ': unexpected "-"');
        }
        const start = i;
        i++;
        while (i < n && src[i] >= '0' && src[i] <= '9') i++;
        if (src[i] === '.') {
          i++;
          while (i < n && src[i] >= '0' && src[i] <= '9') i++;
          push('NUMBER', parseFloat(src.slice(start, i)));
        } else {
          push('NUMBER', parseInt(src.slice(start, i), 10));
        }
        continue;
      }
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
        const start = i;
        i++;
        while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
        const word = src.slice(start, i);
        if (word === 'end') push('END');
        else if (word === 'use') push('USE');
        else if (word === 'code') push('CODE');
        else if (word === 'true') push('BOOL', 1);
        else if (word === 'false') push('BOOL', 0);
        else if (word === 'not' || word === 'and' || word === 'or' || word === 'nand' || word === 'nor' || word === 'xor' || word === 'xnor') {
          push(word.toUpperCase());
        } else push('ID', word);
        continue;
      }
      const singles = {
        '.': 'DOT',
        '(': 'LP',
        ')': 'RP',
        ':': 'COLON',
        ';': 'SEMI',
        ',': 'COMMA',
        '[': 'LB',
        ']': 'RB',
        '{': 'LC',
        '}': 'RC',
      };
      if (singles[c]) {
        push(singles[c]);
        i++;
        continue;
      }
      if (c === '=') throw new Error('Line ' + line + ': use <- for assignment');
      throw new Error('Line ' + line + ': unexpected ' + JSON.stringify(c));
    }
    push('EOF');
    return tokens;
  }

  function parse(src) {
    const tokens = tokenize(src);
    let pos = 0;
    function peek() {
      return tokens[pos];
    }
    function consume(t) {
      const tok = tokens[pos];
      if (tok.t !== t) throw new Error('Line ' + tok.line + ': expected ' + t);
      pos++;
      return tok;
    }
    function optionalSemi() {
      if (peek().t === 'SEMI') pos++;
    }
    function parseArgs() {
      const args = [];
      if (peek().t !== 'LP') return args;
      pos++;
      if (peek().t === 'RP') {
        pos++;
        return args;
      }
      args.push(parseOr());
      while (peek().t === 'COMMA') {
        pos++;
        args.push(parseOr());
      }
      consume('RP');
      return args;
    }
    function parseBody(colonLine) {
      if (peek().t === 'EOF') throw new Error('Line ' + colonLine + ': expected a statement or end');
      if (peek().line > colonLine) {
        const body = [];
        while (peek().t !== 'END' && peek().t !== 'EOF') body.push(parseStatement());
        if (peek().t !== 'END') throw new Error('Line ' + colonLine + ': missing end');
        pos++;
        optionalSemi();
        return body;
      }
      return [parseStatement()];
    }
    function parseList() {
      const items = [];
      consume('LB');
      if (peek().t !== 'RB') {
        items.push(parseOr());
        while (peek().t === 'COMMA') {
          pos++;
          items.push(parseOr());
        }
      }
      consume('RB');
      return { kind: 'list', items: items };
    }
    function parseBrace() {
      const line = peek().line;
      consume('LC');
      if (peek().t === 'RC') {
        pos++;
        return { kind: 'hash', pairs: [], line: line };
      }
      const first = parseOr();
      if (peek().t === 'COLON') {
        pos++;
        const pairs = [[first, parseOr()]];
        while (peek().t === 'COMMA') {
          pos++;
          const key = parseOr();
          consume('COLON');
          pairs.push([key, parseOr()]);
        }
        consume('RC');
        return { kind: 'hash', pairs: pairs, line: line };
      }
      const items = [first];
      while (peek().t === 'COMMA') {
        pos++;
        items.push(parseOr());
      }
      consume('RC');
      return { kind: 'set', items: items, line: line };
    }
    function parsePrimary() {
      const tok = peek();
      if (tok.t === 'NUMBER' || tok.t === 'STRING' || tok.t === 'BOOL') {
        pos++;
        return { kind: 'lit', v: tok.v };
      }
      if (tok.t === 'LB') return parseList();
      if (tok.t === 'LC') return parseBrace();
      if (tok.t === 'LP') {
        const line = tok.line;
        pos++;
        if (peek().t === 'RP') {
          pos++;
          return { kind: 'tuple', items: [], line: line };
        }
        const first = parseOr();
        if (peek().t === 'COMMA') {
          const items = [first];
          while (peek().t === 'COMMA') {
            pos++;
            items.push(parseOr());
          }
          consume('RP');
          return { kind: 'tuple', items: items, line: line };
        }
        consume('RP');
        return first;
      }
      if (tok.t !== 'ID') throw new Error('Line ' + tok.line + ': expected a value');
      const name = tok.v;
      pos++;
      if (peek().t !== 'DOT') return { kind: 'var', name: name };
      pos++;
      const method = consume('ID').v;
      const args = parseArgs();
      return { kind: 'call', obj: name, method: method, args: args };
    }
    function parseNot() {
      if (peek().t === 'NOT') {
        const line = peek().line;
        pos++;
        return { kind: 'not', expr: parseNot(), line: line };
      }
      return parsePrimary();
    }
    function parseAnd() {
      let left = parseNot();
      while (peek().t === 'AND' || peek().t === 'NAND') {
        const op = peek().t.toLowerCase();
        pos++;
        left = { kind: 'logic', op: op, left: left, right: parseNot() };
      }
      return left;
    }
    function parseOr() {
      let left = parseAnd();
      while (peek().t === 'OR' || peek().t === 'NOR' || peek().t === 'XOR' || peek().t === 'XNOR') {
        const op = peek().t.toLowerCase();
        pos++;
        left = { kind: 'logic', op: op, left: left, right: parseAnd() };
      }
      return left;
    }
    function parseStatement() {
      const tok = peek();
      if (tok.t === 'USE') {
        pos++;
        const name = consume('ID').v;
        optionalSemi();
        return { kind: 'use', module: name, line: tok.line };
      }
      if (tok.t === 'ID' && (tokens[pos + 1].t === 'ARROW' || tokens[pos + 1].t === 'ID')) {
        const startPos = pos;
        const name = consume('ID').v;
        const params = [];
        while (peek().t === 'ID') params.push(consume('ID').v);
        if (peek().t === 'ARROW') {
          pos++;
          if (peek().t === 'CODE') {
            pos++;
            const colon = consume('COLON');
            return { kind: 'func', name: name, params: params, body: parseBody(colon.line), line: tok.line };
          }
          if (params.length) throw new Error('Line ' + tok.line + ': assignment has no parameters');
          const expr = parseOr();
          optionalSemi();
          return { kind: 'assign', name: name, expr: expr, line: tok.line };
        }
        pos = startPos;
      }
      if (peek().t !== 'ID') throw new Error('Line ' + peek().line + ': expected a statement');
      const start = peek();
      const obj = consume('ID').v;
      consume('DOT');
      const method = consume('ID').v;
      const args = parseArgs();
      if (peek().t === 'COLON') {
        const colon = consume('COLON');
        return { kind: 'block', obj: obj, method: method, args: args, body: parseBody(colon.line), line: start.line };
      }
      optionalSemi();
      return { kind: 'call', obj: obj, method: method, args: args, line: start.line };
    }
    const ast = [];
    while (peek().t !== 'EOF') ast.push(parseStatement());
    return ast;
  }

  function asBool(v) {
    return v === 1 ? 1 : 0;
  }

  function num(v, what) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(what + ' expects a number');
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n);
    return n;
  }

  function lookup(scope, name) {
    let s = scope;
    while (s) {
      if (Object.prototype.hasOwnProperty.call(s, name)) return s[name];
      s = s.parent;
    }
    throw new Error('Undefined variable ' + name);
  }

  function evalExpr(session, expr) {
    if (!expr) return 0;
    if (expr.kind === 'lit') return expr.v;
    if (expr.kind === 'var') return lookup(session.vars, expr.name);
    if (expr.kind === 'list') {
      const out = [];
      for (let i = 0; i < expr.items.length; i++) out.push(evalExpr(session, expr.items[i]));
      return out;
    }
    if (expr.kind === 'tuple') {
      const values = [];
      for (let i = 0; i < expr.items.length; i++) values.push(evalExpr(session, expr.items[i]));
      return { spl: 'tuple', values: values };
    }
    if (expr.kind === 'set') {
      const values = [];
      for (let i = 0; i < expr.items.length; i++) {
        const v = evalExpr(session, expr.items[i]);
        if (values.indexOf(v) < 0) values.push(v);
      }
      return { spl: 'set', values: values };
    }
    if (expr.kind === 'hash') {
      const map = new Map();
      for (let i = 0; i < expr.pairs.length; i++) {
        map.set(evalExpr(session, expr.pairs[i][0]), evalExpr(session, expr.pairs[i][1]));
      }
      return map;
    }
    if (expr.kind === 'not') return asBool(evalExpr(session, expr.expr)) === 1 ? 0 : 1;
    if (expr.kind === 'logic') {
      const l = asBool(evalExpr(session, expr.left));
      const r = asBool(evalExpr(session, expr.right));
      if (expr.op === 'and') return l === 1 && r === 1 ? 1 : 0;
      if (expr.op === 'or') return l === 1 || r === 1 ? 1 : 0;
      if (expr.op === 'xor') return l !== r ? 1 : 0;
      if (expr.op === 'xnor') return l === r ? 1 : 0;
      if (expr.op === 'nand') return l === 1 && r === 1 ? 0 : 1;
      if (expr.op === 'nor') return l === 0 && r === 0 ? 1 : 0;
    }
    if (expr.kind === 'call') return evalCall(session, expr.obj, expr.method, expr.args);
    throw new Error('Bad expression');
  }

  function evalArgs(session, args) {
    const out = [];
    for (let i = 0; i < args.length; i++) out.push(evalExpr(session, args[i]));
    return out;
  }

  function randInt(lo, hi) {
    const a = Math.ceil(Number(lo));
    const b = Math.floor(Number(hi));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) throw new Error('random.randint: lower must be <= upper');
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function bareName(expr) {
    return expr && expr.kind === 'var' ? expr.name : null;
  }

  function bindNew(session, expr, value) {
    const name = bareName(expr);
    if (!name) throw new Error('expected a variable name');
    session.vars[name] = value;
    return value;
  }

  function asList(value, what) {
    if (!Array.isArray(value)) throw new Error(what + ' expects a list');
    return value;
  }

  function rewriteCounterCalls(src) {
    return String(src || '').replace(/skyhop\s*\.\s*counter\s*\.\s*(update|read)\s*\(/g, function (_all, which) {
      return 'skyhop.counter' + which.charAt(0).toUpperCase() + which.slice(1) + '(';
    });
  }

  function evalCounter(session, method, rawArgs) {
    const api = session.api || {};
    if (method === 'counter') {
      const name = bareName(rawArgs[0]);
      if (!name) throw new Error('skyhop.counter name must be a variable name');
      const values = [];
      for (let i = 3; i < rawArgs.length; i++) values.push(evalExpr(session, rawArgs[i]));
      if (!api.counter) throw new Error('skyhop.counter is unavailable');
      api.counter(name, evalExpr(session, rawArgs[1]), evalExpr(session, rawArgs[2]), values);
      return 0;
    }
    if (method === 'counterRead') {
      const name = bareName(rawArgs[0]);
      if (!name) throw new Error('skyhop.counter.read starts with the counter name');
      const index = rawArgs.length > 1 ? evalExpr(session, rawArgs[1]) : 0;
      if (!api.counterRead) throw new Error('skyhop.counter.read is unavailable');
      return api.counterRead(name, index);
    }
    if (method === 'counterUpdate') {
      const only = rawArgs.length === 1 ? rawArgs[0] : null;
      if (only && only.kind === 'call' && only.obj === 'math' && only.method === 'add') {
        const addArgs = only.args || [];
        const name = bareName(addArgs[0]);
        if (!name) throw new Error('skyhop.counter.update(math.add(name, increment, indexes...))');
        const inc = evalExpr(session, addArgs[1]);
        const indexes = [];
        for (let i = 2; i < addArgs.length; i++) indexes.push(evalExpr(session, addArgs[i]));
        if (!api.counterAdd) throw new Error('skyhop.counter.update is unavailable');
        api.counterAdd(name, inc, indexes);
        return 0;
      }
      const name = bareName(rawArgs[0]);
      if (!name) throw new Error('skyhop.counter.update starts with the counter name');
      const value = evalExpr(session, rawArgs[1]);
      const index = rawArgs.length > 2 ? evalExpr(session, rawArgs[2]) : 0;
      if (!api.counterSet) throw new Error('skyhop.counter.update is unavailable');
      api.counterSet(name, value, index);
      return 0;
    }
    throw new Error('Unknown skyhop.' + method);
  }

  function evalCall(session, obj, method, argExprs) {
    if (BLOCKED[obj]) throw new Error(obj + '.' + method + ' is blocked in the SkyHop sandbox');
    const rawArgs = argExprs || [];
    if (obj === 'skyhop' && (method === 'counter' || method === 'counterUpdate' || method === 'counterRead')) {
      return evalCounter(session, method, rawArgs);
    }
    if (obj === 'list' && method === 'createList') {
      const items = evalExpr(session, rawArgs[0]);
      if (!Array.isArray(items)) throw new Error('list.createList first argument must be a list literal');
      return bindNew(session, rawArgs[1], items.slice());
    }
    if (obj === 'list' && method === 'copy') {
      const items = evalExpr(session, rawArgs[0]);
      return bindNew(session, rawArgs[1], asList(items, 'list.copy').slice());
    }
    if (obj === 'tuple' && method === 'createTuple') {
      const items = evalExpr(session, rawArgs[0]);
      const values = items && items.spl === 'tuple' ? items.values.slice() : asList(items, 'tuple.createTuple').slice();
      return bindNew(session, rawArgs[1], { spl: 'tuple', values: values });
    }
    if (obj === 'set' && method === 'createSet') {
      const items = evalExpr(session, rawArgs[0]);
      const values = items && items.spl === 'set' ? items.values.slice() : asList(items, 'set.createSet').slice();
      return bindNew(session, rawArgs[1], { spl: 'set', values: values });
    }
    if (
      (obj === 'stack' || obj === 'queue' || obj === 'deque' || obj === 'priorityQueue' || obj === 'linkedList') &&
      method.indexOf('create') === 0
    ) {
      return bindNew(session, rawArgs[0], { spl: obj, items: [] });
    }
    const api = session.api || {};
    const args = evalArgs(session, rawArgs);
    if (obj === 'skyhop') {
      if (method === 'get') {
        const key = String(args[0]);
        if (key === 'is_affect_by_toggle' || key === 'default_toggle_state') return { splAttr: key };
        if (key === 'jump_limit') {
          const value = api.get ? api.get(key) : 0;
          return {
            splAttr: key,
            value: value,
            valueOf: function () {
              return Number(this.value);
            },
          };
        }
        return api.get ? api.get(key) : 0;
      }
      if (method === 'tag') {
        if (!api.tag) throw new Error('skyhop.tag is unavailable');
        api.tag(args[0], args[1], args[2]);
        return 0;
      }
      if (method === 'rotate') {
        if (!api.rotate) throw new Error('skyhop.rotate is unavailable');
        api.rotate(args[0], args[1]);
        return 0;
      }
      if (method === 'move') {
        if (!api.move) throw new Error('skyhop.move is unavailable');
        api.move(args[0], args[1], args[2]);
        return 0;
      }
      if (method === 'change_color') {
        if (!api.color) throw new Error('skyhop.change_color is unavailable');
        api.color(args[0], args[1]);
        return 0;
      }
      if (method === 'toggle') {
        if (!api.toggle) throw new Error('skyhop.toggle is unavailable');
        api.toggle(args[0]);
        return 0;
      }
      if (method === 'hazard') {
        if (!api.hazard) throw new Error('skyhop.hazard is unavailable');
        api.hazard(args[0]);
        return 0;
      }
      if (method === 'safe') {
        if (!api.safe) throw new Error('skyhop.safe is unavailable');
        api.safe(args[0]);
        return 0;
      }
      if (method === 'disable_wall_jump') {
        if (!api.noWallJump) throw new Error('skyhop.disable_wall_jump is unavailable');
        api.noWallJump(args[0]);
        return 0;
      }
      if (method === 'wait') {
        const n = Number(args[0]);
        if (!Number.isFinite(n) || n < 0) throw new Error('skyhop.wait expects a number of seconds');
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        session.waitUntil = now + n * 1000;
        return { splWait: true };
      }
      if (method === 'kill') {
        if (!api.kill) throw new Error('skyhop.kill is unavailable');
        api.kill(args);
        return 0;
      }
      if (method === 'random') {
        if (args.length >= 2) return randInt(args[0], args[1]);
        const n = Math.floor(Number(args[0]));
        if (!Number.isFinite(n) || n <= 0) throw new Error('skyhop.random expects a positive upper bound');
        return randInt(0, n - 1);
      }
      throw new Error('Unknown skyhop.' + method);
    }
    if (obj === 'math') {
      if (method === 'add') return num(num(args[0], 'math.add') + num(args[1], 'math.add'), 'math.add');
      if (method === 'subtract') return num(num(args[0], 'math.subtract') - num(args[1], 'math.subtract'), 'math.subtract');
      if (method === 'multiply') return num(num(args[0], 'math.multiply') * num(args[1], 'math.multiply'), 'math.multiply');
      if (method === 'div') {
        const b = num(args[1], 'math.div');
        if (b === 0) throw new Error('division by zero');
        return num(num(args[0], 'math.div') / b, 'math.div');
      }
      if (method === 'mod') {
        const b = num(args[1], 'math.mod');
        if (b === 0) return null;
        return num(num(args[0], 'math.mod') % b, 'math.mod');
      }
      if (method === 'floor') return Math.floor(num(args[0], 'math.floor'));
      if (method === 'ceil') return Math.ceil(num(args[0], 'math.ceil'));
      if (method === 'round') return Math.round(num(args[0], 'math.round'));
    }
    if (obj === 'test') {
      if (method === 'isEqual') return args[0] === args[1] ? 1 : 0;
      if (method === 'isEqualNumber') return Number(args[0]) === Number(args[1]) ? 1 : 0;
      if (method === 'isEqualString') return String(args[0]) === String(args[1]) ? 1 : 0;
      if (method === 'isGreater') return Number(args[0]) > Number(args[1]) ? 1 : 0;
      if (method === 'isLess') return Number(args[0]) < Number(args[1]) ? 1 : 0;
      if (method === 'isEven') return Number(args[0]) % 2 === 0 ? 1 : 0;
      if (method === 'isOdd') return Number(args[0]) % 2 !== 0 ? 1 : 0;
      if (method === 'isNull') return args[0] == null ? 1 : 0;
    }
    if (obj === 'string') {
      const text = args.length ? String(args[0]) : '';
      if (method === 'concatenate') return String(args[0]) + String(args[1]);
      if (method === 'length') return text.length;
      if (method === 'lowercase') return text.toLowerCase();
      if (method === 'uppercase') return text.toUpperCase();
      if (method === 'trim') return text.trim();
      if (method === 'reverse') return text.split('').reverse().join('');
      if (method === 'getChar') {
        const i = Math.trunc(Number(args[1]));
        if (i < 0 || i >= text.length) return null;
        return text.charAt(i);
      }
      if (method === 'convertInt') {
        const n = parseInt(text, 10);
        return Number.isFinite(n) ? n : null;
      }
      if (method === 'convertFloat') {
        const n = parseFloat(text);
        return Number.isFinite(n) ? n : null;
      }
      if (method === 'slice') return text.slice(Number(args[1]), Number(args[2]));
    }
    if (obj === 'list') {
      if (method === 'get') {
        const list = asList(args[1], 'list.get');
        const idx = Math.trunc(Number(args[0]));
        if (idx < 0 || idx >= list.length) throw new Error('list index ' + idx + ' for length ' + list.length);
        return list[idx];
      }
      if (method === 'append') {
        const list = asList(args[1], 'list.append');
        list.push(args[0]);
        return list;
      }
      if (method === 'length') return asList(args[0], 'list.length').length;
      if (method === 'contains') return asList(args[1], 'list.contains').indexOf(args[0]) >= 0 ? 1 : 0;
      if (method === 'remove') {
        const list = asList(args[1], 'list.remove');
        const at = list.indexOf(args[0]);
        if (at >= 0) list.splice(at, 1);
        return list;
      }
      if (method === 'change') {
        const list = asList(args[2], 'list.change');
        const idx = Math.trunc(Number(args[0]));
        if (idx < 0 || idx >= list.length) throw new Error('list index ' + idx + ' for length ' + list.length);
        list[idx] = args[1];
        return list;
      }
      if (method === 'sort') {
        const list = asList(args[0], 'list.sort');
        list.sort(function (a, b) {
          if (typeof a === 'number' && typeof b === 'number') return a - b;
          return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
        });
        return list;
      }
    }
    if (obj === 'hash') {
      if (!(args[1] instanceof Map)) throw new Error('hash.' + method + ' expects a hash');
      const map = args[1];
      if (method === 'getValue') return map.has(args[0]) ? map.get(args[0]) : null;
      if (method === 'add') {
        const pair = args[0] && args[0].spl === 'tuple' ? args[0].values : null;
        if (!pair || pair.length !== 2) throw new Error('hash.add first argument must be (key, value)');
        map.set(pair[0], pair[1]);
        return map;
      }
      if (method === 'delete') {
        map.delete(args[0]);
        return map;
      }
      if (method === 'getKey') {
        for (const entry of map) {
          if (entry[1] === args[0]) return entry[0];
        }
        return null;
      }
    }
    if (obj === 'tuple' && method === 'get') {
      const values = args[1] && args[1].spl === 'tuple' ? args[1].values : null;
      if (!values) throw new Error('tuple.get expects a tuple');
      const idx = Math.trunc(Number(args[0]));
      if (idx < 0 || idx >= values.length) throw new Error('tuple index ' + idx);
      return values[idx];
    }
    if (obj === 'stack' || obj === 'queue' || obj === 'deque') {
      const box = args[0];
      if (!box || box.spl !== obj) throw new Error(obj + '.' + method + ' expects a ' + obj);
      const items = box.items;
      if (method === 'push' || method === 'enqueue' || method === 'pushBack') {
        items.push(args[1]);
        return args[1];
      }
      if (method === 'pushFront') {
        items.unshift(args[1]);
        return args[1];
      }
      if (method === 'pop' || method === 'popBack') return items.length ? items.pop() : null;
      if (method === 'dequeue' || method === 'popFront') return items.length ? items.shift() : null;
      if (method === 'peek' || method === 'peekBack') return items.length ? items[items.length - 1] : null;
      if (method === 'peekFront') return items.length ? items[0] : null;
      if (method === 'size') return items.length;
      if (method === 'isEmpty') return items.length ? 0 : 1;
    }
    if (obj === 'type') {
      const v = args[0];
      if (method === 'isNumber') return typeof v === 'number' ? 1 : 0;
      if (method === 'isString') return typeof v === 'string' ? 1 : 0;
      if (method === 'isBoolean') return v === 0 || v === 1 ? 1 : 0;
      if (method === 'isList') return Array.isArray(v) ? 1 : 0;
      if (method === 'isNull') return v == null ? 1 : 0;
      if (method === 'isHash') return v instanceof Map ? 1 : 0;
      if (method === 'isTuple') return v && v.spl === 'tuple' ? 1 : 0;
      if (method === 'isSet') return v && v.spl === 'set' ? 1 : 0;
      if (method === 'isStack') return v && v.spl === 'stack' ? 1 : 0;
      if (method === 'isQueue') return v && v.spl === 'queue' ? 1 : 0;
      if (method === 'isDeque') return v && v.spl === 'deque' ? 1 : 0;
    }
    if (obj === 'null' && method === 'coalesce') return args[0] == null ? args[1] : args[0];
    if (obj === 'float' && method === 'convertInt') {
      const n = Number(args[0]);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    if (obj === 'random') {
      if (method === 'randint') return randInt(args[0], args[1]);
      if (method === 'randfloat') {
        const lo = Number(args[0]);
        const hi = Number(args[1]);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) throw new Error('random.randfloat: lower must be <= upper');
        return lo + Math.random() * (hi - lo);
      }
    }
    if (obj === 'function') {
      const fn = session.funcs[method];
      if (!fn) throw new Error('Undefined function ' + method);
      session.call = { fn: fn, args: args };
      return 0;
    }
    throw new Error(obj + '.' + method + ' is not available in the SkyHop sandbox');
  }

  function aliasMethod(obj, method) {
    if (obj !== 'test') return method;
    return TEST_ALIAS[method] || method;
  }

  function open(src) {
    const text = rewriteCounterCalls(src);
    if (!text.trim()) return null;
    try {
      const ast = parse(text);
      if (!ast.length || ast[0].kind !== 'use' || ast[0].module !== 'skyhop') {
        return { done: true, error: 'Script must start with use skyhop;' };
      }
      return {
        ast: ast,
        stack: [{ type: 'root', stmts: ast, ip: 0 }],
        vars: { parent: null },
        funcs: Object.create(null),
        ifStack: [],
        done: false,
        error: null,
        call: null,
        waitUntil: 0,
      };
    } catch (e) {
      return { done: true, error: String((e && e.message) || e) };
    }
  }

  function fail(session, err) {
    session.error = String((err && err.message) || err);
    session.done = true;
  }

  function tick(session, api) {
    if (!session || session.done) return session;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (session.waitUntil && now < session.waitUntil) return session;
    if (session.waitUntil) session.waitUntil = 0;
    session.api = api || {};
    let steps = 0;
    let yielded = false;
    try {
      while (!session.done && !yielded && steps < MAX_STEPS) {
        steps++;
        const frame = session.stack[session.stack.length - 1];
        if (!frame) {
          session.done = true;
          break;
        }
        if (frame.type === 'while' && !frame.condChecked) {
          frame.condChecked = true;
          const cond = evalExpr(session, frame.cond);
          if (cond !== 1) {
            session.stack.pop();
            continue;
          }
        }
        if (frame.type === 'for' && (!frame.started || frame.ip >= frame.stmts.length)) {
          if (frame.started) frame.cur += 1;
          if (frame.cur > frame.end + 1e-12) {
            session.stack.pop();
            continue;
          }
          frame.guard += 1;
          if (frame.guard > 100000) throw new Error('test.forLoop exceeded maximum iterations (100000)');
          const whole = Math.round(frame.cur);
          session.vars[frame.name] = Math.abs(frame.cur - whole) < 1e-9 ? whole : frame.cur;
          frame.started = true;
          frame.ip = 0;
          if (!frame.stmts.length) continue;
        }
        if (frame.ip >= frame.stmts.length) {
          if (frame.type === 'while') {
            frame.ip = 0;
            frame.condChecked = false;
            yielded = true;
            continue;
          }
          if (frame.type === 'call') session.vars = frame.parentVars;
          session.stack.pop();
          if (!session.stack.length) session.done = true;
          continue;
        }
        const stmt = frame.stmts[frame.ip++];
        const signal = execStmt(session, stmt);
        if (signal === 'wait') {
          yielded = true;
          continue;
        }
        if (signal === 'break' || signal === 'continue') {
          while (
            session.stack.length &&
            session.stack[session.stack.length - 1].type !== 'while' &&
            session.stack[session.stack.length - 1].type !== 'for'
          ) {
            const top = session.stack.pop();
            if (top.type === 'call') session.vars = top.parentVars;
          }
          const loop = session.stack[session.stack.length - 1];
          if (!loop || (loop.type !== 'while' && loop.type !== 'for')) {
            throw new Error('test.' + signal + ' used outside of a loop');
          }
          if (signal === 'break') {
            session.stack.pop();
          } else if (loop.type === 'for') {
            loop.ip = loop.stmts.length;
          } else {
            loop.ip = 0;
            loop.condChecked = false;
            yielded = true;
          }
        }
      }
      if (steps >= MAX_STEPS && !session.done) {
        throw new Error('Script exceeded ' + MAX_STEPS + ' steps in one frame');
      }
    } catch (err) {
      fail(session, err);
    }
    return session;
  }

  function execStmt(session, stmt) {
    if (!stmt) return;
    if (stmt.kind === 'use') {
      if (stmt.module !== 'skyhop') throw new Error('SkyHop sandbox blocks use ' + stmt.module);
      return;
    }
    if (stmt.kind === 'assign') {
      const prev = session.vars[stmt.name];
      const value = evalExpr(session, stmt.expr);
      if (prev && prev.splAttr) {
        if (!session.api || !session.api.attr) throw new Error('skyhop attribute write is unavailable');
        session.api.attr(prev.splAttr, value);
      }
      session.vars[stmt.name] = value;
      if (value && value.splWait) return 'wait';
      return;
    }
    if (stmt.kind === 'func') {
      session.funcs[stmt.name] = stmt;
      return;
    }
    if (stmt.kind === 'call') {
      if (stmt.obj === 'test' && (stmt.method === 'break' || stmt.method === 'Break')) return 'break';
      if (stmt.obj === 'test' && (stmt.method === 'continue' || stmt.method === 'Continue')) return 'continue';
      if (stmt.obj === 'test' && stmt.method === 'pass') return;
      if (stmt.obj === 'function') {
        const fn = session.funcs[stmt.method];
        if (!fn) throw new Error('Undefined function ' + stmt.method);
        const args = evalArgs(session, stmt.args || []);
        const locals = { parent: session.vars };
        for (let i = 0; i < fn.params.length; i++) locals[fn.params[i]] = args[i];
        session.stack.push({ type: 'call', stmts: fn.body, ip: 0, parentVars: session.vars });
        session.vars = locals;
        return;
      }
      const called = evalCall(session, stmt.obj, stmt.method, stmt.args || []);
      if (called && called.splWait) return 'wait';
      return;
    }
    if (stmt.kind === 'block') {
      const method = aliasMethod(stmt.obj, stmt.method);
      if (stmt.obj === 'test' && method === 'while') {
        if (!stmt.args || !stmt.args.length) throw new Error('test.while requires a condition');
        session.stack.push({
          type: 'while',
          stmts: stmt.body || [],
          ip: 0,
          cond: stmt.args[0],
          condChecked: false,
        });
        return;
      }
      if (stmt.obj === 'test' && method === 'forLoop') {
        if (!stmt.args || stmt.args.length < 3) throw new Error('test.forLoop requires (start, end, varName)');
        const varExpr = stmt.args[2];
        if (!varExpr || varExpr.kind !== 'var' || !varExpr.name) {
          throw new Error('test.forLoop third argument must be a variable name');
        }
        const start = Number(evalExpr(session, stmt.args[0]));
        const end = Number(evalExpr(session, stmt.args[1]));
        if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('test.forLoop bounds must be numbers');
        session.stack.push({
          type: 'for',
          stmts: stmt.body || [],
          ip: 0,
          name: varExpr.name,
          cur: start,
          end: end,
          guard: 0,
          started: false,
        });
        return;
      }
      if (stmt.obj === 'test' && method === 'ifTrue') {
        const cond = stmt.args && stmt.args.length ? evalExpr(session, stmt.args[0]) : 0;
        const ok = cond === 1;
        session.ifStack.push(ok);
        if (ok) session.stack.push({ type: 'block', stmts: stmt.body || [], ip: 0 });
        return;
      }
      if (stmt.obj === 'test' && method === 'ifFalse') {
        const cond = stmt.args && stmt.args.length ? evalExpr(session, stmt.args[0]) : 0;
        const ok = cond === 0;
        session.ifStack.push(ok);
        if (ok) session.stack.push({ type: 'block', stmts: stmt.body || [], ip: 0 });
        return;
      }
      if (stmt.obj === 'test' && (method === 'elseIfTrue' || method === 'elseIfFalse')) {
        if (!session.ifStack.length) return;
        if (session.ifStack[session.ifStack.length - 1]) return;
        const cond = stmt.args && stmt.args.length ? evalExpr(session, stmt.args[0]) : 0;
        const ok = method === 'elseIfTrue' ? cond === 1 : cond === 0;
        if (ok) {
          session.ifStack[session.ifStack.length - 1] = true;
          session.stack.push({ type: 'block', stmts: stmt.body || [], ip: 0 });
        }
        return;
      }
      if (stmt.obj === 'test' && method === 'else') {
        if (!session.ifStack.length) return;
        const prev = session.ifStack.pop();
        if (!prev) session.stack.push({ type: 'block', stmts: stmt.body || [], ip: 0 });
        return;
      }
      if (BLOCKED[stmt.obj]) throw new Error(stmt.obj + '.' + method + ' is blocked in the SkyHop sandbox');
      throw new Error(stmt.obj + '.' + method + ' is not available in the SkyHop sandbox');
    }
    throw new Error('Unknown statement');
  }

  root.SkyHopSpl = {
    open: open,
    tick: tick,
    parse: parse,
    formatCoord: formatCoord,
    objectCenter: objectCenter,
    tagObject: tagObject,
    rotateObject: rotateObject,
    moveObjects: moveObjects,
    colorObjects: colorObjects,
    toggleObjects: toggleObjects,
    hazardObjects: hazardObjects,
    safeObjects: safeObjects,
    disableWallJumpObjects: disableWallJumpObjects,
    setToggleAttr: setToggleAttr,
    applyToggleDefaults: applyToggleDefaults,
    clearCounters: clearCounters,
    countersOf: countersOf,
    counterCreate: counterCreate,
    counterAdd: counterAdd,
    counterSet: counterSet,
    counterRead: counterRead,
    scriptContacts: scriptContacts,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
