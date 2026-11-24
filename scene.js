import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const L = window.LineSim;
const canvas = document.getElementById('stage');
if (!L || !canvas) throw new Error('scene: missing sim or canvas');

// Read colours from the CSS tokens so the scene and the page stay one palette.
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function token(name) {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear();
}
const C = {
  paper: token('--color-paper'), paper2: token('--color-paper-2'), paper3: token('--color-paper-3'),
  ink: token('--color-ink'), ink2: token('--color-ink-2'), rule: token('--color-rule-2'),
  brass: token('--color-accent'), muted: token('--color-muted'),
  mat: token('--color-mat'), line: token('--color-line'), carbon: token('--color-carbon'), pcb: token('--color-pcb'), pcb2: token('--color-pcb-2'),
  led: token('--color-led'), ledViolet: token('--color-led-violet'), wire: token('--color-wire'), battery: token('--color-battery'), rubber: token('--color-rubber'), xt60: token('--color-xt60'), rose: token('--color-accent-2'), live: token('--color-live'),
};

const small = window.matchMedia('(max-width: 60rem)').matches;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = !small;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = C.paper.clone();
scene.fog = new THREE.FogExp2(C.paper.clone(), 0.022);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

// light
scene.add(new THREE.HemisphereLight(C.ink2, C.paper3, 0.45));
const rim = new THREE.DirectionalLight(C.rose, 1.6); rim.position.set(14, 6, -18); scene.add(rim);
const key = new THREE.DirectionalLight(C.ink, 0.75);
key.position.set(-10, 18, 8);
scene.add(key);

// floor: the dark room, a blueprint grid, and the white competition mat the robot runs on
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: C.paper2, roughness: 0.92, metalness: 0.05 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(160, 80, C.rule, C.rule);
grid.material.transparent = true; grid.material.opacity = 0.5; grid.position.y = 0.005; scene.add(grid);

const SCALE = 22;
const sim = L.create();
const MAT_W = 24, MAT_D = 20;

// the mat's print: a faint corrugation and the owner's name, like the real one
function matTexture() {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = Math.round(2048 * MAT_D / MAT_W);
  const g = cv.getContext('2d');
  g.fillStyle = `#${C.mat.clone().convertLinearToSRGB().getHexString()}`; g.fillRect(0, 0, cv.width, cv.height);
  g.globalAlpha = 0.05; g.fillStyle = `#${C.line.clone().convertLinearToSRGB().getHexString()}`;
  for (let y = 0; y < cv.height; y += 10) g.fillRect(0, y, cv.width, 2);
  g.globalAlpha = 0.85;
  g.font = `400 ${Math.round(cv.height * 0.045)}px "Instrument Serif", serif`;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('linwrath_pulse', cv.width * 0.035, cv.height * 0.09);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const matMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
const mat = new THREE.Mesh(new THREE.PlaneGeometry(MAT_W, MAT_D), matMaterial);
mat.rotation.x = -Math.PI / 2; mat.position.y = 0.01; mat.receiveShadow = true; scene.add(mat);
const paintMat = () => { matMaterial.map = matTexture(); matMaterial.needsUpdate = true; };
paintMat(); document.fonts?.ready.then(paintMat);

// the black line, from the sim's own track
const pts = sim.track.filter((_, i) => i % 6 === 0).map(([x, y]) => new THREE.Vector3(x * SCALE, 0.02, y * SCALE));
const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
const lineW = L.LINE_HALF * 2 * SCALE;
const strip = new THREE.Mesh(new THREE.TubeGeometry(curve, 700, lineW / 2, 6, true), new THREE.MeshStandardMaterial({ color: C.line, roughness: 0.75 }));
strip.scale.y = 0.06; strip.receiveShadow = true; scene.add(strip);

// robot, assembled from the real CAD: the FreeCAD chassis plate, wheel locks, N60 motors
// and tyres, the 16MuxV3 sensor bar and the PulseMini board exported from KiCad.
// Only the side rails, standoffs and wire loom are drawn here, from photos and the plate drawing.
const robot = new THREE.Group();
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...o });
const hex = (c) => `#${c.clone().convertLinearToSRGB().getHexString()}`;
const carbonTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = hex(C.carbon); g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 4 < 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.25)'; g.fillRect(x * 8, y * 8, 8, 8); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
})();
const MAT = {
  carbon: new THREE.MeshStandardMaterial({ color: 0xffffff, map: carbonTex, roughness: 0.3, metalness: 0.35 }),
  rubber: M(C.rubber, { roughness: 0.9 }),
  brass: M(C.xt60, { roughness: 0.3, metalness: 0.9 }),
  printed: M(C.pcb2, { roughness: 0.75 }),
  steel: M(C.muted, { roughness: 0.25, metalness: 0.9 }),
  motor: M(C.ink2, { roughness: 0.3, metalness: 0.85 }),
};
const look = L.LOOK * SCALE, half = L.BAR_HALF * SCALE;
const railZ = half * 0.62;

