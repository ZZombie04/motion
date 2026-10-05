# 레시피 — 장면 유형별 뼈대

각 레시피는 **언제 쓰나 → 비트 → 핵심 코드**. 그대로 베끼는 틀이 아니라 출발점이다. 문구·수치·시간은 트리트먼트에 맞춘다.
코드의 `tl, cam, u, W, H`는 `const { tl, cam, u, W, H } = M;`. 모든 레시피는 `M.grain(); cam.drift({ zoom: 1.05 });`가 깔려 있다고 가정한다.

목차 — **타이포** 1 헤드라인+형광펜 · 2 박자 워드 슬램 · 3 문구 교체 슬롯 · 4 아웃라인 마키 배경 ｜ **숫자** 5 스탯 히어로 · 6 전→후 숫자 · 7 링 게이지 · 8 막대 차트 · 9 선 차트 ｜ **UI** 10 입력→결과 · 11 채팅 스트리밍 · 12 작업 체크리스트 · 13 터미널 실행 · 14 검색→답 ｜ **기기·깊이** 15 폰 히어로 턴 · 16 노트북 열기 · 17 레이어 패럴랙스+랙 포커스 · 18 스포트라이트 리프트 ｜ **전환** 19 줌 스루 · 20 공유 요소 변신 · 21 풀백 리빌 ｜ **설명** 22 흐름 다이어그램 · 23 단계 1·2·3 · 24 전/후 와이프 ｜ **브랜드** 25 로고 스팅 · 26 엔드카드 · 27 로워서드(투명) ｜ **분위기** 28 사진 켄 번스 · 29 색종이·입자

---

## 1. 헤드라인 + 형광펜
*언제*: 질문·선언 한 줄로 시작/끝낼 때.
```html
<p class="mo-label" id="kick">NOTE · 01</p>
<h1 class="mo-display" id="head">잘 쓴 프롬프트보다<br><span id="key">좋은 질문</span>이 먼저</h1>
<p class="mo-body" id="sub">무엇을 물을지부터 정하세요.</p>
```
```js
M.reveal('#kick', { type: 'fade' }, 0.1);
M.reveal('#head', { type: 'rise' }, 0.25);       // 줄 단위 마스크
M.highlight('#key', { duration: 0.55 }, 1.35);   // 글자가 다 선 뒤 0.2초
M.reveal('#sub', { type: 'fade' }, 1.7);
```
변주: 형광펜 대신 `<span class="mo-serif">` 한 단어 / `M.fill('.mo-underline', 1.4)` 밑줄.

## 2. 박자 워드 슬램
*언제*: 행사·운동회·모집·오프닝. 음악에 얹을 영상.
```html
<section class="mo-scene" id="w0"><h1 class="slam">READY</h1></section>
<section class="mo-scene" id="w1" data-theme="pop"><h1 class="slam">달리고</h1></section>
<section class="mo-scene" id="w2"><h1 class="slam">던지고</h1></section>
<section class="mo-scene" id="w3" data-theme="paper"><h1 class="slam">함께</h1></section>
```
```css
.mo-scene { display: flex; align-items: center; justify-content: center; }
.slam { margin: 0; font-size: calc(var(--u) * 30); font-weight: 800; letter-spacing: -0.05em; line-height: 1; }
```
```js
const b = M.beats(128), ids = ['#w0', '#w1', '#w2', '#w3'];
ids.forEach((id, i) => {
  M.transition('cut', i ? ids[i - 1] : null, id, { at: b(i) });
  tl.fromTo(`${id} .slam`, { scale: 1.22 }, { scale: 1, duration: b.len * 0.75, ease: 'mo.snap' }, b(i));
  tl.to(`${id} .slam`, { scale: 1.04, duration: b.len, ease: 'none' }, b(i) + b.len * 0.75 - 0.001);   // 컷 안에서도 계속 움직인다
  cam.punch({ scale: 1.04 }, b(i));                                                                    // 화면 전체가 박을 받는다
});
```
변주: 한 단어만 `skewX: -8`로 기울여 속도감, 한 컷만 `mo-outline`. 큰 단어는 `M.fitText('.slam', W * 0.84)`로 폭을 맞춘다. 검수는 `motion sheet --beats 128`.

