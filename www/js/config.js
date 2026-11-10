// Configuración general del juego. Unidades en metros.

export const WORLD = 360;              // tamaño del mapa (cuadrado)
export const PLAYER_SPEED = 5.4;
export const BOT_SPEED = 4.3;
export const PLAYER_RADIUS = 0.45;
export const BOT_COUNT = 29;           // 29 bots + tú = 30 jugadores
export const HOUSE_COUNT = 44;
export const CRATE_COUNT = 70;
export const TREE_COUNT = 160;
export const LOOT_WEAPONS = 60;
export const LOOT_MEDS = 55;
export const MAX_MEDS = 5;
export const HEAL_AMOUNT = 35;
export const ZONE_START_RADIUS = 260;

export const WEAPONS = {
  pistola:       { name: 'Pistola',       dmg: 18, rate: 0.28, spread: 0.02,  speed: 140, range: 70,  mag: 12, reload: 1.0, pellets: 1, rank: 1, color: 0xffd166 },
  escopeta:      { name: 'Escopeta',      dmg: 11, rate: 0.80, spread: 0.085, speed: 110, range: 25,  mag: 6,  reload: 2.2, pellets: 7, rank: 2, color: 0xef476f },
  rifle:         { name: 'Rifle',         dmg: 22, rate: 0.11, spread: 0.025, speed: 170, range: 110, mag: 30, reload: 1.8, pellets: 1, rank: 3, color: 0x06d6a0 },
  francotirador: { name: 'Francotirador', dmg: 95, rate: 1.30, spread: 0.0,   speed: 260, range: 320, mag: 5,  reload: 2.5, pellets: 1, rank: 4, color: 0x118ab2 },
};

export const WEAPON_WEIGHTS = { pistola: 35, escopeta: 25, rifle: 30, francotirador: 10 };

// Fases de la zona: espera, tiempo de cierre, radio objetivo y daño por segundo fuera de la zona
export const ZONE_PHASES = [
  { hold: 40, shrink: 25, radius: 150, dps: 1 },
  { hold: 30, shrink: 25, radius: 80,  dps: 3 },
  { hold: 25, shrink: 20, radius: 35,  dps: 6 },
  { hold: 20, shrink: 15, radius: 8,   dps: 12 },
];
