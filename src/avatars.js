// 앞줄 관객·심사위원·밴드를 실사형 아바타로 그린다.
// 아바타와 동작: Microsoft Rocketbox Avatar Library (MIT, assets/avatars/LICENSE-MIT.md).
// 몸 전체 동작은 모션캡처 클립이 맡고, 그 위에 시선(머리 뼈), 표정(블렌드셰이프), 눈 깜빡임,
// 박자 끄덕임, 팔짱(팔 뼈 방향 지정)을 매 프레임 덧입힌다. 행동 판단은 기존 Person 로직을 그대로 쓴다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const BASE = 'assets/avatars/';
export const CASUAL = { f: ['f01', 'f03', 'f05', 'f08', 'f12', 'f17'], m: ['m01', 'm06', 'm08', 'm09', 'm10', 'm16'] };
export const FORMAL = ['m03', 'f09'];

const UPPER = /Spine1|Spine2|Neck|Head|Clavicle|UpperArm|Forearm|Hand|Finger|Ponytail/;
const lib = { models: new Map(), clips: null, loading: null };
const loader = new GLTFLoader();

function prepClips(animations) {
  const out = new Map();
  for (const c of animations) {
    // 걷기 등에서 몸 전체가 앞으로 나아가는 이동은 빼고 제자리 동작만 쓴다
    for (const t of c.tracks) {
      if (t.name === 'Bip01.position') {
        const v = t.values; const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
    }
    out.set(c.name, c);
    const up = c.tracks.filter((t) => UPPER.test(t.name.split('.')[0]));
    const low = c.tracks.filter((t) => !UPPER.test(t.name.split('.')[0]));
    out.set(c.name + '|upper', new THREE.AnimationClip(c.name + '|upper', c.duration, up));
    out.set(c.name + '|lower', new THREE.AnimationClip(c.name + '|lower', c.duration, low));
  }
  return out;
}

// 필요한 아바타만 불러온다 (이미 불러온 것은 다시 받지 않음)
export async function loadAvatars(ids, onProgress) {
  if (!lib.clips) {
    lib.loading = lib.loading || loader.loadAsync(BASE + 'anims.glb').then((g) => { lib.clips = prepClips(g.animations); });
    await lib.loading;
  }
  const want = ids.filter((id) => !lib.models.has(id));
  let done = 0;
  await Promise.all(want.map(async (id) => {
    const g = await loader.loadAsync(BASE + id + '.glb');
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;   // 동작으로 몸이 바운딩 박스를 벗어나도 사라지지 않게
        const m = o.material;
        if (m && m.map) m.map.anisotropy = 4;
        if (m && m.name === 'opacity') { m.alphaTest = 0.4; m.transparent = false; }
      }
    });
    lib.models.set(id, g.scene);
    done++; if (onProgress) onProgress(done, want.length);
  }));
}
export const avatarsReady = (ids) => lib.clips && ids.every((id) => lib.models.has(id));