## 3. 문구 교체 슬롯
*언제*: "회의록은/메일은/리서치는 AI가" — 한 자리만 바뀌는 문장.
```html
<h1 class="mo-h1">이제 <span class="slot"><span class="s">회의록은</span><span class="s">메일은</span><span class="s">리서치는</span></span><br>AI가 정리합니다</h1>
```
```css
.slot { display: inline-block; position: relative; height: 1.2em; overflow: hidden; vertical-align: bottom; }
.slot .s { display: block; line-height: 1.2em; white-space: nowrap; }
```
```js
const items = M.$$('.slot .s'), slot = M.$('.slot');
gsap.set(slot, { width: items[0].offsetWidth });
items.forEach((el, i) => {
  if (!i) return;
  const at = 1.0 + (i - 1) * 0.7;
  tl.to(items, { yPercent: -100 * i, duration: 0.55, ease: 'mo.inOut' }, at);            // 위로 굴러 넘어감
  tl.to(slot, { width: el.offsetWidth, duration: 0.55, ease: 'mo.inOut' }, at);          // 폭도 새 단어에 맞게
});
```

## 4. 아웃라인 마키 배경
*언제*: 가운데 카드/숫자 뒤에 질감이 필요할 때.
```html
<div class="rows" data-deco>
  <div class="row mo-outline">MAKE IT RUN · </div><div class="row mo-outline">MAKE IT RUN · </div><div class="row mo-outline">MAKE IT RUN · </div>
</div>
```
```css
.rows { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: calc(var(--u) * 1); opacity: 0.22; }
.row { font-family: var(--font-latin); font-weight: 800; font-size: calc(var(--u) * 17); line-height: 1; }
```
```js
M.marquee('.row', { speed: M.u * 9, alternate: true });   // 한 줄씩 반대 방향으로
```

## 5. 스탯 히어로
*언제*: 숫자 하나가 메시지일 때.
```html
<p class="mo-label" id="lab">HOURS SAVED / WEEK</p>
<div class="num"><span id="n"></span><small>시간</small></div>
<div class="mo-progress accent" id="bar"><i></i></div>
<p class="mo-body" id="cap">회의록·메일 자동화로 줄인 시간 (예시)</p>
```
```css
.num { display: flex; align-items: baseline; font-family: var(--font-latin); font-weight: 650; font-size: calc(var(--u) * 40); line-height: 0.82; letter-spacing: -0.065em; }
.num small { font-family: var(--font-sans); font-size: 0.25em; font-weight: 720; letter-spacing: -0.02em; margin-left: 0.4em; }   /* 단위는 별도 요소, 숫자와 밑선을 맞춘다 */
```
```js
M.reveal('#lab', { type: 'fade' }, 0.1);
tl.from('.num', { yPercent: 14, autoAlpha: 0, duration: 0.7 }, 0.15);
M.count('#n', { from: 0, to: 12, duration: 1.5, pulse: { target: '.num', scale: 1.06 } }, 0.3);   // 최종 숫자가 뜨는 프레임에 펄스
M.fill('#bar', { to: 12 / 40, duration: 1.5, ease: 'power3.out' }, 0.3);    // 숫자와 같은 감속
M.reveal('#cap', { type: 'words' }, 1.9);
cam.to({ zoom: 1.08, duration: 2.4 }, 0.3);
```
자릿수가 굴러 오르게 하려면 `M.odometer('#n', '1,284', { duration: 1.6 }, 0.3)`.

## 6. 전 → 후 숫자
*언제*: "120분이 10분으로". 나란히 놓지 말고 **같은 자리에서** 바꾼다.
```js
M.count('#n', { from: 120, to: 10, duration: 1.25, ease: 'power3.inOut', pulse: { target: '.num' } }, 1.0);   // 서 있던 값에서 출발 → inOut
M.fill('#bar', { from: 1, to: 10 / 120, duration: 1.25, ease: 'power3.inOut' }, 1.0);   // 막대도 같이 줄어든다
M.reveal('#cap', { type: 'words' }, 2.15);     // "110분을 돌려받습니다"
```
완성 예: `samples/01-ai-teacher.html`의 4번 장면.

