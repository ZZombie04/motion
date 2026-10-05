---
name: motion
description: 말로 설명한 장면을 감독 수준의 모션그래픽 영상(MP4·GIF·WebM·투명 MOV)으로 만든다. 사용자가 카메라 기법이나 모션 용어를 몰라도, 요청을 스스로 리프롬프트(연출 트리트먼트)해 최적의 카메라·타이포·전환·리듬을 고르고, 결정적 HTML+GSAP 컴포지션을 작성·자동 점검·프레임 검수한 뒤 실제 모션 블러로 렌더한다. Use for motion graphics, animated video scenes, Shorts/Reels/TikTok intros, kinetic typography, UI·app demo animations, logo stings, end cards, title cards, animated explainers, data/number animations, lower-thirds, scene transitions. 트리거 — 모션그래픽, 모션 그래픽, 영상 인트로, 오프닝, 쇼츠, 릴스, 타이포 애니메이션, 키네틱 타이포, 로고 스팅, 엔드카드, 화면 데모 영상, 숫자 강조 영상, 장면 전환, 움직이는 그래픽, 애니메이션 영상 만들어줘, mp4로 만들어줘.
---

# Motion Director

사용자는 **장면만** 말한다. 카메라·이징·전환·타이포·리듬은 전부 이 스킬이 감독으로서 정한다.
결과물은 "움직이는 슬라이드"가 아니라 **연출된 영상**이어야 한다 — 보는 사람이 감탄하는 수준이 기준이다.

> 실행 파일: 이 스킬 폴더의 `bin/motion.mjs`. 아래에서 `motion …`은 `node "<이 스킬 폴더>/bin/motion.mjs" …`를 뜻한다.
> MCP 도구(`motion_brief`, `motion_new`, `motion_check`, `motion_sheet`, `motion_frames`, `motion_render` …)가 연결돼 있으면 같은 이름의 도구를 쓴다.
> 처음 한 번: 스킬 폴더에서 `npm install`, 이어서 `motion doctor`(Chrome·ffmpeg 확인).

## 1. 작업 순서 — 반드시 이 순서

| 단계 | 하는 일 | 산출물 |
|---|---|---|
| ① 해석 | 요청에서 목적·한 문장 메시지·플랫폼·길이·톤·필수 문구를 뽑는다. 빈칸은 **묻지 말고 감독으로서 정한다**(§2). `motion brief "요청 문장"`이 화면·길이·룩·연출 후보와 비트 틀을 제안해 준다 — 출발점으로만 쓴다. | 브리프 |
| ② 리프롬프트 | 브리프를 **연출 트리트먼트**로 확장한다: 로그라인 → 룩 → 타임코드 비트 시트 → 카메라·전환 계획 → 모션 감각. | 트리트먼트(사용자에게 6–12줄로 보여 주고 바로 진행) |
| ③ 작성 | `motion new`로 뼈대를 만들고 한 파일의 HTML 컴포지션을 쓴다(§3 규칙). | `*.html` |
| ④ 점검 | `motion check` — 겹침·잘림·가독성·정지 구간을 자동 측정. **오류 0**이 될 때까지 고친다. | 통과 |
| ⑤ 검수 | `motion sheet`로 콘택트 시트를 만들어 **직접 본다**. 핵심 비트는 `motion frames`로 원본 크기 확인. `references/quality.md`의 기준으로 비평하고 **최소 1회 고쳐 다시 본다**. | 수정본 |
| ⑥ 렌더 | `motion render --quality standard`(검토용) 또는 `final`(납품용). | MP4 등 |
| ⑦ 전달 | 파일 경로, 길이·해상도, 바꿀 수 있는 것(문구·색·길이·비율) 2–3가지를 짧게 알린다. | — |

단계 ⑤를 건너뛰지 않는다. 보지 않고 낸 영상은 높은 확률로 어색하다.

## 2. 리프롬프트 — 요청을 연출로 바꾸기

자세한 방법·선택표·예시는 **`references/director.md`**. 요약:

**브리프 기본값**(사용자가 말하지 않았을 때)

| 항목 | 정하는 법 |
|---|---|
| 화면 | "쇼츠·릴스·틱톡·세로" → `shorts` 1080×1920 · "유튜브·발표·가로" → `wide` 1920×1080 · "피드" → `square`/`portrait` · 본문 삽입컷 → `insert` 1080×830 · 단서 없음 → `shorts` |
| 길이 | 로고·전환 3–5초 · 한 가지 요점/인서트 5–8초 · 홍보·인트로 10–16초 · 설명 20–40초 |
| 룩 | 기본은 **검정·흰색·회색 + 포인트 한 색**. 톤에 맞는 테마와 포인트 색은 `references/look.md` 표에서 고른다 |
| 문구 | 사용자의 말을 화면용으로 줄인다(한 줄 12자 안팎, 한 비트에 한 메시지). 없는 사실·수치·로고를 지어내지 않는다 |

