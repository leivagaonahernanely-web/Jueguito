// Lógica del juego (sin Three.js): mapa, jugadores, bots, balas, granadas, zona y botín.
import {
  WORLD, PLAYER_SPEED, ADS_SPEED_MULT, BOT_SPEED, PLAYER_RADIUS, BOT_COUNT, HOUSE_COUNT, CRATE_COUNT,
  TREE_COUNT, LOOT_WEAPONS, LOOT_MEDS, LOOT_GRENADES, LOOT_ARMOR, MAX_MEDS, MAX_GRENADES, HEAL_AMOUNT,
  WEAPONS, WEAPON_WEIGHTS, GRENADE, ZONE_PHASES, ZONE_START_RADIUS,
  CHARACTERS, CHARACTER_IDS, SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  AIRDROP_FIRST, AIRDROP_EVERY,
} from './config.js';

export const G = {
  state: 'menu',          // 'menu' | 'playing' | 'over'
  player: null,
  bots: [],
  entities: [],
  obstacles: [],          // { shape:'rect'|'circle', kind, x, z, w,d | r, h, color }
  loot: [],               // { id, x, z, kind:'weapon'|'med'|'grenade'|'armor', weapon, lock }
  bullets: [],
  grenades: [],           // { id, x,y,z, vx,vy,vz, t, owner }
  feed: [],
  events: [],             // shot, impact, hit, hurt, kill, explosion, pickup, headshot, reload, heal, throw
  zone: null,
  elapsed: 0,
  nextId: 1,
  place: 0,
  won: false,
  playerName: 'Tú',
  airdrop: null,          // { x, z, ids, t } suministro activo en el mapa (marcador en el minimapa)
  airdropT: 0,            // segundos hasta el próximo suministro
};

const HOUSE_COLORS = ['#d7ccc8', '#bcaaa4', '#efebe9', '#ffe0b2', '#c5e1a5', '#b0bec5', '#f8bbd0', '#ffccbc'];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function pickWeaponKey() {
  const names = Object.keys(WEAPON_WEIGHTS);
  const total = names.reduce((s, k) => s + WEAPON_WEIGHTS[k], 0);
  let r = Math.random() * total;
  for (const k of names) {
    r -= WEAPON_WEIGHTS[k];
    if (r <= 0) return k;
  }
  return 'pistola';
}

// ---------- Geometría del mapa ----------
export function blockedAt(x, y, z) {
  for (const o of G.obstacles) {
    if (o.shape === 'rect') {
      if (y < o.h && x >= o.x && x <= o.x + o.w && z >= o.z && z <= o.z + o.d) return true;
    } else if (y < o.h && Math.hypot(x - o.x, z - o.z) < o.r) {
      return true;
    }
  }
  return false;
}

function losClear(x1, z1, x2, z2) {
  const d = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.ceil(d / 1.2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blockedAt(x1 + (x2 - x1) * t, 1.2, z1 + (z2 - z1) * t)) return false;
  }
  return true;
}

function fitsRect(x, z, w, d, pad) {
  for (const o of G.obstacles) {
    if (o.shape === 'rect') {
      if (x < o.x + o.w + pad && x + w > o.x - pad && z < o.z + o.d + pad && z + d > o.z - pad) return false;
    } else {
      const cx = clamp(o.x, x, x + w), cz = clamp(o.z, z, z + d);
      if (Math.hypot(o.x - cx, o.z - cz) < o.r + pad) return false;
    }
  }
  return true;
}

function fitsCircle(x, z, r, pad) {
  for (const o of G.obstacles) {
    if (o.shape === 'rect') {
      const cx = clamp(x, o.x, o.x + o.w), cz = clamp(z, o.z, o.z + o.d);
      if (Math.hypot(x - cx, z - cz) < r + pad) return false;
    } else if (Math.hypot(x - o.x, z - o.z) < r + o.r + pad) {
      return false;
    }
  }
  return true;
}