## 7. 링 게이지
```html
<svg id="ring" viewBox="0 0 200 200" style="width:calc(var(--u)*52);height:calc(var(--u)*52);transform:rotate(-90deg)">
  <circle cx="100" cy="100" r="86" fill="none" stroke="var(--fg-4)" stroke-width="10"/>
  <circle id="arc" cx="100" cy="100" r="86" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="38"/>   <!-- 시작 62% -->
</svg>
```
```js
tl.to('#arc', { strokeDashoffset: 100 - 96, duration: 1.8, ease: 'power3.inOut' }, 1.0);
M.count('#pct', { from: 62, to: 96, duration: 1.8, ease: 'power3.inOut', pulse: true }, 1.0);   // 링과 같은 이징. 가운데: <div class="mo-stat-num"><span id="pct"></span><small>%</small></div>
```
링 대신 가는 눈금 100개가 차오르는 게이지: `samples/03-participation.html`.

## 8. 막대 차트
```html
<div class="mo-bars" id="chart"><div class="mo-bar" style="--v:.42"></div><div class="mo-bar" style="--v:.58"></div><div class="mo-bar" style="--v:.5"></div><div class="mo-bar accent" style="--v:.94"></div></div>
```
```js
M.reveal('#chart .mo-bar', { type: 'grow', axis: 'y', stagger: 0.09, duration: 0.9 }, 0.6);
```
포인트 색은 말하려는 막대 하나에만. 값 라벨은 막대 위에 `mo-label`로, 막대보다 0.3초 늦게 `fade`.

## 9. 선 차트
```html
<svg class="mo-draw" id="line" viewBox="0 0 800 300" style="width:100%;color:var(--accent)">
  <path d="M0 250 C120 240 160 200 260 190 S420 150 520 110 S700 60 800 30" stroke-width="5"/>
</svg>
<span class="mo-chip accent" id="tip" style="position:absolute">+34%p</span>
```
```js
M.reveal('#line', { type: 'draw', duration: 1.6 }, 0.6);
M.reveal('#tip', { type: 'pop' }, 2.1);      // 선의 끝점 좌표에 배치
```

## 10. 입력 → 결과(인서트의 기본형)
*언제*: 기능 시연. 기기 틀 없이 화면 속 UI만.
```html
<h2 class="mo-h2" id="q">무엇을 도와드릴까요?</h2>
<div class="mo-input" id="field"><span class="grow"><span id="ph" class="ph">무엇이든 맡겨 보세요</span><span id="typed"></span></span><span class="mo-btn round" id="send"><i data-icon="arrow-up"></i></span></div>
<div class="mo-card" id="result"><p class="mo-label">RESULT</p><div class="mo-list"><div class="mo-item">…</div><div class="mo-item">…</div><div class="mo-item">…</div></div></div>
```
```js
const cur = M.cursor({ x: W * 0.86, y: H * 0.86, hidden: true });
M.reveal('#q', { type: 'words' }, 0.1);  M.reveal('#field', { type: 'lift' }, 0.25);
cur.show(0.5);  cur.moveTo('#ph', 0.5);  cur.click(1.3);
tl.to('#ph', { autoAlpha: 0, duration: 0.2 }, 1.32);
M.type('#typed', '이번 주 회의록 3줄로 요약해줘', { duration: 1.4 }, 1.45);
cur.moveTo('#send', 2.95);  cur.click(3.4, { accent: true });  M.press('#send', 3.4);  cur.hide(3.6);
M.reveal('#result', { type: 'lift' }, 3.55);
M.reveal('#result .mo-item', { type: 'fade', stagger: 0.12 }, 3.8);
cam.lookAt('#field', { zoom: 1.15, duration: 1.4 }, 1.0);  cam.home({ duration: 1.3 }, 3.4);
```
`#ph`와 `#typed`는 같은 자리에 겹치게(`.grow { position: relative }`, `#ph { position: absolute }`).

## 11. 채팅 스트리밍
```html
<div class="mo-chat">
  <div class="mo-bubble me" id="m1">회의록에서 할 일만 뽑아줘</div>
  <div class="mo-bubble ai" id="think"><span class="mo-dots"></span></div>
  <div class="mo-bubble ai" id="m2">이번 주 회의록에서 할 일 3개를 찾았어요. 디자인 리뷰는 수요일까지, 결제 테스트는 금요일까지입니다.</div>
</div>
```
```js
M.dots('.mo-dots');
M.reveal('#m1', { type: 'pop', scale: 0.86 }, 0.4);
M.scene('#think', 1.0, 2.2);  M.reveal('#think', { type: 'fade' }, 1.0);
M.scene('#m2', 2.2);          M.stream('#m2', { wps: 14 }, 2.25);
```
`#think`와 `#m2`는 같은 자리에 겹쳐 두고(절대 위치) 창으로 바꿔 끼운다.

