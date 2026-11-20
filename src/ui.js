// 헤드셋 안의 안내 패널과 리포트 그래프
import * as THREE from 'three';
import { makeCanvasPanel } from './venue.js';
import { TUNING } from './config.js';

export class FloatingPanel {
  constructor(scene) {
    this.p = makeCanvasPanel(1024, 576);
    this.p.mesh.scale.set(1.2, 0.675, 1);
    this.p.mesh.material.depthTest = false;
    this.p.mesh.renderOrder = 10;
    this.p.mesh.visible = false;
    scene.add(this.p.mesh);
    this._target = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }
  show(title, lines = [], { footer = '' } = {}) {
    const { ctx, canvas } = this.p;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 36, 'rgba(20,18,40,0.88)');
    ctx.fillStyle = '#F2B544';
    ctx.font = '700 54px "Noto Sans KR", sans-serif';
    ctx.fillText(title, 60, 110);
    ctx.fillStyle = '#F4F2FB';
    ctx.font = '400 40px "Noto Sans KR", sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 60, 200 + i * 62));
    if (footer) {
      ctx.fillStyle = '#A8A3C8';
      ctx.font = '400 30px "Noto Sans KR", sans-serif';
      ctx.fillText(footer, 60, canvas.height - 50);
    }
    this.p.tex.needsUpdate = true;
    this.p.mesh.visible = true;
    this.p.mesh.scale.set(1.2, 0.675, 1);
    this._snap = true;
  }
  showCanvas(srcCanvas) {
    const { ctx, canvas } = this.p;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(srcCanvas, 0, 0, canvas.width, canvas.height);
    this.p.tex.needsUpdate = true;
    this.p.mesh.visible = true;
    this.p.mesh.scale.set(1.6, 0.9, 1);
    this._snap = true;
  }
  hide() { this.p.mesh.visible = false; }
  // 머리를 천천히 따라오는 패널
  update(camera, dt) {
    if (!this.p.mesh.visible) return;
    camera.getWorldPosition(this._target);
    camera.getWorldQuaternion(this._q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this._q);
    fwd.y = 0; fwd.normalize();
    const goal = this._target.clone().add(fwd.multiplyScalar(1.4));
    goal.y = this._target.y - 0.1;
    const k = this._snap ? 1 : Math.min(1, dt * 2);
    this._snap = false;
    this.p.mesh.position.lerp(goal, k);
    this.p.mesh.lookAt(this._target);
  }
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}

// 리포트: 심박 곡선(기준선 대비 %), 목표 구간, 실수 시점, 회복 시간, 시선 회피 비율
export function drawReport(canvas, data) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1E1B3A';
  ctx.font = '700 40px "Noto Sans KR", sans-serif';
  ctx.fillText(`공연 리포트 · ${data.scenario || ''}`, 40, 60);
  ctx.font = '400 22px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#6E6A8C';
  ctx.fillText(`Lv${data.level} ${data.levelName}${data.encore ? ' · 앵콜 받음' : ''} · ${data.hrSource}${data.mic ? ' · 악기 입력 사용' : ' · 실수는 수동 입력'}`, 40, 92);

  // 그래프 영역
  const gx = 60, gy = 120, gw = W * 0.62, gh = H - 190;
  const pts = data.hr.filter((p) => ['call', 'hush', 'perform', 'encore'].includes(p.phase));
  const t0 = pts.length ? pts[0].t : 0, t1 = pts.length ? pts[pts.length - 1].t : 1;
  const xr = (t) => gx + ((t - t0) / Math.max(1, t1 - t0)) * gw;
  const ymin = -0.2, ymax = 0.8;
  const yr = (r) => gy + gh - ((r - ymin) / (ymax - ymin)) * gh;
  // 목표 구간 +20–40%
  ctx.fillStyle = 'rgba(108,92,231,0.12)';
  ctx.fillRect(gx, yr(TUNING.targetHigh), gw, yr(TUNING.targetLow) - yr(TUNING.targetHigh));
  ctx.strokeStyle = '#E1DEF2'; ctx.lineWidth = 1;
  ctx.font = '400 18px "Noto Sans KR", sans-serif'; ctx.fillStyle = '#8A86A6';
  for (const r of [0, 0.2, 0.4, 0.6]) {
    ctx.beginPath(); ctx.moveTo(gx, yr(r)); ctx.lineTo(gx + gw, yr(r)); ctx.stroke();
    ctx.fillText(`${r >= 0 ? '+' : ''}${Math.round(r * 100)}%`, gx - 52, yr(r) + 6);
  }
  ctx.fillStyle = '#6C5CE7'; ctx.fillText('목표 구간 +20–40%', gx + 8, yr(TUNING.targetHigh) - 6);
  // 실수 시점
  ctx.strokeStyle = '#E8A33D'; ctx.lineWidth = 2;
  for (const m of data.mistakes) {
    if (m < t0) continue;
    ctx.beginPath(); ctx.moveTo(xr(m), gy); ctx.lineTo(xr(m), gy + gh); ctx.stroke();
  }
  // 심박 곡선
  ctx.strokeStyle = '#1E1B3A'; ctx.lineWidth = 3; ctx.beginPath();
  pts.forEach((p, i) => { const x = xr(p.t), y = yr(p.ratio); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.fillStyle = '#8A86A6';
  ctx.fillText('심박 (기준선 대비)   │ 주황선 = 실수', gx, gy + gh + 34);

  // 오른쪽 수치
  const rx = gx + gw + 60;
  const stat = (label, value, y) => {
    ctx.fillStyle = '#6C5CE7'; ctx.font = '700 20px "Noto Sans KR", sans-serif'; ctx.fillText(label, rx, y);
    ctx.fillStyle = '#1E1B3A'; ctx.font = '900 38px "Noto Sans KR", sans-serif'; ctx.fillText(value, rx, y + 44);
  };
  const avgRecovery = data.recoveries.length ? `${(data.recoveries.reduce((a, b) => a + b, 0) / data.recoveries.length).toFixed(1)}초` : '–';
  stat('최고 심박', `+${Math.round(data.peakRatio * 100)}%`, 150);
  stat('실수', `${data.mistakes.length}회`, 240);
  stat('평균 회복 시간', avgRecovery, 330);
  stat('시선 회피', `${Math.round(data.gazeAvoidRatio * 100)}%`, 420);
  stat('눈맞춤', `${data.eyeContacts}회`, 510);
  stat('조절 엔진', `${data.director.length}번 조정`, 600);
}
