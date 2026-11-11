// Configuración general del juego. Unidades en metros.

export const WORLD = 360;              // tamaño del mapa (cuadrado)
export const PLAYER_SPEED = 5.4;
export const ADS_SPEED_MULT = 0.6;     // caminar apuntando (mirilla) es más lento
export const BOT_SPEED = 4.3;
export const PLAYER_RADIUS = 0.45;
export const BOT_COUNT = 29;           // 29 bots + tú = 30 jugadores
export const HOUSE_COUNT = 44;
export const CRATE_COUNT = 70;
export const TREE_COUNT = 160;
export const LOOT_WEAPONS = 64;
export const LOOT_MEDS = 50;
export const LOOT_GRENADES = 26;
export const LOOT_ARMOR = 22;
export const MAX_MEDS = 5;
export const MAX_GRENADES = 3;
export const HEAL_AMOUNT = 35;
export const ZONE_START_RADIUS = 260;

// rank: qué tan buena es el arma (los bots cambian a una de mayor rango)
// bloom: cuánto se abre la dispersión al disparar; auto: disparo automático mantenido
export const WEAPONS = {
  pistola: {
    name: 'Pistola', dmg: 22, rate: 0.3, spread: 0.02, speed: 140, range: 75, mag: 12, reload: 1.0,
    pellets: 1, rank: 1, auto: false, recoil: 0.035, bloom: 0.22, color: 0xffd166,
  },
  subfusil: {
    name: 'Subfusil', dmg: 13, rate: 0.075, spread: 0.045, speed: 130, range: 55, mag: 30, reload: 1.6,
    pellets: 1, rank: 2, auto: true, recoil: 0.02, bloom: 0.09, color: 0x4cc9f0,
  },
  escopeta: {
    name: 'Escopeta', dmg: 12, rate: 0.85, spread: 0.095, speed: 110, range: 24, mag: 6, reload: 2.3,
    pellets: 8, rank: 3, auto: false, recoil: 0.12, bloom: 0.5, color: 0xef476f,
  },
  rifle: {
    name: 'Rifle de asalto', dmg: 25, rate: 0.105, spread: 0.024, speed: 185, range: 115, mag: 30, reload: 1.9,
    pellets: 1, rank: 4, auto: true, recoil: 0.045, bloom: 0.13, color: 0x06d6a0,
  },
  francotirador: {
    name: 'Francotirador', dmg: 100, rate: 1.3, spread: 0.0, speed: 290, range: 340, mag: 5, reload: 2.6,
    pellets: 1, rank: 5, auto: false, recoil: 0.2, bloom: 0.6, color: 0x118ab2,
  },
};

export const WEAPON_WEIGHTS = { pistola: 22, subfusil: 22, escopeta: 16, rifle: 26, francotirador: 10 };

export const GRENADE = { fuse: 2.2, speed: 15, radius: 7.5, dmg: 125 };

// Fases de la zona: espera, tiempo de cierre, radio objetivo y daño por segundo fuera de la zona
export const ZONE_PHASES = [
  { hold: 40, shrink: 25, radius: 150, dps: 1 },
  { hold: 30, shrink: 25, radius: 80,  dps: 3 },
  { hold: 25, shrink: 20, radius: 35,  dps: 6 },
  { hold: 20, shrink: 15, radius: 8,   dps: 12 },
];

// ----- Personajes (elegibles en el lobby) -----
// speed: multiplicador de velocidad · hp: vida máxima · healMult: multiplicador de botiquines
// medMax: botiquines que puede llevar · look: colores del modelo 3D
export const CHARACTERS = {
  recluta: {
    name: 'Recluta', perk: 'Equilibrado', desc: 'Sin ventajas ni desventajas. Ideal para aprender.',
    hp: 100, speed: 1.0, healMult: 1.0, medMax: 5,
    look: { shirt: 0x1e88e5, pants: 0x2b3a46, helmet: 0x3e4d2a, skin: 0xe0ac7e },
  },
  tanque: {
    name: 'Tanque', perk: '+25 vida · -10% velocidad', desc: 'Aguanta más golpes. Lento pero difícil de tumbar.',
    hp: 125, speed: 0.9, healMult: 1.0, medMax: 5,
    look: { shirt: 0x4b5a32, pants: 0x2d2f22, helmet: 0x2a2d33, skin: 0xc68a5e },
  },
  explorador: {
    name: 'Explorador', perk: '+12% velocidad · -5 vida', desc: 'Rápido para rotar y escapar de la zona.',
    hp: 95, speed: 1.12, healMult: 1.0, medMax: 5,
    look: { shirt: 0xfb8c00, pants: 0x6d4c41, helmet: null, hair: 0x4e342e, skin: 0xf1c27d },
  },
  medico: {
    name: 'Médico', perk: 'Curas +50% · 7 botiquines', desc: 'Sobrevive por más tiempo gracias a su equipo médico.',
    hp: 100, speed: 1.0, healMult: 1.5, medMax: 7,
    look: { shirt: 0xffffff, pants: 0x37474f, helmet: 0xe53935, skin: 0xe0ac7e },
  },
};
export const CHARACTER_IDS = Object.keys(CHARACTERS);

// Habilidad activa de cada personaje (botón con enfriamiento, como en Free Fire)
export const SKILLS = {
  recluta: { name: 'Ráfaga', desc: 'Corre 50% más rápido durante 5 s', cd: 25, dur: 5 },
  tanque: { name: 'Escudo', desc: 'Gana 50 de blindaje al instante', cd: 30, dur: 0 },
  explorador: { name: 'Radar', desc: 'Revela a los enemigos en el minimapa 6 s', cd: 30, dur: 6 },
  medico: { name: 'Botiquín XL', desc: 'Cura 45 de vida al instante', cd: 25, dur: 0 },
};

// ----- Sprint y resistencia -----
export const SPRINT_MULT = 1.45;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 26;      // por segundo corriendo
export const STAMINA_REGEN = 17;      // por segundo sin correr

// ----- Suministros aéreos (cofres que aparecen en el mapa durante la partida) -----
export const AIRDROP_FIRST = 50;      // segundos hasta el primer suministro
export const AIRDROP_EVERY = 35;      // segundos entre suministros