## 12. 작업 체크리스트(에이전트 실행)
```html
<div class="mo-card mo-sheen" id="run">
  <p class="mo-label"><span class="mo-dot"></span><span id="st">AGENT · RUNNING</span></p>
  <h3 class="mo-h3">경쟁사 3곳 가격 정책 비교</h3>
  <div class="mo-list">
    <div class="mo-item"><span class="status"><span class="mo-spinner"></span><span class="mo-check"></span></span><span class="grow">공식 페이지 읽기</span><span class="meta">0.8s</span></div>
    … (3–4줄)
  </div>
  <div class="mo-progress accent" id="bar"><i></i></div>
</div>
```
```css
.status { position: relative; width: calc(var(--u) * 4.4); height: calc(var(--u) * 4.4); flex: none; }
.status > * { position: absolute; inset: 0; width: auto; height: auto; }  .status .mo-check { box-shadow: none; }
#run .grow { opacity: 0.45; }
```
```js
M.spin('#run .mo-spinner');
M.reveal('#run', { type: 'lift' }, 0.2);  M.reveal('#run .mo-item', { type: 'fade', stagger: 0.09 }, 0.5);
const rows = M.$$('#run .mo-item');
rows.forEach((r, i) => {
  const at = 1.3 + i * 0.6;
  tl.to(r.querySelector('.mo-spinner'), { scale: 0.4, autoAlpha: 0, duration: 0.18, ease: 'mo.in' }, at);
  M.fill(r.querySelector('.mo-check'), { duration: 0.5, ease: 'mo.spring' }, at + 0.06);
  tl.to(r.querySelector('.grow'), { opacity: 1, duration: 0.3 }, at);
  tl.from(r.querySelector('.meta'), { autoAlpha: 0, x: u, duration: 0.4 }, at + 0.1);
  M.fill('#bar', { from: i / rows.length, to: (i + 1) / rows.length, duration: 0.55, ease: 'mo.inOut' }, at);
});
const done = 1.3 + rows.length * 0.6;
tl.set('#st', { textContent: 'AGENT · DONE' }, done);
tl.fromTo('#run', { '--sheen': -0.3 }, { '--sheen': 1.3, duration: 0.9, ease: 'mo.inOut' }, done);
cam.to({ ry: -7, rx: 3, duration: 1.3 }, 0.2);  cam.to({ ry: 6, rx: 1, duration: 2.6, ease: 'mo.inOut' }, 1.5);
```

## 13. 터미널 실행
```html
<div class="mo-window" id="term"><div class="mo-window-bar"><span class="mo-label">TERMINAL</span></div>
  <div class="mo-window-body"><div class="mo-terminal"><span class="p">$</span> <b id="cmd"></b>
<span class="ln"><span class="ok">✓</span> 노트 폴더 읽기 · 14 files</span>
<span class="ln"><span class="ok">✓</span> 링크 8개 본문 가져오기</span>
<span class="ln"><span class="ok">✓</span> 요약 문서 저장</span></div></div></div>
```
```js
M.type('#cmd', 'agent "이번 주 리서치 정리해줘"', { duration: 1.5 }, 0.6);
M.reveal('#term .ln', { type: 'fade', y: u, stagger: 0.36 }, 2.3);
```
`.ln { display: block; }`. 마지막에 `<span class="mo-chip accent">DONE</span>`을 `pop`.

## 14. 검색 → 답
*비트*: 검색어 타이핑 → 결과 3개 중 2개가 흐려짐 → 하나가 화면을 채우며 답이 드러남.
```js
M.type('#q', '운동회 우천 시 일정', { duration: 1.0 }, 0.4);
tl.to('#r1, #r3', { opacity: 0.3, duration: 0.4 }, 1.7);
tl.to('#r2', { scale: 1.04, duration: 0.4, ease: 'mo.spring' }, 1.7);
cam.lookAt('#r2', { fill: 0.9, duration: 1.2 }, 2.4);          // 선택한 카드로 들어간다
M.reveal('#answer', { type: 'rise' }, 3.1);  M.highlight('#answer .key', 4.0);
```

