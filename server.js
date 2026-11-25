// Low Poly Şehir - çok oyunculu sunucu
// Çalıştır: npm install && npm start   (PORT ortam değişkeni desteklenir)
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

// index.html hem public/ klasöründe hem de ana dizinde aranır
const pageFile = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(f => fs.existsSync(f));
if (!pageFile) { console.error('index.html bulunamadı: depoda public/index.html (veya ana dizinde index.html) olmalı.'); process.exit(1); }
const PAGE = fs.readFileSync(pageFile);
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(PAGE);
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });

// ---------- oyuncular ----------
const MAX_PLAYERS = 40;
const players = new Map(); // id -> {ws,id,name,cfg,x,y,z,r,m}
let nextId = 1;
const HEX = /^#[0-9a-fA-F]{6}$/;
const IDX = { sc: 2, hair: 4, top: 2, bot: 1, hat: 3, gl: 2, bag: 1 };
const COL = ['skin', 'hc', 'tc', 'bc', 'sh', 'hatc'];
function cleanCfg(c) {
  const o = {};
  c = c && typeof c === 'object' ? c : {};
  for (const k of COL) o[k] = HEX.test(c[k]) ? c[k] : '#888888';
  for (const k in IDX) { const v = Math.floor(Number(c[k])); o[k] = v >= 0 && v <= IDX[k] ? v : 0; }
  return o;
}
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Oyuncu';
const num = (v, lim) => { v = Number(v); return Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0; };
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcast = (o, except) => { const s = JSON.stringify(o); for (const p of players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); };

wss.on('connection', ws => {
  ws.alive = true; ws.on('pong', () => ws.alive = true);
  let me = null, count = 0, t0 = Date.now();
  ws.on('message', raw => {
    // basit hız sınırı: saniyede en fazla 40 mesaj
    if (Date.now() - t0 > 1000) { t0 = Date.now(); count = 0; }
    if (++count > 40) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !me) {
      if (players.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); return ws.close(); }
      me = { ws, id: nextId++, name: cleanName(m.name), cfg: cleanCfg(m.cfg), x: 0, y: 0, z: 12, r: 0, m: 0, lab: 0 };
      players.set(me.id, me);
      send(ws, { t: 'w', id: me.id, players: [...players.values()].filter(p => p !== me).map(p => ({ id: p.id, name: p.name, cfg: p.cfg })) });
      broadcast({ t: 'j', id: me.id, name: me.name, cfg: me.cfg }, me);
    } else if (me && m.t === 'p') {
      me.x = num(m.x, 60); me.y = num(m.y, 30); me.z = num(m.z, 60); me.r = num(m.r, 10); me.m = num(m.m, 12);
    } else if (me && m.t === 'cfg') {
      me.cfg = cleanCfg(m.cfg); if (m.name) me.name = cleanName(m.name);
      broadcast({ t: 'j', id: me.id, name: me.name, cfg: me.cfg }, me);
    } else if (me && m.t === 'lab') { labEnter(me);
    } else if (me && m.t === 'lleave') { labLeave(me, true);
    } else if (me && m.t === 'lstart') { const r = labs.get(me.lab); if (r && r.phase === 'wait') labStart(r);
    } else if (me && m.t === 'lp') { labPlace(me, m.b, m.s);
    } else if (me && m.t === 'lu') { labUndo(me, m.s);
    }
  });
  ws.on('close', () => { if (me) { if (me.lab) labLeave(me, false); players.delete(me.id); broadcast({ t: 'l', id: me.id }); } });
  ws.on('error', () => {});
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 20000);