export function genMap() {
  G.obstacles = [];
  let n = 0, t = 0;
  while (n < HOUSE_COUNT && t < 8000) {
    t++;
    const w = rand(7, 13), d = rand(7, 13), h = rand(4.5, 8);
    const x = rand(8, WORLD - 8 - w), z = rand(8, WORLD - 8 - d);
    if (!fitsRect(x, z, w, d, 2.5)) continue;
    G.obstacles.push({ shape: 'rect', kind: 'casa', x, z, w, d, h, color: pick(HOUSE_COLORS) });
    n++;
  }
  n = 0; t = 0;
  while (n < CRATE_COUNT && t < 6000) {
    t++;
    const s = rand(1.4, 2.2);
    const x = rand(4, WORLD - 4 - s), z = rand(4, WORLD - 4 - s);
    if (!fitsRect(x, z, s, s, 1.2)) continue;
    G.obstacles.push({ shape: 'rect', kind: 'caja', x, z, w: s, d: s, h: 1.4, color: '#9c6b3c' });
    n++;
  }
  n = 0; t = 0;
  while (n < TREE_COUNT && t < 6000) {
    t++;
    const r = rand(0.4, 0.55);
    const x = rand(4, WORLD - 4), z = rand(4, WORLD - 4);
    if (!fitsCircle(x, z, r, 1.5)) continue;
    G.obstacles.push({ shape: 'circle', kind: 'arbol', x, z, r, h: 2.4 });
    n++;
  }
}

function freeSpot(r = PLAYER_RADIUS) {
  for (let i = 0; i < 1000; i++) {
    const x = rand(5, WORLD - 5), z = rand(5, WORLD - 5);
    if (fitsCircle(x, z, r, 0.3)) return { x, z };
  }
  return { x: WORLD / 2, z: WORLD / 2 };
}

// ---------- Entidades ----------
function makeEntity(p, name, isPlayer, colorIdx, charId = 'recluta') {
  const ch = CHARACTERS[charId] || CHARACTERS.recluta;
  return {
    id: G.nextId++, x: p.x, z: p.z, r: PLAYER_RADIUS, name, isPlayer, colorIdx,
    charId, look: ch.look, speedMult: ch.speed, healMult: ch.healMult, medMax: ch.medMax,
    hp: ch.hp, maxHp: ch.hp, stamina: STAMINA_MAX, sprinting: false,
    armor: 0, alive: true, kills: 0,
    weapon: 'pistola', ammo: WEAPONS.pistola.mag, reloadT: 0,
    meds: 0, grenades: 0, cool: 0, bloom: 0, healT: 0, throwT: 0, shots: 0,
    yaw: 0, pitch: 0, moving: false, walk: 0, flash: 0, ads: false,
    lastKiller: null, lastWeapon: '',
    // IA de bots
    target: null, goal: null, thinkT: 0, grenadeT: 0,
    wanderX: p.x, wanderZ: p.z, wanderT: 0, strafe: Math.random() < 0.5 ? 1 : -1,
  };
}

function moveEnt(e, dx, dz) {
  if (dx !== 0 || dz !== 0) e.moving = true;
  e.x += dx;
  e.z += dz;
  resolveCollisions(e);
}

function resolveCollisions(e) {
  e.x = clamp(e.x, e.r, WORLD - e.r);
  e.z = clamp(e.z, e.r, WORLD - e.r);
  for (const o of G.obstacles) {
    if (o.shape === 'rect') {
      const cx = clamp(e.x, o.x, o.x + o.w);
      const cz = clamp(e.z, o.z, o.z + o.d);
      const dx = e.x - cx, dz = e.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < e.r * e.r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const p = (e.r - d) / d;
          e.x += dx * p;
          e.z += dz * p;
        } else {
          const left = e.x - o.x, right = o.x + o.w - e.x;
          const up = e.z - o.z, down = o.z + o.d - e.z;
          const m = Math.min(left, right, up, down);
          if (m === left) e.x = o.x - e.r;
          else if (m === right) e.x = o.x + o.w + e.r;
          else if (m === up) e.z = o.z - e.r;
          else e.z = o.z + o.d + e.r;
        }
      }
    } else {
      const dx = e.x - o.x, dz = e.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = e.r + o.r;
      if (d < min && d > 1e-8) {
        const p = (min - d) / d;
        e.x += dx * p;
        e.z += dz * p;
      }
    }
  }
}

