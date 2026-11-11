// Punto de entrada: menús, ajustes, bucle principal, HUD, mira, minimapa y sonido.
import { G, genMap, startMatch, update, zoneText } from './logic.js';
import { createView } from './render.js';
import { createInput } from './input.js';
import * as SFX from './audio.js';
import { WORLD, WEAPONS, MAX_MEDS, MAX_GRENADES, ZONE_PHASES, CHARACTERS, CHARACTER_IDS } from './config.js';

const $ = (id) => document.getElementById(id);
const els = {
  hud: $('hud'), alive: $('alive'), zone: $('zone'), kills: $('kills'), feed: $('feed'),
  hpfill: $('hpfill'), hptext: $('hptext'), armorfill: $('armorfill'),
  dmgdir: $('dmgdir'), banner: $('banner'),
  weapon: $('weapon'), ammo: $('ammo'), reloadfill: $('reloadfill'),
  grenades: $('grenades'), meds: $('meds'),
  damage: $('damage'), hitmarker: $('hitmarker'), cross: $('cross'),
  minimap: $('minimap'),
  joy: $('joy'), joyKnob: $('joyKnob'),
  fire: $('btnFire'), ads: $('btnAds'), reload: $('btnReload'), heal: $('btnHeal'), grenade: $('btnGrenade'),
  sprint: $('btnSprint'), stamfill: $('stamfill'),
  lobby: $('lobby'), lobbyCount: $('lobbyCount'), lobbyStatus: $('lobbyStatus'), charGrid: $('charGrid'),
  charInfo: $('charInfo'), lobbyPlayers: $('lobbyPlayers'), lobbyStart: $('lobbyStart'), lobbyBack: $('lobbyBack'),
  countdown: $('countdown'), countText: $('countText'),
  menu: $('menu'), name: $('name'), play: $('play'),
  openControls: $('openControls'), openSettings: $('openSettings'),
  settings: $('settings'), sens: $('sens'), sensVal: $('sensVal'), vol: $('vol'), volVal: $('volVal'),
  quality: $('quality'), backSettings: $('backSettings'), resetSettings: $('resetSettings'),
  openSettingsPause: $('openSettingsPause'),
  controls: $('controls'), backControls: $('backControls'),
  pause: $('pause'), resume: $('resume'), toMenuPause: $('toMenuPause'),
  end: $('end'), endTitle: $('endTitle'), endText: $('endText'), again: $('again'), toMenuEnd: $('toMenuEnd'),
  fatal: $('fatal'), fatalText: $('fatalText'),
};

// ----- Manejo de errores visible (para no quedarse en pantalla negra) -----
function showFatal(msg) {
  els.fatalText.textContent = msg;
  els.fatal.classList.remove('hidden');
}
window.addEventListener('error', (e) => showFatal(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => showFatal(String(e.reason?.message || e.reason)));

// ----- Ajustes persistentes -----
const DEFAULTS = { sens: 1, vol: 0.6, quality: 'alta', name: '', char: 'recluta' };
if (!CHARACTERS[DEFAULTS.char]) DEFAULTS.char = 'recluta';
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('br3d') || '{}') };
} catch (_) { /* ajustes por defecto */ }
if (!CHARACTERS[settings.char]) settings.char = 'recluta';
function saveSettings() {
  try { localStorage.setItem('br3d', JSON.stringify(settings)); } catch (_) { /* sin almacenamiento */ }
}

// ----- Inicialización -----
let view, input;
const canvas = $('game');
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
const minimapCtx = els.minimap.getContext('2d');

let paused = false;
let frozen = false;      // cuenta regresiva
let endShown = false;
let hitTimer = 0;
let damageTimer = 0;
let lastHpShown = 100;
let dirT = 0;            // tiempo que se ve la flecha de daño
let dirAngle = 0;        // dirección del atacante relativa a tu mira
let bannerT = 0;         // tiempo que se ve el banner de eliminación
let streak = 0;          // eliminaciones seguidas
let lastKillT = -99;

try {
  genMap();
  view = createView(canvas);
  view.applyQuality(settings.quality);
  view.loadPost();
  input = createInput(canvas, els, settings);
} catch (err) {
  showFatal('Tu navegador o dispositivo no soporta WebGL. ' + (err?.message || ''));
  throw err;
}

