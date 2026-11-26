// StageOn 프로토타입: 공연 타임라인(대기실 → 호명 → 정적 → 연주 → 종료 → 리포트)과 불안 장치 연결
import * as THREE from 'three';
import { LEVELS, TUNING, STAGE, SCENARIOS, BEHAVIORS, GAZE_SCALE } from './config.js?v=202611261614';
import { buildVenue, avatarIdsFor } from './venue.js?v=202611261614';
import { loadAvatars, RealBody } from './avatars.js?v=202611261614';
import { AudioEngine } from './audio.js?v=202611261614';
import { BluetoothHeartRate, SimulatedHeartRate } from './heart.js?v=202611261614';
import { InstrumentInput } from './mic.js?v=202611261614';
import { MovingAverage, StressorDirector, RecoveryTracker, TimingJudge, reactionDelay, pickBehavior, behaviorGap, recommendNext, toCSV } from './director.js?v=202611261614';
import { estimateRT60 } from './acoustics.js?v=202611261614';
import { estimateTempo } from './tempo.js?v=202611261614';
import qrcode from '../vendor/qrcode.mjs';
import { FloatingPanel, drawReport } from './ui.js?v=202611261614';
import { Person, rand } from './figures.js?v=202611261614';
import { Instrument, InstrumentSound } from './instrument.js?v=202611261614';

const $ = (s) => document.querySelector(s);
// ?fast=1 : 시연·테스트용으로 대기실과 곡 길이를 줄인다
const FAST = new URLSearchParams(location.search).has('fast');
let fastApplied = false;
function applyFast() {
  if (fastApplied) return;
  fastApplied = true;
  Object.values(LEVELS).forEach((l) => { l.backstageSec = 6; });
  SCENARIOS.forEach((sc) => { sc.bars = Math.min(sc.bars, 12); sc.backstage.forEach((b) => { b.at = Math.min(b.at * 0.3, 5); }); if (sc.encore) sc.encore.bars = 4; });
}
if (FAST) applyFast();
const WHO = { mc: '사회자', staff: '무대 감독', member: '드러머', judge: '심사위원', friend: '친구', crowd: '관객' };

// ---------- 렌더러 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070b);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.set(0, 1.6, 0.3);
scene.add(camera);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const audio = new AudioEngine();
const subtitle = makeSubtitle();
camera.add(subtitle.mesh);
function makeSubtitle() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 160;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.14), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.position.set(0, -0.32, -1.1); mesh.renderOrder = 20; mesh.visible = false;
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh, until: 0 };
}
// 사회자·무대 감독·멤버의 말: 음성 + 자막 (Quest 브라우저에 한국어 음성이 없을 수 있어 자막을 함께 띄운다)
function speak(who, text, sec = 3.5) {
  audio.say(text);
  const { ctx, canvas, tex, mesh } = subtitle;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(10,10,20,0.72)';
  ctx.fillRect(0, 20, canvas.width, 120);
  ctx.font = '700 40px "Noto Sans KR", sans-serif'; ctx.fillStyle = '#5EEAD4';
  const label = WHO[who] || who;
  ctx.fillText(label, 30, 96);
  const lw = ctx.measureText(label).width;
  ctx.font = '400 40px "Noto Sans KR", sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 30 + lw + 24, 96);
  tex.needsUpdate = true;
  mesh.visible = S.vr;          // PC에서는 화면 아래 글자 자막만 쓴다
  subtitle.until = S.t + sec;
  $('#subtitle').innerHTML = `<b>${label}</b> ${text}`;
  $('#subtitle').hidden = false;
  log(`${label}: ${text}`);
}
const panel = new FloatingPanel(scene);
const clock = new THREE.Clock();

const S = {
  phase: 'menu', level: null, venue: null, name: '연주자',
  t: 0, phaseStart: 0, vr: false,
  hr: null, hrAvg: new MovingAverage(TUNING.hrSmoothingSec), baseline: NaN, restSamples: [],
  director: null, tracker: null, judge: null, mic: null,
  mistakes: [], hrLog: [], events: [], suds: null, sudsLog: [],
  gazeAvoid: 0, performTime: 0, avoidHold: 0, avoidEpisode: false,
  eyeContacts: 0, gazeHold: new Map(), pending: [],
  nextHeartbeat: 0, lastDirector: 0, lastMood: 0, eventTimes: [], lastOnsetTime: -Infinity, silenceFired: false,
  exposureTarget: 1, debug: false, peakRatio: 0, recoveries: [],
  behaviorLog: [], behaviorsOn: new Set(), gazeScale: 'normal', nextBehavior: Infinity, track: null,
};
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), userHead = new THREE.Vector3();

// ---------- 시작 화면 ----------
$('#scenarios').innerHTML = SCENARIOS.map((sc, i) => `
  <label class="scenario"><input type="radio" name="scenario" value="${i}" ${i === 2 ? 'checked' : ''}>
    <span class="lv">Lv${sc.level} · ${LEVELS[sc.level].name} · ${LEVELS[sc.level].desc}</span>
    <b>${sc.title}</b>
    <span class="story">${sc.story.join(' ')}</span></label>`).join('');
$('#behaviors').innerHTML = Object.entries(BEHAVIORS).map(([k, b]) => `<label class="behavior"><input type="checkbox" name="behavior" value="${k}" checked><span><b>${b.label}</b><span class="why">${b.why}</span></span></label>`).join('');
drawLadder();
drawQR();
let photoTexture = null;
$('#photo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; photoTexture = t; $('#photoName').textContent = f.name; });
});

// ---------- 내 곡으로 연주: 파일을 읽어 빠르기와 첫 박을 찾는다 ----------
const trackFile = { buffer: null, name: '', offset: 0, bpm: 100 };
document.querySelectorAll('input[name=track]').forEach((r) => r.addEventListener('change', () => { $('#trackBox').hidden = $('input[name=track]:checked').value !== 'file'; }));
$('#trackFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $('#trackStatus').textContent = `${f.name} 분석 중…`;
  $('#trackTempo').hidden = true;
  try {
    const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await f.arrayBuffer());
    // 분석은 모노 · 약 22kHz로
    const step = Math.max(1, Math.floor(buf.sampleRate / 22050));
    const len = Math.floor(buf.length / step), mono = new Float32Array(len);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i * step] / buf.numberOfChannels;
    }
    const r = estimateTempo(mono, buf.sampleRate / step);
    Object.assign(trackFile, { buffer: buf, name: f.name, offset: r.offset, bpm: r.bpm });
    $('#trackBpm').value = r.bpm;
    $('#trackTempo').hidden = false;
    const m = Math.floor(buf.duration / 60), sec = Math.round(buf.duration % 60);
    $('#trackStatus').textContent = `${f.name} · ${m}분 ${sec}초 · 첫 박 ${r.offset.toFixed(2)}초 · 추정 ${r.bpm} BPM${r.confidence < 0.5 ? ' (확신 낮음: 박자 들어 보기로 확인하세요)' : ''}. 두 배·절반으로 잘못 잡혔으면 ×2 · ÷2를 누르세요.`;
  } catch (err) {
    trackFile.buffer = null;
    $('#trackStatus').textContent = `읽을 수 없는 파일입니다 (${err.message || err})`;
  }
});
$('#bpmHalf').addEventListener('click', () => { $('#trackBpm').value = Math.round($('#trackBpm').value * 5) / 10; });
$('#bpmDouble').addEventListener('click', () => { $('#trackBpm').value = Math.round($('#trackBpm').value * 20) / 10; });
// 박자 들어 보기: 곡 첫 8박 위에 메트로놈 클릭을 겹쳐 박이 맞는지 귀로 확인
let previewCtx = null;
$('#trackPreview').addEventListener('click', () => {
  if (!trackFile.buffer) return;
  if (previewCtx) { previewCtx.close(); previewCtx = null; return; }
  const ctx = previewCtx = new AudioContext();
  const bpm = Number($('#trackBpm').value) || trackFile.bpm, beat = 60 / bpm, t0 = ctx.currentTime + 0.2;
  const src = ctx.createBufferSource(); src.buffer = trackFile.buffer; src.connect(ctx.destination);
  src.start(t0, trackFile.offset); src.stop(t0 + beat * 8);
  for (let k = 0; k < 8; k++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = k % 4 ? 1000 : 1600;
    g.gain.setValueAtTime(0.5, t0 + k * beat); g.gain.exponentialRampToValueAtTime(0.001, t0 + k * beat + 0.06);
    o.connect(g).connect(ctx.destination); o.start(t0 + k * beat); o.stop(t0 + k * beat + 0.07);
  }
  setTimeout(() => { if (previewCtx === ctx) { ctx.close(); previewCtx = null; } }, (beat * 8 + 0.5) * 1000);
});
// ---------- 공연장 잔향: 실측 임펄스 응답 / 합성 / 내 파일 ----------
const customIR = { buffer: null, bytes: null, name: '', rt60: NaN };
document.querySelectorAll('input[name=ir]').forEach((r) => r.addEventListener('change', () => { $('#irBox').hidden = $('input[name=ir]:checked').value !== 'file'; }));
$('#irFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const bytes = await f.arrayBuffer();
    const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.slice(0));
    if (buf.duration > 10) throw new Error('10초보다 긴 파일은 잔향이 아닌 것 같습니다');
    const rt = estimateRT60(buf.getChannelData(0), buf.sampleRate);
    Object.assign(customIR, { buffer: buf, bytes, name: f.name, rt60: rt });
    $('#irStatus').textContent = `${f.name} · ${buf.duration.toFixed(2)}초 · ${buf.numberOfChannels}채널 · 추정 RT60 ${Number.isFinite(rt) ? rt.toFixed(2) + '초' : '계산 불가'}`;
  } catch (err) {
    customIR.buffer = null;
    $('#irStatus').textContent = `읽을 수 없는 파일입니다 (${err.message || err})`;
  }
});
async function applyIR() {
  const mode = $('input[name=ir]:checked').value;
  const L = S.level;
  const synth = { kind: '합성', name: '공간 크기로 계산', rt60: L.venue.reverbSec };
  if (mode === 'synthetic') { S.irInfo = synth; return; }
  if (mode === 'file' && customIR.buffer) {
    try {
      // ConvolverNode는 재생 컨텍스트와 같은 샘플레이트의 버퍼만 받으므로 다시 디코딩
      audio.setImpulse(await audio.ctx.decodeAudioData(customIR.bytes.slice(0)));
      S.irInfo = { kind: '내 파일', name: customIR.name, rt60: customIR.rt60 };
      return;
    } catch (err) { log(`내 잔향 파일을 적용하지 못해 실측 잔향을 씁니다 (${err.message || err})`); }
  }
  try {
    await audio.loadImpulse(L.venue.ir.file);
    S.irInfo = { kind: '실측', name: L.venue.ir.name, rt60: L.venue.ir.rt60 };
  } catch (err) {
    S.irInfo = synth;
    log(`실측 잔향을 불러오지 못해 합성 잔향을 씁니다 (${err.message || err})`);
  }
}
const irLabel = () => (S.irInfo ? `${S.irInfo.kind} 잔향 · ${S.irInfo.name}${Number.isFinite(S.irInfo.rt60) ? ` · RT60 ${Number(S.irInfo.rt60).toFixed(2)}초` : ''}` : '');

function useTrack() {
  const on = $('input[name=track]:checked').value === 'file' && trackFile.buffer;
  S.track = on ? { buffer: trackFile.buffer, name: trackFile.name, offset: trackFile.offset, full: $('#trackFull').checked } : null;
  TUNING.bpm = on ? (Number($('#trackBpm').value) || trackFile.bpm) : 100;
}

let btHR = null;
$('#btConnect').addEventListener('click', async () => {
  if (!BluetoothHeartRate.supported()) { $('#hrStatus').textContent = '이 브라우저는 Bluetooth를 지원하지 않아 시뮬레이션 심박을 씁니다.'; return; }
  try {
    btHR = new BluetoothHeartRate();
    const n = await btHR.connect();
    $('#hrStatus').textContent = `${n} 연결됨`;
  } catch (e) {
    btHR = null;
    $('#hrStatus').textContent = `연결 실패: ${e.message}`;
  }
});

async function xrSupported() {
  try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); } catch { return false; }
}
xrSupported().then((ok) => {
  $('#startVR').disabled = !ok;
  if (!ok) $('#startVR').textContent = 'VR로 시작 (헤드셋 브라우저에서 열기)';
});

$('#startDesktop').addEventListener('click', () => begin(false));
$('#startDemo').addEventListener('click', startDemo);
$('#startCheck').addEventListener('click', startCheck);
$('#startVR').addEventListener('click', () => begin(true));


// 실사형 관객 불러오기 (?simple=1 이면 기존 도형 관객)
const SIMPLE = new URLSearchParams(location.search).has('simple');
async function prepareAvatars(level) {
  S.realAudience = !SIMPLE && ($('#audienceStyle') ? $('#audienceStyle').value === 'real' : false);
  if (!S.realAudience) return;
  const t0 = performance.now();
  log('관객 아바타 불러오는 중…');
  try {
    await loadAvatars(avatarIdsFor(level));
    log(`관객 아바타 준비 (${((performance.now() - t0) / 1000).toFixed(1)}초)`);
  } catch (e) { log(`실사 관객을 불러오지 못해 단순 모델로 진행합니다 (${e.message || e})`); }
}

