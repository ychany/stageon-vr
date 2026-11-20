// 내 곡(MP3 등)의 빠르기(BPM)와 첫 박 위치를 추정한다.
// 소리 크기가 갑자기 커지는 순간(onset)을 찾고, 그 간격의 자기상관으로 박 간격을 고른 뒤,
// 박 격자가 onset과 가장 잘 맞는 위치를 첫 박으로 삼는다. 브라우저 API를 쓰지 않아 node로 검증한다.

export function onsetEnvelope(samples, sampleRate, hop = 256) {
  const n = Math.floor(samples.length / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * hop, end = j + hop; j < end; j++) e += samples[j] * samples[j];
    const loud = Math.log(1e-6 + e / hop);
    env[i] = Math.max(0, loud - prev);
    prev = loud;
  }
  // 평균을 빼서 잔잔한 구간의 잡음을 줄인다
  let m = 0; for (const v of env) m += v; m /= Math.max(1, n);
  for (let i = 0; i < n; i++) env[i] = Math.max(0, env[i] - m);
  return { env, frameSec: hop / sampleRate };
}

export function estimateTempo(samples, sampleRate, { minBpm = 70, maxBpm = 180, maxSec = 60 } = {}) {
  const use = samples.length > maxSec * sampleRate ? samples.subarray(0, Math.floor(maxSec * sampleRate)) : samples;
  const { env, frameSec } = onsetEnvelope(use, sampleRate);
  const n = env.length;
  if (n < 50) return { bpm: 100, offset: 0, confidence: 0 };
  const lagMin = Math.max(1, Math.floor(60 / maxBpm / frameSec)), lagMax = Math.ceil(60 / minBpm / frameSec);
  let best = lagMin, bestScore = -Infinity, sum = 0, cnt = 0;
  const scores = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    s /= (n - lag);
    // 사람이 느끼는 빠르기(약 120 BPM 근처)를 조금 더 선호한다
    const bpm = 60 / (lag * frameSec);
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = s * w;
    scores.push(score); sum += score; cnt++;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  // 정수 프레임 사이를 포물선으로 보간해 BPM을 정밀하게
  const i0 = best - lagMin;
  let lag = best;
  if (i0 > 0 && i0 < scores.length - 1) {
    const a = scores[i0 - 1], b = scores[i0], c = scores[i0 + 1];
    const d = a - 2 * b + c;
    if (d < 0) lag = best + 0.5 * (a - c) / d;
  }
  const period = lag;                     // 프레임 단위 박 간격
  let bpm = 60 / (period * frameSec);
  // 첫 박: 박 격자 위상 중 onset 합이 가장 큰 곳
  let bestPhase = 0, bestSum = -Infinity;
  const steps = Math.max(8, Math.round(period));
  for (let k = 0; k < steps; k++) {
    const ph = (k / steps) * period;
    let s = 0;
    for (let t = ph; t < n; t += period) {
      const i = Math.round(t);
      s += Math.max(env[i] || 0, env[i - 1] || 0, env[i + 1] || 0);
    }
    if (s > bestSum) { bestSum = s; bestPhase = ph; }
  }
  // 박마다 가장 가까운 onset 봉우리를 찾아 직선(t = a + k·P)으로 맞춰 간격과 위상을 함께 다듬는다
  // (간격이 조금만 틀려도 곡 뒤로 갈수록 박이 밀리므로)
  let mxe = 0; for (const v of env) mxe = Math.max(mxe, v);
  let P = period, A = bestPhase;
  for (let it = 0; it < 3; it++) {
    let sw = 0, sk = 0, st = 0, skk = 0, skt = 0;
    const w2 = Math.max(1, Math.round(P / 4));
    for (let k = 0; A + k * P < n; k++) {
      const c = Math.round(A + k * P);
      let bi = -1, bv = 0;
      for (let i = Math.max(0, c - w2); i <= Math.min(n - 1, c + w2); i++) if (env[i] > bv) { bv = env[i]; bi = i; }
      if (bi < 0 || bv < mxe * 0.25) continue;
      const w = bv;
      sw += w; sk += w * k; st += w * bi; skk += w * k * k; skt += w * k * bi;
    }
    const den = sw * skk - sk * sk;
    if (sw <= 0 || Math.abs(den) < 1e-9) break;
    const nP = (sw * skt - sk * st) / den, nA = (st - nP * sk) / sw;
    if (!(nP > period * 0.9 && nP < period * 1.1)) break;
    P = nP; A = nA;
  }
  bpm = 60 / (P * frameSec);
  bestPhase = ((A % P) + P) % P;
  // 첫 소리 이후 첫 박을 시작점으로
  let firstLoud = 0, mx = 0;
  for (const v of env) mx = Math.max(mx, v);
  for (let i = 0; i < n; i++) if (env[i] > mx * 0.3) { firstLoud = i; break; }
  let t0 = bestPhase;
  while (t0 + P * 0.5 < firstLoud) t0 += P;
  const confidence = cnt ? Math.min(1, bestScore / (sum / cnt) / 4) : 0;
  return { bpm: Math.round(bpm * 100) / 100, offset: t0 * frameSec, confidence };
}