**트리트먼트 형식**(작성 전에 반드시 먼저 쓴다)

```
로그라인  [무엇]이 [어떻게 변해] [무엇]이 된다 — 한 문장
룩        테마 · 포인트 색 · 배경(빛) · 글꼴 쓰임 · 질감
비트      0.0–2.4  훅: …(화면에 보이는 문구는 "따옴표"로)
          2.4–5.8  전개: …
          5.8–9.0  결과: …
          9.0–12.0 엔드카드: … (마지막 1초 이상 정지해 읽을 시간)
카메라    장면마다 한 가지 움직임(예: 비스듬→정면 정착, 푸시 인, 오빗, 풀백) + 전체에 느린 드리프트
전환      장면을 잇는 물체/도형(예: 입력창→카드, 막대→밑줄, 숫자 0 통과)
모션      등장 mo.out · 퇴장 mo.in(짧게) · 카메라 mo.cam · 작은 UI만 살짝 튕김 · 포인트 색은 한 프레임에 한 곳
```

사용자가 기법을 말하지 않아도 **의도 → 기법**을 직접 고른다(전체 표: director.md §5):

| 의도 | 고르는 연출 |
|---|---|
| 주목시키기(훅) | 첫 프레임부터 움직이는 큰 숫자/단어 · 비스듬한 화면이 정면으로 정착 · 질문형 한 줄 + 형광펜 |
| 기능·과정 보여 주기 | 기기 틀 없이 화면 속 UI · 커서의 원인→결과 · 한글 자모 타이핑 · 끝 상태 1초 정지 |
| 수치·성과 | 카운트/오도미터 + 같은 감속으로 차오르는 막대 · 푸시 인 · 착지 순간 펄스 |
| 제품·기기 | 3D 폰/노트북 오빗 30–70° · 림 라이트 느낌의 빛 · 랙 포커스 |
| 설명·구조 | 선이 그려지며 노드가 켜지는 다이어그램 · 위에서 본 아이소 → 하나 들어 올리기 |
| 에너지·행사 | BPM 격자에 맞춘 하드컷 · 워드 슬램 · 휩 팬 · 테마 반전(pop) |
| 격조·감성 | 느린 패럴랙스 · 마스크 리빌 · 세리프 이탤릭 한 단어 · 레터박스 |
| 마무리 | 이어지던 도형이 로고/버튼이 됨 · 제목 2줄 + CTA · 커서 클릭으로 닫기 |

**예시에 없는 장면**도 같은 방법으로 만든다: 장면을 *주체·공간·변화·카메라·리듬*으로 분해하고, 엔진의 프리미티브(글자·도형·UI·선·숫자·빛·깊이)로 조합한다. 실물 사물이 필요하면 클립아트를 그리지 말고 **추상화**(실루엣·아이콘·타이포·사진 한 장 + 패럴랙스)한다. → director.md §11

## 3. 컴포지션 작성 규칙

```html
<div id="stage" data-width="1080" data-height="1920" data-fps="30" data-duration="12"
     data-theme="ink" data-accent="blue" data-platform="shorts">
  <div class="mo-bg"> … 빛·배경(카메라 영향 없음) … </div>
  <div class="mo-world"> … 내용(카메라가 움직이는 세계) … </div>
  <div class="mo-hud"> … 모서리 라벨(고정) … </div>
  <div class="mo-vignette"></div>
</div>
<script>
Motion.compose((M) => {
  const { tl, cam, u } = M;          // tl = 일시정지된 단 하나의 GSAP 타임라인
  M.grain(); cam.drift({ zoom: 1.05 });
  M.reveal('#title', { type: 'rise' }, 0.2);     // 마지막 인자 = 시작 시각(초)
});
</script>
```

**결정성 — 어기면 렌더가 깨진다**
- 모든 움직임은 `M.tl`(+ `M.*` 헬퍼) 위에만. 시작 시각은 **항상 숫자로 명시**한다.
- 금지: `setTimeout`·`setInterval`·`requestAnimationFrame`·`Date`·`Math.random`·CSS `animation`/`transition`·`repeat:-1`·외부 URL(폰트·CDN·이미지).
- 끝없는 움직임은 `M.float`·`M.spin`·`M.marquee`·`M.onFrame((t) => …)`. 무작위는 `M.rng(seed)`.
- 같은 요소·같은 속성에 트윈을 겹치지 않는다. 이어 붙일 땐 `fromTo` 대신 `to`를 쓰거나 래퍼를 나눈다(`immediateRender` 충돌 방지).
- 3D로 돌리는 요소의 조상은 `overflow: visible`이어야 원근이 전달된다(기기는 자동 처리, 그 밖은 `data-3d` 속성).
- `will-change`를 쓰지 않는다(확대할 때 글자가 뭉개진다). 기울인 화면·기기를 확대하는 구간은 미리보기에서 조금 흐려 보여도 된다 — `frames`·`render`가 그 프레임만 2–3배로 찍어 선명하게 만든다(3.3배까지).

