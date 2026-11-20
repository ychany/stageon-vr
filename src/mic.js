// 실제 악기 소리 입력 (오디오 인터페이스 또는 마이크).
// 음 시작을 찾아 박자 오차를 계산하고, 원하면 공연장 잔향만 덧입혀 들려준다.

export class InstrumentInput {
  constructor(audio) {
    this.audio = audio;
    this.enabled = false;
    this.onOnset = null;
    this.lastOnset = -Infinity;
    this.level = 0;
  }

  async enable({ reverbMonitor = true } = {}) {
    const ctx = this.audio.ctx;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.src = ctx.createMediaStreamSource(stream);
    await ctx.audioWorklet.addModule(new URL('./onset-worklet.js', import.meta.url));
    this.node = new AudioWorkletNode(ctx, 'onset-processor');
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'onset') {
        this.lastOnset = e.data.t;
        this.onOnset && this.onOnset(e.data.t);
      } else this.level = e.data.level;
    };
    this.src.connect(this.node);
    // 브라우저 경로는 지연이 커서(10ms 초과) 원음은 들려주지 않고, 공연장 잔향만 덧입힌다.
    if (reverbMonitor) {
      const wet = ctx.createGain(); wet.gain.value = 0.8;
      this.src.connect(wet).connect(this.audio.reverb);
    }
    this.enabled = true;
  }
}
