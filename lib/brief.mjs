import { FORMATS } from './util.mjs';

/**
 * Deterministic first pass of the director's "re-prompt": reads a plain-language request and proposes
 * format, length, look and technique picks plus a time-coded beat-sheet skeleton. The calling model
 * turns this into the final treatment (references/director.md) — it is a starting point, not a verdict.
 */

const has = (s, re) => re.test(s);

const PURPOSES = [
  { id: 'overlay', re: /자막\s?바|이름표|로워\s?서드|lower.?third|캡션\s?바|오버레이|투명\s?배경/i, label: '오버레이(자막·이름표)', dur: 5 },
  { id: 'brand', re: /로고|스팅|엔딩|엔드\s?카드|아웃트로|채널\s?(인트로|소개)|sting|outro|logo/i, label: '브랜드(로고·엔딩)', dur: 4 },
  { id: 'transition', re: /전환|트랜지션|넘어가는|transition/i, label: '장면 전환', dur: 4.5 },
  { id: 'celebrate', re: /축하|시상|수상|졸업|입학|기념|감사|환영|congrat/i, label: '축하·기념', dur: 9 },
  { id: 'event', re: /운동회|체육대회|축제|페스티벌|대회|행사|공연|캠프|모집|개최|런|마라톤|festival|event/i, label: '행사·홍보(에너지)', dur: 10 },
  { id: 'proof', re: /(\d+(\.\d+)?\s?(%|퍼센트|명|건|배|시간|분|원|점|위))|올랐|늘었|줄었|증가|감소|통계|성과|실적|참여율|만족도|달성|결과\s?보고/i, label: '증명(수치)', dur: 8 },
  { id: 'demo', re: /앱|어플|기능|화면|데모|시연|사용법|쓰는\s?법|입력하면|누르면|검색|챗|채팅|프롬프트|대시보드|웹사이트|서비스\s?소개|app|demo|ui/i, label: '시연(화면·기능)', dur: 12 },
  { id: 'explain', re: /설명|방법|단계|하는\s?법|원리|과정|이유|튜토리얼|가이드|순서|차이|비교|개념|how to|explain/i, label: '설명', dur: 20 },
  { id: 'promo', re: /홍보|소개|안내|오프닝|인트로|티저|광고|예고|promo|intro|teaser|ad\b/i, label: '홍보·인트로', dur: 12 }
];

const FORMAT_CUES = [
  ['shorts', /쇼츠|숏츠|숏폼|릴스|틱톡|세로|shorts|reels|tiktok|9\s?:\s?16|vertical/i],
  ['portrait', /4\s?:\s?5|인스타\s?피드/i],
  ['square', /정사각|1\s?:\s?1|square|피드/i],
  ['insert', /인서트|삽입\s?컷|본문\s?컷|insert/i],
  ['wide', /유튜브|발표|가로|와이드|프레젠|ppt|슬라이드|강의|화면에\s?띄울|스크린|youtube|16\s?:\s?9|wide|landscape/i]
];

const LOOKS = {
  tech: { theme: 'ink', accent: 'blue', backdrop: 'mo-stagelight + mo-dotgrid + mo-horizon', type: 'Pretendard 굵게 + 모노 라벨', note: '키노트 톤. 검정 위 한 줄기 빛' },
  edu: { theme: 'paper', accent: 'blue', backdrop: 'mo-stagelight(옅게)', type: 'Pretendard, 넉넉한 여백', note: '차분한 문서·안내 톤' },
  event: { theme: 'ink ↔ pop 반전', accent: 'orange', backdrop: '무늬 없이 면 분할(그레인 + 옅은 mo-stagelight) · 트랙 라인 같은 그래픽 모티프', type: '아주 큰 굵은 글자(20–30u), 한 단어 기울임', note: '박자 컷 + 테마 반전이 주인공' },
  data: { theme: 'night', accent: 'mint', backdrop: 'mo-gridlines(옅게) + mo-spot', type: '숫자는 Geist(mo-latin), 라벨 정돈', note: '숫자 하나가 주인공(세로는 폭의 55–80%, 가로는 높이의 35–50%)' },
  warm: { theme: 'night', accent: 'amber', backdrop: 'mo-glow + M.particles({ bokeh: true }) + mo-letterbox', type: '세리프 이탤릭 한 단어 혼합', note: '느린 패럴랙스와 마스크 리빌' },
  life: { theme: 'white', accent: 'orange', backdrop: 'mo-stagelight만 + 카드 그림자', type: '둥근 칩·카드, 밝고 또렷하게', note: '제품 사진 같은 밝음' },
  brand: { theme: 'ink', accent: 'white', backdrop: 'mo-stagelight + mo-glow(가운데)', type: '워드마크 + 넓은 자간 라벨', note: '비움이 주목을 만든다' }
};

