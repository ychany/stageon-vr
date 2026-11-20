// 관객·심사위원·밴드 멤버 인물 모델과 행동.
// 앞줄(Tier A)은 눈썹·입·팔이 움직이는 고품질, 중간 줄(Tier B)은 머리만 움직이는 저품질,
// 뒷줄 군중(Tier C)은 InstancedMesh 한 번의 그리기로 처리한다 (Vividness + LOD).
import * as THREE from 'three';

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIR = [0x1b1b1b, 0x2b1a10, 0x4a3020, 0x6b4a2b, 0x9a9a9a, 0xb8860b];
const CLOTH = [0x334455, 0x7a2e2e, 0x2e5e3e, 0x555555, 0x223366, 0x8a6d3b, 0x5b3a6b, 0x2a2a2a, 0xc0c0c0, 0x1f4f6f];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const rand = (a, b) => a + Math.random() * (b - a);

const vtxMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const darkMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

// 여러 도형을 하나의 지오메트리로 합친다 (그리기 호출 수를 줄이기 위해)
export function merge(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  const nm = new THREE.Matrix3();
  for (const { geo, color, matrix } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    c.set(color);
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));

const G = {
  legs: new THREE.BoxGeometry(0.3, 0.8, 0.2),
  torso: new THREE.BoxGeometry(0.42, 0.62, 0.24),
  arm: new THREE.BoxGeometry(0.1, 0.56, 0.1),
  head: new THREE.SphereGeometry(0.12, 12, 10),
  hair: new THREE.SphereGeometry(0.126, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  eye: new THREE.SphereGeometry(0.017, 6, 5),
  brow: new THREE.BoxGeometry(0.05, 0.012, 0.012),
  mouth: new THREE.BoxGeometry(0.06, 0.012, 0.012),
  phone: new THREE.BoxGeometry(0.07, 0.14, 0.01),
  seat: new THREE.BoxGeometry(0.46, 0.45, 0.46),
};

function look() {
  return {
    skin: pick(SKIN), hair: pick(HAIR), shirt: pick(CLOTH), pants: pick(CLOTH), cap: pick(CLOTH),
    hairStyle: pick(['short', 'short', 'short', 'long', 'long', 'bun', 'cap', 'bald']),
    glasses: Math.random() < 0.25,
    height: rand(0.9, 1.1), build: rand(0.86, 1.18),        // 키와 체격
  };
}

// 머리 모양을 사람마다 다르게: 짧은 머리, 긴 머리, 묶은 머리, 모자, 민머리 + 안경·코
function headGeometry(L) {
  const parts = [
    { geo: G.head, color: L.skin },
    { geo: G.eye, color: 0x101010, matrix: M(-0.045, 0.02, 0.105) },
    { geo: G.eye, color: 0x101010, matrix: M(0.045, 0.02, 0.105) },
    { geo: new THREE.BoxGeometry(0.022, 0.035, 0.03), color: L.skin, matrix: M(0, -0.012, 0.118) },
  ];
  const style = L.hairStyle;
  if (style !== 'bald') parts.push({ geo: G.hair, color: L.hair, matrix: M(0, 0.012, -0.012, -0.25, 0, 0) });
  if (style === 'long') parts.push({ geo: new THREE.BoxGeometry(0.25, 0.26, 0.09), color: L.hair, matrix: M(0, -0.08, -0.07) });
  if (style === 'bun') parts.push({ geo: new THREE.SphereGeometry(0.055, 8, 6), color: L.hair, matrix: M(0, 0.1, -0.1) });
  if (style === 'cap') {
    parts.push({ geo: new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), color: L.cap, matrix: M(0, 0.02, 0) });
    parts.push({ geo: new THREE.BoxGeometry(0.2, 0.012, 0.12), color: L.cap, matrix: M(0, 0.05, 0.13, 0.1, 0, 0) });
  }
  if (L.glasses) {
    parts.push({ geo: new THREE.TorusGeometry(0.026, 0.004, 4, 12), color: 0x1a1a1a, matrix: M(-0.045, 0.02, 0.112) });
    parts.push({ geo: new THREE.TorusGeometry(0.026, 0.004, 4, 12), color: 0x1a1a1a, matrix: M(0.045, 0.02, 0.112) });
  }
  return merge(parts);
}

