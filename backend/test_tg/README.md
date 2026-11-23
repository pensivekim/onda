# 온다 텔레그램판 시험 (배포와 무관, 2026-11-22)
가상 사람(가상순자 어르신·가상 가족·가상 도우미 3명·가상 상황실)과 가상 지명(가상시 가상동)만 씀. 실제 개인정보 없음.
알림 통로는 실제 통로 코드(I:\알림통로_20261026\code)를 같은 시험 안에서 띄우고, 텔레그램 서버만 흉내 낸다(바깥으로 안 나감).
```
cd backend
npx esbuild src/index.ts --bundle --format=esm --platform=neutral --main-fields=module,main --outfile=test_tg/out.mjs
TONGRO_DIR=I:/알림통로_20261026/code node test_tg/scenario.mjs
(승인 전에는 src/index.ts 대신 텔레그램판/승인대기/index.ts 를 src 에 두고 묶어야 입구가 붙음)
```
필요: Node 22 이상(통로 시험이 node:sqlite 사용), npm i -D miniflare@3 esbuild
