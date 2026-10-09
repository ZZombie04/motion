# 엔진 참조 — `Motion` 런타임과 부품

컴포지션은 **HTML 한 파일**이다. `motion new`가 만든 뼈대의 `<head>`(런타임 4줄)는 그대로 두고, `#stage` 안의 마크업·`<style>`·`Motion.compose` 안의 타임라인만 쓴다.

**인자 순서는 어디서나 `(대상, { 옵션 }, 시작 시각)`** 이다. 옵션이 필요 없으면 `(대상, 시작 시각)`. 시작 시각은 초(숫자)로 적는다.

## 1. 무대

```html
<div id="stage" data-title="제목" data-width="1080" data-height="1920" data-fps="30" data-duration="12"
     data-theme="ink" data-accent="blue" data-platform="shorts">
  <div class="mo-bg">…</div>        <!-- 빛·배경. 카메라의 영향을 받지 않는다 -->
  <div class="mo-world">…</div>     <!-- 카메라가 움직이는 세계. 내용은 전부 여기 -->
  <div class="mo-hud">…</div>       <!-- 화면에 고정된 모서리 라벨(카메라가 줌해도 그 자리) -->
  <div class="mo-vignette"></div>
</div>
```

| 속성 | 뜻 |
|---|---|
| `data-width/height` | 캔버스 픽셀. `--u` = 짧은 변 ÷ 100 (1080 → 10.8px) |
| `data-duration` | 총 길이(초). 타임라인이 이보다 길면 오류로 알려 준다 |
| `data-theme` | `ink`(검정) `night`(남색 검정) `paper`(연회색) `white`(흰색) `pop`(포인트 색 배경). **어느 요소에든 다시 지정**하면 그 안의 토큰이 바뀐다(장면별 테마 반전) |
| `data-accent` | `blue cyan mint lime yellow amber orange red pink violet white` 또는 `#hex`. 그 위 글자색 `--on-accent`는 자동 계산 |
| `data-platform="shorts"` | 안전영역(상 10.5%·하 20%·좌우 8%)을 `--safe-*`에 반영하고 점검기가 검사 |

토큰(모든 CSS에서 사용): `--bg --bg-2 --surface --surface-2 --fg --fg-2 --fg-3 --fg-4 --line --line-2 --accent --on-accent --accent-2` · 글꼴 `--font-sans`(Pretendard) `--font-latin`(Geist) `--font-mono`(Geist Mono) `--font-serif`(Instrument Serif, 라틴 전용) · 반경 `--r-xs … --r-xl` · `--safe-x --safe-t --safe-b`.

번들 글꼴은 이 네 가지뿐이다. 다른 글꼴은 woff2를 컴포지션 폴더에 넣고 `@font-face`로 선언한다(외부 URL 금지).
Geist·Geist Mono·Instrument Serif에는 한글이 없다 — 그 글꼴을 지정한 요소 안의 한글은 Pretendard로 그려진다(모노 라벨에 한글을 섞을 수 있지만 폭은 고정이 아니다).

세계는 무대보다 커도 된다. 가로 4,000px짜리 세계를 만들고 카메라가 그 위를 옮겨 다니다가 `zoom: 0.5`로 물러나 전체를 보여 주는 구성이 가능하다(레시피 23).

## 2. `Motion.compose((M) => { … })`

글꼴·이미지가 준비된 뒤 한 번 실행된다. `M`:

| | |
|---|---|
| `M.tl` | 일시정지된 마스터 GSAP 타임라인. `tl.to/from/fromTo/set(대상, vars, 시각)` |
| `M.W M.H M.D M.fps M.u` | 폭·높이·길이·fps·1u의 px |
| `M.$(sel)` `M.$$(sel)` | 무대 안에서 하나 / 배열 |
| `M.el(html, parent?)` | 요소를 만들어 붙인다 |
| `M.onFrame((t, frame) => …)` | 매 프레임 호출. **트윈이 아닌 움직임은 여기에만** 쓴다. 등록한 순서대로 실행된다(헬퍼가 만든 값을 읽으려면 그 헬퍼 뒤에 등록) |
| `M.rng(seed)` `M.noise(x, seed)` | 결정적 난수(0–1) / 부드러운 노이즈(−1–1) |
| `M.clamp(v,a,b)` `M.lerp(a,b,t)` `M.map(v,a,b,c,d)` `M.smooth(t)` | 계산 도우미 |
| `M.ease('mo.cam')` | 이징 함수(0–1 → 0–1). `M.onFrame` 안에서 하우스 이징을 직접 계산할 때 |
| `M.vars` `M.var(name, 기본값)` | `--vars "a=1&b=2"`로 넘어온 값 |
| `M.beats(bpm)` | `b(n)` = n번째 박의 초(**프레임 격자에 맞춰짐**), `b.len` = 한 박. 맞추지 않으려면 `M.beats(bpm, { snap: false })` |
| `M.snap(t)` | 시각을 가장 가까운 프레임으로 |
| `M.time(at)` | 숫자·라벨을 초로 |
| `M.rect(대상)` | 레이아웃 상자 `{x,y,w,h,cx,cy}`(무대 px, 변환 무시 = 요소가 **쉬는 자리**). `{ live: true }`면 현재 변환 포함 |
| `M.fit(요소, 자리)` | 요소가 `자리`의 상자를 차지하게 하는 `{x,y,scaleX,scaleY}` |
| `M.fitText(대상, 폭px)` | 글자 폭이 정확히 그 폭이 되도록 글자 크기를 맞춘다(화면을 채우는 큰 단어) |
| `M.split(대상, { by, mask, tight })` | 글자를 `by: 'lines'`·`'words'`·`'chars'` 단위로 쪼개 `{ lines, words, chars }`(움직일 요소 배열)을 돌려준다. `M.reveal`이 내부에서 쓰는 것 — 직접 트윈을 짤 때 사용 |

GSAP 이징 이름(어디서나 사용): `mo.out`(등장) `mo.soft` `mo.inOut`(A→B) `mo.cam`(카메라) `mo.in`(퇴장) `mo.snap`(박자 타격) `mo.swift`(휩) `mo.spring`(8% 오버슛) `mo.pop`(16%) `mo.settle`(2%). GSAP 기본 이징(`power3.out`, `sine.inOut`, `none` …)도 쓸 수 있다.

