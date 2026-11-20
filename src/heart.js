// 심박 입력: Polar H10 등 표준 Bluetooth 심박 센서, 또는 시뮬레이션 심박.
import { parseHeartRateMeasurement } from './director.js?v=202611202256';

export class BluetoothHeartRate {
  constructor() {
    this.bpm = NaN;
    this.name = '';
  }
  static supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }
  async connect() {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    this.name = device.name || '심박 센서';
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (e) => {
      this.bpm = parseHeartRateMeasurement(e.target.value);
    });
    await ch.startNotifications();
    return this.name;
  }
  get simulated() { return false; }
  update() {}
}

// 센서가 없을 때 쓰는 시뮬레이션 심박.
// 불안 장치(시선, 실수, 평가자 등)에 반응해 각성도가 오르고, 시간이 지나면 가라앉는다.
export class SimulatedHeartRate {
  constructor(rest = 72) {
    this.rest = rest;
    this.arousal = 0;       // 0 = 안정, 0.5 = 심박 +50%
    this.target = 0;
    this.manual = 0;        // 키보드/스틱으로 직접 올리고 내린 값
    this.bpm = rest;
    this.name = '시뮬레이션 심박';
  }
  get simulated() { return true; }
  setPressure(p) { this.target = p; }      // 환경이 주는 지속 압박 (0~0.6)
  spike(a) { this.arousal += a; }          // 실수, 호명 같은 순간 자극
  nudge(d) { this.manual = Math.max(-0.3, Math.min(0.8, this.manual + d)); }
  update(dt) {
    const goal = this.target + this.manual;
    this.arousal += (goal - this.arousal) * Math.min(1, dt / 8);
    const noise = (Math.random() - 0.5) * 0.02;
    this.bpm = this.rest * (1 + Math.max(-0.2, this.arousal) + noise);
  }
}
