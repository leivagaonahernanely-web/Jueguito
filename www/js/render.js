// Render 3D con Three.js: mapa, personajes animados, armas, efectos, zona, cámara y post-procesado.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { G, blockedAt, viewPitch } from './logic.js';
import { WORLD, WEAPONS, GRENADE } from './config.js';

const SHIRTS = [0xe53935, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1, 0xfdd835, 0x6d4c41];
const SHIRT_FOR_PLAYER = 0x1e88e5;
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

const IS_TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export function createView(canvas) {
  // ----- Renderer -----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const SKY_HORIZON = new THREE.Color(0xcfe9ff);
  const SKY_TOP = new THREE.Color(0x2c6fd1);
  scene.background = SKY_HORIZON;
  scene.fog = new THREE.Fog(SKY_HORIZON, 120, 430);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);

  // ----- Luces -----
  const hemi = new THREE.HemisphereLight(0xe4f2ff, 0x3f5a2a, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0cc, 2.8);
  sun.castShadow = true;
  const shadowRes = IS_TOUCH ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  const sc = sun.shadow.camera;
  sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 1; sc.far = 240;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(0.6, 0.8, 0.45).normalize();

  // Disco del sol (sin niebla) para que el cielo se vea "de postal"
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(16, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false }),
  );
  scene.add(sunDisc);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 40, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, sunDir: { value: sunDir } },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 sunDir;
        varying vec3 vPos;
        void main() {
          float h = clamp(vPos.y * 1.6, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.7));
          float s = max(dot(normalize(vPos), normalize(sunDir)), 0.0);
          col += vec3(1.0, 0.85, 0.55) * pow(s, 18.0) * 0.45;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  // Nubes: sprites con textura de manchas suaves, arriba del mapa
  const cloudTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const x = 30 + Math.random() * 68, y = 50 + Math.random() * 30, r = 16 + Math.random() * 20;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.85)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const cloudSprites = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.55 + Math.random() * 0.3, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(m);
    const sc = 90 + Math.random() * 110;
    sp.scale.set(sc, sc * 0.45, 1);
    const a = Math.random() * Math.PI * 2, d = 250 + Math.random() * 350;
    sp.position.set(Math.cos(a) * d, 160 + Math.random() * 60, Math.sin(a) * d);
    scene.add(sp);
    cloudSprites.push(sp);
  }

  // Textura alfa de briznas para el pasto
  const grassBladeTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const x0 = 6 + i * 7 + Math.random() * 4;
      const bend = (Math.random() - 0.5) * 20;
      g.strokeStyle = 'rgba(255,255,255,1)';
      g.lineWidth = 3 + Math.random() * 2;
      g.beginPath();
      g.moveTo(x0, 64);
      g.quadraticCurveTo(x0 + bend * 0.3, 34, x0 + bend, 4 + Math.random() * 12);
      g.stroke();
    }
    return new THREE.CanvasTexture(c);
  })();

  // ----- Geometrías compartidas -----
  // Copa de árbol: esfera con ruido en los vértices para que no parezca un cristal
  function makeCanopyGeometry(radius, seed) {
    const g = new THREE.IcosahedronGeometry(radius, 4);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 1
        + 0.12 * Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 - seed)
        + 0.08 * Math.sin(v.y * 5.3 + v.x * 2.2 + seed * 0.5)
        + 0.05 * Math.sin(v.z * 7.9 + seed);
      v.multiplyScalar(n);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }

  const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  const geo = {
    torso: new RoundedBoxGeometry(0.5, 0.62, 0.3, 4, 0.08),
    pelvis: new RoundedBoxGeometry(0.44, 0.2, 0.26, 3, 0.06),
    shoulder: new THREE.SphereGeometry(0.11, 16, 12),
    hair: new THREE.SphereGeometry(0.212, 28, 16, 0, TAU, 0, Math.PI * 0.62),
    eyeW: new THREE.SphereGeometry(0.035, 12, 10),
    pupil: new THREE.SphereGeometry(0.02, 10, 8),
    nose: new RoundedBoxGeometry(0.05, 0.07, 0.05, 2, 0.02),
    mouth: new RoundedBoxGeometry(0.09, 0.02, 0.03, 2, 0.008),
    cinturon: new RoundedBoxGeometry(0.52, 0.09, 0.32, 2, 0.03),
    neck: new THREE.CylinderGeometry(0.08, 0.09, 0.14, 8),
    head: new THREE.SphereGeometry(0.2, 32, 24),
    helmet: new THREE.SphereGeometry(0.245, 18, 12, 0, TAU, 0, Math.PI / 2),
    visor: box(0.32, 0.06, 0.14),
    leg: new RoundedBoxGeometry(0.17, 0.72, 0.18, 3, 0.06),
    boot: new RoundedBoxGeometry(0.19, 0.16, 0.24, 3, 0.06),
    arm: new RoundedBoxGeometry(0.15, 0.6, 0.15, 3, 0.06),
    hand: new THREE.SphereGeometry(0.085, 10, 8),
    vest: new RoundedBoxGeometry(0.54, 0.5, 0.34, 3, 0.04),
    backpack: new RoundedBoxGeometry(0.38, 0.46, 0.2, 3, 0.05),
    lootBox: box(0.6, 0.3, 0.9),
    medBox: box(0.5, 0.5, 0.5),
    medBar: box(0.34, 0.1, 0.1),
    armorBox: box(0.55, 0.42, 0.34),
    beam: new THREE.CylinderGeometry(0.1, 0.1, 9, 8, 1, true),
    crate: box(1, 1, 1),
    trunk: new THREE.CylinderGeometry(0.16, 0.3, 2.6, 9),
    foliage: makeCanopyGeometry(1.25, 11),
    foliageTop: makeCanopyGeometry(0.85, 23),
    rock: new THREE.DodecahedronGeometry(0.5, 0),
    bush: new THREE.IcosahedronGeometry(0.6, 0),
    window: new RoundedBoxGeometry(0.9, 1.2, 0.1, 2, 0.02),
    sill: new RoundedBoxGeometry(1.1, 0.1, 0.22, 2, 0.03),
    roof: box(1, 0.4, 1),
    chimney: box(0.6, 1.6, 0.6),
    door: box(0.9, 2.0, 0.1),
    framePost: box(0.16, 2.2, 0.18),
    frameLintel: box(1.4, 0.2, 0.2),
    doorstep: box(1.35, 0.14, 0.6),
    grassBlade: new THREE.PlaneGeometry(0.34, 0.3).translate(0, 0.15, 0),
    dirtPatch: new THREE.CircleGeometry(1, 12),
    barrel: new THREE.CylinderGeometry(0.34, 0.34, 0.9, 10),
    sandbag: new RoundedBoxGeometry(0.62, 0.28, 0.34, 2, 0.1),
    fencePost: box(0.14, 1.1, 0.14),
    fenceRail: box(2.5, 0.09, 0.06),
    chestBody: new RoundedBoxGeometry(0.95, 0.55, 0.6, 2, 0.08),
    chestLid: new RoundedBoxGeometry(0.95, 0.22, 0.6, 2, 0.08),
    lampPole: new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6),
    lampHead: new THREE.SphereGeometry(0.22, 10, 8),
    tracer: box(0.035, 0.035, 1),
    spark: box(0.06, 0.06, 0.06),
    shell: new THREE.CylinderGeometry(0.012, 0.012, 0.035, 6),
    puff: new THREE.SphereGeometry(1, 10, 8),
    grenade: new THREE.SphereGeometry(0.13, 14, 10),
    grenadeLever: box(0.04, 0.06, 0.06),
    zoneWall: new THREE.CylinderGeometry(1, 1, 30, 72, 1, true),
    ring: new THREE.CircleGeometry(0.62, 32),
  };

  // Texturas fotográficas (examples de Three.js): hierba y ladrillo con relieve y rugosidad
  const texLoader = new THREE.TextureLoader();
  function loadTex(path, srgb, rx, ry) {
    const t = texLoader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  const grassMap = loadTex('assets/tex/grasslight-big.jpg', true, WORLD / 14, WORLD / 14);
  const brickMap = loadTex('assets/tex/brick_diffuse.jpg', true, 1, 1);
  const brickBump = loadTex('assets/tex/brick_bump.jpg', false, 1, 1);
  const brickRough = loadTex('assets/tex/brick_roughness.jpg', false, 1, 1);

  // Textura de pared: estuco con grano, usada como color y como relieve
  const wallTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      const v = 150 + Math.random() * 105;
      g.fillStyle = `rgba(${v},${v},${v},0.25)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // Líneas horizontales de juntas (sutiles)
    g.fillStyle = 'rgba(90,90,90,0.25)';
    for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 256, 2);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  // Textura de camuflaje (manchas grises que se tiñen con el color de la camiseta)
  const camoTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#9a9a9a';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 46; i++) {
      g.fillStyle = Math.random() < 0.5 ? '#5c5c5c' : '#d2d2d2';
      g.beginPath();
      g.ellipse(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 14, 4 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  // ----- Materiales compartidos -----
  const M = {
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.75 }),
    eyeW: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.25 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xefe9df, roughness: 0.6 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 1 }),
    brick: new THREE.MeshStandardMaterial({ color: 0x8d4f3a, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.3 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xe0ac7e, roughness: 0.6 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x2b3a46, roughness: 0.9 }),
    boots: new THREE.MeshStandardMaterial({ color: 0x1b1412, roughness: 0.8 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4b5a32, roughness: 0.85 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x3e4d2a, roughness: 0.45, metalness: 0.25 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.2, metalness: 0.6 }),
    med: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.5 }),
    medRed: new THREE.MeshStandardMaterial({ color: 0xe53935, emissive: 0xe53935, emissiveIntensity: 0.5 }),
    grenade: new THREE.MeshStandardMaterial({ color: 0x3f5a3a, roughness: 0.6, metalness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 1 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.95, flatShading: true }),
    bush: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    roof: new THREE.MeshStandardMaterial({ color: 0x4e4e52, roughness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.12, metalness: 0.5, side: THREE.DoubleSide }),
    glassLit: new THREE.MeshStandardMaterial({ color: 0xffd58a, emissive: 0xffb74d, emissiveIntensity: 1.1, roughness: 0.3, side: THREE.DoubleSide }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0xfff3cf, emissive: 0xffd27a, emissiveIntensity: 2.0 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.5 }),
    door: new THREE.MeshStandardMaterial({ color: 0x3e2a1c, roughness: 0.8 }),
    shell: new THREE.MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.3, metalness: 0.8 }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
    blood: new THREE.MeshBasicMaterial({ color: 0x8a0b0b }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.95 }),
  };

  const accentMats = {};
  const beamMats = {};
  const tracerMats = {};
  for (const k of Object.keys(WEAPONS)) {
    const c = WEAPONS[k].color;
    accentMats[k] = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, roughness: 0.4 });
    beamMats[k] = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
    tracerMats[k] = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.45) });
  }
  const medBeam = new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  const grenadeBeam = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  const armorBeam = new THREE.MeshBasicMaterial({ color: 0x7ac7ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  const zoneMat = new THREE.MeshBasicMaterial({ color: 0x3b8bff, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
  const zoneLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const roofMats = [0x8c3b2e, 0x51606e, 0x4a5d48, 0x6e4b2a, 0x3b4050].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5a9a3c, alphaMap: grassBladeTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
  const dirtPatchMat = new THREE.MeshStandardMaterial({ color: 0x8a7449, roughness: 1 });
  const barrelMats = [0x2f5f8f, 0x8f3a2f, 0x4a6b3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 }));
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x9a8a5e, roughness: 1 });
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1 });
  const chestMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.35, metalness: 0.6 });
  const chestBandMat = new THREE.MeshStandardMaterial({ color: 0x5a3d10, roughness: 0.5, metalness: 0.4 });
  const chestBeam = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.16, depthWrite: false });
  const chestSpark = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  const glooWallMat = new THREE.MeshStandardMaterial({ color: 0x7fd0ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82, emissive: 0x1a5f8a, emissiveIntensity: 0.45 });
  const glooBeamMat = new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.18, depthWrite: false });
  const glooSparkMat = new THREE.MeshBasicMaterial({ color: 0x9fe4ff });
  const playerRingMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });

  // ----- Modelos de arma (origen en la empuñadura, cañón hacia +z) -----
  function buildGunModel(key) {
    const g = new THREE.Group();
    const add = (geometry, mat, x, y, z) => {
      const m = new THREE.Mesh(geometry, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const acc = accentMats[key];
    switch (key) {
      case 'pistola':
        add(box(0.08, 0.14, 0.36), M.metal, 0, 0.02, 0.06);
        add(box(0.07, 0.2, 0.09), M.dark, 0, -0.12, -0.05);
        add(box(0.085, 0.035, 0.22), acc, 0, 0.1, 0.1);
        break;
      case 'subfusil':
        add(box(0.09, 0.14, 0.56), M.metal, 0, 0, 0.12);
        add(box(0.07, 0.24, 0.1), M.dark, 0, -0.18, 0.02);
        add(box(0.07, 0.12, 0.28), M.dark, 0, 0, -0.42);
        add(box(0.035, 0.035, 0.24), M.dark, 0, 0.01, 0.52);
        add(box(0.09, 0.03, 0.32), acc, 0, 0.08, 0.12);
        break;
      case 'escopeta':
        add(box(0.1, 0.14, 0.9), M.metal, 0, 0, 0.1);
        add(box(0.11, 0.09, 0.26), M.dark, 0, -0.05, 0.3);
        add(box(0.09, 0.16, 0.36), M.dark, 0, 0, -0.52);
        add(box(0.05, 0.05, 0.42), M.dark, 0, 0.03, 0.62);
        add(box(0.1, 0.03, 0.3), acc, 0, 0.08, 0.05);
        break;
      case 'rifle':
        add(box(0.08, 0.15, 0.8), M.metal, 0, 0, 0.05);
        add(box(0.1, 0.12, 0.42), M.dark, 0, -0.01, 0.42);
        add(box(0.07, 0.26, 0.12), M.dark, 0, -0.2, 0.08);
        add(box(0.08, 0.14, 0.36), M.dark, 0, -0.01, -0.52);
        add(box(0.06, 0.09, 0.24), M.dark, 0, 0.12, 0.1);
        add(box(0.09, 0.03, 0.42), acc, 0, 0.08, 0.05);
        break;
      case 'francotirador': {
        add(box(0.08, 0.15, 1.0), M.metal, 0, 0, 0.1);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.32, 10), M.dark);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.13, 0.12);
        scope.castShadow = true;
        g.add(scope);
        add(box(0.1, 0.2, 0.42), M.dark, 0, -0.01, -0.6);
        add(box(0.04, 0.04, 0.5), M.dark, 0, 0.02, 0.85);
        add(box(0.09, 0.03, 0.4), acc, 0, 0.08, 0.1);
        break;
      }
    }
    return g;
  }

  // ----- Mundo estático -----
  let worldGroup = null;
  let lampRefs = [];
  const dummy = new THREE.Object3D();

  function makeGroundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#4f8a2f';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) {
      const r = Math.random();
      g.fillStyle = r < 0.45 ? 'rgba(35,80,25,0.35)' : r < 0.9 ? 'rgba(120,175,75,0.28)' : 'rgba(180,160,80,0.12)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    // Hojas de hierba (trazos cortos) y parches de tierra
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.strokeStyle = Math.random() < 0.6 ? 'rgba(60,110,40,0.55)' : 'rgba(150,200,90,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 4);
      g.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 6 + Math.random() * 14;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(140,110,70,0.5)');
      grd.addColorStop(1, 'rgba(140,110,70,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(WORLD / 6, WORLD / 6);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  function disposeGroup(group) {
    group.traverse((o) => {
      if (o.geometry && !Object.values(geo).includes(o.geometry)) o.geometry.dispose();
    });
  }

  function buildWorld() {
    if (worldGroup) {
      scene.remove(worldGroup);
      disposeGroup(worldGroup);
    }
    worldGroup = new THREE.Group();
    scene.add(worldGroup);
    lampRefs = [];

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD / 2, 0, WORLD / 2);
    ground.receiveShadow = true;
    worldGroup.add(ground);

    const sand = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0xd9c28f, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(WORLD / 2, -0.05, WORLD / 2);
    sand.receiveShadow = true;
    worldGroup.add(sand);

    // Colinas lejanas alrededor del mapa: el horizonte deja de ser un plano vacío
    const hillGeo = new THREE.SphereGeometry(1, 12, 8, 0, TAU, 0, Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + Math.random() * 0.35;
      const d = 330 + Math.random() * 110;
      const r = 45 + Math.random() * 55;
      const hill = new THREE.Mesh(hillGeo, new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.28 + Math.random() * 0.06, 0.3, 0.22 + Math.random() * 0.09),
        roughness: 1,
      }));
      hill.position.set(WORLD / 2 + Math.cos(a) * d, -2, WORLD / 2 + Math.sin(a) * d);
      hill.scale.set(r, r * (0.18 + Math.random() * 0.14), r);
      worldGroup.add(hill);
    }

    // Caminos de tierra cruzando el mapa
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xa88b5e, roughness: 1 });
    for (const [px, pz, sx, sz] of [[WORLD / 2, WORLD / 2, 10, WORLD], [WORLD / 2, WORLD / 2, WORLD, 10]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), pathMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(px, 0.02, pz);
      p.receiveShadow = true;
      worldGroup.add(p);
    }

    const houses = G.obstacles.filter((o) => o.shape === 'rect' && o.kind === 'casa');
    const crates = G.obstacles.filter((o) => o.shape === 'rect' && o.kind === 'caja');
    const trees = G.obstacles.filter((o) => o.shape === 'circle');

    // Casas: paredes, techo y puerta
    const doors = [];
    for (const o of houses) {
      // Zócalo de piedra
      const plinth = new THREE.Mesh(new RoundedBoxGeometry(o.w + 0.25, 0.5, o.d + 0.25, 2, 0.05), M.plinth);
      plinth.position.set(o.x + o.w / 2, 0.22, o.z + o.d / 2);
      plinth.receiveShadow = true;
      worldGroup.add(plinth);

      // Pared con textura de estuco y relieve (bump)
      let wallMat;
      if (Math.random() < 0.5) {
        // Ladrillo visto: tono cálido con textura real de relieve y rugosidad
        const rep = (t) => { const c = t.clone(); c.repeat.set(Math.max(1, o.w / 3), Math.max(1, o.h / 3)); c.needsUpdate = true; return c; };
        wallMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(o.color).lerp(new THREE.Color(0xffffff), 0.55),
          map: rep(brickMap), bumpMap: rep(brickBump), bumpScale: 1.2, roughnessMap: rep(brickRough), roughness: 1,
        });
      } else {
        // Estuco pintado
        const wt = wallTex.clone();
        wt.repeat.set(Math.max(1, o.w / 4), Math.max(1, o.h / 4));
        wt.needsUpdate = true;
        wallMat = new THREE.MeshStandardMaterial({ color: o.color, map: wt, bumpMap: wt, bumpScale: 0.6, roughness: 0.85 });
      }
      const wall = new THREE.Mesh(box(o.w, o.h, o.d), wallMat);
      wall.position.set(o.x + o.w / 2, o.h / 2, o.z + o.d / 2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      worldGroup.add(wall);

      // Tejado a dos aguas (caballete a lo largo del lado más largo)
      const ridgeX = o.w >= o.d;
      const hb = (ridgeX ? o.d : o.w) / 2 + 0.45;
      const len = (ridgeX ? o.w : o.d) + 0.6;
      const ht = 2.3;
      const shape = new THREE.Shape();
      shape.moveTo(-hb, 0);
      shape.lineTo(hb, 0);
      shape.lineTo(0, ht);
      shape.closePath();
      const rg = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
      rg.translate(0, 0, -len / 2);
      const roof = new THREE.Mesh(rg, roofMats[(o.x * 7 + o.z * 13) % roofMats.length]);
      if (ridgeX) {
        roof.rotation.y = Math.PI / 2;
        roof.position.set(o.x + o.w / 2, o.h, o.z + o.d / 2);
      } else {
        roof.position.set(o.x + o.w / 2, o.h, o.z + o.d / 2);
      }
      roof.castShadow = true;
      worldGroup.add(roof);

      // Moldura bajo el alero y pilastras en las esquinas para dar volumen a la fachada
      const fascia = new THREE.Mesh(box(o.w + 0.34, 0.22, o.d + 0.34), M.trim);
      fascia.position.set(o.x + o.w / 2, o.h - 0.04, o.z + o.d / 2);
      fascia.castShadow = true;
      worldGroup.add(fascia);
      for (const cx of [o.x + 0.09, o.x + o.w - 0.09]) {
        for (const cz of [o.z + 0.09, o.z + o.d - 0.09]) {
          const pil = new THREE.Mesh(box(0.18, o.h, 0.18), M.trim);
          pil.position.set(cx, o.h / 2, cz);
          pil.castShadow = true;
          worldGroup.add(pil);
        }
      }

      // Chimenea en la mitad de los edificios
      if (Math.random() < 0.5) {
        const ch = new THREE.Mesh(geo.chimney, M.brick);
        ch.position.set(o.x + o.w * 0.72, o.h + ht * 0.55, o.z + o.d * 0.3);
        ch.castShadow = true;
        worldGroup.add(ch);
      }

      const face = Math.random() < 0.5;
      const dx = face ? o.x + o.w * (0.3 + Math.random() * 0.4) : o.x - 0.02;
      const dz = face ? o.z - 0.02 : o.z + o.d * (0.3 + Math.random() * 0.4);
      doors.push({ x: dx, z: dz, ry: face ? Math.PI : -Math.PI / 2 });
      // Marco de la puerta: dos jambas, dintel y escalón
      const p1 = new THREE.Mesh(geo.framePost, M.trim);
      const p2 = new THREE.Mesh(geo.framePost, M.trim);
      const lintel = new THREE.Mesh(geo.frameLintel, M.trim);
      const step = new THREE.Mesh(geo.doorstep, M.plinth);
      if (face) {
        p1.position.set(dx - 0.52, 1.05, dz);
        p2.position.set(dx + 0.52, 1.05, dz);
        lintel.position.set(dx, 2.22, dz);
        step.position.set(dx, 0.07, dz - 0.3);
      } else {
        p1.position.set(dx, 1.05, dz - 0.52);
        p2.position.set(dx, 1.05, dz + 0.52);
        lintel.rotation.y = Math.PI / 2;
        lintel.position.set(dx, 2.22, dz);
        step.rotation.y = Math.PI / 2;
        step.position.set(dx - 0.3, 0.07, dz);
      }
      p1.castShadow = p2.castShadow = lintel.castShadow = step.castShadow = true;
      worldGroup.add(p1, p2, lintel, step);
    }
    if (doors.length) {
      const im = new THREE.InstancedMesh(geo.door, M.door, doors.length);
      doors.forEach((d, i) => {
        dummy.position.set(d.x, 1, d.z);
        dummy.rotation.set(0, d.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      worldGroup.add(im);
    }

    // Ventanas: normales y encendidas (brillan con el bloom)
    const winsDark = [];
    const winsLit = [];
    for (const o of houses) {
      const rows = Math.max(1, Math.floor((o.h - 1.2) / 2.4));
      for (let r = 0; r < rows; r++) {
        const y = 1.6 + r * 2.4;
        const pushW = (x, z, ry) => (Math.random() < 0.3 ? winsLit : winsDark).push({ x, y, z, ry });
        for (let i = 1; i * 2.2 < o.w; i++) {
          const x = o.x + i * 2.2;
          pushW(x, o.z - 0.03, Math.PI);
          pushW(x, o.z + o.d + 0.03, 0);
        }
        for (let i = 1; i * 2.2 < o.d; i++) {
          const z = o.z + i * 2.2;
          pushW(o.x - 0.03, z, -Math.PI / 2);
          pushW(o.x + o.w + 0.03, z, Math.PI / 2);
        }
      }
    }
    for (const [list, mat] of [[winsDark, M.glass], [winsLit, M.glassLit]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo.window, mat, list.length);
      list.forEach((w, i) => {
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(0, w.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      worldGroup.add(im);
      // Alféizar debajo del cristal
      const sills = new THREE.InstancedMesh(geo.sill, M.trim, list.length);
      list.forEach((w, i) => {
        dummy.position.set(w.x, w.y - 0.66, w.z);
        dummy.rotation.set(0, w.ry, 0);
        dummy.updateMatrix();
        sills.setMatrixAt(i, dummy.matrix);
      });
      sills.instanceMatrix.needsUpdate = true;
      worldGroup.add(sills);
    }

    // Cajas de madera
    if (crates.length) {
      const im = new THREE.InstancedMesh(geo.crate, M.wood, crates.length);
      crates.forEach((o, i) => {
        dummy.position.set(o.x + o.w / 2, o.h / 2, o.z + o.d / 2);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(o.w, o.h, o.d);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, new THREE.Color().setHSL(0.08 + Math.random() * 0.02, 0.5, 0.36 + Math.random() * 0.1));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      worldGroup.add(im);
    }

    // Árboles
    if (trees.length) {
      const trunks = new THREE.InstancedMesh(geo.trunk, M.trunk, trees.length);
      const leaves = new THREE.InstancedMesh(geo.foliage, M.foliage, trees.length);
      const leavesTop = new THREE.InstancedMesh(geo.foliageTop, M.foliage, trees.length);
      trees.forEach((o, i) => {
        const s = 0.9 + Math.random() * 0.55;
        dummy.position.set(o.x, 1.3, o.z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        // Copa principal, más ancha
        dummy.position.set(o.x, 3.2 * s, o.z);
        dummy.rotation.set(0, Math.random() * 3, 0);
        dummy.scale.set(s * 1.1, s * 0.95, s * 1.1);
        dummy.updateMatrix();
        leaves.setMatrixAt(i, dummy.matrix);
        // Copa superior, más pequeña y algo desplazada
        dummy.position.set(o.x + (Math.random() - 0.5) * 0.4, 4.4 * s, o.z + (Math.random() - 0.5) * 0.4);
        dummy.scale.set(s * 0.8, s * 0.75, s * 0.8);
        dummy.updateMatrix();
        leavesTop.setMatrixAt(i, dummy.matrix);
        const tone = new THREE.Color().setHSL(0.25 + Math.random() * 0.08, 0.45 + Math.random() * 0.15, 0.2 + Math.random() * 0.12);
        leaves.setColorAt(i, tone);
        leavesTop.setColorAt(i, tone.clone().offsetHSL(0.01, 0.05, 0.05));
      });
      trunks.castShadow = true;
      leaves.castShadow = true;
      leavesTop.castShadow = true;
      leaves.receiveShadow = true;
      leavesTop.receiveShadow = true;
      worldGroup.add(trunks, leaves, leavesTop);
    }

    // Faroles en los caminos y cerca de casas
    const lamps = [];
    for (let i = 0; i < 26; i++) {
      const x = 4 + Math.random() * (WORLD - 8), z = 4 + Math.random() * (WORLD - 8);
      if (!blockedAt(x, 0.5, z)) lamps.push({ x, z });
    }
    if (lamps.length) {
      const poles = new THREE.InstancedMesh(geo.lampPole, M.pole, lamps.length);
      const heads = new THREE.InstancedMesh(geo.lampHead, M.lampHead, lamps.length);
      lamps.forEach((p, i) => {
        dummy.position.set(p.x, 2.1, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(p.x, 4.3, p.z);
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
      });
      poles.castShadow = true;
      worldGroup.add(poles, heads);
      lampRefs = lamps;
    }

    // Decoración sin colisión: rocas y arbustos
    const rocks = [], bushes = [];
    for (let tries = 0; tries < 900 && (rocks.length < 60 || bushes.length < 90); tries++) {
      const x = 3 + Math.random() * (WORLD - 6);
      const z = 3 + Math.random() * (WORLD - 6);
      if (blockedAt(x, 0.5, z)) continue;
      if (Math.random() < 0.4 && rocks.length < 60) rocks.push({ x, z });
      else if (bushes.length < 90) bushes.push({ x, z });
    }
    if (rocks.length) {
      const im = new THREE.InstancedMesh(geo.rock, M.rock, rocks.length);
      rocks.forEach((p, i) => {
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
    if (bushes.length) {
      const im = new THREE.InstancedMesh(geo.bush, M.bush, bushes.length);
      bushes.forEach((p, i) => {
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

    // ----- Decorado adicional -----
    // Pasto: matas instanciadas, muy baratas (sin sombras)
    const tufts = [];
    for (let tries = 0; tries < 1400 && tufts.length < 650; tries++) {
      const x = 2 + Math.random() * (WORLD - 4), z = 2 + Math.random() * (WORLD - 4);
      if (blockedAt(x, 0.5, z)) continue;
      if (Math.abs(x - WORLD / 2) < 6.5 || Math.abs(z - WORLD / 2) < 6.5) continue; // no en los caminos
      tufts.push({ x, z });
    }
    if (tufts.length) {
      const im = new THREE.InstancedMesh(geo.grassBlade, grassMat, tufts.length);
      tufts.forEach((p, i) => {
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * TAU, (Math.random() - 0.5) * 0.2);
        const sc = 0.8 + Math.random() * 0.6;
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, new THREE.Color().setHSL(0.26 + Math.random() * 0.08, 0.5, 0.3 + Math.random() * 0.14));
      });
      worldGroup.add(im);
    }

    // Parches de tierra desgastada
    const patches = [];
    for (let tries = 0; tries < 300 && patches.length < 40; tries++) {
      const x = 3 + Math.random() * (WORLD - 6), z = 3 + Math.random() * (WORLD - 6);
      if (blockedAt(x, 0.5, z)) continue;
      patches.push({ x, z, r: 1.2 + Math.random() * 2.6 });
    }
    if (patches.length) {
      const im = new THREE.InstancedMesh(geo.dirtPatch, dirtPatchMat, patches.length);
      patches.forEach((p, i) => {
        dummy.position.set(p.x, 0.03, p.z);
        dummy.rotation.set(-Math.PI / 2, 0, Math.random() * TAU);
        dummy.scale.set(p.r, p.r * (0.6 + Math.random() * 0.5), 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.receiveShadow = true;
      worldGroup.add(im);
    }

    // Barriles y sacos de arena junto a las casas
    const barrels = [];
    const bagSpots = [];
    for (const o of houses) {
      if (Math.random() < 0.75) {
        for (let tries = 0; tries < 6 && barrels.length < 40; tries++) {
          const side = Math.floor(Math.random() * 4);
          const px = side === 0 ? o.x - 1.1 : side === 1 ? o.x + o.w + 1.1 : o.x + Math.random() * o.w;
          const pz = side === 2 ? o.z - 1.1 : side === 3 ? o.z + o.d + 1.1 : o.z + Math.random() * o.d;
          if (blockedAt(px, 0.5, pz)) continue;
          barrels.push({ x: px, z: pz });
        }
      }
      if (Math.random() < 0.55) {
        for (let tries = 0; tries < 6 && bagSpots.length < 24; tries++) {
          const side = Math.floor(Math.random() * 4);
          const px = side === 0 ? o.x - 1.5 : side === 1 ? o.x + o.w + 1.5 : o.x + Math.random() * o.w;
          const pz = side === 2 ? o.z - 1.5 : side === 3 ? o.z + o.d + 1.5 : o.z + Math.random() * o.d;
          if (blockedAt(px, 0.5, pz)) continue;
          bagSpots.push({ x: px, z: pz, ry: side < 2 ? Math.PI / 2 : 0 });
        }
      }
    }
    barrels.forEach((b, i) => {
      const m = new THREE.Mesh(geo.barrel, barrelMats[i % barrelMats.length]);
      m.position.set(b.x, 0.45, b.z);
      m.rotation.y = Math.random() * TAU;
      m.castShadow = true;
      m.receiveShadow = true;
      worldGroup.add(m);
    });
    if (bagSpots.length) {
      const bags = [];
      bagSpots.forEach((b) => {
        for (let k = -1; k <= 1; k++) {
          bags.push({
            x: b.ry === 0 ? b.x + k * 0.6 : b.x,
            z: b.ry === 0 ? b.z : b.z + k * 0.6,
            y: 0.14 + (k !== 0 && Math.random() < 0.4 ? 0.26 : 0),
            ry: b.ry + (Math.random() - 0.5) * 0.12,
          });
        }
      });
      const im = new THREE.InstancedMesh(geo.sandbag, sandbagMat, bags.length);
      bags.forEach((b, i) => {
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(0, b.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      worldGroup.add(im);
    }

    // Cercas de madera a lo largo de los caminos (con tramos rotos)
    const fencePosts = [];
    const fenceRails = [];
    const half = WORLD / 2;
    for (const road of ['v', 'h']) {
      for (const off of [-7.4, 7.4]) {
        let prev = null;
        for (let t = 6; t < WORLD - 6; t += 2.6) {
          const bx = road === 'v' ? half + off : t;
          const bz = road === 'v' ? t : half + off;
          if (blockedAt(bx, 0.5, bz) || Math.random() < 0.3) { prev = null; continue; }
          fencePosts.push({ x: bx, z: bz });
          if (prev) {
            const rail = {
              x: (prev.x + bx) / 2, z: (prev.z + bz) / 2,
              ry: road === 'v' ? Math.PI / 2 : 0,
            };
            fenceRails.push({ ...rail, y: 0.45 }, { ...rail, y: 0.85 });
          }
          prev = { x: bx, z: bz };
        }
      }
    }
    if (fencePosts.length) {
      const im = new THREE.InstancedMesh(geo.fencePost, fenceMat, fencePosts.length);
      fencePosts.forEach((p, i) => {
        dummy.position.set(p.x, 0.55, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 0.9 + Math.random() * 0.3, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      worldGroup.add(im);
    }
    if (fenceRails.length) {
      const im = new THREE.InstancedMesh(geo.fenceRail, fenceMat, fenceRails.length);
      fenceRails.forEach((r, i) => {
        dummy.position.set(r.x, r.y, r.z);
        dummy.rotation.set(0, r.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      worldGroup.add(im);
    }
  }

  // ----- Personajes -----
  // ----- Personaje con aspecto de videojuego: avatar realista + animaciones de Mixamo -----
  let avatar = null;         // GLTF del avatar (cuerpo, cabeza, ropa separada por materiales)
  let avatarScale = 1;       // escala para que mida 1.8 m
  let avatarMinY = 0;        // altura de los pies del modelo original
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();

  function loadAvatar() {
    new GLTFLoader().loadAsync('assets/avatar.glb').then((av) => {
      const box = new THREE.Box3().setFromObject(av.scene);
      avatarScale = 1.8 / (box.max.y - box.min.y);
      avatarMinY = box.min.y;
      avatar = av;
    }).catch((err) => console.warn('Avatar no disponible, se usa el personaje simple:', err));
  }

  // Rotación de un hueso sobre su eje X local, compuesta con la postura de reposo
  const _poseQ = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _xAxis = new THREE.Vector3(1, 0, 0);
  const _yAxis = new THREE.Vector3(0, 1, 0);
  function setBone(ch, name, ang, axis = _xAxis) {
    const bn = ch.bones[name];
    if (!bn) return;
    _poseQ.setFromAxisAngle(axis, ang);
    bn.b.quaternion.copy(bn.rest).multiply(_poseQ);
  }

  // Pose del avatar con articulaciones completas: zancada con rodilla y pie,
  // balanceo de torso y hombros, codos flexionados y brazos sosteniendo el arma.
  // Signos verificados contra el esqueleto del modelo (frente del personaje = +z):
  // muslo +X = paso al frente · rodilla -X = flexión · brazo izquierdo +Z al frente,
  // brazo derecho -Z al frente (los huesos van espejados).
  const AIM_RAISE = 1.25;

  // Mezcla de animación: guarda la pose actual de cada articulación y la acerca
  // al objetivo de este frame, así los cambios (pararse, agacharse, apuntar) son fluidos.
  function blendBone(ch, name, target, axis, dt, rate = 10) {
    if (!ch.bones[name]) return;
    if (!ch.pose) ch.pose = {};
    if (ch.poseAxis && ch.poseAxis[name] && ch.poseAxis[name] !== (axis || _xAxis)) {
      ch.pose[name] = target; // cambió de eje: sin mezcla entre ejes distintos
    }
    const k = 1 - Math.exp(-rate * dt);
    const cur = ch.pose[name] ?? target;
    const v = cur + (target - cur) * k;
    ch.pose[name] = v;
    if (!ch.poseAxis) ch.poseAxis = {};
    ch.poseAxis[name] = axis || _xAxis;
    setBone(ch, name, v, axis);
  }
  function poseAvatar(ch, e, dt = 1 / 60) {
    const moving = !!(e.moving && e.alive);
    const run = e.sprinting ? 1.55 : 1;
    const t = e.walk;
    const sw = moving ? Math.sin(t) * 0.55 * run : 0;
    const aim = e.ads ? 1 : 0;
    const dtc = Math.min(dt, 0.1);

    // Piernas: zancada con rodilla y pie; al agacharse, rodillas muy dobladas
    const crouchK = e.crouch ? 1 : 0;
    blendBone(ch, 'LeftUpLeg', moving ? sw : 0.03, _xAxis, dtc, 14);
    blendBone(ch, 'RightUpLeg', moving ? -sw : -0.03, _xAxis, dtc, 14);
    const kneeBase = 0.12 + crouchK * 0.5;
    const kneeL = kneeBase + (moving ? 0.85 * Math.max(0, Math.cos(t + 0.6)) * run : 0);
    const kneeR = kneeBase + (moving ? 0.85 * Math.max(0, Math.cos(t + Math.PI + 0.6)) * run : 0);
    blendBone(ch, 'LeftLeg', -kneeL, _xAxis, dtc, 14);
    blendBone(ch, 'RightLeg', -kneeR, _xAxis, dtc, 14);
    blendBone(ch, 'LeftFoot', moving ? 0.1 + Math.sin(t + 2.6) * 0.28 : 0.06, _xAxis, dtc, 14);
    blendBone(ch, 'RightFoot', moving ? 0.1 + Math.sin(t + Math.PI + 2.6) * 0.28 : 0.06, _xAxis, dtc, 14);

    // Cadera: vaivén lateral al caminar y rebote vertical del cuerpo
    blendBone(ch, 'Hips', moving ? Math.sin(t) * 0.09 : 0, _yAxis, dtc, 10);
    const bobTarget = moving ? Math.abs(Math.sin(t)) * 0.055 * run : 0;
    if (ch.body) {
      const kb = 1 - Math.exp(-12 * dtc);
      ch.bob = (ch.bob ?? 0) + (bobTarget - (ch.bob ?? 0)) * kb;
      ch.body.position.y = ch.bob;
    }

    // Torso: inclinación al correr, curvatura agachado, cuerpo al frente al apuntar
    const lean = (moving ? (e.sprinting ? 0.13 : 0.07) : 0.01) + crouchK * 0.32 + aim * 0.05;
    blendBone(ch, 'Spine', lean, _xAxis, dtc, 8);
    blendBone(ch, 'Spine1', lean * 0.8, _xAxis, dtc, 8);
    blendBone(ch, 'Spine2', crouchK * 0.16 + aim * 0.05, _xAxis, dtc, 8);
    blendBone(ch, 'Neck', -crouchK * 0.3 - lean * 0.4 + aim * 0.12, _xAxis, dtc, 8);

    // Brazos: arma al frente; apuntar sube más; vaivén al correr; respiración en reposo
    const reloadK = e.alive ? 1 - 0.45 * (ch.reloadPose || 0) : 0;
    const sway = moving ? Math.sin(t * 2) * (e.sprinting ? 0.12 : 0.05) : 0;
    const breathe = !moving ? Math.sin(G.elapsed * 2 + (e.id || 0)) * 0.02 : 0;
    const raise = (AIM_RAISE + aim * 0.22) * reloadK;
    const raiseL = raise + sway + breathe;
    const raiseR = raise - sway + breathe;
    blendBone(ch, 'LeftArm', raiseL, _zAxis, dtc, 12);
    blendBone(ch, 'RightArm', -raiseR, _zAxis, dtc, 12);
    blendBone(ch, 'LeftForeArm', raiseL * (0.4 + aim * 0.25), _zAxis, dtc, 12);
    blendBone(ch, 'RightForeArm', -raiseR * (0.4 + aim * 0.25), _zAxis, dtc, 12);
    blendBone(ch, 'LeftShoulder', -sway * 0.6, _zAxis, dtc, 10);
    blendBone(ch, 'RightShoulder', -sway * 0.6, _zAxis, dtc, 10);
  }

  function buildAvatarCharacter(e) {
    const look = e.look || {};
    const root = new THREE.Group();
    const model = SkeletonUtils.clone(avatar.scene);
    model.scale.setScalar(avatarScale);
    model.position.y = -avatarMinY * avatarScale;
    // "body" es el grupo que mueve la animación de caminar; el modelo va dentro con su ajuste de pies
    const body = new THREE.Group();
    body.add(model);
    root.add(body);

    // Ropa según el personaje (los bots usan la paleta de camisetas)
    // Colores de ropa algo apagados: se ven más como tela real que como plástico
    const topColor = new THREE.Color(e.isPlayer ? (look.shirt ?? SHIRT_FOR_PLAYER) : SHIRTS[e.colorIdx % SHIRTS.length]).lerp(new THREE.Color(0x4a4a4a), 0.3);
    const pantsColor = new THREE.Color(look.pants ?? 0x2b3a46);
    const bootsColor = new THREE.Color(0x1b1412);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.material = o.material.clone();
      const n = o.material.name;
      if (n === 'Wolf3D_Outfit_Top') o.material.color.copy(topColor);
      else if (n === 'Wolf3D_Outfit_Bottom') o.material.color.copy(pantsColor);
      else if (n === 'Wolf3D_Outfit_Footwear') o.material.color.copy(bootsColor);
      else if (n === 'Wolf3D_Headwear' && look.helmet != null) o.material.color.set(look.helmet);
      else if (n === 'Wolf3D_Headwear' && look.hair != null) o.material.color.set(look.hair);
    });

    // Huesos que movemos a mano, guardando su postura de reposo para componer las rotaciones
    const bones = {};
    for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']) {
      const b = model.getObjectByName(n);
      if (b) bones[n] = { b, rest: b.quaternion.clone() };
    }

    const gunPivot = new THREE.Group();
    root.add(gunPivot);
    const guns = {};
    for (const k of Object.keys(WEAPONS)) {
      const g = buildGunModel(k);
      g.visible = false;
      gunPivot.add(g);
      guns[k] = g;
    }

    let ring = null;
    if (e.isPlayer) {
      ring = new THREE.Mesh(geo.ring, playerRingMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      root.add(ring);
    }

    const wing = addGlider(root, topColor);
    return {
      root, body, legs: [], arms: [], vest: { visible: false }, shirtMat: null, gunPivot, guns, ring, wing,
      weapon: null, shotsSeen: 0, kick: 0, dead: false, deathT: 0, lean: 0,
      bones, hand: model.getObjectByName('RightHand'), animated: true,
    };
  }

  // Ala del planeador: aparece sobre la cabeza durante el descenso inicial
  function addGlider(root, colorHex) {
    const wing = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, side: THREE.DoubleSide }),
    );
    canopy.scale.set(1.5, 0.5, 1.0);
    canopy.position.y = 2.7;
    canopy.castShadow = true;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6), M.dark);
    bar.rotation.x = 1.15;
    bar.position.y = 2.15;
    wing.add(canopy, bar);
    wing.visible = false;
    root.add(wing);
    return wing;
  }

  // e: entidad del juego. Su `look` define colores según el personaje elegido en el lobby.
  function buildCharacter(e) {
    if (avatar) return buildAvatarCharacter(e);
    const isPlayer = e.isPlayer;
    const look = e.look || {};
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const shirtMat = new THREE.MeshStandardMaterial({
      color: isPlayer ? (look.shirt ?? SHIRT_FOR_PLAYER) : SHIRTS[e.colorIdx % SHIRTS.length], roughness: 0.7,
      map: camoTex,
    });
    const glovesMat = M.dark;
    const pantsMat = new THREE.MeshStandardMaterial({ color: look.pants ?? 0x2b3a46, roughness: 0.9 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: look.helmet ?? 0x3e4d2a, roughness: 0.45, metalness: 0.25 });
    const skinMat = new THREE.MeshStandardMaterial({ color: look.skin ?? 0xe0ac7e, roughness: 0.6 });
    const part = (geometry, mat, x, y, z, shadow = true) => {
      const m = new THREE.Mesh(geometry, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      body.add(m);
      return m;
    };

    part(geo.pelvis, pantsMat, 0, 0.9, 0);
    part(geo.torso, shirtMat, 0, 1.22, 0);
    const vest = part(geo.vest, M.olive, 0, 1.22, 0.01);
    vest.visible = false;
    // Bolsillos del chaleco
    for (const sx of [-0.14, 0.14]) {
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.06), M.dark);
      pouch.position.set(sx, 0.02, 0.2);
      vest.add(pouch);
    }
    part(geo.backpack, M.dark, 0, 1.2, -0.22);
    part(geo.neck, skinMat, 0, 1.56, 0);
    part(geo.cinturon, M.dark, 0, 1.0, 0);
    part(geo.head, skinMat, 0, 1.72, 0);
    if (look.helmet != null) {
      const helmet = part(geo.helmet, helmetMat, 0, 1.8, 0);
      helmet.rotation.x = -0.12;
      part(geo.visor, M.visor, 0, 1.74, 0.16);
    } else {
      // Sin casco: pelo y cara
      const hairMat = new THREE.MeshStandardMaterial({ color: look.hair ?? 0x2b1d14, roughness: 0.8 });
      const hair = part(geo.hair, hairMat, 0, 1.76, -0.02);
      hair.rotation.x = -0.25;
      for (const sx of [-0.07, 0.07]) {
        part(geo.eyeW, M.eyeW, sx, 1.75, 0.165, false);
        part(geo.pupil, M.dark, sx, 1.75, 0.19, false);
      }
      part(geo.nose, skinMat, 0, 1.71, 0.2);
      part(geo.mouth, M.dark, 0, 1.63, 0.17, false);
    }

    // Piernas con articulación: cadera (pivote) + rodilla + bota
    const legs = [];
    for (const sx of [-0.12, 0.12]) {
      const hip = new THREE.Group();
      hip.position.set(sx, 0.86, 0);
      const thigh = new THREE.Mesh(geo.leg, pantsMat);
      thigh.scale.y = 0.56;
      thigh.position.y = -0.2;
      thigh.castShadow = true;
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      const shin = new THREE.Mesh(geo.leg, pantsMat);
      shin.scale.y = 0.44;
      shin.position.y = -0.16;
      shin.castShadow = true;
      const boot = new THREE.Mesh(geo.boot, M.boots);
      boot.position.set(0, -0.38, 0.02);
      boot.castShadow = true;
      knee.add(shin, boot);
      hip.add(thigh, knee);
      body.add(hip);
      legs.push({ hip, knee });
    }

    // Brazos con articulación: hombro (pivote al frente) + codo + mano
    const arms = [];
    for (const sx of [-0.35, 0.35]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx, 1.46, 0);
      shoulder.rotation.x = -1.35;
      const ball = new THREE.Mesh(geo.shoulder, shirtMat);
      ball.castShadow = true;
      const upper = new THREE.Mesh(geo.arm, shirtMat);
      upper.scale.y = 0.5;
      upper.position.y = -0.15;
      upper.castShadow = true;
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      const fore = new THREE.Mesh(geo.arm, shirtMat);
      fore.scale.y = 0.5;
      fore.position.y = -0.15;
      fore.castShadow = true;
      const hand = new THREE.Mesh(geo.hand, glovesMat);
      hand.position.y = -0.34;
      hand.castShadow = true;
      elbow.add(fore, hand);
      shoulder.add(ball, upper, elbow);
      body.add(shoulder);
      arms.push({ shoulder, elbow });
    }

    // Armas: un modelo por tipo, solo se muestra la activa
    const gunPivot = new THREE.Group();
    gunPivot.position.set(0.16, 1.33, 0.68);
    root.add(gunPivot);
    const guns = {};
    for (const k of Object.keys(WEAPONS)) {
      const g = buildGunModel(k);
      g.visible = false;
      gunPivot.add(g);
      guns[k] = g;
    }

    // Anillo bajo los pies para identificar al jugador
    let ring = null;
    if (isPlayer) {
      ring = new THREE.Mesh(geo.ring, playerRingMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      root.add(ring);
    }

    const wing = addGlider(root, shirtMat.color.getHex());
    return {
      root, body, legs, arms, vest, shirtMat, gunPivot, guns, ring, wing,
      weapon: null, shotsSeen: 0, kick: 0, dead: false, deathT: 0, lean: 0,
    };
  }

  function setWeaponModel(ch, key) {
    if (ch.weapon === key) return;
    if (ch.weapon) ch.guns[ch.weapon].visible = false;
    ch.weapon = key;
    ch.guns[key].visible = true;
  }

  // ----- Loot -----
  function buildLoot(it) {
    const g = new THREE.Group();
    if (it.kind === 'weapon') {
      const gun = buildGunModel(it.weapon);
      gun.scale.setScalar(1.15);
      gun.position.set(0, 0.16, 0);
      gun.rotation.y = Math.random() * Math.PI;
      g.add(gun);
      const beam = new THREE.Mesh(geo.beam, beamMats[it.weapon]);
      beam.position.y = 4.5;
      g.add(beam);
    } else if (it.kind === 'med') {
      const box3 = new THREE.Mesh(geo.medBox, M.med);
      box3.position.y = 0.3;
      box3.castShadow = true;
      g.add(box3);
      const v = new THREE.Mesh(geo.medBar, M.medRed);
      v.rotation.y = Math.PI / 2;
      v.position.set(0, 0.56, 0);
      g.add(v);
      const h = new THREE.Mesh(geo.medBar, M.medRed);
      h.position.set(0, 0.56, 0);
      g.add(h);
      const beam = new THREE.Mesh(geo.beam, medBeam);
      beam.position.y = 4.5;
      g.add(beam);
    } else if (it.kind === 'grenade') {
      const gr = new THREE.Mesh(geo.grenade, M.grenade);
      gr.position.y = 0.2;
      gr.castShadow = true;
      g.add(gr);
      const beam = new THREE.Mesh(geo.beam, grenadeBeam);
      beam.position.y = 4.5;
      g.add(beam);
    } else if (it.kind === 'gloo') {
      const wall = new THREE.Mesh(geo.medBox, glooWallMat);
      wall.scale.set(0.85, 0.55, 0.85);
      wall.position.y = 0.3;
      wall.castShadow = true;
      g.add(wall);
      const beam = new THREE.Mesh(geo.beam, glooBeamMat);
      beam.position.y = 4.5;
      g.add(beam);
    } else {
      const a = new THREE.Mesh(geo.armorBox, M.olive);
      a.position.y = 0.25;
      a.castShadow = true;
      g.add(a);
      const beam = new THREE.Mesh(geo.beam, armorBeam);
      beam.position.y = 4.5;
      g.add(beam);
    }
    return g;
  }

  // ----- Estado de sincronización -----
  const chars = new Map();        // entity.id -> character
  const lootMeshes = new Map();   // loot.id -> group
  const tracers = new Map();      // bullet obj -> mesh
  const grenadeMeshes = new Map();// grenade id -> mesh
  const particles = [];           // { mesh, vel, life, maxLife, gravity, grow, bounce }
  const shortFx = [];             // { mesh, life, maxLife, grow }
  const zoneWall = new THREE.Mesh(geo.zoneWall, zoneMat);
  zoneWall.position.y = 15;
  zoneWall.visible = false;
  scene.add(zoneWall);
  const zoneLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 128 }, (_, i) => {
        const a = (i / 128) * TAU;
        return new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a));
      }),
    ),
    zoneLineMat,
  );
  zoneLine.visible = false;
  scene.add(zoneLine);

  const camPos = new THREE.Vector3(WORLD / 2, 3, WORLD / 2);
  const camLook = new THREE.Vector3();
  let fovNow = 62;
  let orbitT = 0;
  let shake = 0;
  let walkBob = 0;
  let quality = 'alta';
  let composer = null;
  let bloomPass = null;
  let usePost = false;

  // ----- Calidad y post-procesado -----
  function applyQuality(q) {
    quality = q;
    const high = q === 'alta';
    renderer.shadowMap.enabled = high;
    sun.castShadow = high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? (IS_TOUCH ? 1.5 : 2) : 1));
    if (bloomPass) bloomPass.enabled = high;
    if (composer) usePost = high;   // en baja se dibuja directo, sin pases extra
    resize();
  }

  async function loadPost() {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }, { VignetteShader }, { RoomEnvironment }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
        import('three/addons/postprocessing/ShaderPass.js'),
        import('three/addons/shaders/VignetteShader.js'),
        import('three/addons/environments/RoomEnvironment.js'),
      ]);
      // Reflejos y rebote de luz realistas en todos los materiales
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.55;
      pmrem.dispose();
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.92);
      composer.addPass(bloomPass);
      // Viñeteado suave: oscurece los bordes y enfoca la mirada al centro
      const vignette = new ShaderPass(VignetteShader);
      vignette.uniforms.offset.value = 1.25;
      vignette.uniforms.darkness.value = 0.85;
      composer.addPass(vignette);
      composer.addPass(new OutputPass());
      usePost = true;
      applyQuality(quality);
    } catch (err) {
      console.warn('Post-procesado no disponible, se usa render normal:', err);
      usePost = false;
    }
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
  }

  function reset() {
    for (const ch of chars.values()) scene.remove(ch.root);
    chars.clear();
    for (const g of lootMeshes.values()) scene.remove(g);
    lootMeshes.clear();
    for (const m of tracers.values()) scene.remove(m);
    tracers.clear();
    for (const m of grenadeMeshes.values()) scene.remove(m);
    grenadeMeshes.clear();
    for (const p of particles) scene.remove(p.mesh);
    particles.length = 0;
    for (const f of shortFx) scene.remove(f.mesh);
    shortFx.length = 0;
    buildWorld();
  }

  // ----- Partículas y efectos -----
  function spawnParticle(mesh, vel, life, opts = {}) {
    scene.add(mesh);
    particles.push({ mesh, vel, life, maxLife: life, gravity: opts.gravity ?? 0, grow: opts.grow ?? 0, bounce: opts.bounce ?? false, fade: opts.fade ?? false, spin: opts.spin ?? 0 });
  }

  function spawnSparks(x, y, z, n = 7, mat = M.spark) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo.spark, mat);
      m.position.set(x, y, z);
      spawnParticle(m, new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3.5, (Math.random() - 0.5) * 5), 0.45, { gravity: 9.8 });
    }
  }

  function spawnDust(x, y, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xcdbb9a, transparent: true, opacity: 0.55, depthWrite: false });
    const m = new THREE.Mesh(geo.puff, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(0.12);
    spawnParticle(m, new THREE.Vector3(0, 0.4, 0), 0.5, { grow: 1.4, fade: true });
  }

  function spawnBlood(x, y, z) {
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(geo.spark, M.blood);
      m.position.set(x, y, z);
      m.scale.setScalar(0.8);
      spawnParticle(m, new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), 0.6, { gravity: 9.8 });
    }
  }

  function spawnShell(x, y, z, dir) {
    const m = new THREE.Mesh(geo.shell, M.shell);
    m.position.set(x, y, z);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const vel = side.multiplyScalar(2.2 + Math.random() * 1.2).add(new THREE.Vector3(0, 2.2 + Math.random(), 0));
    spawnParticle(m, vel, 1.6, { gravity: 9.8, bounce: true, spin: 18 });
  }

  function spawnExplosion(x, y, z, radius) {
    // Destello y onda de choque
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false });
    const flash = new THREE.Mesh(geo.puff, flashMat);
    flash.position.set(x, y + 0.5, z);
    flash.scale.setScalar(0.5);
    scene.add(flash);
    shortFx.push({ mesh: flash, life: 0.35, maxLife: 0.35, grow: radius * 1.6 });

    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 1, depthWrite: false });
    const core = new THREE.Mesh(geo.puff, coreMat);
    core.position.set(x, y + 0.4, z);
    core.scale.setScalar(0.3);
    scene.add(core);
    shortFx.push({ mesh: core, life: 0.2, maxLife: 0.2, grow: radius * 0.7 });

    // Humo
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.6, depthWrite: false });
      const m = new THREE.Mesh(geo.puff, mat);
      m.position.set(x + (Math.random() - 0.5) * 2, y + 0.5, z + (Math.random() - 0.5) * 2);
      m.scale.setScalar(0.6);
      spawnParticle(m, new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2), 1.6, { grow: 1.8, fade: true });
    }
    // Escombros
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(geo.spark, M.wood);
      m.material = new THREE.MeshStandardMaterial({ color: 0x6d4c41 });
      m.position.set(x, y, z);
      m.scale.setScalar(1.6);
      spawnParticle(m, new THREE.Vector3((Math.random() - 0.5) * 9, 4 + Math.random() * 5, (Math.random() - 0.5) * 9), 1.1, { gravity: 12, bounce: true, spin: 10 });
    }
    shake = Math.max(shake, 1.0);
  }

  // ----- Sincronización de entidades -----
  function syncCharacters(dt) {
    for (const e of G.entities) {
      let ch = chars.get(e.id);
      if (!ch) {
        ch = buildCharacter(e);
        chars.set(e.id, ch);
        scene.add(ch.root);
        ch.shotsSeen = e.shots;
      }
      const w = WEAPONS[e.weapon];
      setWeaponModel(ch, e.weapon);
      ch.root.position.set(e.x, e.y || 0, e.z);
      ch.root.rotation.y = e.yaw;
      if (ch.wing) ch.wing.visible = !!(e.glide && e.alive);
      // Agachado: el cuerpo se encoge desde los pies
      ch.body.scale.y += ((e.crouch ? 0.7 : 1) - ch.body.scale.y) * Math.min(1, dt * 12);
      ch.vest.visible = e.armor > 0;
      ch.reloadPose = e.reloadT > 0 ? Math.sin((1 - e.reloadT / w.reload) * Math.PI) : 0;
      if (ch.animated) poseAvatar(ch, e, dt);

      if (!e.alive) {
        if (!ch.dead) {
          ch.dead = true;
          ch.deathT = 0;
          spawnBlood(e.x, 0.9, e.z);
        }
        ch.deathT = Math.min(1, ch.deathT + dt * 2.2);
        const ease = 1 - Math.pow(1 - ch.deathT, 3);
        ch.body.rotation.x = lerp(0, Math.PI / 2, ease);
        ch.body.position.y = lerp(0, 0.15, ease);
        ch.gunPivot.visible = false;
        if (ch.ring) ch.ring.visible = false;
        continue;
      }

      // Caminar: piernas alternando y balanceo del cuerpo (el modelo animado lo hace solo)
      const swing = e.moving ? Math.sin(e.walk) * 0.7 : 0;
      if (!ch.animated) {
        ch.legs[0].hip.rotation.x = swing;
        ch.legs[1].hip.rotation.x = -swing;
        const bendL = 0.1 + (e.moving ? 0.65 * Math.max(0, Math.cos(e.walk + 0.6)) : 0);
        const bendR = 0.1 + (e.moving ? 0.65 * Math.max(0, Math.cos(e.walk + Math.PI + 0.6)) : 0);
        ch.legs[0].knee.rotation.x = bendL;
        ch.legs[1].knee.rotation.x = bendR;
      }
      walkBob = e.moving ? Math.abs(Math.sin(e.walk * 2)) * 0.05 : 0;
      const breathe = Math.sin(G.elapsed * 2 + e.id) * 0.01;
      ch.body.position.y = walkBob + breathe;
      ch.lean = lerp(ch.lean, e.moving ? 0.05 : 0, 0.15);
      ch.body.rotation.x = ch.lean;

      // Retroceso del último disparo
      if (e.shots !== ch.shotsSeen) {
        ch.shotsSeen = e.shots;
        ch.kick = 1;
        const dir = { x: Math.sin(e.yaw), z: Math.cos(e.yaw) };
        const gp = ch.gunPivot.getWorldPosition(tmpV2);
        if (w.pellets === 1 && e.isPlayer) spawnShell(gp.x, gp.y, gp.z, dir);
        if (!e.isPlayer && Math.random() < 0.5) spawnShell(gp.x, gp.y, gp.z, dir);
      }
      ch.kick = Math.max(0, ch.kick - dt * 9);
      const kickAmt = ch.kick * (w.recoil * 9);

      // Posiciones base del arma y brazos
      let gunX = 0.16, gunY = 1.33, gunZ = 0.68, gunRx = 0, gunRz = 0, gunVisible = true;
      let armRx = -1.35, armRxR = -1.35;

      // Recarga: el arma se inclina y baja
      if (e.reloadT > 0) {
        const prog = 1 - e.reloadT / w.reload;
        const pose = Math.sin(prog * Math.PI);
        gunRz = pose * 0.75;
        gunY -= pose * 0.18;
        gunX -= pose * 0.08;
        armRx = lerp(-1.35, -1.1, pose);
      }
      // Curación: brazo derecho al pecho/cara
      if (e.healT > 0) {
        const prog = 1 - e.healT / 1.1;
        const pose = Math.sin(prog * Math.PI);
        armRxR = lerp(-1.35, -2.3, pose);
        gunVisible = pose < 0.5;
      }
      // Lanzamiento de granada
      if (e.throwT > 0) {
        const prog = 1 - e.throwT / 0.45;
        const pose = Math.sin(prog * Math.PI);
        armRxR = lerp(-1.35, -2.9, pose);
        gunVisible = false;
      }

      ch.gunPivot.position.set(gunX, gunY, gunZ - kickAmt * 0.5);
      ch.gunPivot.rotation.set(gunRx - ch.kick * 0.1, 0, gunRz);
      ch.gunPivot.visible = gunVisible;
      if (ch.animated && ch.hand) {
        // El arma sigue a la mano derecha del modelo
        ch.root.updateMatrixWorld(true);
        ch.hand.getWorldPosition(tmpV);
        ch.root.worldToLocal(tmpV);
        ch.gunPivot.position.copy(tmpV);
        ch.gunPivot.rotation.set(gunRx - ch.kick * 0.1, 0, gunRz);
      }
      if (!ch.animated) {
        ch.arms[0].shoulder.rotation.x = armRx;
        ch.arms[1].shoulder.rotation.x = armRxR;
        ch.arms[0].elbow.rotation.x = -0.3;
        ch.arms[1].elbow.rotation.x = -0.35 - ch.kick * 0.25;
      }
      if (ch.ring) ch.ring.visible = true;
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
      m.position.y = Math.sin(t * 2 + it.id) * 0.08;
      if (it.kind === 'weapon' || it.kind === 'grenade') m.rotation.y = t * 1.2 + it.id;
    }
    for (const [id, m] of lootMeshes) {
      if (!alive.has(id)) {
        scene.remove(m);
        lootMeshes.delete(id);
      }
    }
  }

  // Arcas doradas: aparecen junto a las casas y se abren al acercarse
  const chestMeshes = new Map();
  function syncChests() {
    for (const c of G.chests) {
      let m = chestMeshes.get(c.id);
      if (!m) {
        m = new THREE.Group();
        const body = new THREE.Mesh(geo.chestBody, chestMat);
        body.position.y = 0.28;
        body.castShadow = true;
        const lid = new THREE.Mesh(geo.chestLid, chestMat);
        lid.position.set(0, 0.68, -0.28);
        lid.castShadow = true;
        const band = new THREE.Mesh(geo.chestBody, chestBandMat);
        band.scale.set(1.02, 0.18, 1.04);
        band.position.y = 0.42;
        const beam = new THREE.Mesh(geo.beam, chestBeam);
        beam.position.y = 4.5;
        m.add(body, lid, band, beam);
        m.userData.lid = lid;
        m.userData.beam = beam;
        m.position.set(c.x, 0, c.z);
        m.rotation.y = Math.random() * TAU;
        chestMeshes.set(c.id, m);
        scene.add(m);
      }
      if (c.open !== m.userData.opened) {
        m.userData.opened = c.open;
        m.userData.lid.rotation.x = c.open ? -1.15 : 0;
        m.userData.beam.visible = !c.open;
      }
    }
  }

  // Muros de hielo desplegados: se ven y se encogen según la vida que les queda
  const glooMeshes = new Map();
  function syncGloos() {
    for (const o of G.obstacles) {
      if (o.kind !== 'gloo') continue;
      let m = glooMeshes.get(o);
      if (!m) {
        m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), glooWallMat);
        m.position.set(o.x + o.w / 2, o.h / 2, o.z + o.d / 2);
        m.castShadow = true;
        glooMeshes.set(o, m);
        scene.add(m);
      }
      if (o.gone) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      const k = Math.max(0.55, o.hp / o.maxHp);
      m.scale.y = k;
      m.position.y = (o.h * k) / 2;
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
      const len = b.weapon === 'francotirador' ? 3.6 : 1.8;
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

  function syncGrenades(t) {
    const alive = new Set();
    for (const g of G.grenades) {
      alive.add(g.id);
      let m = grenadeMeshes.get(g.id);
      if (!m) {
        m = new THREE.Mesh(geo.grenade, M.grenade);
        m.castShadow = true;
        const lever = new THREE.Mesh(geo.grenadeLever, M.metal);
        lever.position.y = 0.14;
        m.add(lever);
        grenadeMeshes.set(g.id, m);
        scene.add(m);
      }
      m.position.set(g.x, g.y, g.z);
      m.rotation.set(t * 6, t * 4, 0);
    }
    for (const [id, m] of grenadeMeshes) {
      if (!alive.has(id)) {
        scene.remove(m);
        grenadeMeshes.delete(id);
      }
    }
  }

  // Números de daño flotantes estilo Free Fire
  const dmgNums = [];
  let dmgLayer = null;
  function spawnDamageNumber(x, y, z, amt, head) {
    if (!dmgLayer) {
      dmgLayer = document.createElement('div');
      dmgLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
      document.body.appendChild(dmgLayer);
    }
    const el = document.createElement('div');
    el.textContent = String(amt);
    const size = head ? 27 : 19;
    const col = head ? '#ffd23f' : '#ffffff';
    el.style.cssText = `position:absolute;font-weight:900;font-style:italic;transform:translate(-50%,-50%);color:${col};font-size:${size}px;text-shadow:0 2px 4px rgba(0,0,0,.85),0 0 10px rgba(0,0,0,.5);will-change:left,top,opacity;`;
    dmgLayer.appendChild(el);
    dmgNums.push({ el, x, y, z, life: 0.9, max: 0.9 });
  }

  function updateDamageNumbers(dt) {
    if (!dmgNums.length) return;
    for (let i = dmgNums.length - 1; i >= 0; i--) {
      const n = dmgNums[i];
      n.life -= dt;
      n.y += dt * 1.4;
      if (n.life <= 0) {
        n.el.remove();
        dmgNums.splice(i, 1);
        continue;
      }
      tmpV.set(n.x, n.y, n.z).project(camera);
      if (tmpV.z > 1) {
        n.el.style.opacity = '0';
        continue;
      }
      n.el.style.left = `${(tmpV.x * 0.5 + 0.5) * window.innerWidth}px`;
      n.el.style.top = `${(-tmpV.y * 0.5 + 0.5) * window.innerHeight}px`;
      n.el.style.opacity = String(Math.min(1, n.life / 0.4));
    }
  }

  function consumeEvents() {
    for (const ev of G.events) {
      if (ev.type === 'shot') {
        const m = new THREE.Mesh(geo.flash, M.flash);
        m.position.set(ev.x, ev.y, ev.z);
        m.scale.setScalar(ev.weapon === 'escopeta' ? 2.2 : 1.1);
        scene.add(m);
        shortFx.push({ mesh: m, life: 0.05, maxLife: 0.05, grow: 0 });
        shake = Math.max(shake, ev.weapon === 'escopeta' ? 0.3 : ev.weapon === 'francotirador' ? 0.2 : 0.07);
      } else if (ev.type === 'impact') {
        if (ev.flesh) spawnBlood(ev.x, ev.y, ev.z);
        else if (ev.ground) spawnDust(ev.x, Math.max(0.1, ev.y), ev.z);
        else spawnSparks(ev.x, ev.y, ev.z, 6);
      } else if (ev.type === 'explosion') {
        spawnExplosion(ev.x, ev.y, ev.z, ev.radius);
      } else if (ev.type === 'hit') {
        const v = G.entities.find((en) => en.id === ev.victim);
        if (v) spawnDamageNumber(v.x + (Math.random() - 0.5) * 0.5, 1.4 + Math.random() * 0.4, v.z, ev.amt || 0, ev.head);
      } else if (ev.type === 'chest') {
        spawnSparks(ev.x, 0.9, ev.z, 16, chestSpark);
      } else if (ev.type === 'glooBreak') {
        spawnSparks(ev.x, 1.2, ev.z, 18, glooSparkMat);
      } else if (ev.type === 'kill') {
        shake = Math.max(shake, 0.25);
      } else if (ev.type === 'hurt') {
        shake = Math.max(shake, 0.12);
      }
    }
    G.events.length = 0;
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.bounce && p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.y *= -0.35;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      if (p.spin) p.mesh.rotation.x += p.spin * dt;
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
      if (p.fade && p.mesh.material.opacity !== undefined) {
        p.mesh.material.opacity = Math.max(0, (p.life / p.maxLife) * 0.55);
      }
      if (p.life <= 0) {
        scene.remove(p.mesh);
        particles.splice(i, 1);
      }
    }
    for (let i = shortFx.length - 1; i >= 0; i--) {
      const f = shortFx[i];
      f.life -= dt;
      if (f.grow) f.mesh.scale.multiplyScalar(1 + (f.grow / 3) * dt);
      if (f.life <= 0) {
        scene.remove(f.mesh);
        shortFx.splice(i, 1);
      }
    }
  }

  function syncZone(t) {
    if (!G.zone) {
      zoneWall.visible = false;
      zoneLine.visible = false;
      return;
    }
    const r = Math.max(0.5, G.zone.radius);
    const closing = G.zone.state === 'shrink';
    zoneWall.visible = true;
    zoneLine.visible = true;
    zoneWall.scale.set(r, 1, r);
    zoneWall.position.set(G.zone.cx, 15, G.zone.cz);
    zoneLine.scale.set(r, 1, r);
    zoneLine.position.set(G.zone.cx, 0, G.zone.cz);
    zoneMat.color.setHex(closing ? 0xff3b3b : 0x3b8bff);
    zoneLineMat.color.setHex(closing ? 0xff7a7a : 0xffffff);
    zoneLineMat.opacity = 0.6 + Math.sin(t * 4) * 0.3;
  }

  function placeSun(cx, cz) {
    sun.position.set(cx + sunDir.x * 120, sunDir.y * 120, cz + sunDir.z * 120);
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();
    sunDisc.position.copy(camera.position).addScaledVector(sunDir, 600);
  }

  // Cámara al hombro: se acerca si hay una pared detrás
  function cameraDistance(p, fx, fz, dist, side) {
    const rx = -fz, rz = fx;
    for (let d = dist; d > 1.2; d -= 0.25) {
      const x = p.x - fx * d + rx * side;
      const z = p.z - fz * d + rz * side;
      if (blockedAt(x, 1.6, z)) continue;
      return d;
    }
    return 1.2;
  }

  function render(dt, t) {
    consumeEvents();
    updateDamageNumbers(dt);
    syncChests();
    syncGloos();

    if (G.player && worldGroup) {
      const p = G.player;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const vp = viewPitch(p);
      const cp = Math.cos(vp), sp = Math.sin(vp);
      const rx = -fz, rz = fx;
      const ads = p.ads && p.alive;
      const dist = cameraDistance(p, fx, fz, ads ? 2.6 : 4.4, ads ? 0.45 : 0.85);
      const side = ads ? 0.45 : 0.85;

      const desired = tmpV2.set(
        p.x - fx * dist + rx * side,
        2.35 + sp * 1.2 + (p.moving ? Math.sin(p.walk * 2) * 0.03 : 0),
        p.z - fz * dist + rz * side,
      );
      camPos.lerp(desired, 1 - Math.exp(-dt * 18));
      // La mira apunta a donde irán las balas
      const aim = tmpV3.set(fx * cp, sp, fz * cp);
      camLook.copy(camPos).addScaledVector(aim, 40);

      fovNow = lerp(fovNow, ads ? 46 : 62, 1 - Math.exp(-dt * 12));
      if (Math.abs(camera.fov - fovNow) > 0.05) {
        camera.fov = fovNow;
        camera.updateProjectionMatrix();
      }

      placeSun(p.x, p.z);
      const s = shake * 0.22;
      camera.position.copy(camPos);
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.lookAt(camLook);
      shake = Math.max(0, shake - dt * 3);
    } else {
      orbitT += dt * 0.07;
      const cx = WORLD / 2, cz = WORLD / 2;
      camera.position.set(cx + Math.cos(orbitT) * 120, 52, cz + Math.sin(orbitT) * 120);
      camera.lookAt(cx, 0, cz);
      placeSun(cx, cz);
    }

    sky.position.copy(camera.position);
    syncCharacters(dt);
    syncLoot(t);
    syncBullets();
    syncGrenades(t);
    updateEffects(dt);
    syncZone(t);

    if (usePost && composer) composer.render(dt);
    else renderer.render(scene, camera);
  }

  resize();
  buildWorld();
  applyQuality(quality);

  loadAvatar();
  return { render, reset, resize, buildWorld, loadPost, applyQuality, get lamps() { return lampRefs; } };
}
