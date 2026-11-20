// 공연장 구성: 대기실 → (실제로 걷는) 무대 → 객석.
// 사용자가 헤드셋을 쓴 지점이 대기실이고, 정면으로 STAGE.stageMarkZ 만큼 걸어가면 무대 중앙이다.
import * as THREE from 'three';
import { STAGE } from './config.js?v=202611202321';
import { decorate } from './themes.js?v=202611202321';
import { Person, Crowd, InstancedPeople, rand, merge } from './figures.js?v=202611202321';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export function buildVenue(scene, level) {
  const V = level.venue;
  const drop = V.floorDrop;
  const out = { people: [], front: [], judges: [], band: [], crowd: null, audiencePositions: [] };
  const root = new THREE.Group();
  scene.add(root);
  out.root = root;

  // ---------- 조명 ----------
  out.hemi = new THREE.HemisphereLight(0xb8c4ff, 0x201820, V.houseLight);
  root.add(out.hemi);
  const backLight = new THREE.PointLight(0xffd9a0, 6, 6, 1.5);
  backLight.position.set(0, 2.6, 0.6);
  root.add(backLight);
  out.backLight = backLight;

  // 무대 스포트라이트 (객석 쪽 위에서 무대 중앙을 비춤)
  const spot = new THREE.SpotLight(0xfff2dd, 0, 18, 0.32, 0.45, 1.2);
  spot.position.set(0, Math.min(5, V.height - 0.3), STAGE.stageMarkZ - 4.5);
  spot.target.position.set(0, 0, STAGE.stageMarkZ);
  root.add(spot, spot.target);
  out.spot = spot;
  // 눈부심: 조명 기구 위치의 밝은 빛 번짐 (사용자가 조명을 볼수록 강해짐)
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff4e0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  glare.position.copy(spot.position);
  glare.scale.set(1.8, 1.8, 1);
  root.add(glare);
  out.glare = glare;
  // 빛기둥
  const coneLen = spot.position.distanceTo(spot.target.position);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(Math.tan(0.32) * coneLen, coneLen, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  cone.position.copy(spot.position).add(spot.target.position).multiplyScalar(0.5);
  cone.lookAt(spot.target.position);
  cone.rotateX(-Math.PI / 2);
  root.add(cone);
  out.cone = cone;

  // 무대에서 새어 나오는 빛이 앞줄 관객 얼굴을 비춘다 (표정이 보이도록)
  const spill = new THREE.PointLight(0xffe0c0, 2 + V.houseLight * 20, 10, 1.4);
  spill.position.set(0, 1.2, STAGE.stageFrontZ - 0.4);
  root.add(spill);
  out.spill = spill;

  // (성능) 무대 보조 조명은 실제 광원 대신 값만 둔다: VR은 양쪽 눈을 그리므로 광원 수를 줄인다
  out.wash = { intensity: 0 };

  // ---------- 대기실 ----------
  const bsW = 3.2, bsZ0 = STAGE.curtainZ, bsZ1 = STAGE.backstageBackZ, bsH = 2.8;
  const bsFloor = new THREE.Mesh(new THREE.PlaneGeometry(bsW, bsZ1 - bsZ0), lam(0x3a3430));
  bsFloor.rotation.x = -Math.PI / 2; bsFloor.position.set(0, 0, (bsZ0 + bsZ1) / 2);
  root.add(bsFloor);
  const wallMat = lam(0x4b4038);
  const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); root.add(m); return m; };
  box(0.1, bsH, bsZ1 - bsZ0, -bsW / 2, bsH / 2, (bsZ0 + bsZ1) / 2, wallMat);
  box(0.1, bsH, bsZ1 - bsZ0, bsW / 2, bsH / 2, (bsZ0 + bsZ1) / 2, wallMat);
  box(bsW, bsH, 0.1, 0, bsH / 2, bsZ1, wallMat);
  box(bsW, 0.1, bsZ1 - bsZ0, 0, bsH, (bsZ0 + bsZ1) / 2, lam(0x2a2522));
  // 커튼 (가운데가 무대로 나가는 입구)
  const curtainMat = lam(0x5a0d16);
  const gap = 1.3;
  const cw = (STAGE.stageWidth - gap) / 2;
  box(cw, V.height, 0.08, -(gap / 2 + cw / 2), V.height / 2, bsZ0, curtainMat);
  box(cw, V.height, 0.08, gap / 2 + cw / 2, V.height / 2, bsZ0, curtainMat);
  box(gap, Math.max(0.2, V.height - 2.3), 0.08, 0, 2.3 + (V.height - 2.3) / 2, bsZ0, curtainMat);
  // 대기실 모니터: 객석이 차는 모습
  const mon = makeCanvasPanel(512, 288);
  mon.mesh.scale.set(0.9, 0.51, 1);
  mon.mesh.position.set(-bsW / 2 + 0.07, 1.6, 0.5);
  mon.mesh.rotation.y = Math.PI / 2;
  root.add(mon.mesh);
  out.monitor = mon;
  // 거울과 조명 전구 (분장실 느낌)
  box(0.9, 0.7, 0.03, bsW / 2 - 0.06, 1.5, 0.6, lam(0x8899aa, { emissive: 0x111822 })).rotation.y = Math.PI / 2;
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    b.position.set(bsW / 2 - 0.08, 1.9, 0.6 - 0.4 + i * 0.2);
    root.add(b);
  }

  // ---------- 무대 ----------
  const stageDepth = STAGE.curtainZ - STAGE.stageFrontZ;
  const stage = box(STAGE.stageWidth, Math.max(0.05, drop), stageDepth, 0, -Math.max(0.05, drop) / 2, (STAGE.curtainZ + STAGE.stageFrontZ) / 2, lam(0x2a2220));
  stage.material = lam(0x2b2420);
  // 바닥 표시 (무대 중앙)
  const mark = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 40), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.0 }));
  mark.rotation.x = -Math.PI / 2; mark.position.set(0, 0.006, STAGE.stageMarkZ);
  root.add(mark);
  out.mark = mark;
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.05), new THREE.MeshBasicMaterial({ color: 0xe8e0c0 }));
  tape.rotation.x = -Math.PI / 2; tape.position.set(0, 0.004, STAGE.stageMarkZ);
  root.add(tape);
  const tape2 = tape.clone(); tape2.rotation.z = Math.PI / 2; root.add(tape2);
  // 마이크 스탠드 (실물 소품과 위치를 맞추는 Haptic Retargeting 지점)
  const stand = new THREE.Group();
  stand.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 8), lam(0x111111)));
  stand.children[0].position.y = 0.65;
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), lam(0x777777));
  micHead.position.set(0, 1.32, 0.04); stand.add(micHead);
  const baseG = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16), lam(0x111111)); baseG.position.y = 0.01; stand.add(baseG);
  stand.position.set(0, 0, STAGE.stageMarkZ - 0.5);
  root.add(stand);
  // 모니터 스피커 (웨지)
  for (const x of [-0.8, 0.8]) {
    const w = box(0.55, 0.3, 0.4, x, 0.15, STAGE.stageFrontZ + 0.35, lam(0x151515));
    w.rotation.x = -0.35;
  }
  // PA 스피커
  for (const x of [-STAGE.stageWidth / 2 - 0.5, STAGE.stageWidth / 2 + 0.5]) box(0.7, 1.6, 0.6, x, -drop + 0.8 + drop, STAGE.stageFrontZ - 0.2, lam(0x101010));

  // ---------- 객석 공간 ----------
  const audZ0 = STAGE.stageFrontZ, audZ1 = STAGE.stageFrontZ - V.depth;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(V.width, V.depth), lam(0x1d1b20));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -drop, (audZ0 + audZ1) / 2);
  root.add(floor);
  // 시나리오별 꾸미기 (야외 페스티벌이면 벽과 천장 없음)
  out.theme = decorate(scene, root, level, { width: V.width, height: V.height, drop, audZ0, audZ1, curtainZ: STAGE.curtainZ, stageFrontZ: STAGE.stageFrontZ, stageWidth: STAGE.stageWidth });
  const hallMat = lam(V.wall, { side: THREE.BackSide });
  const hallH = V.height + drop;
  const hall = new THREE.Mesh(new THREE.BoxGeometry(V.width, hallH, V.depth + stageDepth + 0.2), hallMat);
  hall.position.set(0, -drop + hallH / 2, (audZ1 + STAGE.curtainZ) / 2);
  if (!out.theme.outdoor) root.add(hall);
  // 출입문 빛 (늦게 들어온 관객이 나오는 곳)
  out.doorPos = new THREE.Vector3(-V.width / 2 + 0.3, -drop, audZ1 + 1.5);
  box(0.05, 2.1, 1.0, -V.width / 2 + 0.03, -drop + 1.05, audZ1 + 1.5, new THREE.MeshBasicMaterial({ color: 0x3a6a3a }));
  // 비상구 표시
  box(0.4, 0.15, 0.02, -V.width / 2 + 0.05, -drop + 2.4, audZ1 + 1.5, new THREE.MeshBasicMaterial({ color: 0x20c060 })).rotation.y = Math.PI / 2;

  // ---------- 심사위원 (오디션) ----------
  let rowZ = STAGE.audienceStartZ;
  if (level.judges) {
    const tz = STAGE.stageFrontZ - 2.6;
    box(2.6, 0.75, 0.7, 0, -drop + 0.375, tz + 0.45, lam(0x3b2a1e));
    for (let i = 0; i < 3; i++) {
      const p = new Person({ tier: 'A', seated: true, row: 0 });
      p.root.position.set(-0.85 + i * 0.85, -drop, tz);
      p.watcher = true;
      p.judge = true;
      p.state = 'idle';
      root.add(p.root);
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.45, 0.46), lam(0x222222));
      chair.position.set(p.root.position.x, -drop + 0.22, tz - 0.05);
      root.add(chair);
      out.judges.push(p);
      out.people.push(p);
      // 종이와 펜
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.3), new THREE.MeshBasicMaterial({ color: 0xdedede }));
      paper.rotation.x = -Math.PI / 2; paper.position.set(p.root.position.x + 0.1, -drop + 0.755, tz + 0.35);
      root.add(paper);
    }
    rowZ = tz - 2.2;
  }

  // ---------- 관객 ----------
  const seated = level.id <= 2;
  const rowGap = seated ? 1.0 : 0.85;
  let rowIndex = 0;
  const placeRow = (n, tier) => {
    const span = Math.min(V.width - 1.2, n * 0.72);
    const rowPeople = [];
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1) + rand(-0.08, 0.08);
      const p = new Person({ tier, seated, row: rowIndex });
      p.root.position.set(x, -drop, rowZ + rand(-0.12, 0.12));
      p.root.rotation.y = rand(-0.12, 0.12);
      root.add(p.root);
      if (seated) {
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.45, 0.46), lam(0x2a2a2a));
        chair.position.set(x, -drop + 0.22, p.root.position.z - 0.05);
        root.add(chair);
      }
      out.people.push(p);
      if (tier === 'A') out.front.push(p);
      rowPeople.push(p);
      out.audiencePositions.push(p.root.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
    }
    rowPeople.forEach((p, i) => { p.neighbor = rowPeople[i + 1] || rowPeople[i - 1] || null; });
    rowZ -= rowGap;
    rowIndex++;
  };
  for (let r = 0; r < level.frontRows; r++) placeRow(level.frontPerRow, 'A');
  for (let r = 0; r < level.midRows; r++) placeRow(level.midPerRow, 'B');
  const mids = out.people.filter((p) => p.tier === 'B');
  if (mids.length) { out.instB = new InstancedPeople(mids); root.add(out.instB.bodies, out.instB.heads); }
  if (level.crowd > 0) {
    const area = { x0: -V.width / 2 + 1, x1: V.width / 2 - 1, z0: rowZ, z1: Math.max(audZ1 + 1, rowZ - 16), y: -drop };
    out.crowd = new Crowd(level.crowd, area);
    root.add(out.crowd.mesh);
    for (let i = 0; i < 8; i++) out.audiencePositions.push(new THREE.Vector3(rand(area.x0, area.x1), -drop + 1.3, rand(area.z1, area.z0)));
  }

  // ---------- 밴드 멤버 (사용자 뒤쪽 양옆) ----------
  if (level.band) {
    const drummer = new Person({ tier: 'A', seated: true });
    drummer.root.position.set(1.5, 0, STAGE.curtainZ - 0.9);
    drummer.root.rotation.y = Math.PI - 0.35;
    root.add(drummer.root);
    const kit = new THREE.Group();
    const drum = (r, h, x, y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), lam(0x7a1010)); m.position.set(x, y, z); kit.add(m); };
    drum(0.28, 0.4, 0, 0.3, -0.45); drum(0.17, 0.15, -0.3, 0.65, -0.35); drum(0.17, 0.15, 0.3, 0.65, -0.35);
    const cym = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.01, 20), lam(0xc9a43a)); cym.position.set(-0.5, 1.1, -0.2); kit.add(cym);
    kit.position.copy(drummer.root.position); kit.rotation.y = drummer.root.rotation.y;
    root.add(kit);
    const bassist = new Person({ tier: 'A' });
    bassist.root.position.set(-1.6, 0, STAGE.curtainZ - 1.2);
    bassist.root.rotation.y = Math.PI + 0.4;
    root.add(bassist.root);
    const bass = new THREE.Mesh(merge([
      { geo: new THREE.BoxGeometry(0.32, 0.42, 0.06), color: 0x2a3f8f },
      { geo: new THREE.BoxGeometry(0.06, 0.7, 0.04), color: 0x5a3a20, matrix: new THREE.Matrix4().makeTranslation(0, 0.55, 0) },
    ]), new THREE.MeshLambertMaterial({ vertexColors: true }));
    bass.position.set(0.05, 1.05, 0.2); bass.rotation.z = -0.9;
    bassist.body.add(bass);
    for (const b of [drummer, bassist]) { b.watcher = false; b.member = true; out.band.push(b); out.people.push(b); }
    out.drummerPos = drummer.root.position.clone().add(new THREE.Vector3(0, 1, 0));
    out.bassPos = bassist.root.position.clone().add(new THREE.Vector3(0, 1, 0));
  } else {
    out.drummerPos = new THREE.Vector3(1.5, 1, STAGE.curtainZ - 0.9);
    out.bassPos = new THREE.Vector3(-1.6, 1, STAGE.curtainZ - 1.2);
  }

  // 관객이 딴 데를 볼 때 보는 곳 (무대 위 밴드 쪽)
  out.idleTarget = new THREE.Vector3(0, 1.4, STAGE.curtainZ - 0.5);
  return out;
}

export function makeCanvasPanel(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh };
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,245,220,0.7)');
  grd.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}
