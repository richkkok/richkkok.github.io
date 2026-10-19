# RichKkok · 리치콕

두 사람이 매일 기록하고 소비속도를 조절하는 공동 가계관리 PWA입니다.

운영 앱: [richkkok.github.io](https://richkkok.github.io/)

- 현황: 월 소비한도, 여유자금, 고정지출 실제 납부, 확인할 항목
- 기록: 날짜·시간·금액·거래처·결제수단·사용자 입력, 무료 자동분류, 수정·삭제·복원
- 결제수단: 카드·계좌 목록, 청구·납부 차이 확인, 잔액 검증, 전체 거래내역
- 설정: 월별·반복 소비한도, 집계 기간, 공동가계부, 계정, 암호화 백업·복구

[새 소비 통제 계산·데이터 보존·검증 안내](docs/CONTROL.md)

기본은 기기 내 IndexedDB 저장입니다. 공동모드를 직접 시작하면 정규화된 기록과 설정이 리치콕 전용 Supabase 저장소로 동기화됩니다. 금융파일 원본은 업로드하지 않습니다. 카드사 원본 엑셀은 기기 안에서 직접 해석하고, PDF는 고정 버전 PDF.js 모듈만 jsDelivr에서 불러온 뒤 파일 바이트는 브라우저 안에서만 처리합니다. 우리카드 PDF는 할인 전 이용금액과 카드혜택을 함께 보존하고 실제 납부금액을 지출·환불 계산에 사용합니다. 개인 상세 숨김은 화면 표시 기능이며 구성원 간 접근제어가 아닙니다. 실제 사용자 자료는 공개 저장소에 포함하지 않습니다.

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
