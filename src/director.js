// 불안 조절 엔진(Stressor Director)과 측정 로직.
// 브라우저 API를 쓰지 않는 순수 로직이라 node 테스트로 검증한다.

export class MovingAverage {
  constructor(windowSec) {
    this.windowSec = windowSec;
    this.samples = [];
  }
  push(t, v) {
    this.samples.push([t, v]);
    const cut = t - this.windowSec;
    while (this.samples.length && this.samples[0][0] < cut) this.samples.shift();
  }
  get value() {
    if (!this.samples.length) return NaN;
    let s = 0;
    for (const [, v] of this.samples) s += v;
    return s / this.samples.length;
  }
}

// Bluetooth Heart Rate Measurement(0x2A37) 파싱. flags bit0 = 1 이면 uint16.
export function parseHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  return (flags & 0x01) ? dataView.getUint16(1, true) : dataView.getUint8(1);
}

// 연주 시점 t가 박자 격자에서 얼마나 어긋났는지(초). 격자는 gridStart부터 beatSec / subdiv 간격.
export function timingError(t, gridStart, beatSec, subdiv = 4) {
  const step = beatSec / subdiv;
  const k = Math.round((t - gridStart) / step);
  return t - (gridStart + k * step);
}

// 연속된 어긋난 음을 실수로 판단 (오탐을 줄이기 위해 한 마디 안에서 2번 이상)
export class TimingJudge {
  constructor({ thresholdSec = 0.05, needed = 2, windowSec = 2.4 } = {}) {
    this.thresholdSec = thresholdSec;
    this.needed = needed;
    this.windowSec = windowSec;
    this.offTimes = [];
    this.lastMistake = -Infinity;
  }
  onset(t, gridStart, beatSec) {
    const err = timingError(t, gridStart, beatSec, 4);
    if (Math.abs(err) < this.thresholdSec) return { err, mistake: false };
    this.offTimes.push(t);
    this.offTimes = this.offTimes.filter((x) => t - x <= this.windowSec);
    if (this.offTimes.length >= this.needed && t - this.lastMistake > this.windowSec) {
      this.lastMistake = t;
      this.offTimes = [];
      return { err, mistake: true };
    }
    return { err, mistake: false };
  }
}

// 단계에서 켤 수 있는 불안 장치 순서. 목표 구간보다 낮으면 앞에서부터 하나씩 켠다.
export const STRESSOR_LADDER = ['moreGaze', 'phones', 'judgeNotes', 'memberLook', 'events', 'heartbeat'];

export class StressorDirector {
  constructor(level, tuning) {
    this.level = level;
    this.t = tuning;
    this.intensity = 0;          // 켜진 추가 장치 수
    this.calm = false;           // 과부하 완화 모드
    this.belowSince = null;
    this.overSince = null;
    this.log = [];
  }

  get active() {
    return STRESSOR_LADDER.slice(0, this.intensity);
  }

  // 현재 단계 + 추가 장치 + 완화 모드를 반영한 실제 파라미터
  params() {
    const L = this.level;
    const on = new Set(this.active);
    const calm = this.calm;
    return {
      gazeRatio: calm ? Math.max(0.3, L.gazeRatio - 0.25) : Math.min(0.92, L.gazeRatio + (on.has('moreGaze') ? 0.15 : 0)),
      reaction: calm ? L.reaction * 0.4 : Math.min(1, L.reaction * (1 + 0.1 * this.intensity)),
      phones: calm ? 0 : L.phones + (on.has('phones') ? 3 : 0),
      judgeNotes: !calm && (L.judges || on.has('judgeNotes')),
      memberLook: !calm && (L.band && (L.reaction >= 0.6 || on.has('memberLook'))),
      eventsPerSong: calm ? 0 : L.eventsPerSong + (on.has('events') ? 1 : 0),
      heartbeat: !calm && (L.heartbeat || on.has('heartbeat')),
      friendly: calm || L.mood === 'friendly',
      houseLight: calm ? Math.max(0.4, L.venue.houseLight * 3) : L.venue.houseLight,
    };
  }