> GSAP으로 `transform`을 한 번이라도 트윈한 요소는 쌓임 맥락이 된다(자식의 `z-index`가 밖으로 나가지 못한다). 겹침 순서가 중요한 요소는 형제로 나누거나 `left/top`을 트윈한다.
> `fromTo`는 from과 to에 **같은 속성들**을 적는다(변하지 않는 값도 양쪽에). 같은 요소·속성을 다루는 `fromTo`가 둘 이상이면 뒤쪽에 `immediateRender: false`를 붙인다 — 아니면 뒤쪽의 시작값이 0초부터 적용된다.

## 3. 등장과 퇴장

```js
M.reveal(대상, { type, duration, stagger, ease, pre, tight }, at)
M.exit(대상,   { type, duration, stagger }, at)
```

| type | 움직임 | 쓰는 곳 |
|---|---|---|
| `rise` | 줄 단위로 마스크 아래에서 솟음 | 제목(가장 기본) |
| `words` / `chars` | 어절 / 글자 단위로 솟음 | 한 줄 헤드라인 / 짧은 영문·숫자 |
| `fade` | 살짝 올라오며 나타남(`y` 조절) | 본문·라벨·보조 요소 |
| `blur` | 흐림에서 또렷하게 | 분위기 있는 전환, 큰 이미지 |
| `pop` | 작게 → 튕기며 | 칩·버튼·점·배지 |
| `slam` | 크게 → 쾅 내려앉음(그 프레임부터 보인다) | 박자에 맞춘 단어 |
| `wipe` | 한쪽에서 닦이며(`dir: right/left/up/down`) | 박스·이미지·선 |
| `grow` | 한 축으로 자람(`axis: 'y'`, `origin`) | 막대·선·바 |
| `drop` / `lift` | 위에서 떨어져 / 아래에서 3D로 들려 | 알림·카드 |
| `draw` | SVG 선이 그려짐 | 아이콘·다이어그램·차트 선 |

- `pre: 0.4` — 움직임의 40%가 이미 진행된 상태에서 시작한다. **0초의 훅**에 쓴다(`M.reveal('#num', { type: 'chars', pre: 0.45 }, 0)` → 첫 프레임에 이미 올라오는 중). `rise words chars fade lift`에서 동작.
- `tight: true` — 마스크의 위아래 여유를 없앤다. 받침·내려쓰는 획이 없는 **큰 숫자·영문 대문자**에 쓰면 글자가 줄 아래로 비치지 않는다.
- `rise·words·chars`는 글자를 감싸는 마스크를 만든다. `<br>`과 `<span>`(형광펜 등)이 들어 있어도 된다.
- 등장 전의 글자가 마스크 밑에 대기하는 동안 다른 요소와 겹쳐 보이면 `M.scene(요소, 등장 시각)`으로 그 전까지 숨긴다.
- 퇴장 type: `rise words chars fade blur pop wipe drop`.

## 4. 글자 기능

```js
M.highlight('#key', { duration: 0.55 }, 1.4)           // 형광펜: 막대가 왼→오로 칠해지고 같은 획에 글자색이 --on-accent로
M.type('#typed', '3학년 과학 활동지 만들어줘', { duration: 1.3 }, 3.8)   // 한글 2벌식 조합 그대로(ㅎ→호→화→활 …), 캐럿 포함
M.count('#n', { from: 0, to: 1284, duration: 1.6, pulse: true }, 2.0)   // 폭이 흔들리지 않는 카운트
M.odometer('#n', '1,284', { duration: 1.6 }, 2.0)                       // 0에서 자릿수마다 굴러 올라오는 숫자
M.text('#state', [[0, 'AGENT · RUNNING'], [8.2, 'AGENT · DONE']], { scramble: 0.4 })   // 시각에 따라 바뀌는 라벨
M.stream('#answer', { wps: 14 }, 5.0)                                   // AI 답변처럼 단어 덩어리로 흘러나옴
M.scramble('.mo-label', { duration: 0.9 }, 0.3)                         // 모노 라벨이 해독되듯 정착
M.marquee('#band', { speed: 160, dir: 1, alternate: true })             // 끝없이 흐르는 띠(내용을 자동 복제)
```

- `M.type`의 대상은 빈 요소(`<span id="typed"></span>`). `duration` 대신 `cps`(초당 글자 수, 기본 9). 그 밖의 옵션: `jitter`(타건 간격의 불규칙함 0–1), `hold`(다 친 뒤 캐럿이 남는 초, 기본 1.2), `caret: false`. 돌려주는 트윈에 `.typed`(글자 요소)·`.caret`가 있다.
- `M.count` 옵션: `decimals` `prefix` `suffix` `sep`(천 단위 쉼표) `pad`(0 채움 자릿수) `round: 'round'|'floor'|'ceil'` `align`. 자릿수가 바뀌면 상자 폭을 부드럽게 맞춰 가운데 정렬이 유지된다. **단위는 옆에 별도 요소**로 둔다.
  - 감속 이징에서는 숫자가 트윈보다 먼저 멈춘다. 돌려준 트윈의 **`.land`** = 최종 숫자가 처음 나타나는 시각. `pulse: true`(또는 `{ target: '.num', scale: 1.06 }`)면 그 순간에 맞춰 펄스를 넣는다.
  - 이징: 0에서 시작하면 `power3.out`(기본), **이미 화면에 있던 값에서 출발하면 `power3.inOut`이나 `mo.cam`**(정지 상태에서 갑자기 최고 속도로 튀지 않게).
- `M.odometer`는 0 → 목표값 전용이다. A → B는 `M.count`.
- `M.text`는 같은 요소의 문구를 시각에 따라 바꾼다(상태 라벨, 장 번호). 첫 항목 이전에는 마크업의 원래 문구.
- `M.scramble`의 기본 문자 집합에는 숫자가 없다(통계 화면에서 엉뚱한 숫자가 번쩍이지 않게). `chars`로 바꿀 수 있다.
- 장식용 큰 글자(배경 워드월·마키)는 요소에 `data-deco`를 붙이면 점검기가 겹침·잘림 검사에서 제외한다.

## 5. 카메라

세계(`.mo-world`) 전체를 3D로 움직인다. 화면 중심이 바라보는 지점이 `(x, y)`.

