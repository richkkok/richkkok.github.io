# RichKkok · 리치콕 2.0

두 사람이 매일 기록하고 소비속도를 조절하는 공동 가계관리 PWA입니다.

운영 앱: [richkkok.github.io](https://richkkok.github.io/)

- 홈: 계획 누적소비 대비 여유/초과, 오늘 기준, 예상 저축, 조절할 항목, 하루 마감
- 기록: 빠른 금액·소비처 입력, 자동분류, 수정·분할·삭제/복원, 사용자·결제수단 필터
- 분석: 카드사 원본 PDF/XLS/XLSX 및 일반 CSV/XLS/XLSX 기반 기준선, 중복 검토, 반복결제 후보, 소비패턴
- 계획: 데이터 기반 여유/균형/절약 추천 또는 직접 목표, 10일~9일 운영월, 급여일·고정비
- 가족·설정: 초대 기반 공동가계부, 주간 누적액 보정, 암호화 백업, 설치·업데이트

기본은 기기 내 IndexedDB 저장입니다. 공동모드를 직접 시작하면 정규화된 기록과 설정이 리치콕 전용 Supabase 저장소로 동기화됩니다. 금융파일 원본은 업로드하지 않습니다. 카드사 원본 엑셀은 기기 안에서 직접 해석하고, PDF는 고정 버전 PDF.js 모듈만 jsDelivr에서 불러온 뒤 파일 바이트는 브라우저 안에서만 처리합니다. 개인 상세 숨김은 화면 표시 기능이며 구성원 간 접근제어가 아닙니다. 실제 사용자 자료는 공개 저장소에 포함하지 않습니다.

## 실행·검증

Node.js 22 이상, pnpm 11:

```sh
pnpm install --frozen-lockfile
node scripts/vendor.mjs
pnpm run check
pnpm test
pnpm run build
node scripts/serve.cjs dist
```

[로컬 미리보기](http://127.0.0.1:4174). GitHub Pages는 `main / (root)`를 게시합니다. `RichKkok quality checks`는 테스트와 커밋된 오프라인 캐시의 재현성을 확인합니다. 앱 소스 변경 후 `pnpm run build`로 생성한 `sw.js`를 함께 커밋합니다.

서버 함수 소스: `supabase/functions/richkkok-sync/index.ts`. 기존 커스텀 세션 인증을 유지하며, 그 외 프로젝트의 함수·테이블은 사용하지 않습니다. `qa/cloud-check.mjs`는 명시적으로 실행할 때만 운영 서버에 이름이 지정된 **더미 가족**을 생성하는 통합검사입니다. 실행 후 기록된 테스트 UUID로만 정리해야 합니다.

[설계·계산](docs/ARCHITECTURE.md) · [검증](docs/QA.md) · [디자인 조사](docs/BENCHMARK.md)