const PICKS = {
  promo: { hook: '첫 프레임부터 움직이는 큰 숫자 또는 질문 2줄(rise) + 핵심어 형광펜. 카메라는 비스듬→정면 정착', camera: '훅 정착 → 푸시 인 → 오빗 → 정면 정착', text: '제목 rise · 한 줄 words · 수치 count', link: '공유 요소 변신(입력창→카드, 막대→밑줄) 또는 줌 스루', payoff: '숫자 하나 + 막대 → 엔드카드(제목 2줄 + CTA)' },
  event: { hook: '박자에 맞춘 워드 슬램(하드컷) — BPM 120–128', camera: '컷마다 1.04 펀치 인, 마지막에 느린 푸시', text: 'slam · 아주 큰 글자 · 날짜는 odometer', link: 'cut(박자) → whip → 그래픽 모티프가 날짜의 밑줄이 됨', payoff: '날짜·장소가 1초 이상 정지하는 엔드 프레임' },
  proof: { hook: '라벨 + 이전 값에서 멈춘 게이지', camera: '수치가 오르는 동안 푸시 인 1 → 1.1, 착지 후 드리프트', text: '숫자 count/odometer(Geist), 단위는 1/4 크기', link: '같은 자리에서 A가 B로 변한다(나란히 놓지 않는다)', payoff: '착지 pulse + 차이값 칩 pop + 해석 한 줄, 1.2초 이상 정지' },
  demo: { hook: '기기가 돌아서며 등장하거나, 기기 틀 없이 UI가 lift', camera: '오토 줌(커서가 갈 곳으로 lookAt) → 결과에서 풀백', text: 'M.type 한글 자모 타이핑 · M.stream 답변 · 라벨은 mo-label', link: '커서의 원인→결과, 입력창이 결과 카드로 자람', payoff: '끝 상태를 0.8초 이상 정지 → 앱 이름 엔드카드' },
  explain: { hook: '2–3초 제목(rise)', camera: '옆으로 긴 한 세계를 트럭으로 지나간다(단계마다 같은 무브 = 리듬), 요약에서 풀백', text: '번호 라벨 + 짧은 제목 + 한 줄', link: '장면을 갈아 끼우지 않는다 — 같은 틀을 반복하며 한 요소(문장·막대·점)가 단계마다 이어진다', payoff: '세 단계가 한 화면에 모인 요약 프레임 홀드' },
  brand: { hook: '점 하나가 켜진다', camera: '살짝 풀백(1 → 0.96)', text: '이름 chars · 태그라인 type/scramble', link: '점 → 원(iris) → 심벌/워드마크', payoff: '이름 + 한 줄, 1초 홀드' },
  transition: { hook: '앞 장면의 한 요소를 잡는다', camera: '전환 방향으로 이어지는 한 번의 무브', text: '최소', link: 'wipe · zoom · iris · flip · whip 중 관계에 맞는 것 하나', payoff: '뒤 장면이 정착해 0.5초 유지' },
  celebrate: { hook: '어둠 속 한 줄기 빛 또는 이름이 천천히 솟음', camera: '아주 느린 푸시 인 + cam.float', text: 'rise + 세리프 이탤릭 한 단어', link: '빛(glow)이 커지며 다음 문구로', payoff: '색종이(흰색+포인트 한 색) + 이름·날짜 홀드' },
  overlay: { hook: '포인트 색 세로 막대가 자란다', camera: '없음', text: '이름 rise · 직함 fade', link: '등장의 역순으로 퇴장', payoff: '투명 배경으로 렌더(--format mov --alpha)' }
};