```js
cam.to({ x, y, zoom, rx, ry, rz, dolly, focus, aperture, duration, ease }, at)
cam.lookAt('#card', { zoom: 1.3, duration: 1.4, dy: -40 }, at)   // 요소가 화면 가운데 오게. zoom 대신 fill: 0.7(화면의 70%를 채움)
cam.home({ duration: 1.3 }, at)                                   // 정면·전체 화면으로 복귀
cam.set({ rx: 9, ry: -12, zoom: 1.15 })                           // 시작 자세(트윈 전에 한 번). cam.set(vars, at)이면 그 시각에 순간 이동
cam.drift({ zoom: 1.05 })      // 0초→끝까지 아주 느린 푸시 인. 다른 움직임에 곱해진다. 거의 항상 켠다
cam.float({ rot: 0.3 })        // 손으로 든 듯한 미세한 흔들림(긴 홀드를 살린다)
cam.punch({ scale: 1.05 }, at) // 박자 컷마다 넣는 순간 줌 킥
cam.shake({ amp: M.u }, at)    // 충격 한 번(호출마다 세기를 따로 줄 수 있다)
cam.frame('#card', { fill: 0.7 })   // → { x, y, zoom } 계산만
cam.s                               // 현재 상태 { x, y, zoom, rx, ry, rz, dolly, focus, aperture } — M.onFrame에서 읽을 수 있다
```

| 값 | 뜻 |
|---|---|
| `zoom` | 렌즈 줌(배율). 1.04–1.25는 푸시 인, 1.4+는 클로즈업, 1 미만은 풀백 |
| `rx / ry / rz` | 틸트(위·아래) / 오빗(좌·우) / 롤. 도 단위. 정면 = 0. `ry: -8 → 6`이면 대상 주위를 천천히 돈다 |
| `dolly` | 카메라가 앞으로 이동(px). 깊이 레이어 사이에 패럴랙스가 생긴다 |
| `focus / aperture` | 초점면의 z / 심도(0 = 끔). `.mo-layer`마다 초점에서 먼 만큼 흐려진다 → 랙 포커스 |

- `cam.drift`는 화면 **가운데**를 기준으로 확대한다. 가장자리에 붙인 요소는 끝날 때 그만큼(1.05면 약 2.5%) 바깥으로 밀린다 — 좌우 여백을 `--safe-x`보다 넉넉히 잡거나 마지막 프레임을 확인한다.
- `cam.lookAt`·`cam.frame`의 `fill`은 드리프트를 뺀 값이다. 드리프트 1.05가 걸려 있으면 화면의 85%를 채우려던 것이 89%가 된다.
- `.mo-hud`는 화면에 고정이라 세계가 줌하면 세계 속 요소와의 정렬이 달라진다. 가장자리 정렬이 중요하면 그 라벨을 세계 안에 둔다. 기기나 카드가 화면을 꽉 채우는 클로즈업에서는 HUD를 잠시 내린다(`M.scene('.mo-hud', [[0, 3], [8, 12]])`).
- **선명도**: 정면(기울기 0) 확대는 배율과 무관하게 선명하다. **기울인 채**(`rx·ry·dolly`, 스스로 회전한 기기, 깊이 레이어) 확대하면 Chrome이 그 층을 원래 크기로만 그려 미리보기에서 글자가 흐려진다 — `frames`와 `render`는 그런 프레임을 2–3배 크기로 찍어 줄이므로 결과물은 선명하다(3.3배까지, 그 이상은 `check`가 `soft`로 알린다). 더 크게 다가가야 하면 요소를 가장 가까운 샷의 크기로 만들고 넓은 샷을 `zoom < 1`로 잡는다. `will-change`는 쓰지 않는다.
- 세계 속 요소는 기울어진 기기와 **깊이 순서**로 가려진다(3D 공간을 공유한다). 기기 앞에 떠야 하는 것은 `z`를 조금 준다(`gsap.set('#chip', { z: 40 })`).

깊이 레이어: `<div class="mo-layer" data-z="-400">…</div>` — z가 클수록 카메라에 가깝다. 레이어는 무대 전체 크기이며 자동으로 크기가 보정돼, 평면으로 디자인한 그대로 보이다가 카메라가 움직이면 깊이가 드러난다. 레이어 자체는 트윈하지 말고 그 안의 요소를 트윈한다.
레이어를 쓴 장면은 **`ry: 0`으로 끝낸다**(각도가 남으면 깊이가 다른 요소의 가장자리가 어긋난다). 보정은 화면 중앙 부근에서 정확하므로, 카메라가 멀리 옮겨 다니는 넓은 세계에서는 레이어 대신 모두 z = 0에 두는 편이 낫다.

## 6. 커서·터치·누름

```js
const cur = M.cursor({ x: 960, y: 1560, hidden: true });   // 세계 안에 생긴다(카메라 줌을 함께 받는다)
cur.show(2.9);
cur.moveTo('#field', { ax: 0.3 }, 2.9);     // 살짝 휜 경로로 이동. ax/ay = 대상 안의 비율 위치, dx/dy = px 보정
cur.click({ accent: true }, 3.7);            // 눌림 + 파문(accent면 포인트 색)
cur.moveTo('#field', { ax: 0.8, ay: 1.8 }, 3.85);   // 클릭한 뒤에는 글자를 가리지 않게 비켜 둔다
cur.hide(5.2);
M.press('#send', 3.7);                       // 버튼이 눌렸다 돌아옴(클릭과 같은 시각)
M.tap('#row2', 4.1);                         // 손가락 터치 표시(폰 UI)
M.pulse('#badge', { scale: 1.08 }, 6.0);     // 한 번 강조
```

이동 시간은 거리에서 자동 계산된다(0.5–1.25초). `M.cursor({ label: '하늘' })`이면 이름표가 붙는다.

**기기 화면 속**을 가리킬 때는 커서를 그 화면에 붙인다: `M.cursor({ parent: '#lp .mo-screen', size: 0.6 })` — 화면과 함께 기울고, `{ x, y }`는 그 화면 안의 px이 된다(`size`는 커서 배율).
`M.tap`은 대상이 `.mo-screen` 안에 있으면 자동으로 그 화면 위에 그려진다(화면에 잘리고 함께 기운다. 크기는 `size` px, 기본은 화면 폭의 20%).
세계에 둔 커서로 **스스로 회전한 기기** 안의 요소를 가리키면 어긋난다(`M.rect`는 변환을 무시한 "쉬는 자리"다) → 부모를 화면으로 주거나, `motion probe`로 좌표를 확인해 `{ x, y }`로 준다.

## 7. 장면과 전환