async function begin(vr) {
  S.participant = $('#participant').value.trim();
  S.mode = $('input[name=mode]:checked').value;
  if (S.mode !== 'vr') return beginMeasure(S.mode);
  const sc = SCENARIOS[Number($('input[name=scenario]:checked').value)];
  const level = LEVELS[sc.level];
  S.sc = sc;
  S.cues = { gaze: $('#cueGaze').checked, eval: $('#cueEval').checked, mistake: $('#cueMistake').checked, events: $('#cueEvents').checked, body: $('#cueBody').checked };
  S.helper = $('#helper').checked;
  S.behaviorsOn = new Set([...document.querySelectorAll('input[name=behavior]:checked')].map((x) => x.value));
  S.gazeScale = $('#gazeScale').value;
  useTrack();
  S.name = $('#name').value.trim() || '연주자';
  S.level = level;
  S.vr = vr;
  $('#menu').hidden = true;
  $('#hud').hidden = false;

  await audio.init(level);
  await applyIR();
  S.hr = btHR || new SimulatedHeartRate(72);
  if ($('#useMic').checked) {
    try {
      S.mic = new InstrumentInput(audio);
      await S.mic.enable({ reverbMonitor: $('#reverbMonitor').checked });
      S.mic.onOnset = onOnset;
    } catch (e) { S.mic = null; log(`악기 입력 실패: ${e.message}`); }
  }

  await prepareAvatars(level);
  S.venue = buildVenue(scene, level, { avatars: S.realAudience });
  initEngagement(level);
  if (photoTexture) applyPhoto(photoTexture);
  // 악기: 무대 뒤 앰프에서 내 소리가 나온다
  const instType = $('input[name=instrument]:checked').value;
  S.ampPos = new THREE.Vector3(0.9, 0.45, STAGE.curtainZ - 0.35);
  const amp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.32), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  amp.position.set(S.ampPos.x, 0.275, S.ampPos.z); amp.rotation.y = Math.PI - 0.3;
  const grill = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshLambertMaterial({ color: 0x3a3226 }));
  grill.position.set(0, 0.03, -0.161); grill.rotation.y = Math.PI; amp.add(grill);
  S.venue.root.add(amp);
  S.sound = new InstrumentSound(audio, instType, S.ampPos);
  S.strums = 0;
  if ($('#showInstrument').checked) {
    S.inst = new Instrument(instType);
    if (!vr) S.inst.attachDesktop(camera);
  }
  S.director = new StressorDirector(level, TUNING);
  S.tracker = new RecoveryTracker(TUNING, (60 / TUNING.bpm) * 4);
  S.judge = new TimingJudge({ thresholdSec: TUNING.timingErrorSec });
  applyParams();

  if (vr) {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session);
    session.addEventListener('end', () => { if (S.phase !== 'report') emergencyStop('헤드셋 세션 종료'); });
    setupControllers();
    setupHands();
  }
  setPhase('backstage');
}

// 아는 얼굴: 앞줄 가운데 관객 얼굴에 사진을 붙인다 (W3 Image-Based Modeling)
function applyPhoto(tex) {
  const front = S.venue.front.filter((p) => !p.member);
  if (!front.length) return;
  front.sort((a, b) => Math.abs(a.root.position.x) - Math.abs(b.root.position.x));
  const p = front[0];
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.105, 24), new THREE.MeshLambertMaterial({ map: tex }));
  face.position.set(0, 0, 0.118);
  if (p.real) {
    // 실사 아바타는 머리 뼈에 붙인다 (얼굴 앞 12cm, 정면을 향하게)
    const head = p.real.bones.Bip01_Head;
    p.root.updateMatrixWorld(true);
    const wp = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.02, 0.105).applyQuaternion(p.root.getWorldQuaternion(new THREE.Quaternion())));
    const wq = p.root.getWorldQuaternion(new THREE.Quaternion());
    head.add(face);
    const inv = head.matrixWorld.clone().invert();
    face.position.copy(wp.applyMatrix4(inv));
    face.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wq));
    face.scale.setScalar(100 * 0.9);
  } else p.neck.add(face);
  p.watcher = true;
  p.knownFace = true;
}

// ---------- 타임라인 ----------
function setPhase(ph) {
  S.phase = ph;
  S.phaseStart = S.t;
  const L = S.level;
  if (ph === 'backstage') {
    audio.setCrowdLevel(0.4, 2);
    panel.show(S.sc.title, [
      ...S.sc.story,
      S.sc.goal,
      S.vr && S.inst ? '왼손 컨트롤러를 헤드에 달고 연주 자세로 든 뒤 오른손 트리거로 위치 맞춤' : '정면 커튼 너머가 무대입니다. 악기를 준비하세요.',
    ], { footer: `Lv${L.id} ${L.name} · ` + (S.vr ? '연주 트리거 · 건너뛰기 B · 비상 정지 X' : '연주 Space · 건너뛰기 N · 실수 M · 비상 정지 Q') });
    S.bsIdx = 0;
    if (S.irInfo) log(irLabel());
    if (L.timePressure && !S.sc.backstage.some((b) => b.who === 'staff')) setTimeout(() => S.phase === 'backstage' && speak('staff', '5분 전입니다. 준비해 주세요.'), 3000);
  }
  if (ph === 'call') {
    if (!Number.isFinite(S.baseline)) S.baseline = computeBaseline();
    panel.show('무대로 나가세요', ['사회자가 이름을 불렀습니다.', '바닥의 노란 표시까지 걸어 나가세요.'], { footer: S.vr ? '실제로 걸어서 입장합니다 · 공간이 좁으면 B 버튼(손: 오른손 집기 2초)으로 이동' : '가상 이동 없이 실제로 걸어서 입장합니다' });
    speak(S.sc.callWho || 'mc', S.sc.call(S.name), 4);
    setTimeout(() => {
      audio.applause(S.venue.audiencePositions, 0.6, 3.5);
      S.venue.people.forEach((p) => !p.member && !p.judge && Math.random() < 0.6 && p.react('cheer', rand(0.2, 0.8), 2.5));
      if (S.venue.crowd) S.venue.crowd.cheer = 3;
    }, 1600);
    // 스포트라이트 켜짐 + 눈 적응 (1–2초)
    S.venue.spot.intensity = 260;
    S.venue.cone.material.opacity = 0.05;
    S.venue.wash.intensity = 3;
    renderer.toneMappingExposure = 2.6;
    S.exposureTarget = 1;
    S.venue.hemi.intensity = P().houseLight;
    S.venue.backLight.intensity = 0.5;
    S.venue.mark.material.opacity = 0.9;
    spikeHR(0.12);
  }
  if (ph === 'hush') {
    panel.hide();
    S.venue.mark.material.opacity = 0;
    audio.setCrowdLevel(0.04, 1);
    if (S.cues.gaze) S.venue.people.forEach((p) => { if (!p.member) p.eyeContactUntil = S.t + rand(1.5, 3); });
    setTimeout(() => { const f = S.venue.front; if (f.length) audio.cough(f[Math.floor(Math.random() * f.length)].headWorld(tmp).clone()); }, 1300);
    spikeHR(0.06);
    placeStern();
    if (S.sc.preSay) setTimeout(() => speak(S.sc.preSay.who, S.sc.preSay.text, 2.5), 600);
  }
  if (ph === 'encore') {
    // 앵콜 요청: 함성과 박수, 사용자는 무대에 그대로
    speak('crowd', S.sc.encore.text, 4);
    audio.chant(S.venue.audiencePositions, 6, 0.75);
    S.venue.people.forEach((p) => !p.member && !p.judge && Math.random() < 0.8 && p.react('cheer', rand(0.1, 0.6), 4));
    if (S.venue.crowd) S.venue.crowd.cheer = 5;
    S.venue.band.forEach((b) => S.pending.push({ at: S.t + 1.5, fn: () => b.eyeContact(S.t) }));
    setTimeout(() => S.phase === 'encore' && speak('member', '한 곡 더 갈까?', 2.5), 3000);
    setTimeout(() => S.phase === 'encore' && setPhase('perform'), 5500);
  }
  if (ph === 'perform') {
    audio.setCrowdLevel(0.06, 1);
    const bars = songBars(S.encoreDone ? S.sc.encore.bars : S.sc.bars, 0);
    // 짧은 곡에서도 관객 행동을 겪도록 첫 행동은 연주 시작 5–9초 사이에
    S.nextBehavior = S.t + rand(5, 9);
    const songSec = (TUNING.countInBeats + bars * 4) * 60 / TUNING.bpm;
    S.scriptDone = S.scriptDone || new Set();
    S.eventTimes = [];
    const n = S.encoreDone ? 0 : Math.max(0, P().eventsPerSong - S.sc.script.filter((x) => x.do === 'event').length);
    for (let i = 0; i < n; i++) S.eventTimes.push(S.t + rand(0.15, 0.85) * songSec);
    S.eventTimes.sort((a, b) => a - b);
    S.lastOnsetTime = audio.ctx.currentTime;
    startSong(bars, !S.encoreDone);
  }
  if (ph === 'finish') {
    const m = S.mistakes.length, r = S.tracker.recoveries.length;
    const score = THREE.MathUtils.clamp(1 - 0.12 * m + 0.1 * r, 0.25, 1);  // 박수의 크기 = 평가
    audio.applause(S.venue.audiencePositions, score, 2 + score * 5);
    S.venue.people.forEach((p) => !p.member && Math.random() < score && p.react('cheer', reactionDelay(p.row, Math.random(), TUNING), 2 + score * 3));
    if (S.venue.crowd && score > 0.5) S.venue.crowd.cheer = 2 + score * 4;
    if (S.level.id === 1) saveBaseline();
    if (S.sc.encore && !S.encoreDone && score >= 0.45) {
      S.encoreDone = true;
      setTimeout(() => S.phase === 'finish' && setPhase('encore'), 3500);
    } else {
      setTimeout(() => S.phase === 'finish' && speak(S.sc.end.who, S.sc.end.text, 3.5), 1200);
      setTimeout(() => S.phase === 'finish' && setPhase('suds'), (4 + score * 3) * 1000);
    }
  }
  if (ph === 'suds') {
    // 공연 직후 주관적 불안 점수 (0–10)
    audio.setHeartbeatVolume(0);
    S.sudsPost = S.sudsPost ?? 5;
    drawSudsPanel();
    $('#sudsBox').hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  if (ph === 'report') { $('#sudsBox').hidden = true; showReport(); }
  updateHud();
}

// 내 곡을 쓰면 곡 길이 안에서만 연주한다
function songBars(req, startBar = 0) {
  if (!S.track) return req;
  const avail = Math.floor((S.track.buffer.duration - S.track.offset) / (4 * 60 / TUNING.bpm)) - startBar;
  return Math.max(1, S.track.full && !S.encoreDone ? avail : Math.min(req, avail));
}
function startSong(bars, withScript) {
  const barSec = 4 * 60 / TUNING.bpm;
  const startBar = withScript ? (S.barOffset || 0) : 0;
  if (S.track) bars = songBars(bars, startBar);
  audio.startBand({
    track: S.track, startBar,
    bpm: TUNING.bpm, bars, countIn: TUNING.countInBeats,
    drummerPos: S.venue.drummerPos, bassPos: S.venue.bassPos,
    onBeat: (beat, when) => {
      const b = beat - TUNING.countInBeats;
      if (!withScript || b < 0 || b % 4 !== 0) return;
      const bar = b / 4 + (S.barOffset || 0);
      const delay = Math.max(0, (when - audio.ctx.currentTime) * 1000);
      for (const item of S.sc.script) {
        if (item.bar !== bar || S.scriptDone.has(item)) continue;
        S.scriptDone.add(item);
        setTimeout(() => S.phase === 'perform' && runScript(item, barSec), delay);
      }
    },
    onEnd: () => S.phase === 'perform' && setPhase('finish'),
  });
}

// 시나리오 대본의 한 장면
function runScript(item, barSec) {
  const aud = S.venue.people.filter((p) => !p.member && !p.judge);
  if (item.do === 'say') speak(item.who, item.text, 2.5);
  if (!S.cues.events && ['event', 'judgeStop'].includes(item.do)) return;
  if (!S.cues.eval && item.do === 'phonesUp') return;
  if (item.do === 'event') randomEvent(item.type);
  if (item.do === 'phonesUp') {
    aud.filter((p) => p.tier === 'A' && !p.phone && !p.knownFace).slice(0, 4).forEach((p) => { p.addPhone(); p.watcher = true; });
    log('관객들이 휴대폰을 들어 촬영');
    spikeHR(0.05);
  }
  if (item.do === 'attention') {
    // 무관심하던 손님들이 하나둘 돌아본다
    if (S.cues.gaze) aud.forEach((p) => { if (!p.watcher && Math.random() < 0.7) S.pending.push({ at: S.t + rand(0.2, 2), fn: () => { p.watcher = true; p.removePhone(); } }); });
    log('손님들이 돌아봄');
  }
  if (item.do === 'solo') {
    // 솔로: 조명이 나에게만 좁아지고, 반주가 물러나고, 모두가 나를 본다
    if (item.text) speak('member', item.text, 2);
    S.solo = true;
    const sp = S.venue.spot;
    S.soloRestore = { angle: sp.angle, wash: S.venue.wash.intensity };
    sp.angle = 0.18; S.venue.wash.intensity = 0;
    audio.setBandLevel(0.45);
    if (S.cues.gaze) aud.forEach((p) => { p.watcher = true; });
    spikeHR(0.08);
    setTimeout(() => {
      S.solo = false;
      sp.angle = S.soloRestore.angle; S.venue.wash.intensity = S.soloRestore.wash;
      audio.setBandLevel(1);
      if (S.phase === 'perform') {
        audio.applause(S.venue.audiencePositions, S.mistakes.length ? 0.4 : 0.8, 2.5);
        aud.forEach((p) => Math.random() < 0.5 && p.react('cheer', rand(0.2, 0.9), 1.8));
      }
    }, item.bars * barSec * 1000);
  }
  if (item.do === 'clapAlong') {
    const beat = 60 / TUNING.bpm, t0 = audio.ctx.currentTime;
    for (let k = 0; k < item.bars * 4; k++) if (k % 2 === 1) audio.clapAlong(S.venue.audiencePositions, t0 + k * beat);
    aud.forEach((p) => { if (p.tier === 'A' && !p.phone) p.react('cheer', 0, item.bars * 4 * beat); });
    if (S.venue.crowd) S.venue.crowd.cheer = item.bars * 4 * beat;
    log('관객 박수 따라치기');
  }
  if (item.do === 'judgeStop') {
    // 심사위원이 연주를 끊는다: 통제할 수 없는 상황 (E4)
    audio.stopBand();
    speak('judge', item.text, 4);
    S.venue.judges.forEach((j, i) => j.react(i === 1 ? 'write' : 'cold', 0.3, 3));
    S.mistakes.push(S.t); S.tracker.onMistake(S.t, S.lastRatio);
    S.events.push({ t: S.t, type: 'judgeStop' });
    spikeHR(0.15);
    audio.setCrowdLevel(0.0, 0.3);
    setTimeout(() => {
      if (S.phase !== 'perform') return;
      speak('judge', '준비되면 다시 시작하세요.', 2.5);
      S.barOffset = item.bar + 1;
      setTimeout(() => S.phase === 'perform' && startSong(item.restartBars, true), 2000);
    }, 4500);
  }
}


// 기준선: 연습실(Lv1) 연주 중 평균 심박이 있으면 그것, 없으면 대기실 안정 심박 × 1.1
function computeBaseline() {
  try {
    const saved = Number(localStorage.getItem('stageon.baseline'));
    if (saved > 40) { S.baselineSource = '연습실(Lv1) 연주 평균'; return saved; }
  } catch { /* 저장소 사용 불가 */ }
  const vals = S.restSamples.length ? S.restSamples : [S.hr.bpm || 72];
  S.baselineSource = '대기실 안정 심박 × 1.1';
  return (vals.reduce((a, b) => a + b, 0) / vals.length) * 1.1;
}
function saveBaseline() {
  const perf = S.hrLog.filter((p) => p.phase === 'perform');
  if (!perf.length) return;
  try { localStorage.setItem('stageon.baseline', String(perf.reduce((a, b) => a + b.hr, 0) / perf.length)); } catch { /* 무시 */ }
}

// ---------- 실수 (E3) ----------
function onOnset(t) {
  if (S.phase !== 'perform') return;
  S.lastOnsetTime = t;
  S.silenceFired = false;
  if (t < audio.gridStart) return;
  const r = S.judge.onset(t, audio.gridStart, audio.beatSec);
  if (r.mistake) onMistake('박자');
}

function onMistake(source) {
  if (S.phase !== 'perform') return;
  if (!S.venue) { S.mistakes.push(S.t); S.tracker.onMistake(S.t, S.lastRatio); log(`실수 (${source})`); return; }
  const now = S.t;
  S.mistakes.push(now);
  S.tracker.onMistake(now, S.lastRatio);
  log(`실수 (${source})`);
  spikeHR(0.12);
  const p = P();
  S.murmurBudget = 5;
  // 관심도·호감: 실수하면 앞줄부터 식고(반응이 뒤로 번짐), 잘 넘기면 다시 오른다
  // 같은 구간의 연속 실수는 한 번으로 친다 (3초 안의 실수는 관심도를 다시 깎지 않음)
  const hit = !S.lastEngageHit || now - S.lastEngageHit > 3;
  if (hit) S.lastEngageHit = now;
  for (const person of S.venue.people) {
    if (!hit || person.member || person.judge || person.engage === undefined) continue;
    const d = 0.06 + Math.random() * 0.05;
    S.pending.push({ at: now + reactionDelay(person.row, Math.random(), TUNING), fn: () => { person.engage = Math.max(0, person.engage - d); } });
  }
  for (const person of S.venue.people) {
    if (person.member || person.judge) continue;
    if (Math.random() < p.reaction) person.react('murmur', reactionDelay(person.row, Math.random(), TUNING), 1.6);
  }
  if (S.venue.crowd && p.reaction > 0.5) {
    setTimeout(() => S.venue.audiencePositions.slice(-4).forEach((pos) => audio.murmur(pos, 1.4, 0.35)), 1100);
  }
  if (S.cues.mistake) {
    audio.setCrowdLevel(0.25, 0.6);
    setTimeout(() => S.phase === 'perform' && audio.setCrowdLevel(0.06, 2), 2500);
  }
  if (p.judgeNotes) S.venue.judges.forEach((j, i) => {
    const d = rand(0.4, 1.2);
    j.react(i === 1 && Math.random() < 0.4 ? 'watch' : 'write', d, 1.6);
    setTimeout(() => audio.penScratch(j.headWorld(tmp).clone().setY(j.root.position.y + 0.8)), d * 1000);
  });
  if (p.memberLook) S.venue.band.forEach((b) => S.pending.push({ at: now + rand(0.3, 0.9), fn: () => b.eyeContact(S.t) }));
  // 실수 직후 누군가 옆 사람에게 수군거린다 (실수 → 부정적 평가로 해석하게 만드는 장면)
  // 실수가 이어져도 수군거림만 반복되지 않게 8초에 한 번까지
  if (Math.random() < p.reaction && now - (S.lastMistakeWhisper || -99) > 8) {
    S.lastMistakeWhisper = now;
    S.pending.push({ at: now + rand(0.8, 1.6), fn: () => audienceBehavior('whisper', '실수 직후') });
  }
}

// ---------- 관객 행동: 관객이 '어떻게' 불안을 만드는가 ----------
function behaviorAllowed(type) {
  const b = BEHAVIORS[type];
  return b && S.behaviorsOn && S.behaviorsOn.has(type) && S.cues[b.cue] !== false;
}
// 내가 그 장면을 봤는가: 시선 방향에서 40° 안
function seenByUser(pos) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldDirection(tmp);
  tmp2.copy(pos).sub(userHead);
  return THREE.MathUtils.radToDeg(tmp.angleTo(tmp2)) < 40;
}
function audienceActors() {
  return S.venue.people.filter((p) => p.tier === 'A' && !p.member && !p.judge && !p.knownFace && !p.walk && !p.leaving && !p.phone && !p.crossed && p.root.visible);
}
// 오디션·클럽처럼 평가가 있는 무대: 시작 전부터 팔짱 끼고 무표정으로 지켜보는 사람들
function placeStern() {
  const n = S.level.behaviors.stern;
  if (!n || !behaviorAllowed('stern')) return;
  const c = audienceActors().sort(() => Math.random() - 0.5).slice(0, n);
  c.forEach((p) => { p.crossed = true; p.stern = true; p.watcher = true; });
  if (c.length) log(`관객 ${c.length}명이 팔짱 끼고 무표정으로 지켜봄`);
}
function audienceBehavior(type, why = '') {
  if (!S.venue || !behaviorAllowed(type) || !['perform', 'hush'].includes(S.phase)) return;
  const actors = audienceActors();
  if (!actors.length && type !== 'cough') return;
  let p = actors[Math.floor(Math.random() * actors.length)];
  const now = S.t;
  if (type === 'whisper') {
    const pair = actors.filter((a) => a.neighbor && a.neighbor.root.visible);
    if (!pair.length) return;
    p = pair[Math.floor(Math.random() * pair.length)];
    // 나를 힐끗 보고 → 손으로 입을 가리고 속삭임 → 옆 사람이 나를 보며 고개를 끄덕임
    p.eyeContactUntil = now + 0.7;
    p.react('whisper', 0.7, 2.8);
    p.neighbor.react('whisperBack', 1.0, 2.8);
    S.pending.push({ at: now + 0.9, fn: () => audio.murmur(p.headWorld(new THREE.Vector3()), 1.8, 0.28) });
  }
  if (type === 'film') {
    p.addPhone('film'); p.watcher = true;
    S.pending.push({ at: now + rand(10, 18), fn: () => { if (p.phoneMode === 'film') p.removePhone(); } });
  }
  if (type === 'stern') {
    p.crossed = true; p.stern = true; p.watcher = true;
    p.eyeContactUntil = now + 2.5;
  }
  if (type === 'scroll') {
    p.addPhone('scroll'); p.watcher = false;
    S.pending.push({ at: now + rand(12, 20), fn: () => { if (p.phoneMode === 'scroll') { p.removePhone(); p.watcher = Math.random() < P().gazeRatio; } } });
  }
  if (type === 'leave') {
    // 일어나서 출입문으로 걸어 나간다. 옆 사람들이 그쪽을 쳐다본다
    const from = p.root.position.clone();
    const to = S.venue.doorPos.clone();
    if (p.seated) {
      // 앉아 있던 사람은 같은 모습의 선 사람으로 바꿔 일어나게 한다
      const w = new Person({ tier: 'A', row: p.row, look: p.look });
      if (p.real) new RealBody(w, p.real.id);
      w.root.position.copy(from);
      S.venue.root.add(w.root);
      S.venue.people.push(w);
      p.root.visible = false; p.leaving = true;
      p = w;
    }
    p.leaving = true; p.watcher = false;
    p.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    p.walk = { from, to, start: now + 0.6, dur: Math.max(3, from.distanceTo(to) / 1.1), remove: true };
    audio.footsteps(from.clone().setY(from.y + 0.2), 6);
    S.venue.people.filter((a) => a !== p && !a.member && !a.judge && a.root.position.distanceTo(from) < 3).forEach((a) => { a.lookAt = p.root.position; a.lookAtUntil = now + 2.5; });
  }
  if (type === 'cough') {
    const q = S.venue.front.length ? S.venue.front[Math.floor(Math.random() * S.venue.front.length)] : null;
    if (!q) return;
    p = q;
    audio.cough(p.headWorld(tmp).clone());
    if (p.real) p.real.gesture(p.seated ? 'sit_chair_idle_cough' : 'idle_cough_01', 2.6);
  }
  const seen = seenByUser(p.headWorld(new THREE.Vector3()));
  S.behaviorLog.push({ t: now, type, seen, why });
  S.events.push({ t: now, type: `관객:${type}`, seen });
  spikeHR(seen ? 0.04 : 0.012);
  log(`관객 행동: ${BEHAVIORS[type].label}${seen ? ' (봤음)' : ''}${why ? ' · ' + why : ''}`);
}