function stepToward(e, tx, tz, speed, dt) {
  const dx = tx - e.x, dz = tz - e.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  e.yaw = Math.atan2(dx, dz);
  const s = speed * (e.speedMult || 1);
  moveEnt(e, (dx / len) * s * dt, (dz / len) * s * dt);
}

function normalize(d, noise = 0) {
  const x = d.x + rand(-noise, noise);
  const y = d.y + rand(-noise, noise);
  const z = d.z + rand(-noise, noise);
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function aimDirAt(tx, ty, tz, ex, ey, ez) {
  const dx = tx - ex, dy = ty - ey, dz = tz - ez;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function aimDirPlayer(p) {
  const cp = Math.cos(p.pitch);
  return { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: Math.cos(p.yaw) * cp };
}

export function startReload(e) {
  if (!e.alive || e.reloadT > 0 || e.ammo === WEAPONS[e.weapon].mag) return;
  e.reloadT = WEAPONS[e.weapon].reload;
  G.events.push({ type: 'reload', id: e.id });
}

function fireWeapon(e, dir) {
  if (!e.alive || e.cool > 0 || e.reloadT > 0 || e.sprinting) return;
  const w = WEAPONS[e.weapon];
  if (e.ammo <= 0) { startReload(e); return; }
  e.ammo--;
  e.cool = w.rate;
  e.shots++;
  e.bloom = Math.min(1.2, e.bloom + w.bloom);
  if (e.ammo === 0) startReload(e);

  const aimMult = e.ads ? 0.35 : 1;
  const moveMult = e.isPlayer && e.moving ? 1.6 : 1;
  const spread = w.spread * aimMult * moveMult + e.bloom * 0.04 * aimMult;

  const ox = e.x + dir.x * 0.6;
  const oy = 1.35 + dir.y * 0.6;
  const oz = e.z + dir.z * 0.6;
  for (let i = 0; i < w.pellets; i++) {
    const d = normalize(dir, spread);
    G.bullets.push({
      x: ox, y: oy, z: oz,
      vx: d.x * w.speed, vy: d.y * w.speed, vz: d.z * w.speed,
      traveled: 0, range: w.range, dmg: w.dmg, owner: e, weapon: e.weapon,
    });
  }
  if (e.isPlayer) e.pitch = clamp(e.pitch + w.recoil * (e.ads ? 0.5 : 1), -0.9, 0.9);
  G.events.push({ type: 'shot', id: e.id, x: ox, y: oy, z: oz, weapon: e.weapon, dir });
}

export function throwGrenade(e, dir) {
  if (!e.alive || e.grenades <= 0 || e.throwT > 0) return;
  e.grenades--;
  e.throwT = 0.45;
  G.grenades.push({
    id: G.nextId++,
    x: e.x + dir.x * 0.5, y: 1.5 + dir.y * 0.5, z: e.z + dir.z * 0.5,
    vx: dir.x * GRENADE.speed, vy: dir.y * GRENADE.speed + 3, vz: dir.z * GRENADE.speed,
    t: GRENADE.fuse, owner: e,
  });
  G.events.push({ type: 'throw', id: e.id });
}

export function useMed(e) {
  if (!e.alive || e.meds <= 0 || e.hp >= e.maxHp || e.healT > 0) return;
  e.meds--;
  e.healT = 1.1;
  G.events.push({ type: 'heal', id: e.id });
  e.hp = Math.min(e.maxHp, e.hp + HEAL_AMOUNT * (e.healMult || 1));
}

function damage(e, amt, src, label = '', head = false) {
  if (!e.alive) return;
  if (e.armor > 0) {
    const a = Math.min(e.armor, amt * 0.6);
    e.armor -= a;
    amt -= a;
  }
  e.hp -= amt;
  e.flash = 0.14;
  e.lastKiller = src ? src.name : '';
  e.lastWeapon = label;
  if (e.isPlayer && src !== e) G.events.push({ type: 'hurt', amt });
  if (src && src.isPlayer && e !== src) G.events.push({ type: 'hit', victim: e.id, head });
  if (e.hp <= 0) kill(e, src, label);
}

function addFeed(text) {
  G.feed.push({ text, t: G.elapsed });
  if (G.feed.length > 6) G.feed.shift();
}

function kill(e, src, label) {
  e.hp = 0;
  e.alive = false;
  if (e.weapon !== 'pistola') G.loot.push({ id: G.nextId++, x: e.x, z: e.z, kind: 'weapon', weapon: e.weapon, lock: 0 });
  for (let i = 0; i < e.meds; i++) {
    G.loot.push({ id: G.nextId++, x: e.x + rand(-0.8, 0.8), z: e.z + rand(-0.8, 0.8), kind: 'med', lock: 0 });
  }
  for (let i = 0; i < e.grenades; i++) {
    G.loot.push({ id: G.nextId++, x: e.x + rand(-0.8, 0.8), z: e.z + rand(-0.8, 0.8), kind: 'grenade', lock: 0 });
  }
  if (e.armor > 0) G.loot.push({ id: G.nextId++, x: e.x, z: e.z, kind: 'armor', lock: 0 });

  let msg;
  if (src && src !== e) {
    src.kills++;
    msg = `${src.name} ➜ ${e.name}  (${label})`;
  } else {
    msg = `${e.name} eliminado por la zona`;
  }
  addFeed(msg);
  G.events.push({ type: 'kill', victim: e.id, killer: src ? src.id : 0 });
  if (e.isPlayer) endGame(false);
}

function tryPickup(e) {
  for (let i = G.loot.length - 1; i >= 0; i--) {
    const it = G.loot[i];
    if (it.lock > 0) continue;
    if (Math.hypot(e.x - it.x, e.z - it.z) > e.r + 1.1) continue;
    if (it.kind === 'med') {
      if (e.meds >= (e.medMax || MAX_MEDS)) continue;
      e.meds++;
    } else if (it.kind === 'grenade') {
      if (e.grenades >= MAX_GRENADES) continue;
      e.grenades++;
    } else if (it.kind === 'armor') {
      if (e.armor >= (e.isPlayer ? 100 : 50)) continue;
      e.armor = Math.min(100, e.armor + 50);
    } else {
      const cur = e.weapon, want = it.weapon;
      if (e.isPlayer && want === cur) {
        e.ammo = WEAPONS[want].mag;
        e.reloadT = 0;
      } else {
        const better = WEAPONS[want].rank > WEAPONS[cur].rank;
        if (!e.isPlayer && !better) continue;
        // El arma anterior queda en el suelo, bloqueada un momento para no recogerla de nuevo
        G.loot.push({ id: G.nextId++, x: e.x, z: e.z, kind: 'weapon', weapon: cur, lock: 1.5 });
        e.weapon = want;
        e.ammo = WEAPONS[want].mag;
        e.reloadT = 0;
      }
    }
    G.loot.splice(i, 1);
    if (e.isPlayer) G.events.push({ type: 'pickup', kind: it.kind, weapon: it.weapon });
  }
}

// ---------- Granadas ----------
function updateGrenades(dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const g = G.grenades[i];
    g.vy -= 15 * dt;
    const n = 4;
    for (let s = 0; s < n; s++) {
      const px = g.x, pz = g.z;
      g.x += (g.vx * dt) / n;
      g.y += (g.vy * dt) / n;
      g.z += (g.vz * dt) / n;
      if (blockedAt(g.x, g.y, g.z)) {
        if (!blockedAt(g.x, g.y, pz)) { g.z = pz; g.vz *= -0.35; }
        else if (!blockedAt(px, g.y, g.z)) { g.x = px; g.vx *= -0.35; }
        else { g.x = px; g.z = pz; g.vx *= -0.3; g.vz *= -0.3; }
      }
      if (g.y < 0.12) {
        g.y = 0.12;
        g.vy = -g.vy * 0.35;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
    }
    g.t -= dt;
    if (g.t <= 0) {
      explode(g);
      G.grenades.splice(i, 1);
    }
  }
}

function explode(g) {
  G.events.push({ type: 'explosion', x: g.x, y: g.y, z: g.z, radius: GRENADE.radius });
  for (const e of G.entities) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - g.x, e.z - g.z, 0.9 - g.y);
    if (d < GRENADE.radius) {
      const amt = GRENADE.dmg * (1 - d / GRENADE.radius) * (1 - d / GRENADE.radius * 0.3);
      damage(e, amt, g.owner, 'Granada');
    }
  }
}