// 한 사람. options: tier 'A' | 'B', seated, faceDir(라디안, +z를 볼 때 0)
export class Person {
  constructor({ tier = 'A', seated = false, row = 0, look: L = look() } = {}) {
    this.tier = tier;
    this.row = row;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.seated = seated;
    const hip = seated ? 0.45 : 0.8;
    const torsoY = hip + 0.31;
    const shoulderY = hip + 0.58;
    const headY = hip + 0.78;

    this.look = L;
    if (tier === 'B') {
      // 중간 줄은 실제 메시를 만들지 않고 위치만 잡아 두고, InstancedPeople이 한 번에 그린다
      this.bodyAnchor = new THREE.Object3D();
      this.body.add(this.bodyAnchor);
    } else {
      const bodyParts = [{ geo: G.torso, color: L.shirt, matrix: M(0, torsoY, 0) }];
      if (seated) bodyParts.push({ geo: G.legs, color: L.pants, matrix: M(0, 0.48, 0.18, Math.PI / 2, 0, 0, 0.75) });
      else bodyParts.push({ geo: G.legs, color: L.pants, matrix: M(0, 0.4, 0) });
      this.body.add(new THREE.Mesh(merge(bodyParts), vtxMat));
    }

    if (tier === 'A') {
      this.arms = [-1, 1].map((s) => {
        const pivot = new THREE.Group();
        pivot.position.set(0.27 * s, shoulderY, 0);
        const m = new THREE.Mesh(merge([{ geo: G.arm, color: L.shirt, matrix: M(0, -0.26, 0) }, { geo: new THREE.SphereGeometry(0.05, 6, 5), color: L.skin, matrix: M(0, -0.56, 0) }]), vtxMat);
        pivot.add(m);
        this.body.add(pivot);
        return pivot;
      });
    }

    this.neck = new THREE.Group();
    this.neck.position.set(0, headY, 0);
    this.body.add(this.neck);
    this.head = tier === 'B' ? new THREE.Object3D() : new THREE.Mesh(headGeometry(L), vtxMat);
    // 키와 체격 (앉은 사람은 덜 다르게)
    const h = seated ? 1 + (L.height - 1) * 0.4 : L.height;
    this.root.scale.set(L.build, h, L.build);
    this.phase = Math.random() * 10;
    this.idleSway = rand(0.015, 0.04);
    this.neck.add(this.head);
    if (tier === 'A') {
      this.brows = new THREE.Mesh(merge([
        { geo: G.brow, color: L.hair, matrix: M(-0.045, 0.055, 0.112) },
        { geo: G.brow, color: L.hair, matrix: M(0.045, 0.055, 0.112) },
      ]), vtxMat);
      this.mouth = new THREE.Mesh(G.mouth, darkMat);
      this.mouth.position.set(0, -0.055, 0.112);
      this.neck.add(this.brows, this.mouth);
    }

    // 상태
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.watcher = Math.random() < 0.7;
    this.nextGlance = rand(2, 5);
    this.glanceUntil = 0;
    this.glanceTarget = new THREE.Vector3();
    this.reactions = [];
    this.state = 'idle';
    this.stateUntil = 0;
    this.eyeContactUntil = 0;
    this.expr = { brow: 0, smile: 0 };      // 목표 표정
    this.exprNow = { brow: 0, smile: 0 };
    this.clap = 0;
    this.bob = Math.random() * 10;
    this.neighbor = null;
    this.phone = null;
    this.time = 0;
  }

