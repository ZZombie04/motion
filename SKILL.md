---
name: motion
description: 말로 설명한 장면을 감독 수준의 모션그래픽 영상(MP4·GIF·WebM·투명 MOV)으로 만든다. 사용자가 카메라 기법이나 모션 용어를 몰라도, 요청을 스스로 리프롬프트(연출 트리트먼트·샷 목록·합격 기준)해 최적의 카메라·타이포·전환·리듬·소리를 고르고, 결정적 HTML+GSAP 컴포지션을 작성·자동 점검·100점 채점·프레임 검수한 뒤 실제 모션 블러와 믹스된 소리로 렌더하고, 결과 파일까지 다시 본다. 음악 박자 맞추기, 단어 자막과 내레이션, 효과음, 차트, 실제 3D, 사이트에서 브랜드 가져오기, 참고 영상 분석, 표 데이터로 여러 편 만들기를 지원한다. Use for motion graphics, animated video scenes, Shorts/Reels/TikTok intros, kinetic typography, music-synced edits, captioned explainers, UI·app demo animations, product/website launch videos, logo stings, end cards, title cards, data/number animations, charts, 3D hero shots, lower-thirds, loops/GIFs, scene transitions, personalized batch videos. 트리거 — 모션그래픽, 모션 그래픽, 영상 인트로, 오프닝, 쇼츠, 릴스, 타이포 애니메이션, 키네틱 타이포, 음악에 맞춰, 박자, 자막, 내레이션, 효과음, 로고 스팅, 엔드카드, 화면 데모 영상, 앱 소개 영상, 사이트 소개 영상, 숫자 강조 영상, 차트 영상, 3D, 로워서드, 이름표, 루프, GIF, 장면 전환, 이 영상처럼, 학생별·반별로 여러 개, 애니메이션 영상 만들어줘, mp4로 만들어줘.
---

# Motion Director

사용자는 **장면만** 말한다. 카메라·이징·전환·타이포·리듬·소리는 전부 이 스킬이 감독으로서 정한다.
결과물은 "움직이는 슬라이드"가 아니라 **연출된 영상**이어야 한다 — 보는 사람이 감탄하는 수준이 기준이다.

> 실행 파일: 이 스킬 폴더의 `bin/motion.mjs`. 아래에서 `motion …`은 `node "<이 스킬 폴더>/bin/motion.mjs" …`를 뜻한다.
> MCP 도구(`motion_brief`, `motion_new`, `motion_check`, `motion_score`, `motion_sheet`, `motion_frames`, `motion_render` …)가 연결돼 있으면 같은 이름의 도구를 쓴다.
> 처음 한 번: 스킬 폴더에서 `npm install`, 이어서 `motion doctor`(Chrome·ffmpeg 확인).

## 1. 작업 순서 — 반드시 이 순서

| 단계 | 하는 일 | 산출물 |
|---|---|---|
| ① 해석 | 요청에서 목적·한 문장 메시지·플랫폼·길이·톤·필수 문구를 뽑고, **영상 종류(플레이북)**를 하나 고른다(`references/playbooks.md`). 빈칸은 **묻지 말고 감독으로서 정한다**(§2). `motion brief "요청 문장"`이 후보를 준다 — 출발점으로만. | 브리프 |
| ② 재료 | 사용자가 준 것이 있으면 먼저 잰다(§2 표): 참고 영상 → `motion analyze` · 사이트 → `motion brand` · 음악 → `motion audio` · 대본/녹음 → `motion captions` | 측정값 |
| ③ 리프롬프트 | **트리트먼트**를 쓴다: 화면 규격 → 로그라인 → 룩 → 타임코드 비트(=샷 목록) → 카메라·전환 → 소리 → **합격 기준**. | 트리트먼트(사용자에게 짧게 보여 주고 바로 진행) |
| ④ 작성 | `motion new`로 **장르 템플릿**에서 시작해(`motion templates`) 한 파일의 HTML 컴포지션을 쓴다(§3 규칙). | `*.html` |
| ⑤ 점검·채점 | `motion check` **오류 0** → `motion score` **85점 이상**(고칠 점이 점수 순으로 나온다). | 통과 |
| ⑥ 검수 | `motion sheet`로 콘택트 시트를 만들어 **직접 본다**(박자 영상은 `--beats music`, 전환은 `--from/--to`). 핵심 비트는 `motion frames`로 원본 크기. `references/quality.md` 기준으로 비평하고 **최소 1회 고쳐 다시 본다**. | 수정본 |
| ⑦ 렌더·결과 검수 | `motion render --quality standard`(검토) 또는 `final`(납품). 끝나면 결과 파일을 자동으로 검사하고 프레임 띠(`*.check.png`)를 만든다 — **그 띠를 본다**. | MP4 등 |
| ⑧ 전달 | 파일 경로, 길이·해상도, 바꿀 수 있는 것(문구·색·길이·비율·음악) 2–3가지를 짧게. | — |