// Aplicar ajustes a la interfaz
els.sens.value = settings.sens;
els.vol.value = settings.vol;
els.quality.value = settings.quality;
els.name.value = settings.name;
const refreshSettingsLabels = () => {
  els.sensVal.textContent = Number(settings.sens).toFixed(2);
  els.volVal.textContent = Math.round(settings.vol * 100) + '%';
};
refreshSettingsLabels();

// ----- Navegación entre pantallas -----
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function showMenu() {
  hide(els.hud); hide(els.cross); hide(els.hitmarker); hide(els.countdown); hide(els.end); hide(els.pause);
  hide(els.settings); hide(els.controls); hide(els.lobby);
  show(els.menu);
}

// Los ajustes se pueden abrir desde el menú principal o desde la pausa
let settingsFrom = 'menu';
els.openSettings.addEventListener('click', () => { settingsFrom = 'menu'; hide(els.menu); show(els.settings); });
els.openSettingsPause.addEventListener('click', () => { settingsFrom = 'pause'; hide(els.pause); show(els.settings); });
els.backSettings.addEventListener('click', () => {
  hide(els.settings);
  if (settingsFrom === 'pause' && G.state === 'playing') show(els.pause);
  else show(els.menu);
});
els.resetSettings.addEventListener('click', () => {
  settings = { ...DEFAULTS, name: settings.name, char: settings.char };
  els.sens.value = settings.sens;
  els.vol.value = settings.vol;
  els.quality.value = settings.quality;
  refreshSettingsLabels();
  SFX.setVolume(settings.vol);
  view.applyQuality(settings.quality);
  saveSettings();
});

// Pide pantalla horizontal al empezar (en navegadores que lo permiten; el aviso cubre el resto)
function lockLandscape() {
  try {
    const o = screen.orientation;
    if (o && o.lock) o.lock('landscape').catch(() => {});
  } catch (_) { /* sin bloqueo de orientación */ }
}
els.openControls.addEventListener('click', () => { hide(els.menu); show(els.controls); });
els.backControls.addEventListener('click', () => { hide(els.controls); show(els.menu); });

els.sens.addEventListener('input', () => {
  settings.sens = Number(els.sens.value);
  refreshSettingsLabels();
  saveSettings();
});
els.vol.addEventListener('input', () => {
  settings.vol = Number(els.vol.value);
  SFX.setVolume(settings.vol);
  refreshSettingsLabels();
  saveSettings();
});
els.quality.addEventListener('change', () => {
  settings.quality = els.quality.value;
  view.applyQuality(settings.quality);
  saveSettings();
});

// ----- Partida -----
function requestLock() {
  if (!isTouchDevice && canvas.requestPointerLock) {
    try { canvas.requestPointerLock(); } catch (_) { /* sin bloqueo */ }
  }
}

function startGame() {
  lockLandscape();
  settings.name = (els.name.value || '').trim().slice(0, 14);
  saveSettings();
  SFX.initAudio(settings.vol);

  startMatch(settings.name || 'Tú', settings.char);
  view.reset();
  endShown = false;
  paused = false;
  lastHpShown = 100;
  streak = 0;
  lastKillT = -99;
  bannerT = 0;
  dirT = 0;
  els.banner.classList.add('hidden');
  els.dmgdir.classList.remove('show');
  hide(els.menu); hide(els.end); hide(els.pause); hide(els.settings); hide(els.controls); hide(els.lobby);
  show(els.hud); show(els.cross); show(els.hitmarker);
  requestLock();

  // Cuenta regresiva antes de empezar
  frozen = true;
  show(els.countdown);
  const steps = ['3', '2', '1', '¡YA!'];
  let i = 0;
  els.countText.textContent = steps[0];
  const tick = setInterval(() => {
    i++;
    if (i < steps.length) {
      els.countText.style.animation = 'none';
      void els.countText.offsetWidth;
      els.countText.style.animation = '';
      els.countText.textContent = steps[i];
    } else {
      clearInterval(tick);
      hide(els.countdown);
      frozen = false;
    }
  }, 700);
}