## 15. 폰 히어로 턴
*언제*: 앱·모바일 서비스가 주인공.
```html
<div class="mo-glow" style="left:50%;top:58%;--s:calc(var(--u)*90);--a:.26"></div>   <!-- .mo-bg 안 -->
<div class="mo-phone" id="ph" style="--pw:calc(var(--u)*46);position:absolute;left:50%;top:50%;margin:calc(var(--u)*-49) 0 0 calc(var(--u)*-23)">
  <div class="mo-screen">…앱 화면…</div>
</div>
```
```js
gsap.set('#ph', { rotationY: 158, rotationX: 12, y: u * 14 });                     // 뒷면에서 시작
tl.to('#ph', { rotationY: -10, rotationX: 4, y: 0, duration: 2.2, ease: 'mo.inOut' }, 0.1);   // 떠오르며 앞면으로
cam.to({ ry: 7, zoom: 1.12, duration: 3.6, ease: 'sine.inOut' }, 1.5);             // 폰이 멈추기 전에 카메라가 이어받아 천천히 돈다(같은 속성을 두 번 걸지 않는다)
M.float('#ph', { y: u * 0.8, period: 5 });
M.tap('#row2', 4.1);                                                               // 화면 속 대상의 탭은 그 화면 위에 그려진다
cam.lookAt('#ph .mo-screen', { fill: 0.92, ry: 0, duration: 1.6 }, 5.2);           // 화면 속으로 — 기울인 채 다가가도 렌더는 선명하다
```
화면 속 UI 애니메이션(목록 `fade`, 진행 막대 `M.fill`)을 회전이 끝날 즈음 시작한다. 화면이 프레임을 꽉 채우는 동안은 HUD 라벨을 내린다. 완성 예: `samples/04-reading-app.html`.

## 16. 노트북 열기
```js
gsap.set('#lp', { rotationX: -14, rotationY: 26 });
tl.fromTo('#lp', { '--open': 3 }, { '--open': 106, duration: 1.4, ease: 'mo.inOut' }, 0.2);     // 덮개가 열린다
tl.from('#lp .mo-screen > *', { autoAlpha: 0, duration: 0.5 }, 1.0);                             // 화면이 켜진다
tl.to('#lp', { rotationX: -4, rotationY: 0, duration: 1.8, ease: 'mo.inOut' }, 1.6);             // 정면으로
cam.lookAt('#lp .mo-screen', { zoom: 1.5, duration: 1.6 }, 3.0);                                 // 화면 속으로(오토 줌)
```
노트북의 왼쪽 위 좌표는 덮개 기준이다. 키보드는 그 아래로 깔리므로 아래 여백을 넉넉히 둔다.

## 17. 레이어 패럴랙스 + 랙 포커스
```html
<div class="mo-layer" data-z="-600"><div class="mo-gridlines"></div><h1 class="mo-display" style="position:absolute;left:8%;top:18%">일은 AI에게,<br>판단은 나에게</h1></div>
<div class="mo-layer" data-z="0"><div class="mo-card" id="chat" style="position:absolute;left:14%;top:52%;width:44%">…</div></div>
<div class="mo-layer" data-z="260"><div class="mo-card mo-lift" id="noti" style="position:absolute;left:52%;top:40%;width:38%">…</div></div>
```
```js
cam.to({ x: W / 2 + u * 12, ry: -5, duration: M.D, ease: 'sine.inOut' }, 0);    // 한 번의 긴 옆 이동 → 층마다 다른 속도
cam.set({ aperture: 2.4, focus: 260 });                                          // 앞 카드에 초점
cam.to({ focus: -600, duration: 0.9, ease: 'mo.inOut' }, 2.2);                   // 뒤 제목으로 초점 이동
cam.to({ focus: 260, duration: 0.9, ease: 'mo.inOut' }, 4.2);
```

