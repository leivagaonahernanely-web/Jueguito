// Entrada: teclado y ratón (PC) y joysticks/botones táctiles (celular).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createInput(canvas, els, settings) {
  const keys = {};
  const acc = { dyaw: 0, dpitch: 0, reload: false, heal: false, grenade: false, jump: false, swap: false, gloo: false };
  let mouseFire = false;
  let mouseAds = false;
  let locked = false;

  const touch = {
    move: null,          // { id, ox, oy, x, y }
    look: null,          // { id, lx, ly }
    fireId: null,        // pointerId del botón de disparo
    adsId: null,         // pointerId del botón de apuntar
    sprintId: null,      // pointerId del botón de correr
    crouchId: null,      // pointerId del botón de agacharse
  };

  const sensMouse = () => 0.0022 * (settings.sens ?? 1);
  const sensTouch = () => 0.0065 * (settings.sens ?? 1);

  // ----- Teclado -----
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyR' && !e.repeat) acc.reload = true;
    if (e.code === 'KeyX' && !e.repeat) acc.swap = true;
    if (e.code === 'KeyF' && !e.repeat) acc.gloo = true;
    if (e.code === 'KeyH' && !e.repeat) acc.heal = true;
    if (e.code === 'KeyG' && !e.repeat) acc.grenade = true;
    if (e.code === 'Space' && !e.repeat) acc.jump = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ----- Ratón (con bloqueo de puntero) -----
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  window.addEventListener('mousemove', (e) => {
    if (!locked) return;
    acc.dyaw -= e.movementX * sensMouse();
    acc.dpitch -= e.movementY * sensMouse();
  });
  window.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) mouseFire = true;
    if (e.button === 2) mouseAds = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseFire = false;
    if (e.button === 2) mouseAds = false;
  });

  // ----- Táctil -----
  const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

  window.addEventListener('pointerdown', (e) => {
    if (!isTouch(e)) return;
    if (e.target.closest && e.target.closest('.btn, #menu, #lobby, #end, #pause, #settings, #controls')) return;
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
      acc.dyaw -= (e.clientX - touch.look.lx) * sensTouch();
      acc.dpitch -= (e.clientY - touch.look.ly) * sensTouch();
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
    if (touch.adsId === e.pointerId) {
      touch.adsId = null;
      els.ads?.classList.remove('active');
    }
    if (touch.sprintId === e.pointerId) {
      touch.sprintId = null;
      els.sprint?.classList.remove('active');
    }
    if (touch.crouchId === e.pointerId) {
      touch.crouchId = null;
      els.crouch?.classList.remove('active');
    }
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // Botones táctiles
  const holdBtn = (el, onDown, onUp) => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onDown(e.pointerId);
      el.classList.add('active');
    });
    el.addEventListener('pointerup', () => { el.classList.remove('active'); onUp?.(); });
  };
  holdBtn(els.fire, (id) => { touch.fireId = id; }, null);
  holdBtn(els.ads, (id) => { touch.adsId = id; }, null);
  holdBtn(els.sprint, (id) => { touch.sprintId = id; }, null);
  holdBtn(els.crouch, (id) => { touch.crouchId = id; }, null);
  const tapBtn = (el, fn) => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('active'); fn(); });
    const off = () => el.classList.remove('active');
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  };
  tapBtn(els.jump, () => { acc.jump = true; });
  tapBtn(els.reload, () => { acc.reload = true; });
  tapBtn(els.heal, () => { acc.heal = true; });
  tapBtn(els.grenade, () => { acc.grenade = true; });
  tapBtn(els.swap, () => { acc.swap = true; });
  tapBtn(els.glooBtn, () => { acc.gloo = true; });

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
      fire: mouseFire || touch.fireId !== null,
      jump: acc.jump,
      crouch: !!(keys.KeyC || keys.ControlLeft || keys.ControlRight) || touch.crouchId !== null,
      ads: mouseAds || !!keys.KeyQ || touch.adsId !== null,
      sprint: !!(keys.ShiftLeft || keys.ShiftRight) || touch.sprintId !== null,
      // Ayuda de puntería solo en celular (al disparar o apuntar con los botones táctiles)
      assist: touch.fireId !== null || touch.adsId !== null,
      reload: acc.reload,
      heal: acc.heal,
      grenade: acc.grenade,
      swap: acc.swap,
      gloo: acc.gloo,
    };
    acc.dyaw = 0;
    acc.dpitch = 0;
    acc.reload = false;
    acc.heal = false;
    acc.grenade = false;
    acc.jump = false;
    acc.swap = false;
    acc.gloo = false;
    return out;
  }

  return {
    read,
    isLocked: () => locked,
    keys,
    release() {
      mouseFire = false;
      mouseAds = false;
      touch.move = null;
      touch.look = null;
      touch.fireId = null;
      touch.adsId = null;
      touch.sprintId = null;
    },
  };
}
