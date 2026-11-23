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
| 결제 | Paddle (KYB 승인 대기 중, 토스/포트원 사용 안 함) |
| 알림 | 웹 푸시 (VAPID, 알림톡 제거) |
| 인증 | 카카오 + 구글 OAuth + 이메일+비번 (admin) |
| 연동 | hi.genomic.cc (AI 감지 → webhook) |

## 작업 규칙
- 작업 시작 전 `git pull` → 작업 후 `git add . && git commit && git push`
- 커밋 메시지 영문만 (Cloudflare API 오류 방지)
- 설정 파일(`wrangler.toml`, `vite.config.ts`, `tsconfig.json`) 수정 금지 (명시적 허락 없이)
- 기존 코드 변경 시 반드시 보고 후 승인
- 한 번에 한 기능만. 연쇄 수정 금지.
- 빌드/배포는 대표님 지시 시에만

## 디자인 시스템 — 제노믹 공통 디자인 (2026-11-23 대표 «공통 관제 화면으로 통일», 옛 «The Pulse of Precision» 대체)
- 기준 묶음: C:\Users\admin\genomic-biz\디자인_공통\ (genomic.css · 안내.md · assets/fonts). 디자인을 바꿀 땐 거기부터 고치고 여기로 복사
- 온다에 든 사본: frontend/public/assets/genomic.css · frontend/public/assets/fonts/ (index.html 이 불러옴), 색 이름은 tailwind.config.cjs 에서 공통 값으로
- 색: 주요 단추 밤 초록 #0E2B2C(primary) · 강조 호박 #E3A23B(amber) · 보조 #4F8A7E(secondary) · 바탕 안개 #EEF2F0(surface) · 글 먹 #172322
- 위험 #B83A26(error)은 SOS·119·위급에만
- 글꼴: 제목 IBM Plex Sans KR · 본문 Pretendard Variable · 숫자 IBM Plex Mono — 자체 호스팅(구글 글꼴 쓰지 않음)
- 낱말 중간 줄바꿈 금지(word-break: keep-all). 대외 화면에 점수·«개발 중» 표시 넣지 않음

## 사용자 유형
- **요청자**: 맞벌이 부모, 독거노인 가족, 장애인 본인/가족
- **출동자 등급**:
  - 🟢 그린: 검증된 일반 시민 (기본 조치, 동행)
  - 🟠 오렌지: 요양보호사/사회복지사/보육교사 (자격증 필수)
  - 🔴 레드: 의사/간호사/응급구조사 (Phase 3)
- **관리자**: 출동자 승인, 요청/매칭/정산 모니터링

## Phase 1 (MVP) — 완료
- 카카오 + 구글 OAuth + 관리자 이메일 로그인
- 출동자 가입 (서류 R2 업로드 + 관리자 승인)
- 요청자 긴급 요청 생성 (위치 자동 감지)
- 매칭 (반경 3km KV 검색)
- 상태 5단계 (수락→이동중→도착→돌봄중→완료)
- 웹 푸시 알림
- 관리자 대시보드 (통계/승인/요청/정산)
- PWA + SPA + 22개 언어 i18n
- hi.genomic.cc webhook API

## Phase 2 (완료)
1. ✅ 오렌지 등급 (자격증 검증 + 등급별 요금 25k/40k/80k)
2. ✅ 리뷰/평점 (완료 후 양방향 평가)
3. ✅ 채팅 (요청자-출동자 실시간 3초 폴링)
4. ✅ hi.genomic.cc webhook 자동 출동 요청 (긴급도 매핑 + 자동 매칭)
5. ⏳ Paddle 결제 + Payouts (KYB 승인 후)

## Phase 3 (완료)
1. ✅ 레드 등급 (의사/간호사/응급구조사 면허 검증 + 자동 등급 승격)
2. ✅ 지자체 계약 (예산/수혜자/월별한도 + 자동 대납)
3. ✅ 기업 스폰서 (CSR 예산 + 사용내역 + 자동 커버)
4. ✅ KBS 마케팅 API (GET /api/public/impact + /api/public/sponsors)
5. ✅ 관리자 대시보드 7탭 (통계/승인/면허/요청/정산/지자체/스폰서)

## 배포 명령어
- 프론트 빌드: `cd frontend && npx vite build`
- 프론트 배포: `cd frontend && npx wrangler pages deploy dist --project-name onda`
- 백엔드 배포: `cd backend && npx wrangler deploy`

## 관련 프로젝트
- hi.genomic.cc: AI 감지 (낙상/화재/배회 → webhook 자동 연동)
- 전체 맵: C:\Users\admin\PROJECTS.md