**디자인 — 어기면 아마추어처럼 보인다**(이유와 대안: `references/look.md`)
- 크기는 `calc(var(--u) * n)`(1u = 짧은 변의 1%). px 고정값 금지.
- 색: 바탕·글자·회색 + **포인트 한 색**. 포인트는 한 프레임에 한 곳(많아야 두 곳). 무지개·그라디언트 글자·이모지 아이콘 금지(아이콘은 `<i data-icon="…">`).
- 글자: 제목 `mo-display/h1/h2`, 본문 `mo-body`, 라벨 `mo-label`. 제목은 2줄 이내, 세로 화면 한 줄 12자 안팎. 최소 크기 본문 3u·라벨 1.6u.
- 구도: 좌우 `var(--safe-x)` 안쪽, 쇼츠는 `.mo-safe`(상단 10.5%·하단 20% 비움). 한 비트에 초점 하나. 여백을 채우려 하지 않는다.
- 깊이: 배경은 평면색으로 두지 않는다 — `.mo-stagelight`·`.mo-horizon`·`.mo-glow`·`.mo-dotgrid` 중 1–2개 + `M.grain()` + `.mo-vignette`.

**모션 — 어기면 싸구려처럼 보인다**(전체 표: `references/motion.md`)
- 화면은 **한 프레임도 멈추지 않는다**: `cam.drift({ zoom: 1.04–1.06 })`는 기본, 긴 홀드엔 `cam.float()`·`M.float()`.
- 등장은 `mo.out`(0.7–1.1초), 퇴장은 `mo.in`으로 등장의 절반 길이, A→B 이동은 `mo.inOut`, 카메라는 `mo.cam`(1.2–2.4초). `linear`는 일정 속도 흐름에만.
- 제목은 페이드가 아니라 **마스크 리빌**(`rise`·`words`). 요소는 한꺼번에가 아니라 0.05–0.1초 **스태거**, 앞 동작이 끝나기 전에 다음이 시작(겹침).
- 튕김(`mo.spring`·`mo.pop`)은 칩·점·버튼 같은 **작은 것만**. 큰 글자·카드·카메라는 튕기지 않는다(`mo.settle`까지).
- 장면은 컷으로 끊지 말고 **같은 물체가 이어지게**(`M.morph`, `M.transition`, 줌 스루). 하드컷은 박자에 맞출 때만.
- 핵심 문구·결과 화면은 **0.8–1.2초 이상 정지해 읽게** 하고, 마지막 요소는 끝나기 1초 전에는 자리 잡는다.
- 첫 프레임이 비어 있으면 안 된다(쇼츠의 훅). 0초에 이미 무언가 움직이는 중이게 한다: `M.reveal(대상, { type: 'chars', pre: 0.4 }, 0)`.

**정직성**: 실제 제품 로고·브랜드 UI를 베끼지 않는다. 보여 주는 수치가 예시면 화면에 "예시"를 적거나 사용자에게 알린다. 실제 성능을 입증하는 것처럼 꾸미지 않는다.

## 4. 엔진 빠른 참조(전체: `references/engine.md`)

