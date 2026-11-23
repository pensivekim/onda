# 온다 보안·전 과정 시험 (2026-11-23)
가상 사람·가상 지명만. 바깥으로 나가는 요청 없음(텔레그램 통로 비밀 없이 — 앱 출동만).
```
cd backend
npx esbuild src/index.ts --bundle --format=esm --platform=neutral --main-fields=module,main --outfile=test_sec/out.mjs
node test_sec/scenario.mjs
```