const sensors = []; // the real 16MuxV3 model carries the sensors; the line state shows as the green glow under it

const green = new THREE.PointLight(C.live, 0, 1.6, 1.8); green.position.set(look, 0.05, 0); robot.add(green);
scene.add(robot);

// load the CAD parts
const gltf = new GLTFLoader(); gltf.setMeshoptDecoder(MeshoptDecoder);
const load = (url) => new Promise((ok, no) => gltf.load(url, (g) => ok(g.scene), undefined, no));
// degenerate triangles give zero normals, which shade to NaN and the bloom pass smears that into black blocks
function fixNormals(g) {
  const n = g.attributes.normal; if (!n) return;
  for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i), z = n.getZ(i); const l = Math.hypot(x, y, z); if (!(l > 1e-6)) n.setXYZ(i, 0, 1, 0); else n.setXYZ(i, x / l, y / l, z / l); }
  n.needsUpdate = true;
}
function flatNormals(root) { root.traverse((o) => { if (o.isMesh) { o.geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; o.geometry.computeVertexNormals(); fixNormals(o.geometry); o.castShadow = true; o.receiveShadow = true; } }); }
function keepNormals(root) { root.traverse((o) => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); if (o.geometry.attributes.normal.normalized || !(o.geometry.attributes.normal.array instanceof Float32Array)) { o.geometry.computeVertexNormals(); } fixNormals(o.geometry); o.castShadow = true; } }); }
// lay a board flat: its thinnest axis up, its longest axis across the robot
function layFlat(root) {
  const sz = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const thin = [['x', sz.x], ['y', sz.y], ['z', sz.z]].sort((p, q) => p[1] - q[1])[0][0];
  const inner = new THREE.Group(); inner.add(root);
  if (thin === 'x') inner.rotation.z = Math.PI / 2; else if (thin === 'z') inner.rotation.x = -Math.PI / 2;
  const mid = new THREE.Group(); mid.add(inner); mid.updateMatrixWorld(true);
  const s2 = new THREE.Box3().setFromObject(mid).getSize(new THREE.Vector3());
  if (s2.x > s2.z) mid.rotation.y = Math.PI / 2;
  const wrap = new THREE.Group(); wrap.add(mid); wrap.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(mid);
  mid.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  wrap.updateMatrixWorld(true);
  return { node: wrap, size: new THREE.Box3().setFromObject(wrap).getSize(new THREE.Vector3()) };
}

