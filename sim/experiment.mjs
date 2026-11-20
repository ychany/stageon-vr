// StageOn AI 시뮬레이션 실험 (가상 참가자)
//
// ※ 실제 사람의 데이터가 아니다. 아래 "가정"에 적은 참가자 모델로 만든 가상 참가자가
//   StageOn의 실제 로직(불안 조절 엔진, 반응 지연, 회복 판정)을 거쳐 연주하는 것을 계산한다.
//   목적은 ① 실험 절차와 분석 방법이 제대로 돌아가는지 확인하고, ② 조절 엔진이 의도대로
//   심박을 목표 구간에 머물게 하는지 보는 것이다. 결과의 수치는 가정에 따라 달라진다.
//
// 실행: node sim/experiment.mjs [참가자 수=30] [시드=42]
import { writeFileSync, mkdirSync } from 'node:fs';
import { LEVELS, TUNING } from '../src/config.js';
import { StressorDirector, RecoveryTracker, MovingAverage } from '../src/director.js';

const N = Number(process.argv[2] || 30);
let seed = Number(process.argv[3] || 42);
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const normal = (m, s) => { const u = 1 - rnd(), v = rnd(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------- 가정 (참가자 모델) ----------
// 단서별 기본 민감도: 평가·통제 불가가 가장 큰 스트레스를 만든다는 메타분석(Dickerson & Kemeny, 2004)을
// 반영해 E2(평가)와 E4(통제 불가)를 크게, E1(시선)·E3(실수 반응)을 중간, E5(심박 되비추기)를 작게 둔다.
const CUE_WEIGHT = { gaze: 0.10, eval: 0.16, mistake: 0.12, events: 0.13, body: 0.06 };
const CUES = Object.keys(CUE_WEIGHT);
const ASSUMPTIONS = {
  '연주 동작에 의한 심박 증가 (모든 조건)': '+8%',
  '단서별 기본 민감도 (심박 증가 비율)': CUE_WEIGHT,
  '불안 특성(trait)': '평균 1.0, 표준편차 0.3 (곱셈 계수)',
  'VR 실재감 계수 (가상 관객이 실제 관객만큼 위협적으로 느껴지는 정도)': '참가자마다 0.65–0.95 균등분포',
  '실수 확률': '마디당 4% × (1 + 각성도), 실수 시 일시적 심박 +6%p',
  '반복 노출 적응': '회차마다 새로움 효과 15% 감소 (0.85^회차)',
  '심박 측정 잡음': '표준편차 2 bpm',
};

function makeParticipant(id) {
  const w = {};
  for (const c of CUES) w[c] = CUE_WEIGHT[c] * Math.exp(normal(0, 0.25));
  return {
    id,
    rest: clamp(normal(72, 7), 55, 95),
    trait: clamp(normal(1.0, 0.3), 0.4, 1.8),
    presence: 0.65 + rnd() * 0.3,
    w,
  };
}

// 한 번의 공연(초 단위)을 계산한다
// condition: 'practice' | 'vr' | 'real'   cuesOn: 켜진 단서   session: 회차(1부터)   adaptive: 조절 엔진 사용 여부
function perform(p, { condition, cuesOn = CUES, session = 1, adaptive = true, level = LEVELS[3] }) {
  const barSec = (60 / TUNING.bpm) * 4;
  const songSec = 18 * barSec;
  const director = new StressorDirector(level, TUNING);
  const tracker = new RecoveryTracker(TUNING, barSec);
  const avg = new MovingAverage(TUNING.hrSmoothingSec);
  const baseline = p.rest * 1.08;                       // 연습실 연주 심박 = 기준선
  const novelty = Math.pow(0.85, session - 1);
  let arousal = 0, spike = 0, mistakes = 0;
  const series = [];
  for (let t = 0; t < songSec; t++) {
    let target = 0.08;                                   // 연주 동작
    if (condition !== 'practice') {
      const prm = adaptive ? director.params() : level && new StressorDirector(level, TUNING).params();
      // 각 단서의 강도 (조절 엔진 파라미터에서 계산, 0~1)
      const level01 = {
        gaze: prm.gazeRatio,
        eval: Math.min(1, prm.phones / 8 + (prm.judgeNotes ? 0.5 : 0)),
        mistake: prm.reaction,
        events: Math.min(1, prm.eventsPerSong / 3 + 0.3),
        body: prm.heartbeat ? 1 : 0,
      };
      const factor = condition === 'vr' ? p.presence : 1;
      let s = 0;
      for (const c of cuesOn) s += p.w[c] * level01[c];
      target += s * p.trait * factor * novelty * (prm.friendly ? 0.6 : 1);
    }
    // 실수
    if (t % Math.round(barSec) === 0 && rnd() < 0.04 * (1 + arousal * 2)) {
      mistakes++;
      if (condition !== 'practice') { tracker.onMistake(t, series.length ? series[series.length - 1] : 0); spike += 0.06 * p.trait; }
    }
    spike *= 0.9;
    arousal += (target - arousal) * (1 / 8);
    const hr = p.rest * (1 + arousal + spike) + normal(0, 2);
    avg.push(t, hr);
    const ratio = avg.value / baseline - 1;
    if (condition === 'vr' && adaptive) director.update(t, ratio, null);
    tracker.update(t, ratio);
    series.push(ratio);
  }
  const perf = series.slice(10);                        // 첫 10초(안정화) 제외
  const mean = perf.reduce((a, b) => a + b, 0) / perf.length;
  const inZone = perf.filter((r) => r >= TUNING.targetLow && r <= TUNING.targetHigh).length / perf.length;
  return {
    meanHR: baseline * (1 + mean), meanRatio: mean, inZone, mistakes,
    recoveries: tracker.recoveries, adjustments: director.log.length,
  };
}

// ---------- 실험 ----------
const people = Array.from({ length: N }, (_, i) => makeParticipant(i + 1));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const r2 = (x) => Math.round(x * 100) / 100;

// 실험 A: 불안 재현율 = (VR − 연습실) ÷ (실제 관객 − 연습실), 심박 기준
const A = people.map((p) => {
  const a = perform(p, { condition: 'practice' });
  const b = perform(p, { condition: 'vr' });
  const c = perform(p, { condition: 'real', adaptive: false });
  return { id: p.id, practice: a.meanHR, vr: b.meanHR, real: c.meanHR, rate: (b.meanHR - a.meanHR) / (c.meanHR - a.meanHR), vrInZone: b.inZone, adjustments: b.adjustments };
});
const rates = A.map((x) => x.rate);

// 실험 B: 단서별 기여도 = 모든 단서 켠 조건 대비, 한 단서를 껐을 때 평균 심박 증가 비율이 줄어든 양
// (조절 엔진이 빠진 단서를 다른 단서로 보충하지 않도록 고정 강도로 비교한다)
const full = people.map((p) => perform(p, { condition: 'vr', adaptive: false }).meanRatio);
const B = CUES.map((cue) => {
  const off = people.map((p) => perform(p, { condition: 'vr', adaptive: false, cuesOn: CUES.filter((c) => c !== cue) }).meanRatio);
  const drop = off.map((o, i) => full[i] - o);
  return { cue, meanDropPct: r2(mean(drop) * 100), sdPct: r2(sd(drop) * 100) };
});

// 실험 C: 같은 단계를 3회 반복할 때 심박 증가와 회복 시간
const C = [1, 2, 3].map((session) => {
  const runs = people.map((p) => perform(p, { condition: 'vr', session }));
  const rec = runs.flatMap((r) => r.recoveries);
  return { session, meanRatioPct: r2(mean(runs.map((r) => r.meanRatio)) * 100), meanRecoverySec: rec.length ? r2(mean(rec)) : null, recoveries: rec.length };
});

// 조절 엔진 효과: 엔진을 켰을 때와 껐을 때 목표 구간(+20–40%)에 머문 시간 비율
const zoneOn = mean(A.map((x) => x.vrInZone));
const zoneOff = mean(people.map((p) => perform(p, { condition: 'vr', adaptive: false }).inZone));

const label = { gaze: 'E1 시선', eval: 'E2 평가', mistake: 'E3 실수 반응', events: 'E4 예측 불가 사건', body: 'E5 심박 되비추기' };
const result = {
  note: 'AI 시뮬레이션(가상 참가자) 결과이며 실제 사람의 측정값이 아니다. 수치는 assumptions의 가정에 따라 달라진다.',
  participants: N, seed: Number(process.argv[3] || 42), scenario: '밴드 첫 클럽 공연 (Lv3)', assumptions: ASSUMPTIONS,
  experimentA: {
    meanHR: { practice: r2(mean(A.map((x) => x.practice))), vr: r2(mean(A.map((x) => x.vr))), real: r2(mean(A.map((x) => x.real))) },
    reproductionRatePct: { mean: r2(mean(rates) * 100), sd: r2(sd(rates) * 100), over80: A.filter((x) => x.rate >= 0.8).length },
    perParticipant: A.map((x) => ({ ...x, practice: r2(x.practice), vr: r2(x.vr), real: r2(x.real), rate: r2(x.rate), vrInZone: r2(x.vrInZone) })),
  },
  experimentB: B.map((b) => ({ ...b, name: label[b.cue] })),
  experimentC: C,
  director: { inZonePctWithEngine: r2(zoneOn * 100), inZonePctWithoutEngine: r2(zoneOff * 100) },
};

mkdirSync('sim/out', { recursive: true });
writeFileSync('sim/out/results.json', JSON.stringify(result, null, 2));
const csv = ['id,practice_hr,vr_hr,real_hr,reproduction_rate,vr_in_zone'].concat(A.map((x) => [x.id, r2(x.practice), r2(x.vr), r2(x.real), r2(x.rate), r2(x.vrInZone)].join(','))).join('\n');
writeFileSync('sim/out/experimentA.csv', csv + '\n');

console.log(`가상 참가자 ${N}명 (시드 ${result.seed})`);
console.log(`[A] 평균 심박: 연습실 ${result.experimentA.meanHR.practice} / StageOn ${result.experimentA.meanHR.vr} / 실제 관객 ${result.experimentA.meanHR.real} bpm`);
console.log(`    재현율 평균 ${result.experimentA.reproductionRatePct.mean}% (SD ${result.experimentA.reproductionRatePct.sd}), 80% 이상 ${result.experimentA.reproductionRatePct.over80}/${N}명`);
console.log(`[B] 단서를 껐을 때 평균 심박 증가 감소량(%p): ${B.map((b) => `${label[b.cue]} ${b.meanDropPct}`).join(' · ')}`);
console.log(`[C] 회차별 평균 심박 증가: ${C.map((c) => `${c.session}회 +${c.meanRatioPct}%`).join(' → ')}, 회복 시간 ${C.map((c) => c.meanRecoverySec ?? '–').join(' → ')}초`);
console.log(`[조절 엔진] 목표 구간 체류 ${result.director.inZonePctWithEngine}% (엔진 끔 ${result.director.inZonePctWithoutEngine}%)`);
