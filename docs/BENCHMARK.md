# 2026-09-21 리치콕 2.0 디자인 적용

[YNAB](https://www.ynab.com/), [Monarch](https://www.monarch.com/), [Dribbble 금융 대시보드](https://dribbble.com/search/finance-dashboard)의 공개 페이지를 확인했다. 유료 Mobbin/제품 내부 전체 화면을 검토했다고 주장하지 않는다. 아래 기존 조사는 참고 이력이며 2.0의 최종 설계는 다음과 같다.

- 어두운 네이비 핵심영역 하나에 소비 여유/초과를 가장 크게 표시하고, 절감 우선항목을 직접 연결한다.
- 나머지 영역은 흰 면과 명확한 테두리, 16px 기본 글자, 44px 이상 핵심 버튼으로 구분한다.
- 모바일 하단 5탭, 홈 상단 지출 버튼, 금액 우선 시트, 고급항목 접기로 한손 입력을 줄인다.
- 계획선은 점선, 실제선은 실선으로 구분한다. 경고는 색뿐 아니라 제목·부호·복귀금액으로 표현한다.
- 과거 기록 나열보다 오늘 소비 판단→입력→마감으로 이어지는 흐름을 우선한다.
- 타 제품의 그래픽·레이아웃·문구를 복제하지 않았다.

---

# RichKkok UX benchmark

조사일: 2026-09-17. 공식 제품 페이지·도움말·개발사 App Store 설명을 기준으로 조사했다. 유료 계정의 모든 최신 화면을 직접 사용한 평가는 아니다. 아래는 확인된 기능과 RichKkok에 적용하는 설계 판단이다. 브랜드 그래픽·문구·색상은 복제하지 않는다.

| 제품 · 근거 | 확인한 구조 / 상호작용 | RichKkok 적용 |
|---|---|---|
| [Copilot Money](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview), [시작 안내](https://help.copilot.money/en/articles/11157550-quick-start-guide) | 대시보드에서 소비 추세·미검토 거래·반복비·순수입을 연결. 반복비를 일상 소비와 구분 | 가용금액을 첫 숫자로, 수입→고정비→변동비→잔액의 수평 흐름. 반복비 별도 대조 |
| [Monarch Money](https://www.monarchmoney.com/features/collaboration) | 가구 계좌를 하나의 대시보드에서 보고 월간 요약으로 함께 검토 | 소유자와 공동/개인 범위를 별도 차원으로 관리. 개인 가맹점은 기본 숨김 |
| [YNAB](https://www.ynab.com/features/subscription-sharing), [부부 예산](https://www.ynab.com/guide/budgeting-as-a-couple) | 목표에 돈을 배정하고 사용 가능한 범주 잔액을 확인. 공유 계획과 개인 용돈을 구분 | 예산 소진율보다 남은 금액을 강조. 목표 배정은 가용금액에서 차감 |
| [PocketGuard](https://pocketguard.com/leftover/), [반복비](https://pocketguard.com/help/bills/) | 예상 수입·고정 청구·목표를 고려한 Leftover. 카드대금은 이체로 구분하고 청구의 예정/실제를 대체 | 이체·카드대금 제외, 반복비는 미결제 차액만 예약. 계산 근거 공개 |
| [Quicken Simplifi](https://support.simplifi.quicken.com/en/articles/4212702-understanding-your-spending-plan) | 수입·반복비·계획 소비·목표를 묶은 Spending Plan. 반복 거래를 다시 계획소비에 합산하지 않음 | 계획 수입/실제 수입 기준을 선택. 반복 연결 거래의 이중계상 방지 |
| [Lunch Money](https://support.lunchmoney.app/setup/rules), [반복 항목](https://lunchmoney.app/features/recurring-expenses/) | 조건과 결과를 분리한 규칙, 가맹점/계좌 매칭, 검토 후 과거 거래 적용, 반복비 연결 | exact→keyword→기본→heuristic 우선순위. 수정 시 규칙 저장 선택. 규칙 편집/삭제 |
| [Origin](https://useorigin.com/couples) | 공동 재무를 통합하고 파트너별 거래를 필터링 | 공동 대시보드, 소유자 필터, 개인 예산 요약. 서버 협업은 v1에 포함하지 않음 |
| [CountAbout](https://countabout.com/budgeting-app-for-couples/), [공유 권한](https://countabout.com/multi-user-access/) | 공동/개인 계좌를 함께 조회, 범주 예산·거래 분할, 공유 접근 수준 | 범위별 집계와 정확한 거래 분할. 가맹점 숨김은 표시 기능이며 인증 권한으로 표현하지 않음 |
| [EveryDollar](https://everydollar.help.ramseysolutions.com/hc/en-us/articles/360038327611-How-to-Change-Views-Between-Spent-and-Remaining) | 계획·사용·남음 전환, 거래를 예산 항목에 배정 | 한 항목 안에서 사용/예산/남음 비교. 빠른 편집 시트 |
| [Albert](https://help.albert.com/hc/en-us/articles/26013808734743-How-do-I-set-my-budget) | 수입·소비·청구를 기반으로 예산을 제안하고 범주 금액을 수정 | 수정 가능한 목표, 기록이 없으면 억지 경고 없이 시작 안내 |
| [토스](https://i18n.toss.im/service/asset-management) | 흩어진 자산과 일자별 수입·지출을 읽기 쉬운 요약으로 제시 | 한국어 금액 표기, 숫자 우선 위계, 적은 핵심 지표 |
| [카카오페이](https://www.kakaopay.com/services/management/pfm), [통합내역](https://contents.kakaopay.com/contents/2394) | 여러 결제수단의 통합내역과 소비 분석 | 결제수단·가맹점·일자를 중심으로 파일 열 추론. 카드사 고유 양식을 단정하지 않음 |
| [뱅크샐러드](https://help.banksalad.com/2d2116e2-39f6-800b-84d4-cd26a7ba7dc4) | 가계부 거래 편집, 결제수단, 예산 제외의 범위를 설명 | ‘가계부 제외’는 모든 지출/예산 집계에서 일관되게 제외하고 카드 실적은 별도 속성으로 유지 |
| [편한가계부](https://apps.apple.com/kr/app/id560481810) | 기간별 예산/통계, 빠른 입력, 결제수단별 조회, 반복 결제 | 월 전환, 간단한 수동 거래, 기간별 비교, 재사용 가능한 반복비 |
| [위플 가계부](https://apps.apple.com/kr/app/id467936485) | 달력·예산·통계·자산·설정 탭, 한 화면 입력, 남은 돈과 전월 비교 | 모바일 5탭, 입력 시트, 수평 비교 막대와 3개월 추이 |

## 정보구조와 적용 기준

- 홈: 월/가구 보기 → 사용 가능 금액과 계산 기준 → 네 가지 KPI → 공동 예산 → 카드 실적 → 최대 3개 인사이트 → 최근 거래/반복비.
- 내역: 검색 → 소유자/범위/분류/결제수단/유형 필터 → 날짜별 피드 → 편집·분할·삭제/복원.
- 예산: 공동생활비·개인용돈 잔액 → 카테고리별 목표 → 고정비 일정 → 저축 배정.
- 분석: 카테고리 수평 막대·3개월 추이·고정/변동·소유자 비중·증감·월말 추정. 작은 원형 차트는 사용하지 않는다.
- 설정: 가구 설정·규칙·범주·백업/복원·설치·개인정보. 데이터 가져오기는 모든 탭에서 같은 위치에 접근.
- 모바일은 하단 5탭과 시트, 태블릿/데스크톱은 작은 사이드바와 2열 대시보드. 입력 16px, 터치 44px 이상.
- 예산 잔액은 계좌 잔액이 아니다. 계획 수입 사용 여부와 아직 결제되지 않은 반복비를 화면에서 설명한다.

## 가져오지 않은 것

은행 연결, 투자 주문, 외부 AI, 광고/분석 SDK, 계정/서버 동기화, 특정 카드상품 실적 규정 자동 판정. 화면에서 개인 내역을 숨기는 기능은 기기 소유자에 대한 암호화나 접근 통제를 대신하지 않는다.