// ---------- Zona ----------
function zoneDps() {
  return ZONE_PHASES[Math.min(G.zone.phase, ZONE_PHASES.length - 1)].dps;
}

function updateZone(dt) {
  const z = G.zone;
  if (z.phase >= ZONE_PHASES.length) return;
  const ph = ZONE_PHASES[z.phase];
  z.t += dt;
  if (z.state === 'hold') {
    if (z.t >= ph.hold) {
      z.state = 'shrink';
      z.t = 0;
      z.from = z.radius;
    }
  } else {
    const k = Math.min(1, z.t / ph.shrink);
    z.radius = z.from + (ph.radius - z.from) * k;
    if (k >= 1) {
      z.phase++;
      z.state = 'hold';
      z.t = 0;
      z.radius = ph.radius;
    }
  }
}

export function zoneText() {
  if (!G.zone) return '';
  if (G.zone.phase >= ZONE_PHASES.length) return 'Zona final';
  const ph = ZONE_PHASES[G.zone.phase];
  return G.zone.state === 'hold'
    ? `Zona cierra en ${Math.ceil(ph.hold - G.zone.t)}s`
    : `Cerrando zona: ${Math.ceil(ph.shrink - G.zone.t)}s`;
}

// ---------- Balas ----------
function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    const step = Math.hypot(b.vx, b.vy, b.vz) * dt;
    const n = Math.max(1, Math.ceil(step / 0.5));
    let gone = false;
    for (let s = 0; s < n && !gone; s++) {
      b.x += (b.vx * dt) / n;
      b.y += (b.vy * dt) / n;
      b.z += (b.vz * dt) / n;
      b.traveled += step / n;
      if (b.traveled > b.range || b.y < 0 || b.x < 0 || b.z < 0 || b.x > WORLD || b.z > WORLD) {
        G.events.push({ type: 'impact', x: b.x, y: Math.max(0, b.y), z: b.z, ground: true });
        gone = true;
        break;
      }
      if (blockedAt(b.x, b.y, b.z)) {
        G.events.push({ type: 'impact', x: b.x, y: b.y, z: b.z, ground: false });
        gone = true;
        break;
      }
      for (const e of G.entities) {
        if (!e.alive || e === b.owner) continue;
        if (Math.hypot(b.x - e.x, b.z - e.z) < e.r + 0.15 && b.y > 0 && b.y < 1.85) {
          const head = b.y > 1.5;
          const label = WEAPONS[b.weapon].name;
          damage(e, b.dmg * (head ? 1.8 : 1), b.owner, label, head);
          if (head && b.owner.isPlayer) G.events.push({ type: 'headshot' });
          G.events.push({ type: 'impact', x: b.x, y: b.y, z: b.z, ground: false, flesh: true });
          gone = true;
          break;
        }
      }
    }
    if (gone) G.bullets.splice(i, 1);
  }
}