function onMurmur(person) {
  if (S.murmurBudget > 0 && person.tier === 'A') {
    S.murmurBudget--;
    audio.murmur(person.headWorld(tmp).clone(), 1.5, 0.5);
  }
}

// 관객 한 명 한 명의 관심도 (0~1). 무대 분위기를 기본값으로, 사람마다 성격 차이를 둔다
function initEngagement(level) {
  const base = { friendly: 0.7, neutral: 0.55, indifferent: 0.35, cold: 0.45 }[level.mood] ?? 0.55;
  for (const p of S.venue.people) {
    if (p.member || p.judge) continue;
    p.trait = Math.random();                       // 0: 무심한 편 ~ 1: 열성적인 편
    p.engage = THREE.MathUtils.clamp(base + (p.trait - 0.5) * 0.4, 0.05, 0.95);
    p.cheerStyle = level.id >= 3 && p.trait > 0.6; // 서 있는 공연장의 열성 관객은 박수 대신 환호
  }
  S.engageClock = 0;
  S.lastEngageHit = 0;
}
// 매 프레임: 실수 없이 이어 가면 관심이 오르고, 평소에는 각자 기본값으로 천천히 돌아간다.
// 관심도는 박자 끄덕임·앞으로 기울기·딴짓(하품·두리번) 빈도로 보인다.
function updateEngagement(dt) {
  if (!S.venue) return;
  const playing = ['perform', 'encore'].includes(S.phase);
  const clean = playing && (!S.mistakes.length || S.t - S.mistakes[S.mistakes.length - 1] > 4);
  const base = { friendly: 0.7, neutral: 0.55, indifferent: 0.35, cold: 0.45 }[S.level.mood] ?? 0.55;
  for (const p of S.venue.people) {
    if (p.engage === undefined) continue;
    const home = THREE.MathUtils.clamp(base + (p.trait - 0.5) * 0.4, 0.05, 0.95);
    p.engage += (home - p.engage) * dt * 0.03;
    if (clean) p.engage = Math.min(1, p.engage + dt * 0.012 * (0.5 + p.trait));
    if (p.real) p.real.nodAmp = playing ? THREE.MathUtils.clamp((p.engage - 0.5) * 2.2, 0, 1) : 0;
  }
}

function onRecovered(dur) {
  log(`회복 (${dur.toFixed(1)}초)`);
  S.venue.people.forEach((p) => { if (!p.member && !p.judge) { p.watcher = Math.random() < P().gazeRatio + 0.1; if (p.engage !== undefined) p.engage = Math.min(1, p.engage + 0.1); if (Math.random() < 0.3) p.react('cheer', rand(0.3, 1.2), 1.5); } });
  audio.applause(S.venue.audiencePositions.slice(0, 6), 0.4, 1.8);
}

// ---------- 예측 불가 사건 (E4) ----------
function randomEvent(forced) {
  const types = ['phoneRing', 'monitorDrop', 'lateComer', 'cough', 'flicker'];
  const type = forced || types[Math.floor(Math.random() * types.length)];
  const aud = S.venue.people.filter((p) => !p.member && !p.judge);
  log(`사건: ${type}`);
  S.events.push({ t: S.t, type });
  spikeHR(0.05);
  if (type === 'phoneRing' && aud.length) {
    const p = aud[Math.floor(Math.random() * aud.length)];
    audio.phoneRing(p.headWorld(tmp).clone().setY(p.root.position.y + 1.0), 3);
    p.react('murmur', 0.2, 2.5);
    if (p.neighbor) { p.neighbor.lookAt = p.headWorld(new THREE.Vector3()); p.neighbor.lookAtUntil = S.t + 2.5; }
  }
  if (type === 'monitorDrop') audio.monitorDrop(8);
  if (type === 'cough' && aud.length) {
    const c = aud[Math.floor(Math.random() * aud.length)];
    audio.cough(c.headWorld(tmp).clone());
    if (c.real) c.real.gesture(c.seated ? 'sit_chair_idle_cough' : 'idle_cough_01', 2.6);
  }
  if (type === 'flicker') {
    const s = S.venue.spot, base = s.intensity;
    // 깜빡임은 초당 3회를 넘지 않게
    [0, 400, 800].forEach((ms, i) => setTimeout(() => { s.intensity = i % 2 ? base : base * 0.2; }, ms));
    setTimeout(() => { s.intensity = base; }, 1100);
  }
  if (type === 'lateComer') {
    const p = new Person({ tier: 'A', row: 9 });
    const reals = S.venue.front.filter((x) => x.real);
    if (reals.length) new RealBody(p, reals[Math.floor(Math.random() * reals.length)].real.id);
    const from = S.venue.doorPos.clone();
    const to = from.clone().add(new THREE.Vector3(2.5, 0, -1));
    p.root.position.copy(from);
    p.root.rotation.y = Math.PI / 2;
    p.watcher = false;
    S.venue.root.add(p.root);
    S.venue.people.push(p);
    p.walk = { from, to, start: S.t, dur: 6 };
    audio.footsteps(from.clone().setY(from.y + 0.2), 10);
    aud.filter((a) => a.row >= 1 && Math.random() < 0.3).forEach((a) => { a.lookAt = p.root.position; a.lookAtUntil = S.t + 3; });
  }
}

// ---------- 조절 엔진 적용 ----------
function applyParams() {
  const p = P();
  const aud = S.venue.people.filter((x) => !x.member && !x.judge);
  aud.forEach((x) => { if (!x.knownFace) x.watcher = Math.random() < p.gazeRatio; });
  if (S.level.mood === 'indifferent') aud.forEach((x) => { if (Math.random() < 0.3) x.watcher = false; });
  const filmers = S.venue.front.filter((x) => !x.member && !x.judge && !x.knownFace);
  const want = Math.min(filmers.length, p.phones);
  filmers.forEach((x, i) => (i < want ? x.addPhone() : x.removePhone()));
  if (S.cues.gaze) filmers.slice(0, want).forEach((x) => { x.watcher = true; });
  S.venue.judges.forEach((j) => { j.watcher = S.cues.gaze; });
  if (S.phase !== 'backstage' && S.phase !== 'menu') S.venue.hemi.intensity = p.houseLight;
  S.venue.judges.forEach((j) => { if (!p.friendly) j.state = 'cold', j.stateUntil = Infinity; else j.state = 'idle'; });
}

