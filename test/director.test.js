import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MovingAverage, parseHeartRateMeasurement, timingError, TimingJudge,
  StressorDirector, RecoveryTracker, reactionDelay, STRESSOR_LADDER,
} from '../src/director.js';
import { LEVELS, TUNING } from '../src/config.js';

test('15초 이동 평균은 창 밖의 값을 버린다', () => {
  const m = new MovingAverage(15);
  m.push(0, 60); m.push(10, 80); m.push(20, 100);
  assert.equal(m.value, 90);
});

test('심박 측정값 파싱: uint8 / uint16', () => {
  const a = new DataView(new Uint8Array([0x00, 72]).buffer);
  assert.equal(parseHeartRateMeasurement(a), 72);
  const b = new DataView(new Uint8Array([0x01, 0x2c, 0x01]).buffer);
  assert.equal(parseHeartRateMeasurement(b), 300);
});

test('박자 오차는 16분음표 격자 기준', () => {
  const beat = 0.6; // 100 BPM
  assert.ok(Math.abs(timingError(1.2, 0, beat)) < 1e-9);
  assert.ok(Math.abs(timingError(1.23, 0, beat) - 0.03) < 1e-9);
  assert.ok(Math.abs(timingError(1.19, 0, beat) - (-0.01)) < 1e-9);
});

test('어긋난 음 2번이 한 마디 안에 있어야 실수', () => {
  const j = new TimingJudge({ thresholdSec: 0.05 });
  const beat = 0.6;
  assert.equal(j.onset(0.0, 0, beat).mistake, false);
  assert.equal(j.onset(0.07, 0, beat).mistake, false); // 1번째 어긋남
  assert.equal(j.onset(0.67, 0, beat).mistake, true);  // 2번째 → 실수
  assert.equal(j.onset(0.98, 0, beat).mistake, false); // 직후 중복 판정 없음
});

test('불안 조절: 목표 미달 10초 → 장치 추가', () => {
  const d = new StressorDirector(LEVELS[3], TUNING);
  assert.equal(d.update(0, 0.05), null);
  const a = d.update(10, 0.05);
  assert.equal(a.type, 'raise');
  assert.equal(a.stressor, STRESSOR_LADDER[0]);
  assert.equal(d.intensity, 1);
});

test('불안 조절: 목표 구간 안에서는 그대로', () => {
  const d = new StressorDirector(LEVELS[3], TUNING);
  for (let t = 0; t < 60; t++) assert.equal(d.update(t, 0.3), null);
  assert.equal(d.intensity, 0);
});

test('불안 조절: +50% 15초 지속 → 완화, 안정되면 복귀', () => {
  const d = new StressorDirector(LEVELS[4], TUNING);
  for (let t = 0; t < 15; t++) d.update(t, 0.6);
  const a = d.update(15, 0.6);
  assert.equal(a.type, 'calm');
  assert.equal(d.params().friendly, true);
  assert.equal(d.params().judgeNotes, false);
  const b = d.update(20, 0.35);
  assert.equal(b.type, 'resume');
  assert.equal(d.params().judgeNotes, true);
});

test('불안 조절: SUDs 8점 이상이면 즉시 완화', () => {
  const d = new StressorDirector(LEVELS[3], TUNING);
  const a = d.update(0, 0.3, 8);
  assert.equal(a.type, 'calm');
});

test('회복: 실수 직전 수준(+5%p 이내)으로 4마디 → 회복 시간 기록', () => {
  const bar = 2.4;
  const r = new RecoveryTracker(TUNING, bar);
  r.onMistake(10, 0.25);                        // 실수 직전 +25%
  assert.equal(r.update(12, 0.38), null);       // 실수로 치솟음
  assert.equal(r.update(15, 0.29), null);       // +30% 이내로 돌아옴 → 유지 시작
  const d = r.update(15 + 4 * bar, 0.28);
  assert.ok(Math.abs(d - (5 + 4 * bar)) < 1e-9);
});

test('회복: 유지 중 다시 오르면 처음부터', () => {
  const bar = 2.4;
  const r = new RecoveryTracker(TUNING, bar);
  r.onMistake(0, 0.2);
  r.update(2, 0.22);
  assert.equal(r.update(5, 0.4), null);
  assert.equal(r.update(6, 0.2), null);
  assert.equal(r.update(6 + 4 * bar - 0.1, 0.2), null);
  assert.ok(r.update(6 + 4 * bar, 0.2) !== null);
});

test('반응 지연은 0.3–1.5초, 앞줄이 더 빠름', () => {
  for (let row = 0; row < 10; row++) {
    for (const rand of [0, 0.5, 1]) {
      const d = reactionDelay(row, rand, TUNING);
      assert.ok(d >= 0.3 - 1e-9 && d <= 1.5 + 1e-9, `${row} ${rand} ${d}`);
    }
  }
  assert.ok(reactionDelay(0, 0.5, TUNING) < reactionDelay(6, 0.5, TUNING));
});