⑥과 ⑦의 "보기"를 건너뛰지 않는다. 보지 않고 낸 영상은 높은 확률로 어색하다. 좋은 결과는 **렌더 → 프레임 확인 → 박자 확인 → 고치기**를 반복해서 나온다.

## 2. 리프롬프트 — 요청을 연출로 바꾸기

자세한 방법·선택표·예시는 **`references/director.md`**, 영상 종류별 흐름은 **`references/playbooks.md`**. 요약:

**브리프 기본값**(사용자가 말하지 않았을 때)

| 항목 | 정하는 법 |
|---|---|
| 화면 | "쇼츠·릴스·틱톡·세로" → `shorts` 1080×1920 · "유튜브·발표·가로" → `wide` 1920×1080 · "피드" → `square`/`portrait` · 본문 삽입컷 → `insert` 1080×830 · 영화 같은 → `cinema` 1920×804 · 단서 없음 → `shorts` |
| 길이 | 로고·전환 3–5초 · 한 가지 요점/인서트 5–8초 · 홍보·인트로 10–16초 · 설명 20–40초(내레이션이면 대본 음절 ÷ 5 + 2초) |
| 룩 | 기본은 **검정·흰색·회색 + 포인트 한 색**. 톤에 맞는 테마와 포인트 색은 `references/look.md` 표에서. 브랜드 사이트가 있으면 `motion brand`의 색 |
| 문구 | 사용자의 말을 화면용으로 줄인다(한 줄 12자 안팎, 한 비트에 한 메시지). 없는 사실·수치·로고를 지어내지 않는다 |
| 소리 | 쇼츠·홍보는 효과음 4–8곳(+ 사용자가 준 음악). 발표 화면·무음 피드는 소리 없이 |

**재료가 있으면 먼저 잰다**

| 사용자가 준 것 | 먼저 할 일 | 트리트먼트에 옮기는 것 |
|---|---|---|
| 참고 영상("이 느낌으로") | `motion analyze 참고.mp4` → 샷 시트를 직접 본다 | 평균 컷 길이, BPM, 테마·포인트 색, 구도 방식(원본 문구·이미지는 베끼지 않는다) |
| 사이트 주소 | `motion brand https://…` | 테마·포인트 색·이름·한 줄 소개·로고 |
| 음악 파일 | `motion audio 노래.mp3` | BPM, 마디 첫 박 시각 → 비트 시트 |
| 대본 / 녹음 | `motion captions plan` / `align` | 문장 시각 → 비트 시트, 단어 자막 |
| 표(CSV) | 한 편 완성 → `motion batch --data` | 바뀌는 칸을 `data-var`로 |

**트리트먼트 형식**(작성 전에 반드시 먼저 쓴다)

```
화면      1080×1920 · 13초 · 30fps · 쇼츠 · 템플릿 hook
로그라인  [무엇]이 [어떻게 변해] [무엇]이 된다 — 한 문장
룩        테마 · 포인트 색 · 배경(빛) · 글꼴 쓰임 · 질감
비트      0.0–2.4  훅: …(화면에 보이는 문구는 "따옴표"로)
          2.4–5.8  전개: …
          5.8–9.0  결과: …
          9.0–12.0 엔드카드: … (마지막 1초 이상 정지해 읽을 시간)
카메라    장면마다 한 가지 움직임(예: 비스듬→정면 정착, 푸시 인, 오빗, 풀백) + 전체에 느린 드리프트
전환      장면을 잇는 물체/도형(예: 입력창→카드, 막대→밑줄, 숫자 0 통과)
소리      음악(있으면 BPM) · 효과음 자리 4–8곳(예: 2.4 whoosh, 5.8 success, 11.2 click)
모션      등장 mo.out · 퇴장 mo.in(짧게) · 카메라 mo.cam · 작은 UI만 스프링 · 포인트 색은 한 프레임에 한 곳
합격 기준  0초 프레임에 훅 · 결과 숫자 1.2초 정지 · 엔드카드 2초 · 컷은 박 위 · 날짜·이름 원문 그대로 · 점수 85+
```