const BEATS = {
  sting: [[0, 0.14, '타격', '가장 작은 요소 하나가 나타난다'], [0.14, 0.55, '전개', '그 요소에서 전체가 자라난다'], [0.55, 1, '정착', '이름/한 줄이 놓이고 느리게 다가간다']],
  insert: [[0, 0.16, '제시', '시작 상태를 읽을 수 있게'], [0.16, 0.5, '조작', '원인이 되는 동작(커서·타이핑·탭)'], [0.5, 0.82, '결과', '같은 물체가 결과로 변한다'], [0.82, 1, '유지', '끝 상태를 정지해 읽게 한다']],
  promo: [[0, 0.2, '훅', '첫 프레임부터 움직이는 숫자/질문'], [0.2, 0.46, '전개 1', '해결책 등장 + 사용자의 한 번의 행동'], [0.46, 0.68, '전개 2', '그 결과가 단계적으로 완료'], [0.68, 0.84, '증명', '숫자 하나로 요약'], [0.84, 1, '엔드카드', '제목 2줄 + 행동 유도 하나(마지막 1초 정지)']],
  explain: [[0, 0.13, '도입', '제목'], [0.13, 0.4, '1단계', '번호 + 제목 + 작은 시연'], [0.4, 0.64, '2단계', '같은 틀, 요소가 이어서 자람'], [0.64, 0.86, '3단계', '같은 틀'], [0.86, 1, '요약', '세 단계가 한 화면에, 홀드']],
  event: [[0, 0.36, '슬램', '박마다 단어 하나(하드컷), 한 컷은 테마 반전'], [0.36, 0.58, '모티프', '그래픽 모티프(선·면)가 화면을 가로지름'], [0.58, 0.8, '날짜', '날짜·요일이 크게 착지'], [0.8, 1, '엔드', '한 줄 + 홀드']]
};

const r1 = (n) => Math.round(n * 10) / 10;

