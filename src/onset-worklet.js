// 악기 소리의 음 시작(onset)을 찾는 AudioWorklet. 128샘플(약 2.7ms) 단위로 판단한다.
class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fast = 0;
    this.slow = 0;
    this.last = -1;
    this.lastLevelPost = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.threshold) this.threshold = e.data.threshold; };
    this.threshold = 0.02;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let e = 0;
    for (let i = 0; i < ch.length; i++) e += ch[i] * ch[i];
    e = Math.sqrt(e / ch.length);
    this.fast += (e - this.fast) * 0.5;
    this.slow += (e - this.slow) * 0.02;
    const t = currentTime;
    if (this.fast > this.threshold && this.fast > this.slow * 2.2 && t - this.last > 0.08) {
      this.last = t;
      this.port.postMessage({ type: 'onset', t, level: this.fast });
    }
    if (t - this.lastLevelPost > 0.1) {
      this.lastLevelPost = t;
      this.port.postMessage({ type: 'level', t, level: this.fast });
    }
    return true;
  }
}
registerProcessor('onset-processor', OnsetProcessor);
