// StageOn 프로토타입: 공연 타임라인(대기실 → 호명 → 정적 → 연주 → 종료 → 리포트)과 불안 장치 연결
import * as THREE from 'three';
import { LEVELS, TUNING, STAGE, SCENARIOS } from './config.js?v=202611202256';
import { buildVenue } from './venue.js?v=202611202256';
import { AudioEngine } from './audio.js?v=202611202256';
import { BluetoothHeartRate, SimulatedHeartRate } from './heart.js?v=202611202256';
import { InstrumentInput } from './mic.js?v=202611202256';
import { MovingAverage, StressorDirector, RecoveryTracker, TimingJudge, reactionDelay } from './director.js?v=202611202256';
import { FloatingPanel, drawReport } from './ui.js?v=202611202256';
import { Person, rand } from './figures.js?v=202611202256';
import { Instrument, InstrumentSound } from './instrument.js?v=202611202256';

const $ = (s) => document.querySelector(s);
// ?fast=1 : 시연·테스트용으로 대기실과 곡 길이를 줄인다
const FAST = new URLSearchParams(location.search).has('fast');
if (FAST) {
  Object.values(LEVELS).forEach((l) => { l.backstageSec = 6; });
  SCENARIOS.forEach((sc) => { sc.bars = Math.min(sc.bars, 12); sc.backstage.forEach((b) => { b.at = Math.min(b.at * 0.3, 5); }); if (sc.encore) sc.encore.bars = 4; });
}
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
  ctx.font = '700 40px "Noto Sans KR", sans-serif'; ctx.fillStyle = '#F2B544';
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
};
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), userHead = new THREE.Vector3();

// ---------- 시작 화면 ----------
$('#scenarios').innerHTML = SCENARIOS.map((sc, i) => `
  <label class="scenario"><input type="radio" name="scenario" value="${i}" ${i === 2 ? 'checked' : ''}>
    <span><b>${sc.title}</b> <span class="lv">Lv${sc.level} ${LEVELS[sc.level].name}</span><br>
    <span class="story">${sc.story.join(' ')}</span></span></label>`).join('');
let photoTexture = null;
$('#photo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; photoTexture = t; $('#photoName').textContent = f.name; });
});

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
$('#startVR').addEventListener('click', () => begin(true));