// Every position below is in the plate drawing's frame (mm): origin at the Ø25 centre hole,
// x across (right +), y toward the front (the two 70 mm tabs), z up from the plate's underside.
const PX = 10.41, ox0 = 1098, oy0 = 515; // the drawing's pixel scale and centre hole
const P = (px, py) => [(px - ox0) / PX, (oy0 - py) / PX];
function plateShape() {
  const pts = [[703,203],[714,192],[755,192],[766,203],[766,276],[797,307],[838,307],[890,255],[1307,255],[1359,307],[1400,307],[1432,276],[1432,203],[1443,192],[1484,192],[1495,203],[1495,276],[1526,307],[1865,307],[1880,322],[1880,500],[1865,515],[1630,515],[1598,546],[1598,901],[1567,932],[1463,932],[1411,984],[786,984],[734,932],[630,932],[598,901],[598,546],[567,515],[333,515],[318,500],[318,322],[333,307],[672,307],[703,276]];
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(...P(x, y))));
  const circle = (px, py, d) => { const [x, y] = P(px, py); const h = new THREE.Path(); h.absarc(x, y, d / 2, 0, Math.PI * 2, true); sh.holes.push(h); };
  const poly = (list) => { const h = new THREE.Path(list.slice().reverse().map(([x, y]) => new THREE.Vector2(...P(x, y)))); sh.holes.push(h); };
  circle(1098, 515, 25);
  for (const [x, y] of [[734,224],[1463,224],[1098,307],[349,359],[411,359],[349,463],[411,463],[1786,359],[1849,359],[1786,463],[1849,463],[890,515],[1307,515],[734,651],[1463,651],[942,723],[1098,723],[1255,723],[734,901],[1463,901],[1098,921],[942,932],[1255,932]]) circle(x, y, 3.2);
  for (const [x, y] of [[890,411],[1307,411],[890,619],[1307,619],[1554,578],[643,703],[1554,703],[643,890],[1554,890],[643,578]]) circle(x, y, 2.2);
  poly([[557,359],[703,359],[734,390],[734,432],[703,463],[557,463],[526,432],[526,390]]); // S4
  poly([[1547,359],[1693,359],[1724,390],[1724,432],[1693,463],[1547,463],[1516,432],[1516,390]]); // S3
  poly([[787,776],[838,776],[890,828],[1307,828],[1359,776],[1411,776],[1432,797],[1432,859],[1411,880],[787,880],[766,859],[766,797]]); // S5
  for (const [cx, cy] of [[942,323],[1255,315],[838,932],[1359,932]]) { const r = 21, c = r * 0.41; poly([[cx-c,cy-r],[cx+c,cy-r],[cx+r,cy-c],[cx+r,cy+c],[cx+c,cy+r],[cx-c,cy+r],[cx-r,cy+c],[cx-r,cy-c]]); }
  return sh;
}

