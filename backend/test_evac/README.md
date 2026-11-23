# 이웃대피 시험 (배포와 무관, 2026-10-26)
가상 마을(가상 읍면동 9999901)·가상 사람·가상 도우미만 씀. 실제 개인정보 없음.
```
cd backend
npx esbuild test_evac/entry.ts --bundle --format=esm --platform=neutral --main-fields=module,main --outfile=test_evac/out.mjs
node test_evac/scenario.mjs        # 예보→사전점검→대피 시작→기존 앱 흐름→상황판→다시 배정→새벽판
npx esbuild test_evac/plan_unit.ts --bundle --platform=node --format=esm --outfile=test_evac/plan_unit.mjs && node test_evac/plan_unit.mjs
```
필요: npm i -D miniflare esbuild (wrangler 에 들어 있음)

## 검토 지적 시험 (2026-10-26)
node test_evac/review_fixes.mjs   # 동시 수락·순서 건너뛰기·이중 청구·상세 권한·거절자 재배정·단체방·정렬·실명 가리기·대피 결과 보고

## 로컬 전체 검토 (배포 없이, 실제 백엔드 + 실제 화면) — test_evac/local/
1. backend/.dev.vars 에 `JWT_SECRET=local-review-secret` `EVAC_INGEST_KEY=local-evac-key`
2. `cd backend && npx wrangler dev --local` (로컬 D1·KV) → `npx wrangler d1 execute onda-db --local --file test_evac/local/seed.sql` (가상 도우미·가상 계약)
3. `cd frontend && npx vite --config vite.local.config.ts` (로컬 검토 전용 새 설정 파일 — API 주소만 localhost:8787 로 바꿔 띄움, 원래 vite.config.ts 는 손대지 않음)
4. `node backend/test_evac/local/walkthrough.mjs` → 경보 접수→대피 시작→도우미 앱 수락·방문·대피→상황실→119 연계→결과 보고서까지, 화면 8장·보고서 PDF·녹화
