# 공연장 잔향 (실측 임펄스 응답)

실제 공간에서 녹음한 임펄스 응답(IR)을 단계별 공연장에 씁니다. 출처: **Conner's Impulse Response Library v2.0.0**
(https://github.com/itsmusician/IR-Library, MIT License, `LICENSE-MIT.md`).
48kHz로 바꾸고, 직접음 직전부터 −60dB 지점까지 잘라 끝을 50ms 페이드, 최대값을 맞췄습니다.

| 파일 | 원본 | 실측 RT60 (대략) | 쓰는 무대 |
|---|---|---|---|
| lv1_rehearsal_room.wav | Old Audio Engineering Club Room (UCF) | 0.75초 | Lv1 연습실 |
| lv2_cafe.wav | Tall Coffee Shop Lobby | 0.9초 | Lv2 카페 |
| lv3_club.wav | Orlando Ballroom PA (Mono) | 0.95초 | Lv3 라이브 클럽 |
| lv4_audition_hall.wav | Royal Ballroom | 1.8초 | Lv4 입시 실기장 |
| lv5_outdoor_stage.wav | Rockefeller Gardens Field Stage | 0.35초 | Lv5 야외 페스티벌 |

RT60은 에너지 감쇠 곡선의 −5 → −25dB 기울기로 추정했습니다(T20).