// ---------- Jugador ----------
function updatePlayer(dt, input) {
  const p = G.player;
  if (!p.alive) return;
  p.yaw += input.dyaw;
  p.pitch = clamp(p.pitch + input.dpitch, -0.9, 0.9);
  p.ads = !!input.ads;

  let fwd = input.forward, str = input.strafe;
  const m = Math.hypot(fwd, str);
  if (m > 1) { fwd /= m; str /= m; }
  // Sprint: solo hacia adelante, sin apuntar y con resistencia; no se puede disparar mientras corres
  const sprinting = !!input.sprint && fwd > 0.3 && !p.ads && p.stamina > 0;
  if (sprinting) {
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
  } else {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);
  }
  p.sprinting = sprinting && p.stamina > 0;
  const speed = PLAYER_SPEED * p.speedMult * (p.ads ? ADS_SPEED_MULT : 1) * (p.sprinting ? SPRINT_MULT : 1);
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const rx = -fz, rz = fx;
  moveEnt(p, (fx * fwd + rx * str) * speed * dt, (fz * fwd + rz * str) * speed * dt);

  if (input.fire) fireWeapon(p, aimDirPlayer(p));
  if (input.reload) startReload(p);
  if (input.heal) useMed(p);
  if (input.grenade) throwGrenade(p, aimDirPlayer(p));
  tryPickup(p);
}

