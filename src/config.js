// StageOn 프로토타입 설정값
// 보고서 4장(현실감 구현 상세)과 4-3(불안 강도 조절)의 수치를 그대로 옮긴 것이다.

export const LEVELS = {
  1: {
    id: 1,
    name: '연습실',
    desc: '친구 3명 (우호적)',
    venue: { width: 8, depth: 6, height: 3, floorDrop: 0, reverbSec: 0.5, ir: { file: 'assets/ir/lv1_rehearsal_room.wav', name: '연습실 (UCF 오디오 동아리방)', rt60: 0.75 }, wall: 0x3a3f4c, houseLight: 0.5 },
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
    behaviors: { perMin: 2, stern: 0, weights: { whisper: 1, scroll: 1 } },
    backstageSec: 20,
  },
  2: {
    id: 2,
    name: '카페 공연',
    desc: '관객 20명 (무관심)',
    venue: { width: 10, depth: 9, height: 3.2, floorDrop: 0.3, reverbSec: 0.9, ir: { file: 'assets/ir/lv2_cafe.wav', name: '카페 로비 (Tall Coffee Shop)', rt60: 0.9 }, wall: 0x5a4030, houseLight: 0.32 },
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
    behaviors: { perMin: 3, stern: 0, weights: { scroll: 3, whisper: 2, leave: 1, cough: 1 } },
    backstageSec: 30,
  },
  3: {
    id: 3,
    name: '라이브 클럽',
    desc: '관객 100명 + 촬영',
    venue: { width: 14, depth: 16, height: 5, floorDrop: 1.0, reverbSec: 1.4, ir: { file: 'assets/ir/lv3_club.wav', name: '연회장 PA 공연 (Orlando Ballroom)', rt60: 0.95 }, wall: 0x1c1b24, houseLight: 0.18 },
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
    behaviors: { perMin: 4, stern: 2, weights: { film: 2, whisper: 2, scroll: 1, leave: 1, cough: 1 } },
    backstageSec: 40,
  },
  4: {
    id: 4,
    name: '오디션',
    desc: '심사위원 3명 + 관객 12명',
    venue: { width: 12, depth: 14, height: 6, floorDrop: 1.0, reverbSec: 1.6, ir: { file: 'assets/ir/lv4_audition_hall.wav', name: '울림 큰 홀 (Royal Ballroom)', rt60: 1.8 }, wall: 0xd9d9dc, houseLight: 0.35 },
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
    behaviors: { perMin: 4, stern: 3, weights: { whisper: 2, stern: 2, cough: 1, film: 1 } },
    backstageSec: 45,
  },
  5: {
    id: 5,
    name: '페스티벌',
    desc: '관객 500명 + 예측 불가 사건',
    venue: { width: 30, depth: 40, height: 12, floorDrop: 1.4, reverbSec: 2.2, ir: { file: 'assets/ir/lv5_outdoor_stage.wav', name: '야외 무대 (Rockefeller Gardens)', rt60: 0.35 }, wall: 0x101018, houseLight: 0.15 },
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
    behaviors: { perMin: 5, stern: 2, weights: { film: 3, whisper: 1, scroll: 1, leave: 1, cough: 1 } },
    backstageSec: 45,
  },
};

// 관객 행동 (교수님 피드백: 관객이 '어떻게' 불안을 만드는지 구체화)
// cue: 실험에서 이 단서를 끄면 함께 꺼지는 범주 (E1 시선 · E2 평가 · E3 실수 반응 · E4 사건)
export const BEHAVIORS = {
  film:    { label: '휴대폰을 들어 나를 촬영', why: '기록으로 남는다 → 평가 불안', cue: 'eval' },
  stern:   { label: '팔짱 끼고 무표정으로 지켜봄', why: '판단당하는 느낌 → 평가 불안', cue: 'eval' },
  whisper: { label: '옆 사람과 손으로 입 가리고 수군거림', why: '내 얘기 같다 → 부정적 해석', cue: 'mistake' },
  scroll:  { label: '휴대폰만 보는 딴짓', why: '지루한가? → 무관심에 대한 불안', cue: 'gaze' },
  leave:   { label: '공연 중에 자리를 뜸', why: '내가 별로라서? → 거절감', cue: 'events' },
  cough:   { label: '헛기침·기침', why: '정적을 깨는 소리 → 놀람', cue: 'events' },
};
// 시선 강도: 응시 비율에 곱하는 값 (강하게 = 눈을 돌리지 않고 계속 응시)
export const GAZE_SCALE = { low: 0.5, normal: 1, high: 1.45 };

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
  recoveryMargin: 0.05,                      // 실수 직전 심박 수준 +5%p 이내로 돌아오면
  recoveryBars: 4,                           // 4마디(약 10초) 연속 유지 → 회복
  // 불안 조절 엔진 (4-3)
  targetLow: 0.20, targetHigh: 0.40,         // 목표 구간 +20–40%
  overloadRatio: 0.50, overloadHold: 15,     // +50% 15초 지속 → 완화
  underloadHold: 10,                         // 목표 미달 10초 → 장치 추가
  hrSmoothingSec: 15,                        // 15초 이동 평균
  sudsOverload: 8,
  // 공연
  bpm: 100,
  songBars: 16,                              // 한 곡 약 40초 (시나리오마다 다름)
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

