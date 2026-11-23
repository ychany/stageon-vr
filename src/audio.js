// 공연장 음향: HRTF 입체음향, 공연장 잔향, 관객 소리, 반주 밴드, 심박음.
// 소리는 Web Audio로 합성하고, 공연장 잔향만 실제 공간에서 녹음한 임펄스 응답(assets/ir)을 쓴다.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
  }

  async init(level) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this.level = level;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // 공연장 잔향: Early Echo 0.05–0.1초 + 공간 크기에 따른 꼬리
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, level.venue.reverbSec);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);

    // 버스
    this.crowdBus = this._bus(0.9);
    this.bandBus = this._bus(0.55);
    this.fxBus = this._bus(0.9);
    this.bodyBus = ctx.createGain();     // 심박음은 잔향 없이 몸 안에서 들리는 소리
    this.bodyBus.gain.value = 0.0;
    this.bodyBus.connect(this.master);

    this.noise = makeNoise(ctx, 2);
    this._ambience();
    this.ready = true;
  }

  // 공연장 잔향 바꾸기: 실측 임펄스 응답(AudioBuffer)으로 컨볼루션
  setImpulse(buffer) {
    if (!this.reverb || !buffer) return;
    this.reverb.buffer = buffer;
  }
  async loadImpulse(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`잔향 파일을 불러오지 못했습니다 (${res.status})`);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    this.setImpulse(buf);
    return buf;
  }

  _bus(gain) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const dry = this.ctx.createGain();
    dry.gain.value = 1;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.6;
    g.connect(dry).connect(this.master);
    g.connect(wet).connect(this.reverb);
    return g;
  }

  // HRTF 패너 (ITD·ILD를 포함한 방향 재현)
  panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.5;
    p.rolloffFactor = 0.9;
    this.setPos(p, pos);
    return p;
  }

  setPos(p, pos) {
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(px, t, 0.01); l.positionY.setTargetAtTime(py, t, 0.01); l.positionZ.setTargetAtTime(pz, t, 0.01);
      l.forwardX.setTargetAtTime(fx, t, 0.01); l.forwardY.setTargetAtTime(fy, t, 0.01); l.forwardZ.setTargetAtTime(fz, t, 0.01);
      l.upX.setTargetAtTime(ux, t, 0.01); l.upY.setTargetAtTime(uy, t, 0.01); l.upZ.setTargetAtTime(uz, t, 0.01);
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ---------- 관객 웅성거림(배경) ----------
  _ambience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.02;
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0;
    lfo.connect(lfoGain).connect(this.ambGain.gain);
    src.connect(bp).connect(this.ambGain).connect(this.crowdBus);
    src.start(); lfo.start();
  }

  // 0 = 정적, 1 = 공연 전 시끌벅적
  setCrowdLevel(level, time = 1.5) {
    if (!this.ready) return;
    const size = Math.min(1, 0.25 + this.level.frontRows * this.level.frontPerRow / 40 + this.level.crowd / 600);
    this.ambGain.gain.setTargetAtTime(0.11 * level * size, this.ctx.currentTime, time / 3);
  }

  // ---------- 개별 소리 (위치 지정) ----------
  murmur(pos, dur = 1.6, gain = 0.5) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 450 + Math.random() * 300; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1400 + Math.random() * 600; f2.Q.value = 4;
    const env = ctx.createGain(); env.gain.value = 0;
    // 음절처럼 들리게 4–6Hz로 끊음
    const syll = 1 / (4 + Math.random() * 2);
    for (let x = 0; x < dur; x += syll) {
      const a = gain * (0.4 + Math.random() * 0.6);
      env.gain.setValueAtTime(0, t + x);
      env.gain.linearRampToValueAtTime(a, t + x + syll * 0.3);
      env.gain.linearRampToValueAtTime(0, t + x + syll * 0.9);
    }
    const mix = ctx.createGain(); mix.gain.value = 1.2;
    src.connect(f1).connect(env); src.connect(f2).connect(env);
    env.connect(mix).connect(this.panner(pos)).connect(this.crowdBus);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }

  cough(pos) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [off, amp] of [[0, 0.8], [0.22, 0.5]]) {
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      const env = ctx.createGain(); env.gain.value = 0;
      env.gain.setValueAtTime(0, t + off);
      env.gain.linearRampToValueAtTime(amp, t + off + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + off + 0.18);
      src.connect(lp).connect(env).connect(this.panner(pos)).connect(this.crowdBus);
      src.start(t + off, Math.random()); src.stop(t + off + 0.25);
    }
  }

  penScratch(pos, dur = 1.2) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3500; hp.Q.value = 1.5;
    const env = ctx.createGain(); env.gain.value = 0;
    for (let x = 0; x < dur; x += 0.12) {
      env.gain.setValueAtTime(0, t + x);
      env.gain.linearRampToValueAtTime(0.25 * Math.random(), t + x + 0.03);
      env.gain.linearRampToValueAtTime(0, t + x + 0.1);
    }
    src.connect(hp).connect(env).connect(this.panner(pos)).connect(this.fxBus);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }

  clap(pos, when, amp = 0.5) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 + Math.random() * 900; bp.Q.value = 1.2;
    const env = ctx.createGain(); env.gain.value = 0;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(amp, when + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
    src.connect(bp).connect(env).connect(this._clapPanner(pos)).connect(this.crowdBus);
    src.start(when, Math.random()); src.stop(when + 0.1);
  }

  _clapPanner(pos) {
    // 박수는 수가 많아서 위치별 패너를 재사용한다
    this._clapPanners = this._clapPanners || new Map();
    const key = `${Math.round(pos.x)}|${Math.round(pos.z)}`;
    if (!this._clapPanners.has(key)) this._clapPanners.set(key, this.panner(pos));
    return this._clapPanners.get(key);
  }

  // 박수: 크기(0~1)와 길이. 박수 친 쪽에서 들리도록 관객 위치들을 받는다.
  applause(positions, intensity = 1, dur = 4) {
    if (!this.ready || !positions.length) return;
    const t0 = this.ctx.currentTime;
    const n = Math.round(positions.length * 0.7 * intensity) + 2;
    const rate = 3.2;
    for (let i = 0; i < n; i++) {
      const p = positions[i % positions.length];
      const len = dur * (0.5 + Math.random() * 0.5);
      const start = Math.random() * 0.6;
      for (let x = start; x < len; x += 1 / rate * (0.8 + Math.random() * 0.4)) {
        const fade = 1 - x / len;
        this.clap(p, t0 + x, 0.35 * fade * (0.6 + Math.random() * 0.4));
      }
    }
  }

  phoneRing(pos, dur = 3) {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0;
    const o1 = ctx.createOscillator(); o1.frequency.value = 1318;
    const o2 = ctx.createOscillator(); o2.frequency.value = 1760;
    o1.connect(g); o2.connect(g);
    for (let x = 0; x < dur; x += 0.5) {
      g.gain.setValueAtTime(0.12, t + x);
      g.gain.setValueAtTime(0, t + x + 0.25);
    }
    g.connect(this.panner(pos)).connect(this.fxBus);
    o1.start(t); o2.start(t); o1.stop(t + dur); o2.stop(t + dur);
  }

  footsteps(pos, n = 6) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const env = ctx.createGain(); env.gain.value = 0;
      const w = t + i * 0.55;
      env.gain.setValueAtTime(0, w); env.gain.linearRampToValueAtTime(0.4, w + 0.01); env.gain.exponentialRampToValueAtTime(0.001, w + 0.12);
      src.connect(lp).connect(env).connect(this.panner(pos)).connect(this.fxBus);
      src.start(w, Math.random()); src.stop(w + 0.15);
    }
  }

  // ---------- 심박 되비추기 (E5) ----------
  heartbeat(bpm) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [off, amp] of [[0, 1], [0.16, 0.6]]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t + off); o.frequency.exponentialRampToValueAtTime(38, t + off + 0.12);
      const env = ctx.createGain(); env.gain.value = 0;
      env.gain.setValueAtTime(0, t + off); env.gain.linearRampToValueAtTime(amp, t + off + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, t + off + 0.2);
      o.connect(env).connect(this.bodyBus);
      o.start(t + off); o.stop(t + off + 0.25);
    }
  }

  setHeartbeatVolume(v) {
    if (!this.ready) return;
    this.bodyBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
  }

  // ---------- 반주 밴드 (멈출 수 없는 공연: E4) ----------
  // track: { buffer, offset } 이면 합성 반주 대신 내 곡을 재생한다 (카운트인 스틱은 그대로).
  // startBar: 곡의 몇 번째 마디부터 (심사위원이 끊은 뒤 다시 시작할 때)
  startBand({ bpm, bars, countIn, onBeat, onEnd, drummerPos, bassPos, track = null, startBar = 0 }) {
    const ctx = this.ctx;
    clearInterval(this._bandTimer);
    if (this._trackSrc) { try { this._trackSrc.stop(); } catch { /* 이미 멈춤 */ } this._trackSrc = null; }
    this._bandId = (this._bandId || 0) + 1;
    const myId = this._bandId;
    this.beatSec = 60 / bpm;
    this.bandStart = ctx.currentTime + 0.3;
    this.gridStart = this.bandStart + countIn * this.beatSec;   // 노래 첫 박
    this.totalBeats = countIn + bars * 4;
    this.drumPan = this.panner(drummerPos);
    this.drumPan.connect(this.bandBus);
    this.bassPan = this.panner(bassPos);
    this.bassPan.connect(this.bandBus);
    this.monitor = ctx.createGain(); this.monitor.gain.value = 1;
    this.bandBus.disconnect(); // 모니터 볼륨 사고(E4)를 위해 한 단계 더
    this.bandBus.connect(this.monitor).connect(this.master);
    const wet = ctx.createGain(); wet.gain.value = 0.5; this.monitor.connect(wet).connect(this.reverb);
    if (track) {
      // 무대 양옆 스피커(드럼·베이스 자리)에서 왼쪽·오른쪽 채널을 낸다
      const src = ctx.createBufferSource();
      src.buffer = track.buffer;
      const split = ctx.createChannelSplitter(2);
      const gl = ctx.createGain(), gr = ctx.createGain();
      gl.gain.value = gr.gain.value = 1.3;
      src.connect(split);
      split.connect(gl, 0); split.connect(gr, track.buffer.numberOfChannels > 1 ? 1 : 0);
      gl.connect(this.bassPan); gr.connect(this.drumPan);
      src.start(this.gridStart, track.offset + startBar * 4 * this.beatSec);
      src.stop(this.gridStart + bars * 4 * this.beatSec + 0.05);
      this._trackSrc = src;
    }

    let next = 0;
    const roots = [40, 40, 45, 43]; // E, E, A, G (베이스 MIDI)
    const sched = () => {
      while (next < this.totalBeats && this.bandStart + next * this.beatSec < ctx.currentTime + 0.25) {
        const w = this.bandStart + next * this.beatSec;
        if (next < countIn) this._stick(w);
        else if (!track) {
          const b = next - countIn, inBar = b % 4, bar = Math.floor(b / 4);
          if (inBar === 0 || inBar === 2) this._kick(w);
          if (inBar === 1 || inBar === 3) this._snare(w);
          this._hat(w); this._hat(w + this.beatSec / 2, 0.5);
          this._bass(w, roots[Math.floor(bar / 2) % 4]);
          if (bar === Math.floor(this.totalBeats / 4) - 2 && inBar === 3) this._crash(w);
        }
        onBeat && onBeat(next, w);
        next++;
      }
      if (next >= this.totalBeats) {
        clearInterval(this._bandTimer);
        const endAt = this.bandStart + this.totalBeats * this.beatSec;
        setTimeout(() => { if (this._bandId === myId) onEnd && onEnd(); }, Math.max(0, (endAt - ctx.currentTime) * 1000) + 300);
      }
    };
    this._bandTimer = setInterval(sched, 25);
    sched();
  }

  stopBand() {
    clearInterval(this._bandTimer);
    if (this._trackSrc) { try { this._trackSrc.stop(this.ctx.currentTime + 0.1); } catch { /* 이미 멈춤 */ } this._trackSrc = null; }
    this._bandId = (this._bandId || 0) + 1;   // 예약된 종료 콜백 무효화
    if (this.monitor) this.monitor.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  // 솔로 구간: 반주가 한발 물러나 내 소리만 드러난다
  setBandLevel(v, time = 0.3) {
    if (this.monitor) this.monitor.gain.setTargetAtTime(v, this.ctx.currentTime, time / 3);
  }

  // 관객 박수 따라치기 (2·4박)
  clapAlong(positions, when) {
    for (let i = 0; i < Math.min(10, positions.length); i++) {
      const p = positions[(i * 7) % positions.length];
      this.clap(p, when + Math.random() * 0.03, 0.3);
    }
  }

  // 함성 (“앵콜!”처럼 두 음절로 끊어지는 외침)
  chant(positions, times = 6, gap = 0.75) {
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let k = 0; k < times; k++) {
      for (let i = 0; i < Math.min(8, positions.length); i++) {
        const pos = positions[(i * 5 + k) % positions.length];
        for (const [off, f] of [[0, 520], [0.24, 430]]) {
          const w = t0 + k * gap + off + Math.random() * 0.04;
          const src = ctx.createBufferSource(); src.buffer = this.noise;
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f + Math.random() * 80; bp.Q.value = 5;
          const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = f * 2.3; bp2.Q.value = 6;
          const env = ctx.createGain(); env.gain.value = 0;
          env.gain.setValueAtTime(0, w); env.gain.linearRampToValueAtTime(0.9, w + 0.03); env.gain.linearRampToValueAtTime(0, w + 0.2);
          src.connect(bp).connect(env); src.connect(bp2).connect(env);
          env.connect(this._clapPanner(pos));
          src.start(w, Math.random()); src.stop(w + 0.25);
        }
      }
    }
  }

  // E4 모니터 소리 작아짐: 아무 안내 없이 반주가 작아진다
  monitorDrop(sec = 8) {
    if (!this.monitor) return;
    const t = this.ctx.currentTime;
    this.monitor.gain.setTargetAtTime(0.3, t, 0.1);
    this.monitor.gain.setTargetAtTime(1, t + sec, 0.4);
  }

  _env(node, when, a, d) {
    node.gain.setValueAtTime(0, when);
    node.gain.linearRampToValueAtTime(a, when + 0.002);
    node.gain.exponentialRampToValueAtTime(0.001, when + d);
  }
  _kick(w) {
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, w); o.frequency.exponentialRampToValueAtTime(45, w + 0.12);
    this._env(g, w, 1, 0.3); o.connect(g).connect(this.drumPan); o.start(w); o.stop(w + 0.35);
  }
  _snare(w) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = this.ctx.createGain(); this._env(g, w, 0.6, 0.18);
    s.connect(hp).connect(g).connect(this.drumPan); s.start(w, Math.random()); s.stop(w + 0.2);
  }
  _hat(w, a = 0.25) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = this.ctx.createGain(); this._env(g, w, a, 0.05);
    s.connect(hp).connect(g).connect(this.drumPan); s.start(w, Math.random()); s.stop(w + 0.06);
  }
  _stick(w) {
    const o = this.ctx.createOscillator(); o.frequency.value = 2400; const g = this.ctx.createGain();
    this._env(g, w, 0.5, 0.04); o.connect(g).connect(this.drumPan); o.start(w); o.stop(w + 0.05);
  }
  _crash(w) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    const g = this.ctx.createGain(); this._env(g, w, 0.4, 1.5);
    s.connect(hp).connect(g).connect(this.drumPan); s.start(w); s.stop(w + 1.6);
  }
  _bass(w, midi) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.ctx.createGain(); this._env(g, w, 0.35, this.beatSec * 0.9);
    o.connect(lp).connect(g).connect(this.bassPan); o.start(w); o.stop(w + this.beatSec);
  }

  // 사회자·무대 감독 음성
  say(text, { rate = 1.05, pitch = 1 } = {}) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = rate; u.pitch = pitch;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 음성 합성이 없는 기기 */ }
  }
}

function makeNoise(ctx, sec) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// 잔향 임펄스: 0.05–0.1초 구간의 초기 반사음 + 지수 감쇠 꼬리
export function makeImpulse(ctx, decaySec) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * (decaySec + 0.15));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < 8; i++) {
      const t = 0.05 + Math.random() * 0.05;
      const idx = Math.floor(t * rate);
      d[idx] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - i * 0.04);
    }
    const tailStart = Math.floor(0.08 * rate);
    for (let i = tailStart; i < len; i++) {
      const t = (i - tailStart) / rate;
      d[i] += (Math.random() * 2 - 1) * 0.35 * Math.exp(-6.9 * t / decaySec);
    }
  }
  return buf;
}