// ----- Sala de espera (lobby) -----
const LOBBY_NAMES = [
  'Lobo', 'Halcón', 'Sombra', 'Tigre', 'Kaiser', 'Nova', 'Ghost', 'Víbora', 'Rex', 'Pixel', 'Drako', 'Fénix',
  'Zorro', 'Blaze', 'Atlas', 'Kairo', 'Mambo', 'Thor', 'Ninja', 'Raptor', 'Luna', 'Ciclón', 'Nébula', 'Tormenta',
  'Bruno', 'Kira', 'Sable', 'Orión', 'Bisonte', 'Cobra', 'Titán', 'Lince', 'Furia', 'Quasar', 'Hunter', 'Rayo',
  'Maverick', 'Yeti', 'Vortex',
];
const LOBBY_SIZE = 30;
let lobbyPlayers = [];          // { name, me }
let lobbyFillT = null;          // intervalo que va llenando la sala
let lobbyStartT = null;         // inicio automático cuando la sala está llena

function stopLobby() {
  if (lobbyFillT) clearInterval(lobbyFillT);
  if (lobbyStartT) clearTimeout(lobbyStartT);
  lobbyFillT = null;
  lobbyStartT = null;
}

function renderCharCards() {
  els.charGrid.textContent = '';
  for (const id of CHARACTER_IDS) {
    const ch = CHARACTERS[id];
    const card = document.createElement('button');
    card.className = 'char-card' + (settings.char === id ? ' sel' : '');
    const sw = document.createElement('span');
    sw.className = 'char-swatch';
    sw.style.setProperty('--shirt', `#${ch.look.shirt.toString(16).padStart(6, '0')}`);
    sw.style.setProperty('--pants', `#${ch.look.pants.toString(16).padStart(6, '0')}`);
    const txt = document.createElement('span');
    const title = document.createElement('b');
    title.textContent = ch.name;
    const perk = document.createElement('small');
    perk.textContent = ch.perk;
    txt.append(title, perk);
    card.append(sw, txt);
    card.addEventListener('click', () => {
      settings.char = id;
      saveSettings();
      renderCharCards();
      showCharInfo();
    });
    els.charGrid.appendChild(card);
  }
  showCharInfo();
}

function showCharInfo() {
  const ch = CHARACTERS[settings.char];
  els.charInfo.textContent = `${ch.name}: ${ch.desc} (vida ${ch.hp})`;
}

function renderLobbyPlayers() {
  els.lobbyPlayers.textContent = '';
  for (const pl of lobbyPlayers) {
    const chip = document.createElement('span');
    chip.textContent = pl.name;
    if (pl.me) chip.className = 'me';
    els.lobbyPlayers.appendChild(chip);
  }
  els.lobbyCount.textContent = String(lobbyPlayers.length);
}

function openLobby() {
  stopLobby();
  hide(els.menu); hide(els.end); hide(els.settings); hide(els.controls); hide(els.pause);
  show(els.lobby);
  if (document.pointerLockElement) document.exitPointerLock();
  const myName = (els.name.value || '').trim().slice(0, 14) || 'Tú';
  lobbyPlayers = [{ name: myName, me: true }];
  renderLobbyPlayers();
  renderCharCards();
  els.lobbyStatus.textContent = 'Esperando a más jugadores…';
  lobbyFillT = setInterval(() => {
    if (lobbyPlayers.length >= LOBBY_SIZE) {
      clearInterval(lobbyFillT);
      lobbyFillT = null;
      els.lobbyStatus.textContent = 'Sala completa. La partida empieza en 4 s';
      lobbyStartT = setTimeout(startFromLobby, 4000);
      return;
    }
    const used = new Set(lobbyPlayers.map((p) => p.name));
    let name = LOBBY_NAMES[(Math.random() * LOBBY_NAMES.length) | 0];
    if (used.has(name)) name = `${name} ${lobbyPlayers.length}`;
    lobbyPlayers.push({ name, me: false });
    renderLobbyPlayers();
    els.lobbyStatus.textContent = `Esperando a más jugadores… (${LOBBY_SIZE - lobbyPlayers.length} faltan)`;
  }, 230);
}

function startFromLobby() {
  stopLobby();
  hide(els.lobby);
  startGame();
}

els.lobbyStart.addEventListener('click', startFromLobby);
els.lobbyBack.addEventListener('click', () => { stopLobby(); hide(els.lobby); show(els.menu); });

els.play.addEventListener('click', openLobby);
els.again.addEventListener('click', openLobby);
els.toMenuEnd.addEventListener('click', toMenu);
els.toMenuPause.addEventListener('click', toMenu);
els.resume.addEventListener('click', () => {
  paused = false;
  hide(els.pause);
  requestLock();
});