## 18. 스포트라이트 리프트
*언제*: 여럿 중 하나를 고를 때(대시보드의 카드 하나, 격자의 한 칸).
```js
cam.set({ rx: 16, ry: -12, zoom: 0.94 });  cam.to({ rx: 4, ry: 0, zoom: 1.05, duration: M.D - 0.5 }, 0);
tl.to('.tile:not(#pick)', { opacity: 0.28, duration: 0.6 }, 1.2);
tl.to('#pick', { z: u * 9, scale: 1.08, duration: 0.8, ease: 'mo.out' }, 1.2);       // 카메라 쪽으로 들린다
tl.set('#pick', { attr: { class: 'tile mo-card mo-lift mo-ring' } }, 1.2);     // 클래스 교체는 attr로(되감아도 안전)
M.count('#pick .v', { from: 0, to: 6.5, decimals: 1, duration: 1.1 }, 1.5);
tl.to('#pick', { z: 0, scale: 1, duration: 0.8, ease: 'mo.inOut' }, 4.0);  tl.to('.tile', { opacity: 1, duration: 0.6 }, 4.1);
```
격자 부모에 `data-3d` 속성(원근 전달).

## 19. 줌 스루
```js
const z = M.rect('#zero'), s = M.rect('#sceneA');
tl.to('#sceneA', { scale: 15, transformOrigin: `${z.cx - s.x}px ${z.cy - s.y}px`, duration: 0.85, ease: 'power3.in' }, 2.5);
tl.to('#sceneA', { autoAlpha: 0, duration: 0.14 }, 3.2);
tl.from('#sceneB', { scale: 0.62, autoAlpha: 0, duration: 1.0, ease: 'mo.out' }, 2.95);
```
통과 지점은 글자의 빈 속(0·O·ㅇ), 버튼, 카드의 빈 영역. 장면이 무대 전체 크기면 `M.transition('zoom', '#a', '#b', { at, origin: '62% 40%' })` 한 줄.

## 20. 공유 요소 변신(입력창 → 카드)
```js
const bodyH = M.rect('#cardBody').h, pn = M.rect('#panel');
tl.to('#panel', { top: H * 0.27, height: bodyH, borderRadius: u * 5, duration: 0.95, ease: 'mo.settle' }, 6.05);   // 같은 상자가 자란다
tl.to('#typedBox', { y: M.rect('#titleSlot').cy - pn.y - pn.h / 2, duration: 0.95, ease: 'mo.settle' }, 6.05);     // 친 문장이 제목 자리로
tl.from('#cardBody .mo-item', { autoAlpha: 0, y: u * 3, duration: 0.65, stagger: 0.1 }, 6.35);
```
`#panel`은 `overflow: hidden`, 안에 `#cardBody`(카드 내용, 제목 자리는 `visibility:hidden`인 `#titleSlot`)와 `#typedBox`를 겹쳐 둔다. 전체: `samples/01-ai-teacher.html`.
작은 요소를 다른 자리로 옮길 땐 `M.morph('#chip', '#slot', { duration: 0.9 }, 5.0)`.

## 21. 풀백 리빌
```js
const c = M.rect('#card');
cam.set({ x: c.cx, y: c.cy, zoom: 2.8 });                         // 카드가 화면을 꽉 채운 채 시작
cam.to({ x: W / 2, y: H / 2, zoom: 1, ry: -9, duration: 2.0 }, 0.7);   // 물러나면 폰 화면이었음이 드러난다
M.reveal('#side', { type: 'rise' }, 2.2);
```

## 22. 흐름 다이어그램
```html
<svg class="mo-draw" id="wires" viewBox="0 0 1920 1080" style="position:absolute;inset:0;color:var(--fg-3)"><path id="w1" d="M520 540 C700 540 760 540 900 540" stroke-width="3"/><path id="w2" d="M1180 540 C1300 540 1340 540 1460 540" stroke-width="3"/></svg>
<div class="node mo-card" id="n1">입력</div><div class="node mo-card" id="n2">처리</div><div class="node mo-card" id="n3">결과</div>
<i id="pkt"></i>
```
```css
.node { position: absolute; padding: calc(var(--u) * 2.6) calc(var(--u) * 4); font-size: calc(var(--u) * 3.4); font-weight: 640; }
#pkt { position: absolute; left: 0; top: 0; width: calc(var(--u) * 1.6); height: calc(var(--u) * 1.6); margin: calc(var(--u) * -0.8); border-radius: 50%; background: var(--accent); box-shadow: 0 0 calc(var(--u) * 2) var(--accent); }
```
```js
M.reveal('.node', { type: 'pop', scale: 0.85, stagger: 0.18 }, 0.3);
M.reveal('#wires', { type: 'draw', duration: 0.8, stagger: 0.25 }, 0.9);
M.scene('#pkt', 2.2, 3.15);
M.follow('#pkt', '#w1', { duration: 0.9, ease: 'mo.inOut' }, 2.2);                         // 점이 선을 따라 이동
M.pulse('#n2', 3.1);                                                                       // 도착한 노드가 받는다
```