사용자가 기법을 말하지 않아도 **의도 → 기법**을 직접 고른다(전체 표: director.md §5):

| 의도 | 고르는 연출 |
|---|---|
| 주목시키기(훅) | 첫 프레임부터 움직이는 큰 숫자/단어 · 비스듬한 화면이 정면으로 정착 · 질문형 한 줄 + 형광펜 |
| 기능·과정 보여 주기 | 기기 틀 없이 화면 속 UI · 커서의 원인→결과(클릭·끌기) · 한글 자모 타이핑 · 스프링으로 늘어났다 붙는 인디케이터 · 끝 상태 1초 정지 |
| 수치·성과 | 카운트/오도미터 + 같은 감속으로 차오르는 막대·도넛(`M.chart`) · 주석 하나(`M.callout`) · 착지 순간 펄스 |
| 제품·기기 | 3D 폰/노트북 오빗 30–70° · 실제 3D 오브젝트(`M.three`) · 림 라이트 · 랙 포커스 |
| 설명·구조 | 선이 그려지며 노드가 켜지는 다이어그램 · 단어 자막 + 문장마다 바뀌는 그림 · 위에서 본 아이소 → 하나 들어 올리기 |
| 에너지·행사 | 음악의 실제 박에 맞춘 하드컷 · 워드 슬램 · 휩 팬 · 테마 반전(pop) · 섬광·빛샘 한 번 |
| 격조·감성 | 느린 패럴랙스 · 마스크 리빌 · 세리프 이탤릭 한 단어 · 레터박스 · 블러 전환 |
| 마무리 | 이어지던 도형이 로고/버튼이 됨(도형 모핑) · 제목 2줄 + CTA · 커서 클릭으로 닫기 |

**예시에 없는 장면**도 같은 방법으로 만든다: 장면을 *주체·공간·변화·카메라·리듬*으로 분해하고, 엔진의 프리미티브(글자·도형·UI·선·숫자·빛·깊이·3D·소리)로 조합한다. 실물 사물이 필요하면 클립아트를 그리지 말고 **추상화**(실루엣·아이콘·타이포·사진 한 장 + 패럴랙스, 또는 기하학적 3D)한다. → director.md §11

## 3. 컴포지션 작성 규칙

```html
<div id="stage" data-width="1080" data-height="1920" data-fps="30" data-duration="12"
     data-theme="ink" data-accent="blue" data-platform="shorts" data-bpm="120">
  <audio src="bgm.mp3" data-start="0" data-fade-out="1.5"></audio>          <!-- 있으면. 렌더가 자동으로 믹스 -->
  <div class="mo-bg"> … 빛·배경(카메라 영향 없음) … </div>
  <div class="mo-world">
    <h1 class="mo-h1" data-var="title" data-reveal="rise 0.2 pre=0.4">제목</h1>   <!-- 단순한 등장은 속성으로 -->
  </div>
  <div class="mo-hud"> … 모서리 라벨(고정) … </div>
  <div class="mo-vignette"></div>
</div>
<script>
Motion.compose((M) => {
  const { tl, cam, u } = M;          // tl = 일시정지된 단 하나의 GSAP 타임라인
  const b = M.grid();                // 박: 음악에서 잰 실제 박(없으면 data-bpm)
  M.grain(); cam.drift({ zoom: 1.05 });
  M.reveal('#sub', { type: 'words', sfx: true }, b(2));     // 마지막 인자 = 시작 시각(초 또는 박)
});
</script>
```