// 실험용 단서 끄기 (보고서 2-5 실험 B): 끈 단서는 조절 엔진 결과에서 빠진다
function P() {
  const p = S.director.params();
  const c = S.cues || {};
  const g = GAZE_SCALE[S.gazeScale] || 1;
  p.gazeRatio = Math.min(1, p.gazeRatio * g);
  p.noGlance = g > 1;
  if (c.gaze === false) p.gazeRatio = 0;
  if (c.eval === false) { p.phones = 0; p.judgeNotes = false; }
  if (c.mistake === false) { p.reaction = 0; p.memberLook = false; }
  if (c.events === false) p.eventsPerSong = 0;
  if (c.body === false) p.heartbeat = false;
  return p;
}

function spikeHR(a) { if (S.hr && S.hr.simulated) S.hr.spike(a); }

// ---------- 비상 정지 ----------
function emergencyStop(reason = '사용자 요청') {
  if (S.phase === 'stopped' || S.phase === 'menu') return;
  log(`비상 정지: ${reason}`);
  audio.stopBand();
  audio.setCrowdLevel(0, 0.5);
  audio.setHeartbeatVolume(0);
  if (S.venue) { S.venue.hemi.intensity = 0.8; S.venue.spot.intensity = 0; S.venue.cone.material.opacity = 0; }
  S.phase = 'stopped';
  panel.show('비상 정지', ['모든 소리와 관객 반응을 멈췄습니다.', '천천히 헤드셋을 벗어도 됩니다.'], { footer: reason });
  $('#stopped').hidden = false;
  updateHud();
}

// ---------- 악기 연주 ----------
function currentRoot(t) {
  const roots = [40, 40, 45, 43];   // 반주와 같은 코드 진행 (E, E, A, G)
  if (!audio.gridStart || t < audio.gridStart) return roots[0];
  const bar = Math.floor((t - audio.gridStart) / (audio.beatSec * 4));
  return roots[Math.floor(bar / 2) % 4];
}
function strum() {
  if (!S.sound || ['menu', 'stopped', 'report', 'suds'].includes(S.phase)) return;
  const t = audio.ctx.currentTime;
  S.sound.strum(currentRoot(t), t);
  if (S.inst) S.inst.strum();
  haptic(0.3, 30);
  if (S.phase === 'perform') { S.strums++; onOnset(t); }
}
function calibrateInstrument() {
  const cam = renderer.xr.getCamera();
  const pos = new THREE.Vector3(), dir = new THREE.Vector3();
  cam.getWorldPosition(pos); cam.getWorldDirection(dir);
  if (S.inst.calibrate(pos, dir)) {
    S.inst.showGuide(false);
    log('악기 위치 교정 완료');
    haptic(0.8, 120);
    audio.penScratch(pos.clone().add(new THREE.Vector3(0, -0.5, 0)), 0.2);
  }
}
// 연주(또는 대기·입장) 건너뛰기
function skip() {
  if (S.phase === 'backstage') setPhase('call');
  else if (S.phase === 'call' && !S.vr) { camera.position.set(0, 1.6, STAGE.stageMarkZ); }
  else if (S.phase === 'call' && S.vr) jumpToMark();
  else if (S.phase === 'perform') { audio.stopBand(); log('연주 건너뛰기'); setPhase('finish'); }
  else if (S.phase === 'encore') { S.encoreDone = true; setPhase('suds'); }
  else if (S.phase === 'finish') setPhase('suds');
}
$('#skipBtn').addEventListener('click', skip);
// VR에서 앞쪽 공간이 2.2m가 안 될 때: 걷지 않고 무대 표시 위치로 옮긴다 (기준 공간을 그만큼 밀어 준다)
function jumpToMark() {
  const base = renderer.xr.getReferenceSpace();
  if (!base || typeof XRRigidTransform === 'undefined') return;
  const m = S.venue.mark.position;
  const dx = userHead.x - m.x, dz = userHead.z - m.z;
  renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: dx, y: 0, z: dz })));
  log('공간이 좁아 무대 표시 위치로 이동');
}

// ---------- 입력: PC ----------
const keys = new Set();
let yaw = 0, pitch = 0;
renderer.domElement.addEventListener('click', () => { if (!S.vr && S.phase !== 'menu' && S.phase !== 'report') renderer.domElement.requestPointerLock(); });
// 휴대폰·태블릿: 화면을 끌어서 둘러보고, 연주 버튼으로 연주
const TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let lastTouch = null;
renderer.domElement.addEventListener('touchstart', (e) => { const t = e.touches[0]; lastTouch = { x: t.clientX, y: t.clientY }; }, { passive: true });
renderer.domElement.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (!lastTouch || S.vr) return;
  yaw -= (t.clientX - lastTouch.x) * 0.005;
  pitch = THREE.MathUtils.clamp(pitch - (t.clientY - lastTouch.y) * 0.005, -1.4, 1.4);
  lastTouch = { x: t.clientX, y: t.clientY };
}, { passive: true });
$('#strumBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); strum(); });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.4, 1.4);
});
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (S.phase === 'menu') return;
  if (S.demo && e.code !== 'KeyG') { S.demo = null; $('#demoBadge').hidden = true; log('자동 시연 끝 → 직접 조작'); }
  if (S.phase === 'check') { if (e.code === 'KeyQ') location.reload(); if (e.code === 'Space') checkSound(); return; }
  if (e.code === 'KeyM') onMistake('수동 입력');
  if (e.code === 'Space') { e.preventDefault(); strum(); }
  if (e.code === 'KeyN') skip();
  if (e.code === 'KeyQ') emergencyStop();
  if (e.code === 'KeyG') { S.debug = !S.debug; $('#debug').hidden = !S.debug; }
  if (e.code === 'ArrowUp' && S.hr.nudge) S.hr.nudge(0.05);
  if (e.code === 'ArrowDown' && S.hr.nudge) S.hr.nudge(-0.05);
  if (e.code === 'Enter' && S.phase === 'backstage') setPhase('call');   // 대기 건너뛰기 (시연용)
  if (/^Digit[0-9]$/.test(e.code) && S.phase === 'suds') { setSuds(Number(e.code.slice(5)), true); return; }
  if (/^Digit[0-9]$/.test(e.code)) { S.suds = Number(e.code.slice(5)); S.sudsLog.push({ t: S.t, suds: S.suds }); log(`SUDs ${S.suds}`); }
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
// 테스트·시연에서 버튼으로 실수를 넣을 수 있게 노출
window.stageon = { mistake: () => onMistake('수동 입력'), behave: (t) => audienceBehavior(t, '테스트'), skip, state: S, setPhase, emergencyStop, camera, renderer, scene, look: (y, p) => { yaw = y; pitch = p; } };

function desktopMove(dt) {
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const speed = 1.3 * dt;
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const v = new THREE.Vector3();
  if (keys.has('KeyW')) v.add(f);
  if (keys.has('KeyS')) v.sub(f);
  if (keys.has('KeyD')) v.add(r);
  if (keys.has('KeyA')) v.sub(r);
  if (v.lengthSq()) camera.position.addScaledVector(v.normalize(), speed);
  // 대기실과 무대 안에서만 이동
  const z = THREE.MathUtils.clamp(camera.position.z, STAGE.stageFrontZ + 0.4, STAGE.backstageBackZ - 0.25);
  const half = z > STAGE.curtainZ ? 1.4 : STAGE.stageWidth / 2 - 0.3;
  const narrow = Math.abs(z - STAGE.curtainZ) < 0.15 ? 0.55 : half;
  camera.position.set(THREE.MathUtils.clamp(camera.position.x, -narrow, narrow), 1.6, z);
}

// ---------- 입력: VR 컨트롤러 ----------
const controllers = [];
function setupControllers() {
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.12), new THREE.MeshLambertMaterial({ color: 0x333344 }));
    c.add(g);
    c.addEventListener('connected', (e) => {
      c.userData.source = e.data;
      // 왼손 컨트롤러 = 악기 헤드 마운트 (보고서 2-5)
      if (e.data.handedness === 'left' && S.inst && !S.inst.controller) { S.inst.attachVR(c); S.inst.showGuide(true); }
    });
    c.addEventListener('disconnected', () => { c.userData.source = null; });
    scene.add(c);
    controllers.push(c);
  }
}
const prevButtons = new Map();
// ---------- 손 추적: 컨트롤러 없이 오른손으로 줄을 긁어 연주 ----------
const hands = {};
const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const tipMat = new THREE.MeshBasicMaterial({ color: 0xf1c27d });
function setupHands() {
  for (let i = 0; i < 2; i++) {
    const h = renderer.xr.getHand(i);
    h.addEventListener('connected', (e) => {
      if (!e.data.hand) return;
      hands[e.data.handedness] = h;
      // 컨트롤러 마운트가 없으면 가상 악기를 몸 앞에 둔다
      if (S.inst && !S.inst.controller && !S.inst.bodyMode) { S.inst.root.removeFromParent(); S.inst.attachBody(scene); log('손 추적: 가상 악기를 몸 앞에 배치'); }
    });
    h.addEventListener('disconnected', (e) => { if (e.data && hands[e.data.handedness] === h) delete hands[e.data.handedness]; });
    scene.add(h);
  }
}
const handState = { prev: new THREE.Vector3(), has: false, last: 0, tmp: new THREE.Vector3(), sp: new THREE.Vector3() };
function pollHands(dt) {
  for (const h of Object.values(hands)) {
    for (const name of TIPS) {
      const j = h.joints && h.joints[name];
      if (j && !j.userData.vis) { j.add(new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), tipMat)); j.userData.vis = true; }
    }
  }
  const cam = renderer.xr.getCamera();
  if (S.inst && S.inst.bodyMode) { cam.getWorldPosition(tmp); cam.getWorldDirection(tmp2); S.inst.followBody(tmp.clone(), tmp2.clone()); }
  // 엄지-검지 집기(pinch) 제스처: 왼손 2초 = 비상 정지, 오른손 2초 = 건너뛰기,
  // 불안 점수 단계에서는 오른손 집기 +1 · 왼손 집기 −1 · 양손 1초 = 확정
  const pinch = {};
  for (const side of ['left', 'right']) {
    const h = hands[side];
    const a = h && h.joints && h.joints['thumb-tip'], b = h && h.joints && h.joints['index-finger-tip'];
    pinch[side] = !!(a && b && a.position.distanceTo(b.position) < 0.02);
    const st = handState[side] || (handState[side] = { since: null, fired: false });
    if (pinch[side]) { if (st.since === null) { st.since = S.t; st.fired = false; } }
    else {
      if (st.since !== null && !st.fired && S.phase === 'suds' && S.t - st.since < 0.6) setSuds(S.sudsPost + (side === 'right' ? 1 : -1));
      st.since = null;
    }
  }
  const held = (side, sec) => handState[side] && handState[side].since !== null && !handState[side].fired && S.t - handState[side].since > sec;
  if (S.phase === 'suds') {
    if (held('left', 1) && held('right', 1)) { handState.left.fired = handState.right.fired = true; setSuds(S.sudsPost, true); }
  } else {
    if (held('left', 2)) { handState.left.fired = true; emergencyStop('손 제스처'); }
    if (held('right', 2)) { handState.right.fired = true; skip(); }
  }

  const right = hands.right;
  const tip = right && right.joints && right.joints['index-finger-tip'];
  if (!tip || !S.inst) { handState.has = false; return; }
  tip.getWorldPosition(handState.tmp);
  if (handState.has && dt > 0) {
    const vy = (handState.tmp.y - handState.prev.y) / dt;
    const near = handState.tmp.distanceTo(S.inst.strumPoint(handState.sp)) < 0.22;
    // 몸통 근처에서 빠르게 아래로 긁으면 스트럼 (0.12초 안에 다시 인식하지 않음)
    if (near && vy < -0.7 && S.t - handState.last > 0.12) { handState.last = S.t; strum(); }
  }
  handState.prev.copy(handState.tmp);
  handState.has = true;
}

function pollXRInput() {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const prev = prevButtons.get(src) || [];
    const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed && !prev[i];
    if (S.phase === 'check') {
      CHECK.buttons[src.handedness] = gp.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0);
      if (src.handedness === 'right' && pressed(0)) checkSound();
      if (src.handedness === 'left' && pressed(4)) { renderer.xr.getSession().end(); location.reload(); }
      prevButtons.set(src, gp.buttons.map((b) => b.pressed));
      continue;
    }
    if (src.handedness === 'left' && pressed(4)) emergencyStop();             // X 버튼
    if (S.phase === 'suds' && src.handedness === 'right') {
      const ax = gp.axes[2] || 0;
      if (Math.abs(ax) > 0.7 && S.t - (S._sudsMove || 0) > 0.3) { S._sudsMove = S.t; setSuds(S.sudsPost + Math.sign(ax)); }
      if (pressed(0)) setSuds(S.sudsPost, true);
      prevButtons.set(src, gp.buttons.map((b) => b.pressed));
      continue;
    }
    if (src.handedness === 'right' && pressed(0)) {                              // 트리거: 교정 또는 스트럼
      if (S.inst && S.inst.ghost && S.inst.ghost.visible) calibrateInstrument();
      else strum();
    }
    if (src.handedness === 'right' && pressed(1) && $('#demoTrigger').checked) onMistake('컨트롤러 시연 입력');  // 그립
    if (src.handedness === 'right' && pressed(5)) skip();                         // B 버튼: 건너뛰기
    if (src.handedness === 'right' && pressed(4) && S.phase === 'report') restart();  // A 버튼
    if (src.handedness === 'right' && S.hr.nudge && gp.axes[3] !== undefined && Math.abs(gp.axes[3]) > 0.7) S.hr.nudge(-gp.axes[3] * 0.002);
    prevButtons.set(src, gp.buttons.map((b) => b.pressed));
  }
}
function haptic(intensity, ms) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    const h = src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (h && h.pulse) h.pulse(intensity, ms);
  }
}

// ---------- 매 프레임 ----------
// ---------- 프레임 유지: VR에서 목표 주사율보다 계속 느리면 단계적으로 부담을 줄인다 ----------
const Q = { fpsEma: 0, slowFor: 0, level: 0 };
function adaptQuality(rawDt) {
  if (!renderer.xr.isPresenting || !S.venue) return;
  const fps = 1 / Math.max(1e-3, rawDt);
  Q.fpsEma = Q.fpsEma ? Q.fpsEma * 0.95 + fps * 0.05 : fps;
  const session = renderer.xr.getSession();
  const target = (session && session.frameRate) || 72;
  Q.slowFor = Q.fpsEma < target * 0.85 ? Q.slowFor + rawDt : 0;
  if (Q.slowFor > 3 && Q.level < 3) {
    Q.level++; Q.slowFor = 0; Q.fpsEma = 0;
    const crowd = S.venue.crowd, mids = S.venue.instB;
    if (Q.level === 1 && session && session.updateTargetFrameRate && (session.supportedFrameRates || []).includes(72)) session.updateTargetFrameRate(72).catch(() => {});
    if (Q.level >= 2 && crowd) crowd.mesh.count = Math.round(crowd.base.length * (Q.level === 2 ? 0.5 : 0.25));
    if (Q.level === 3 && mids) mids.setCount(Math.ceil(mids.people.length / 2));
    if (Q.level === 3) scene.fog = null;
    log(`화면 끊김 감지 → 품질 ${Q.level}단계로 낮춤 (평균 ${Math.round(fps)}fps)`);
  }
}