// ---------- Kodlama Okulu: 4 kişilik panda bulmacası ----------
// Her oyuncuya (4 kişide) 1 kod bloğu düşer. 4 yuvalı programı doğru sırayla doldurmaları gerekir.
// Oyuncu 4'ten azsa herkes ceil(4/oyuncu) blok koyar (tek başına denemek için).
const labs = new Map(); let labSeq = 1, levelSeq = 1;
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DXL = [0, 1, 0, -1], DYL = [-1, 0, 1, 0]; // yön: 0 yukarı, 1 sağ, 2 aşağı, 3 sol
function runProgram(lv, prog) {
  let { x, y, d } = lv.start; const trace = []; let ok = true;
  for (const c of prog) {
    if (c === 'F') {
      const nx = x + DXL[d], ny = y + DYL[d];
      if (nx < 0 || ny < 0 || nx >= lv.size || ny >= lv.size || lv.rocks.some(r => r[0] === nx && r[1] === ny)) { trace.push({ x, y, d, bump: 1 }); ok = false; break; }
      x = nx; y = ny;
    } else d = (d + (c === 'R' ? 1 : 3)) % 4;
    trace.push({ x, y, d, bump: 0 });
  }
  return { trace, success: ok && x === lv.goal.x && y === lv.goal.y };
}
const permute = a => a.length < 2 ? [a] : a.flatMap((v, i) => permute([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [v, ...p]));
function genLevel() {
  const size = 5;
  for (;;) {
    let x = rnd(size), y = rnd(size), d = rnd(4); const start = { x, y, d }, path = [[x, y]];
    const sol = Array(2 + rnd(2)).fill('F'); while (sol.length < 4) sol.push(Math.random() < .5 ? 'L' : 'R'); shuffle(sol);
    let ok = true;
    for (const c of sol) {
      if (c === 'F') { x += DXL[d]; y += DYL[d]; if (x < 0 || y < 0 || x >= size || y >= size) { ok = false; break; } path.push([x, y]); }
      else d = (d + (c === 'R' ? 1 : 3)) % 4;
    }
    if (!ok || (x === start.x && y === start.y)) continue;
    const rocks = []; let g = 0;
    while (rocks.length < 3 && g++ < 60) { const rx = rnd(size), ry = rnd(size); if (!path.some(p => p[0] === rx && p[1] === ry) && !rocks.some(r => r[0] === rx && r[1] === ry)) rocks.push([rx, ry]); }
    const lv = { id: 0, size, start, goal: { x, y }, rocks, blocks: shuffle([...sol]) }; // çözüm sırası istemciye gitmez (blocks karıştırılmış)
    // Sıra önemli olsun: en fazla 2 farklı dizilim çözüm olsun (dönüşlerin birbirini götürdüğü kolay seviyeleri ele)
    const ok2 = new Set(); permute([0, 1, 2, 3]).forEach(pm => { const pr = pm.map(i => lv.blocks[i]); if (runProgram(lv, pr).success) ok2.add(pr.join('')); });
    if (!ok2.size || ok2.size > 2) continue;
    lv.id = levelSeq++; return lv;
  }
}
function newLab() { const r = { id: labSeq++, players: [], phase: 'wait', round: 1, score: 0, level: genLevel(), slots: [null, null, null, null], hands: {}, timer: null }; labs.set(r.id, r); return r; }
function labSync(r) {
  const s = JSON.stringify({ t: 'ls', id: r.id, phase: r.phase, round: r.round, score: r.score, maxPer: Math.ceil(4 / Math.max(1, r.players.length)),
    level: r.level, hands: r.hands, slots: r.slots, players: r.players.map(p => ({ id: p.id, name: p.name })) });
  for (const p of r.players) if (p.ws.readyState === 1) p.ws.send(s);
}
function labDeal(r) { // bloklar yeniden dağılır
  r.slots = [null, null, null, null]; r.hands = {};
  const ids = shuffle(r.players.map(p => p.id));
  if (!ids.length) return;
  shuffle([0, 1, 2, 3]).forEach((b, i) => { const id = ids[i % ids.length]; (r.hands[id] = r.hands[id] || []).push(b); });
}
function labStart(r) { r.phase = 'play'; labDeal(r); labSync(r); }
function labEnter(p) {
  if (p.lab) return;
  let r = [...labs.values()].find(r => r.phase === 'wait' && r.players.length < 4);
  if (!r) r = newLab();
  r.players.push(p); p.lab = r.id;
  if (r.players.length === 4) labStart(r); else labSync(r);
}
function labLeave(p, notify) {
  const r = labs.get(p.lab); p.lab = 0;
  if (notify) send(p.ws, { t: 'lx' });
  if (!r) return;
  r.players = r.players.filter(q => q !== p);
  if (!r.players.length) { clearTimeout(r.timer); labs.delete(r.id); return; }
  if (r.phase === 'play') labDeal(r);
  labSync(r);
}
function labPlace(p, b, s) {
  const r = labs.get(p.lab); if (!r || r.phase !== 'play') return;
  b = Math.floor(Number(b)); s = Math.floor(Number(s));
  if (!(b >= 0 && b < 4 && s >= 0 && s < 4)) return;
  if (!(r.hands[p.id] || []).includes(b) || r.slots[s] || r.slots.some(x => x && x.b === b)) return;
  r.slots[s] = { b, by: p.id };
  if (r.slots.every(Boolean)) labRun(r); else labSync(r);
}
function labUndo(p, s) {
  const r = labs.get(p.lab); s = Math.floor(Number(s));
  if (!r || r.phase !== 'play' || !(s >= 0 && s < 4) || !r.slots[s] || r.slots[s].by !== p.id) return;
  r.slots[s] = null; labSync(r);
}
function labRun(r) {
  r.phase = 'run';
  const res = runProgram(r.level, r.slots.map(x => r.level.blocks[x.b]));
  labSync(r);
  const msg = JSON.stringify({ t: 'lrun', trace: res.trace, success: res.success });
  for (const p of r.players) if (p.ws.readyState === 1) p.ws.send(msg);
  clearTimeout(r.timer);
  r.timer = setTimeout(() => {
    if (!labs.has(r.id)) return;
    if (res.success) {
      r.phase = 'win'; r.score++; labSync(r);
      r.timer = setTimeout(() => { if (!labs.has(r.id)) return; r.round++; r.level = genLevel(); labStart(r); }, 3500);
    } else {
      r.phase = 'fail'; labSync(r);
      r.timer = setTimeout(() => { if (!labs.has(r.id)) return; labStart(r); }, 2800);
    }
  }, res.trace.length * 800 + 1500);
}

// ---------- trafik simülasyonu (tek gerçek kaynak) ----------
const RD = [-30, 0, 30], nr = v => RD.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
const roll = () => { const r = Math.random(); return r < .5 ? 0 : r < .78 ? 1 : 2; };
const conf = (a, ad, at, b, bd, bt) => a != b || (ad != bd && (at == 2 || bt == 2));
let TK = 0; const cars = [];
for (let i = 0; i < 14; i++) {
  let ax, dir, lane, p, x, z;
  do {
    ax = i % 2; const road = RD[Math.floor(Math.random() * 3)]; dir = Math.random() < .5 ? 1 : -1; p = -55 + Math.random() * 110;
    lane = road + (ax ? (dir > 0 ? 2 : -2) : (dir > 0 ? -2 : 2)); x = ax ? p : lane; z = ax ? lane : p;
  } while (!cars.every(o => Math.hypot(o.x - x, o.z - z) > 12));
  const it = roll();
  cars.push({ ax, dir, lane, p, x, z, sp: 6 + Math.random() * 4, v: 0, crash: 0, ghost: 0, hit: 0, wait: 0, force: 0, yld: false,
    hasty: Math.random() < .06, yaw: ax ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI), intent: it, ei: it, eax: ax, edir: dir, wasIn: false });
}

