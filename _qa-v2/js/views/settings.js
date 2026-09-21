import { VERSION } from "../../data/defaults.js";
import { escape as e, won } from "../format.js";
import { icon, sectionTitle } from "../ui.js";

export function settingsView(state, cloud = {}) {
  const s = state.settings;
  const row = (name, description, action, i) =>
    `<button class="settings-row" data-action="${action}"><span class="setting-icon">${icon(i)}</span><span><strong>${name}</strong><small>${e(description)}</small></span>${icon("chevron")}</button>`;

  const cloudRows = cloud.connected
    ? `${row(
        "우리집 공동가계부",
        `${cloud.householdName || "우리집 가계부"} · ${cloud.memberCount || 1}명 · ${cloud.status || "실시간 동기화"}`,
        "cloud-members",
        "heart",
      )}${
        cloud.role === "owner"
          ? row(
              "아내 · 가족 초대하기",
              "1회용 초대링크로 같은 가계부에 참여",
              "cloud-invite",
              "plus",
            )
          : ""
      }`
    : row(
        "우리집 공동가계부 시작",
        "아내를 초대해 같은 가계부를 실시간으로 함께 작성",
        "cloud-start",
        "heart",
      );

  const storageNote = cloud.connected
    ? `<div class="local-storage-note">${icon("lock")}<div><strong>이 기기 + 우리집 공동 저장소</strong><p>기기에는 오프라인용 사본을 보관하고, 온라인에서는 우리집 구성원과 자동 동기화해요. 금융파일 원본은 서버로 보내지 않아요.</p></div></div>`
    : `<div class="local-storage-note">${icon("lock")}<div><strong>현재는 이 기기에만 저장</strong><p>공동가계부를 시작하기 전까지는 다른 기기와 자동 동기화하지 않아요. 브라우저 데이터 삭제 전에는 백업해 주세요.</p></div></div>`;

  return `<div class="page-intro"><div><h1>가족·설정</h1><p>우리집에 맞게, 필요하면 함께.</p></div><span class="version-tag">v${VERSION}</span></div><div class="two-column settings-layout"><div class="stack"><section class="card">${sectionTitle("우리집 기본 설정")}${row("수입 · 생활비 · 용돈", `기본 월수입 ${won(s.income)} · 월별 수입은 홈에서 수정해요`, "household", "home")}${row("운영월 · 급여일", `매월 ${s.periodStartDay ?? 10}일 시작`, "period-settings", "calendar")}${row("결제수단", "빠른 입력 기본 결제수단 관리", "payment-settings", "wallet")}${row("구성원 이름", `${s.members.p1} · ${s.members.p2}`, "members", "heart")}${row("카드 실적목표", `${s.cardName} · 월 ${won(s.cardTarget)}`, "card-settings", "wallet")}<div class="settings-row"><span class="setting-icon">${icon("eye")}</span><span><strong>개인 내역 숨기기</strong><small>공동 화면에서 개인 가맹점·메모를 가려요</small></span><button role="switch" aria-checked="${s.privacy}" aria-label="개인 내역 숨기기" class="switch ${s.privacy ? "on" : ""}" data-action="privacy"></button></div><p class="settings-footnote">개인 숨김은 화면 표시 기능이에요. 공동가계부 구성원 권한과는 별개예요.</p></section><section class="card">${sectionTitle("분류와 계획")}${row("고정비 · 반복결제", `${state.recurring.length}개 · 적용일별 금액 변경 지원`, "recurring-list", "repeat")}${row("자동분류 규칙", `${state.rules.length}개 · 가맹점과 결제수단 기준`, "rules-list", "filter")}${row("카테고리", `${state.categories.filter((c) => !c.archived).length}개 사용 중`, "categories-list", "list")}${row("저축목표", "월 배정액과 모은 금액 관리", "go-budget", "chart")}</section></div><div class="stack"><section class="card">${sectionTitle("우리집 공유")}${cloudRows}${cloud.connected ? row("동시수정 확인 · 다시 동기화", "두 기기에서 같은 기록을 바꾼 경우 확인", "cloud-conflicts", "repeat") : ""}<p class="settings-footnote">${cloud.connected ? "온라인에서는 서로의 변경사항이 자동 반영되고, 오프라인 변경은 재연결 후 병합해요." : "공동가계부를 시작하면 현재 이 기기의 가계부를 기준으로 공유 저장소를 만들어요."}</p></section><section class="card">${sectionTitle("내 데이터")}${row("초기 3개월 분석", "분석기간과 전체자료 확인", "baseline-settings", "chart")}${row("주간 누락 확인", "카드앱 누적액과 기록 비교", "weekly-check", "repeat")}${row("거래파일 가져오기", "CSV · XLS · XLSX, 파일 원본은 이 기기에서만 처리", "go-import", "upload")}${row("암호화 백업 만들기", "비밀번호로 보호한 파일을 기기에 저장", "backup", "download")}${row("백업 · 초기설정 가져오기", "복원 전 내용을 확인해요", "restore", "upload")}${row("샘플로 둘러보기", "실제 데이터와 분리된 가상 공간", "sample", "sun")}${row("전체 로컬데이터 삭제", cloud.connected ? "공동가계부 연결 중에는 서버 기록을 지우지 않아요" : "현재 공간의 모든 기록과 설정 초기화", "delete-all", "trash")}</section><section class="card">${sectionTitle("앱과 개인정보")}${row("홈 화면에 설치하기", "앱처럼 열고 오프라인에서도 확인해요", "install", "phone")}${row("개인정보 안내", cloud.connected ? "공동모드 동기화 범위와 저장방식 확인" : "금융파일 외부 전송·광고·추적 없음", "privacy-info", "shield")}${storageNote}</section></div></div>`;
}
