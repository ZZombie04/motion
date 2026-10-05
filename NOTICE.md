# 고지 — 포함된 제3자 자산과 의존성

이 저장소의 코드·문서·샘플은 MIT 라이선스(`LICENSE`)다. 아래 자산은 각자의 라이선스를 따른다.

## 저장소에 포함된 것

| 자산 | 위치 | 라이선스 |
|---|---|---|
| Pretendard Variable (길형진) | `engine/fonts/PretendardVariable.woff2` | SIL OFL 1.1 — `engine/licenses/PRETENDARD-OFL.txt` |
| Geist · Geist Mono (Vercel, basement.studio) | `engine/fonts/Geist-Variable.woff2`, `GeistMono-Variable.woff2` | SIL OFL 1.1 — `engine/licenses/GEIST-OFL.txt` |
| Instrument Serif (Instrument) | `engine/fonts/InstrumentSerif-*.woff2` | SIL OFL 1.1 — `engine/licenses/INSTRUMENT-SERIF-OFL.txt` |
| Lucide 아이콘 272종의 경로 데이터 | `engine/icons.js` | ISC — `engine/licenses/LUCIDE-ISC.txt` |

## 설치할 때 내려받는 것(저장소에 포함하지 않음)

| 패키지 | 용도 | 라이선스 |
|---|---|---|
| gsap | 타임라인 엔진. `npm install` 때 `engine/vendor/`로 복사된다 | GSAP Standard "no charge" License (<https://gsap.com/standard-license>) |
| puppeteer-core | 설치된 Chrome/Edge를 조종해 프레임 캡처 | Apache-2.0 |
| @modelcontextprotocol/sdk, zod | MCP 서버 | MIT |

ffmpeg와 Chrome/Edge는 사용자의 컴퓨터에 설치된 것을 쓴다.

## 참고한 자료

연출 방법론은 Career Hacker Alex의 "따라 만드는 모션그래픽 160"(<https://www.careerhackeralex.com/sharings/cha-motion-kit>)을 분석해 일반화했다(`docs/site-analysis.md`).
해당 사이트의 프롬프트 원문·영상·편집 소스는 이 저장소에 들어 있지 않다.