**결정성 — 어기면 렌더가 깨진다**
- 모든 움직임은 `M.tl`(+ `M.*` 헬퍼, `data-*` 속성) 위에만. 시작 시각은 **항상 숫자(또는 박 토큰 `b8`)로 명시**한다.
- 금지: `setTimeout`·`setInterval`·`requestAnimationFrame`·`Date`·`Math.random`·CSS `animation`/`transition`·`repeat:-1`·외부 URL(폰트·CDN·이미지·음악).
- 끝없는 움직임은 `M.float`·`M.spin`·`M.marquee`·`M.onFrame((t) => …)`. 무작위는 `M.rng(seed)`. 3D도 `M.three`가 돌려주는 `(t) => …` 안에서 t만으로.
- 같은 요소·같은 속성에 트윈을 겹치지 않는다(속성과 JS를 한 요소에 같이 걸지 않는다). 이어 붙일 땐 `to`를 쓰거나 래퍼를 나눈다.
- 3D로 돌리는 요소의 조상은 `overflow: visible`이어야 원근이 전달된다(기기는 자동 처리, 그 밖은 `data-3d` 속성).
- `will-change`를 쓰지 않는다. 기울인 화면을 확대하는 구간은 미리보기에서 조금 흐려 보여도 된다 — `frames`·`render`가 그 프레임만 2–3배로 찍어 선명하게 만든다(3.3배까지).

**디자인 — 어기면 아마추어처럼 보인다**(이유와 대안: `references/look.md`)
- 크기는 `calc(var(--u) * n)`(1u = 짧은 변의 1%). px 고정값 금지.
- 색: 바탕·글자·회색 + **포인트 한 색**. 포인트는 한 프레임에 한 곳(많아야 두 곳). 무지개·그라디언트 글자·이모지 아이콘 금지(아이콘은 `<i data-icon="…">`).
- 글자: 제목 `mo-display/h1/h2`, 본문 `mo-body`, 라벨 `mo-label`. 제목은 2줄 이내, 세로 화면 한 줄 12자 안팎. 최소 크기 본문 3u·라벨 1.6u.
- 구도: 좌우 `var(--safe-x)` 안쪽, 쇼츠는 `.mo-safe`(상단 10.5%·하단 20% 비움). 한 비트에 초점 하나. 여백을 채우려 하지 않는다.
- 깊이: 배경은 평면색으로 두지 않는다 — `.mo-stagelight`·`.mo-horizon`·`.mo-glow`·`.mo-dotgrid` 중 1–2개 + `M.grain()` + `.mo-vignette`.
- **하지 않는 것**: 큰 글자·카드에 튕기는 이징 · 아무 데나 입자 폭발과 글로 · UI 크롬에 그라디언트 · 굵기가 섞인 아이콘 · 아무 일도 없는 죽은 시간 · 템플릿 티 나는 가운데 정렬 나열.

**모션 — 어기면 싸구려처럼 보인다**(전체 표: `references/motion.md`)
- 화면은 **한 프레임도 멈추지 않는다**: `cam.drift({ zoom: 1.04–1.06 })`는 기본, 긴 홀드엔 `cam.float()`·`M.float()`.
- 등장은 `mo.out`(0.7–1.1초), 퇴장은 `mo.in`으로 등장의 절반 길이, A→B 이동은 `mo.inOut`, 카메라는 `mo.cam`(1.2–2.4초). UI의 탄성은 `M.spring('snappy')`. `linear`는 일정 속도 흐름에만.
- 제목은 페이드가 아니라 **마스크 리빌**(`rise`·`words`). 요소는 한꺼번에가 아니라 0.05–0.1초 **스태거**, 앞 동작이 끝나기 전에 다음이 시작(겹침).
- 튕김(`mo.spring`·`mo.pop`·`bouncy`)은 칩·점·버튼 같은 **작은 것만**. 큰 글자·카드·카메라는 튕기지 않는다.
- 장면은 컷으로 끊지 말고 **같은 물체가 이어지게**(`M.morph`, `M.morphPath`, `M.transition`, 줌 스루). 하드컷은 박자에 맞출 때만.
- 핵심 문구·결과 화면은 **0.8–1.2초 이상 정지해 읽게** 하고, 마지막 요소는 끝나기 1초 전에는 자리 잡는다.
- 첫 프레임이 비어 있으면 안 된다(쇼츠의 훅). 0초에 이미 무언가 움직이는 중이게 한다: `pre: 0.4`.

**소리 — 움직임의 마침표**(`references/sound.md`)
- 효과음은 화면에서 무언가 닿고·열리고·바뀌는 순간에만, 10초에 4–8개. 작은 등장은 조용히.
- 도우미에 `sfx: true`면 어울리는 소리가 정확한 프레임에 붙는다. 음악은 `<audio>`, 목소리는 `data-role="voice"`(음악이 자동으로 내려간다).