```js
M.scene('#hook', 0, 3.2).scene('#demo', 2.6, 8)      // 그 시간 창에서만 보인다(겹쳐도 됨)
M.scene('#dot', [[0, 2.1], [4.2, 9]])                 // 창을 여러 개(나왔다 사라졌다 다시)

M.transition('push',  '#a', '#b', { at: 3.0, dir: 'left' })   // 밀어내기
M.transition('wipe',  '#a', '#b', { at: 3.0, color: 'accent', angle: -14 })  // 포인트 색 띠가 쓸고 지나감
M.transition('iris',  '#a', '#b', { at: 3.0, x: '70%', y: '40%' })           // 한 점에서 원이 열림
M.transition('zoom',  '#a', '#b', { at: 3.0, origin: '62% 40%' })            // 앞 장면을 뚫고 들어감
M.transition('flip',  '#a', '#b', { at: 3.0 })                               // 3D로 뒤집힘
M.transition('whip',  '#a', '#b', { at: 3.0, dir: 'left' })                  // 휙 넘김(모션 블러가 자동으로 붙는다)
M.transition('cut',   '#a', '#b', { at: 3.0 })                               // 하드컷(박자에 맞출 때)

M.iris('#panel', { x: '20%', y: '80%', from: 0, to: 1, duration: 0.8 }, 1.4)  // 어떤 요소든 원형으로 열기(0→1) / 닫기(1→0)
M.morph('#chip', '#slot', { duration: 0.9 }, 5.0)     // 같은 물체가 다른 자리·크기로 이동(공유 요소)
M.follow('#dot', '#path', { duration: 1.2, rotate: false }, 2.0)   // SVG 경로를 따라 이동
```

- `transition`의 장면은 무대를 꽉 채우는 `<section class="mo-scene">`이어야 한다(가시성은 자동 관리, 반환값 = 도착 시각). 장면에 `data-theme`를 주면 그 장면만 배경·글자색이 바뀐다.
- 장면 창과 전환 시각은 **프레임 격자에 맞춰진다** — 컷이 프레임 한가운데 걸려 두 장면이 겹쳐 찍히는 일이 없다.
- `M.scene`을 건 자식은 부모 장면이 사라지면 함께 사라진다.
- `M.follow`의 요소는 `<svg>`와 같은 부모 안에 `position:absolute; left:0; top:0`으로 두고 음수 `margin`으로 중심을 맞춘다.
- 가장 고급스러운 전환은 헬퍼가 아니라 **같은 요소를 이어 쓰는 것**이다: 입력창의 `top/height/borderRadius`를 트윈해 카드로 키우고, 진행 막대를 다음 장면의 밑줄로 옮긴다(`samples/01-ai-teacher.html`).

## 8. 상태 부품(`--p` 0→1)

```js
M.fill('.mo-progress', { from: 0, to: 0.72, duration: 0.9 }, 2.0)
M.fill('.mo-check', { ease: 'mo.spring', duration: 0.5 }, 3.1)     // 원이 차고 체크가 그려짐
M.fill('.mo-toggle', 4.0);  M.fill('.mo-underline', 1.6)
M.spin('.mo-spinner');  M.dots('.mo-dots');  M.float('.chip', { y: M.u * 0.8, period: 5 })
```

`M.fill`을 되돌리려면 `{ from: 1, to: 0 }`. 형광펜을 걷으려면 `tl.to('#key', { '--p': 0, duration: 0.4 }, t)`.

## 9. 분위기

```html
<div class="mo-bg">
  <div class="mo-stagelight"></div>                 <!-- 위에서 떨어지는 중립 조명(밝은 테마에서는 흰 빛) -->
  <div class="mo-dotgrid" style="opacity:.5"></div>  <!-- 옅은 점 격자 (.mo-gridlines = 선 격자) -->
  <div class="mo-horizon" style="--hy:80%"></div>    <!-- 화면 아래에서 떠오르는 빛의 호. --hy 정점 위치, --hs 크기 -->
  <div class="mo-glow" style="left:50%;top:60%;--s:calc(var(--u)*70);--a:.3"></div>  <!-- 초점 뒤에 깔리는 빛 웅덩이 -->
</div>
```

```js
M.grain()                                   // 필름 그레인(어두운 그라디언트의 밴딩도 막는다). 거의 항상 켠다. 기본은 정지 그레인
M.grain({ every: 2 })                       // 2프레임마다 바뀌는 살아 있는 그레인(파일이 약 10배 커진다 — 필름 룩이 꼭 필요할 때만)
M.aurora({ colors: ['var(--accent)', 'var(--accent-2)'], spread: 'bottom', alpha: 0.4 })   // 천천히 흐르는 색 빛(감성·AI 톤에만)
M.particles({ count: 60, bokeh: true })     // 떠다니는 먼지·보케
```

`.mo-vignette`(가장자리 어둡게) · `.mo-letterbox`(시네마 바, `--lb`) · `.mo-floor`(원근 바닥 격자) · `.mo-spot`(가운데 은은한 빛) · `.mo-sheen`(표면을 훑는 빛: `--sheen` −0.3 → 1.3).
밝은 테마 장면에서는 비네트를 장면 안에 두거나 생략한다.

## 10. 부품 마크업(CSS)

```html
<p class="mo-label"><span class="mo-dot"></span>LIVE · 01</p>          <!-- 모노 대문자 라벨 -->
<h1 class="mo-display">큰 제목</h1> <h1 class="mo-h1">…</h1> <h2 class="mo-h2">…</h2> <h3 class="mo-h3">…</h3>
<p class="mo-body">본문</p> <p class="mo-small">작은 글</p>
<span class="mo-serif">elegant</span> <span class="mo-latin">GEIST</span> <span class="mo-num">1,284</span> <span class="mo-outline">OUTLINE</span>

<div class="mo-card">…</div>  <div class="mo-glass">…</div>  <div class="mo-card mo-lift">들어 올린 카드</div>
<div class="mo-window"><div class="mo-window-bar"><span class="mo-label">TITLE</span></div><div class="mo-window-body">…</div></div>
<div class="mo-window"><div class="mo-window-bar"><div class="mo-addr">example.kr/page</div></div><div class="mo-window-body">…</div></div>

<span class="mo-chip">칩</span> <span class="mo-chip accent">포인트</span> <span class="mo-chip solid">솔리드</span> <span class="mo-chip mono">MONO</span>
<span class="mo-btn">버튼</span> <span class="mo-btn accent">주요</span> <span class="mo-btn ghost">보조</span> <span class="mo-btn round"><i data-icon="arrow-up"></i></span>
<div class="mo-input"><i data-icon="search"></i><span class="grow" id="typed"></span></div>
<span class="mo-kbd">⌘</span><span class="mo-kbd">K</span>

<div class="mo-list">
  <div class="mo-item"><span class="mo-check accent"></span><span class="grow">항목</span><span class="meta">0.8s</span></div>
</div>
<div class="mo-progress accent"><i></i></div>   <span class="mo-toggle"></span>   <span class="mo-spinner"></span>
<div class="mo-bars"><div class="mo-bar" style="--v:.4"></div><div class="mo-bar accent" style="--v:.9"></div></div>
<div class="mo-stat-num">96<small>%</small></div>

<div class="mo-chat"><div class="mo-bubble me">질문</div><div class="mo-bubble ai">답 <span class="mo-dots"></span></div></div>
<div class="mo-terminal"><span class="p">$</span> <b>명령</b>\n<span class="ok">✓</span> 완료</div>
<div class="mo-code"><span class="k">const</span> a = <span class="s">'문자열'</span>; <span class="c">// 주석</span></div>

<span class="mo-avatar">주</span>  <span class="mo-icon-tile accent"><i data-icon="sparkles"></i></span>  <div class="mo-brackets"></div>
<div class="mo-media"><img src="./photo.jpg"></div>
```