// ---------- Bots ----------
function updateBot(b, dt) {
  b.thinkT -= dt;
  if (b.thinkT <= 0) {
    b.thinkT = rand(0.2, 0.35);
    if (b.target && (!b.target.alive || !losClear(b.x, b.z, b.target.x, b.target.z))) b.target = null;
    if (!b.target) {
      let best = 60;
      for (const e of G.entities) {
        if (e === b || !e.alive) continue;
        const d = Math.hypot(b.x - e.x, b.z - e.z);
        if (d < best && losClear(b.x, b.z, e.x, e.z)) {
          best = d;
          b.target = e;
        }
      }
    }
    b.goal = null;
    if (!b.target) {
      const w = WEAPONS[b.weapon];
      if (w.rank < 4 || b.meds < 2) {
        let bestL = 40;
        for (const it of G.loot) {
          if (it.lock > 0) continue;
          const d = Math.hypot(b.x - it.x, b.z - it.z);
          if (d < bestL) { bestL = d; b.goal = it; }
        }
      }
    }
  }
  if (b.goal && !G.loot.includes(b.goal)) b.goal = null;
  if (b.hp < b.maxHp * 0.5 && b.meds > 0 && !b.target) useMed(b);

  const w = WEAPONS[b.weapon];
  const outsideZone = Math.hypot(b.x - G.zone.cx, b.z - G.zone.cz) > G.zone.radius - 6;

  if (b.target && b.target.alive) {
    const t = b.target;
    const d = Math.hypot(b.x - t.x, b.z - t.z);
    b.yaw = Math.atan2(t.x - b.x, t.z - b.z);
    if (d > w.range * 0.5) {
      stepToward(b, t.x, t.z, BOT_SPEED, dt);
    } else {
      if (Math.random() < dt * 0.6) b.strafe *= -1;
      const perp = b.yaw + (Math.PI / 2) * b.strafe;
      moveEnt(b, Math.cos(perp) * 2.4 * dt, Math.sin(perp) * 2.4 * dt);
    }
    // Granadas contra enemigos a media distancia
    b.grenadeT -= dt;
    if (b.grenades > 0 && d > 12 && d < 24 && b.grenadeT <= 0 && Math.random() < dt * 0.4) {
      b.grenadeT = 6;
      const dir = aimDirAt(t.x, 0.9, t.z, b.x, 1.4, b.z);
      throwGrenade(b, { x: dir.x, y: 0.35, z: dir.z });
    }
    if (d < w.range * 0.85) {
      const noise = w.pellets > 1 ? 0.03 : 0.075 + d * 0.0009;
      fireWeapon(b, normalize(aimDirAt(t.x, 1.0, t.z, b.x, 1.35, b.z), noise));
    }
  } else if (outsideZone) {
    stepToward(b, G.zone.cx, G.zone.cz, BOT_SPEED, dt);
  } else if (b.goal) {
    stepToward(b, b.goal.x, b.goal.z, BOT_SPEED * 1.05, dt);
  } else {
    if (b.ammo < w.mag * 0.3) startReload(b);
    b.wanderT -= dt;
    if (b.wanderT <= 0 || Math.hypot(b.x - b.wanderX, b.z - b.wanderZ) < 1.5) {
      const s = freeSpot();
      b.wanderX = s.x;
      b.wanderZ = s.z;
      b.wanderT = rand(3, 6);
    }
    stepToward(b, b.wanderX, b.wanderZ, BOT_SPEED * 0.6, dt);
  }
  tryPickup(b);
}

