// 가상 악기: 실물 악기 위에 겹쳐 보이는 기타/베이스와 연주 소리.
// 보고서 2-5: 악기 헤드에 컨트롤러를 달고(마운트), 가상 악기를 실물 위치에 1:1로 맞춘다.
import * as THREE from 'three';
import { merge } from './figures.js?v=202611202306';

const TYPES = {
  guitar: { name: '일렉 기타', strings: 6, scale: 0.65, body: 0xb3261e, neck: 0x6b4423, open: [40, 45, 50, 55, 59, 64] },
  bass: { name: '베이스', strings: 4, scale: 0.86, body: 0x1f3f8f, neck: 0x5a3a20, open: [28, 33, 38, 43] },
};
export const INSTRUMENTS = Object.entries(TYPES).map(([id, t]) => ({ id, name: t.name }));

export class Instrument {
  constructor(type = 'guitar') {
    this.type = type;
    this.cfg = TYPES[type];
    this.root = new THREE.Group();      // 원점 = 헤드 끝(컨트롤러 마운트 위치), 넥은 +x 방향으로 몸통까지
    this.model = this._build();
    this.root.add(this.model);
    this.glow = 0;
    this.ghost = null;
  }

  _build() {
    const c = this.cfg;
    const g = new THREE.Group();
    const L = c.scale;                     // 너트~브리지 길이(m)
    const headLen = 0.19, bodyLen = 0.45, bodyW = this.type === 'bass' ? 0.34 : 0.33;
    const neckW = this.type === 'bass' ? 0.05 : 0.045;
    const M = (x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    // 헤드 → 넥 → 몸통이 +x 방향으로 이어진다. 앞면은 +z.
    const nutX = headLen;
    const bodyStart = nutX + L * 0.62;
    const parts = [
      { geo: new THREE.BoxGeometry(headLen, 0.085, 0.018), color: 0x222222, matrix: M(headLen / 2, 0, 0) },
      { geo: new THREE.BoxGeometry(L * 0.66, neckW, 0.022), color: c.neck, matrix: M(nutX + L * 0.33, 0, 0) },
      { geo: new THREE.BoxGeometry(0.006, neckW + 0.002, 0.026), color: 0xeeeeee, matrix: M(nutX, 0, 0.002) },
      // 몸통: 두 개의 둥근 판(위·아래 볼록)과 허리
      { geo: new THREE.CylinderGeometry(bodyW * 0.5, bodyW * 0.5, 0.045, 28), color: c.body, matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(M(bodyStart + bodyLen * 0.68, 0, -0.012, 1.15, 1, 1)) },
      { geo: new THREE.CylinderGeometry(bodyW * 0.4, bodyW * 0.4, 0.045, 28), color: c.body, matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(M(bodyStart + bodyLen * 0.25, 0, -0.012, 1.1, 1, 1)) },
      { geo: new THREE.BoxGeometry(0.06, 0.012, 0.03), color: 0x111111, matrix: M(bodyStart + bodyLen * 0.45, 0, 0.012) },
      { geo: new THREE.BoxGeometry(0.03, 0.07, 0.008), color: 0x111111, matrix: M(bodyStart + bodyLen * 0.35, 0, 0.012) },
      { geo: new THREE.BoxGeometry(0.03, 0.07, 0.008), color: 0x111111, matrix: M(bodyStart + bodyLen * 0.55, 0, 0.012) },
      { geo: new THREE.BoxGeometry(0.02, 0.09, 0.012), color: 0x999999, matrix: M(nutX + L, 0, 0.012) },
    ];
    // 프렛 (12평균율 위치)
    for (let f = 1; f <= 20; f++) {
      const x = nutX + L * (1 - Math.pow(2, -f / 12));
      if (x > bodyStart + 0.02) break;
      parts.push({ geo: new THREE.BoxGeometry(0.003, neckW, 0.024), color: 0xc0c0c0, matrix: M(x, 0, 0.002) });
      if ([3, 5, 7, 9, 12, 15].includes(f)) parts.push({ geo: new THREE.CylinderGeometry(0.004, 0.004, 0.024, 8), color: 0xeeeeee, matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(M(x - 0.012, 0, 0.002)) });
    }
    // 튜닝 페그
    for (let i = 0; i < c.strings; i++) parts.push({ geo: new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6), color: 0xbbbbbb, matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(M(0.03 + i * (headLen - 0.05) / c.strings, 0.032, 0.02)) });
    const body = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    g.add(body);

    // 줄: 연주하면 빛나도록 따로 만든다
    this.stringMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8 });
    for (let i = 0; i < c.strings; i++) {
      const y = (i - (c.strings - 1) / 2) * (neckW * 0.75 / (c.strings - 1));
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0009 + (c.strings - i) * 0.0002, 0.0009 + (c.strings - i) * 0.0002, L, 4), this.stringMat);
      s.rotation.z = Math.PI / 2;
      s.position.set(nutX + L / 2, y, 0.016);
      g.add(s);
    }
    // 스트랩
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 6, 24, Math.PI), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    strap.position.set(bodyStart + bodyLen * 0.5, 0, -0.05);
    strap.rotation.set(Math.PI / 2, 0, 0);
    strap.visible = false;
    g.add(strap);
    this.bodyCenterX = bodyStart + bodyLen * 0.5;
    return g;
  }

  // 교정 가이드: 반투명 노란 윤곽 (보고서 4-2)
  showGuide(on) {
    if (on && !this.ghost) {
      this.ghost = this.model.clone(true);
      this.ghost.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.25, depthWrite: false }); });
      this.root.add(this.ghost);
    }
    if (this.ghost) this.ghost.visible = on;
    this.model.visible = !on;
  }

  strum() { this.glow = 1; }

  update(dt) {
    if (this.glow > 0) {
      this.glow = Math.max(0, this.glow - dt * 3);
      this.stringMat.color.setRGB(0.85 + this.glow * 0.15, 0.85 + this.glow * 0.1, 0.85 - this.glow * 0.4);
    }
  }

  // PC: 1인칭으로 몸 앞에 든 자세
  attachDesktop(camera) {
    // 카메라 기준: 헤드는 왼쪽 앞, 몸통은 오른쪽 아래 가까이 (연주자가 내려다보는 각도)
    const head = new THREE.Vector3(-0.5, -0.2, -0.85);
    const x = new THREE.Vector3(0.9, -0.2, 0.18).normalize();          // 헤드 → 몸통
    const z = new THREE.Vector3(0, 0.75, 0.66);                         // 앞면이 눈 쪽으로
    z.sub(x.clone().multiplyScalar(z.dot(x))).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    new THREE.Matrix4().makeBasis(x, y, z).decompose(new THREE.Vector3(), this.root.quaternion, new THREE.Vector3());
    this.root.position.copy(head);
    camera.add(this.root);
  }

  // VR: 헤드에 단 컨트롤러를 따라간다. 교정 전에는 기본 자세.
  attachVR(controller) {
    this.controller = controller;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(-Math.PI / 2, 0, Math.PI);
    controller.add(this.root);
  }

  // 교정: 사용자가 실물 악기를 연주 자세로 든 상태에서, 몸통은 허리 앞, 헤드는 컨트롤러 위치에 오도록 맞춘다
  calibrate(headPos, headDir) {
    if (!this.controller) return false;
    const ctrl = new THREE.Vector3();
    this.controller.getWorldPosition(ctrl);
    const fwd = headDir.clone(); fwd.y = 0; fwd.normalize();
    const body = headPos.clone().add(new THREE.Vector3(0, -0.62, 0)).add(fwd.multiplyScalar(0.18));
    const neckDir = body.clone().sub(ctrl).normalize();             // 헤드 → 몸통 (+x)
    const front = headPos.clone().sub(body); front.y = 0; front.normalize().negate(); // 앞면(+z)은 관객 쪽
    const up = new THREE.Vector3().crossVectors(front, neckDir).normalize();
    const zAxis = new THREE.Vector3().crossVectors(neckDir, up).normalize();
    const m = new THREE.Matrix4().makeBasis(neckDir, up, zAxis).setPosition(ctrl);
    this.root.removeFromParent();
    this.root.matrix.identity();
    m.decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.controller.attach(this.root);
    return true;
  }
}