아이콘: `<i data-icon="이름"></i>`(Lucide 272종 — `search check arrow-right sparkles bot brain rocket trophy calendar clock users book-open graduation-cap chart-column trending-up heart star zap flag map-pin play message-circle file-text folder terminal code smartphone laptop …`). 크기는 글자 크기를 따른다. 굵기 `data-stroke="2.2"`.

쇼츠에서 무대를 꽉 채우는 장면(`.mo-scene`) 안에 내용을 놓을 때는 `.mo-safe` 대신 변수를 직접 쓴다: `padding: var(--safe-t) var(--safe-x) var(--safe-b)`.

### 기기

```html
<div class="mo-phone" id="ph" style="--pw: calc(var(--u) * 42)">
  <div class="mo-screen">                    <!-- 화면 안은 자유 마크업. data-theme로 밝은 화면도 가능 -->
    <div class="mo-statusbar"><span>9:41</span><span>5G</span></div>
    …
  </div>
</div>
<div class="mo-laptop" id="lp" style="--lw: calc(var(--u) * 100)"><div class="mo-screen">…</div></div>
```

```js
gsap.set('#ph', { rotationY: -28, rotationX: 8 });                       // 3/4 각도로 세우기
tl.to('#ph', { rotationY: 0, rotationX: 0, duration: 1.6, ease: 'mo.inOut' }, 0.4);   // 정면으로
tl.fromTo('#lp', { '--open': 4 }, { '--open': 106, duration: 1.3, ease: 'mo.inOut' }, 0.3);  // 덮개 열기
```

실제 두께·옆면·뒷면이 있다(뒤집기 가능). 화면 속 글자는 기기 폭 기준 `calc(var(--pw) * 0.05)`처럼 잡으면 비율이 유지된다. 실제 브랜드 로고는 넣지 않는다.
화면의 반사광은 `--glare`(0–1, 기본 0.55)로 조절한다. 화면 속 글자를 읽혀야 하면 `cam.lookAt('#ph .mo-screen', { fill: 0.9 }, at)`로 다가간다.
3D로 돌리는 요소는 조상이 3D 맥락을 이어 줘야 원근이 생긴다 — 기기는 자동, 그 밖의 요소는 `data-3d` 속성을 붙인다.

## 11. 영상·이미지 넣기

```html
<div class="mo-media" style="width:…;height:…"><video id="rec" src="./recording.mp4"></video></div>
```
```js
M.video('#rec', { start: 1.0, from: 12.5, rate: 1 })   // 1.0초부터 원본 12.5초 지점을 재생. 프레임 단위로 정확히 따라간다
```
이미지는 `<img src="./파일">`(컴포지션 폴더 기준 상대 경로). 큰 사진은 `M.reveal(type:'blur')` + 느린 `scale`(켄 번스)로 다룬다.

## 12. 미리보기·검수 도구

| 명령 | |
|---|---|
| `motion preview file.html` | Space 재생, ←/→ 한 프레임(Shift = 0.5초), G 플랫폼 안전영역, `?t=3.2`로 특정 시각 |
| `motion sheet` | 콘택트 시트. `--count 18` · `--at 2.4,2.6,2.8` · `--from 2 --to 4`(구간만 촘촘히) · `--beats 128`(박마다 한 장) · `--cols 3`(크게 보기) · `--width 2600` |
| `motion frames --at …` | 원본 크기 PNG. `--blur 16`이면 렌더와 같은 모션 블러가 들어간 스틸 · `--stamp` 타임코드 |
| `--no-camera` / `--guides` | sheet·frames에서 카메라를 끄고 쉬는 배치만 보기 / 플랫폼 안전영역을 겹쳐 보기 |
| `motion probe file.html --at 3.2 --js "M.rect('#btn')"` | 그 시각의 페이지 안에서 식을 평가(좌표·상태 확인). 식 안에서 `M`을 쓸 수 있다 |
| `motion check` | `references/quality.md`의 코드표 참고. `--step 0.05`(촘촘히) · `--platform shorts` |
| `motion render` | `--quality draft`·`standard`·`final`, `--fps 60`, `--blur 0`(모션 블러 끄기), `--from/--to` 구간, `--format mp4`·`webm`·`mov`·`gif`·`webp`·`png`, `--alpha`, `--audio`, `--poster 초`, `--scale 2`(1080 레이아웃을 4K로), `--ss 2`(전체를 2배로 찍어 줄임), `--no-sharp`(자동 선명 보정 끄기) |

렌더 품질: `draft`는 절반 크기·블러 없음(구성 확인용), `standard`는 모션 블러 최대 16샘플, `final`은 32샘플에 기울어진 장면 전체를 2배 이상으로 찍는다(가장 느리고 가장 선명).
렌더러는 크게 찍은 화면이 원래 화면과 같은 그림인지 구간마다 대조하고, 다르면(메모리 부족으로 일부가 빠지는 등) 그 구간은 일반 캡처로 대체한 뒤 결과 줄에 `보정 생략 N프레임`이라고 알린다. 3D 층이 아주 많은 장면에서 이 표시가 나오면 `MOTION_TILE_MB=12000`처럼 타일 메모리를 늘려 다시 렌더한다(기본 6144).

CLI를 실행할 때마다 컴포지션 옆의 `_motion/`이 엔진과 다르면 자동으로 갱신된다(갱신하면 한 줄로 알린다).


---

# 2부 — 소리·자막·선언형·스프링·도형·차트·3D

아래 기능은 1부와 함께 쓴다. 1부의 API는 그대로이고, 모든 시각 인자는 숫자(초)뿐 아니라 **박 토큰** `'b8'`(8번째 박)도 받는다.

## 13. 선언형 속성 — 단순한 타이밍은 HTML에