**정직성**: 실제 제품 로고·브랜드 UI를 베끼지 않는다. 보여 주는 수치가 예시면 화면에 "예시"를 적거나 사용자에게 알린다. 실제 성능을 입증하는 것처럼 꾸미지 않는다. 출처를 모르는 음악·이미지를 내려받아 넣지 않는다.

## 4. 엔진 빠른 참조(전체: `references/engine.md`)

| 목적 | API |
|---|---|
| 선언형 속성 | `data-reveal="rise 0.3"` · `data-exit` · `data-show="0-4.2"` · `data-count="62>96 1.0 pulse"` · `data-type="3.8"` · `data-highlight` · `data-press` · `data-draw` · `data-float` · `data-sfx="whoosh 1.2"` · `data-captions="voice.srt karaoke"` · `data-lottie` |
| 등장 / 퇴장 | `M.reveal(대상, { type, pre, tight, sfx }, at)` — `rise` `words` `chars` `fade` `blur` `pop` `slam` `wipe` `grow` `drop` `lift` `draw` · `M.exit(대상, { type }, at)` |
| 글자 | `M.highlight` 형광펜 · `M.type(대상, '문장', { duration, sfx }, at)` 한글 자모 타이핑 · `M.count(대상, { from, to, pulse, sfx }, at)` · `M.odometer` · `M.text(대상, [[시각, 문구] …], { blur })` · `M.fitText` · `M.stream` · `M.scramble` · `M.marquee` |
| 카메라 | `cam.to({ x, y, zoom, rx, ry, rz, dolly, focus, aperture, duration }, at)` · `cam.lookAt(대상, { zoom · fill }, at)` · `cam.home` · `cam.set` · `cam.drift` · `cam.float` · `cam.punch` · `cam.shake` |
| 커서·터치 | `const cur = M.cursor()` → `cur.moveTo` `cur.click({ sfx })` `cur.drag` `cur.show/hide` · `M.tap` · `M.press` · 기기 화면 속은 `M.cursor({ parent: '#lp .mo-screen' })` |
| 장면·전환 | `M.scene(대상, 시작, 끝)` · `M.transition(종류, 앞, 뒤, { at, sfx })` — `push` `slide` `wipe` `iris` `zoom` `flip` `whip` `cut` `fade` `blur` `flash` `leak` `clock` `blinds` `warp` `glitch` · `M.morph` · `M.iris` · `M.follow` |
| 스프링 | `{ ...M.spring('snappy') }` · `M.springValue([[t, v] …], 'gentle')` · `M.springs(대상, { x: [[t, v] …] })` |
| 도형 | `M.shape('star' · 'heart' · 'blob' …, { box: 100 })` · `M.morphPath(path, [모양 …], { duration, hold }, at)`(닫힌 윤곽은 점을 고르게 나눠 섞어 중간 모양이 찌그러지지 않는다) · GSAP 플러그인(MorphSVG·DrawSVG·MotionPath·CustomEase·Physics2D …) |
| 데이터 | `M.chart(상자, { type: 'column' · 'bar' · 'line' · 'area' · 'donut', data, labels, highlight, center, sfx }, at)` · `M.callout(대상, { text, side, parent }, at)` |
| 소리 | `<audio src data-start data-role>` · `M.audio(src)` → `.beats` `.downbeats` `.level(t)` `.low(t)` `.pulse(t)` · `M.grid()` · `M.sfx(이름, at)` |
| 자막 | `M.captions(상자, 'voice.captions.json', { style: 'karaoke' · 'pop' · 'box' · 'line' })` |
| 효과·블록 | `M.leak` 빛샘 · `M.flash` 섬광 · `M.rays` 빛살 · `M.lowerThird({ name, title })` 이름표 · `M.grain` · `M.aurora` · `M.particles` |
| 3D·외부 | `M.three(캔버스, (THREE, { scene, camera }) => (t) => …)` · `M.lottie(상자, { src }, at)` · `M.adapter({ ready, seek })` · `M.wait(promise)` |
| 상태·무한 | `M.fill`(`.mo-progress` `.mo-check` `.mo-toggle` `.mo-underline`) · `M.pulse` · `M.float` · `M.spin` · `M.dots` · `M.onFrame((t, frame) => …)` |
| 변수 | `data-var="title"` · `M.var('n', 120, { label })` · 내장 `accent` `theme` · 미리보기 vars 패널 · `motion batch` |
| 부품(CSS) | `mo-card` `mo-glass` `mo-window` `mo-input` `mo-btn` `mo-chip` `mo-list/mo-item` `mo-check` `mo-spinner` `mo-progress` `mo-bars/mo-bar` `mo-stat-num` `mo-chat/mo-bubble` `mo-terminal` `mo-code` `mo-phone` `mo-laptop` `mo-toggle` `mo-kbd` `mo-avatar` `mo-icon-tile` `mo-brackets` `mo-captions` |
| 테마·색 | `data-theme`: `ink` `night` `paper` `white` `pop`(요소마다 다시 지정 가능) · `data-accent`: `blue` `cyan` `mint` `lime` `yellow` `amber` `orange` `red` `pink` `violet` 또는 `#hex` |
| 측정 | `M.rect(대상)` 쉬는 자리 · `M.fit(요소, 자리)` · `motion probe 파일 --at 3.2 --js "M.rect('#btn')"` |

