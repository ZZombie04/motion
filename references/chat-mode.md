# 대화창 모드 — 도구 없이 HTML 한 파일로 낼 때

ChatGPT 캔버스·Claude 아티팩트처럼 **파일 시스템과 터미널이 없는 곳**에서는 렌더러를 쓸 수 없다. 이때는 같은 연출 방법(리프롬프트 → 트리트먼트)을 그대로 쓰되, 결과를 **스스로 재생되는 단일 HTML**로 낸다. 사용자는 미리보기로 확인하고, MP4가 필요하면 그 파일을 로컬에서 `motion render`로 뽑는다.

## 규칙

1. 트리트먼트를 먼저 6–10줄로 쓴다(director.md §9).
2. 한 파일 안에 CSS·JS를 모두 넣는다. GSAP만 CDN에서 불러온다: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js`
3. **일시정지된 타임라인 하나**를 만들고, 아래 플레이어 조각으로 재생한다(자동 반복 + 스크럽). 이렇게 하면 나중에 엔진으로 옮겨도 그대로 동작한다.
4. 글꼴은 `Pretendard`를 CDN 스타일시트로: `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css`
5. 색·타이포·모션 규칙은 SKILL.md §3과 같다(포인트 한 색, 마스크 리빌, mo.out, 드리프트, 0.8초 홀드).
6. `setTimeout`·CSS 애니메이션·`Math.random`은 여기서도 쓰지 않는다.

## 최소 뼈대

```html
<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<style>
  html,body{margin:0;height:100%;background:#050506;overflow:hidden}
  #stage{position:absolute;left:0;top:0;width:1080px;height:1920px;transform-origin:0 0;overflow:hidden;
    --u:10.8px;--bg:#09090B;--fg:#F5F5F7;--fg2:rgba(245,245,247,.66);--fg3:rgba(245,245,247,.42);--accent:#3D7BFF;
    background:radial-gradient(ellipse 62% 40% at 50% -8%,rgba(255,255,255,.14),transparent 72%),var(--bg);
    color:var(--fg);font-family:"Pretendard Variable",Pretendard,system-ui,sans-serif;word-break:keep-all}
  #world{position:absolute;inset:0;transform-origin:50% 50%}
  .label{font:500 calc(var(--u)*2.1)/1.2 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--fg3)}
  .display{margin:0;font-size:calc(var(--u)*13.2);font-weight:720;line-height:1.1;letter-spacing:-.04em}
  .line{display:block;overflow:hidden;padding:.16em .1em .22em;margin:-.16em -.1em -.22em}
  .line>span{display:block}
  #bar{position:fixed;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.12)} #bar>i{display:block;height:100%;width:0;background:#fff}
</style></head><body>
<div id="stage"><div id="world">
  <div style="position:absolute;left:8%;right:8%;top:34%">
    <p class="label" id="kick">Kicker · 01</p>
    <h1 class="display"><span class="line"><span>첫째 줄</span></span><span class="line"><span>둘째 줄</span></span></h1>
  </div>
</div></div>
<div id="bar"><i></i></div>
<script>
const D = 8, W = 1080, H = 1920;                       // 길이(초), 캔버스
const ease = { out: 'expo.out', inOut: 'power3.inOut', in: 'power2.in' };
const tl = gsap.timeline({ paused: true, defaults: { duration: 0.9, ease: ease.out } });

tl.fromTo('#world', { scale: 1 }, { scale: 1.05, duration: D, ease: 'none' }, 0);     // 느린 드리프트
tl.from('#kick', { autoAlpha: 0, y: 24 }, 0.1);
tl.from('.line>span', { yPercent: 118, duration: 1.05, stagger: 0.1 }, 0.25);         // 마스크 리빌
tl.set({}, {}, D);

// ── 플레이어: 벽시계로 seek만 한다(렌더러와 같은 방식) ──
const stage = document.getElementById('stage'), fill = document.querySelector('#bar>i');
function fit(){ const s = Math.min(innerWidth / W, innerHeight / H); stage.style.transform = `translate(${(innerWidth - W*s)/2}px,${(innerHeight - H*s)/2}px) scale(${s})`; }
addEventListener('resize', fit); fit();
let t0 = performance.now(), paused = false;
window.__motion = { duration: D, width: W, height: H, fps: 30, ready: true, seek: (t) => tl.time(Math.min(D, Math.max(0, t))) };
(function loop(now){ if (!paused) { const t = ((now - t0) / 1000) % (D + 0.6); __motion.seek(t); fill.style.width = Math.min(100, t / D * 100) + '%'; } requestAnimationFrame(loop); })(t0);
addEventListener('keydown', (e) => { if (e.code === 'Space') paused = !paused; });
</script></body></html>
```

`requestAnimationFrame`은 **플레이어에만** 쓴다(화면 상태는 오직 `tl.time(t)`로 결정된다).

## 엔진으로 옮기기

로컬에서 MP4가 필요해지면:

1. `motion new work/scene.html --format shorts --duration 8`
2. 위 파일의 마크업·스타일·타임라인을 옮긴다. 대응 관계:

| 대화창 모드 | 엔진 |
|---|---|
| `#world` + 수동 scale | `.mo-world` + `cam.drift()` |
| `.line > span` 수동 마스크 | `M.reveal(el, { type: 'rise' })` |
| `expo.out` / `power3.inOut` | `mo.out` / `mo.inOut` |
| 직접 만든 타이핑·카운트 | `M.type` / `M.count` |
| 플레이어 조각 | 삭제(엔진에 내장) |

3. `motion check` → `motion sheet` → `motion render`.

## 커스텀 GPT·프로젝트 지침으로 쓸 때

이 저장소의 `gpt/INSTRUCTIONS.md`를 지침에 붙이고, `references/`의 문서들을 지식 파일로 올린다. 지침은 "트리트먼트 → 단일 HTML" 흐름과 품질 규칙을 요약해 둔 것이다.
