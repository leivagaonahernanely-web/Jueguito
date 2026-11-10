// Punto de entrada: conecta lógica, render, entrada y HUD.
import { G, genMap, startMatch, update, zoneText } from './logic.js';
import { createView } from './render.js';
import { createInput } from './input.js';

const $ = (id) => document.getElementById(id);
const els = {
  alive: $('alive'), zone: $('zone'), kills: $('kills'),
  hpfill: $('hpfill'), hptext: $('hptext'),
  weapon: $('weapon'), ammo: $('ammo'), meds: $('meds'), feed: $('feed'),
  menu: $('menu'), end: $('end'), endTitle: $('endTitle'), endText: $('endText'),
  hitmarker: $('hitmarker'), damage: $('damage'),
  joy: $('joy'), joyKnob: $('joyKnob'),
  fire: $('btnFire'), reload: $('btnReload'), heal: $('btnHeal'),
  play: $('play'), again: $('again'),
};
const canvas = $('game');
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

// Mapa inicial para el fondo del menú
genMap();
const view = createView(canvas);
const input = createInput(canvas, els);

let endShown = false;
let hitTimer = 0;
let lastHpShown = 100;
let damageTimer = 0;

function startGame() {
  startMatch();
  view.reset();
  endShown = false;
  els.menu.classList.add('hidden');
  els.end.classList.add('hidden');
  if (!isTouchDevice && canvas.requestPointerLock) canvas.requestPointerLock();
}

els.play.addEventListener('click', startGame);
els.again.addEventListener('click', startGame);
canvas.addEventListener('click', () => {
  if (G.state === 'playing' && !isTouchDevice && !input.isLocked() && canvas.requestPointerLock) {
    canvas.requestPointerLock();
  }
});

window.addEventListener('resize', () => view.resize());

function updateHUD(dt) {
  if (G.state === 'menu') return;
  const p = G.player;
  const alive = G.entities.filter((e) => e.alive).length;
  els.alive.textContent = `Vivos: ${alive}`;
  els.zone.textContent = zoneText();
  els.kills.textContent = `Bajas: ${p.kills}`;
  const hp = Math.max(0, Math.ceil(p.hp));
  els.hpfill.style.width = `${hp}%`;
  els.hptext.textContent = hp;
  if (p.hp < lastHpShown) damageTimer = 0.4;
  lastHpShown = p.hp;
  els.damage.style.opacity = damageTimer > 0 ? String(Math.min(1, damageTimer * 2)) : '0';
  damageTimer = Math.max(0, damageTimer - dt);

  const w = WEAPONS_UI[p.weapon];
  els.weapon.textContent = w.name;
  els.ammo.textContent = p.reloadT > 0 ? 'Recargando…' : `${p.ammo}/${w.mag}`;
  els.meds.textContent = p.meds;
  els.feed.textContent = G.feed.map((f) => f.text).join('\n');

  if (hitTimer > 0) {
    hitTimer -= dt;
    els.hitmarker.classList.toggle('show', hitTimer > 0);
  }
}

// Datos mínimos de armas para el HUD (mismos nombres y cargadores que config.js)
const WEAPONS_UI = {
  pistola: { name: 'Pistola', mag: 12 },
  escopeta: { name: 'Escopeta', mag: 6 },
  rifle: { name: 'Rifle', mag: 30 },
  francotirador: { name: 'Francotirador', mag: 5 },
};

function showEnd() {
  els.endTitle.textContent = G.won ? '¡VICTORIA!' : 'ELIMINADO';
  els.endText.textContent = `Puesto #${G.place} · Bajas: ${G.player.kills}`;
  els.end.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
  last = ts;

  const inp = input.read();
  if (G.state === 'playing') {
    // Un golpe confirmado por el jugador activa la marca de impacto
    update(dt, inp);
    if (G.events.some((ev) => ev.type === 'hit')) hitTimer = 0.15;
    if (G.state === 'over' && !endShown) {
      endShown = true;
      showEnd();
    }
  }

  updateHUD(dt);
  view.render(dt, ts / 1000);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