// 줄마다 옆 사람과 겹치지 않게 아바타를 나눠 준다
export function pickAvatarIds(n, seed = 0) {
  const all = [];
  for (let i = 0; i < 6; i++) all.push(CASUAL.f[i], CASUAL.m[i]);
  const out = [];
  for (let i = 0; i < n; i++) out.push(all[(i + seed) % all.length]);
  return out;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
const UPV = new THREE.Vector3(0, 1, 0);

// 뼈의 월드 회전을 바꾸고 싶을 때: 부모 기준 로컬 회전으로 바꿔 넣는다
function setWorldQuat(bone, qWorld) {
  bone.parent.getWorldQuaternion(_q3);
  bone.quaternion.copy(_q3.invert().multiply(qWorld));
  bone.updateMatrixWorld(true);
}
// 뼈가 자식 뼈 쪽으로 향하는 방향을 원하는 월드 방향으로 돌린다 (팔짱 같은 자세를 축 정보 없이 만들기 위해)
function aimBone(bone, child, dirWorld, w) {
  bone.getWorldPosition(_v); child.getWorldPosition(_v2);
  const cur = _v2.sub(_v).normalize();
  _q.setFromUnitVectors(cur, _v3.copy(dirWorld).normalize());
  bone.getWorldQuaternion(_q2);
  const target = _q.multiply(_q2);
  _q2.slerp(target, w);
  setWorldQuat(bone, _q2);
}

export class RealBody {
  constructor(person, id, { gender } = {}) {
    this.p = person;
    this.id = id;
    this.g = gender || id[0];
    const tpl = lib.models.get(id);
    this.model = cloneSkinned(tpl);
    this.bones = {};
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh && o.morphTargetDictionary) this.meshes.push(o);
    });
    // 기존 도형 인물은 숨기고(행동 판단용으로만 남김) 그 자리에 아바타를 세운다
    person.body.traverse((o) => { if (o.isMesh) o.visible = false; });
    person.root.scale.set(1, 1, 1);
    person.root.add(this.model);
    person.arms = null; person.brows = null;
    person.real = this;
    person.headWorld = (out) => this.bones.Bip01_Head.getWorldPosition(out);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();      // 이름 → { action, w, target }
    this.variant = Math.random() < 0.5 ? '01' : '02';
    this.speed = 0.85 + Math.random() * 0.3;
    this.offset = Math.random() * 8;
    this.oneShot = null;           // { name, until }
    this.nextFidget = 6 + Math.random() * 12;
    this.blinkAt = Math.random() * 3; this.blink = 0;
    this.look = 1;                 // 시선 덧입힘 세기
    this.nodAmp = 0;               // 박자 끄덕임 세기 (관심도에 따라)
    this.armCross = 0;
    this.lastKey = '';
    this.frameSkip = 0;
    this.restQ = {};
    this.model.updateMatrixWorld(true);
    // 정면(+Z)을 볼 때 머리·목의 월드 회전 (몸 방향 기준) — 시선을 계산할 때 기준으로 쓴다
    person.root.getWorldQuaternion(_q).invert();
    for (const n of ['Bip01_Head', 'Bip01_Neck']) { this.bones[n].getWorldQuaternion(_q2); this.restQ[n] = _q.clone().multiply(_q2); }
  }

  clip(name) {
    const c = lib.clips;
    return c.get(`${this.g}_${name}`) || c.get(`m_${name}`) || c.get(`f_${name}`);
  }
  act(name) {
    let a = this.actions.get(name);
    if (!a) {
      const [base, part] = name.split('|');
      const clip = this.clip(base) && lib.clips.get((this.clip(base).name) + (part ? '|' + part : ''));
      if (!clip) return null;
      const action = this.mixer.clipAction(clip);
      action.setEffectiveWeight(0); action.play();
      action.time = (this.offset * 1.7) % Math.max(0.1, clip.duration);
      action.timeScale = this.speed;
      a = { action, w: 0, target: 0 };
      this.actions.set(name, a);
    }
    return a;
  }
  setPose(names, fade = 0.35) {
    const key = names.join('+');
    if (key !== this.lastKey) {
      this.lastKey = key;
    }
    for (const [n, a] of this.actions) a.target = names.includes(n) ? 1 : 0;
    for (const n of names) this.act(n);
    this.fade = fade;
  }
  gesture(name, dur) {
    const c = this.clip(name);
    if (!c) return;
    this.oneShot = { name, until: this.p.time + (dur || c.duration / this.speed) };
    const a = this.act(name); if (a) a.action.time = 0;
  }

  // 상태 → 동작 클립 고르기
  choose(now) {
    const p = this.p;
    const sit = p.seated;
    const table = p.judge;
    const v = this.variant;
    const base = table ? 'sit_table_idle_neutral_01' : sit ? `sit_chair_idle_neutral_${v}` : `idle_neutral_${v}`;
    let gest = null, look = 1;
    if (p.walk) return { names: ['walk'], look: 0.6 };
    if (this.oneShot && now < this.oneShot.until) { gest = this.oneShot.name; look = 0.25; }
    else if (p.clap > 0) { gest = (!sit && p.cheerStyle) ? 'cheer_01' : 'claphands_01'; look = 0.7; }
    else if (p.state === 'murmur' || p.state === 'whisper') { gest = 'gestic_talk_neutral_01'; look = 0.9; }
    else if (p.state === 'whisperBack') { gest = 'gestic_listen_neutral_01'; look = 0.9; }
    else if (p.phoneMode === 'film') { gest = 'take_picture'; look = 0.35; }
    else if (p.phoneMode === 'scroll') { gest = 'cell_phone_textmessage'; look = 0.3; }
    else if (table && (p.state === 'cold' || p.stern)) { gest = 'sit_table_gestic_thoughtful'; look = 0.8; }
    if (!gest) return { names: [base], look };
    if (gest.startsWith('sit_') || gest === 'walk') return { names: [gest], look };
    // 앉은 사람은 다리·골반은 앉은 동작, 상체만 몸짓 동작을 쓴다
    if (sit) return { names: [base + '|lower', gest + '|upper'], look };
    return { names: [gest], look };
  }

  update(dt, now, ctx) {
    const p = this.p;
    // 가끔 몸을 움직인다 (하품·두리번·기침). 관심이 낮은 관객일수록 자주
    if (now > this.nextFidget && p.state === 'idle' && !p.phone && !p.clap && !p.walk && !p.judge) {
      const bored = (p.engage ?? 0.6) < 0.4;
      const r = Math.random();
      const name = (p.seated ? 'sit_chair_idle_' : 'idle_') + (bored && r < 0.5 ? 'yawn' : 'look_around');
      if (bored || r < 0.35) this.gesture(p.seated ? name : name + (name.endsWith('yawn') ? '_01' : '_01'), 3.5);
      this.nextFidget = now + (bored ? 6 : 12) + Math.random() * 12;
    }
    const pick = this.choose(now);
    this.setPose(pick.names);
    this.look += (pick.look - this.look) * Math.min(1, dt * 4);

    // 동작 가중치를 부드럽게 바꾸고 섞는다 (먼 관객은 두 프레임에 한 번)
    const k = Math.min(1, dt / (this.fade || 0.35));
    for (const [n, a] of this.actions) {
      a.w += (a.target - a.w) * k;
      if (a.target === 0 && a.w < 0.01) { a.w = 0; }
      a.action.setEffectiveWeight(a.w);
    }
    this.frameSkip = (this.frameSkip + 1) % (p.row >= 1 ? 2 : 1);
    if (this.frameSkip === 0) this.mixer.update(dt * (p.row >= 1 ? 2 : 1));
    this.model.updateMatrixWorld(true);

    this.post(dt, now, ctx);
  }

  // 모션 위에 덧입히는 것들
  post(dt, now, ctx) {
    const p = this.p, B = this.bones;
    // 몸 기울이기(관심이 높을 때 앞으로)
    const lean = p.state === 'lean' ? 0.22 : (p.engage ?? 0.5) > 0.75 && !p.seated ? 0.06 : 0;
    if (lean > 0.001) {
      B.Bip01_Spine1.getWorldQuaternion(_q2);
      p.root.getWorldQuaternion(_q); _v.set(1, 0, 0).applyQuaternion(_q);
      _q.setFromAxisAngle(_v, lean);
      setWorldQuat(B.Bip01_Spine1, _q.multiply(_q2));
    }
    // 팔짱 (평가하는 눈빛): 위팔은 아래·앞으로, 아래팔은 가슴 앞을 가로지르게
    const crossT = p.crossed && !p.phone && !p.clap && p.state !== 'whisper' && !p.judge ? 1 : 0;
    this.armCross += (crossT - this.armCross) * Math.min(1, dt * 3);
    if (this.armCross > 0.01) {
      p.root.getWorldQuaternion(_q);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_q), right = new THREE.Vector3(-1, 0, 0).applyQuaternion(_q), down = new THREE.Vector3(0, -1, 0);
      for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
        const inward = right.clone().multiplyScalar(s);   // L팔은 오른쪽(몸 안쪽)으로
        const up = B[`Bip01_${side}_UpperArm`], fo = B[`Bip01_${side}_Forearm`], ha = B[`Bip01_${side}_Hand`];
        if (!up || !fo || !ha) continue;
        aimBone(up, fo, down.clone().multiplyScalar(0.6).addScaledVector(fwd, 0.5).addScaledVector(inward, -0.12), this.armCross);
        aimBone(fo, ha, inward.clone().multiplyScalar(0.95).addScaledVector(fwd, 0.12).addScaledVector(UPV, side === 'L' ? 0.32 : 0.2), this.armCross);
      }
    }
    // 시선: Person이 계산한 yaw/pitch/roll(몸 기준)로 목·머리를 돌린다. 박자에 맞춰 끄덕임을 더한다
    let nod = 0;
    if (this.nodAmp > 0.01 && ctx.beatPhase !== undefined && !p.phone && p.state === 'idle') nod = Math.max(0, Math.sin(ctx.beatPhase * Math.PI * 2)) * this.nodAmp * 0.18;
    p.root.getWorldQuaternion(_q);
    _e.set(p.pitch + nod, p.yaw, p.roll, 'YXZ');
    const aim = _q.clone().multiply(_q2.setFromEuler(_e));
    for (const [n, share] of [['Bip01_Neck', 0.4], ['Bip01_Head', 1]]) {
      const bone = B[n];
      bone.getWorldQuaternion(_q2);
      const want = aim.clone().multiply(this.restQ[n]);
      _q2.slerp(want, this.look * share);
      setWorldQuat(bone, _q2);
    }
    // 표정과 눈 깜빡임
    const ex = p.exprNow;
    if (now > this.blinkAt) { this.blink = 0.16; this.blinkAt = now + 2 + Math.random() * 4.5; }
    const bl = this.blink > 0 ? Math.sin((1 - this.blink / 0.16) * Math.PI) : 0;
    this.blink = Math.max(0, this.blink - dt);
    let jaw = 0;
    if (p.state === 'murmur' || p.state === 'whisper') jaw = 0.12 + Math.max(0, Math.sin(now * 13 + this.offset)) * 0.18;
    if (p.clap > 0 && p.cheerStyle) jaw = 0.45;
    const stern = p.stern ? 0.5 : 0;
    const set = { blink: bl, smile: Math.max(0, ex.smile), frown: Math.max(0, -ex.smile) + stern * 0.5, browUp: Math.max(0, ex.brow) * 0.8, browDown: Math.max(0, -ex.brow) * 0.9 + stern * 0.6, squint: Math.max(0, -ex.brow) * 0.25 + Math.max(0, ex.smile) * 0.25, press: stern * 0.5, jawOpen: jaw };
    for (const m of this.meshes) {
      const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
      for (const k in set) if (d[k] !== undefined) inf[d[k]] = set[k];
    }
  }

  // 휴대폰을 오른손에 쥐어 준다 (뼈는 cm 단위라 100배)
  attachPhone(group, mode) {
    const hand = this.bones.Bip01_R_Hand;
    if (!hand) return false;
    group.position.set(0, 0, 0); group.rotation.set(0, 0, 0);
    group.scale.setScalar(100);
    if (mode === 'film') { group.position.set(9, 2, -3); group.rotation.set(0, Math.PI / 2, Math.PI / 2); }
    else { group.position.set(8, 2, -2); group.rotation.set(Math.PI / 2, 0, Math.PI / 2); }
    hand.add(group);
    return true;
  }
}
