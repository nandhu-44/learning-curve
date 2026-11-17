import * as THREE from 'three';
import { VMAX } from '../sim/car';
import { mulberry32 } from '../sim/rng';
import { centerDist, type Track, wrapAngle } from '../sim/track';

/** Everything you see: the circuit, its scenery, the cars and the two cameras. No model or image files; it is all built here. */
const COLOR = { skyTop: 0x5fa8e6, haze: 0xdcebf3, grass: 0x8cc06a, player: 0xffc21a, rival: 0xe5384f, ghost: 0xbfe3ff, ink: 0x1d2026 };

function paintTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A strip that follows the lap between two sideways offsets (positive is left of travel) and two heights. */
function ribbon(t: Track, offA: number, offB: number, yA: number, yB: number, vScale: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= t.n; i++) {
    const k = i % t.n, nx = -t.ty[k], ny = t.tx[k], s = (i < t.n ? t.s[k] : t.length) / vScale;
    pos.push(t.x[k] + nx * offA, yA, -(t.y[k] + ny * offA), t.x[k] + nx * offB, yB, -(t.y[k] + ny * offB));
    uv.push(0, s, 1, s);
    if (i < t.n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export type CarKind = 'player' | 'rival' | 'ghost';

const partGeo = {
  chassis: new THREE.BoxGeometry(4.3, 0.5, 1.9),
  nose: new THREE.BoxGeometry(1.3, 0.28, 1.7),
  cabin: new THREE.BoxGeometry(1.9, 0.55, 1.5),
  roof: new THREE.BoxGeometry(1.5, 0.08, 1.4),
  deck: new THREE.BoxGeometry(1.0, 0.3, 1.7),
  wing: new THREE.BoxGeometry(0.5, 0.07, 2.0),
  strut: new THREE.BoxGeometry(0.08, 0.42, 0.08),
  wheel: new THREE.CylinderGeometry(0.45, 0.45, 0.38, 14).rotateX(Math.PI / 2),
};

export class CarView {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly front: THREE.Group[] = [];
  private readonly ghostMat?: THREE.MeshLambertMaterial;

  constructor(readonly kind: CarKind) {
    const ghost = kind === 'ghost';
    const paint = ghost
      ? (this.ghostMat = new THREE.MeshLambertMaterial({ color: COLOR.ghost, transparent: true, opacity: 0.42, depthWrite: false }))
      : new THREE.MeshStandardMaterial({ color: kind === 'player' ? COLOR.player : COLOR.rival, roughness: 0.42, metalness: 0.15 });
    const dark = ghost ? paint : new THREE.MeshStandardMaterial({ color: COLOR.ink, roughness: 0.6 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = !ghost;
      parent.add(m);
      return m;
    };
    add(partGeo.chassis, paint, 0, 0.6, 0);
    add(partGeo.nose, paint, 1.45, 0.93, 0).rotation.z = -0.1;
    add(partGeo.cabin, dark, -0.25, 1.1, 0);
    add(partGeo.roof, paint, -0.3, 1.41, 0);
    add(partGeo.deck, paint, -1.6, 0.95, 0);
    add(partGeo.wing, paint, -2.0, 1.52, 0);
    add(partGeo.strut, dark, -2.0, 1.3, 0.7);
    add(partGeo.strut, dark, -2.0, 1.3, -0.7);
    for (const sx of [1.4, -1.4]) for (const sz of [1.0, -1.0]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx, 0.45, sz);
      add(partGeo.wheel, dark, 0, 0, 0, pivot);
      this.group.add(pivot);
      if (sx > 0) this.front.push(pivot);
    }
    this.group.add(this.body);
  }

  /** Put the car at a sim pose. `fade` only applies to ghosts: 1 is normal, 0 is gone. */
  place(x: number, y: number, h: number, steer: number, v: number, fade = 1): void {
    this.group.position.set(x, 0, -y);
    this.group.rotation.y = h;
    this.body.rotation.x = -steer * (v / VMAX) * 0.1; // lean out of the bend
    for (const p of this.front) p.rotation.y = steer * 0.42;
    this.group.visible = fade > 0.02;
    if (this.ghostMat) this.ghostMat.opacity = 0.42 * fade;
    else this.group.scale.setScalar(Math.max(fade, 0.001));
  }
}

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1600);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
  private readonly marks: THREE.InstancedMesh;
  private readonly signCanvas = document.createElement('canvas');
  private readonly signTex: THREE.CanvasTexture;
  private camH = 0;
  private camReady = false;
  private readonly tmp = new THREE.Vector3();
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly canvas: HTMLCanvasElement, readonly track: Track) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.toneMapping = THREE.NeutralToneMapping;

    const s = this.scene, hw = track.halfWidth;
    s.background = new THREE.Color(COLOR.haze);
    s.fog = new THREE.Fog(COLOR.haze, 220, 950);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(COLOR.skyTop) }, low: { value: new THREE.Color(COLOR.haze) } },
        vertexShader: 'varying float h;void main(){h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'uniform vec3 top;uniform vec3 low;varying float h;void main(){gl_FragColor=vec4(mix(low,top,pow(clamp(h*1.6,0.,1.),.7)),1.);}',
      }),
    );
    s.add(sky, new THREE.HemisphereLight(0xe6f3ff, 0x7fa462, 1.25));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -75; sc.right = sc.top = 75; sc.near = 20; sc.far = 420;
    this.sun.shadow.bias = -0.0006;
    s.add(this.sun, this.sun.target);

    // Ground: mown stripes.
    const grass = paintTexture(128, 128, (g) => {
      g.fillStyle = '#8cc06a'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#84b963'; g.fillRect(0, 0, 64, 128);
      for (let i = 0; i < 500; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,220,.06)' : 'rgba(20,60,20,.07)'; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
    });
    grass.repeat.set(90, 90);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: grass }));
    ground.receiveShadow = true;
    s.add(ground);

    // Road: asphalt, kerbs painted on the outer half metre, edge lines, centre dashes. One texture repeat is 12 m.
    const road = paintTexture(256, 256, (g) => {
      g.fillStyle = '#3b3e45'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
      for (let b = 0; b < 4; b++) { g.fillStyle = b % 2 ? '#f3f1ea' : '#d8412f'; g.fillRect(0, b * 64, 12, 64); g.fillRect(244, b * 64, 12, 64); }
      g.fillStyle = '#f3f1ea'; g.fillRect(12, 0, 5, 256); g.fillRect(239, 0, 5, 256); g.fillRect(126, 0, 4, 84);
    });
    const roadMesh = new THREE.Mesh(ribbon(track, hw, -hw, 0.03, 0.03, 12), new THREE.MeshStandardMaterial({ map: road, roughness: 0.92, side: THREE.DoubleSide }));
    roadMesh.receiveShadow = true;
    s.add(roadMesh);

    // Walls right at the road edge, so "touching the wall" is exactly what the sim calls a crash.
    const wall = paintTexture(32, 128, (g) => {
      g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, 32, 64);
      g.fillStyle = '#c7d2dc'; g.fillRect(0, 64, 32, 64);
      g.fillStyle = '#2f6fd0'; g.fillRect(25, 0, 7, 128);
    });
    const wallMat = new THREE.MeshLambertMaterial({ map: wall, side: THREE.DoubleSide });
    for (const side of [1, -1]) {
      const w = new THREE.Mesh(ribbon(track, side * (hw + 0.2), side * (hw + 0.35), 0, 1.0, 5), wallMat);
      w.castShadow = true;
      s.add(w);
    }

    // Start line and a gantry that names the generation you are up against.
    const gate = new THREE.Group();
    gate.position.set(track.start.x, 0, -track.start.y);
    gate.rotation.y = track.start.h;
    const check = paintTexture(32, 128, (g) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0'; g.fillRect(x * 8, y * 8, 8, 8); } });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2 * hw).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: check }));
    line.position.y = 0.05;
    this.signCanvas.width = 1024; this.signCanvas.height = 96;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    const post = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 });
    const face = new THREE.MeshBasicMaterial({ map: this.signTex });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 2 * hw + 2.4), [face, face, post, post, post, post]);
    beam.position.y = 7;
    beam.castShadow = true;
    gate.add(line, beam);
    for (const z of [hw + 0.9, -hw - 0.9]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), post);
      p.position.set(0, 3.5, z);
      p.castShadow = true;
      gate.add(p);
    }
    s.add(gate);
    this.sign('GENERATION 0');

    // Pines wherever there is no road, far hills, a few clouds.
    const rnd = mulberry32(track.seed * 31 + 7), ext = -track.fx0 + 150;
    const spots: number[][] = [];
    for (let i = 0; i < 6000 && spots.length < 430; i++) {
      const x = (rnd() * 2 - 1) * ext, y = (rnd() * 2 - 1) * ext;
      if (centerDist(track, x, y) > hw + 7 && Math.hypot(x - track.start.x, y - track.start.y) > 16) spots.push([x, y, 0.7 + rnd() * 0.9, rnd()]);
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), spots.length);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.3, 6.5, 7), new THREE.MeshLambertMaterial({ flatShading: true }), spots.length);
    const tint = new THREE.Color();
    spots.forEach(([x, y, k, c], i) => {
      this.dummy.position.set(x, 1.2 * k, -y); this.dummy.scale.setScalar(k); this.dummy.rotation.set(0, c * 6, 0); this.dummy.updateMatrix();
      trunks.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.y = 5.2 * k; this.dummy.updateMatrix();
      crowns.setMatrixAt(i, this.dummy.matrix);
      crowns.setColorAt(i, tint.setHSL(0.34 + c * 0.06, 0.42, 0.27 + c * 0.1));
    });
    crowns.castShadow = true;
    s.add(trunks, crowns);
    const hills = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshLambertMaterial({ color: 0x8fa9bd, flatShading: true }), 46);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rnd(), d = 760 + rnd() * 160, hgt = 90 + rnd() * 170;
      this.dummy.position.set(Math.cos(a) * d, hgt / 2 - 4, Math.sin(a) * d); this.dummy.scale.set(120 + rnd() * 130, hgt, 120 + rnd() * 130); this.dummy.rotation.set(0, rnd() * 6, 0); this.dummy.updateMatrix();
      hills.setMatrixAt(i, this.dummy.matrix);
    }
    const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 48);
    for (let i = 0; i < 48; i++) {
      const c = i - (i % 3), a = c * 2.4, d = 180 + ((c * 97) % 620);
      this.dummy.position.set(Math.cos(a) * d + (i % 3) * 22, 190 + (c % 7) * 12 - (i % 3 === 1 ? -8 : 0), Math.sin(a) * d + (i % 3) * 6);
      this.dummy.scale.set(30 + (i % 3) * 8, 13, 22); this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix();
      clouds.setMatrixAt(i, this.dummy.matrix);
    }
    s.add(hills, clouds);

    // Where learners went off, this round.
    this.marks = new THREE.InstancedMesh(new THREE.RingGeometry(0.55, 0.9, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLOR.rival, transparent: true, opacity: 0.75 }), 96);
    this.marks.count = 0;
    s.add(this.marks);
    this.resize();
  }

  car(kind: CarKind): CarView {
    const v = new CarView(kind);
    this.scene.add(v.group);
    return v;
  }

  sign(text: string): void {
    const g = this.signCanvas.getContext('2d')!;
    g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, 1024, 96);
    g.fillStyle = '#e5384f'; g.fillRect(0, 0, 70, 96); g.fillRect(954, 0, 70, 96);
    g.fillStyle = '#16181d'; g.font = '700 62px "Chakra Petch", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 512, 52);
    this.signTex.needsUpdate = true;
  }

  mark(x: number, y: number): void {
    if (this.marks.count >= 96) return;
    this.dummy.position.set(x, 0.06, -y); this.dummy.scale.setScalar(1); this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix();
    this.marks.setMatrixAt(this.marks.count++, this.dummy.matrix);
    this.marks.instanceMatrix.needsUpdate = true;
  }

  clearMarks(): void {
    this.marks.count = 0;
  }

  /** Aim a camera at a car. 'chase' sits low behind the driver; 'heli' hangs back and above, for watching the learners. */
  follow(x: number, y: number, h: number, v: number, dt: number, mode: 'chase' | 'heli'): void {
    const heli = mode === 'heli', back = heli ? 26 : 9.5, up = heli ? 16 : 4.1;
    if (!this.camReady) this.camH = h;
    this.camH += wrapAngle(h - this.camH) * (1 - Math.exp(-dt * (heli ? 1.6 : 5)));
    this.tmp.set(x - Math.cos(this.camH) * back, up, -y + Math.sin(this.camH) * back);
    if (this.camReady) this.camera.position.lerp(this.tmp, 1 - Math.exp(-dt * (heli ? 3 : 9)));
    else this.camera.position.copy(this.tmp);
    this.camReady = true;
    const ahead = heli ? 5 : 7;
    this.camera.lookAt(x + Math.cos(h) * ahead, 1.2, -y - Math.sin(h) * ahead);
    const fov = (this.camera.aspect < 1 ? 80 : 60) + (heli ? -8 : 11 * (v / VMAX));
    if (Math.abs(fov - this.camera.fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.sun.target.position.set(x, 0, -y);
    this.sun.position.set(x + 95, 150, -y + 70);
  }

  /** Forget the camera's momentum, e.g. when the car is put back on the grid. */
  cut(): void {
    this.camReady = false;
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Trade looks for frame rate on slow devices. */
  degrade(): void {
    this.renderer.shadowMap.enabled = false;
    this.sun.castShadow = false;
    this.renderer.setPixelRatio(1);
    this.resize();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Free the GPU side of this track before another one is built on the same canvas. */
  dispose(): void {
    const shared = new Set<THREE.BufferGeometry>(Object.values(partGeo));
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!shared.has(m.geometry)) m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
  }
}