Promise.all([load('models/drive.glb?v=8'), load('models/16mux.glb?v=10'), load('models/mini22.glb?v=2')]).then(([drive, mux, mini]) => {
  const bar = layFlat(mux);
  const kiMM = bar.size.z < 5 ? 1000 : 1; // KiCad's GLB is in metres
  const k = (half * 2) / (bar.size.z * kiMM); // world units per mm: the real 150 mm bar spans the sim's sensor bar
  // robot frame: x forward from the wheel axle (y = -29.1 mm), y up from the ground (wheel bottom, z = -1.9 mm), z across
  const AXLE_Y = -29.1, GROUND_Z = -3.9; // tyre bottom: Tire_N60110_Short7 is Ø25 on the axle at z = 8.6
  const cad = new THREE.Group(); cad.matrixAutoUpdate = false;
  cad.matrix.set(0, 1, 0, -AXLE_Y * k, 0, 0, 1, -GROUND_Z * k, 1, 0, 0, 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeScale(k, k, k));
  robot.add(cad);

  // drive train from LineFollower2.3.FCStd, already moved onto this plate's motor holes
  flatNormals(drive);
  drive.traverse((o) => { if (o.isMesh) o.material = MAT[o.material.name] || MAT.motor; });
  cad.add(drive);

  // the carbon plate, 3 mm, from the drawing
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(plateShape(), { depth: 3, bevelEnabled: false, curveSegments: 24 }), MAT.carbon);
  plate.position.z = -0.5; plate.castShadow = plate.receiveShadow = true; cad.add(plate);

  // M3 x 15 nylon standoffs on B14, B15, B19, B20 (70 x 24), then the board on top
  const nylon = M(C.ink2, { roughness: 0.55, metalness: 0 }); // white nylon, as in the photo of the frame
  const standoffH = 15;
  for (const [px, py] of [[734,651],[1463,651],[734,901],[1463,901]]) {
    const [x, y] = P(px, py);
    const so = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.75, standoffH, 6), nylon); so.rotation.x = Math.PI / 2; so.position.set(x, y, 2.5 + standoffH / 2); so.castShadow = true; cad.add(so);
  }
  // main board: Pulse_MiniV21 from Pulse.FCStd (EasyEDA export, 76 x 30 mm, holes on the plate's 70 x 24 standoffs),
  // already in board mm with x across, y forward, z up from the PCB underside; the H1 15-pin header edge faces the bar
  const boardZ = 2.5 + standoffH, boardY = P(0, 776)[1];
  // PulseMini V2.2 (EasyEDA project "PulseMiniV2.3"), OBJ export from EasyEDA: 10 mil units (0.254 mm), z up.
  // The export also carries parts parked off the board, so the board is found from the densest 98 % of vertices.
  keepNormals(mini);
  const boardWrap = new THREE.Group(); boardWrap.add(mini); boardWrap.scale.setScalar(0.254); cad.add(boardWrap);
  {
    boardWrap.updateMatrixWorld(true);
    const inv2 = new THREE.Matrix4().copy(boardWrap.matrixWorld).invert(), m = new THREE.Matrix4(), q = new THREE.Vector3();
    const xs = [], ys = [], zs = [];
    mini.traverse((o) => { if (!o.isMesh) return; m.multiplyMatrices(inv2, o.matrixWorld); const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3) { q.fromBufferAttribute(p, i).applyMatrix4(m); xs.push(q.x); ys.push(q.y); zs.push(q.z); } });
    const pct = (arr, t) => { arr.sort((u, w) => u - w); return arr[Math.floor((arr.length - 1) * t)]; };
    const keep = new THREE.Box3(new THREE.Vector3(pct(xs, 0.01), pct(ys, 0.01), pct(zs, 0.01)), new THREE.Vector3(pct(xs, 0.99), pct(ys, 0.99), pct(zs, 0.99))).expandByScalar(40), tb = new THREE.Box3();
    mini.traverse((o) => { if (o.isMesh) { tb.setFromObject(o).applyMatrix4(inv2); if (!keep.containsBox(tb)) o.visible = false; } });
    const vis = new THREE.Box3(); mini.traverse((o) => { if (o.isMesh && o.visible) vis.union(tb.setFromObject(o).applyMatrix4(inv2)); });
    // the PCB itself: the widest thin mesh; give it the board's real colour (blue solder mask, as in the EasyEDA 3D view)
    let pcbMesh = null, best = 0;
    mini.traverse((o) => { if (o.isMesh && o.visible) { tb.setFromObject(o).applyMatrix4(inv2); const s3 = tb.getSize(new THREE.Vector3()); if (s3.z < 12 && s3.x * s3.y > best) { best = s3.x * s3.y; pcbMesh = o; } } });
    if (pcbMesh) pcbMesh.material = new THREE.MeshStandardMaterial({ color: 0x0b2a8c, roughness: 0.35, metalness: 0.1 });
    const zb = -6.3; // EasyEDA puts the board's top copper at z = 0 and its underside 1.6 mm (6.3 units) below
    mini.position.set(-(vis.min.x + vis.max.x) / 2, -(vis.min.y + vis.max.y) / 2, -zb);
    boardWrap.position.set(0, boardY, boardZ);
    boardWrap.rotation.z = Math.PI; // sockets face the sensor bar, as on the real robot
  }
  // the sensor loom ends in PH2.0 3-pin plugs pushed into the board's row of eight vertical PH2.0-3P sockets
  // (board turned 180° so this edge faces the bar: housings 50.1 mm wide centred at x = +3.7 mm, y = -3.7 mm in the EasyEDA board frame, 8.8 mm tall)
  const sockPitch = -50.1 / 8, sockX0 = -(3.7 - 50.1 / 2) + sockPitch / 2, sockY = boardY + 9, sockTop = boardZ + 1.6 + 8.8;
  const plugMat = M(C.ink2, { roughness: 0.55 });
  const plugs = [2, 3, 4]; // 8 wires as three 3-pin plugs (3 + 3 + 2)
  for (const j of plugs) { const pl = new THREE.Mesh(new THREE.BoxGeometry(5.6, 4.2, 3.5), plugMat); pl.position.set(sockX0 + j * sockPitch, sockY, sockTop + 1.75); pl.castShadow = true; cad.add(pl); }
  const wireEnd = (i) => { const j = plugs[Math.floor(i / 3)], pin = i % 3; return [sockX0 + j * sockPitch + (pin - 1) * 2, sockY]; };


  // ---- 16MuxV3 bar: placed first, because the rails are sized to its mounting holes ----
  bar.node.scale.setScalar(k * kiMM);
  bar.node.rotation.set(0, 0, Math.PI); // the export comes in upside down and back to front; a half turn about its long axis fixes both
  robot.add(bar.node); keepNormals(mux);
  // place the bar from its overall bounds (150 mm wide, as in KiCad); its sensors hang ~1 mm under the PCB
  const inv = new THREE.Matrix4();
  const barBounds = () => { // robust bounds: every vertex in robot space, trimmed 0.5 % each side so stray vertices don't count
    robot.updateMatrixWorld(true); inv.copy(robot.matrixWorld).invert();
    const xs = [], ys = [], zs = [], v = new THREE.Vector3(), m = new THREE.Matrix4();
    mux.traverse((o) => { if (!o.isMesh) return; m.multiplyMatrices(inv, o.matrixWorld); const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 2) { v.fromBufferAttribute(p, i).applyMatrix4(m); xs.push(v.x); ys.push(v.y); zs.push(v.z); } });
    const q = (a, t) => { a.sort((p, r) => p - r); return a[Math.floor((a.length - 1) * t)]; };
    return new THREE.Box3(new THREE.Vector3(q(xs, 0.005), q(ys, 0.005), q(zs, 0.005)), new THREE.Vector3(q(xs, 0.995), q(ys, 0.995), q(zs, 0.995)));
  };
  let pcb = barBounds();
  bar.node.position.x += look - (pcb.min.x + pcb.max.x) / 2;
  bar.node.position.y += (-0.5 - 1 - GROUND_Z) * k - pcb.min.y; // PCB underside on the rails' top face (z = -0.5)
  pcb = barBounds();
  // the LED strip under the bar: a continuous row along the arc, lit like the real one, not two spot lights
  {
    const ledY = (-0.5 - 1.3 - GROUND_Z) * k, front = pcb.max.x - 4 * k, back = L.ARC * SCALE;
    const arcX = (z) => front - back * (z / half) ** 2;
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2 * k, 0.6 * k, 3 * k), M(C.led, { emissive: C.led, emissiveIntensity: 2.4 }), 40);
    for (let i = 0; i < 40; i++) { const z = -half * 0.95 + (1.9 * half * i) / 39; const o = new THREE.Object3D(); o.position.set(arcX(z), ledY, z); o.rotation.y = Math.atan2(2 * back * z / (half * half), 1); o.updateMatrix(); strip.setMatrixAt(i, o.matrix); }
    robot.add(strip);
    for (let i = 0; i < 7; i++) { const z = -half * 0.9 + (1.8 * half * i) / 6; const l = new THREE.PointLight(C.led, 0.9, 1.4, 1.8); l.position.set(arcX(z) + 0.02, ledY - 0.01, z); robot.add(l); }
    green.position.set(arcX(0), ledY - 0.01, 0);
  }
  const toPlateY = (x) => AXLE_Y + x / k;
  const barFront = toPlateY(pcb.max.x), barRear = toPlateY(pcb.min.x);
  // KiCad: outline y -4..23, end pads H1..H8 at y 14 and 20 -> 18 and 24 mm behind the front edge, x = +-66 / +-72
  const padRows = [barFront - 18, barFront - 24];

  // ---- rails: from the photo of the real frame ----
  // narrow carbon strips with one row of holes, slid UNDER the plate and held by two black socket screws each
  // in the outer holes B4/B8 and B7/B11 (x = +-72, y = 5 and 15); at the front the bar sits on top of them,
  // bolted through its outer pads H1/H2 and H5/H6 (x = +-72).
  const railT = 2, railTopZ = -0.5;
  const screwMat = M(C.rubber, { roughness: 0.35, metalness: 0.6 });
  const screwGeo = new THREE.CylinderGeometry(2.75, 2.75, 3, 20);
  const padZ = railTopZ + 1.6; // bar top
  // rail: 100 mm long, 6 mm wide (PulseLinefollower.FCStd Body001/Body002); holes per the current frame:
  // y = 5 and 15 bolt to the plate (B4/B8, B7/B11), then a 6 mm pitch row from 21 to 93; 87 and 93 take the bar's outer pads
  const railHoles = [5, 15]; for (let y = 21; y <= 93; y += 6) railHoles.push(y);
  const barRows = [87, 93];
  if (Math.abs(padRows[0] - 93) > 2 || Math.abs(padRows[1] - 87) > 2) console.warn('bar pads off the rail holes', padRows);
  for (const xc of [-72, 72]) {
    const y0 = 0, y1 = 100, w = 3;
    const sh = new THREE.Shape();
    sh.moveTo(xc - w, y0 + w); sh.absarc(xc, y0 + w, w, Math.PI, 0, false); sh.lineTo(xc + w, y1 - w); sh.absarc(xc, y1 - w, w, 0, Math.PI, false); sh.lineTo(xc - w, y0 + w);
    for (const y of railHoles) { const h = new THREE.Path(); h.absarc(xc, y, 1.6, 0, Math.PI * 2, true); sh.holes.push(h); }
    const rail = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: railT, bevelEnabled: false, curveSegments: 16 }), MAT.carbon);
    rail.position.z = railTopZ - railT; rail.castShadow = rail.receiveShadow = true; cad.add(rail);
    for (const [y, z] of [[5, 2.5], [15, 2.5], [barRows[0], padZ], [barRows[1], padZ]]) {
      const sc = new THREE.Mesh(screwGeo, screwMat); sc.rotation.x = Math.PI / 2; sc.position.set(xc, y, z + 1.5); sc.castShadow = true; cad.add(sc);
    }
  }

  // ---- wire loom: 8 wires, J1 on the bar (PH2.0 x8, opening to the rear) to three PH2.0-3P plugs on the board ----
  const wireMat = M(C.wire, { roughness: 0.4 });
  const j1Y = barFront - 13.5 - 4, j1Z = -0.5 + 1.6 + 2; // J1 sits mid-bar on its top face, plug pointing back
  const plugBar = new THREE.Mesh(new THREE.BoxGeometry(19.9, 6, 4.5), M(C.ink2, { roughness: 0.6 })); plugBar.position.set(0, j1Y - 3, j1Z); cad.add(plugBar);
  for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * 2;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, j1Y - 6, j1Z), new THREE.Vector3(x, j1Y - 16, j1Z + 4),
      new THREE.Vector3(x * 1.15, (j1Y + sockY) / 2, sockTop + 14), new THREE.Vector3(wireEnd(i)[0], sockY + 6, sockTop + 9),
      new THREE.Vector3(wireEnd(i)[0], wireEnd(i)[1], sockTop + 3.5),
    ], false, 'centripetal');
    const t = new THREE.Mesh(new THREE.TubeGeometry(c, 60, 0.55, 6, false), wireMat); t.castShadow = true; cad.add(t);
  }

  // drop any other mesh with stray vertices far off the robot
  robot.updateMatrixWorld(true);
  const sph = new THREE.Sphere();
  robot.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingSphere(); sph.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); if (sph.radius > 2.5) o.visible = false; } });
}).catch((e) => console.warn('cad models failed', e));