// ---------- 소리: Karplus-Strong 현 합성 ----------
const cache = new Map();
function pluckBuffer(ctx, midi, dur = 2.2) {
  const key = `${midi}`;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
  const n = Math.floor(sr * dur), period = Math.max(2, Math.round(sr / f));
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const nxt = (idx + 1) % period;
    const v = 0.5 * (ring[idx] + ring[nxt]) * 0.996;
    d[i] = ring[idx];
    ring[idx] = v;
    idx = nxt;
  }
  cache.set(key, buf);
  return buf;
}

export class InstrumentSound {
  constructor(audio, type, ampPos) {
    this.audio = audio;
    this.cfg = TYPES[type];
    this.type = type;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = type === 'bass' ? 0.9 : 0.55;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    const drive = type === 'bass' ? 2 : 6;
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    shaper.curve = curve;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = type === 'bass' ? 1200 : 3200;
    this.input = ctx.createGain();
    this.input.connect(shaper).connect(tone).connect(this.out);
    // 내 소리는 무대 뒤 앰프 위치에서 공연장 잔향과 함께
    this.out.connect(audio.panner(ampPos)).connect(audio.fxBus);
  }

  // 현재 코드(근음 MIDI)로 다운 스트럼
  strum(rootMidi, when = this.audio.ctx.currentTime) {
    const ctx = this.audio.ctx;
    const notes = this.type === 'bass' ? [rootMidi - 12] : [rootMidi, rootMidi + 7, rootMidi + 12];
    notes.forEach((m, i) => {
      const src = ctx.createBufferSource();
      src.buffer = pluckBuffer(ctx, m);
      const g = ctx.createGain(); g.gain.value = 0.7;
      g.gain.setTargetAtTime(0, when + 0.9, 0.25);
      src.connect(g).connect(this.input);
      src.start(when + i * 0.012);
      src.stop(when + 2.2);
    });
  }
}
