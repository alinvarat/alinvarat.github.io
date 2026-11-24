// Small turntables for the PULSE boards: the real KiCad exports, lit like a product shot.
// Each one renders only while it is on screen, and holds still under reduced motion.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const css = getComputedStyle(document.documentElement);
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
const tok = (n) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = css.getPropertyValue(n).trim(); probe.fillRect(0, 0, 1, 1); const [r, g, b] = probe.getImageData(0, 0, 1, 1).data; return new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear(); };
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);

function fixNormals(g) {
  const n = g.attributes.normal; if (!n) { g.computeVertexNormals(); return; }
  for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = Math.hypot(x, y, z); if (!(l > 1e-6)) n.setXYZ(i, 0, 1, 0); }
  n.needsUpdate = true;
}

function mount(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, tok('--color-paper-3'), 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-4, 2, -3); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 100);
  const pivot = new THREE.Group(); scene.add(pivot);
  let size = 1, base = 0, t = 0, spin = 0.5, drag = null, visible = false, raf = 0, last = 0;

  function fit() {
    const r = canvas.getBoundingClientRect(); if (!r.width) return;
    renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    const d = size / (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.min(1, camera.aspect) * 0.78;
    camera.position.set(0, d * 0.5, d * 0.95); camera.lookAt(0, 0, 0);
    camera.near = size / 1000; camera.far = size * 20; camera.updateProjectionMatrix(); // models come in mm (KiCad m, EasyEDA 10 mil): fit the clip range to the model
  }
  const draw = () => renderer.render(scene, camera);
  function loop(now) {
    raf = 0; if (!visible) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    // sway gently around the front view instead of spinning, so a long board never turns end-on to the camera
    if (!drag) { t += dt; pivot.rotation.y = base + Math.sin(t * 0.5) * 0.5; }
    draw(); if (!reduce.matches || drag) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } };

  loader.load(canvas.dataset.model, (g) => {
    const model = g.scene;
    model.traverse((o) => { if (o.isMesh) { fixNormals(o.geometry); o.material.side = THREE.DoubleSide; } }); // EasyEDA exports some faces wound backwards
    // optional printed top (EasyEDA boards): a texture on the PCB's top face at z = 0, sized in the model's 10 mil units
    if (canvas.dataset.top) {
      const b = new THREE.Box3(); model.traverse((o) => { if (o.isMesh && o.visible) b.union(new THREE.Box3().setFromObject(o)); });
      const tx = new THREE.TextureLoader().load(canvas.dataset.top, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; draw(); });
      const top = new THREE.Mesh(new THREE.PlaneGeometry(75.6 / 0.254, 29.6 / 0.254), new THREE.MeshStandardMaterial({ map: tx, transparent: true, alphaTest: 0.5, roughness: 0.45 }));
      // the PCB body: the visible mesh with the largest footprint and little height; recolour it and put the print on its top face
      let pcb = null, best = 0; model.traverse((o) => { if (o.isMesh && o.visible) { o.geometry.computeBoundingBox(); const s2 = o.geometry.boundingBox.getSize(new THREE.Vector3()); if (s2.z < 15 && s2.x * s2.y > best) { best = s2.x * s2.y; pcb = o; } } });
      if (pcb) pcb.material = new THREE.MeshStandardMaterial({ color: 0x5b2a8f, roughness: 0.45, side: THREE.DoubleSide });
      top.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (pcb ? pcb.geometry.boundingBox.max.z : 0) + 0.2); model.add(top);
    }
    // lay the board flat (thinnest axis up), centre it
    const box = new THREE.Box3().setFromObject(model), s = box.getSize(new THREE.Vector3());
    const thin = [['x', s.x], ['y', s.y], ['z', s.z]].sort((a, b) => a[1] - b[1])[0][0];
    if (thin === 'x') model.rotation.z = Math.PI / 2; else if (thin === 'z') model.rotation.x = -Math.PI / 2;
    model.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(model), c = b2.getCenter(new THREE.Vector3());
    model.position.sub(c);
    size = b2.getSize(new THREE.Vector3()).length();
    // drop vendor models with stray vertices far off the board
    model.updateMatrixWorld(true);
    const sph = new THREE.Sphere();
    model.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingSphere(); sph.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); if (sph.radius > size) o.visible = false; } });
    pivot.add(model);
    // front view: the board's long side across the screen
    const sz2 = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    base = sz2.z > sz2.x ? Math.PI / 2 : 0; pivot.rotation.y = base;
    fit(); draw(); kick();
  });

  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, r: pivot.rotation.y }; canvas.setPointerCapture(e.pointerId); kick(); });
  canvas.addEventListener('pointermove', (e) => { if (drag) { pivot.rotation.y = drag.r + (e.clientX - drag.x) * 0.01; } });
  const end = () => { if (drag) base = pivot.rotation.y - Math.sin(t * 0.5) * 0.5; drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }, { rootMargin: '100px' }).observe(canvas);
  new ResizeObserver(() => { fit(); draw(); }).observe(canvas);
}

document.querySelectorAll('canvas.board3d[data-model]').forEach(mount);