| 목적 | API |
|---|---|
| 등장 / 퇴장 | `M.reveal(대상, { type, pre, tight }, at)` — `rise` `words` `chars` `fade` `blur` `pop` `slam` `wipe` `grow` `drop` `lift` `draw` · `M.exit(대상, { type }, at)` |
| 글자 | `M.highlight(대상, at)` 형광펜 · `M.type(대상, '문장', { duration }, at)` 한글 자모 타이핑 · `M.count(대상, { from, to, pulse }, at)` · `M.odometer(대상, '1,284', at)` · `M.text(대상, [[시각, 문구] …])` · `M.fitText(대상, 폭)` · `M.stream` · `M.scramble` · `M.marquee` |
| 카메라 | `cam.to({ x, y, zoom, rx, ry, rz, dolly, focus, aperture, duration }, at)` · `cam.lookAt(대상, { zoom }, at)`(`zoom` 대신 `fill: 0.8`) · `cam.home(at)` · `cam.set()` · `cam.drift()` · `cam.float()` · `cam.punch(at)` · `cam.shake(at)` |
| 커서·터치 | `const cur = M.cursor()` → `cur.moveTo(대상, at)` `cur.click(at)` `cur.show/hide(at)` · `M.tap(대상, at)` · `M.press(대상, at)` · 기기 화면 속은 `M.cursor({ parent: '#lp .mo-screen' })` |
| 장면 | `M.scene(대상, 시작, 끝)` · `M.transition(종류, 앞, 뒤, { at })` — `push` `wipe` `iris` `zoom` `flip` `whip` `cut` · `M.morph(요소, 자리, at)` · `M.iris(대상, { from, to }, at)` · `M.follow(요소, SVG경로, at)` |
| 상태 | `M.fill(대상, { from, to }, at)` — `.mo-progress` `.mo-check` `.mo-toggle` `.mo-underline` · `M.pulse(대상, at)` |
| 무한 움직임 | `M.float` · `M.spin` · `M.dots` · `M.onFrame((t, frame) => …)` |
| 분위기 | `M.grain()` · `M.aurora()` · `M.particles()` · CSS `.mo-stagelight` `.mo-horizon` `.mo-glow` `.mo-dotgrid` `.mo-gridlines` `.mo-floor` `.mo-vignette` `.mo-letterbox` |
| 부품(CSS) | `mo-card` `mo-glass` `mo-window` `mo-input` `mo-btn` `mo-chip` `mo-list/mo-item` `mo-check` `mo-spinner` `mo-progress` `mo-bars/mo-bar` `mo-stat-num` `mo-chat/mo-bubble` `mo-terminal` `mo-code` `mo-phone` `mo-laptop` `mo-toggle` `mo-kbd` `mo-avatar` `mo-icon-tile` `mo-brackets` |
| 테마·색 | `data-theme`: `ink` `night` `paper` `white` `pop`(요소마다 다시 지정 가능) · `data-accent`: `blue` `cyan` `mint` `lime` `yellow` `amber` `orange` `red` `pink` `violet` 또는 `#hex` |
| 박자 | `const b = M.beats(120)` → `b(4)` = 4박의 초(프레임 격자에 맞춰짐) · 컷마다 `cam.punch` |
| 측정 | `M.rect(대상)` 쉬는 자리 · `M.fit(요소, 자리)` · `motion probe 파일 --at 3.2 --js "M.rect('#btn')"` |

## 5. 명령

```
motion brief "가을 운동회 홍보 쇼츠 오프닝"          # 화면·길이·룩·연출 후보 + 비트 틀 제안
motion new work/intro.html --format shorts --duration 12 --theme ink --accent blue
motion check work/intro.html                      # 오류 0이 될 때까지
motion sheet work/intro.html --count 18           # → work/out/intro.sheet.png 를 직접 본다
motion sheet work/intro.html --from 2.4 --to 3.6 --count 12   # 전환 구간만 촘촘히 · --beats 128(박마다) · --guides(안전영역) · --no-camera(쉬는 배치)
motion frames work/intro.html --at 1.2,4.5,9.8    # 원본 크기 스틸(--blur 16이면 렌더와 같은 모션 블러)
motion render work/intro.html --quality standard  # draft(빠른 확인) · standard · final(납품)
motion render work/intro.html --format gif --width 480
motion render work/overlay.html --format mov --alpha   # 투명 배경(편집 프로그램 위에 얹는 자막·로워서드)
motion preview work/intro.html                    # 브라우저에서 스크럽(Space·←→·G)
```

`--vars "title=…&n=3"`으로 문구를 바꿔 같은 컴포지션을 재사용한다(`M.var('title', '기본값')`). `--audio bgm.mp3`로 음악을 얹는다.

## 6. 참조 문서 — 필요할 때 읽는다

| 파일 | 언제 |
|---|---|
| `references/director.md` | **항상 먼저.** 리프롬프트 방법, 의도→기법 표, 길이별 비트 시트, 연속성 사전, 예시 |
| `references/look.md` | 룩을 정할 때. 테마·색·타이포·구도·빛, "아마추어 티"와 그 대안 |
| `references/motion.md` | 타이밍을 짤 때. 이징·길이·스태거 표, 카메라 어휘와 코드, 박자 맞추기 |
| `references/engine.md` | 코드를 쓸 때. 전체 API와 부품 HTML |
| `references/recipes.md` | 장면 유형별 뼈대 코드 29종(타이포·UI 데모·숫자·기기·전환·다이어그램·엔드카드 …) |
| `references/quality.md` | 검수할 때. 시트 보는 법, 점검 코드별 고치는 법, 최종 체크리스트 |
| `references/chat-mode.md` | 파일·터미널 도구가 없는 대화창에서 단일 HTML로 내야 할 때 |
| `samples/` | 완성 예시(요청 → 트리트먼트 → 코드 → 영상) |