## 23. 단계 1 · 2 · 3
*언제*: 방법·순서 설명. **같은 틀을 세 번** 반복해 리듬을 만든다. 장면을 끊어 갈아 끼우지 말고, 세 단계를 **옆으로 긴 세계**에 나란히 놓고 카메라가 옮겨 간 뒤 마지막에 물러나 셋을 한 화면에 모은다.
```html
<div class="mo-world">
  <section class="step" style="left:0">…</section><section class="step" style="left:100%">…</section><section class="step" style="left:200%">…</section>
</div>   <!-- 각 .step: <p class="mo-label no">STEP 01</p> <h2 class="mo-h1">제목</h2> <p class="mo-body desc">한 줄</p>. 진행선 #prog는 .mo-hud에 -->
```
```css
.step { position: absolute; top: 0; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 var(--safe-x); }
```
```js
const steps = M.$$('.step'), n = steps.length;
steps.forEach((s, i) => {
  const at = 0.4 + i * 3.0;
  if (i) cam.to({ x: W / 2 + W * i, duration: 1.1, ease: 'mo.inOut' }, at - 0.7);              // 옆 칸으로 트럭(컷 없음, 모션 블러는 자동)
  M.reveal(s.querySelector('.no'), { type: 'fade' }, at);
  M.reveal(s.querySelector('h2'), { type: 'rise' }, at + 0.1);
  M.reveal(s.querySelector('.desc'), { type: 'fade' }, at + 0.7);
  M.fill('#prog', { from: i / n, to: (i + 1) / n, duration: 0.6, ease: 'mo.inOut' }, at);       // 진행선은 단계마다 끊어서
});
const end = 0.4 + n * 3.0;
M.exit('.step .no, .step .desc', { type: 'fade' }, end - 0.4);                                                 // 물러나면 읽히지 않을 본문은 먼저 내보낸다
cam.to({ x: (W * n) / 2, zoom: 1 / (n + 0.2), duration: 1.6, ease: 'mo.cam' }, end);             // 풀백: 세 제목이 한 화면에
tl.to('.step h2', { scale: 1.7, transformOrigin: '0 50%', duration: 1.6, ease: 'mo.cam' }, end);  // 멀어지는 만큼 제목을 키워 읽히게
```
크기는 "클로즈업(zoom 1)에서 보이는 크기"로 적고 넓은 화면은 카메라가 물러나서 만든다. 세 조각이 모여 한 문장이 되는 완성 예: `samples/05-three-steps.html`.

## 24. 전 / 후 와이프
```js
M.transition('wipe', '#before', '#after', { at: 2.4, angle: -14 });   // 포인트 색 띠가 쓸고 지나가며 테마가 바뀐다
M.reveal('#after h1', { type: 'rise' }, 2.9);
```
`#before`는 `ink`, `#after`는 `data-theme="paper"`로 두면 반전이 또렷하다.

## 25. 로고 스팅(3초)
```html
<div id="mark"><i id="dot"></i><svg id="sym" viewBox="0 0 100 100">…심벌(없으면 생략)…</svg></div>
<p class="mo-h2" id="name">학교이름</p><p class="mo-label" id="tag"></p>
```
```js
M.reveal('#dot', { type: 'pop' }, 0.1);                                     // 점 하나가 켜진다
tl.to('#dot', { scale: 9, duration: 0.7, ease: 'mo.inOut' }, 0.6);          // 원으로 커지며
M.reveal('#sym', { type: 'draw', duration: 0.9 }, 0.8);                     // 심벌이 그려진다
M.reveal('#name', { type: 'chars' }, 1.2);
M.type('#tag', 'SINCE 2026 · PYEONGTAEK', { duration: 0.8, caret: false }, 1.7);
cam.to({ zoom: 0.96, duration: 2.6 }, 0.3);                                 // 살짝 물러나며
```
로고 파일이 없으면 심벌을 지어내지 말고 **이름의 워드마크 + 점**으로 만든다.