function toMenu() {
  G.state = 'menu';
  G.player = null;
  G.entities = [];
  G.bots = [];
  G.loot = [];
  G.bullets = [];
  G.grenades = [];
  G.feed = [];
  G.zone = null;
  paused = false;
  frozen = false;
  if (document.pointerLockElement) document.exitPointerLock();
  view.reset();
  showMenu();
}

// Pausa al perder el bloqueo del ratón (Esc) durante la partida
document.addEventListener('pointerlockchange', () => {
  if (G.state === 'playing' && !frozen && !isTouchDevice && !document.pointerLockElement) {
    paused = true;
    show(els.pause);
  }
});

function showEnd() {
  els.endTitle.textContent = G.won ? '¡VICTORIA!' : 'ELIMINADO';
  const kills = G.player ? G.player.kills : 0;
  els.endText.textContent = `Puesto #${G.place} de ${G.entities.length} · Bajas: ${kills}`;
  show(els.end);
  if (document.pointerLockElement) document.exitPointerLock();
}

// ----- Efectos de sonido y feedback según eventos del juego -----
function handleEvents() {
  const p = G.player;
  if (!p) return;
  for (const ev of G.events) {
    switch (ev.type) {
      case 'shot': {
        const d = Math.hypot(ev.x - p.x, ev.z - p.z);
        if (d < 70) SFX.playShot(ev.weapon);
        break;
      }
      case 'explosion':
        if (Math.hypot(ev.x - p.x, ev.z - p.z) < 45) SFX.playExplosion();
        break;
      case 'hurt':
        SFX.playHurt();
        damageTimer = 0.35;
        if (ev.sx != null) {
          // Ángulo del atacante respecto a donde miras (0 = enfrente, + = derecha)
          dirAngle = Math.atan2(ev.sx - p.x, ev.sz - p.z) - p.yaw;
          dirT = 1.0;
        }
        break;
      case 'hit':
        hitTimer = 0.16;
        els.hitmarker.classList.toggle('head', !!ev.head);
        SFX.playHitMarker(!!ev.head);
        break;
      case 'kill':
        if (ev.killer === p.id) {
          SFX.playKill();
          showKillBanner(ev.victim);
        }
        break;
      case 'pickup':
        SFX.playPickup();
        break;
      case 'airdrop':
        SFX.playPickup();
        break;
      case 'reload':
        if (ev.id === p.id) SFX.playReload();
        break;
      case 'heal':
        if (ev.id === p.id) SFX.playHeal();
        break;
      case 'throw':
        if (ev.id === p.id) SFX.playThrow();
        break;
      default:
        break;
    }
  }
}

// ----- Interfaz -----
const weaponName = (k) => WEAPONS[k]?.name ?? k;

// Banner al eliminar a alguien, con racha si eliminas varios seguidos
function showKillBanner(victimId) {
  const victim = G.entities.find((e) => e.id === victimId);
  streak = G.elapsed - lastKillT < 20 ? streak + 1 : 1;
  lastKillT = G.elapsed;
  const b = els.banner;
  b.textContent = `ELIMINASTE A ${victim ? victim.name : 'un enemigo'}`;
  if (streak >= 2) {
    const small = document.createElement('small');
    small.textContent = `¡RACHA x${streak}!`;
    b.appendChild(small);
  }
  b.classList.remove('hidden');
  b.style.opacity = '1';
  bannerT = 2.6;
}

