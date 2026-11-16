import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  readonly controls: OrbitControls;
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.6);
  private content = new THREE.Group();
  private needsRender = true;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.499;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.scene.add(this.sun, this.sun.target, this.hemi, this.content);
    this.resetCamera('oblique');
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.controls.update() || this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
    };
    loop();
  }

  resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateLineResolution(w, h);
    this.needsRender = true;
  }

  private updateLineResolution(w: number, h: number) {
    // CSS-pixel resolution keeps line widths independent of the pixel ratio (and of PNG scale).
    this.content.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof LineMaterial) m.resolution.set(w, h);
    });
  }

  setContent(obj: THREE.Object3D) {
    this.scene.remove(this.content);
    this.content.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.content = new THREE.Group();
    this.content.add(obj);
    this.scene.add(this.content);
    this.updateLineResolution(this.host.clientWidth, this.host.clientHeight);
    this.needsRender = true;
  }

  setBackground(color: string, fog: number) {
    const c = new THREE.Color(color);
    this.scene.background = c;
    this.renderer.setClearColor(c, 1);
    // fog: 0 = off, 1 = strong. Distances relative to the ~100-unit model.
    this.scene.fog = fog > 0 ? new THREE.Fog(c, 60 + (1 - fog) * 200, 220 + (1 - fog) * 400) : null;
    this.needsRender = true;
  }

  setSun(azimuthDeg: number, elevationDeg: number, intensity = 2.2) {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    // azimuth: 0 = north (−z), clockwise; 315 = NW, the cartographic default
    this.sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(200);
    this.sun.intensity = intensity;
    this.needsRender = true;
  }

  resetCamera(view: 'oblique' | 'top' | 'front' | 'low') {
    const t = this.controls.target.set(0, 0, 0);
    const p = this.camera.position;
    if (view === 'top') p.set(0, 190, 0.01);
    else if (view === 'front') p.set(0, 60, 150);
    else if (view === 'low') p.set(0, 18, 150);
    else p.set(90, 100, 120);
    this.camera.lookAt(t);
    this.controls.update();
    this.needsRender = true;
  }

  requestRender() {
    this.needsRender = true;
  }

  /** Render at `scale`× the current viewport size and return a PNG blob. */
  async snapshot(scale: number, transparent: boolean): Promise<Blob> {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const prevRatio = this.renderer.getPixelRatio();
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
    this.updateLineResolution(w, h);
    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise<Blob>((res, rej) =>
      this.renderer.domElement.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'),
    );
    this.scene.background = bg;
    this.scene.fog = fog;
    if (bg instanceof THREE.Color) this.renderer.setClearColor(bg, 1);
    this.renderer.setPixelRatio(prevRatio);
    this.resize();
    return blob;
  }
}
