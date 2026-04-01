# 온다(Onda) — 긴급 돌봄 O2O 플랫폼

## 철학
**사람을 살리자** — 긴급한 순간, 가장 가까운 검증된 사람이 달려온다.

## 프로젝트 기본 정보
| 항목 | 내용 |
|------|------|
| 도메인 | onda.genomic.cc |
| GitHub | pensivekim/onda |
| 운영사 | (주)제노믹 |
| 프론트 | Cloudflare Pages (PWA, React + Vite + Tailwind) |
| 백엔드 | Cloudflare Workers (Hono) |
| DB | Cloudflare D1 |
| 위치캐시 | Cloudflare KV (TTL 30초) |
| 파일저장 | Cloudflare R2 (자격증/신분증) |
| 매칭엔진 | Cloudflare Durable Objects |
| 결제 | Paddle (토스/포트원/KG이니시스 사용 안 함) |
| 알림 | NHN Cloud 알림톡 |
| 인증 | 카카오 OAuth |
| 연동 | hi.genomic.cc (AI 감지 → webhook) |

## 작업 규칙
- 작업 시작 전 `git pull` → 작업 후 `git add . && git commit && git push`
- 커밋 메시지 영문만 (Cloudflare API 오류 방지)
- 설정 파일(`wrangler.toml`, `vite.config.ts`, `tsconfig.json`) 수정 금지 (명시적 허락 없이)
- 기존 코드 변경 시 반드시 보고 후 승인
- 한 번에 한 기능만. 연쇄 수정 금지.
- 빌드/배포는 대표님 지시 시에만

## 디자인 시스템 (The Pulse of Precision)
- **No 1px borders** — 배경색 차이로만 구분
- **No pure black** — `on_surface` (#191c1d) 사용
- **No sharp corners** — 최소 rounded-sm (0.25rem)
- **No HR dividers** — spacing-4 (1rem) 여백 또는 배경색 전환
- Primary: #b7102a (긴급 액션에만)
- Surface: #f8f9fa → #f3f4f5 → #ffffff (계층)
- 폰트: Plus Jakarta Sans (제목) + Manrope (본문)
- SOS 버튼: pulse 애니메이션, surface_tint (#bb152c)
- Glassmorphism: 반투명 surface + backdrop-blur 20px

## 사용자 유형
- **요청자**: 맞벌이 부모, 독거노인 가족, 장애인 본인/가족
- **출동자**: 레드(의료인) / 오렌지(전문돌봄) / 그린(검증시민) — MVP는 그린만
- **관리자**: 출동자 승인, 요청/매칭/정산 모니터링

## MVP 범위 (Phase 1)
1. 카카오 로그인
2. 출동자 가입 (서류 R2 업로드 + 관리자 승인)
3. 요청자 긴급 요청 생성
4. 매칭 (반경 3km + 60초 타임아웃)
5. 상태 5단계 (수락→이동중→도착→돌봄중→완료)
6. NHN 알림톡
7. 관리자 승인 + 수동 정산
8. PWA UI

## 배포 명령어
- 프론트: `cd frontend && npm run build && npx wrangler pages deploy dist --project-name onda`
- 백엔드: `cd backend && npx wrangler deploy`

## 관련 프로젝트
- hi.genomic.cc: AI 감지 (webhook 연동, Phase 2)
- 전체 맵: C:\Users\admin\PROJECTS.md
