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