`Motion.compose`의 콜백이 돌기 전에 런타임이 `data-*` 속성을 읽어 같은 타임라인에 올린다. 연출(카메라·전환·변신)은 JS로, 등장·퇴장·카운트 같은 반복 작업은 속성으로 쓰면 코드가 짧고 실수가 줄어든다.

```html
<p class="mo-label" data-reveal="fade 0.1">NOTE · 01</p>
<h1 class="mo-h1" data-reveal="rise 0.25 pre=0.4 sfx">질문 한 줄이 먼저</h1>
<span data-highlight="1.4">좋은 질문</span>
<b data-count="62>96 1.0 dur=2.4 ease=power3.inOut pulse sfx">62</b><small>%</small>
<span data-type="3.8 dur=1.3 sfx">3학년 과학 활동지 만들어줘</span>     <!-- 요소 안의 글을 한글 자모로 타이핑 -->
<section class="mo-scene" data-show="0-4.2">…</section>                <!-- 보이는 시간 창(여러 개: "0-2, 5-8") -->
<div data-exit="fade 4.0">…</div>  <svg data-draw="0.5">…</svg>  <button data-press="3.1 sfx">…</button>  <i data-pulse="b12"></i>
<div class="chip" data-float="y=0.8u period=5"></div>  <i data-spin="period=8"></i>
<i data-sfx="whoosh 1.2 vol=0.6, impact b8"></i>                      <!-- 효과음만 따로 -->
```

- 값의 순서: `종류 시각 옵션…`. 옵션은 `키=값`(`dur`=duration, `vol`=volume) 또는 플래그(`tight`, `pulse`, `sfx`, `loop`). 길이 값에 `u`를 붙이면 1u 단위(`y=0.8u`).
- 같은 요소에 속성과 JS(`M.reveal`)를 둘 다 걸지 않는다(이중 트윈).
- 시각 토큰: `1.2`, `1.2s`, `b8`(음악에서 잰 8번째 박. 음악이 없으면 무대의 `data-bpm`, 기본 120), 타임라인 라벨 이름.

## 14. 템플릿 변수 — 한 컴포지션, 여러 영상

```html
<h1 data-var="title" data-label="제목">AI에게 일을 맡기는 교사</h1>     <!-- --vars "title=…" 로 바뀐다. \n 은 줄바꿈 -->
<img data-var="photo" src="./default.jpg">                              <!-- 이미지·영상은 src가 바뀐다 -->
```
```js
const n = M.var('count', 120, { label: '줄어들기 전(분)', type: 'number' });   // JS 쪽 값도 변수로
```
- 내장 변수: `accent`(포인트 색), `theme`. `--vars "accent=mint"`만으로 색이 바뀐다.
- `motion vars 파일`이 변수 목록을, 미리보기의 **vars** 버튼이 편집 패널을 보여 준다.
- `motion batch 파일 --data rows.csv --name "{이름}"` — 표의 열 이름 = 변수 이름, 행마다 한 편.

## 15. 소리 — 음악·목소리·효과음

컴포지션은 소리를 **계획**만 하고, 렌더러가 믹스해 영상에 넣는다(음악은 목소리 아래로 자동으로 줄고, 전체는 −14 LUFS로 맞춰진다).

```html
<audio src="bgm.mp3" data-start="0" data-volume="0.8" data-fade-in="0.2" data-fade-out="1.5"></audio>
<audio src="voice.wav" data-start="0.4" data-role="voice"></audio>
```
```js
const music = M.audio('bgm.mp3');          // 마크업의 그 트랙(같은 파일)을 돌려준다. 옵션을 주면 새 트랙: M.audio('a.mp3', { at: 2, from: 12, volume: 0.6, loop: true })
music.bpm; music.beats; music.downbeats; music.onsets;   // CLI가 파일을 분석해 둔 값(초)
music.level(t); music.low(t); music.high(t);             // 0–1 세기(전체·저음·고음) — 화면이 음악에 반응
music.beat(16);                                          // 16번째 박의 시각
music.pulse(t, 0.12);                                    // 박 위에서 1, 다음 박 전까지 0으로 — 박자 섬광·펄스

const b = M.grid();                        // 음악의 실제 박(없으면 data-bpm) → b(n) = n번째 박
M.reveal('#w1', { type: 'slam', sfx: true }, b(4));
M.onFrame((t) => { M.$('#glow').style.opacity = (0.3 + 0.7 * music.low(t)).toFixed(3); });

M.sfx('whoosh', 1.2);                      // 효과음 하나. { volume, pitch, pan }
M.reveal('#chip', { type: 'pop', sfx: true }, 2.0);      // 도우미에 sfx: true → 어울리는 효과음이 자동으로
M.type('#q', '활동지 만들어줘', { duration: 1.2, sfx: true }, 3.0);   // 자판 소리
M.count('#n', { from: 0, to: 96, sfx: true }, 4.0);     // 숫자가 바뀔 때 틱
cur.click({ sfx: true }, 5.1);  M.transition('whip', '#a', '#b', { at: 6, sfx: true });
```

내장 효과음(코드로 합성, 파일·라이선스 불필요): `click tap tick key pop swish whoosh whip swipe riser swell impact thud drop ding success error shutter glitch sparkle`. 폴더 안의 소리 파일 이름(`'boom.wav'`)도 된다.

| 도우미 + `sfx: true` | 들리는 소리 |
|---|---|
| reveal pop · slam · drop · wipe/grow · 나머지 | pop · impact · thud · swipe · swish |
| exit · press · tap · cursor.click · highlight | swish · click · tap · click · swipe |
| type · count | key(자판, 음높이 조금씩 다르게) · tick(최대 30번) |
| transition push/slide/zoom/warp · whip · wipe/clock/blinds · flash · leak · glitch · iris/flip/blur | whoosh · whip · swipe · impact · swell · glitch · swish |

- 소리 디자인 원칙은 `references/sound.md`. 큰 움직임 4–8곳에만, 작은 등장은 조용히.
- 렌더 옵션: `--no-audio`(소리 없이) · `--loudness off`(음량 맞추기 끄기) · `--audio bgm.mp3`(배경 음악 하나 추가).
- `motion audio 노래.mp3` — 렌더 전에 BPM·박·마디를 확인. 분석은 CLI가 자동으로 해서 `_motion/audio/`에 둔다.

## 16. 자막 — 말에 맞춰 단어가 켜진다

