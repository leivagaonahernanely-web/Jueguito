// Entrada: teclado y ratón (PC) y joysticks/botones táctiles (celular).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createInput(canvas, els) {
  const keys = {};
  const acc = { dyaw: 0, dpitch: 0, reload: false, heal: false };
  let mouseFire = false;
  let locked = false;

  const touch = {
    move: null,                 // { id, ox, oy, x, y }
    look: null,                 // { id, lx, ly }
    fireId: null,               // pointerId del botón de disparo
  };

  // ----- Teclado -----
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyR' && !e.repeat) acc.reload = true;
    if (e.code === 'KeyH' && !e.repeat) acc.heal = true;
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ----- Ratón (con bloqueo de puntero) -----
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  window.addEventListener('mousemove', (e) => {
    if (!locked) return;
    acc.dyaw -= e.movementX * 0.0022;
    acc.dpitch -= e.movementY * 0.0022;
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && locked) mouseFire = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseFire = false;
  });

  // ----- Táctil -----
  const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

  window.addEventListener('pointerdown', (e) => {
    if (!isTouch(e)) return;
    if (e.target.closest && e.target.closest('.btn, #menu, #end')) return;
    if (e.clientX < window.innerWidth / 2) {
      if (!touch.move) touch.move = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    } else if (!touch.look) {
      touch.look = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (touch.move && touch.move.id === e.pointerId) {
      touch.move.x = e.clientX;
      touch.move.y = e.clientY;
    }
    if (touch.look && touch.look.id === e.pointerId) {
      acc.dyaw -= (e.clientX - touch.look.lx) * 0.0065;
      acc.dpitch -= (e.clientY - touch.look.ly) * 0.0065;
      touch.look.lx = e.clientX;
      touch.look.ly = e.clientY;
    }
  });

  const endPointer = (e) => {
    if (touch.move && touch.move.id === e.pointerId) touch.move = null;
    if (touch.look && touch.look.id === e.pointerId) touch.look = null;
    if (touch.fireId === e.pointerId) {
      touch.fireId = null;
      els.fire?.classList.remove('active');
    }
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // Botones táctiles
  if (els.fire) {
    els.fire.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      touch.fireId = e.pointerId;
      els.fire.classList.add('active');
    });
  }
  if (els.reload) els.reload.addEventListener('pointerdown', (e) => { e.preventDefault(); acc.reload = true; });
  if (els.heal) els.heal.addEventListener('pointerdown', (e) => { e.preventDefault(); acc.heal = true; });

  function drawJoystick() {
    const j = els.joy;
    if (!j) return;
    if (!touch.move) {
      j.style.display = 'none';
      return;
    }
    j.style.display = 'block';
    j.style.transform = `translate(${touch.move.ox - 70}px, ${touch.move.oy - 70}px)`;
    const dx = clamp(touch.move.x - touch.move.ox, -55, 55);
    const dy = clamp(touch.move.y - touch.move.oy, -55, 55);
    els.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // Devuelve la entrada del frame actual y limpia los acumuladores
  function read() {
    let forward = 0, strafe = 0;
    if (keys.KeyW || keys.ArrowUp) forward += 1;
    if (keys.KeyS || keys.ArrowDown) forward -= 1;
    if (keys.KeyD || keys.ArrowRight) strafe += 1;
    if (keys.KeyA || keys.ArrowLeft) strafe -= 1;

    if (touch.move) {
      const dx = touch.move.x - touch.move.ox;
      const dy = touch.move.y - touch.move.oy;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        const s = Math.min(1, len / 55);
        strafe += (dx / len) * s;
        forward += (-dy / len) * s;
      }
    }
    drawJoystick();

    const out = {
      forward: clamp(forward, -1, 1),
      strafe: clamp(strafe, -1, 1),
      dyaw: acc.dyaw,
      dpitch: acc.dpitch,
      fire: mouseFire || !!keys.Space || touch.fireId !== null,
      reload: acc.reload,
      heal: acc.heal,
    };
    acc.dyaw = 0;
    acc.dpitch = 0;
    acc.reload = false;
    acc.heal = false;
    return out;
  }

  return {
    read,
    isLocked: () => locked,
    keys,
  };
}