  addPhone() {
    if (this.phone || this.tier !== 'A') return;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.phone, new THREE.MeshLambertMaterial({ color: 0x111111 })));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.set(0.02, 0.05, 0.007);
    g.add(led);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3030, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(0.06, 0.06, 1); glow.position.copy(led.position);
    g.add(glow);
    g.position.set(0.12, this.seated ? 1.05 : 1.42, 0.32);
    this.body.add(g);
    this.phone = g;
    if (this.arms) { this.arms[1].rotation.x = -1.25; }
  }
  removePhone() {
    if (!this.phone) return;
    this.body.remove(this.phone);
    this.phone = null;
    if (this.arms) this.arms[1].rotation.x = 0;
  }

  // when: 지금부터 몇 초 뒤
  react(type, when, dur = 1.6) {
    this.reactions.push({ type, at: this.time + when, dur });
  }

  eyeContact(now) {
    // 0.5초 이내 반응: 눈썹이 살짝 올라가고 눈을 맞춘다
    this.eyeContactUntil = now + 2.5;
  }

  update(dt, now, ctx) {
    this.time = now;
    // 예약된 반응 실행
    for (let i = this.reactions.length - 1; i >= 0; i--) {
      const r = this.reactions[i];
      if (now >= r.at) {
        this.reactions.splice(i, 1);
        this.state = r.type; this.stateUntil = now + r.dur;
        if (r.type === 'murmur' && ctx.onMurmur) ctx.onMurmur(this);
        if (r.type === 'cheer') this.clap = r.dur;
      }
    }
    if (now > this.stateUntil && this.state !== 'idle') this.state = 'idle';

    // 시선 목표 결정
    const userHead = ctx.userHead;
    let target = null;
    const p = ctx.params;
    let lean = 0;
    if (now < this.eyeContactUntil) target = userHead;
    else if (this.state === 'murmur' && this.neighbor) target = this.neighbor.headWorld(ctx.tmp2);
    else if (this.state === 'write') target = ctx.tmp2.set(this.root.position.x + 0.1, this.root.position.y + 0.75, this.root.position.z + 0.4);
    else if (this.state === 'watch') target = ctx.tmp2.set(this.root.position.x - 0.35, this.root.position.y + 1.05, this.root.position.z + 0.35);
    else if (this.lookAt && now < this.lookAtUntil) target = this.lookAt;
    else if (this.state === 'lean') { target = userHead; lean = 1; }
    else if (this.phone && this.state === 'idle' && Math.random() < 0.002) target = null;
    else {
      if (now > this.nextGlance) {
        this.glanceUntil = now + 0.8;
        this.nextGlance = now + rand(2, 5);
        this.glanceTarget.set(userHead.x + rand(-4, 4), userHead.y + rand(-1.5, 0.5), userHead.z + rand(-1, 2));
      }
      if (now < this.glanceUntil) target = this.glanceTarget;
      else if (this.watcher) target = userHead;
      else target = ctx.idleTarget;
    }
    if (this.phone && !this.watcher && this.state === 'idle') target = null; // 휴대폰 화면을 봄

    // 머리 방향 (yaw/pitch) 부드럽게
    let ty = 0, tp = -0.5, tr = 0;
    if (target) {
      this.neck.getWorldPosition(ctx.tmp);
      const dx = target.x - ctx.tmp.x, dy = target.y - ctx.tmp.y, dz = target.z - ctx.tmp.z;
      const face = this.root.rotation.y;
      ty = Math.atan2(dx, dz) - face;
      ty = Math.atan2(Math.sin(ty), Math.cos(ty));
      tp = -Math.atan2(dy, Math.hypot(dx, dz));
      ty = THREE.MathUtils.clamp(ty, -1.2, 1.2);
      tp = THREE.MathUtils.clamp(tp, -0.6, 0.6);
    }
    if (lean) tr = 0.35 * Math.sign(this.root.position.x || 1);
    if (this.state === 'murmur') tr = 0.15;
    const k = Math.min(1, dt * 6);
    this.yaw += (ty - this.yaw) * k;
    this.pitch += (tp - this.pitch) * k;
    this.roll += (tr - this.roll) * k;
    this.neck.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.body.rotation.x += ((lean ? 0.18 : 0) - this.body.rotation.x) * k;

    // 표정
    if (this.brows) {
      let brow = 0, smile = 0;
      if (now < this.eyeContactUntil) { brow = 0.6; smile = p.friendly ? 0.7 : 0; }
      if (this.state === 'murmur') { brow = -1; smile = -0.3; }
      if (this.state === 'cheer') { brow = 0.4; smile = 1; }
      if (this.state === 'cold') { brow = -0.6; smile = -0.2; }
      if (p.friendly && this.state === 'idle' && now >= this.eyeContactUntil) smile = 0.35;
      this.exprNow.brow += (brow - this.exprNow.brow) * Math.min(1, dt * 8);
      this.exprNow.smile += (smile - this.exprNow.smile) * Math.min(1, dt * 8);
      this.brows.position.y = this.exprNow.brow * 0.012;
      this.brows.scale.y = 1;
      this.mouth.scale.set(1 + this.exprNow.smile * 0.5, 1 + Math.max(0, this.exprNow.smile) * 0.6, 1);
      this.mouth.position.y = -0.055 + this.exprNow.smile * 0.004;
    }

    // 가만히 있을 때도 사람처럼: 숨쉬기와 체중 이동
    this.body.scale.y = 1 + Math.sin(now * 1.6 + this.phase) * 0.006;
    if (!lean) this.body.rotation.z = Math.sin(now * 0.45 + this.phase) * this.idleSway;

    // 박수·환호
    if (this.clap > 0) {
      this.clap -= dt;
      const ph = Math.sin(now * 20 + this.bob) * 0.5 + 0.5;
      this.body.position.y = Math.abs(Math.sin(now * 8 + this.bob)) * (this.seated ? 0.015 : 0.035);
      if (this.arms) {
        this.arms[0].rotation.set(-1.2, 0, -0.5 + ph * 0.35);
        this.arms[1].rotation.set(-1.2, 0, 0.5 - ph * 0.35);
      }
    } else if (this.arms && this.state === 'write') {
      this.arms[1].rotation.set(-0.95 + Math.sin(now * 14) * 0.08, 0, Math.sin(now * 9) * 0.1);
      this.arms[0].rotation.set(0, 0, 0);
    } else if (this.arms && this.state === 'watch') {
      this.arms[0].rotation.set(-1.4, 0, 0.6);
    } else if (this.arms && !this.phone) {
      this.arms[0].rotation.set(0, 0, 0.04);
      this.arms[1].rotation.set(0, 0, -0.04);
      this.body.position.y = 0;
    } else this.body.position.y = 0;
  }

  headWorld(out) {
    return this.neck.getWorldPosition(out);
  }
}