  // ratio = (15초 평균 심박 / 기준선) - 1
  update(now, ratio, suds = null) {
    const T = this.t;
    if (!Number.isFinite(ratio)) return null;
    let action = null;

    const overloaded = ratio >= T.overloadRatio || (suds !== null && suds >= T.sudsOverload);
    if (overloaded) {
      if (this.overSince === null) this.overSince = now;
      const sudsTrigger = suds !== null && suds >= T.sudsOverload;
      if (!this.calm && (sudsTrigger || now - this.overSince >= T.overloadHold)) {
        this.calm = true;
        this.intensity = Math.max(0, this.intensity - 1);
        action = { type: 'calm', reason: sudsTrigger ? `SUDs ${suds}` : `심박 +${Math.round(ratio * 100)}% ${T.overloadHold}초 지속` };
      }
    } else {
      this.overSince = null;
    }

    if (this.calm && ratio <= T.targetHigh && !overloaded) {
      this.calm = false;
      action = { type: 'resume', reason: `심박 +${Math.round(ratio * 100)}%로 안정` };
    }

    if (!this.calm && ratio < T.targetLow) {
      if (this.belowSince === null) this.belowSince = now;
      if (now - this.belowSince >= T.underloadHold && this.intensity < STRESSOR_LADDER.length) {
        this.intensity += 1;
        this.belowSince = now;
        action = { type: 'raise', stressor: STRESSOR_LADDER[this.intensity - 1], reason: `심박 +${Math.round(ratio * 100)}% < 목표 ${Math.round(T.targetLow * 100)}%` };
      }
    } else {
      this.belowSince = null;
    }

    if (action) this.log.push({ t: now, ...action, intensity: this.intensity });
    return action;
  }
}

// 실수 후 회복 시간 측정: 실수 직전 심박 수준(+5%p 이내)으로 돌아와 4마디 동안 실수 없이 이어가면 회복.
// (처음 설계는 '기준선 +10% 이내'였지만, 무대 위 목표 구간이 +20–40%라 무대에서는 회복이 거의 판정되지
//  않는 문제가 AI 시뮬레이션에서 드러나 실수 직전 수준을 기준으로 바꿨다.)
export class RecoveryTracker {
  constructor(tuning, barSec) {
    this.t = tuning;
    this.barSec = barSec;
    this.pendingSince = null;  // 첫 실수 시각
    this.stableSince = null;
    this.pre = null;           // 실수 직전 심박 비율
    this.recoveries = [];      // 회복까지 걸린 시간(초)
  }
  onMistake(now, ratioNow = 0) {
    if (this.pendingSince === null) { this.pendingSince = now; this.pre = Number.isFinite(ratioNow) ? ratioNow : 0; }
    this.stableSince = null;
    this.lastMistake = now;
  }
  update(now, ratio) {
    if (this.pendingSince === null) return null;
    const ok = ratio <= this.pre + this.t.recoveryMargin;
    if (!ok) { this.stableSince = null; return null; }
    if (this.stableSince === null) this.stableSince = Math.max(now, this.lastMistake);
    if (now - this.stableSince >= this.t.recoveryBars * this.barSec) {
      const dur = now - this.pendingSince;
      this.recoveries.push(dur);
      this.pendingSince = null;
      this.stableSince = null;
      return dur;
    }
    return null;
  }
}

// 반응 지연: 0.3–1.5초, 앞줄부터 뒤로 퍼짐 (rand는 0~1)
export function reactionDelay(row, rand, tuning) {
  const span = tuning.reactionDelayMax - tuning.reactionDelayMin;
  const rowPart = Math.min(1, row * 0.12) * 0.6;
  const randPart = rand * 0.4;
  return tuning.reactionDelayMin + span * Math.min(1, rowPart + randPart);
}