// Önümdeki koridora giren herhangi bir araç (dönen ve çapraz olanlar dahil) için boşluk mesafesi
function radar(c, o) {
  const dx = o.x - c.x, dz = o.z - c.z;
  const s = (c.ax ? dx : dz) * c.dir, lat = Math.abs(c.ax ? dz : dx);
  const os = c.ax ? (o.ax ? 1.8 : .9) : (o.ax ? .9 : 1.8);
  const ol = c.ax ? (o.ax ? .9 : 1.8) : (o.ax ? 1.8 : .9);
  const gap = s - os - 1.8;
  return (lat < 1.15 + ol && gap > -.5 && gap < 6) ? gap : 99;
}

// Kazadan sonra çekici gelir: enkaz kaldırılır, araç haritanın kenarında boş bir şeride yeniden girer
function respawn(c) {
  for (let n = 0; n < 40; n++) {
    const ax = Math.random() < .5 ? 1 : 0, road = RD[Math.floor(Math.random() * 3)], dir = Math.random() < .5 ? 1 : -1;
    const lane = road + (ax ? (dir > 0 ? 2 : -2) : (dir > 0 ? -2 : 2)), p = -dir * 60, x = ax ? p : lane, z = ax ? lane : p;
    if (cars.some(o => o !== c && Math.hypot(o.x - x, o.z - z) < 16)) continue;
    Object.assign(c, { ax, dir, lane, p, x, z, v: 0, ghost: 1.5, crash: 0, hit: 0, wait: 0, force: 0, intent: roll(), wasIn: false, tkKey: null,
      hasty: Math.random() < .06, yaw: ax ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI) });
    return;
  }
  c.crash = 1; // boş yer yok, biraz daha bekle
}

