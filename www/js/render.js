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

export function createView(canvas) {
  // ----- Renderer -----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 1; sc.far = 320;
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

  // ----- Geometrías compartidas -----
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
    trunk: new THREE.CylinderGeometry(0.22, 0.32, 2.6, 7),
    foliage: new THREE.IcosahedronGeometry(1.25, 1),
    rock: new THREE.DodecahedronGeometry(0.5, 0),
    bush: new THREE.IcosahedronGeometry(0.6, 0),
    window: new RoundedBoxGeometry(0.9, 1.2, 0.1, 2, 0.02),
    sill: new RoundedBoxGeometry(1.1, 0.1, 0.22, 2, 0.03),
    roof: box(1, 0.4, 1),
    chimney: box(0.6, 1.6, 0.6),
    door: box(0.9, 2.0, 0.1),
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
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.95, flatShading: true }),
    bush: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    roof: new THREE.MeshStandardMaterial({ color: 0x4e4e52, roughness: 0.8 }),
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
      const roof = new THREE.Mesh(rg, M.roof);
      if (ridgeX) {
        roof.rotation.y = Math.PI / 2;
        roof.position.set(o.x + o.w / 2, o.h, o.z + o.d / 2);
      } else {
        roof.position.set(o.x + o.w / 2, o.h, o.z + o.d / 2);
      }
      roof.castShadow = true;
      worldGroup.add(roof);

      // Chimenea en la mitad de los edificios
      if (Math.random() < 0.5) {
        const ch = new THREE.Mesh(geo.chimney, M.brick);
        ch.position.set(o.x + o.w * 0.72, o.h + ht * 0.55, o.z + o.d * 0.3);
        ch.castShadow = true;
        worldGroup.add(ch);
      }

      const face = Math.random() < 0.5;
      doors.push({ x: face ? o.x + o.w * (0.3 + Math.random() * 0.4) : o.x - 0.02, z: face ? o.z - 0.02 : o.z + o.d * (0.3 + Math.random() * 0.4), ry: face ? Math.PI : -Math.PI / 2 });
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
      trees.forEach((o, i) => {
        const s = 0.9 + Math.random() * 0.55;
        dummy.position.set(o.x, 1.3, o.z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(o.x, 3.4 * s, o.z);
        dummy.rotation.set(0, Math.random() * 3, 0);
        dummy.scale.set(s, s * 1.12, s);
        dummy.updateMatrix();
        leaves.setMatrixAt(i, dummy.matrix);
        leaves.setColorAt(i, new THREE.Color().setHSL(0.27 + Math.random() * 0.06, 0.5, 0.24 + Math.random() * 0.14));
      });
      trunks.castShadow = true;
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      worldGroup.add(trunks, leaves);
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
  }

  // ----- Personajes -----
  // ----- Personaje con aspecto de videojuego: avatar realista + animaciones de Mixamo -----
  let avatar = null;         // GLTF del avatar (cuerpo, cabeza, ropa separada por materiales)
  let avatarScale = 1;       // escala para que mida 1.8 m
  let avatarMinY = 0;        // altura de los pies del modelo original
  const tmpV = new THREE.Vector3();

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
  function setBone(ch, name, ang, axis = _xAxis) {
    const bn = ch.bones[name];
    if (!bn) return;
    _poseQ.setFromAxisAngle(axis, ang);
    bn.b.quaternion.copy(bn.rest).multiply(_poseQ);
  }

  // Pose del avatar: piernas al caminar, brazos al frente para sostener el arma
  // Brazos al frente: el eje Z y el signo se comprobaron viendo el personaje de frente
  const ARM_RAISE = -1.25;
  function poseAvatar(ch, e) {
    const sw = e.moving ? Math.sin(e.walk) * (e.sprinting ? 0.9 : 0.5) : 0;
    setBone(ch, 'LeftUpLeg', sw);
    setBone(ch, 'RightUpLeg', -sw);
    const aim = e.alive ? ARM_RAISE : 0;
    setBone(ch, 'LeftArm', aim, _zAxis);
    setBone(ch, 'RightArm', aim, _zAxis);
    setBone(ch, 'LeftForeArm', aim * 0.35, _zAxis);
    setBone(ch, 'RightForeArm', aim * 0.35, _zAxis);
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
    for (const n of ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']) {
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

    return {
      root, body, legs: [], arms: [], vest: { visible: false }, shirtMat: null, gunPivot, guns, ring,
      weapon: null, shotsSeen: 0, kick: 0, dead: false, deathT: 0, lean: 0,
      bones, hand: model.getObjectByName('RightHand'), animated: true,
    };
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

    // Piernas (pivote en la cadera)
    const legs = [];
    for (const sx of [-0.12, 0.12]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx, 0.86, 0);
      const leg = new THREE.Mesh(geo.leg, pantsMat);
      leg.position.y = -0.36;
      leg.castShadow = true;
      const boot = new THREE.Mesh(geo.boot, M.boots);
      boot.position.set(0, -0.7, 0.02);
      boot.castShadow = true;
      pivot.add(leg, boot);
      body.add(pivot);
      legs.push(pivot);
    }

    // Brazos (pivote en el hombro, apuntando al frente)
    const arms = [];
    for (const sx of [-0.35, 0.35]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx, 1.46, 0);
      pivot.rotation.x = -1.35;
      const arm = new THREE.Mesh(geo.arm, shirtMat);
      arm.position.y = -0.3;
      arm.castShadow = true;
      const hand = new THREE.Mesh(geo.hand, glovesMat);
      const shoulder = new THREE.Mesh(geo.shoulder, shirtMat);
      shoulder.castShadow = true;
      pivot.add(shoulder);
      hand.position.y = -0.64;
      hand.castShadow = true;
      pivot.add(arm, hand);
      body.add(pivot);
      arms.push(pivot);
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

    return {
      root, body, legs, arms, vest, shirtMat, gunPivot, guns, ring,
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    if (bloomPass) bloomPass.enabled = high;
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
      ch.root.position.set(e.x, 0, e.z);
      ch.root.rotation.y = e.yaw;
      ch.vest.visible = e.armor > 0;
      if (ch.animated) poseAvatar(ch, e);

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
        ch.legs[0].rotation.x = swing;
        ch.legs[1].rotation.x = -swing;
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
        const gp = ch.gunPivot.getWorldPosition(new THREE.Vector3());
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
        ch.gunPivot.rotation.set(0, 0, 0);
      }
      if (!ch.animated) {
        ch.arms[0].rotation.x = armRx;
        ch.arms[1].rotation.x = armRxR;
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

    if (G.player && worldGroup) {
      const p = G.player;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const vp = viewPitch(p);
      const cp = Math.cos(vp), sp = Math.sin(vp);
      const rx = -fz, rz = fx;
      const ads = p.ads && p.alive;
      const dist = cameraDistance(p, fx, fz, ads ? 2.6 : 4.4, ads ? 0.45 : 0.85);
      const side = ads ? 0.45 : 0.85;

      const desired = new THREE.Vector3(
        p.x - fx * dist + rx * side,
        2.35 + sp * 1.2 + (p.moving ? Math.sin(p.walk * 2) * 0.03 : 0),
        p.z - fz * dist + rz * side,
      );
      camPos.lerp(desired, 1 - Math.exp(-dt * 18));
      // La mira apunta a donde irán las balas
      const aim = new THREE.Vector3(fx * cp, sp, fz * cp);
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
