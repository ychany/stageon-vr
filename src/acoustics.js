// 공간 음향: 임펄스 응답에서 잔향 시간(RT60)을 추정한다.
// 슈뢰더 역적분으로 에너지 감쇠 곡선을 만들고, −5dB → −25dB 구간의 기울기를 60dB로 늘린다(T20).
export function estimateRT60(samples, sampleRate) {
  const n = samples.length;
  if (n < sampleRate * 0.02) return NaN;
  // 직접음(최대값)부터
  let pk = 0, mx = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(samples[i]); if (a > mx) { mx = a; pk = i; } }
  if (!mx) return NaN;
  const len = n - pk;
  const edc = new Float64Array(len);
  let acc = 0;
  for (let i = len - 1; i >= 0; i--) { acc += samples[pk + i] * samples[pk + i]; edc[i] = acc; }
  const total = edc[0];
  const db = (i) => 10 * Math.log10(edc[i] / total + 1e-12);
  let i5 = -1, i25 = -1;
  for (let i = 0; i < len; i++) {
    const d = db(i);
    if (i5 < 0 && d <= -5) i5 = i;
    if (d <= -25) { i25 = i; break; }
  }
  if (i5 < 0 || i25 < 0) return NaN;
  return ((i25 - i5) / sampleRate) * 3;
}