// ---------- 관객 행동 고르기 ----------
// weights: { film: 2, whisper: 1, ... }, enabled: 켜진 행동 이름 Set, r: 0–1 난수
export function pickBehavior(weights, enabled, r = Math.random()) {
  const list = Object.entries(weights).filter(([k, w]) => w > 0 && enabled.has(k));
  const total = list.reduce((a, [, w]) => a + w, 0);
  if (!total) return null;
  let x = r * total;
  for (const [k, w] of list) { if (x < w) return k; x -= w; }
  return list[list.length - 1][0];
}
// 다음 관객 행동까지의 간격(초): 단계의 분당 횟수 × 조절 엔진 강도, 완화 모드면 절반
export function behaviorGap(perMin, intensity = 0, calm = false, r = Math.random()) {
  if (!perMin) return Infinity;
  const rate = perMin * (1 + 0.25 * intensity) * (calm ? 0.5 : 1);
  return (60 / rate) * (0.5 + r);
}

// ---------- 단계별 노출 훈련: 다음 회차 추천 ----------
// 노출 치료의 원칙: 불안이 충분히 내려갈 때까지 같은 단계를 반복하고(습관화), 내려가면 한 단계 올린다.
// 견디기 힘든 수준이면 한 단계 내린다.
export function recommendNext({ level, meanRatio, peakRatio, suds, prevSuds = null, maxLevel = 5 }, T) {
  const reasons = [];
  const r = Number.isFinite(meanRatio) ? meanRatio : null;
  const s = Number.isFinite(suds) ? suds : null;
  if ((s !== null && s >= T.sudsOverload) || (r !== null && r >= T.overloadRatio && peakRatio >= T.overloadRatio)) {
    if (s !== null && s >= T.sudsOverload) reasons.push(`불안 점수 ${s}점 (견디기 힘든 수준 ${T.sudsOverload}점 이상)`);
    if (r !== null && r >= T.overloadRatio) reasons.push(`연주 중 평균 심박 +${Math.round(r * 100)}% (과부하 +${Math.round(T.overloadRatio * 100)}% 이상)`);
    const next = Math.max(1, level - 1);
    reasons.push(next < level ? '한 단계 낮춰 성공 경험을 먼저 쌓고, 회복 도우미를 켜 보세요.' : '가장 낮은 단계입니다. 회복 도우미를 켜고 다시 해 보세요.');
    return { action: next < level ? 'down' : 'stay', level: next, helper: true, reasons };
  }
  const habituated = s !== null && prevSuds !== null && prevSuds - s >= 2;
  const easy = s !== null && s <= 3 && (r === null || r < T.targetLow);
  if ((easy || (habituated && s <= 5)) && level < maxLevel) {
    if (easy) reasons.push(`불안 점수 ${s}점, 심박 ${r === null ? '기록 없음' : `+${Math.round(r * 100)}%`} — 이 단계는 충분히 익숙해졌습니다.`);
    if (habituated) reasons.push(`지난 회차 ${prevSuds}점 → 이번 ${s}점으로 2점 이상 줄었습니다 (습관화).`);
    reasons.push('한 단계 올려 새로운 관객 앞에 서 보세요.');
    return { action: 'up', level: level + 1, helper: false, reasons };
  }
  if ((easy || habituated) && level >= maxLevel) {
    reasons.push('가장 높은 단계까지 익숙해졌습니다. 이제 실제 무대(측정 전용: 실제 관객 앞)에 도전해 보세요.');
    return { action: 'real', level, helper: false, reasons };
  }
  if (s !== null) reasons.push(`불안 점수 ${s}점${prevSuds !== null ? ` (지난 회차 ${prevSuds}점)` : ''}`);
  if (r !== null) reasons.push(`연주 중 평균 심박 ${r >= 0 ? '+' : ''}${Math.round(r * 100)}%`);
  reasons.push('불안이 2점 이상 줄어들 때까지 같은 단계를 반복하세요 (습관화).');
  return { action: 'stay', level, helper: false, reasons };
}

// ---------- CSV ----------
// 엑셀에서 한글이 깨지지 않도록 BOM을 붙이고, 쉼표·따옴표·줄바꿈이 있는 값은 따옴표로 감싼다
export function toCSV(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
    const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label || c.key)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}
