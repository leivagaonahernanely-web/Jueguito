(() => {
  'use strict';

  // ---------- Configuración ----------
  const WORLD = 2400;
  const PLAYER_SPEED = 230;
  const BOT_SPEED = 190;
  const BOT_COUNT = 29;
  const OBSTACLE_COUNT = 240;
  const LOOT_WEAPONS = 70;
  const LOOT_MEDS = 60;
  const MAX_MEDS = 5;
  const HEAL_AMOUNT = 35;
  const TAU = Math.PI * 2;

  const WEAPONS = {
    pistola:       { name: 'Pistola',       dmg: 18, rate: 0.28, spread: 0.05, speed: 900,  range: 620,  mag: 12, reload: 1.0, pellets: 1, rank: 1, color: '#ffd166' },
    escopeta:      { name: 'Escopeta',      dmg: 11, rate: 0.75, spread: 0.22, speed: 800,  range: 320,  mag: 6,  reload: 2.2, pellets: 6, rank: 2, color: '#ef476f' },
    rifle:         { name: 'Rifle',         dmg: 22, rate: 0.12, spread: 0.07, speed: 1100, range: 820,  mag: 30, reload: 1.8, pellets: 1, rank: 3, color: '#06d6a0' },
    francotirador: { name: 'Francotirador', dmg: 90, rate: 1.3,  spread: 0.0,  speed: 1800, range: 1500, mag: 5,  reload: 2.5, pellets: 1, rank: 4, color: '#118ab2' },
  };
  const WEAPON_WEIGHTS = { pistola: 35, escopeta: 25, rifle: 30, francotirador: 10 };

  // Fases de la zona: tiempo de espera, tiempo de cierre, radio objetivo y daño por segundo fuera de la zona
  const ZONE_PHASES = [
    { hold: 40, shrink: 25, radius: 1000, dps: 1 },
    { hold: 30, shrink: 25, radius: 500,  dps: 3 },
    { hold: 25, shrink: 20, radius: 220,  dps: 6 },
    { hold: 20, shrink: 15, radius: 40,   dps: 12 },
  ];

  // ---------- Elementos de la interfaz ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    alive: $('alive'), zone: $('zone'), kills: $('kills'),
    hpfill: $('hpfill'), hptext: $('hptext'),
    weapon: $('weapon'), ammo: $('ammo'), meds: $('meds'), feed: $('feed'),
    menu: $('menu'), end: $('end'), endTitle: $('endTitle'), endText: $('endText'),
  };

  // ---------- Estado global ----------
  let W = 0, H = 0, DPR = 1;
  let state = 'menu';               // 'menu' | 'playing' | 'over'
  let obstacles = [];
  let loot = [];
  let bullets = [];
  let feed = [];
  let bots = [];
  let player = null;
  let ents = [];                    // jugador + bots (se actualiza cada frame)
  let zone = null;
  let elapsed = 0;
  let lastTime = 0;
  let healBtn = { x: 0, y: 0, r: 42 };

  const keyState = {};
  const mouse = { x: 0, y: 0 };
  let mouseDown = false;
  const pointers = new Map();       // pointerId -> { kind: 'move'|'aim', ox, oy, x, y }

  // ---------- Utilidades ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  function pickWeaponKey() {
    const names = Object.keys(WEAPON_WEIGHTS);
    const total = names.reduce((s, k) => s + WEAPON_WEIGHTS[k], 0);
    let r = Math.random() * total;
    for (const k of names) {
      r -= WEAPON_WEIGHTS[k];
      if (r <= 0) return k;
    }
    return 'pistola';
  }

  // ---------- Mapa ----------
  function pointBlocked(x, y, pad = 0) {
    for (const o of obstacles) {
      if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
    }
    return false;
  }

  function hasLOS(x1, y1, x2, y2) {
    const d = dist(x1, y1, x2, y2);
    const n = Math.max(1, Math.ceil(d / 25));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (pointBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  function genObstacles() {
    obstacles = [];
    let tries = 0;
    while (obstacles.length < OBSTACLE_COUNT && tries < 6000) {
      tries++;
      const w = (rand(50, 170)) | 0;
      const h = (rand(50, 170)) | 0;
      const x = (rand(0, WORLD - w)) | 0;
      const y = (rand(0, WORLD - h)) | 0;
      const pad = 30;
      const overlaps = obstacles.some((o) =>
        x < o.x + o.w + pad && x + w > o.x - pad && y < o.y + o.h + pad && y + h > o.y - pad);
      if (overlaps) continue;
      obstacles.push({
        x, y, w, h,
        type: Math.random() < 0.6 ? 'casa' : 'caja',
        color: pick(['#8d6e63', '#a1887f', '#6d4c41', '#90a4ae', '#b0bec5']),
      });
    }
  }

  function freeSpot(margin = 30) {
    for (let i = 0; i < 800; i++) {
      const x = rand(margin, WORLD - margin);
      const y = rand(margin, WORLD - margin);
      if (!pointBlocked(x, y, 20)) return { x, y };
    }
    return { x: WORLD / 2, y: WORLD / 2 };
  }

  // ---------- Entidades ----------
  function makeEntity(x, y, name, isPlayer) {
    return {
      x, y, r: 16, name, isPlayer,
      hp: 100, alive: true, kills: 0,
      weapon: 'pistola', ammo: WEAPONS.pistola.mag, reloadT: 0,
      meds: 0, cool: 0, angle: 0, flash: 0,
      // IA de bots
      target: null, goal: null, thinkT: 0,
      wanderX: x, wanderY: y, wanderT: 0, strafe: Math.random() < 0.5 ? 1 : -1,
    };
  }

  function moveEntity(e, dx, dy) {
    e.x += dx;
    e.y += dy;
    resolveCollisions(e);
  }

  function resolveCollisions(e) {
    e.x = clamp(e.x, e.r, WORLD - e.r);
    e.y = clamp(e.y, e.r, WORLD - e.r);
    for (const o of obstacles) {
      const cx = clamp(e.x, o.x, o.x + o.w);
      const cy = clamp(e.y, o.y, o.y + o.h);
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < e.r * e.r) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const p = (e.r - d) / d;
          e.x += dx * p;
          e.y += dy * p;
        } else {
          const left = e.x - o.x, right = o.x + o.w - e.x;
          const up = e.y - o.y, down = o.y + o.h - e.y;
          const m = Math.min(left, right, up, down);
          if (m === left) e.x = o.x - e.r;
          else if (m === right) e.x = o.x + o.w + e.r;
          else if (m === up) e.y = o.y - e.r;
          else e.y = o.y + o.h + e.r;
        }
      }
    }
  }

  function stepToward(e, tx, ty, speed, dt) {
    const a = Math.atan2(ty - e.y, tx - e.x);
    e.angle = a;
    moveEntity(e, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt);
  }

  function reload(e) {
    if (!e.alive || e.reloadT > 0 || e.ammo === WEAPONS[e.weapon].mag) return;
    e.reloadT = WEAPONS[e.weapon].reload;
  }

  function shoot(e, angle) {
    if (!e.alive || e.cool > 0 || e.reloadT > 0) return;
    const w = WEAPONS[e.weapon];
    if (e.ammo <= 0) { reload(e); return; }
    e.ammo--;
    e.cool = w.rate;
    if (e.ammo === 0) reload(e);
    for (let i = 0; i < w.pellets; i++) {
      const a = angle + rand(-w.spread, w.spread);
      bullets.push({
        x: e.x + Math.cos(angle) * (e.r + 6),
        y: e.y + Math.sin(angle) * (e.r + 6),
        vx: Math.cos(a) * w.speed,
        vy: Math.sin(a) * w.speed,
        traveled: 0, range: w.range, dmg: w.dmg,
        owner: e, color: w.color,
      });
    }
  }

  function useMed(e) {
    if (!e.alive || e.meds <= 0 || e.hp >= 100) return;
    e.meds--;
    e.hp = Math.min(100, e.hp + HEAL_AMOUNT);
  }

  function damage(e, amt, src) {
    if (!e.alive) return;
    e.hp -= amt;
    e.flash = 0.12;
    if (e.hp <= 0) kill(e, src);
  }

  function kill(e, src) {
    e.hp = 0;
    e.alive = false;
    if (e.weapon !== 'pistola') loot.push({ x: e.x, y: e.y, kind: 'weapon', weapon: e.weapon, lock: 0 });
    for (let i = 0; i < e.meds; i++) {
      loot.push({ x: e.x + rand(-14, 14), y: e.y + rand(-14, 14), kind: 'med', lock: 0 });
    }
    let msg;
    if (src && src !== e) {
      src.kills++;
      msg = `${src.name} eliminó a ${e.name}`;
    } else {
      msg = `${e.name} fue eliminado por la zona`;
    }
    addFeed(msg);
    if (e.isPlayer) endGame(false);
  }

  function tryPickup(e) {
    for (let i = loot.length - 1; i >= 0; i--) {
      const it = loot[i];
      if (it.lock > 0) continue;
      if (dist(e.x, e.y, it.x, it.y) > e.r + 12) continue;
      if (it.kind === 'med') {
        if (e.meds >= MAX_MEDS) continue;
        e.meds++;
        loot.splice(i, 1);
      } else {
        const cur = e.weapon, want = it.weapon;
        const ok = e.isPlayer ? want !== cur : WEAPONS[want].rank > WEAPONS[cur].rank;
        if (!ok) continue;
        loot.splice(i, 1);
        // El arma anterior queda en el suelo, bloqueada un momento para no recogerla de nuevo al instante
        loot.push({ x: e.x, y: e.y, kind: 'weapon', weapon: cur, lock: 1.5 });
        e.weapon = want;
        e.ammo = WEAPONS[want].mag;
        e.reloadT = 0;
      }
    }
  }

  // ---------- Zona ----------
  function zoneDps() {
    return ZONE_PHASES[Math.min(zone.phase, ZONE_PHASES.length - 1)].dps;
  }

  function updateZone(dt) {
    if (zone.phase >= ZONE_PHASES.length) return;
    const ph = ZONE_PHASES[zone.phase];
    zone.t += dt;
    if (zone.state === 'hold') {
      if (zone.t >= ph.hold) {
        zone.state = 'shrink';
        zone.t = 0;
        zone.from = zone.radius;
      }
    } else {
      const k = Math.min(1, zone.t / ph.shrink);
      zone.radius = zone.from + (ph.radius - zone.from) * k;
      if (k >= 1) {
        zone.phase++;
        zone.state = 'hold';
        zone.t = 0;
        zone.radius = ph.radius;
      }
    }
  }

  function zoneText() {
    if (zone.phase >= ZONE_PHASES.length) return 'Zona final';
    const ph = ZONE_PHASES[zone.phase];
    return zone.state === 'hold'
      ? `Zona cierra en ${Math.ceil(ph.hold - zone.t)}s`
      : `Cerrando zona: ${Math.ceil(ph.shrink - zone.t)}s`;
  }

  // ---------- Jugador ----------
  function getTouch(kind) {
    for (const p of pointers.values()) {
      if (p.kind !== kind) continue;
      const dx = p.x - p.ox, dy = p.y - p.oy, len = Math.hypot(dx, dy);
      if (kind === 'move') {
        const s = Math.min(1, len / 60);
        return { vx: len ? (dx / len) * s : 0, vy: len ? (dy / len) * s : 0 };
      }
      return { angle: Math.atan2(dy, dx), power: Math.min(1, len / 50) };
    }
    return null;
  }

  function updatePlayer(dt) {
    const p = player;
    if (!p.alive) return;

    let mx = 0, my = 0;
    if (keyState.KeyW || keyState.ArrowUp) my -= 1;
    if (keyState.KeyS || keyState.ArrowDown) my += 1;
    if (keyState.KeyA || keyState.ArrowLeft) mx -= 1;
    if (keyState.KeyD || keyState.ArrowRight) mx += 1;
    const move = getTouch('move');
    if (move) { mx += move.vx; my += move.vy; }
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    moveEntity(p, mx * PLAYER_SPEED * dt, my * PLAYER_SPEED * dt);

    const aim = getTouch('aim');
    let firing;
    if (aim) {
      p.angle = aim.angle;
      firing = aim.power > 0.2;
    } else {
      p.angle = Math.atan2(mouse.y - H / 2, mouse.x - W / 2);
      firing = mouseDown || !!keyState.Space;
    }
    if (firing) shoot(p, p.angle);
    if (keyState.KeyR) reload(p);
    tryPickup(p);
  }

  // ---------- Bots ----------
  function updateBot(b, dt) {
    b.thinkT -= dt;
    if (b.thinkT <= 0) {
      b.thinkT = rand(0.2, 0.35);
      if (b.target && (!b.target.alive || !hasLOS(b.x, b.y, b.target.x, b.target.y))) b.target = null;
      if (!b.target) {
        let best = 450;
        for (const e of ents) {
          if (e === b || !e.alive) continue;
          const d = dist(b.x, b.y, e.x, e.y);
          if (d < best && hasLOS(b.x, b.y, e.x, e.y)) {
            best = d;
            b.target = e;
          }
        }
      }
      if (!b.target) {
        const w = WEAPONS[b.weapon];
        if (w.rank < 3 || b.meds < 2) {
          let bestL = 380;
          b.goal = null;
          for (const it of loot) {
            if (it.lock > 0) continue;
            const d = dist(b.x, b.y, it.x, it.y);
            if (d < bestL) { bestL = d; b.goal = it; }
          }
        }
      }
    }
    if (b.goal && !loot.includes(b.goal)) b.goal = null;

    if (b.hp < 50 && b.meds > 0 && !b.target) useMed(b);

    const w = WEAPONS[b.weapon];
    const outsideZone = dist(b.x, b.y, zone.cx, zone.cy) > zone.radius - 40;

    if (b.target && b.target.alive) {
      const t = b.target;
      const d = dist(b.x, b.y, t.x, t.y);
      b.angle = Math.atan2(t.y - b.y, t.x - b.x);
      if (d > w.range * 0.55) {
        stepToward(b, t.x, t.y, BOT_SPEED, dt);
      } else {
        if (Math.random() < dt * 0.6) b.strafe *= -1;
        const perp = b.angle + (Math.PI / 2) * b.strafe;
        moveEntity(b, Math.cos(perp) * 150 * dt, Math.sin(perp) * 150 * dt);
      }
      if (d < w.range) {
        const aim = Math.atan2(t.y - b.y, t.x - b.x) + rand(-0.08, 0.08);
        b.angle = aim;
        shoot(b, aim);
      }
    } else if (outsideZone) {
      stepToward(b, zone.cx, zone.cy, BOT_SPEED, dt);
    } else if (b.goal) {
      stepToward(b, b.goal.x, b.goal.y, BOT_SPEED * 1.05, dt);
    } else {
      if (b.ammo < w.mag * 0.3) reload(b);
      b.wanderT -= dt;
      if (b.wanderT <= 0 || dist(b.x, b.y, b.wanderX, b.wanderY) < 25) {
        const s = freeSpot(100);
        b.wanderX = s.x;
        b.wanderY = s.y;
        b.wanderT = rand(3, 6);
      }
      stepToward(b, b.wanderX, b.wanderY, BOT_SPEED * 0.6, dt);
    }
    tryPickup(b);
  }

  // ---------- Balas ----------
  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const speed = Math.hypot(b.vx, b.vy);
      const step = speed * dt;
      const sub = Math.max(1, Math.ceil(step / 8));
      let removed = false;
      for (let s = 0; s < sub && !removed; s++) {
        b.x += b.vx * dt / sub;
        b.y += b.vy * dt / sub;
        b.traveled += step / sub;
        if (b.traveled > b.range || b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD || pointBlocked(b.x, b.y)) {
          removed = true;
          break;
        }
        for (const e of ents) {
          if (!e.alive || e === b.owner) continue;
          if (dist(b.x, b.y, e.x, e.y) < e.r) {
            damage(e, b.dmg, b.owner);
            removed = true;
            break;
          }
        }
      }
      if (removed) bullets.splice(i, 1);
    }
  }

  // ---------- Flujo de partida ----------
  function addFeed(text) {
    feed.push({ text, t: elapsed });
    if (feed.length > 6) feed.shift();
  }

  function startGame() {
    genObstacles();
    bots = [];
    loot = [];
    bullets = [];
    feed = [];
    elapsed = 0;

    const ps = freeSpot();
    player = makeEntity(ps.x, ps.y, 'Tú', true);
    for (let i = 0; i < BOT_COUNT; i++) {
      const s = freeSpot();
      bots.push(makeEntity(s.x, s.y, `Bot ${i + 1}`, false));
    }
    ents = [player, ...bots];

    for (let i = 0; i < LOOT_WEAPONS; i++) {
      const s = freeSpot(20);
      loot.push({ x: s.x, y: s.y, kind: 'weapon', weapon: pickWeaponKey(), lock: 0 });
    }
    for (let i = 0; i < LOOT_MEDS; i++) {
      const s = freeSpot(20);
      loot.push({ x: s.x, y: s.y, kind: 'med', lock: 0 });
    }

    zone = {
      phase: 0, state: 'hold', t: 0,
      radius: WORLD * 0.75, from: WORLD * 0.75,
      cx: WORLD / 2, cy: WORLD / 2,
    };
    pointers.clear();
    state = 'playing';
    ui.menu.classList.add('hidden');
    ui.end.classList.add('hidden');
  }

  function endGame(won) {
    if (state !== 'playing') return;
    state = 'over';
    const place = won ? 1 : bots.filter((b) => b.alive).length + 1;
    ui.endTitle.textContent = won ? '¡VICTORIA!' : 'ELIMINADO';
    ui.endText.textContent = `Puesto #${place} · Bajas: ${player.kills}`;
    ui.end.classList.remove('hidden');
  }

  function checkWin() {
    if (state === 'playing' && player.alive && bots.every((b) => !b.alive)) endGame(true);
  }

  // ---------- Actualización ----------
  function update(dt) {
    elapsed += dt;
    ents = [player, ...bots];

    for (const e of ents) {
      if (e.cool > 0) e.cool -= dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.reloadT > 0) {
        e.reloadT -= dt;
        if (e.reloadT <= 0) {
          e.reloadT = 0;
          e.ammo = WEAPONS[e.weapon].mag;
        }
      }
    }
    for (const it of loot) if (it.lock > 0) it.lock -= dt;

    updateZone(dt);
    for (const e of ents) {
      if (!e.alive) continue;
      if (dist(e.x, e.y, zone.cx, zone.cy) > zone.radius) damage(e, zoneDps() * dt, null);
    }

    updatePlayer(dt);
    for (const b of bots) if (b.alive) updateBot(b, dt);
    updateBullets(dt);

    feed = feed.filter((f) => elapsed - f.t < 6);
    checkWin();
    updateHUD();
  }

  // ---------- Interfaz ----------
  function updateHUD() {
    const alive = ents.filter((e) => e.alive).length;
    ui.alive.textContent = `Vivos: ${alive}`;
    ui.zone.textContent = zoneText();
    ui.kills.textContent = `Bajas: ${player.kills}`;
    ui.hpfill.style.width = `${Math.max(0, player.hp)}%`;
    ui.hptext.textContent = Math.ceil(Math.max(0, player.hp));
    const w = WEAPONS[player.weapon];
    ui.weapon.textContent = w.name;
    ui.ammo.textContent = player.reloadT > 0 ? 'Recargando…' : `${player.ammo}/${w.mag}`;
    ui.meds.textContent = player.meds;
    ui.feed.textContent = feed.map((f) => f.text).join('\n');
  }

  // ---------- Dibujo ----------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(0, 0, W, H);
    if (!player) return;

    const camX = player.x - W / 2;
    const camY = player.y - H / 2;
    ctx.save();
    ctx.translate(-camX, -camY);

    // Cuadrícula de suelo
    const gs = 100;
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(camX / gs) * gs; x < camX + W + gs; x += gs) {
      ctx.moveTo(x, camY); ctx.lineTo(x, camY + H);
    }
    for (let y = Math.floor(camY / gs) * gs; y < camY + H + gs; y += gs) {
      ctx.moveTo(camX, y); ctx.lineTo(camX + W, y);
    }
    ctx.stroke();

    // Borde del mapa
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, WORLD, WORLD);

    // Obstáculos
    for (const o of obstacles) {
      if (o.x > camX + W || o.x + o.w < camX || o.y > camY + H || o.y + o.h < camY) continue;
      ctx.fillStyle = o.color;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 3;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      if (o.type === 'caja') {
        ctx.beginPath();
        ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y + o.h);
        ctx.moveTo(o.x + o.w, o.y); ctx.lineTo(o.x, o.y + o.h);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(o.x + 8, o.y + 8, o.w - 16, o.h - 16);
      }
    }

    // Objetos en el suelo
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px sans-serif';
    for (const it of loot) {
      if (it.x < camX - 40 || it.x > camX + W + 40 || it.y < camY - 40 || it.y > camY + H + 40) continue;
      if (it.kind === 'med') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(it.x - 8, it.y - 8, 16, 16);
        ctx.fillStyle = '#e53935';
        ctx.fillRect(it.x - 2, it.y - 6, 4, 12);
        ctx.fillRect(it.x - 6, it.y - 2, 12, 4);
      } else {
        const w = WEAPONS[it.weapon];
        ctx.fillStyle = w.color;
        ctx.fillRect(it.x - 10, it.y - 6, 20, 12);
        ctx.fillStyle = '#000';
        ctx.fillText(w.name, it.x, it.y - 10);
      }
    }

    // Zona de peligro
    ctx.beginPath();
    ctx.rect(camX - 3000, camY - 3000, W + 6000, H + 6000);
    ctx.moveTo(zone.cx + zone.radius, zone.cy);
    ctx.arc(zone.cx, zone.cy, zone.radius, 0, TAU, true);
    ctx.fillStyle = 'rgba(200,30,30,0.28)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(zone.cx, zone.cy, zone.radius, 0, TAU);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Balas
    ctx.lineWidth = 3;
    for (const b of bullets) {
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.stroke();
    }

    // Jugadores y bots (el jugador se dibuja al final, encima de todos)
    const drawList = [...bots, player];
    for (const e of drawList) {
      if (!e.alive) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(e.x + 3, e.y + 4, e.r, 0, TAU);
      ctx.fill();

      ctx.fillStyle = e.flash > 0 ? '#ffffff' : (e.isPlayer ? '#1e88e5' : '#e53935');
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.stroke();

      const g = WEAPONS[e.weapon];
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(e.angle) * e.r * 0.4, e.y + Math.sin(e.angle) * e.r * 0.4);
      ctx.lineTo(e.x + Math.cos(e.angle) * (e.r + 10), e.y + Math.sin(e.angle) * (e.r + 10));
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(e.name, e.x, e.y - e.r - 14);
      ctx.fillStyle = '#333';
      ctx.fillRect(e.x - 18, e.y - e.r - 8, 36, 4);
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(e.x - 18, e.y - e.r - 8, 36 * (e.hp / 100), 4);
    }

    ctx.restore();

    // Controles táctiles (coordenadas de pantalla)
    if (state === 'playing') drawTouchUI();
  }

  function drawTouchUI() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const p of pointers.values()) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.ox, p.oy, 60, 0, TAU);
      ctx.stroke();
      const dx = p.x - p.ox, dy = p.y - p.oy;
      const len = Math.min(60, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      ctx.fillStyle = p.kind === 'aim' ? 'rgba(255,80,80,0.6)' : 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(p.ox + Math.cos(a) * len, p.oy + Math.sin(a) * len, 24, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.arc(healBtn.x, healBtn.y, healBtn.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', healBtn.x, healBtn.y + 2);
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- Entrada ----------
  window.addEventListener('keydown', (e) => {
    keyState[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (state === 'playing' && !e.repeat && e.code === 'KeyH') useMed(player);
  });
  window.addEventListener('keyup', (e) => { keyState[e.code] = false; });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state !== 'playing') return;
    if (e.pointerType === 'mouse') {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (e.button === 0) mouseDown = true;
      return;
    }
    const x = e.clientX, y = e.clientY;
    if (dist(x, y, healBtn.x, healBtn.y) < healBtn.r) {
      useMed(player);
      return;
    }
    const kind = x < W * 0.5 ? 'move' : 'aim';
    let taken = false;
    for (const p of pointers.values()) if (p.kind === kind) taken = true;
    if (!taken) pointers.set(e.pointerId, { kind, ox: x, oy: y, x, y });
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      return;
    }
    const p = pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
  });

  const endPointer = (e) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) mouseDown = false;
      return;
    }
    pointers.delete(e.pointerId);
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  $('play').addEventListener('click', startGame);
  $('again').addEventListener('click', startGame);

  // ---------- Ciclo principal ----------
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    healBtn = { x: W - 80, y: H - 170, r: 42 };
    mouse.x = W / 2;
    mouse.y = H / 2;
  }

  function frame(ts) {
    const dt = Math.min(0.05, Math.max(0, (ts - lastTime) / 1000));
    lastTime = ts;
    if (state === 'playing') update(dt);
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame((ts) => { lastTime = ts; frame(ts); });
})();