// dust: a few hundred motes drifting over the floor, caught by the bloom
const DUST = small ? 220 : 480;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 50; dustPos[i * 3 + 1] = Math.random() * 7; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 40; }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: C.ink2, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false }));
scene.add(dust);

// trail
const TRAIL = 160;
const trailPos = new Float32Array(TRAIL * 3);
const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: C.brass, transparent: true, opacity: 0.9 }));
trail.visible = false; scene.add(trail);
let trailN = 0;

// post: bloom on the bright bits only
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bokeh = (small || location.search.includes("nobokeh")) ? null : new BokehPass(scene, camera, { focus: 6, aperture: 0, maxblur: 0.008 });
if (bokeh) composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), small ? 0.5 : 0.7, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// readouts
const speedInput = document.getElementById('speed');
const speedOut = document.getElementById('speed-out');
const lapOut = document.getElementById('lap-out');
const bar = document.querySelectorAll('.sensorbar i');
const toggle = document.getElementById('run');
const speed = () => Number(speedInput.value) / 100;
speedInput.addEventListener('input', () => { speedOut.textContent = speed().toFixed(2); sim.lap = null; sim.laps = 0; });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
  camera.aspect = w / h; camera.fov = w / h < 0.8 ? 64 : 38; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

const focusPt = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);
const debugView = new URLSearchParams(location.search).get('view');
const forceP = Number(new URLSearchParams(location.search).get('p'));
const wide = new THREE.Vector3(), chase = new THREE.Vector3(), camPos = new THREE.Vector3(), lookAt = new THREE.Vector3(), tmp = new THREE.Vector3();
let smTh = 0, camEase = 1, orbit = 0.6, running = !reduce.matches, last = 0, visible = true;