// ---------- Partida ----------
export function startMatch(name = 'Tú', charId = 'recluta') {
  G.nextId = 1;
  G.playerName = name || 'Tú';
  genMap();
  G.bots = [];
  G.loot = [];
  G.bullets = [];
  G.grenades = [];
  G.feed = [];
  G.events = [];
  G.elapsed = 0;
  G.won = false;
  G.place = 0;

  const ps = freeSpot();
  G.player = makeEntity(ps, G.playerName, true, 0, CHARACTERS[charId] ? charId : 'recluta');
  G.player.grenades = 1;
  G.airdrop = null;
  G.airdropT = AIRDROP_FIRST;
  for (let i = 0; i < BOT_COUNT; i++) {
    const s = freeSpot();
    const bot = CHARACTER_IDS[(Math.random() * CHARACTER_IDS.length) | 0];
    G.bots.push(makeEntity(s, `Bot ${i + 1}`, false, 1 + (i % 7), bot));
  }
  G.entities = [G.player, ...G.bots];

  const addLoot = (kind, count, extra = {}) => {
    for (let i = 0; i < count; i++) {
      const s = freeSpot(0.6);
      G.loot.push({ id: G.nextId++, x: s.x, z: s.z, kind, lock: 0, ...extra });
    }
  };
  for (let i = 0; i < LOOT_WEAPONS; i++) {
    const s = freeSpot(0.6);
    G.loot.push({ id: G.nextId++, x: s.x, z: s.z, kind: 'weapon', weapon: pickWeaponKey(), lock: 0 });
  }
  addLoot('med', LOOT_MEDS);
  addLoot('grenade', LOOT_GRENADES);
  addLoot('armor', LOOT_ARMOR);

  G.zone = {
    phase: 0, state: 'hold', t: 0,
    radius: ZONE_START_RADIUS, from: ZONE_START_RADIUS,
    cx: WORLD / 2, cz: WORLD / 2,
  };
  G.state = 'playing';
}

// ---------- Suministros aéreos ----------
function spawnAirdrop() {
  const s = freeSpot(1.2);
  const ids = [];
  const add = (kind, extra = {}) => {
    const id = G.nextId++;
    ids.push(id);
    G.loot.push({ id, x: s.x + rand(-1.5, 1.5), z: s.z + rand(-1.5, 1.5), kind, lock: 0, ...extra });
  };
  add('weapon', { weapon: 'francotirador' });
  add('weapon', { weapon: 'rifle' });
  add('med');
  add('armor');
  add('grenade');
  G.airdrop = { x: s.x, z: s.z, ids, t: 90 };
  G.airdropT = AIRDROP_EVERY;
  addFeed('📦 ¡Suministro aéreo en el mapa!');
  G.events.push({ type: 'airdrop', x: s.x, z: s.z });
}

function updateAirdrops(dt) {
  if (G.airdropT > 0) {
    G.airdropT -= dt;
    if (G.airdropT <= 0) spawnAirdrop();
  }
  if (G.airdrop) {
    G.airdrop.t -= dt;
    const left = G.loot.some((it) => G.airdrop.ids.includes(it.id));
    if (G.airdrop.t <= 0 || !left) G.airdrop = null;
  }
}

function endGame(won) {
  if (G.state !== 'playing') return;
  G.state = 'over';
  G.won = won;
  G.place = won ? 1 : G.bots.filter((b) => b.alive).length + 1;
}

function checkWin() {
  if (G.state === 'playing' && G.player.alive && G.bots.every((b) => !b.alive)) endGame(true);
}

export function update(dt, input) {
  G.elapsed += dt;
  G.entities = [G.player, ...G.bots];

  for (const e of G.entities) {
    e.moving = false;
    if (e.cool > 0) e.cool -= dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.healT > 0) e.healT -= dt;
    if (e.throwT > 0) e.throwT -= dt;
    e.bloom = Math.max(0, e.bloom - dt * 2.4);
    if (e.reloadT > 0) {
      e.reloadT -= dt;
      if (e.reloadT <= 0) {
        e.reloadT = 0;
        e.ammo = WEAPONS[e.weapon].mag;
      }
    }
  }
  for (const it of G.loot) if (it.lock > 0) it.lock -= dt;

  updateZone(dt);
  for (const e of G.entities) {
    if (!e.alive) continue;
    if (Math.hypot(e.x - G.zone.cx, e.z - G.zone.cz) > G.zone.radius) damage(e, zoneDps() * dt, null, 'Zona');
  }

  updatePlayer(dt, input);
  for (const b of G.bots) if (b.alive) updateBot(b, dt);
  updateAirdrops(dt);
  updateBullets(dt);
  updateGrenades(dt);

  for (const e of G.entities) if (e.moving) e.walk += dt * 9 * (e.sprinting ? 1.5 : 1);

  G.feed = G.feed.filter((f) => G.elapsed - f.t < 6);
  checkWin();
}