// ---------- 시나리오 ----------
// 같은 단계라도 이야기가 있어야 불안이 생긴다 (몰입감 Plot).
// script: 노래의 몇 번째 마디(bar, 0부터)에서 무슨 일이 일어나는지.
// who: 'mc' 사회자 · 'staff' 무대 감독 · 'member' 밴드 멤버 · 'judge' 심사위원 · 'friend' 친구 · 'crowd' 관객
export const SCENARIOS = [
  {
    id: 'friends',
    level: 1,
    title: '친구들 앞 첫 리허설',
    story: ['다음 주 첫 공연을 앞두고', '친구 셋을 연습실에 불렀다.', '“편하게 해, 그냥 듣기만 할게.”'],
    goal: '목표: 친구들과 눈 맞추며 끝까지 연주하기',
    bars: 12,
    backstage: [
      { at: 4, who: 'friend', text: '야, 우리 다 왔어. 천천히 나와.' },
    ],
    call: (name) => `${name}, 이제 해 봐!`,
    callWho: 'friend',
    script: [
      { bar: 4, do: 'say', who: 'friend', text: '오, 좋은데?' },
      { bar: 10, do: 'clapAlong', bars: 2 },
    ],
    end: { who: 'friend', text: '야 진짜 잘한다. 실전도 이렇게만 해.' },
    encore: false,
  },
  {
    id: 'cafe',
    level: 2,
    title: '카페 오픈마이크',
    story: ['동네 카페의 오픈마이크.', '손님들은 커피를 마시며 이야기 중이다.', '아무도 나를 기다리지 않는다.'],
    goal: '목표: 관심 없는 관객 앞에서도 흔들리지 않기',
    bars: 16,
    backstage: [
      { at: 5, who: 'staff', text: '다음 순서예요. 마이크 확인하고 나가시면 돼요.' },
    ],
    call: (name) => `다음은 오픈마이크 세 번째 순서, ${name} 님입니다.`,
    script: [
      { bar: 2, do: 'event', type: 'cough' },
      { bar: 6, do: 'event', type: 'phoneRing' },
      { bar: 9, do: 'say', who: 'crowd', text: '(웃음소리) …아 진짜? 그래서?' },
      { bar: 12, do: 'attention' },
    ],
    end: { who: 'mc', text: '감사합니다. 따뜻한 박수 부탁드려요.' },
    encore: false,
  },
  {
    id: 'club',
    level: 3,
    title: '밴드 첫 클럽 공연',
    story: ['처음으로 잡은 라이브 클럽 공연.', '객석은 꽉 찼고, 앞줄은 휴대폰을 들고 있다.', '중간에 내 솔로가 있다.'],
    goal: '목표: 솔로에서 실수해도 멈추지 않고 이어가기',
    bars: 18,
    backstage: [
      { at: 4, who: 'member', text: '긴장돼? 연습한 대로만 하자.' },
      { at: 12, who: 'staff', text: '1분 뒤에 입장합니다.' },
    ],
    call: (name) => `오늘 첫 무대! ${name}와 밴드를 큰 박수로 맞아 주세요!`,
    script: [
      { bar: 0, do: 'say', who: 'member', text: '원, 투, 쓰리, 포!' },
      { bar: 6, do: 'phonesUp' },
      { bar: 8, do: 'solo', bars: 4, text: '솔로 간다!' },
      { bar: 13, do: 'event', type: 'monitorDrop' },
      { bar: 15, do: 'clapAlong', bars: 3 },
    ],
    end: { who: 'mc', text: '다 같이 박수!' },
    encore: { bars: 8, text: '앵콜! 앵콜!' },
  },
  {
    id: 'audition',
    level: 4,
    title: '대학 입시 실기',
    story: ['실용음악과 입시 실기 시험장.', '심사위원 세 명이 무표정하게 앉아 있다.', '시험은 한 번뿐이다.'],
    goal: '목표: 중간에 끊겨도 다시 집중해서 연주하기',
    bars: 16,
    backstage: [
      { at: 3, who: 'staff', text: '휴대폰은 꺼 주시고, 호명되면 바로 입장합니다.' },
      { at: 14, who: 'staff', text: '다음 수험번호 십칠 번, 준비해 주세요.' },
    ],
    call: () => '수험번호 십칠 번, 들어오세요.',
    callWho: 'staff',
    preSay: { who: 'judge', text: '준비되면 시작하세요.' },
    script: [
      { bar: 9, do: 'judgeStop', restartBars: 8, text: '네, 잠깐만요. 이 부분 다시 한 번 해 볼게요.' },
    ],
    end: { who: 'judge', text: '수고하셨습니다. 나가셔도 됩니다.' },
    encore: false,
  },
  {
    id: 'festival',
    level: 5,
    title: '여름 페스티벌 메인 무대',
    story: ['오백 명이 모인 여름 페스티벌.', '앞 팀의 앵콜 함성이 아직 남아 있다.', '무대에서는 무슨 일이든 생긴다.'],
    goal: '목표: 예상 못 한 사고에도 공연을 끝까지 이끌기',
    bars: 20,
    backstage: [
      { at: 4, who: 'staff', text: '앞 팀 끝났습니다. 장비 세팅 들어갑니다.' },
      { at: 14, who: 'member', text: '사람 진짜 많다… 우리 할 수 있어.' },
    ],
    call: (name) => `여러분 소리 질러! 다음 무대, ${name}!`,
    script: [
      { bar: 0, do: 'say', who: 'member', text: '갑니다!' },
      { bar: 5, do: 'event', type: 'monitorDrop' },
      { bar: 9, do: 'solo', bars: 4, text: '솔로!' },
      { bar: 14, do: 'event', type: 'flicker' },
      { bar: 16, do: 'clapAlong', bars: 4 },
    ],
    end: { who: 'mc', text: '대박! 다시 한 번 큰 박수!' },
    encore: { bars: 8, text: '앵콜! 앵콜!' },
  },
];