function place() {
  const x = sim.x * SCALE, z = sim.y * SCALE;
  robot.position.set(x, 0, z); robot.rotation.y = -sim.th;
  let seen = 0;
  for (const v of sim.sensors) seen += v > 0.35;
  green.intensity = seen * 0.25;
  bar.forEach((el, k) => el.classList.toggle('on', sim.sensors[k] > 0.35));
  lapOut.textContent = sim.lap ? sim.lap.toFixed(2) + ' s' : 'first lap';
}

function shoot() {
  // scroll 0 = the wide orbit over the whole track; one screen down = chase cam behind the robot
  const p = forceP || smooth(Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9))));
  const r = small ? 27 : 21;
  wide.set(Math.cos(orbit) * r, small ? 19 : 12, Math.sin(orbit) * r);
  const dx = Math.cos(sim.th), dz = Math.sin(sim.th);
  // the product shot: low, in front, backing away as the robot drives at the lens
  // a steady front-quarter view: the heading is smoothed so the robot's small steering corrections never shake the lens
  const fx = Math.cos(smTh), fz = Math.sin(smTh), side = small ? 0.6 : 1.8;
  chase.set(robot.position.x + fx * 6.2 - fz * side * 1.6, 2.7, robot.position.z + fz * 6.2 + fx * side * 1.6);
  camPos.lerpVectors(wide, chase, p);
  camera.position.lerp(camPos, camEase);
  tmp.set(robot.position.x + fx * 0.8 * p, 0.25 * p, robot.position.z + fz * 0.8 * p);
  lookAt.lerpVectors(new THREE.Vector3(0, -4.5, 0), tmp, p);
  camera.lookAt(lookAt);
  if (debugView === 'board') { const c = robot.localToWorld(new THREE.Vector3(0.05, 0.3, 0)); camera.position.set(c.x - Math.cos(sim.th) * 1.6, 1.9, c.z - Math.sin(sim.th) * 1.6); camera.up.set(0, 1, 0); camera.lookAt(c); } else if (debugView) { const o = debugView === 'under' ? -1 : 1; mat.visible = floor.visible = grid.visible = strip.visible = o > 0; const c = robot.localToWorld(new THREE.Vector3(look * 0.45, 0, 0)); camera.position.set(c.x, o * 5.2, c.z); camera.up.set(Math.cos(sim.th), 0, Math.sin(sim.th)); camera.lookAt(c); }
  if (bokeh) { robot.localToWorld(focusPt.set(look * 0.75, 0.2, 0)); bokeh.uniforms.focus.value = camera.position.distanceTo(focusPt); bokeh.uniforms.aperture.value = 0.0022 * p; }
}