// 뒷줄 군중: 하나의 InstancedMesh
export class Crowd {
  constructor(count, area) {
    const L = look();
    const geo = merge([
      { geo: G.legs, color: 0x2a2a33, matrix: M(0, 0.4, 0) },
      { geo: G.torso, color: 0x4a4a58, matrix: M(0, 1.11, 0) },
      { geo: G.arm, color: 0x4a4a58, matrix: M(-0.27, 1.11, 0) },
      { geo: G.arm, color: 0x4a4a58, matrix: M(0.27, 1.11, 0) },
      { geo: new THREE.SphereGeometry(0.12, 8, 6), color: 0x8a6a50, matrix: M(0, 1.58, 0) },
    ]);
    this.mesh = new THREE.InstancedMesh(geo, vtxMat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.base = [];
    const c = new THREE.Color();
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const x = rand(area.x0, area.x1), z = rand(area.z0, area.z1);
      const s = rand(0.92, 1.08);
      this.base.push({ x, z, s, ph: Math.random() * 10, ry: rand(-0.3, 0.3) + Math.PI * 0 });
      m.compose(new THREE.Vector3(x, area.y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.base[i].ry, 0)), new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(i, m);
      c.setHSL(Math.random(), 0.3, rand(0.35, 0.75));
      this.mesh.setColorAt(i, c);
    }
    this.y = area.y;
    this.cheer = 0;
    this._m = m;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }
  update(dt, now) {
    this._frame = (this._frame || 0) + 1;
    if (this.cheer <= 0 && this._frame % 3) return;
    this.cheer = Math.max(0, this.cheer - dt);
    const e = this._e || (this._e = new THREE.Euler());
    for (let i = 0; i < this.mesh.count; i++) {
      const b = this.base[i];
      const jump = this.cheer > 0 ? Math.max(0, Math.sin(now * 7 + b.ph)) * 0.08 : 0;
      this._v.set(b.x, this.y + jump, b.z);
      this._q.setFromEuler(e.set(0, b.ry, Math.sin(now * 0.45 + b.ph) * 0.03));
      this._s.set(b.s, b.s, b.s);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this._dirty = this.cheer > 0;
  }
}

// 중간 줄 관객(Tier B): 몸과 머리를 각각 InstancedMesh 하나로 그린다 (그리기 호출 2번).
// 사람마다의 움직임(고개 돌림, 몸 기울임)은 Person 객체가 계산하고, 그 행렬을 복사해 온다.
export class InstancedPeople {
  constructor(people) {
    this.people = people;
    const seated = people[0].seated;
    const hip = seated ? 0.45 : 0.8, torsoY = hip + 0.31;
    const bodyParts = [
      { geo: G.torso, color: 0xffffff, matrix: M(0, torsoY, 0) },
      { geo: G.arm, color: 0xffffff, matrix: M(-0.27, torsoY, 0) },
      { geo: G.arm, color: 0xffffff, matrix: M(0.27, torsoY, 0) },
      seated ? { geo: G.legs, color: 0x5a5a5a, matrix: M(0, 0.48, 0.18, Math.PI / 2, 0, 0, 0.75) } : { geo: G.legs, color: 0x5a5a5a, matrix: M(0, 0.4, 0) },
    ];
    const headParts = [
      { geo: new THREE.SphereGeometry(0.12, 10, 8), color: 0xffffff },
      { geo: G.hair, color: 0x3a3330, matrix: M(0, 0.012, -0.012, -0.25, 0, 0) },
      { geo: G.eye, color: 0x101010, matrix: M(-0.045, 0.02, 0.105) },
      { geo: G.eye, color: 0x101010, matrix: M(0.045, 0.02, 0.105) },
    ];
    const n = people.length;
    this.bodies = new THREE.InstancedMesh(merge(bodyParts), vtxMat, n);
    this.heads = new THREE.InstancedMesh(merge(headParts), vtxMat, n);
    for (const m of [this.bodies, this.heads]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; }
    const c = new THREE.Color();
    people.forEach((p, i) => {
      this.bodies.setColorAt(i, c.set(p.look.shirt));
      this.heads.setColorAt(i, c.set(p.look.skin));
    });
    this.count = n;
  }
  setCount(k) { this.count = Math.max(0, Math.min(this.people.length, k)); this.bodies.count = this.heads.count = this.count; }
  update() {
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      this.bodies.setMatrixAt(i, p.bodyAnchor.matrixWorld);
      this.heads.setMatrixAt(i, p.head.matrixWorld);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