function updateHUD(dt) {
  const p = G.player;
  if (!p) return;

  els.alive.textContent = `Vivos: ${G.entities.filter((e) => e.alive).length}`;
  els.zone.textContent = zoneText();
  els.kills.textContent = `Bajas: ${p.kills}`;

  const hp = Math.max(0, Math.ceil(p.hp));
  els.hpfill.style.width = `${hp}%`;
  els.hptext.textContent = hp;
  els.armorfill.style.width = `${Math.max(0, Math.min(100, p.armor))}%`;
  els.stamfill.style.width = `${Math.max(0, Math.min(100, Math.round(p.stamina)))}%`;

  const w = WEAPONS[p.weapon];
  els.weapon.textContent = weaponName(p.weapon);
  if (p.reloadT > 0) {
    els.ammo.textContent = 'Recargando';
    els.reloadfill.style.width = `${Math.round((1 - p.reloadT / w.reload) * 100)}%`;
  } else {
    els.ammo.textContent = `${p.ammo}/${w.mag}`;
    els.reloadfill.style.width = '0%';
  }
  els.grenades.textContent = `${p.grenades}/${MAX_GRENADES}`;
  els.meds.textContent = `${p.meds}/${MAX_MEDS}`;
  els.feed.textContent = G.feed.map((f) => f.text).join('\n');

  // Mira: se abre al disparar y al moverse, se cierra al apuntar
  const spread = 5 + p.bloom * 18 + (p.moving ? 4 : 0) + (p.reloadT > 0 ? 6 : 0);
  els.cross.style.setProperty('--sp', `${p.ads ? Math.max(2, spread * 0.35) : spread}px`);
  els.cross.classList.toggle('ads', !!p.ads);

  if (hitTimer > 0) {
    hitTimer -= dt;
    els.hitmarker.classList.toggle('show', hitTimer > 0);
  }
  // Flecha de dirección del daño
  if (dirT > 0) {
    dirT -= dt;
    els.dmgdir.style.transform = `rotate(${-dirAngle}rad)`;
    els.dmgdir.classList.toggle('show', dirT > 0);
  }
  // Banner de eliminación: se desvanece al final
  if (bannerT > 0) {
    bannerT -= dt;
    els.banner.style.opacity = String(Math.min(1, bannerT * 2));
    if (bannerT <= 0) els.banner.classList.add('hidden');
  }
  if (damageTimer > 0) {
    damageTimer -= dt;
    els.damage.style.opacity = String(Math.min(1, damageTimer * 3));
  } else {
    els.damage.style.opacity = '0';
  }
  lastHpShown = p.hp;
}

function drawMinimap() {
  const c = minimapCtx;
  const S = els.minimap.width;
  const k = S / WORLD;
  c.clearRect(0, 0, S, S);
  c.fillStyle = 'rgba(12, 22, 34, 0.75)';
  c.fillRect(0, 0, S, S);

  c.fillStyle = 'rgba(200, 210, 220, 0.55)';
  for (const o of G.obstacles) {
    if (o.shape === 'rect') {
      if (o.kind === 'casa') c.fillRect(o.x * k, o.z * k, o.w * k, o.d * k);
    } else {
      c.fillStyle = 'rgba(70, 140, 80, 0.8)';
      c.beginPath();
      c.arc(o.x * k, o.z * k, Math.max(1, o.r * k), 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(200, 210, 220, 0.55)';
    }
  }

  if (G.zone) {
    const cx = G.zone.cx * k, cz = G.zone.cz * k, r = G.zone.radius * k;
    c.fillStyle = 'rgba(255, 60, 60, 0.28)';
    c.beginPath();
    c.rect(0, 0, S, S);
    c.arc(cx, cz, r, 0, Math.PI * 2, true);
    c.fill('evenodd');
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cx, cz, r, 0, Math.PI * 2);
    c.stroke();
  }

  // Suministro aéreo activo: anillo dorado pulsante
  if (G.airdrop) {
    const ax = G.airdrop.x * k, az = G.airdrop.z * k;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    c.strokeStyle = `rgba(255, 215, 0, ${0.5 + 0.5 * pulse})`;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(ax, az, 7 + pulse * 3, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#ffd700';
    c.beginPath();
    c.arc(ax, az, 3, 0, Math.PI * 2);
    c.fill();
  }

  const p = G.player;
  if (p) {
    const x = p.x * k, z = p.z * k;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    c.fillStyle = '#4fc3f7';
    c.beginPath();
    c.moveTo(x + fx * 9, z + fz * 9);
    c.lineTo(x - fz * 5, z + fx * 5);
    c.lineTo(x + fz * 5, z - fx * 5);
    c.closePath();
    c.fill();
  }
}

// ----- Bucle principal -----
let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
  last = ts;

  const raw = input.read();
  if (G.state === 'playing') {
    if (paused) input.release();
    // Durante la cuenta regresiva y la pausa, todo el mundo queda congelado
    if (!frozen && !paused) {
      update(dt, raw);
      handleEvents();
      if (G.state === 'over' && !endShown) {
        endShown = true;
        showEnd();
      }
    }
    updateHUD(dt);
    drawMinimap();
  }

  view.render(dt, ts / 1000);
  requestAnimationFrame(frame);
}

// Arranque: mostrar menú principal
showMenu();
renderCharCards();
requestAnimationFrame(frame);
