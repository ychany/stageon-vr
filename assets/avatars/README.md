# 관객 아바타

- 출처: Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), MIT License (LICENSE-MIT.md)
- 아바타: Female_Adult_01/03/05/08/09/12/17, Male_Adult_01/03/06/08/09/10/16 의 `_facial.fbx`
- 변환: FBX → glTF(GLB). 표정 블렌드셰이프 8개(blink, smile, frown, browDown, browUp, jawOpen, squint, press)만 남기고 정점 병합, 텍스처는 머리 1024px·몸 512px JPEG
- 동작(anims.glb): `all_animations_max_motextr_static`의 서기·앉기·박수·환호·촬영·문자·대화·듣기·웃기·하품·두리번·기침·심사(테이블) 동작과 `motextr_xy`의 걷기, 10fps로 줄이고 손가락 트랙 제거