function frame() {
  const rawDt = clock.getDelta();
  adaptQuality(rawDt);
  const dt = Math.min(0.05, rawDt);
  S.t += dt;
  if (S.demo) demoStep(dt);
  if (S.phase === 'check') { if (S.vr) pollXRInput(); checkStep(dt, rawDt); panel.update(renderer.xr.isPresenting ? renderer.xr.getCamera() : camera, dt); renderer.render(scene, camera); return; }
  if (!S.vr && S.phase !== 'replay') desktopMove(dt);
  else if (S.vr) { pollXRInput(); pollHands(dt); }
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(userHead);
  if (S.phase === 'replay') replayStep();
  if (S.phase !== 'menu' && S.venue) step(dt, cam);
  panel.update(cam, dt);
  renderer.render(scene, camera);
}

function step(dt, cam) {
  const L = S.level, now = S.t;
  audio.updateListener(cam);
  if (now > subtitle.until && (subtitle.mesh.visible || !$('#subtitle').hidden)) { subtitle.mesh.visible = false; $('#subtitle').hidden = true; }

  // 눈 적응
  renderer.toneMappingExposure += (S.exposureTarget - renderer.toneMappingExposure) * Math.min(1, dt / 0.6);

  // 심박
  S.hr.update(dt);
  const bpm = S.hr.bpm;
  if (Number.isFinite(bpm)) {
    S.hrAvg.push(now, bpm);
    if (S.phase === 'backstage' && now - S.phaseStart > 3) S.restSamples.push(bpm);
  }
  const base = Number.isFinite(S.baseline) ? S.baseline : (S.restSamples.length ? S.restSamples.reduce((a, b) => a + b, 0) / S.restSamples.length * 1.1 : 79);
  const ratio = S.hrAvg.value / base - 1;
  S.lastRatio = ratio;
  if (!S._lastLog || now - S._lastLog > 0.5) {
    S._lastLog = now;
    S.hrLog.push({ t: now, hr: bpm, ratio, phase: S.phase, intensity: S.director.intensity, calm: S.director.calm });
    if (S.phase === 'perform') S.peakRatio = Math.max(S.peakRatio, ratio);
  }

  // 시뮬레이션 심박: 환경 압박
  if (S.hr.simulated) {
    const p = P();
    let pressure = 0;
    if (S.phase === 'backstage') pressure = 0.02 * L.id * Math.min(1, (now - S.phaseStart) / L.backstageSec) + 0.02;
    else if (['call', 'hush', 'perform', 'finish'].includes(S.phase)) {
      const watching = S.venue.people.filter((x) => !x.member && x.watcher).length / Math.max(1, S.venue.people.length);
      pressure = 0.07 * L.id + watching * 0.15 + p.phones * 0.008 + (p.judgeNotes ? 0.06 : 0) + (p.friendly ? -0.05 : 0) + S.director.intensity * 0.03;
    }
    S.hr.setPressure(Math.max(0, pressure));
  }

  // 단계 진행
  if (S.phase === 'backstage') {
    const k = Math.min(1, (now - S.phaseStart) / L.backstageSec);
    const line = S.sc.backstage[S.bsIdx];
    if (line && now - S.phaseStart >= line.at) { S.bsIdx++; speak(line.who, line.text, 3.5); }
    audio.setCrowdLevel(0.4 + 0.6 * k, 2);
    drawMonitor(k);
    if (L.timePressure && L.backstageSec > 15 && !S._cue30 && now - S.phaseStart > L.backstageSec - 8) { S._cue30 = true; speak('staff', '30초 전입니다. 무대로 이동할 준비 하세요.'); }
    if (now - S.phaseStart > L.backstageSec) setPhase('call');
  }
  if (S.phase === 'call') {
    const d = Math.hypot(userHead.x - S.venue.mark.position.x, userHead.z - S.venue.mark.position.z);
    S.venue.mark.material.opacity = 0.5 + 0.4 * Math.sin(now * 4);
    if (d < 0.45) setPhase('hush');
  }
  if (S.phase === 'hush' && now - S.phaseStart > 3) setPhase('perform');

  if (S.phase === 'perform') {
    S.performTime += dt;
    // 조절 엔진 (1초마다)
    if (now - S.lastDirector >= 1) {
      S.lastDirector = now;
      const sudsRecent = S.sudsLog.length && now - S.sudsLog[S.sudsLog.length - 1].t < 20 ? S.suds : null;
      const a = S.director.update(now, ratio, sudsRecent);
      if (a) { log(`조절 엔진: ${a.type}${a.stressor ? ' ' + a.stressor : ''} (${a.reason})`); applyParams(); }
      const rec = S.tracker.update(now, ratio);
      if (rec !== null) onRecovered(rec);
    }
    // 시선 분포는 5초마다만 다시 정한다 (분위기는 서서히 바뀜)
    if (now - S.lastMood >= TUNING.moodHoldSec) { S.lastMood = now; applyParams(); }
    // 예측 불가 사건
    while (S.eventTimes.length && now >= S.eventTimes[0]) { S.eventTimes.shift(); randomEvent(); }
    // 관객 행동
    if (now >= S.nextBehavior) {
      const B = S.level.behaviors;
      S.nextBehavior = now + behaviorGap(B.perMin, S.director.intensity, S.director.calm);
      const type = pickBehavior(B.weights, new Set([...S.behaviorsOn].filter(behaviorAllowed)));
      if (type) audienceBehavior(type);
    }
    // 정적 3초 → 술렁임 (악기 입력이 있을 때만)
    if ((S.mic || S.strums > 0) && audio.gridStart && audio.ctx.currentTime > audio.gridStart + 2 && audio.ctx.currentTime - S.lastOnsetTime > TUNING.silenceSec && !S.silenceFired) {
      S.silenceFired = true;
      onMistake('정적 3초');
    }
    // 심박 되비추기 (E5)
    const p = P();
    const hbOn = p.heartbeat && ratio >= TUNING.heartbeatOnRatio;
    audio.setHeartbeatVolume(hbOn ? 0.8 : 0);
    if (hbOn && now >= S.nextHeartbeat) {
      S.nextHeartbeat = now + 60 / Math.max(50, bpm);
      audio.heartbeat(bpm);
      haptic(0.5, 60);
    }
    gazeTracking(dt, cam, now);
    recordPose(cam, now);
    breathingGuide(ratio, now);
  }

  // 지연 실행
  for (let i = S.pending.length - 1; i >= 0; i--) if (now >= S.pending[i].at) { S.pending[i].fn(); S.pending.splice(i, 1); }

  // 인물 업데이트
  updateEngagement(dt);
  const ct = audio.ctx ? audio.ctx.currentTime : 0;
  const beatPhase = (['perform', 'encore'].includes(S.phase) && audio.gridStart && ct > audio.gridStart) ? ((ct - audio.gridStart) / audio.beatSec) % 1 : undefined;
  const ctx = { userHead, idleTarget: S.venue.idleTarget, params: P(), tmp, tmp2, onMurmur, beatPhase };
  for (const p of S.venue.people) {
    if (p.walk) {
      const k = THREE.MathUtils.clamp((now - p.walk.start) / p.walk.dur, 0, 1);
      p.root.position.lerpVectors(p.walk.from, p.walk.to, k);
      if (k > 0) p.body.position.y = Math.abs(Math.sin(now * 7)) * 0.03;
      if (k >= 1) { if (p.walk.remove) p.root.visible = false; p.walk = null; }
    }
    p.update(dt, now, ctx);
  }
  if (S.venue.crowd) S.venue.crowd.update(dt, now);
  if (S.venue.instB) S.venue.instB.update();
  S.venue.theme.update(dt, now);
  if (S.inst) S.inst.update(dt);
  $('#skipBtn').hidden = !['backstage', 'call', 'perform', 'encore'].includes(S.phase);
  $('#strumBtn').hidden = !(TOUCH && !S.vr && ['backstage', 'hush', 'perform', 'encore'].includes(S.phase));

  // 눈부심: 조명을 바라볼수록 강해짐
  if (S.venue.spot.intensity > 0) {
    cam.getWorldDirection(tmp);
    tmp2.copy(S.venue.glare.position).sub(userHead).normalize();
    const d = tmp.dot(tmp2);
    S.venue.glare.material.opacity = THREE.MathUtils.clamp((d - 0.94) / 0.06, 0, 1) * 0.85;
  }

  updateHud(ratio);
}

// 회복 도우미: 심박이 +40%를 넘으면 들숨 4초 · 날숨 6초 호흡 안내
const breath = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.058, 48), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, depthTest: false }));
breath.position.set(0.32, -0.22, -0.9); breath.renderOrder = 21;
camera.add(breath);
function breathingGuide(ratio, now) {
  const on = S.helper && S.phase === 'perform' && (ratio >= 0.4 || (S.breathOn && ratio > 0.3));
  S.breathOn = on;
  const ph = now % 10, k = ph < 4 ? ph / 4 : 1 - (ph - 4) / 6;     // 0→1 들숨, 1→0 날숨
  breath.material.opacity += ((on ? 0.8 : 0) - breath.material.opacity) * 0.05;
  breath.scale.setScalar(0.6 + k * 0.9);
  const el = $('#breath');
  el.hidden = !on;
  if (on) { el.style.transform = `scale(${0.6 + k * 0.9})`; el.dataset.label = ph < 4 ? '들숨' : '날숨'; el.textContent = el.dataset.label; }
}

// 시선: 눈맞춤(E1)과 시선 회피 측정
function gazeTracking(dt, cam, now) {
  cam.getWorldDirection(tmp);
  const gazeOn = S.cues.gaze;
  const pitchDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(tmp.y, -1, 1)));
  if (pitchDeg < TUNING.gazeAvoidPitchDeg) {
    S.gazeAvoid += dt;
    S.avoidHold += dt;
    if (gazeOn && S.avoidHold > TUNING.gazeAvoidHold && !S.avoidEpisode) {
      S.avoidEpisode = true;
      // 시선을 피하면 앞줄 관객이 고개를 기울여 다시 눈을 맞추려 한다
      S.venue.front.filter((p) => p.watcher && !p.member).forEach((p) => p.react('lean', rand(0.2, 0.8), 2.5));
    }
  } else { S.avoidHold = 0; S.avoidEpisode = false; }

  let best = null, bestAng = Infinity;
  for (const p of S.venue.people) {
    if (p.tier !== 'A' || p.member) continue;
    p.headWorld(tmp2).sub(userHead);
    const ang = THREE.MathUtils.radToDeg(tmp.angleTo(tmp2));
    if (ang < bestAng) { bestAng = ang; best = p; }
  }
  for (const [p, h] of S.gazeHold) if (p !== best) S.gazeHold.delete(p);
  if (gazeOn && best && bestAng < TUNING.mutualGazeAngleDeg) {
    const h = (S.gazeHold.get(best) || 0) + dt;
    S.gazeHold.set(best, h);
    if (h >= TUNING.mutualGazeHold && h - dt < TUNING.mutualGazeHold) {
      S.eyeContacts++;
      S.pending.push({ at: now + rand(0.15, TUNING.mutualGazeReact), fn: () => best.eyeContact(S.t) });
      if (best.engage !== undefined) best.engage = Math.min(1, best.engage + 0.08);
      spikeHR(0.03);
    }
  }
}

