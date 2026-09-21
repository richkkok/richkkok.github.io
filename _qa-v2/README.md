# RichKkok · 리치콕

부부의 공동생활비와 개인용돈을 구분하고, 이번 달 사용 가능한 돈을 확인하는 로컬 전용 가계관리 PWA입니다.

운영 주소: https://richkkok.github.io

## 기능

- CSV · XLS · XLSX 파일 가져오기, 열 매핑, 중복 제거, 카드대금 이중계상 방지
- 거래 수정 · 분할 · 삭제/복원, 사용자별 공동/개인 구분, 분류 규칙
- 월별 예산, 반복비와 실제 거래 연결, 미래 금액 변경, 저축목표
- 카드 예상 실적인정액, 월간 분석과 로컬 인사이트
- IndexedDB 저장, 암호화 백업/복원, 오프라인 실행 및 명시적인 앱 업데이트

금융 파일과 거래는 서버에 전송하지 않습니다. 브라우저·기기 사이의 자동 동기화는 없으며, 개인 상세 숨김은 인증 잠금이 아닙니다. 실제 가계 정보는 공개 소스에 포함하지 않습니다.

## 실행 및 검증

Node.js 22 이상과 pnpm 11을 사용합니다.

```sh
pnpm install --frozen-lockfile
node scripts/vendor.mjs
pnpm run check
pnpm test
pnpm run build
node scripts/serve.cjs dist
```

미리보기: http://127.0.0.1:4174

현재 저장소는 GitHub Pages의 `main / (root)` 배포를 사용합니다. main 변경 시 기본 `pages build and deployment` 작업이 배포하며, `RichKkok quality checks`가 검사·테스트·오프라인 릴리스 일치 여부를 검증합니다. 중복 배포를 피하기 위해 별도의 deploy-pages 작업은 실행하지 않습니다. 소스를 수정한 뒤에는 `pnpm run build`로 갱신된 `sw.js`도 함께 커밋하세요.

설계: [ARCHITECTURE](docs/ARCHITECTURE.md) · 조사: [BENCHMARK](docs/BENCHMARK.md)