```html
<div id="cap"></div>                                   <!-- 위치는 .mo-captions 기본값(아래 안전영역 위). 바꾸려면 CSS로 -->
<div data-captions="voice.captions.json karaoke"></div>
```
```js
M.captions('#cap', 'voice.srt', { style: 'karaoke' });              // 파일(.srt · .vtt · .captions.json)
M.captions('#cap', [{ start: 0.4, end: 2.6, text: '두 시간이 십 분으로' }], { style: 'pop' });
```
| style | 모양 |
|---|---|
| `karaoke`(기본) | 한 줄이 통째로 뜨고, 말한 단어는 밝게, 지금 단어는 포인트 색 |
| `pop` | 단어가 말하는 순간 튕기며 나타난다(쇼츠 자막) |
| `box` | 지금 단어 뒤에 포인트 색 상자 |
| `line` | 한 줄씩만, 단어 강조 없이(정보 영상) |

옵션: `offset`(전체를 미는 초), `linger`(줄이 끝난 뒤 남는 초, 기본 0.3). 크기는 `.mo-captions { --cap: 5.6 }`(u 단위).
자막 파일 만들기: `motion captions plan 대본.txt`(말 속도로 계획) · `motion captions align 대본.txt 녹음.wav`(녹음의 쉬는 구간에 정렬 → 단어 시각까지). 자세히는 `references/captions.md`.

## 17. 스프링 — 물리로 움직이는 감속

```js
tl.to('#card', { y: 0, ...M.spring('snappy') }, 1.2);             // { ease, duration } — 길이는 스프링이 멈출 때까지
tl.to('#chip', { scale: 1, ...M.spring({ stiffness: 260, damping: 15 }) }, 2.0);
const L = M.springValue([[0, 40], [1.4, 220], [2.6, 420]], 'snappy');   // 목표가 바뀔 때마다 그 자리에서 새 스프링(중간에 바뀌어도 매끄럽다)
const R = M.springValue([[0, 160], [1.4, 340], [2.6, 520]], 'gentle');  // 앞뒤 가장자리를 다른 스프링으로 → 늘어났다 따라붙는 '액체' 인디케이터
M.onFrame((t) => { const a = L(t), b = R(t); ind.style.left = a + 'px'; ind.style.width = (b - a) + 'px'; });
M.springs('#dot', { x: [[0, 0], [b(4), 300]], scale: [[0, 1], [b(4), 1.2], [b(5), 1]] }, 'bouncy');
```
프리셋: `gentle`(느긋) `smooth`(기본) `snappy`(UI) `bouncy`(작은 것만) `heavy`(큰 물체) `stiff`(거의 튕김 없이). 큰 글자·카메라에 `bouncy`를 쓰지 않는다.

## 18. 도형과 모핑

```js
M.$('#mark').setAttribute('d', M.shape('circle'));                // <svg viewBox="0 0 100 100"><path id="mark"/></svg>
M.morphPath('#mark', [M.shape('star', { n: 5 }), M.shape('heart'), '#logoPath'], { duration: 0.8, hold: 0.4 }, 2.0);
```
- `M.shape(종류, { w, h, r, n, inner, seed, wobble })` → path 데이터(기본 100×100 상자): `circle rect squircle polygon star heart blob drop arrow plus check`.
- `M.morphPath(path, 모양 | [모양…] | '#다른path', { duration, hold, ease, type }, at)` — 같은 윤곽선이 다른 모양이 된다. 점에서 로고로, 버튼에서 체크로.
- GSAP 플러그인이 모두 들어 있다: `MorphSVGPlugin` `DrawSVGPlugin` `MotionPathPlugin` `CustomEase` `CustomWiggle` `CustomBounce` `Physics2DPlugin` `ScrambleTextPlugin` `TextPlugin` `SplitText` `Flip`. 예: `CustomEase.create('hop', 'M0,0 C0.3,1.4 0.5,1 1,1')`, `tl.to(el, { motionPath: { path: '#p', align: '#p' } })`.

## 19. 전환 8종 추가

1부의 `M.transition`에 아래가 더해졌다(16종). 모두 되감기 안전.

| type | 모양 | 어울리는 곳 |
|---|---|---|
| `slide` | 새 장면이 옆에서 덮고 앞 장면은 30%만 밀리며 어두워진다 | 단계 넘기기, 카드 넘기기 |
| `blur` | 초점이 풀렸다 다시 맞으며 바뀐다 | 감성·회상 |
| `flash` | 흰 섬광(또는 `color`)을 통과 | 박자 타격, 결과 공개 |
| `leak` | 따뜻한 빛샘이 화면을 쓸고 지나간다 | 필름 느낌, 장 바꿈 |
| `clock` | 시계 방향으로 쓸며 열린다(`x`,`y` 중심) | 시간·순서 |
| `blinds` | 줄무늬 블라인드(`count`, `angle`) | 리듬감 있는 정보 전환 |
| `warp` | 화면이 일렁이며 녹아 바뀐다(`amount`) | 꿈·전환 강조 |
| `glitch` | RGB가 갈라지고 줄이 튄다(0.45초) | 테크·디지털·오류 |

## 20. 효과와 블록

```js
M.leak({ duration: 1.3, from: 'right' }, 4.0);        // 장면은 그대로, 빛샘만
M.flash({ peak: 0.7 }, b(8));                         // 섬광 한 프레임
M.rays({ count: 18, alpha: 0.06, period: 40 });       // 천천히 도는 빛살(축하·공개 뒤 배경)
M.callout('#chart', { text: '62%<small>참여</small>', side: 'right', sfx: true }, 5.6);   // 점·선·라벨 주석
M.lowerThird({ name: '김하늘', title: '수석교사 · ○○초등학교', out: 7.5, sfx: true }, 1.0);  // 이름표(HUD)
```

## 21. 차트

```html
<div id="chart" style="position:absolute;left:8%;right:8%;top:30%;height:40%"></div>
```
```js
M.chart('#chart', { type: 'column', data: [42, 58, 50, 94, 71], labels: ['월', '화', '수', '목', '금'], unit: '' }, 1.2);
M.chart('#ring', { type: 'donut', data: [62, 24, 14], labels: ['참여', '관망', '미참여'] }, 2.0);   // 가운데 = 강조 항목의 비율(%)
M.chart('#trend', { type: 'area', data: [12, 18, 15, 26, 31, 29, 44], labels: ['1월', …], highlight: 6 }, 2.4);
```
- `type`: `column`(세로 막대) `bar`(가로 막대) `line` `area` `donut` `pie`.
- 옵션: `highlight`(포인트 색 항목, 기본 가장 큰 값) `max` `unit` `decimals` `duration` `stagger` `values: false`(숫자 숨김) `center`·`caption`(도넛 가운데).
- 빈 상자에 그린다. 상자 크기를 CSS로 먼저 정한다. 강조는 하나, 나머지는 회색.