export function brief(request, opts = {}) {
  const q = String(request || '').trim();
  const purposes = PURPOSES.filter((p) => has(q, p.re));
  const main = purposes[0] || { id: 'promo', label: '홍보·인트로', dur: 12 };

  let format = opts.format && FORMATS[opts.format] ? opts.format : null;
  if (!format) for (const [f, re] of FORMAT_CUES) if (has(q, re)) { format = f; break; }
  if (!format) format = ['proof', 'explain', 'overlay', 'brand'].includes(main.id) ? 'wide' : 'shorts';
  const F = FORMATS[format];

  const m = /(\d+(?:\.\d+)?)\s?(?:초|-?\s?sec(?:ond)?s?\b|s\b)/i.exec(q);
  let duration = opts.duration || (m ? +m[1] : main.dur);
  if (main.id === 'demo' && format === 'insert') duration = opts.duration || (m ? +m[1] : 6.5);

  let lookKey = { event: 'event', proof: 'data', celebrate: 'warm', brand: 'brand', explain: 'edu', overlay: 'tech' }[main.id] || 'tech';
  if (has(q, /학생|어린이|유아|독서|도서관|생활|일상|가족|반려|요리|여행/)) lookKey = main.id === 'event' ? 'event' : main.id === 'proof' ? 'data' : 'life';
  if (has(q, /AI|인공지능|에이전트|개발|코딩|데이터|자동화|테크|SaaS/i) && main.id !== 'event' && main.id !== 'proof') lookKey = 'tech';
  if (has(q, /감성|따뜻|잔잔|감동|추억|기억/)) lookKey = 'warm';
  if (has(q, /고급|럭셔리|프리미엄|미니멀/)) lookKey = 'brand';
  if (opts.tone && LOOKS[opts.tone]) lookKey = opts.tone;
  const look = LOOKS[lookKey];

  const pick = PICKS[main.id] || PICKS.promo;
  const shape = main.id === 'brand' || main.id === 'transition' || main.id === 'overlay' ? 'sting' : main.id === 'event' ? 'event' : main.id === 'explain' ? 'explain' : duration <= 8.5 ? 'insert' : 'promo';
  const beats = BEATS[shape].map(([a, b, name, what]) => ({ from: r1(a * duration), to: r1(b * duration), name, what }));

  const quoted = [...q.matchAll(/[‘'“"「『]([^’'”"」』]{2,40})[’'”"」』]/g)].map((x) => x[1]);
  const numbers = [...q.matchAll(/\d+(?:[.,]\d+)?\s?(?:%|퍼센트|명|건|배|시간|분|초|원|점|위|월|일|년|학년|단계|가지|개)?/g)].map((x) => x[0].trim()).filter((s) => !/^\d+\s?초$/.test(s));

  const cmd = `motion new work/scene.html --format ${format} --duration ${duration} --theme ${look.theme.split(' ')[0]} --accent ${look.accent}`;
  const text = [
    `# 연출 초안 (자동 추정 — 감독으로서 다듬어 확정할 것)`,
    ``,
    `요청: ${q}`,
    ``,
    `## 브리프`,
    `- 목적: ${purposes.length ? purposes.map((p) => p.label).join(' + ') : main.label + '(단서 없음 → 기본)'}`,
    `- 화면: ${format} ${F.width}×${F.height} (${F.label}) · ${duration}초 · 30fps`,
    `- 반드시 들어갈 문구: ${quoted.length ? quoted.map((s) => `“${s}”`).join(', ') : '(따옴표로 준 문구 없음 — 사용자의 말을 화면용으로 줄여 직접 쓴다)'}`,
    `- 요청에 나온 수·날짜: ${numbers.length ? numbers.join(', ') : '(없음 — 수치를 지어내지 않는다)'}`,
    ``,
    `## 룩`,
    `- 테마 ${look.theme} · 포인트 ${look.accent} · 배경 ${look.backdrop}`,
    `- 글자: ${look.type}`,
    `- 성격: ${look.note}. 포인트 색은 한 프레임에 한 곳, M.grain() + .mo-vignette(어두운 테마)`,
    ``,
    `## 연출 선택`,
    `- 훅: ${pick.hook}`,
    `- 카메라: ${pick.camera} · 전체에 cam.drift({ zoom: 1.05 })`,
    `- 글자: ${pick.text}`,
    `- 잇기: ${pick.link}`,
    `- 결과: ${pick.payoff}`,
    ``,
    `## 비트 시트 틀 (화면에 보일 문구를 "따옴표"로 채워 완성)`,
    ...beats.map((b) => `- ${b.from.toFixed(1)}–${b.to.toFixed(1)}s  ${b.name} — ${b.what}`),
    ``,
    `## 다음`,
    `1. 위 초안으로 트리트먼트(로그라인·룩·비트·카메라·전환·모션)를 확정한다 — 메시지를 '변화의 동사'로 바꾸고, 장면을 잇는 물체를 하나 정한다.`,
    `2. \`${cmd}\``,
    `3. 컴포지션 작성 → motion check(오류 0) → motion sheet를 직접 보고 고친다 → motion render.`,
    ``,
    `## 어기면 안 되는 것`,
    `- 모든 움직임은 M.tl과 M.* 헬퍼 위에, 시작 시각은 숫자로. setTimeout·Math.random·CSS animation·repeat:-1·외부 URL 금지.`,
    `- 제목은 마스크 리빌(rise/words), 등장 mo.out · 퇴장 mo.in(절반 길이) · 카메라 mo.cam, 튕김은 작은 UI만.`,
    `- 첫 프레임에 훅, 핵심은 0.8–1.2초 정지, 마지막 1초는 엔드 상태 그대로.`,
    `- 크기는 var(--u), 좌우 --safe-x 안쪽${format === 'shorts' ? ', 쇼츠 안전영역(상 10.5%·하 20%)' : ''}. 없는 로고·수치·이름을 만들지 않는다.`
  ].join('\n');

  return { request: q, purpose: main.id, purposes: purposes.map((p) => p.id), format, width: F.width, height: F.height, duration, look: { key: lookKey, ...look }, picks: pick, beats, quoted, numbers, command: cmd, text };
}