function drawMonitor(k) {
  const { ctx, canvas, tex } = S.venue.monitor;
  ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const total = S.level.frontRows * S.level.frontPerRow + S.level.midRows * S.level.midPerRow + S.level.crowd;
  const n = Math.round(total * (0.3 + 0.7 * k));
  ctx.fillStyle = '#c33'; ctx.font = '700 26px sans-serif'; ctx.fillText('● LIVE  객석', 20, 40);
  for (let i = 0; i < Math.min(n, 300); i++) {
    const x = 20 + (i % 30) * 16, y = 70 + Math.floor(i / 30) * 20;
    ctx.fillStyle = `hsl(${(i * 47) % 360},30%,55%)`;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ddd'; ctx.font = '400 22px sans-serif'; ctx.fillText(`${n}명 입장`, 20, canvas.height - 20);
  tex.needsUpdate = true;
}

// ---------- 다시 보기: 공연 중 머리 움직임을 기록했다가 관객석 시점에서 재생 ----------
// 기획서의 “녹화 복기”. 시선을 피한 순간, 실수 후 고개를 숙인 순간을 관객 눈으로 다시 본다.
S.rec = [];
function recordPose(cam, now) {
  if (S.rec.length && now - S.rec[S.rec.length - 1].t < 0.1) return;
  cam.getWorldPosition(tmp);
  const q = new THREE.Quaternion(); cam.getWorldQuaternion(q);
  S.rec.push({ t: now, p: [tmp.x, tmp.y, tmp.z], q: [q.x, q.y, q.z, q.w], hr: Math.round(S.hr.bpm), ratio: S.lastRatio });
}
let ghost = null;
function startReplay() {
  if (S.rec.length < 5) return;
  $('#report').hidden = true;
  $('#hud').hidden = false;
  $('#replayBar').hidden = false;
  panel.hide();
  if (!ghost) {
    ghost = new Person({ tier: 'A' });
    ghost.root.scale.set(1, 1, 1);
    // 과거의 나: 실사 관객 사이에서 구분되도록 반투명 청록 실루엣으로 그린다
    const ghostMat = new THREE.MeshLambertMaterial({ color: 0x5eead4, emissive: 0x0f766e, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false });
    if (S.realAudience) ghost.root.traverse((o) => { if (o.isMesh) o.material = ghostMat; });
    if (S.inst) { const g = S.inst.model.clone(true); g.scale.setScalar(0.9); g.position.set(-0.45, 1.05, 0.25); g.rotation.set(0, 0, -0.5); ghost.body.add(g); }
    scene.add(ghost.root);
  }
  ghost.root.visible = true;
  // 무대 바로 앞 객석 쪽에서, 앞줄 관객 머리 너머로 무대를 본다
  const drop = S.level.venue.floorDrop;
  camera.position.set(1.1, Math.max(1.9, -drop + 2.3), (STAGE.stageFrontZ + STAGE.audienceStartZ) / 2);
  camera.lookAt(0, 1.1, STAGE.stageMarkZ);
  if (S.inst && !S.vr) S.inst.root.visible = false;
  subtitle.mesh.visible = false; $('#subtitle').hidden = true;
  S.replay = { start: S.t, t0: S.rec[0].t, i: 0, mistakeIdx: 0 };
  S.prevPhase = S.phase;
  S.phase = 'replay';
  audio.setCrowdLevel(0.05, 1);
}
function stopReplay() {
  if (S.phase !== 'replay') return;
  S.phase = 'report';
  if (ghost) ghost.root.visible = false;
  if (S.inst) S.inst.root.visible = true;
  $('#replayBar').hidden = true;
  $('#hud').hidden = true;
  $('#report').hidden = false;
}
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function replayStep() {
  const R = S.replay, rec = S.rec;
  const tt = R.t0 + (S.t - R.start);
  while (R.i < rec.length - 2 && rec[R.i + 1].t < tt) R.i++;
  const a = rec[R.i], b = rec[R.i + 1] || a;
  const k = b.t > a.t ? THREE.MathUtils.clamp((tt - a.t) / (b.t - a.t), 0, 1) : 0;
  // 기록된 머리 위치 아래에 몸을 세우고, 머리 방향을 그대로 따라 한다
  const hx = a.p[0] + (b.p[0] - a.p[0]) * k, hy = a.p[1] + (b.p[1] - a.p[1]) * k, hz = a.p[2] + (b.p[2] - a.p[2]) * k;
  qa.fromArray(a.q).slerp(qb.fromArray(b.q), k);
  const e = new THREE.Euler().setFromQuaternion(qa, 'YXZ');
  ghost.root.position.set(hx, 0, hz);
  ghost.root.rotation.y = e.y + Math.PI;          // 인물 모델은 +z가 앞
  ghost.neck.rotation.set(-e.x, 0, 0);
  ghost.body.scale.y = THREE.MathUtils.clamp(hy / 1.58, 0.85, 1.15);
  userHead.set(hx, hy, hz);                        // 관객은 재생 속 연주자를 본다
  while (R.mistakeIdx < S.mistakes.length && S.mistakes[R.mistakeIdx] <= tt) {
    R.mistakeIdx++;
    $('#replayFlag').textContent = '실수!';
    setTimeout(() => { $('#replayFlag').textContent = ''; }, 1200);
  }
  const looking = e.x < THREE.MathUtils.degToRad(TUNING.gazeAvoidPitchDeg) ? ' · 시선 회피 중' : '';
  $('#replayText').textContent = `다시 보기 ${Math.max(0, tt - R.t0).toFixed(1)} / ${(rec[rec.length - 1].t - R.t0).toFixed(1)}초 · 심박 ${a.hr} bpm (${a.ratio >= 0 ? '+' : ''}${Math.round((a.ratio || 0) * 100)}%)${looking}`;
  if (tt >= rec[rec.length - 1].t) stopReplay();
}
$('#replayBtn').addEventListener('click', startReplay);
$('#replayStop').addEventListener('click', stopReplay);

// ---------- 측정 전용 모드: 기준선 측정, 실험 A의 연습실·실제 관객 조건 ----------
// VR 화면 없이 같은 반주·같은 곡 길이로 심박(과 악기 입력이 있으면 박자 실수)을 기록해 같은 형식의 JSON을 남긴다.
const MEASURE = {
  baseline: { title: '기준선 측정', desc: '편한 상태로 60초 동안 반주에 맞춰 평소처럼 연주하세요. 이 값이 모든 비교의 기준선이 됩니다.', bars: 25 },
  practice: { title: '조건 A · 혼자 연습실', desc: '혼자 있는 연습실에서 같은 곡을 연주합니다. 헤드셋은 쓰지 않습니다.' },
  real: { title: '조건 C · 실제 관객 앞', desc: '실제 관객 앞에서 같은 곡을 연주합니다. 헤드셋은 쓰지 않습니다.' },
};
async function beginMeasure(kind) {
  const sc = SCENARIOS[Number($('input[name=scenario]:checked').value)];
  S.sc = sc; S.level = LEVELS[sc.level]; S.name = $('#name').value.trim() || '연주자'; S.vr = false;
  useTrack();
  S.cues = { gaze: true, eval: true, mistake: true, events: true, body: true };
  $('#menu').hidden = true;
  await audio.init(LEVELS[1]);
  S.hr = btHR || new SimulatedHeartRate(72);
  S.director = new StressorDirector(S.level, TUNING);
  S.tracker = new RecoveryTracker(TUNING, (60 / TUNING.bpm) * 4);
  S.judge = new TimingJudge({ thresholdSec: TUNING.timingErrorSec });
  if ($('#useMic').checked) {
    try { S.mic = new InstrumentInput(audio); await S.mic.enable({ reverbMonitor: false }); S.mic.onOnset = measureOnset; }
    catch (e) { S.mic = null; }
  }
  const M = MEASURE[kind];
  $('#measureTitle').textContent = M.title;
  $('#measureDesc').textContent = M.desc;
  $('#measureWarn').hidden = !S.hr.simulated;
  $('#measure').hidden = false;
  $('#measureStart').onclick = () => startMeasure(kind);
}
function measureOnset(t) {
  if (S.phase !== 'perform' || !audio.gridStart || t < audio.gridStart) return;
  if (S.judge.onset(t, audio.gridStart, audio.beatSec).mistake) { S.mistakes.push(S.t); S.tracker.onMistake(S.t, S.lastRatio); }
}
function startMeasure(kind) {
  const bars = songBars(kind === 'baseline' ? Math.round(60 / (240 / TUNING.bpm)) : S.sc.bars, 0);
  $('#measureStart').hidden = true;
  S.phase = 'perform';
  const t0 = performance.now();
  if (kind !== 'baseline') S.baseline = computeBaseline();
  const total = (TUNING.countInBeats + bars * 4) * 60 / TUNING.bpm;
  let last = 0;
  S.measureTimer = setInterval(() => {
    const now = (performance.now() - t0) / 1000, dt = now - last;
    last = now;
    S.t = now;
    S.hr.update(dt);
    const bpm = S.hr.bpm;
    if (Number.isFinite(bpm)) S.hrAvg.push(now, bpm);
    const base = Number.isFinite(S.baseline) ? S.baseline : S.hrAvg.value;
    const ratio = S.hrAvg.value / base - 1;
    S.lastRatio = ratio;
    if (S.hr.simulated) S.hr.setPressure(kind === 'real' ? 0.3 : 0.06);
    S.hrLog.push({ t: now, hr: bpm, ratio, phase: 'perform', intensity: 0, calm: false });
    S.peakRatio = Math.max(S.peakRatio, ratio);
    const rec = S.tracker.update(now, ratio); if (rec !== null) log(`회복 ${rec.toFixed(1)}초`);
    $('#measureLive').textContent = `${Math.min(total, now).toFixed(0)} / ${total.toFixed(0)}초 · 심박 ${Math.round(bpm)} bpm${kind === 'baseline' ? '' : ` (기준선 대비 ${ratio >= 0 ? '+' : ''}${Math.round(ratio * 100)}%)`} · 실수 ${S.mistakes.length}`;
  }, 250);
  audio.startBand({
    bpm: TUNING.bpm, bars, countIn: TUNING.countInBeats,
    drummerPos: new THREE.Vector3(0.8, 1, -1), bassPos: new THREE.Vector3(-0.8, 1, -1),
    track: S.track,
    onEnd: () => endMeasure(kind),
  });
}
function endMeasure(kind) {
  clearInterval(S.measureTimer);
  if (kind === 'baseline') {
    const vals = S.hrLog.filter((p) => p.t > 10).map((p) => p.hr);   // 처음 10초(안정화)는 뺀다
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    try { localStorage.setItem('stageon.baseline', String(mean)); } catch { /* 무시 */ }
    $('#measureLive').textContent = `기준선 ${Math.round(mean)} bpm을 저장했습니다${S.hr.simulated ? ' (시뮬레이션 심박)' : ''}. 이후 모든 공연은 이 값을 기준으로 비교합니다.`;
    $('#measureDone').hidden = false;
    return;
  }
  $('#measure').hidden = true;
  setPhase('suds');
}

// ---------- 주관적 불안 점수 (SUDs) ----------
function drawSudsPanel() {
  panel.show('지금 불안은 몇 점인가요?', [
    '0 = 전혀 없음   ·   10 = 견디기 힘들 정도',
    '',
    `        ◀   ${S.sudsPost}점   ▶`,
  ], { footer: S.vr ? '오른손 스틱 좌우로 고르고 트리거로 확정' : '숫자 버튼이나 키(0–9)로 고르기' });
}
function setSuds(v, confirm = false) {
  S.sudsPost = Math.max(0, Math.min(10, v));
  drawSudsPanel();
  if (confirm) { S.sudsLog.push({ t: S.t, suds: S.sudsPost, post: true }); log(`공연 후 SUDs ${S.sudsPost}`); setPhase('report'); }
}
$('#sudsBox').innerHTML = Array.from({ length: 11 }, (_, i) => `<button type="button" data-v="${i}">${i}</button>`).join('');
$('#sudsBox').addEventListener('click', (e) => { const v = e.target.dataset && e.target.dataset.v; if (v !== undefined) setSuds(Number(v), true); });

// ---------- 회차 기록 (적응 효과: 보고서 실험 C) ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem('stageon.history') || '[]'); } catch { return []; }
}
function saveHistory(entry) {
  try {
    const h = loadHistory(); h.push(entry);
    localStorage.setItem('stageon.history', JSON.stringify(h.slice(-60)));
  } catch { /* 저장소 사용 불가 */ }
}