## 22. 3D와 Lottie

```html
<canvas id="three" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
```
```js
M.three('#three', (THREE, { scene, camera }) => {
  const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1.2, 0.36, 220, 32), new THREE.MeshStandardMaterial({ color: '#2EF0B0', metalness: 0.6, roughness: 0.25 }));
  scene.add(mesh, new THREE.AmbientLight('#ffffff', 0.4)); const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(3, 4, 5); scene.add(key);
  camera.position.set(0, 0, 7);
  return (t) => { mesh.rotation.set(t * 0.4, t * 0.7, 0); camera.position.z = 7 - Math.min(1, t / 3) * 1.5; };   // 시간 t에 대한 순수 함수로
});
M.lottie('#icon', { src: 'check.json', speed: 1 }, 2.0);           // 또는 <div data-lottie="check.json 2.0 loop"></div>
M.adapter({ ready: promise, seek: (t) => { /* 다른 런타임을 t에 맞춰 그린다 */ } });
```
- `M.three` — 실제 WebGL 3D(three.js). 반환한 함수가 매 프레임 `t`로 장면을 맞추고 렌더된다. `Math.random`·시계 대신 `M.rng(seed)`와 `t`만 쓴다. 4K·선명 보정에서도 해상도가 자동으로 맞는다.
- `M.lottie` — After Effects/LottieFiles의 JSON 애니메이션을 프레임 단위로 정확히 재생. 파일은 컴포지션 폴더에.
- `M.wait(promise)` — 비동기로 준비되는 것(모델 로딩 등)이 끝날 때까지 첫 프레임을 기다린다.

## 23. 그 밖의 추가

- `cur.drag(대상, { duration }, at)` — 누른 채 끌고 가서 놓기(슬라이더·드래그 앤 드롭).
- `M.text(대상, [[t, '문구'] …], { blur: true })` — 바뀌는 순간 짧게 흐려졌다 맺힌다.
- `<div id="stage" … data-loop>` — 반복(GIF·배경) 영상. `check`가 마지막 프레임이 첫 프레임과 같은지 본다.
- 화면 `cinema`(1920×804, 2.39:1) 추가.

## 24. 세부 옵션

- `M.shape(종류, { w, h, box: 100 })` — `box`는 w×h 도형을 100×100(또는 `[w, h]`) 상자 가운데에 놓는다. 원이 알약으로 바뀌어도 제자리. `{ x, y }`는 그만큼 옮긴다.
- `M.morphPath` — 닫힌 윤곽끼리는 기본으로 같은 개수의 점으로 고르게 나눠, 같은 방향·가장 덜 움직이는 시작점으로 맞춘 뒤 섞는다. 중간 모양이 찌그러지지 않는다. 열린 선(화살표·체크)이나 여러 조각은 MorphSVG로 넘어간다. `type: 'linear' | 'rotational'`이면 MorphSVG를 직접 쓴다.
- `M.springValue([[0, 0], [0.5, 100, 'bouncy'], [1.5, 0, { stiffness: 300, damping: 40 }]], 'smooth')` — 키의 세 번째 값은 그 키로 가는 스프링.
- `M.follow`를 한 요소에 여러 번 — 차례로 이어진다(나중에 시작한 경로가 그때부터 요소를 맡는다).
- `M.exit` — fade·drop은 지금 자리에서 상대적으로 움직인다(이미 위로 옮긴 요소가 제자리로 튀지 않는다). `y: 0`이면 제자리에서 사라진다.
- `M.chart` — 세로 막대의 기준선은 막대 바로 아래에서 왼쪽부터 그려진다. 항목이 적어도 막대 폭은 16u까지. 도넛 가운데 `center`: 기본은 강조 항목의 %(`unit`과 무관) · `'value'` · `'total'` · 숫자 · `false`(없음). `sfx: true` — 자랄 때 swish, 강조 값이 닿을 때 pop.
- `M.callout(대상, { text, parent })` — 기기 화면 속 요소에 주석을 달 때 `parent`로 잘리지 않는 조상(예: `.mo-laptop-lid-face`)을 준다.
- `M.three` — 캔버스가 보이지 않는 동안은 장면을 맞추지도 그리지도 않는다(그래서 pose는 t의 순수 함수여야 한다). 3D 물체가 화면에서 움직이는 거리를 재서 모션 블러 양을 정한다.
- `cam.float` — `data-loop` 영상에서는 반복 길이에 딱 맞는 주기로 바뀌어 이음매가 생기지 않는다. `cam.drift`는 여전히 반복 영상에 쓰지 않는다.
- `<img data-optional>` — 파일이 없어도 오류가 아니고 그냥 숨는다(로고 자리 등). 엔진은 이미지의 `onload`·`onerror`를 덮어쓰지 않는다.
- `--vars "note="` — 빈 값으로 그 줄을 지운다. `batch`의 빈 칸은 기본값을 쓴다.
- 기본값에 `<br>`이 있는 변수는 `motion vars`에 `\n`으로 보이고, 값에 `\n`을 쓰면 줄바꿈이 된다.
- 템플릿이 스스로 기본값을 가질 수 있다: `<meta name="motion-template" content='{"format":"wide","duration":14,"files":["a.json"]}'>`(`templates/index.json`이 우선).
- `motion new --brand brand.json` — 이름·한 줄 소개(화면용으로 줄임)·주소·로고가 `data-var="name|tagline|url|logo"` 기본값에 들어간다.
- `<div id="stage" … data-overlay>` — 편집 프로그램에 얹는 오버레이(이름표·자막바). 점수에서 훅·리듬·움직임·사운드를 빼고 나머지로 환산한다. 렌더는 `--format mov --alpha`.

## 25. 함정

- 처음 값이 `calc(…)`인 CSS 변수를 GSAP으로 트윈하면 시작값을 0으로 기록한다 → 시작값을 숫자로(`fromTo`) 준다.
- `tl.set(el, { attr: { class } })`는 뒤로 찾아갈 때 되돌려지지 않는다 → 클래스는 `M.onFrame((t) => el.classList.toggle('on', t >= 3))`처럼 t로 정한다.
- 단위 없는 `borderRadius` 트윈은 CSS의 `%` 단위를 물려받는다 → `'12px'`처럼 단위를 적는다.
- `M.transition`은 두 장면에 z-index를 준다 → 같은 `.mo-world` 안의 다른 요소(장면 밖 주인공 등)는 자기 z-index를 가져야 가려지지 않는다.
- HUD에 `data-theme`을 주면 글자 색만 바뀐다(배경을 칠하지 않는다).
