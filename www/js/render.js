// Render 3D con Three.js: mapa, personajes, armas, balas, zona, luces y cámara.
import * as THREE from '../lib/three.module.js';
import { G, blockedAt } from './logic.js';
import { WORLD, WEAPONS, ZONE_PHASES } from './config.js';

const SHIRTS = [0xe53935, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1, 0xfdd835, 0x6d4c41];

export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3ff);
  scene.fog = new THREE.Fog(0xbfe3ff, 110, 420);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

  // ----- Luces -----
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x3f5a2a, 1.25);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // ----- Cielo -----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f6fcf) },
        horizon: { value: new THREE.Color(0xbfe3ff) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        varying vec3 vPos;
        void main() {
          float h = clamp(vPos.y * 1.8, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizon, top, h), 1.0);
        }`,
    }),
  );
  scene.add(sky);

  // ----- Geometrías y materiales compartidos -----
  const geo = {
    torso: new THREE.BoxGeometry(0.5, 0.72, 0.3),
    head: new THREE.SphereGeometry(0.2, 16, 12),
    helmet: new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    leg: new THREE.BoxGeometry(0.19, 0.8, 0.2),
    arm: new THREE.BoxGeometry(0.16, 0.66, 0.16),
    gun: new THREE.BoxGeometry(0.14, 0.17, 0.85),
    lootBox: new THREE.BoxGeometry(0.55, 0.3, 0.9),
    medBox: new THREE.BoxGeometry(0.5, 0.5, 0.5),
    medBar: new THREE.BoxGeometry(0.34, 0.1, 0.1),
    beam: new THREE.CylinderGeometry(0.12, 0.12, 9, 8, 1, true),
    crate: new THREE.BoxGeometry(1, 1, 1),
    trunk: new THREE.CylinderGeometry(0.22, 0.32, 2.6, 7),
    foliage: new THREE.IcosahedronGeometry(1.25, 1),
    rock: new THREE.DodecahedronGeometry(0.5, 0),
    bush: new THREE.IcosahedronGeometry(0.6, 0),
    window: new THREE.PlaneGeometry(0.9, 1.2),
    roof: new THREE.BoxGeometry(1, 0.4, 1),
    tracer: new THREE.BoxGeometry(0.04, 0.04, 1),
    flash: new THREE.SphereGeometry(0.16, 8, 6),
    spark: new THREE.BoxGeometry(0.08, 0.08, 0.08),
    zoneWall: new THREE.CylinderGeometry(1, 1, 30, 64, 1, true),
  };

  const beamMats = {};
  const weaponMats = {};
  for (const k of Object.keys(WEAPONS)) {
    const c = WEAPONS[k].color;
    weaponMats[k] = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.4 });
    beamMats[k] = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  const medMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.5 });
  const medCrossMat = new THREE.MeshStandardMaterial({ color: 0xe53935, emissive: 0xe53935, emissiveIntensity: 0.4 });
  const medBeamMat = new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 1 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.95, flatShading: true });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4e4e52, roughness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.15, metalness: 0.4, emissive: 0x3a3320, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const tracerMats = {};
  for (const k of Object.keys(WEAPONS)) {
    tracerMats[k] = new THREE.MeshBasicMaterial({ color: WEAPONS[k].color });
  }
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.9 });
  const zoneMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const zoneLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

  // ----- Mundo estático -----
  let worldGroup = null;
  const dummy = new THREE.Object3D();

  function makeGroundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#4f7f2f';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      const dark = Math.random() < 0.5;
      g.fillStyle = dark ? 'rgba(40,85,30,0.35)' : 'rgba(120,170,70,0.3)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(WORLD / 8, WORLD / 8);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  function disposeGroup(group) {
    group.traverse((o) => {
      if (o.geometry && !Object.values(geo).includes(o.geometry)) o.geometry.dispose();
      if (o.material && !Object.values(weaponMats).includes(o.material)) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }

  function buildWorld() {
    if (worldGroup) {
      scene.remove(worldGroup);
      disposeGroup(worldGroup);
    }
    worldGroup = new THREE.Group();
    scene.add(worldGroup);

    // Suelo del mapa y arena alrededor
    const groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD / 2, 0, WORLD / 2);
    ground.receiveShadow = true;
    worldGroup.add(ground);

    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({ color: 0xd8c08a, roughness: 1 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(WORLD / 2, -0.05, WORLD / 2);
    sand.receiveShadow = true;
    worldGroup.add(sand);

    const houses = G.obstacles.filter((o) => o.shape === 'rect' && o.kind === 'casa');
    const crates = G.obstacles.filter((o) => o.shape === 'rect' && o.kind === 'caja');
    const trees = G.obstacles.filter((o) => o.shape === 'circle');

    // Casas con techo
    for (const o of houses) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.85 }));
      wall.position.set(o.x + o.w / 2, o.h / 2, o.z + o.d / 2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      worldGroup.add(wall);

      const roof = new THREE.Mesh(geo.roof, roofMat);
      roof.scale.set(o.w + 0.6, 1, o.d + 0.6);
      roof.position.set(o.x + o.w / 2, o.h + 0.2, o.z + o.d / 2);
      roof.castShadow = true;
      worldGroup.add(roof);
    }

    // Ventanas (instanciadas)
    const wins = [];
    for (const o of houses) {
      const rows = Math.max(1, Math.floor((o.h - 1.2) / 2.4));
      for (let r = 0; r < rows; r++) {
        const y = 1.6 + r * 2.4;
        for (let i = 1; i * 2.2 < o.w; i++) {
          const x = o.x + i * 2.2;
          wins.push({ x, y, z: o.z - 0.03, ry: Math.PI });
          wins.push({ x, y, z: o.z + o.d + 0.03, ry: 0 });
        }
        for (let i = 1; i * 2.2 < o.d; i++) {
          const z = o.z + i * 2.2;
          wins.push({ x: o.x - 0.03, y, z, ry: -Math.PI / 2 });
          wins.push({ x: o.x + o.w + 0.03, y, z, ry: Math.PI / 2 });
        }
      }
    }
    if (wins.length) {
      const im = new THREE.InstancedMesh(geo.window, glassMat, wins.length);
      wins.forEach((w, i) => {
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(0, w.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      worldGroup.add(im);
    }

    // Cajas de madera
    if (crates.length) {
      const im = new THREE.InstancedMesh(geo.crate, woodMat, crates.length);
      crates.forEach((o, i) => {
        dummy.position.set(o.x + o.w / 2, o.h / 2, o.z + o.d / 2);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(o.w, o.h, o.d);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, new THREE.Color().setHSL(0.08 + Math.random() * 0.02, 0.45, 0.35 + Math.random() * 0.1));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      worldGroup.add(im);
    }

    // Árboles: tronco + copa
    if (trees.length) {
      const trunks = new THREE.InstancedMesh(geo.trunk, trunkMat, trees.length);
      const leaves = new THREE.InstancedMesh(geo.foliage, foliageMat, trees.length);
      trees.forEach((o, i) => {
        const s = 0.9 + Math.random() * 0.5;
        dummy.position.set(o.x, 1.3, o.z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(o.x, 3.4 * s, o.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(s, s * 1.1, s);
        dummy.updateMatrix();
        leaves.setMatrixAt(i, dummy.matrix);
        leaves.setColorAt(i, new THREE.Color().setHSL(0.27 + Math.random() * 0.05, 0.5, 0.25 + Math.random() * 0.12));
      });
      trunks.castShadow = true;
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      worldGroup.add(trunks, leaves);
    }

    // Decoración sin colisión: rocas y arbustos
    const decorRocks = [];
    const decorBushes = [];
    for (let tries = 0; tries < 900 && (decorRocks.length < 60 || decorBushes.length < 90); tries++) {
      const x = 3 + Math.random() * (WORLD - 6);
      const z = 3 + Math.random() * (WORLD - 6);
      if (blockedAt(x, 0.5, z)) continue;
      if (Math.random() < 0.4 && decorRocks.length < 60) decorRocks.push({ x, z });
      else if (decorBushes.length < 90) decorBushes.push({ x, z });
    }
    if (decorRocks.length) {
      const im = new THREE.InstancedMesh(geo.rock, rockMat, decorRocks.length);
      decorRocks.forEach((p, i) => {
        const s = 0.6 + Math.random() * 1.1;
        dummy.position.set(p.x, 0.25 * s, p.z);
        dummy.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        dummy.scale.set(s, s * 0.7, s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      worldGroup.add(im);
    }
    if (decorBushes.length) {
      const im = new THREE.InstancedMesh(geo.bush, bushMat, decorBushes.length);
      decorBushes.forEach((p, i) => {
        const s = 0.8 + Math.random() * 0.6;
        dummy.position.set(p.x, 0.5 * s, p.z);
        dummy.rotation.set(0, Math.random() * 3, 0);
        dummy.scale.set(s, s * 0.8, s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, new THREE.Color().setHSL(0.3 + Math.random() * 0.06, 0.55, 0.28 + Math.random() * 0.1));
      });
      im.castShadow = true;
      worldGroup.add(im);
    }
  }

  // ----- Personajes -----
  function buildCharacter(colorIdx, isPlayer) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const shirtMat = new THREE.MeshStandardMaterial({
      color: isPlayer ? 0x1e88e5 : SHIRTS[colorIdx % SHIRTS.length], roughness: 0.7,
    });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0ac7e, roughness: 0.6 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x3e4d2a, roughness: 0.5, metalness: 0.2 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.4, metalness: 0.6 });

    const torso = new THREE.Mesh(geo.torso, shirtMat);
    torso.position.y = 1.15;
    torso.castShadow = true;
    body.add(torso);

    const head = new THREE.Mesh(geo.head, skinMat);
    head.position.y = 1.7;
    head.castShadow = true;
    body.add(head);

    const helmet = new THREE.Mesh(geo.helmet, helmetMat);
    helmet.position.y = 1.78;
    helmet.castShadow = true;
    body.add(helmet);

    const legs = [];
    for (const sx of [-0.14, 0.14]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx, 0.8, 0);
      const leg = new THREE.Mesh(geo.leg, pantsMat);
      leg.position.y = -0.4;
      leg.castShadow = true;
      pivot.add(leg);
      body.add(pivot);
      legs.push(pivot);
    }

    const arms = [];
    for (const sx of [-0.36, 0.36]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx, 1.45, 0);
      pivot.rotation.x = -1.35; // brazos al frente sosteniendo el arma
      const arm = new THREE.Mesh(geo.arm, shirtMat);
      arm.position.y = -0.33;
      arm.castShadow = true;
      pivot.add(arm);
      body.add(pivot);
      arms.push(pivot);
    }

    const gun = new THREE.Mesh(geo.gun, gunMat);
    gun.position.set(0.02, 1.36, 0.62);
    gun.castShadow = true;
    root.add(gun);

    return { root, body, legs, torso, shirtMat, gun, gunMat, weapon: null, dead: false };
  }

  function setGunWeapon(ch, weapon) {
    if (ch.weapon === weapon) return;
    ch.weapon = weapon;
    ch.gunMat.color.setHex(WEAPONS[weapon].color);
    ch.gunMat.emissive.setHex(WEAPONS[weapon].color);
    ch.gunMat.emissiveIntensity = 0.25;
  }

  // ----- Loot -----
  function buildLoot(it) {
    const g = new THREE.Group();
    if (it.kind === 'med') {
      const box = new THREE.Mesh(geo.medBox, medMat);
      box.position.y = 0.35;
      box.castShadow = true;
      g.add(box);
      const v = new THREE.Mesh(geo.medBar, medCrossMat);
      v.rotation.y = Math.PI / 2;
      v.position.y = 0.6;
      g.add(v);
      const h = new THREE.Mesh(geo.medBar, medCrossMat);
      h.position.y = 0.6;
      g.add(h);
      const beam = new THREE.Mesh(geo.beam, medBeamMat);
      beam.position.y = 4.5;
      g.add(beam);
    } else {
      const k = it.weapon;
      const box = new THREE.Mesh(geo.lootBox, weaponMats[k]);
      box.position.y = 0.3;
      box.castShadow = true;
      g.add(box);
      const beam = new THREE.Mesh(geo.beam, beamMats[k]);
      beam.position.y = 4.5;
      g.add(beam);
    }
    return g;
  }

  // ----- Estado de sincronización -----
  const chars = new Map();     // entity.id -> character
  const lootMeshes = new Map(); // loot.id -> group
  const tracers = new Map();   // bullet obj -> mesh
  const particles = [];        // { mesh, vx, vy, vz, life }
  const flashes = [];          // { mesh, life }
  const zoneWall = new THREE.Mesh(geo.zoneWall, zoneMat);
  zoneWall.position.y = 15;
  zoneWall.visible = false;
  scene.add(zoneWall);
  const zoneLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 128 }, (_, i) => {
        const a = (i / 128) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a));
      }),
    ),
    zoneLineMat,
  );
  zoneLine.visible = false;
  scene.add(zoneLine);

  const camPos = new THREE.Vector3(WORLD / 2, 3, WORLD / 2);
  const camLook = new THREE.Vector3();
  let orbitT = 0;
  let shake = 0;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function reset() {
    for (const ch of chars.values()) scene.remove(ch.root);
    chars.clear();
    for (const g of lootMeshes.values()) scene.remove(g);
    lootMeshes.clear();
    for (const m of tracers.values()) scene.remove(m);
    tracers.clear();
    for (const p of particles) scene.remove(p.mesh);
    particles.length = 0;
    for (const f of flashes) scene.remove(f.mesh);
    flashes.length = 0;
    buildWorld();
  }

  function syncCharacters(dt) {
    for (const e of G.entities) {
      let ch = chars.get(e.id);
      if (!ch) {
        ch = buildCharacter(e.colorIdx, e.isPlayer);
        chars.set(e.id, ch);
        scene.add(ch.root);
      }
      setGunWeapon(ch, e.weapon);
      ch.root.position.set(e.x, 0, e.z);
      ch.root.rotation.y = e.yaw;
      if (!e.alive) {
        if (!ch.dead) {
          ch.dead = true;
          ch.body.rotation.x = -Math.PI / 2;
          ch.body.position.y = 0.2;
        }
      } else {
        const swing = e.moving ? Math.sin(e.walk) * 0.75 : 0;
        ch.legs[0].rotation.x = swing;
        ch.legs[1].rotation.x = -swing;
        ch.body.position.y = e.moving ? Math.abs(Math.sin(e.walk * 2)) * 0.05 : 0;
      }
      ch.gun.visible = e.alive;
      ch.shirtMat.emissive.setRGB(e.flash > 0 ? 0.55 : 0, e.flash > 0 ? 0.1 : 0, 0);
    }
  }

  function syncLoot(t) {
    const alive = new Set();
    for (const it of G.loot) {
      alive.add(it.id);
      let m = lootMeshes.get(it.id);
      if (!m) {
        m = buildLoot(it);
        m.position.set(it.x, 0, it.z);
        lootMeshes.set(it.id, m);
        scene.add(m);
      }
      m.rotation.y = t * 1.2 + it.id;
      m.position.y = Math.sin(t * 2 + it.id) * 0.08;
    }
    for (const [id, m] of lootMeshes) {
      if (!alive.has(id)) {
        scene.remove(m);
        lootMeshes.delete(id);
      }
    }
  }

  function syncBullets() {
    for (const b of G.bullets) {
      let m = tracers.get(b);
      if (!m) {
        m = new THREE.Mesh(geo.tracer, tracerMats[b.weapon]);
        tracers.set(b, m);
        scene.add(m);
      }
      const len = b.weapon === 'francotirador' ? 3.2 : 1.6;
      m.scale.set(1, 1, len);
      m.position.set(b.x, b.y, b.z);
      m.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
    }
    for (const [b, m] of tracers) {
      if (!G.bullets.includes(b)) {
        scene.remove(m);
        tracers.delete(b);
      }
    }
  }

  function spawnSparks(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo.spark, sparkMat);
      m.position.set(x, y, z);
      scene.add(m);
      particles.push({
        mesh: m,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 3,
        vz: (Math.random() - 0.5) * 4,
        life: 0.4,
      });
    }
  }

  function consumeEvents() {
    for (const ev of G.events) {
      if (ev.type === 'shot') {
        const m = new THREE.Mesh(geo.flash, flashMat);
        m.position.set(ev.x, ev.y, ev.z);
        scene.add(m);
        flashes.push({ mesh: m, life: 0.06 });
        if (ev.weapon === 'escopeta') shake = Math.max(shake, 0.25);
        else shake = Math.max(shake, 0.08);
      } else if (ev.type === 'impact') {
        spawnSparks(ev.x, ev.y, ev.z);
      } else if (ev.type === 'kill') {
        shake = Math.max(shake, 0.3);
      }
    }
    G.events.length = 0;
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vy -= 9.8 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        particles.splice(i, 1);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        scene.remove(f.mesh);
        flashes.splice(i, 1);
      }
    }
  }

  function syncZone() {
    if (!G.zone) {
      zoneWall.visible = false;
      zoneLine.visible = false;
      return;
    }
    const r = Math.max(0.5, G.zone.radius);
    const danger = G.zone.phase >= 0;
    zoneWall.visible = true;
    zoneLine.visible = true;
    zoneWall.scale.set(r, 1, r);
    zoneWall.position.x = G.zone.cx;
    zoneWall.position.z = G.zone.cz;
    zoneLine.scale.set(r, 1, r);
    zoneLine.position.set(G.zone.cx, 0, G.zone.cz);
    zoneMat.color.setHex(danger && G.zone.state === 'shrink' ? 0xff2b2b : 0x3b8bff);
    zoneLineMat.color.setHex(danger && G.zone.state === 'shrink' ? 0xff6b6b : 0xffffff);
    if (ZONE_PHASES.length === 0) zoneWall.visible = false;
  }

  function placeLights(cx, cz) {
    sun.position.set(cx + 45, 80, cz + 30);
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();
  }

  function render(dt, t) {
    consumeEvents();

    if (G.player) {
      const p = G.player;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
      const dCam = 4.4;
      const desired = new THREE.Vector3(p.x - fx * dCam, 2.6 + sp * 0.8, p.z - fz * dCam);
      camPos.lerp(desired, 1 - Math.exp(-dt * 16));
      const look = new THREE.Vector3(p.x + fx * cp * 30, 1.4 + sp * 30, p.z + fz * cp * 30);
      camLook.lerp(look, 1 - Math.exp(-dt * 25));
      placeLights(p.x, p.z);
      const s = shake * 0.4;
      camera.position.copy(camPos);
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.lookAt(camLook);
      shake = Math.max(0, shake - dt * 2.5);
    } else {
      orbitT += dt * 0.08;
      const cx = WORLD / 2, cz = WORLD / 2;
      camera.position.set(cx + Math.cos(orbitT) * 110, 45, cz + Math.sin(orbitT) * 110);
      camera.lookAt(cx, 0, cz);
      placeLights(cx, cz);
    }

    sky.position.copy(camera.position);
    if (worldGroup) {
      syncCharacters(dt);
      syncLoot(t);
      syncBullets();
    }
    updateEffects(dt);
    syncZone();
    renderer.render(scene, camera);
  }

  resize();
  buildWorld();

  return { render, reset, resize, buildWorld };
}
