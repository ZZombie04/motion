# Motion Director

**장면을 말하면, 감독처럼 연출해 영상으로 만든다.**
Claude·GPT에 연결하는 모션그래픽 스킬 + MCP 서버 + 렌더 엔진.

"AI 연수 홍보 쇼츠 만들어줘"처럼 평범하게 말하면 —
카메라·전환·타이포·리듬을 스스로 정해(**리프롬프트**) 결정적 HTML+GSAP 컴포지션을 쓰고, 화면을 직접 보고 고친 뒤, 실제 모션 블러로 MP4를 뽑는다.
카메라 기법이나 모션 용어를 몰라도 된다.

| | | |
|:-:|:-:|:-:|
| <img src="docs/media/01-ai-teacher.webp" width="230"> | <img src="docs/media/02-sports-day.webp" width="230"> | <img src="docs/media/04-reading-app.webp" width="230"> |
| 연수 홍보 쇼츠 | 운동회 오프닝 | 앱 소개 |
| <img src="docs/media/03-participation.webp" width="300"> | <img src="docs/media/05-three-steps.webp" width="300"> | <img src="docs/media/06-logo-sting.webp" width="300"> |
| 발표용 수치 | 3단계 설명 | 채널 엔딩 |

각 샘플의 **요청 한 줄 → 트리트먼트 → 코드 → 영상**은 [`samples/`](samples/README.md)에 있다.

## 무엇이 다른가

| | |
|---|---|
| **리프롬프트** | 요청에서 목적·메시지·형식을 뽑고, 의도에 맞는 훅·카메라·전환·결과 연출을 표에서 골라 타임코드 비트 시트로 확장한다([`references/director.md`](references/director.md)). 예시에 없는 장면도 같은 방법으로 설계한다 |
| **결정적 엔진** | 일시정지된 타임라인 하나 = 모든 프레임이 시간의 함수. 한글 자모 타이핑, 휜 경로의 커서, 마스크 리빌, 3D 카메라·깊이·랙 포커스, 두께가 있는 폰·노트북, 장면 전환 7종, 부품 CSS 키트 |
| **스스로 검수** | `check`가 글자 겹침·잘림·가독성·정지 구간·늦은 시작을 실제 화면에서 측정하고, `sheet`로 뽑은 콘택트 시트를 AI가 직접 보고 고친다 |
| **실제 모션 블러** | 셔터가 열린 동안의 움직임을 재어 빠른 프레임만 최대 16번(final 32번) 나눠 찍고 선형광으로 합성한다. 흐림 필터로 흉내 내지 않는다 |
| **끝까지 선명** | 브라우저는 기울어진 3D 화면을 확대하면 글자를 뭉갠다. 렌더러가 그런 프레임을 찾아 2–3배 크기로 찍어 줄이므로, 비스듬한 폰 화면 속 작은 글자까지 또렷하다 |
| **어디서나** | Claude Code·Codex 스킬, MCP 서버(Claude Desktop 등), 커스텀 GPT 지침, CLI |

## 설치

필요한 것: Node.js 18+, Chrome 또는 Edge, ffmpeg.

```bash
git clone https://github.com/ZZombie04/motion.git
cd motion
npm install
node bin/motion.mjs doctor
```

### 연결

```bash
node scripts/connect.mjs          # Claude Code · Codex에 스킬로 연결
node scripts/connect.mjs --mcp    # MCP 서버까지 등록(Claude Code · Codex · Claude Desktop)
node scripts/connect.mjs --remove # 해제
```

| 환경 | 연결되는 방식 |
|---|---|
| Claude Code | `~/.claude/skills/motion` → 이 폴더. 새 세션에서 "…영상 만들어줘" |
| Codex | `~/.codex/skills/motion` + `~/.codex/config.toml`의 `[mcp_servers.motion]` |
| Claude Desktop 등 MCP 클라이언트 | `node <이 폴더>/mcp/server.mjs` (stdio). 작업 폴더는 `~/Motion`(`MOTION_WORKSPACE`로 변경) |
| ChatGPT 커스텀 GPT·프로젝트 | [`gpt/INSTRUCTIONS.md`](gpt/INSTRUCTIONS.md)의 지침 + `references/`를 지식 파일로. 결과 HTML은 로컬에서 `motion render` |