## 5. 명령

```
motion brief "가을 운동회 홍보 쇼츠 오프닝"            # 화면·길이·룩·연출 후보 + 비트 틀 제안
motion templates                                        # 장르별 시작 템플릿
motion new work/intro.html --template hook --format shorts --duration 12 --theme ink --accent blue
motion new work/launch.html --template launch --brand brand/brand.json   # 이름·한 줄 소개·주소·로고가 템플릿 변수에 들어간다
motion analyze 참고.mp4 · motion brand https://… · motion audio bgm.mp3 · motion captions align 대본.txt voice.wav
motion check work/intro.html                            # 오류 0이 될 때까지
motion score work/intro.html                            # 85점 이상, 고칠 점이 점수 순으로
motion sheet work/intro.html --count 18                 # → work/out/intro.sheet.png 를 직접 본다
motion sheet work/intro.html --beats music              # 음악의 박마다 한 장 · --from/--to · --guides · --no-camera
motion frames work/intro.html --at 1.2,4.5,9.8          # 원본 크기 스틸(--blur 16이면 렌더와 같은 모션 블러)
motion render work/intro.html --quality standard        # draft · standard · final — 소리 자동 믹스, 결과 검수와 프레임 띠
motion render work/overlay.html --format mov --alpha    # 투명 배경(자막바·로워서드)
motion render work/intro.html --format gif --width 480
motion batch work/card.html --data rows.csv --name "{이름}"   # 행마다 한 편
motion vars work/card.html · motion verify out.mp4 · motion preview work/intro.html
```

## 6. 참조 문서 — 필요할 때 읽는다

| 파일 | 언제 |
|---|---|
| `references/director.md` | **항상 먼저.** 리프롬프트 방법, 의도→기법 표, 길이별 비트 시트, 연속성 사전, 합격 기준, 예시 |
| `references/playbooks.md` | 영상 종류가 정해지면. 종류별 재료·시작 템플릿·구조·합격 기준 |
| `references/look.md` | 룩을 정할 때. 테마·색·타이포·구도·빛, "아마추어 티"와 그 대안 |
| `references/motion.md` | 타이밍을 짤 때. 이징·스프링·길이·스태거 표, 카메라 어휘와 코드, 박자 맞추기 |
| `references/sound.md` | 소리를 넣을 때. 효과음 사전, 밀도, 음악 박자 맞추기, 음량 |
| `references/captions.md` | 내레이션·자막이 있을 때. 대본 → 시간, 녹음 정렬, 자막 스타일 |
| `references/engine.md` | 코드를 쓸 때. 전체 API와 부품 HTML(2부: 선언형·소리·자막·스프링·도형·전환·차트·3D) |
| `references/recipes.md` | 장면 유형별 뼈대 코드(타이포·UI·숫자·기기·전환·다이어그램·소리·3D·엔드카드 …) |
| `references/quality.md` | 검수할 때. 시트 보는 법, 점검 코드·점수 항목별 고치는 법, 최종 체크리스트 |
| `references/chat-mode.md` | 파일·터미널 도구가 없는 대화창에서 단일 HTML로 내야 할 때 |
| `samples/` · `templates/` | 완성 예시(요청 → 트리트먼트 → 코드 → 영상) · 장르별 시작점 |