// part labels pinned to the robot in the chase view
// anchors in robot space, from the CAD placement (KMM world units per mm): bar front corner, top of the main board, top of the right tyre
const KMM = (half * 2) / 150;
const anchors = {
  bar: new THREE.Vector3(look, 6 * KMM, half * 0.55),
  board: new THREE.Vector3((-25.1 + 29.1) * KMM, (3.9 + 2.5 + 15 + 1.6 + 8) * KMM, 22 * KMM),
  wheel: new THREE.Vector3(0, (3.9 + 8.6 + 12.5) * KMM, -70 * KMM),
};
const tags = [...document.querySelectorAll('.tags li')].map((el) => ({ el, x: null, y: null, w: 0 }));
const v = new THREE.Vector3();
function label() {
  const p = forceP || Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9)));
  const show = p > 0.75;
  const w = window.innerWidth, h = window.innerHeight;
  for (const t of tags) {
    robot.localToWorld(v.copy(anchors[t.el.dataset.part])).project(camera);
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    // ease toward the target so the robot's steering wiggle doesn't shake the text
    if (t.x === null) { t.x = x; t.y = y; } else { t.x += (x - t.x) * 0.08; t.y += (y - t.y) * 0.08; }
    const inView = v.z < 1 && t.x > 0 && t.x < w && t.y > 60 && t.y < h;
    t.el.classList.toggle('is-on', show && inView);
    if (!t.w) t.w = t.el.offsetWidth || 160;
    const hw = t.w / 2 + 8, cx = Math.min(w - hw, Math.max(hw, t.x));
    t.el.style.transform = `translate3d(${cx.toFixed(1)}px, ${t.y.toFixed(1)}px, 0) translate(-50%, -140%)`;
  }
}