async function begin(vr) {
  const sc = SCENARIOS[Number($('input[name=scenario]:checked').value)];
  const level = LEVELS[sc.level];
  S.sc = sc;
  S.cues = { gaze: $('#cueGaze').checked, eval: $('#cueEval').checked, mistake: $('#cueMistake').checked, events: $('#cueEvents').checked, body: $('#cueBody').checked };
  S.helper = $('#helper').checked;
  S.name = $('#name').value.trim() || '연주자';
  S.level = level;
  S.vr = vr;
  $('#menu').hidden = true;
  $('#hud').hidden = false;

  await audio.init(level);
  S.hr = btHR || new SimulatedHeartRate(72);
  if ($('#useMic').checked) {
    try {
      S.mic = new InstrumentInput(audio);
      await S.mic.enable({ reverbMonitor: $('#reverbMonitor').checked });
      S.mic.onOnset = onOnset;
    } catch (e) { S.mic = null; log(`악기 입력 실패: ${e.message}`); }
  }

  S.venue = buildVenue(scene, level);
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
  p.neck.add(face);
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
    if (L.timePressure && !S.sc.backstage.some((b) => b.who === 'staff')) setTimeout(() => S.phase === 'backstage' && speak('staff', '5분 전입니다. 준비해 주세요.'), 3000);
  }
  if (ph === 'call') {
    if (!Number.isFinite(S.baseline)) S.baseline = computeBaseline();
    panel.show('무대로 나가세요', ['사회자가 이름을 불렀습니다.', '바닥의 노란 표시까지 걸어 나가세요.'], { footer: '가상 이동 없이 실제로 걸어서 입장합니다' });
    speak('mc', S.sc.call(S.name), 4);
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
    const bars = S.encoreDone ? S.sc.encore.bars : S.sc.bars;
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

function startSong(bars, withScript) {
  const barSec = 4 * 60 / TUNING.bpm;
  audio.startBand({
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
    S.mistakes.push(S.t); S.tracker.onMistake(S.t);
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
  const now = S.t;
  S.mistakes.push(now);
  S.tracker.onMistake(now);
  log(`실수 (${source})`);
  spikeHR(0.12);
  const p = P();
  S.murmurBudget = 5;
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
}

function onMurmur(person) {
  if (S.murmurBudget > 0 && person.tier === 'A') {
    S.murmurBudget--;
    audio.murmur(person.headWorld(tmp).clone(), 1.5, 0.5);
  }
}

function onRecovered(dur) {
  log(`회복 (${dur.toFixed(1)}초)`);
  S.venue.people.forEach((p) => { if (!p.member && !p.judge) { p.watcher = Math.random() < P().gazeRatio + 0.1; if (Math.random() < 0.3) p.react('cheer', rand(0.3, 1.2), 1.5); } });
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
  if (type === 'cough' && aud.length) audio.cough(aud[Math.floor(Math.random() * aud.length)].headWorld(tmp).clone());
  if (type === 'flicker') {
    const s = S.venue.spot, base = s.intensity;
    // 깜빡임은 초당 3회를 넘지 않게
    [0, 400, 800].forEach((ms, i) => setTimeout(() => { s.intensity = i % 2 ? base : base * 0.2; }, ms));
    setTimeout(() => { s.intensity = base; }, 1100);
  }
  if (type === 'lateComer') {
    const p = new Person({ tier: 'A', row: 9 });
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
  else if (S.phase === 'perform') { audio.stopBand(); log('연주 건너뛰기'); setPhase('finish'); }
  else if (S.phase === 'encore') { S.encoreDone = true; setPhase('suds'); }
  else if (S.phase === 'finish') setPhase('suds');
}
$('#skipBtn').addEventListener('click', skip);

// ---------- 입력: PC ----------
const keys = new Set();
let yaw = 0, pitch = 0;
renderer.domElement.addEventListener('click', () => { if (!S.vr && S.phase !== 'menu' && S.phase !== 'report') renderer.domElement.requestPointerLock(); });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.4, 1.4);
});
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (S.phase === 'menu') return;
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
window.stageon = { mistake: () => onMistake('수동 입력'), state: S, setPhase, emergencyStop, camera, look: (y, p) => { yaw = y; pitch = p; } };

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
function pollXRInput() {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const prev = prevButtons.get(src) || [];
    const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed && !prev[i];
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
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  S.t += dt;
  if (!S.vr) desktopMove(dt);
  else pollXRInput();
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(userHead);
  if (S.phase !== 'menu' && S.venue) step(dt, cam);
  panel.update(cam, dt);
  renderer.render(scene, camera);
}

function step(dt, cam) {
  const L = S.level, now = S.t;
  audio.updateListener(cam);
  if (subtitle.mesh.visible && now > subtitle.until) { subtitle.mesh.visible = false; $('#subtitle').hidden = true; }

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
    breathingGuide(ratio, now);
  }

  // 지연 실행
  for (let i = S.pending.length - 1; i >= 0; i--) if (now >= S.pending[i].at) { S.pending[i].fn(); S.pending.splice(i, 1); }

  // 인물 업데이트
  const ctx = { userHead, idleTarget: S.venue.idleTarget, params: P(), tmp, tmp2, onMurmur };
  for (const p of S.venue.people) {
    if (p.walk) {
      const k = Math.min(1, (now - p.walk.start) / p.walk.dur);
      p.root.position.lerpVectors(p.walk.from, p.walk.to, k);
      p.body.position.y = Math.abs(Math.sin(now * 7)) * 0.03;
      if (k >= 1) p.walk = null;
    }
    p.update(dt, now, ctx);
  }
  if (S.venue.crowd) S.venue.crowd.update(dt, now);
  if (S.inst) S.inst.update(dt);
  $('#skipBtn').hidden = !['backstage', 'perform', 'encore'].includes(S.phase);

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
    baseline: S.baseline, baselineSource: S.baselineSource, mic: !!S.mic,
    hr: S.hrLog, mistakes: S.mistakes, recoveries: S.tracker.recoveries,
    peakRatio: S.peakRatio,
    gazeAvoidRatio: S.performTime ? S.gazeAvoid / S.performTime : 0,
    eyeContacts: S.eyeContacts, director: S.director.log, events: S.events, suds: S.sudsLog,
    sudsPost: S.sudsPost ?? null, cues: S.cues, meanRatio: meanPerformRatio(),
  };
}
function meanPerformRatio() {
  const v = S.hrLog.filter((p) => p.phase === 'perform' && Number.isFinite(p.ratio)).map((p) => p.ratio);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
function showReport() {
  audio.setHeartbeatVolume(0);
  audio.setCrowdLevel(0.15, 2);
  const data = reportData();
  const prev = loadHistory().filter((h) => h.scenario === data.scenario);
  data.session = prev.length + 1;
  data.prevMeanRatio = prev.length ? prev[prev.length - 1].meanRatio : null;
  saveHistory({
    date: new Date().toISOString(), scenario: data.scenario, level: data.level, meanRatio: data.meanRatio,
    peakRatio: data.peakRatio, mistakes: data.mistakes.length, suds: data.sudsPost,
    recovery: data.recoveries.length ? data.recoveries.reduce((a, b) => a + b, 0) / data.recoveries.length : null,
    simulated: S.hr.simulated, cues: S.cues,
  });
  const rows = [...prev.slice(-4), { date: new Date().toISOString(), meanRatio: data.meanRatio, mistakes: data.mistakes.length, suds: data.sudsPost, now: true }];
  const pct = (r) => (Number.isFinite(r) ? `${r >= 0 ? '+' : ''}${Math.round(r * 100)}%` : '–');
  $('#history').innerHTML = `<b>${data.scenario} 회차별 기록</b><table><tr><th>회차</th><th>날짜</th><th>연주 중 평균 심박</th><th>실수</th><th>SUDs</th></tr>${
    rows.map((r, i) => `<tr${r.now ? ' class="now"' : ''}><td>${data.session - rows.length + 1 + i}</td><td>${new Date(r.date).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${pct(r.meanRatio)}</td><td>${r.mistakes}</td><td>${r.suds ?? '–'}</td></tr>`).join('')}</table>`;
  const c = $('#reportCanvas');
  drawReport(c, data);
  panel.showCanvas(c);
  $('#report').hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('#download').onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stageon_Lv${data.level}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
  };
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
const PHASE = { menu: '시작 전', backstage: '대기실', call: '호명·입장', hush: '첫 소절 직전', perform: '연주 중', encore: '앵콜 요청', finish: '종료', suds: '불안 점수', report: '리포트', stopped: '비상 정지' };
function updateHud(ratio) {
  if (!S.level) return;
  const p = S.director ? P() : {};
  const r = Number.isFinite(ratio) ? `${ratio >= 0 ? '+' : ''}${Math.round(ratio * 100)}%` : '–';
  $('#hudText').textContent = `Lv${S.level.id} ${S.level.name} · ${PHASE[S.phase]} · 심박 ${Math.round(S.hr ? S.hr.bpm : 0)} (${r})${S.hr && S.hr.simulated ? ' 시뮬레이션' : ''}`;
  $('#hudSub').textContent = S.phase === 'call' ? '노란 표시까지 걸어 나가세요 (W, 또는 N으로 바로 이동)' : S.phase === 'backstage' ? '대기 중 · Space로 악기 풀기 · N 건너뛰기' : S.phase === 'perform' ? `Space로 박자에 맞춰 연주 · N 건너뛰기 · 연주 ${S.strums}번` : '';
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