## 쓰는 법

스킬이 연결된 Claude Code·Codex에서:

```
우리 학교 가을 운동회 홍보 쇼츠 오프닝 만들어줘. 10월 23일 금요일이야.
```

AI가 하는 일: 트리트먼트(로그라인·룩·비트)를 짧게 보여 줌 → 컴포지션 작성 → 자동 점검 → 시트를 보고 수정 → 렌더 → 파일 경로와 바꿀 수 있는 것 안내.
이어서 "포인트 색을 초록으로", "8초로 줄여줘", "가로 버전도"처럼 말하면 된다.

직접 다룰 때:

```bash
node bin/motion.mjs new work/intro.html --format shorts --duration 12
node bin/motion.mjs preview work/intro.html        # 브라우저에서 스크럽
node bin/motion.mjs check work/intro.html
node bin/motion.mjs sheet work/intro.html --count 18
node bin/motion.mjs render work/intro.html --quality final
```

| 명령 | |
|---|---|
| `brief "요청"` | 리프롬프트 초안: 화면·길이·룩·연출 후보와 비트 시트 틀 |
| `new` | 뼈대 생성. `--format shorts`(1080×1920) `wide`(1920×1080) `square` `portrait` `insert`(1080×830) · `--theme ink night paper white pop` · `--accent blue … #hex` |
| `check` | 자동 점검(오류·경고와 고치는 법) |
| `sheet` / `frames` | 콘택트 시트 / 원본 크기 스틸. `--from/--to` 구간 · `--beats 128` 박마다 · `--guides` 안전영역 · `--no-camera` 쉬는 배치 |
| `probe` | 특정 시각의 페이지 안에서 식을 평가(`--js "M.rect('#btn')"`) |
| `render` | `--quality draft standard final` · `--format mp4 webm mov gif webp png` · `--alpha`(투명) · `--fps 60` · `--scale 2`(4K) · `--audio bgm.mp3` · `--vars "title=…"` · `--from/--to` |
| `preview` | 스크럽 미리보기(Space · ←/→ · G 안전영역) |

렌더 시간(8코어 노트북 기준): `draft`는 15초 영상에 30초 안팎, `standard`·`final`은 4초 스팅 1분, 15초 쇼츠 4–7분(기울어진 3D 장면이 많을수록 오래 걸린다).

MCP 도구: `motion_brief`(리프롬프트) · `motion_guide` · `motion_new` · `motion_write` · `motion_read` · `motion_check` · `motion_sheet` · `motion_frames` · `motion_render` · `motion_render_status` · `motion_preview` · `motion_doctor`.

## 구조

```
SKILL.md              스킬 본문 — 작업 순서와 하드 룰
references/           director(연출법) · look · motion · engine(API) · recipes(뼈대 29종) · quality(검수) · chat-mode
engine/               런타임 motion.js · motion.css · 아이콘 · 글꼴
lib/ · bin/           렌더러 · 점검기 · CLI
mcp/server.mjs        MCP 서버
gpt/INSTRUCTIONS.md   커스텀 GPT 지침
samples/              요청 → 트리트먼트 → 코드 → 영상
docs/site-analysis.md 참고 사이트 분석
```

## 출처와 라이선스

연출 방법론은 Career Hacker Alex의 [따라 만드는 모션그래픽 160](https://www.careerhackeralex.com/sharings/cha-motion-kit)을 분석해 일반화했다([분석 문서](docs/site-analysis.md)). 그 사이트의 프롬프트·영상·소스는 포함하지 않았다.
코드·문서는 MIT. 글꼴(Pretendard·Geist·Instrument Serif, OFL)과 아이콘(Lucide, ISC)의 고지는 [`NOTICE.md`](NOTICE.md).