function step(dt) {
  cars.forEach((c, i) => {
    c.id = i; c.rd = nr(c.lane); c.tj = 99; c.cur = null;
    for (const r of RD) { const tj = (r - c.p) * c.dir; if (Math.abs(tj) <= 5.9) c.cur = r; else if (tj > 5.9 && tj < c.tj) { c.tj = tj; c.jr = r; } }
    c.nx = c.ax ? c.jr : c.rd; c.nz = c.ax ? c.rd : c.jr; c.jx = c.ax ? c.cur : c.rd; c.jz = c.ax ? c.rd : c.cur;
    if (c.cur === null) {
      if (c.wasIn) { c.intent = roll(); c.tkKey = null; }
      c.ei = c.intent; c.eax = c.ax; c.edir = c.dir;
      if (c.tj < 24) { const key = c.nx * 1000 + c.nz; if (c.tkKey !== key) { c.tkKey = key; c.tk = ++TK; } }
    }
    c.wasIn = c.cur !== null;
  });
  for (const c of cars) {
    const hx = c.ax ? c.dir : 0, hz = c.ax ? 0 : c.dir; let tv = c.sp; c.yld = false;
    if (c.ghost > 0) c.ghost -= dt;
    if (c.crash > 0) { c.crash -= dt; c.v = 0; if (c.crash <= 0) respawn(c); }
    else {
      if (c.force > 0) c.force -= dt;
      if (c.ghost <= 0) {
        let stop = false, blk = false, ex = { ax: c.ax, dir: c.dir, lane: c.lane, jc: c.jr };
        if (c.intent > 0) {
          const nh = c.intent == 1 ? [-hz, hx] : [hz, -hx], nax = nh[0] ? 1 : 0, nd = nax ? nh[0] : nh[1];
          ex = { ax: nax, dir: nd, lane: c.jr + (nax ? (nd > 0 ? 2 : -2) : (nd > 0 ? -2 : 2)), jc: c.rd };
        }
        for (const o of cars) {
          if (o === c) continue;
          const dx = o.x - c.x, dz = o.z - c.z;
          if (o.ax == c.ax && o.dir == c.dir) { const f = dx * hx + dz * hz, l = Math.abs(c.ax ? dz : dx); if (l < 1.5 && f > 0 && f < 13) tv = Math.min(tv, Math.max(0, (f - 5.5) * 1.5)); }
          if (!(o.ghost > 0)) { const rg = radar(c, o); if (rg < 99 && !(radar(o, c) < 99 && c.id < o.id)) tv = Math.min(tv, Math.max(0, (rg - 1.2) * 2)); }
          if (c.tj > 5.9 && c.tj < 24 && o.ax == ex.ax && o.dir == ex.dir && o.lane == ex.lane) { const q = (o.p - ex.jc) * ex.dir; if (q > -1 && q < (o.v < 1.5 ? 14 : 9)) blk = true; }
          if (!c.hasty && c.force <= 0 && c.cur === null && c.tj > 5.9 && c.tj < 24) {
            if (o.cur !== null) { if (o.jx == c.nx && o.jz == c.nz && conf(c.ax, c.dir, c.intent, o.eax, o.edir, o.ei)) stop = true; }
            else if (o.tj < 24 && o.nx == c.nx && o.nz == c.nz && conf(c.ax, c.dir, c.intent, o.ax, o.dir, o.intent) && o.tk < c.tk) stop = true;
          }
        }
        if (stop || blk) { tv = Math.min(tv, Math.max(0, (c.tj - 6.4) * 1.5)); c.yld = true; }
        if (c.ei > 0 && (c.cur !== null || c.tj < 14)) tv = Math.min(tv, 5);
        for (const q of players.values()) { // araçlar oyuncuları görünce durur
          if (q.lab) continue;
          const px = q.x - c.x, pz = q.z - c.z, pf = px * hx + pz * hz, pl = Math.abs(c.ax ? pz : px);
          if (pl < 1.6 && pf > 0 && pf < 10 && q.y < 1.2) tv = Math.min(tv, Math.max(0, (pf - 4.5) * 1.5));
        }
      }
      // kilitlenme kırıcı: 9 sn'den uzun bekleyen araç çekiciyle kaldırılır (aşağıdaki wait sayacı)
      if (tv < c.v) c.v = Math.max(tv, c.v - (c.hasty ? 6 : 20) * dt); else c.v = Math.min(tv, c.v + 5 * dt);
      if (c.yld && c.v < .3) { c.wait += dt; if (c.wait > 9) respawn(c); } else c.wait = 0;
    }
    c.p += c.dir * c.v * dt;
    if (c.crash <= 0 && c.intent > 0 && c.cur !== null) {
      const gx = c.ax ? c.dir : 0, gz = c.ax ? 0 : c.dir, nh = c.intent == 1 ? [-gz, gx] : [gz, -gx], nax = nh[0] ? 1 : 0, nd = nax ? nh[0] : nh[1];
      const nl = c.cur + (nax ? (nd > 0 ? 2 : -2) : (nd > 0 ? -2 : 2));
      if ((c.p - nl) * c.dir >= 0) { const np = c.lane; c.ax = nax; c.dir = nd; c.lane = nl; c.p = np; c.intent = 0; }
    }
    if (Math.abs(c.p) > 60) { // harita kenarında şeride yeniden giriş: şerit doluysa bekle
      const np = -Math.sign(c.p) * 60;
      if (cars.some(o => o !== c && o.ax == c.ax && o.dir == c.dir && Math.abs(o.lane - c.lane) < 1 && Math.abs(o.p - np) < 18)) { c.p = Math.sign(c.p) * 60; c.v = 0; }
      else { c.p = np; c.ghost = 1.5; }
    }
    c.x = c.ax ? c.p : c.lane; c.z = c.ax ? c.lane : c.p;
  }
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    const hit = Math.abs(a.x - b.x) < (a.ax ? 1.8 : .9) + (b.ax ? 1.8 : .9) && Math.abs(a.z - b.z) < (a.ax ? .9 : 1.8) + (b.ax ? .9 : 1.8);
    if (a.ghost > 0 || b.ghost > 0) { if (hit) { a.ghost = Math.max(a.ghost, .3); b.ghost = Math.max(b.ghost, .3); } continue; } // üst üste kalanlar ayrılana kadar çarpışmasız
    if (hit) { [a, b].forEach(q => { q.crash = 3.5; q.v = 0; q.hit = 1; q.hasty = false; }); }
  }
  for (const c of cars) {
    const ty = c.ax ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
    let da = ty - c.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); c.yaw += da * Math.min(1, dt * 9);
  }
}

// 20 Hz simülasyon, 10 Hz yayın. Kimse yokken trafik durur.
const r2 = v => Math.round(v * 100) / 100;
let tick = 0;
setInterval(() => {
  if (!players.size) return;
  step(.05);
  if (++tick % 2) return;
  const s = JSON.stringify({
    t: 's', n: players.size,
    p: [...players.values()].map(p => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.r), r2(p.m), p.lab ? 1 : 0]),
    c: cars.map(c => [r2(c.x), r2(c.z), r2(c.yaw), c.crash > 0 ? 1 : 0, c.ghost > 0 ? 1 : 0])
  });
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Sunucu hazır: http://localhost:' + PORT));