// ---------- 리포트 ----------
function reportData() {
  return {
    level: S.level.id, levelName: S.level.name, scenario: S.sc.title, encore: !!S.encoreDone,
    hrSource: S.hr.simulated ? '시뮬레이션 심박' : S.hr.name,
    reverb: S.irInfo || null,
    baseline: S.baseline, baselineSource: S.baselineSource, mic: !!S.mic,
    hr: S.hrLog, mistakes: S.mistakes, recoveries: S.tracker.recoveries,
    peakRatio: S.peakRatio,
    gazeAvoidRatio: S.performTime ? S.gazeAvoid / S.performTime : 0,
    eyeContacts: S.eyeContacts, director: S.director.log, events: S.events, suds: S.sudsLog, qualityLevel: Q.level,
    condition: S.mode || 'vr', participant: S.participant || null,
    sudsPost: S.sudsPost ?? null, cues: S.cues, meanRatio: meanPerformRatio(),
    behaviors: S.behaviorLog, gazeScale: S.gazeScale,
    track: S.track ? { name: S.track.name, bpm: TUNING.bpm, offset: S.track.offset } : null,
  };
}
// 관객 행동별로 몇 번 일어났고 몇 번 봤는지, 본 직후 10초 동안 심박이 얼마나 올랐는지
function behaviorSummary(data) {
  const out = {};
  for (const b of data.behaviors || []) {
    const o = out[b.type] || (out[b.type] = { n: 0, seen: 0, rise: [] });
    o.n++; if (b.seen) o.seen++;
    const before = data.hr.filter((h) => h.t <= b.t && h.t > b.t - 3).map((h) => h.ratio);
    const after = data.hr.filter((h) => h.t > b.t && h.t <= b.t + 10).map((h) => h.ratio);
    if (before.length && after.length) o.rise.push(Math.max(...after) - before[before.length - 1]);
  }
  return out;
}
function meanPerformRatio() {
  const v = S.hrLog.filter((p) => p.phase === 'perform' && Number.isFinite(p.ratio)).map((p) => p.ratio);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
function showReport() {
  audio.setHeartbeatVolume(0);
  audio.setCrowdLevel(0.15, 2);
  const data = reportData();
  const prev = loadHistory().filter((h) => h.scenario === data.scenario && (h.condition || 'vr') === data.condition);
  data.session = prev.length + 1;
  data.prevMeanRatio = prev.length ? prev[prev.length - 1].meanRatio : null;
  // 단계별 노출 훈련: 다음 회차 추천 (VR 훈련일 때만)
  const prevSuds = prev.length && Number.isFinite(prev[prev.length - 1].suds) ? prev[prev.length - 1].suds : null;
  data.next = data.condition === 'vr' ? recommendNext({ level: data.level, meanRatio: data.meanRatio, peakRatio: data.peakRatio, suds: data.sudsPost, prevSuds }, TUNING) : null;
  if (data.next) try { localStorage.setItem('stageon.next', JSON.stringify({ ...data.next, from: data.level, date: new Date().toISOString() })); } catch { /* 무시 */ }
  saveHistory({
    rec: data.next ? data.next.action : null, behaviors: (data.behaviors || []).length, gazeScale: data.gazeScale, reverb: data.reverb ? data.reverb.kind : null,
    date: new Date().toISOString(), scenario: data.scenario, level: data.level, meanRatio: data.meanRatio,
    peakRatio: data.peakRatio, mistakes: data.mistakes.length, suds: data.sudsPost,
    recovery: data.recoveries.length ? data.recoveries.reduce((a, b) => a + b, 0) / data.recoveries.length : null,
    simulated: S.hr.simulated, cues: S.cues, condition: data.condition, participant: data.participant,
  });
  data.prevSuds = prevSuds;
  drawReportPage(data, prev);
  const c = $('#reportCanvas');
  drawReport(c, data);
  panel.showCanvas(c);
  $('#report').hidden = false;
  $('#report').scrollTop = 0;
  $('#hud').hidden = true;
  $('#replayBtn').hidden = S.vr || S.rec.length < 5;
  if (document.pointerLockElement) document.exitPointerLock();
  $('#download').onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileStem(data)}.json`;
    a.click();
  };
  $('#csvSession').onclick = () => download(sessionCSV(data), `${fileStem(data)}.csv`);
  $('#csvHistory').onclick = () => download(historyCSV(), `stageon_전체기록_${new Date().toISOString().slice(0, 10)}.csv`);
}
const fileStem = (data) => `stageon_${data.participant ? data.participant + '_' : ''}${data.condition}_Lv${data.level}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
function download(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
}

// ---------- 리포트 화면 (PC) ----------
const pctS = (r, digits = 0) => (Number.isFinite(r) ? `${r >= 0 ? '+' : ''}${(r * 100).toFixed(digits)}%` : '–');
const ACT = { up: '한 단계 올리기', down: '한 단계 내리기', stay: '같은 단계 반복', real: '실제 무대 도전' };
function drawReportPage(data, prev) {
  const COND = { vr: 'StageOn VR', practice: '조건 A · 혼자 연습실', real: '조건 C · 실제 관객 앞', baseline: '기준선 측정' };
  $('#repTitle').textContent = data.scenario;
  const vrMode = data.condition === 'vr';
  $('#repMeta').textContent = [`${data.session}회차`, vrMode ? `Lv${data.level} ${data.levelName}` : '', COND[data.condition] || '', data.participant ? `참가자 ${data.participant}` : '',
    data.encore ? '앵콜 받음' : '', data.hrSource, data.reverb && vrMode ? `${data.reverb.kind} 잔향` : '', data.mic ? '악기 입력' : '실수는 수동 입력', new Date().toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ');
  $('#repSuds').textContent = data.sudsPost === null || data.sudsPost === undefined ? '–' : `${data.sudsPost} / 10`;
  $('#repSudsPrev').textContent = data.prevSuds !== null && data.prevSuds !== undefined ? `지난 회차 ${data.prevSuds}점` : '첫 기록';

  // 핵심 수치: 지난 회차와 비교 (불안 지표는 오르면 주황, 내리면 청록)
  const last = prev[prev.length - 1] || null;
  const diff = (now, before, unit = '%p', scale = 100) => {
    if (!last || !Number.isFinite(now) || !Number.isFinite(before)) return '<em>지난 회차 없음</em>';
    const d = Math.round((now - before) * scale);
    return `<em class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">지난번 ${d > 0 ? '+' : ''}${d}${unit}</em>`;
  };
  const avgRec = data.recoveries.length ? data.recoveries.reduce((a, b) => a + b, 0) / data.recoveries.length : NaN;
  const kpis = [
    ['연주 중 평균 심박', pctS(data.meanRatio), diff(data.meanRatio, last && last.meanRatio)],
    ['최고 심박', pctS(data.peakRatio), diff(data.peakRatio, last && last.peakRatio)],
    ['실수', `${data.mistakes.length}회`, last ? diff(data.mistakes.length, last.mistakes, '회', 1) : '<em>지난 회차 없음</em>'],
    ['평균 회복 시간', Number.isFinite(avgRec) ? `${avgRec.toFixed(1)}초` : '–', `<em>${data.recoveries.length}번 회복</em>`],
    ['시선 회피', vrMode ? `${Math.round(data.gazeAvoidRatio * 100)}%` : '–', vrMode ? '<em>연주 시간 중 바닥을 본 비율</em>' : '<em>헤드셋 없이 측정</em>'],
    ['눈맞춤', vrMode ? `${data.eyeContacts}회` : '–', vrMode ? '<em>1초 이상 관객과 마주침</em>' : '<em>헤드셋 없이 측정</em>'],
  ];
  $('#repKpis').innerHTML = kpis.map(([k, v, d]) => `<div class="kpi"><span>${k}</span><b>${v}</b>${d}</div>`).join('');

  $('#repChart').innerHTML = chartSVG(data);

  // 관객 행동 분석 + 다음 회차 추천
  const sum = behaviorSummary(data);
  const brows = Object.entries(sum).map(([k, o]) => ({ k, ...o, riseAvg: o.rise.length ? o.rise.reduce((a, b) => a + b, 0) / o.rise.length : NaN }))
    .sort((a, b) => (Number.isFinite(b.riseAvg) ? b.riseAvg : -9) - (Number.isFinite(a.riseAvg) ? a.riseAvg : -9));
  const n = data.next;
  const sc = n ? SCENARIOS.findIndex((x) => x.level === n.level) : -1;
  $('#insight').innerHTML = `
    <div><h2>관객 행동 분석 <small>심박이 크게 오른 순</small></h2>${brows.length ? `<table><tr><th>행동</th><th class="tnum">횟수</th><th class="tnum">내가 봄</th><th class="tnum">직후 10초 심박</th></tr>${
      brows.map((b, i) => `<tr><td>${i === 0 && Number.isFinite(b.riseAvg) ? '<b>' : ''}${BEHAVIORS[b.k] ? BEHAVIORS[b.k].label : b.k}${i === 0 && Number.isFinite(b.riseAvg) ? '</b>' : ''}</td><td class="tnum">${b.n}</td><td class="tnum">${b.seen}</td><td class="tnum">${Number.isFinite(b.riseAvg) ? `${b.riseAvg >= 0 ? '+' : ''}${Math.round(b.riseAvg * 100)}%p` : '–'}</td></tr>`).join('')}</table>`
      : `<p class="empty">${vrMode ? '이번 공연에서는 관객 행동이 일어나지 않았습니다. 관객 행동은 연주 중 단계별 빈도로 일어나므로, 연주를 끝까지 하면 기록됩니다.' : '측정 전용 모드에는 가상 관객이 없어 관객 행동을 기록하지 않습니다.'}</p>`}</div>
    <div><h2>다음 회차 추천</h2>${n ? `<p class="rec-act">${ACT[n.action]} <span>→ Lv${n.level} ${LEVELS[n.level].name}</span></p>
      <ul class="rec-why">${n.reasons.map((r) => `<li>${r}</li>`).join('')}${n.helper ? '<li>회복 도우미를 켜고 시작합니다.</li>' : ''}</ul>
      ${n.action !== 'real' && sc >= 0 ? `<button type="button" id="goNext" class="primary">추천 단계로 시작</button>` : ''}` : '<p class="empty">측정 전용 모드에서는 추천하지 않습니다.</p>'}</div>`;
  const go = $('#goNext');
  if (go) go.onclick = () => { try { localStorage.setItem('stageon.autostart', '1'); } catch { /* 무시 */ } restart(); };

  // 회차별 기록: 평균 심박을 막대로
  const rows = [...prev.slice(-5), { date: new Date().toISOString(), meanRatio: data.meanRatio, mistakes: data.mistakes.length, suds: data.sudsPost, now: true }];
  const maxR = Math.max(0.4, ...rows.map((r) => (Number.isFinite(r.meanRatio) ? r.meanRatio : 0)));
  $('#historyTitle').innerHTML = `회차별 기록 <small>${data.scenario} · 같은 조건</small>`;
  $('#history').innerHTML = `<table><tr><th>회차</th><th>날짜</th><th>연주 중 평균 심박</th><th class="tnum">실수</th><th class="tnum">SUDs</th></tr>${
    rows.map((r, i) => `<tr${r.now ? ' class="now"' : ''}><td>${data.session - rows.length + 1 + i}${r.now ? ' (이번)' : ''}</td><td>${new Date(r.date).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td><span class="bar" style="width:${Math.max(2, Math.round(Math.max(0, r.meanRatio || 0) / maxR * 160))}px"></span>${pctS(r.meanRatio)}</td><td class="tnum">${r.mistakes}</td><td class="tnum">${r.suds ?? '–'}</td></tr>`).join('')}</table>`;
}

// 심박 곡선 SVG: 기준선 대비 %, 목표 구간, 단계 구분, 실수, 관객 행동
function chartSVG(data) {
  const W = 1000, H = 310, L = 48, R = 12, T = 44, B = 34;
  const pts = data.hr.filter((p) => ['call', 'hush', 'perform', 'encore', 'finish'].includes(p.phase) && Number.isFinite(p.ratio));
  if (pts.length < 2) return '<p class="empty" style="padding:24px">기록된 심박이 없습니다.</p>';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const vals = pts.map((p) => p.ratio);
  const lo = Math.min(-0.1, Math.floor((Math.min(...vals) - 0.02) * 10) / 10);
  const hi = Math.max(0.5, Math.ceil((Math.max(...vals) + 0.02) * 10) / 10);
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (r) => T + (1 - (r - lo) / (hi - lo)) * (H - T - B);
  let g = '';
  // 단계 구분 (입장 · 정적 · 연주 · 앵콜 · 종료)
  const NAMES = { call: '입장', hush: '정적', perform: '연주', encore: '앵콜', finish: '종료' };
  let segStart = pts[0], k = 0;
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i];
    if (!p || p.phase !== segStart.phase) {
      const xa = x(segStart.t), xb = x((p || pts[pts.length - 1]).t);
      if (k++ % 2) g += `<rect x="${xa}" y="${T}" width="${Math.max(0, xb - xa)}" height="${H - T - B}" fill="#F3F4F6"/>`;
      if (xb - xa > 34) g += `<text x="${(xa + xb) / 2}" y="${H - 12}" text-anchor="middle" font-size="12" fill="#6B7280">${NAMES[segStart.phase] || ''}</text>`;
      segStart = p;
    }
  }
  // 목표 구간과 눈금
  g += `<rect x="${L}" y="${y(TUNING.targetHigh)}" width="${W - L - R}" height="${y(TUNING.targetLow) - y(TUNING.targetHigh)}" fill="rgba(15,118,110,0.12)"/>`;
  for (let r = Math.ceil(lo * 10) / 10; r <= hi + 1e-9; r += 0.1) {
    const rr = Math.round(r * 10) / 10;
    if (Math.round(rr * 100) % 20 !== 0) continue;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(rr)}" y2="${y(rr)}" stroke="${rr === 0 ? '#9CA3AF' : '#E5E7EB'}" stroke-width="1"/>`;
    g += `<text x="${L - 8}" y="${y(rr) + 4}" text-anchor="end" font-size="12" fill="#6B7280">${rr > 0 ? '+' : ''}${Math.round(rr * 100)}%</text>`;
  }
  // 실수
  for (const m of data.mistakes) if (m >= t0 && m <= t1) g += `<line x1="${x(m)}" x2="${x(m)}" y1="${T}" y2="${H - B}" stroke="#D97706" stroke-width="2"/>`;
  // 심박 곡선
  g += `<polyline fill="none" stroke="#1F2937" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p) => `${x(p.t).toFixed(1)},${y(p.ratio).toFixed(1)}`).join(' ')}"/>`;
  // 관객 행동 (위쪽 줄)
  const SHORT = { film: '촬영', stern: '팔짱', whisper: '수군', scroll: '딴짓', leave: '퇴장', cough: '기침' };
  const lastX = [-1e9, -1e9, -1e9];
  (data.behaviors || []).forEach((b) => {
    if (b.t < t0 || b.t > t1) return;
    // 가까운 점끼리 겹치지 않게 세 줄 중 빈 줄에 놓는다
    let row = lastX.findIndex((lx) => x(b.t) - lx > 52);
    if (row < 0) row = lastX.indexOf(Math.min(...lastX));
    lastX[row] = x(b.t);
    const cy = 9 + row * 13;
    g += `<circle cx="${x(b.t)}" cy="${cy}" r="5" fill="${b.seen ? '#0F766E' : '#FFFFFF'}" stroke="#0F766E" stroke-width="1.5"/>`;
    g += `<text x="${x(b.t) + 8}" y="${cy + 4}" font-size="11" fill="#0F766E">${SHORT[b.type] || ''}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="연주 중 심박 변화 그래프">${g}</svg>`;
}

// 이번 회차 시계열 CSV: 0.5초마다 심박 + 그 구간의 실수·사건·관객 행동
function sessionCSV(data) {
  const marks = [...data.mistakes.map((t) => ({ t, label: '실수' })), ...data.events.map((e) => ({ t: e.t, label: e.type + (e.seen ? '(봄)' : '') }))];
  const rows = data.hr.map((h, i) => {
    const t1 = data.hr[i + 1] ? data.hr[i + 1].t : Infinity;
    const here = marks.filter((m) => m.t >= h.t && m.t < t1);
    return { ...h, mistake: here.filter((m) => m.label === '실수').length, event: here.filter((m) => m.label !== '실수').map((m) => m.label).join(' ') };
  });
  return toCSV(rows, [
    { key: 't', label: '시간(초)' }, { key: 'phase', label: '단계' }, { key: 'hr', label: '심박(bpm)' },
    { key: 'ratio', label: '기준선 대비' }, { key: 'intensity', label: '조절 강도' }, { get: (r) => (r.calm ? 1 : 0), label: '완화 모드' },
    { key: 'mistake', label: '실수' }, { key: 'event', label: '사건·관객 행동' },
  ]);
}
function historyCSV() {
  return toCSV(loadHistory(), [
    { key: 'date', label: '날짜' }, { key: 'participant', label: '참가자' }, { key: 'condition', label: '조건' },
    { key: 'scenario', label: '시나리오' }, { key: 'level', label: '단계' }, { key: 'meanRatio', label: '연주 중 평균 심박(기준선 대비)' },
    { key: 'peakRatio', label: '최고 심박' }, { key: 'mistakes', label: '실수' }, { key: 'recovery', label: '평균 회복(초)' },
    { key: 'suds', label: '공연 후 SUDs' }, { key: 'behaviors', label: '관객 행동 수' }, { key: 'gazeScale', label: '시선 강도' },
    { key: 'rec', label: '추천' }, { key: 'reverb', label: '잔향' }, { get: (r) => (r.simulated ? '시뮬레이션' : '센서'), label: '심박 출처' },
    { get: (r) => Object.entries(r.cues || {}).filter(([, v]) => !v).map(([k]) => k).join(' '), label: '끈 단서' },
  ]);
}

// ---------- 시작 화면: 단계별 노출 훈련 사다리 ----------
function drawLadder() {
  const h = loadHistory().filter((x) => (x.condition || 'vr') === 'vr');
  let next = null;
  try { next = JSON.parse(localStorage.getItem('stageon.next') || 'null'); } catch { /* 무시 */ }
  const cur = next ? next.level : 1;
  $('#ladder').innerHTML = [1, 2, 3, 4, 5].map((lv) => {
    const mine = h.filter((x) => x.level === lv);
    const done = mine.some((x) => x.rec === 'up' || x.rec === 'real');
    const last = mine[mine.length - 1];
    return `<div class="step${done ? ' done' : ''}${lv === cur ? ' next' : ''}"><span class="dot">${done ? '✓' : lv}</span><span class="name">${LEVELS[lv].name}</span><span class="stat">${mine.length ? `${mine.length}회 · SUDs ${last.suds ?? '–'}` : '–'}</span>${lv === cur ? '<span class="tag">추천</span>' : ''}</div>`;
  }).join('');
  $('#historyCount').textContent = loadHistory().length ? `${loadHistory().length}회 기록됨` : '';
  $('#historyCsv').onclick = () => download(historyCSV(), `stageon_전체기록_${new Date().toISOString().slice(0, 10)}.csv`);
  if (next) {
    const ACT = { up: '한 단계 올리기', down: '한 단계 내리기', stay: '같은 단계 반복', real: '실제 무대 도전' };
    const banner = $('#nextBanner');
    banner.hidden = false;
    banner.innerHTML = `<b>지난 회차 추천: ${ACT[next.action]} → Lv${next.level} ${LEVELS[next.level].name}</b><br>${next.reasons.join(' ')}`;
    const i = SCENARIOS.findIndex((x) => x.level === next.level);
    if (i >= 0) { const r = document.querySelector(`input[name=scenario][value="${i}"]`); if (r) r.checked = true; }
    if (next.helper) $('#helper').checked = true;
    if (next.action === 'real') { const r = document.querySelector('input[name=mode][value=real]'); if (r) r.checked = true; }
  }
  // '추천 단계로 바로 시작'을 누르고 새로 열린 경우: 시작 버튼을 강조 (오디오는 사용자가 눌러야 켜진다)
  try {
    if (localStorage.getItem('stageon.autostart')) {
      localStorage.removeItem('stageon.autostart');
      $('#nextBanner').scrollIntoView({ block: 'center' });
      $('#startDesktop').classList.add('primary');
    }
  } catch { /* 무시 */ }
}

// ---------- 헤드셋 접속 QR ----------
function drawQR() {
  const url = location.origin + location.pathname.replace(/index\.html$/, '');
  $('#qrUrl').textContent = url;
  try {
    const q = qrcode(0, 'M');
    q.addData(url); q.make();
    const n = q.getModuleCount(), c = $('#qr'), ctx = c.getContext('2d');
    const cell = Math.floor(c.width / (n + 4)), off = Math.floor((c.width - cell * n) / 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#1E1B3A';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) ctx.fillRect(off + k * cell, off + r * cell, cell, cell);
  } catch { $('#qr').hidden = true; }
}
function restart() { location.reload(); }
$('#again').addEventListener('click', restart);

// ---------- HUD ----------
function log(msg) {
  const el = $('#log');
  const line = document.createElement('div');
  line.textContent = `${S.t.toFixed(1).padStart(6)}s  ${msg}`;
  el.prepend(line);
  while (el.childNodes.length > 14) el.removeChild(el.lastChild);
}
const PHASE = { menu: '시작 전', backstage: '대기실', call: '호명·입장', hush: '첫 소절 직전', perform: '연주 중', encore: '앵콜 요청', finish: '종료', suds: '불안 점수', replay: '다시 보기', report: '리포트', stopped: '비상 정지' };
function updateHud(ratio) {
  if (!S.level) return;
  const p = S.director ? P() : {};
  const r = Number.isFinite(ratio) ? `${ratio >= 0 ? '+' : ''}${Math.round(ratio * 100)}%` : '–';
  $('#hudText').textContent = `Lv${S.level.id} ${S.level.name} · ${PHASE[S.phase]} · 심박 ${Math.round(S.hr ? S.hr.bpm : 0)} (${r})${S.hr && S.hr.simulated ? ' 시뮬레이션' : ''}`;
  const T = TOUCH && !S.vr;
  $('#hudSub').textContent = S.phase === 'call' ? (T ? '건너뛰기를 누르면 무대로 나갑니다' : '노란 표시까지 걸어 나가세요 (W, 또는 N으로 바로 이동)')
    : S.phase === 'backstage' ? (T ? '대기 중 · 연주 버튼으로 악기 풀기' : '대기 중 · Space로 악기 풀기 · N 건너뛰기')
    : S.phase === 'perform' ? (T ? `연주 버튼을 박자에 맞춰 · 연주 ${S.strums}번` : `Space로 박자에 맞춰 연주 · N 건너뛰기 · 연주 ${S.strums}번`) : '';
  if (S.debug && S.director) {
    $('#debugText').textContent = [
      `기준선 ${Math.round(S.baseline || 0)} bpm (${S.baselineSource || '측정 중'})`,
      `조절 단계 ${S.director.intensity}${S.director.calm ? ' · 완화 모드' : ''} · 켜진 장치 ${S.director.active.join(', ') || '없음'}`,
      `응시 비율 ${Math.round(p.gazeRatio * 100)}% · 반응 ${p.reaction.toFixed(2)} · 촬영 ${p.phones}명 · 심박음 ${p.heartbeat ? '켜짐' : '꺼짐'}`,
      `실수 ${S.mistakes.length} · 회복 ${S.tracker ? S.tracker.recoveries.length : 0} · 눈맞춤 ${S.eyeContacts} · 시선 회피 ${S.performTime ? Math.round(S.gazeAvoid / S.performTime * 100) : 0}%`,
      S.mic ? `악기 입력 레벨 ${S.mic.level.toFixed(3)}` : '악기 입력 없음 (M 키로 실수 입력)',
    ].join('\n');
  }
}

renderer.setAnimationLoop(frame);

// ---------- 자동 시연 (발표용) ----------
// 버튼 하나로 대기실 → 입장 → 연주(실수 2번, 시선 피하기 포함) → 불안 점수 → 리포트 → 다시 보기까지 자동 진행
function startDemo() {
  applyFast();
  if (!$('#name').value.trim()) $('#name').value = '스테이지온';
  const r = document.querySelector('input[name=mode][value=vr]'); if (r) r.checked = true;
  S.demo = { t: 0, look: 0, target: null, nextLook: 0, avoidAt: null, lastBeat: -1, badBars: new Set([4, 9]), sudsAt: null, replayAt: null };
  $('#demoBadge').hidden = false;
  begin(false);
}
function demoStep(dt) {
  const D = S.demo;
  D.t += dt;
  const now = S.t;
  const turnTo = (ty, tp, k = 2) => { yaw += (ty - yaw) * Math.min(1, dt * k); pitch += (tp - pitch) * Math.min(1, dt * k); };
  if (S.phase === 'backstage') {
    turnTo(Math.sin(D.t * 0.5) * 0.9, -0.1, 1.5);
    if (S.t - S.phaseStart > 4.5) setPhase('call');
  } else if (S.phase === 'call') {
    turnTo(0, -0.05);
    camera.position.z -= 1.0 * dt;   // 실제로 걸어 나가는 것처럼
  } else if (['hush', 'perform', 'encore', 'finish'].includes(S.phase)) {
    // 객석을 둘러보며 앞줄 관객과 눈을 맞추고, 중간에 한 번 4초 동안 바닥을 본다(시선 회피)
    if (S.phase === 'perform' && D.avoidAt === null) D.avoidAt = now + 9;
    if (D.avoidAt !== null && now > D.avoidAt && now < D.avoidAt + 4.5) turnTo(yaw, -0.75, 3);
    else {
      if (now > D.nextLook || !D.target) {
        D.nextLook = now + rand(2.2, 3.5);
        const f = S.venue.front.filter((p) => !p.member && p.root.visible);
        D.target = f.length ? f[Math.floor(Math.random() * f.length)] : null;
      }
      if (D.target) {
        D.target.headWorld(tmp).sub(camera.position);
        turnTo(Math.atan2(-tmp.x, -tmp.z), Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), 3);
      }
    }
    // 박자에 맞춰 연주. 정해 둔 마디에서는 0.13초 늦게 쳐서 박자 실수를 만든다
    if (S.phase === 'perform' && audio.gridStart) {
      const ct = audio.ctx.currentTime;
      const beat = Math.floor((ct - audio.gridStart) / audio.beatSec + 0.02);
      const bar = Math.floor(beat / 4);
      const late = D.badBars.has(bar) ? audio.beatSec / 8 : 0;   // 16분음 격자의 정확히 중간 = 가장 크게 어긋남
      if (beat >= 0 && beat > D.lastBeat && ct >= audio.gridStart + beat * audio.beatSec + late) { D.lastBeat = beat; strum(); }
    }
  } else if (S.phase === 'suds') {
    if (D.sudsAt === null) D.sudsAt = now + 1.8;
    if (now > D.sudsAt) setSuds(6, true);
  } else if (S.phase === 'report') {
    if (D.replayAt === null) D.replayAt = now + 4;
    if (now > D.replayAt) { $('#demoBadge').hidden = true; S.demo = null; startReplay(); }
  }
}

// ---------- 기기 점검 ----------
// 가장 무거운 공연장(페스티벌)을 띄워 놓고 프레임·입력·소리를 확인한다. Quest에서 실제로 쓸 수 있는지 미리 보는 화면.
const CHECK = { frames: [], buttons: {}, side: 0, lines: [], last: 0, result: null };
async function startCheck() {
  S.level = LEVELS[5]; S.sc = SCENARIOS.find((x) => x.level === 5);
  S.cues = { gaze: true, eval: true, mistake: true, events: true, body: true };
  S.behaviorsOn = new Set(); S.gazeScale = 'normal';
  const vr = await xrSupported();
  S.vr = vr;
  $('#menu').hidden = true;
  await audio.init(S.level);
  await applyIR();
  S.hr = btHR || new SimulatedHeartRate(72);
  if ($('#useMic').checked) { try { S.mic = new InstrumentInput(audio); await S.mic.enable({ reverbMonitor: false }); } catch (e) { S.mic = null; CHECK.micError = e.message; } }
  await prepareAvatars(S.level);
  S.venue = buildVenue(scene, S.level, { avatars: S.realAudience });
  initEngagement(S.level);
  S.director = new StressorDirector(S.level, TUNING);
  S.venue.spot.intensity = 260; S.venue.wash.intensity = 3; S.venue.hemi.intensity = S.level.venue.houseLight;
  camera.position.set(0, 1.6, STAGE.stageMarkZ);
  if (vr) {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session);
    setupControllers(); setupHands();
  } else $('#checkBox').hidden = false;
  S.phase = 'check';
  $('#checkSave').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(CHECK.result, null, 2)], { type: 'application/json' }));
    a.download = `stageon_기기점검_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
  };
}
// 소리 방향 시험: 무대 왼쪽 → 오른쪽 번갈아 박수 소리
function checkSound() {
  CHECK.side = 1 - CHECK.side;
  const x = CHECK.side ? -3 : 3;
  audio.clapAlong([new THREE.Vector3(x, 1.5, STAGE.stageMarkZ - 1)], audio.ctx.currentTime + 0.05);
  CHECK.lastSound = CHECK.side ? '왼쪽' : '오른쪽';
}
function checkStep(dt, rawDt) {
  const now = S.t;
  CHECK.frames.push([now, rawDt]);
  while (CHECK.frames.length && CHECK.frames[0][0] < now - 3) CHECK.frames.shift();
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(userHead);
  if (!S.vr) desktopMove(dt);
  S.hr.update(dt);
  const ctx = { userHead, idleTarget: S.venue.idleTarget, params: P(), tmp, tmp2, onMurmur: () => {} };
  for (const p of S.venue.people) p.update(dt, now, ctx);
  if (S.venue.crowd) S.venue.crowd.update(dt, now);
  if (S.venue.instB) S.venue.instB.update();
  S.venue.theme.update(dt, now);
  if (now - CHECK.last < 0.5) return;
  CHECK.last = now;
  const fps = CHECK.frames.map(([, d]) => 1 / Math.max(1e-3, d));
  const avg = fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : 0;
  const low = fps.length ? [...fps].sort((a, b) => a - b)[Math.floor(fps.length * 0.05)] : 0;
  const session = renderer.xr.getSession();
  const target = session && session.frameRate ? session.frameRate : null;
  const rates = session && session.supportedFrameRates ? [...session.supportedFrameRates].join('/') : '–';
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  let res = `${size.x}×${size.y}`;
  const layer = session && session.renderState && session.renderState.baseLayer;
  if (layer && layer.framebufferWidth) res = `${layer.framebufferWidth}×${layer.framebufferHeight} (양안)`;
  const ctrl = {};
  if (session) for (const src of session.inputSources) ctrl[src.handedness] = src.hand ? '손' : src.gamepad ? '컨트롤러' : '기타';
  const handInfo = ['left', 'right'].map((side) => {
    const h = hands[side];
    if (!h || !h.joints) return `${side === 'left' ? '왼손' : '오른손'} 없음`;
    const n = Object.values(h.joints).filter((j) => j.visible).length;
    const a = h.joints['thumb-tip'], b = h.joints['index-finger-tip'];
    const pinch = a && b ? a.position.distanceTo(b.position) < 0.02 : false;
    return `${side === 'left' ? '왼손' : '오른손'} 관절 ${n}개${pinch ? ' · 집기 인식' : ''}`;
  }).join(' · ');
  const ac = audio.ctx;
  const latency = Math.round(((ac.baseLatency || 0) + (ac.outputLatency || 0)) * 1000);
  const ok = (cond) => (cond ? '✓' : '✗');
  const goal = target || (session ? 72 : 60);
  const r = CHECK.result = {
    date: new Date().toISOString(), userAgent: navigator.userAgent, vr: !!session,
    fpsAvg: Math.round(avg), fps5pct: Math.round(low), targetFps: target, supportedFrameRates: rates, resolution: res,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, qualityLevel: Q.level,
    controllers: ctrl, hands: handInfo, audioSampleRate: ac.sampleRate, audioLatencyMs: latency,
    heartRate: S.hr.simulated ? '시뮬레이션' : S.hr.name, mic: S.mic ? S.mic.level : (CHECK.micError || '사용 안 함'),
  };
  CHECK.lines = [
    `${ok(avg >= goal * 0.9)} 프레임 평균 ${r.fpsAvg}fps · 하위 5% ${r.fps5pct}fps (목표 ${goal}Hz)`,
    `   지원 주사율 ${rates} · 해상도 ${res}`,
    `   그리기 호출 ${r.drawCalls} · 삼각형 ${(r.triangles / 1000).toFixed(0)}k · 품질 단계 ${Q.level}`,
    `${session ? ok(Object.keys(ctrl).length) : '·'} 입력 ${session ? (Object.entries(ctrl).map(([k, v]) => `${k === 'left' ? '왼' : '오른'}${v}`).join(' · ') || '없음') : 'PC (키보드·마우스)'}`,
    `   ${handInfo}${Object.keys(CHECK.buttons).length ? ' · 버튼 ' + Object.entries(CHECK.buttons).map(([k, v]) => `${k === 'left' ? 'L' : 'R'}[${v.join(',')}]`).join(' ') : ''}`,
    `${ok(latency < 60)} 소리 ${ac.sampleRate}Hz · 지연 ${latency}ms${CHECK.lastSound ? ` · 방금 ${CHECK.lastSound}에서 박수` : ''}`,
    `${S.irInfo && S.irInfo.kind === '실측' ? '✓' : '·'} ${irLabel()}`,
    `${S.hr.simulated ? '·' : '✓'} 심박 ${r.heartRate} ${Math.round(S.hr.bpm)} bpm · 악기 입력 ${S.mic ? S.mic.level.toFixed(3) : r.mic}`,
  ];
  const help = S.vr ? '오른손 트리거: 소리 방향 시험 · 왼손 X: 끝내기' : 'Space: 소리 방향 시험 · W/A/S/D·마우스로 둘러보기 · Q: 끝내기';
  if (S.vr) panel.show('기기 점검 · 페스티벌 공연장', CHECK.lines, { footer: help, small: true, keepPlace: true });
  else $('#checkText').textContent = `기기 점검 · 페스티벌(가장 무거운 공연장)\n\n${CHECK.lines.join('\n')}\n\n${help}`;
}