## 26. 엔드카드
```js
M.reveal('#endLabel', { type: 'fade' }, 0.3);
M.reveal('#end h1', { type: 'rise' }, 0.15);
M.highlight('#endKey', 1.05);
M.reveal('#cta', { type: 'pop' }, 0.95);
cur.show(1.2);  cur.moveTo('#cta', { ax: 0.74 }, 1.2);  cur.click(2.0);  M.press('#cta', 2.0);
```
클릭 뒤 최소 0.8초는 아무것도 더하지 않는다.

## 27. 로워서드(투명 배경)
*언제*: 편집 프로그램에서 영상 위에 얹는 이름표·자막바. `motion render --format mov --alpha`.
```html
<div id="stage" data-width="1920" data-height="1080" data-duration="5" data-theme="ink" data-accent="blue">
  <div class="lt"><i class="bar"></i><div><p class="mo-h3" id="nm">강주원 장학사</p><p class="mo-small" id="rl">평택교육지원청</p></div></div>
</div>
```
```css
.lt { position: absolute; left: 6%; bottom: 12%; display: flex; gap: calc(var(--u) * 1.6); align-items: stretch; }
.bar { width: calc(var(--u) * 0.6); background: var(--accent); border-radius: 99px; }
```
```js
M.reveal('.bar', { type: 'grow', axis: 'y', duration: 0.5 }, 0.1);
M.reveal('#nm', { type: 'rise' }, 0.2);  M.reveal('#rl', { type: 'fade' }, 0.5);
M.exit('#nm, #rl', { type: 'fade' }, 4.3);  tl.to('.bar', { scaleY: 0, duration: 0.35, ease: 'mo.in' }, 4.45);
```
배경·그레인·비네트를 넣지 않는다. 글자 뒤 가독성은 `text-shadow` 대신 반투명 `mo-glass` 판으로.

## 28. 사진 켄 번스 + 타이포
```html
<div class="mo-bg"><div class="mo-media" id="ph" style="position:absolute;inset:0;border-radius:0"><img src="./photo.jpg"></div><div class="shade"></div></div>
```
```css
.shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.72)); }
```
```js
tl.fromTo('#ph img', { scale: 1.16, xPercent: -2 }, { scale: 1.04, xPercent: 1, duration: M.D, ease: 'none' }, 0);   // 느린 줌아웃 + 미세한 이동
M.reveal('#title', { type: 'rise' }, 0.6);
```
사진은 사용자가 준 파일만 쓴다(컴포지션 폴더로 복사). 글자는 어두운 그라디언트 위에.

## 29. 색종이·입자(축하·시상)
```js
const cv = M.el('<canvas class="mo-canvas" width="' + W + '" height="' + H + '"></canvas>', '.mo-overlay'), ctx = cv.getContext('2d'), r = M.rng(7);
const bits = Array.from({ length: 140 }, () => ({ x: r(), v: 0.5 + r() * 0.7, d: (r() - 0.5) * 0.4, w: u * (0.8 + r() * 1.4), ph: r() * 6.28, c: r() < 0.3 ? 'accent' : 'fg', t0: r() * 0.5 }));
const col = { accent: getComputedStyle(M.stage).getPropertyValue('--accent'), fg: '#FFFFFF' };
M.onFrame((t) => {
  ctx.clearRect(0, 0, W, H);
  const T = t - 2.0;                                     // 2.0초에 터진다
  if (T < 0) return;
  for (const b of bits) {
    const tt = T - b.t0; if (tt < 0) continue;
    const y = -0.1 * H + (b.v * tt * 0.55 + 0.12 * tt * tt) * H, x = (b.x + b.d * tt * 0.3 + Math.sin(tt * 3 + b.ph) * 0.02) * W;
    ctx.save(); ctx.translate(x, y); ctx.rotate(tt * 4 + b.ph); ctx.scale(1, Math.cos(tt * 6 + b.ph));
    ctx.fillStyle = col[b.c]; ctx.globalAlpha = Math.max(0, 1 - tt / 3.2); ctx.fillRect(-b.w / 2, -b.w * 0.3, b.w, b.w * 0.6); ctx.restore();
  }
});
```
`<div class="mo-overlay"></div>`를 무대에 두고 그 안에 그린다. 색은 흰색 + 포인트 한 색만(무지개 금지).