const intro = document.querySelector('.hero__intro');
function fadeIntro() { // the hero words leave as the camera dives, instead of sliding under the nav
  if (!intro || forceP) return;
  const t = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.55)));
  intro.style.opacity = String(1 - t); intro.style.visibility = t >= 1 ? 'hidden' : 'visible';
}
window.addEventListener('scroll', fadeIntro, { passive: true });
function render() { label(); composer.render(); }

function frame(now) {
  if (!running) return;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; last = now;
  if (visible) {
    for (let i = 0; i < 4; i++) L.step(sim, dt / 4, speed());
    trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
    trailPos[0] = sim.x * SCALE; trailPos[1] = 0.06; trailPos[2] = sim.y * SCALE;
    trailN = Math.min(TRAIL, trailN + 1); trailGeo.setDrawRange(0, trailN); trailGeo.attributes.position.needsUpdate = true;
    orbit += dt * 0.06;
    let d = sim.th - smTh; d = Math.atan2(Math.sin(d), Math.cos(d)); smTh += d * (1 - Math.exp(-dt * 1.6));
    camEase = 1 - Math.exp(-dt * 3.5); dust.rotation.y += dt * 0.01;
    place(); shoot(); render();
  }
  requestAnimationFrame(frame);
}

function setRunning(on) {
  running = on; toggle.textContent = on ? 'pause' : 'run'; toggle.setAttribute('aria-pressed', String(on));
  if (on) { last = 0; requestAnimationFrame(frame); }
}
toggle.addEventListener('click', () => setRunning(!running));
reduce.addEventListener?.('change', (e) => { if (e.matches) setRunning(false); });

// stop drawing once the hero has scrolled away
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }).observe(document.querySelector('.hero'));
window.addEventListener('scroll', () => { if (!running) { shoot(); camera.position.copy(camPos); render(); } }, { passive: true });

// first frame: settle a little way into the lap
for (let i = 0; i < 120; i++) L.step(sim, 1 / 60, speed());
smTh = sim.th;
place(); shoot(); camera.position.copy(camPos); shoot(); render();
toggle.hidden = false;
document.documentElement.classList.add('gl-ready');
setRunning(running);
