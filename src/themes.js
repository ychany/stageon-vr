// 시나리오별 공연장 꾸미기: 같은 무대라도 장소다워야 “진짜 그곳에 서 있다”는 착각이 생긴다
// (몰입감 Vividness, Presence의 Stable Spatial Place).
// 움직이지 않는 장식은 merge()로 한 덩어리로 합쳐 그리기 호출 수를 줄인다.
import * as THREE from 'three';
import { merge } from './figures.js?v=202611261218';

const R = (a, b) => a + Math.random() * (b - a);
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const vtx = () => new THREE.MeshLambertMaterial({ vertexColors: true });
const glowMat = () => new THREE.MeshBasicMaterial({ vertexColors: true });

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function sign(text, color, w = 1.6, h = 0.5, font = 'bold 120px sans-serif') {
  const tex = canvasTex(512, 160, (g, W, H) => {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 30; g.fillStyle = color;
    g.fillText(text, W / 2, H / 2); g.fillText(text, W / 2, H / 2);
    g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.globalAlpha = 0.8; g.fillText(text, W / 2, H / 2);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
}
function poster(hue) {
  const tex = canvasTex(256, 360, (g, W, H) => {
    g.fillStyle = `hsl(${hue},55%,35%)`; g.fillRect(0, 0, W, H);
    g.fillStyle = `hsl(${(hue + 40) % 360},80%,65%)`; g.beginPath(); g.arc(W / 2, H * 0.42, 70, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center';
    g.fillText(['LIVE', 'TOUR', 'ROCK', 'JAZZ', 'INDIE'][hue % 5], W / 2, H * 0.8);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshLambertMaterial({ map: tex }));
}

// d: { width, height, drop, audZ0, audZ1, curtainZ, stageFrontZ, stageWidth }
export function decorate(scene, root, level, d) {
  const T = { update: () => {}, outdoor: false };
  const W = d.width, Hh = d.height, y0 = -d.drop, zMid = (d.audZ0 + d.audZ1) / 2;
  const box = (w, h, dp) => new THREE.BoxGeometry(w, h, dp);
  const cyl = (r1, r2, h, s = 12) => new THREE.CylinderGeometry(r1, r2, h, s);

  if (level.id === 1) {
    // 연습실: 방음 스펀지 벽, 형광등, 앰프·케이블, 러그
    const parts = [];
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
      parts.push({ geo: box(0.08, 0.45, 0.45), color: (i + j) % 2 ? 0x2c2f3a : 0x343846, matrix: M(side * (W / 2 - 0.05), y0 + 0.5 + j * 0.5, d.audZ0 - 0.4 - i * 0.5) });
    }
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) parts.push({ geo: box(0.45, 0.45, 0.08), color: (i + j) % 2 ? 0x2c2f3a : 0x343846, matrix: M(-1.4 + i * 0.5 + 0.1, y0 + 0.5 + j * 0.5, d.audZ1 + 0.05) });
    parts.push({ geo: box(2.4, 0.02, 1.6), color: 0x5a2f2f, matrix: M(0, y0 + 0.01, d.audZ0 - 1.4) });
    parts.push({ geo: box(0.7, 0.6, 0.35), color: 0x151515, matrix: M(-W / 2 + 0.8, y0 + 0.3, d.audZ0 - 0.4) });
    parts.push({ geo: box(0.55, 0.45, 0.3), color: 0x202020, matrix: M(W / 2 - 0.9, y0 + 0.22, d.audZ0 - 0.3) });
    parts.push({ geo: cyl(0.25, 0.25, 0.04, 20), color: 0x111111, matrix: M(W / 2 - 0.9, y0 + 0.47, d.audZ0 - 0.3) });
    for (let i = 0; i < 4; i++) parts.push({ geo: cyl(0.008, 0.008, 1.2, 4), color: 0x050505, matrix: M(R(-1, 1), y0 + 0.01, d.audZ0 - R(0.2, 1), Math.PI / 2, R(0, 3), 0) });
    root.add(new THREE.Mesh(merge(parts), vtx()));
    const lamps = [];
    for (let i = 0; i < 3; i++) lamps.push({ geo: box(1.2, 0.04, 0.12), color: 0xe8f4ff, matrix: M(0, y0 + Hh - 0.05, d.audZ0 - 0.8 - i * 1.6) });
    root.add(new THREE.Mesh(merge(lamps), glowMat()));
    const fl = new THREE.PointLight(0xdfefff, 6, 9, 1.2); fl.position.set(0, y0 + Hh - 0.3, zMid); root.add(fl);
  }

  if (level.id === 2) {
    // 카페: 나무 바닥, 작은 테이블과 커피잔, 전구 줄 조명, 바 카운터와 에스프레소 머신, 창밖 밤거리
    const parts = [{ geo: box(W, 0.01, d.audZ0 - d.audZ1), color: 0x6b4a2e, matrix: M(0, y0 + 0.015, zMid) }];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
      const x = -3 + i * 2 + (r % 2) * 0.8, z = d.audZ0 - 0.55 - r * 1.0;
      parts.push({ geo: cyl(0.3, 0.3, 0.03, 16), color: 0x8a6440, matrix: M(x, y0 + 0.72, z) });
      parts.push({ geo: cyl(0.03, 0.05, 0.72, 8), color: 0x2a2a2a, matrix: M(x, y0 + 0.36, z) });
      parts.push({ geo: cyl(0.04, 0.035, 0.08, 10), color: 0xf2efe6, matrix: M(x + 0.1, y0 + 0.78, z) });
    }
    parts.push({ geo: box(3.4, 1.05, 0.6), color: 0x4a3020, matrix: M(-W / 2 + 2.2, y0 + 0.52, d.audZ1 + 0.6) });
    parts.push({ geo: box(3.5, 0.05, 0.7), color: 0x2a1d14, matrix: M(-W / 2 + 2.2, y0 + 1.07, d.audZ1 + 0.6) });
    parts.push({ geo: box(0.5, 0.45, 0.4), color: 0xb0b0b0, matrix: M(-W / 2 + 1.2, y0 + 1.32, d.audZ1 + 0.55) });
    parts.push({ geo: box(2.6, 0.9, 0.05), color: 0x3b2a1c, matrix: M(-W / 2 + 2.2, y0 + 2.0, d.audZ1 + 0.03) });
    for (let i = 0; i < 8; i++) parts.push({ geo: box(0.12, 0.2, 0.08), color: [0x8b3a3a, 0x3a6b3a, 0xc9a43a, 0x3a4a8b][i % 4], matrix: M(-W / 2 + 1.1 + i * 0.3, y0 + 2.0, d.audZ1 + 0.08) });
    root.add(new THREE.Mesh(merge(parts), vtx()));
    // 창밖 밤거리
    const win = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.6), new THREE.MeshBasicMaterial({ map: canvasTex(512, 200, (g, w, h) => {
      g.fillStyle = '#0b1530'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 18; i++) { g.fillStyle = '#141c2e'; const bw = R(20, 50), bh = R(60, 180); g.fillRect(i * 30, h - bh, bw, bh); }
      for (let i = 0; i < 120; i++) { g.fillStyle = Math.random() < 0.5 ? '#ffd27a' : '#9ec5ff'; g.fillRect(R(0, w), R(40, h), 3, 4); }
      g.strokeStyle = '#2a2018'; g.lineWidth = 8; g.strokeRect(0, 0, w, h); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    }) }));
    win.position.set(W / 2 - 0.02, y0 + 1.6, zMid); win.rotation.y = -Math.PI / 2;
    root.add(win);
    // 전구 줄
    const bulbs = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i <= 14; i++) {
      const x = -W / 2 + 0.3 + i * (W - 0.6) / 14, sag = Math.sin((i / 14) * Math.PI) * 0.35;
      bulbs.push({ geo: new THREE.SphereGeometry(0.03, 6, 5), color: 0xffd38a, matrix: M(x, y0 + Hh - 0.25 - sag, d.audZ0 - 0.5 - k * 2.4) });
    }
    root.add(new THREE.Mesh(merge(bulbs), glowMat()));
    const l = new THREE.PointLight(0xffc27a, 8, 10, 1.2); l.position.set(0, y0 + Hh - 0.6, d.audZ0 - 2.5); root.add(l);
  }

  if (level.id === 3) {
    // 라이브 클럽: 네온 사인, 바, 포스터, 움직이는 색 조명, 연기
    const parts = [];
    parts.push({ geo: box(5, 1.1, 0.7), color: 0x1a1a22, matrix: M(0, y0 + 0.55, d.audZ1 + 0.5) });
    parts.push({ geo: box(5.2, 0.05, 0.8), color: 0x3a2a1a, matrix: M(0, y0 + 1.12, d.audZ1 + 0.5) });
    for (let i = 0; i < 16; i++) parts.push({ geo: cyl(0.03, 0.035, 0.28, 8), color: [0x2e6b3a, 0x8a5a20, 0x6b2e2e, 0xc0c0c0][i % 4], matrix: M(-2.2 + i * 0.29, y0 + 1.95, d.audZ1 + 0.12) });
    parts.push({ geo: box(5, 0.04, 0.25), color: 0x2a2a2a, matrix: M(0, y0 + 1.8, d.audZ1 + 0.13) });
    for (let i = 0; i < 6; i++) parts.push({ geo: box(0.08, 0.08, 2.2), color: 0x222222, matrix: M(-W / 2 + 1 + i * (W - 2) / 5, y0 + Hh - 0.2, d.stageFrontZ - 1) });
    root.add(new THREE.Mesh(merge(parts), vtx()));
    const neon = sign('LIVE', '#ff2fb0', 2.2, 0.7); neon.position.set(0, y0 + Hh - 1.2, d.audZ1 + 0.04); root.add(neon);
    const neon2 = sign('BAR', '#29e3ff', 1.2, 0.4); neon2.position.set(0, y0 + 2.4, d.audZ1 + 0.06); root.add(neon2);
    for (let i = 0; i < 8; i++) {
      const p = poster(i * 47);
      const side = i < 4 ? -1 : 1;
      p.position.set(side * (W / 2 - 0.02), y0 + 1.7 + (i % 2) * 0.1, d.audZ0 - 1.5 - (i % 4) * 2.2);
      p.rotation.y = side * -Math.PI / 2;
      root.add(p);
    }
    scene.fog = new THREE.FogExp2(0x140a1e, 0.035);
    // (성능) 움직이는 조명은 실제 광원 대신 빛줄기 메시 + 색이 바뀌는 광원 하나로 표현
    const beamGeo = new THREE.ConeGeometry(0.9, 9, 20, 1, true); beamGeo.translate(0, -4.5, 0);
    const movers = [0xff3fa8, 0x3fb8ff, 0xa04bff].map((c, i) => {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(-3 + i * 3, y0 + Hh - 0.3, d.stageFrontZ - 0.5);
      root.add(m);
      return m;
    });
    const tint = new THREE.PointLight(0xff3fa8, 10, 14, 1.2); tint.position.set(0, y0 + Hh - 1, zMid); root.add(tint);
    const cols = [new THREE.Color(0xff3fa8), new THREE.Color(0x3fb8ff), new THREE.Color(0xa04bff)];
    T.update = (dt, t) => {
      movers.forEach((m, i) => m.rotation.set(Math.sin(t * 0.5 + i * 2) * 0.6 - 0.3, 0, Math.cos(t * 0.4 + i) * 0.7));
      const k = (t * 0.25) % 3, a = Math.floor(k), f = k - a;
      tint.color.copy(cols[a]).lerp(cols[(a + 1) % 3], f);
    };
  }

  if (level.id === 4) {
    // 입시 실기: 밝고 하얀 강당, 천장 조명 패널, 벽시계, 수험번호
    const lamps = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) lamps.push({ geo: box(1.0, 0.03, 1.0), color: 0xf6f8ff, matrix: M(-3 + j * 3, y0 + Hh - 0.03, d.audZ0 - 1.5 - i * 3.5) });
    root.add(new THREE.Mesh(merge(lamps), glowMat()));
    const l = new THREE.PointLight(0xf4f6ff, 10, 18, 1.0); l.position.set(0, y0 + Hh - 0.5, d.audZ0 - 3); root.add(l);
    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), new THREE.MeshBasicMaterial({ map: canvasTex(256, 256, (g) => {
      g.fillStyle = '#fafafa'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
      g.strokeStyle = '#222'; g.lineWidth = 8; g.stroke();
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillStyle = '#222'; g.fillRect(128 + Math.sin(a) * 100 - 3, 128 - Math.cos(a) * 100 - 8, 6, 16); }
      g.lineWidth = 7; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 50, 128 - 30); g.stroke();
      g.lineWidth = 4; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 - 10, 128 - 90); g.stroke();
    }) }));
    clock.position.set(0, y0 + Hh - 1.4, d.audZ1 + 0.03); root.add(clock);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.6), new THREE.MeshBasicMaterial({ map: canvasTex(1024, 154, (g, w, h) => {
      g.fillStyle = '#1e2a4a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('2027학년도 실용음악과 실기고사', w / 2, h / 2);
    }) }));
    banner.position.set(0, y0 + Hh - 0.6, d.audZ1 + 0.03); root.add(banner);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ map: canvasTex(256, 192, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('17', w / 2, h / 2 + 6);
    }) }));
    num.rotation.x = -Math.PI / 2; num.position.set(0.55, 0.008, -2.2); root.add(num);
  }

  if (level.id === 5) {
    // 야외 페스티벌: 밤하늘, 조명 트러스, 양옆 대형 스크린, 객석 위 응원봉 불빛
    T.outdoor = true;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, map: canvasTex(1024, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#03040c'); gr.addColorStop(0.45, '#0c1030'); gr.addColorStop(0.55, '#2a1a3a'); gr.addColorStop(1, '#05050a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(255,255,255,${R(0.2, 0.9)})`; g.fillRect(R(0, w), R(0, h * 0.45), 1.5, 1.5); }
    }) }));
    root.add(sky);
    scene.fog = new THREE.FogExp2(0x0a0818, 0.02);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ color: 0x14140f }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, y0 - 0.05, zMid); root.add(ground);
    const truss = [];
    const tw = d.stageWidth + 3, th = 8;
    for (const x of [-tw / 2, tw / 2]) for (let k = 0; k < 4; k++) truss.push({ geo: cyl(0.04, 0.04, th, 6), color: 0x9a9a9a, matrix: M(x + (k % 2 ? 0.25 : -0.25), y0 + th / 2, d.stageFrontZ + (k < 2 ? 0.2 : 3.2)) });
    for (let k = 0; k < 4; k++) truss.push({ geo: cyl(0.04, 0.04, tw, 6), color: 0x9a9a9a, matrix: M(0, y0 + th - (k % 2) * 0.4, d.stageFrontZ + (k < 2 ? 0.2 : 3.2), 0, 0, Math.PI / 2) });
    for (let i = 0; i < 8; i++) truss.push({ geo: cyl(0.12, 0.1, 0.3, 10), color: 0x222222, matrix: M(-tw / 2 + 0.6 + i * (tw - 1.2) / 7, y0 + th - 0.6, d.stageFrontZ + 0.2) });
    for (const x of [-tw / 2 - 2.6, tw / 2 + 2.6]) truss.push({ geo: box(0.3, 4.5, 0.3), color: 0x202020, matrix: M(x, y0 + 2.25, d.stageFrontZ + 0.5) });
    root.add(new THREE.Mesh(merge(truss), vtx()));
    // 대형 스크린: 무대 위 내 모습 대신 색이 흐르는 화면
    const screens = [-1, 1].map((s) => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 144;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.25), new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(s * (tw / 2 + 2.6), y0 + 5.6, d.stageFrontZ + 0.35);
      root.add(m);
      return { c, tex };
    });
    // 응원봉: 객석 위에서 흔들리는 불빛 (하나의 InstancedMesh)
    const n = 160;
    const sticks = new THREE.InstancedMesh(cyl(0.015, 0.015, 0.22, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const base = [];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      base.push({ x: R(-W / 2 + 1.5, W / 2 - 1.5), z: R(d.audZ0 - 2, d.audZ0 - 20), ph: R(0, 6) });
      col.setHSL([0.55, 0.85, 0.15][i % 3], 0.9, 0.6); sticks.setColorAt(i, col);
    }
    root.add(sticks);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let lastScreen = 0;
    T.update = (dt, t) => {
      for (let i = 0; i < n; i++) {
        const b = base[i];
        e.set(0, 0, Math.sin(t * 2.2 + b.ph) * 0.6); q.setFromEuler(e);
        v.set(b.x, y0 + 2.0 + Math.sin(t * 2.2 + b.ph) * 0.05, b.z);
        sticks.setMatrixAt(i, m4.compose(v, q, one));
      }
      sticks.instanceMatrix.needsUpdate = true;
      if (t - lastScreen > 0.1) {
        lastScreen = t;
        screens.forEach(({ c, tex }, k) => {
          const g = c.getContext('2d');
          const gr = g.createLinearGradient(0, 0, c.width, c.height);
          gr.addColorStop(0, `hsl(${(t * 40 + k * 120) % 360},80%,45%)`); gr.addColorStop(1, `hsl(${(t * 40 + 180) % 360},80%,25%)`);
          g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
          g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('SUMMER FEST', c.width / 2, c.height / 2 + 12);
          tex.needsUpdate = true;
        });
      }
    };
  }
  return T;
}
