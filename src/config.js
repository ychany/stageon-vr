// StageOn 프로토타입 설정값
// 보고서 4장(현실감 구현 상세)과 4-3(불안 강도 조절)의 수치를 그대로 옮긴 것이다.

export const LEVELS = {
  1: {
    id: 1,
    name: '연습실',
    desc: '친구 3명 (우호적)',
    venue: { width: 8, depth: 6, height: 3, floorDrop: 0, reverbSec: 0.5, wall: 0x2b2a33, houseLight: 0.5 },
    frontRows: 1, frontPerRow: 3, midRows: 0, midPerRow: 0, crowd: 0,
    mood: 'friendly',
    gazeRatio: 0.5,          // E1 앞줄 응시 비율
    reaction: 0.25,          // E3 실수 반응 강도 (0~1)
    phones: 0,               // E2 촬영 인원
    judges: false,           // E2 심사위원
    band: false,
    heartbeat: false,        // E5 심박 되비추기
    timePressure: false,     // E4 시간 압박 큐
    eventsPerSong: 0,        // E4 예측 불가 사건
    backstageSec: 20,
  },
  2: {
    id: 2,
    name: '카페 공연',
    desc: '관객 20명 (무관심)',
    venue: { width: 10, depth: 9, height: 3.2, floorDrop: 0.3, reverbSec: 0.9, wall: 0x3a2e26, houseLight: 0.32 },
    frontRows: 1, frontPerRow: 6, midRows: 2, midPerRow: 7, crowd: 0,
    mood: 'indifferent',
    gazeRatio: 0.55,
    reaction: 0.45,
    phones: 1,
    judges: false,
    band: true,
    heartbeat: false,
    timePressure: false,
    eventsPerSong: 0,
    backstageSec: 30,
  },
  3: {
    id: 3,
    name: '라이브 클럽',
    desc: '관객 100명 + 촬영',
    venue: { width: 14, depth: 16, height: 5, floorDrop: 1.0, reverbSec: 1.4, wall: 0x1c1b24, houseLight: 0.18 },
    frontRows: 2, frontPerRow: 10, midRows: 6, midPerRow: 13, crowd: 0,
    mood: 'neutral',
    gazeRatio: 0.7,
    reaction: 0.65,
    phones: 5,
    judges: false,
    band: true,
    heartbeat: true,
    timePressure: true,
    eventsPerSong: 1,
    backstageSec: 40,
  },
  4: {
    id: 4,
    name: '오디션',
    desc: '심사위원 3명 + 관객 12명',
    venue: { width: 12, depth: 14, height: 6, floorDrop: 1.0, reverbSec: 1.6, wall: 0x22222a, houseLight: 0.2 },
    frontRows: 1, frontPerRow: 6, midRows: 1, midPerRow: 6, crowd: 0,
    mood: 'cold',
    gazeRatio: 0.8,
    reaction: 0.85,
    phones: 2,
    judges: true,
    band: true,
    heartbeat: true,
    timePressure: true,
    eventsPerSong: 1,
    backstageSec: 45,
  },
  5: {
    id: 5,
    name: '페스티벌',
    desc: '관객 500명 + 예측 불가 사건',
    venue: { width: 30, depth: 40, height: 12, floorDrop: 1.4, reverbSec: 2.2, wall: 0x101018, houseLight: 0.15 },
    frontRows: 2, frontPerRow: 14, midRows: 4, midPerRow: 18, crowd: 400,
    mood: 'neutral',
    gazeRatio: 0.75,
    reaction: 1.0,
    phones: 10,
    judges: false,
    band: true,
    heartbeat: true,
    timePressure: true,
    eventsPerSong: 3,
    backstageSec: 45,
  },
};

// 보고서 4-2 / 4-3 / 4-6 수치
export const TUNING = {
  // E1 시선
  glanceAwayMin: 2.0, glanceAwayMax: 5.0,   // 각자 2–5초마다 잠깐 시선 이동
  glanceAwayDur: 0.8,
  mutualGazeHold: 1.0,                       // 1초 이상 보면
  mutualGazeReact: 0.5,                      // 0.5초 이내 눈맞춤
  mutualGazeAngleDeg: 7,
  gazeAvoidPitchDeg: -28,                    // 이보다 아래를 보면 시선 회피
  gazeAvoidHold: 3.0,
  // E3 실수
  reactionDelayMin: 0.3, reactionDelayMax: 1.5,  // 0.3–1.5초, 앞줄부터
  timingErrorSec: 0.05,                      // 박자 오차 50ms 이상
  silenceSec: 3.0,                           // 정적 3초 → 술렁임
  // E5 심박
  heartbeatOnRatio: 0.30,                    // 기준선 +30% 이상
  recoveryRatio: 0.10,                       // 기준선 +10% 이내
  recoveryBars: 8,                           // 8마디 연속
  // 불안 조절 엔진 (4-3)
  targetLow: 0.20, targetHigh: 0.40,         // 목표 구간 +20–40%
  overloadRatio: 0.50, overloadHold: 15,     // +50% 15초 지속 → 완화
  underloadHold: 10,                         // 목표 미달 10초 → 장치 추가
  hrSmoothingSec: 15,                        // 15초 이동 평균
  sudsOverload: 8,
  // 공연
  bpm: 100,
  songBars: 40,
  countInBeats: 4,
  moodHoldSec: 5,                            // 분위기는 같은 상태 5초 이상일 때 전환
};

export const STAGE = {
  stageMarkZ: -2.2,       // 대기실 시작점에서 무대 중앙까지 실제로 걷는 거리(m)
  curtainZ: -0.7,
  stageFrontZ: -3.6,
  audienceStartZ: -4.6,
  backstageBackZ: 1.6,
  stageWidth: 7,
};
