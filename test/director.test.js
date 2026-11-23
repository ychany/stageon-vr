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

// ---------- 추가: 관객 행동 · 다음 단계 추천 · CSV · 빠르기 추정 ----------
import { pickBehavior, behaviorGap, recommendNext, toCSV } from '../src/director.js';
import { estimateTempo } from '../src/tempo.js';
import { BEHAVIORS } from '../src/config.js';

test('관객 행동: 꺼진 행동은 고르지 않고, 가중치대로 고른다', () => {
  const w = { film: 1, whisper: 3 };
  assert.equal(pickBehavior(w, new Set(['whisper'])), 'whisper');
  assert.equal(pickBehavior(w, new Set()), null);
  assert.equal(pickBehavior(w, new Set(['film', 'whisper']), 0.1), 'film');
  assert.equal(pickBehavior(w, new Set(['film', 'whisper']), 0.9), 'whisper');
  for (const L of Object.values(LEVELS)) for (const k of Object.keys(L.behaviors.weights)) assert.ok(BEHAVIORS[k], k);
});

test('관객 행동 간격: 강도가 오르면 잦아지고 완화 모드면 드물어진다', () => {
  assert.equal(behaviorGap(0), Infinity);
  assert.ok(behaviorGap(3, 2, false, 0.5) < behaviorGap(3, 0, false, 0.5));
  assert.ok(behaviorGap(3, 0, true, 0.5) > behaviorGap(3, 0, false, 0.5));
});

test('다음 단계 추천: 과부하면 내리고, 익숙해지면 올리고, 아니면 반복', () => {
  const down = recommendNext({ level: 3, meanRatio: 0.55, peakRatio: 0.7, suds: 9 }, TUNING);
  assert.equal(down.action, 'down'); assert.equal(down.level, 2); assert.ok(down.helper);
  const up = recommendNext({ level: 2, meanRatio: 0.1, peakRatio: 0.2, suds: 2 }, TUNING);
  assert.equal(up.action, 'up'); assert.equal(up.level, 3);
  const hab = recommendNext({ level: 3, meanRatio: 0.3, peakRatio: 0.4, suds: 5, prevSuds: 7 }, TUNING);
  assert.equal(hab.action, 'up');
  const stay = recommendNext({ level: 3, meanRatio: 0.3, peakRatio: 0.4, suds: 6, prevSuds: 7 }, TUNING);
  assert.equal(stay.action, 'stay'); assert.equal(stay.level, 3);
  assert.equal(recommendNext({ level: 5, meanRatio: 0.1, peakRatio: 0.2, suds: 2 }, TUNING).action, 'real');
  assert.equal(recommendNext({ level: 1, meanRatio: 0.6, peakRatio: 0.6, suds: 9 }, TUNING).level, 1);
});

test('CSV: BOM, 머리줄, 쉼표·따옴표 처리', () => {
  const csv = toCSV([{ a: 1.23456, b: 'x,y' }, { a: NaN, b: '"q"' }], [{ key: 'a', label: '값' }, { key: 'b' }]);
  assert.ok(csv.startsWith('﻿값,b\r\n'));
  assert.ok(csv.includes('1.235,"x,y"'));
  assert.ok(csv.includes(',"""q"""'));
});

test('빠르기 추정: 합성 클릭 트랙의 BPM과 첫 박', () => {
  const sr = 22050;
  for (const bpm of [92, 120, 140]) {
    const sec = 20, offset = 0.73, x = new Float32Array(sr * sec);
    for (let t = offset; t < sec; t += 60 / bpm) {
      const i0 = Math.round(t * sr);
      for (let j = 0; j < 400 && i0 + j < x.length; j++) x[i0 + j] += Math.sin(j * 0.3) * Math.exp(-j / 80);
    }
    for (let i = 0; i < x.length; i++) x[i] += (Math.random() - 0.5) * 0.01;
    const r = estimateTempo(x, sr);
    assert.ok(Math.abs(r.bpm - bpm) < 1.5, `${bpm} → ${r.bpm}`);
    const beat = 60 / bpm, d = ((r.offset - offset) % beat + beat) % beat;
    assert.ok(Math.min(d, beat - d) < 0.03, `offset ${r.offset}`);
  }
});

// ---------- 추가: 공연장 잔향 ----------
import { estimateRT60 } from '../src/acoustics.js';
import { existsSync } from 'node:fs';

test('잔향 시간 추정: 지수 감쇠 잡음의 RT60', () => {
  const sr = 16000;
  for (const rt of [0.4, 1.0, 1.8]) {
    const x = new Float32Array(Math.floor(sr * rt * 1.5));
    for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(10, (-60 * (i / sr) / rt) / 20);
    x[0] = 1.5;
    const est = estimateRT60(x, sr);
    assert.ok(Math.abs(est - rt) / rt < 0.15, `${rt} → ${est}`);
  }
});

test('단계마다 실측 잔향 파일이 있다', () => {
  for (const L of Object.values(LEVELS)) {
    assert.ok(L.venue.ir && L.venue.ir.file, `Lv${L.id}`);
    assert.ok(existsSync(new URL('../' + L.venue.ir.file, import.meta.url)), L.venue.ir.file);
  }
});
