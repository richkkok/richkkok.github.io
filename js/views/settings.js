import { VERSION } from "../../data/defaults.js";
import { escape as e, won } from "../format.js";
import { icon, sectionTitle } from "../ui.js";

export function settingsView(state, cloud = {}) {
  const s = state.settings;
  const row = (name, description, action, i) =>
    `<button class="settings-row" data-action="${action}"><span class="setting-icon">${icon(i)}</span><span><strong>${name}</strong><small>${e(description)}</small></span>${icon("chevron")}</button>`;

  const cloudPrimary = cloud.connected
    ? row(
        "공동가계부 사용 중",
        `${cloud.householdName || "우리집 가계부"} · ${cloud.memberCount || 1}명 · ${cloud.status || "동기화 중"}`,
        "cloud-members",
        "heart",
      )
    : row(
        "공동가계부 시작",
        "다른 기기나 가족과 같은 가계부를 함께 사용",
        "cloud-start",
        "heart",
      );

  const inviteRow =
    cloud.connected && cloud.role === "owner"
      ? row(
          "가족·기기 초대",
          "새 기기나 가족에게 1회용 초대링크 보내기",
          "cloud-invite",
          "plus",
        )
      : "";

  return `<div class="page-intro compact-page-intro"><div><h1>설정</h1><p>자주 쓰는 것만 앞에 두고 나머지는 접어뒀어.</p></div><span class="version-tag">v${VERSION}</span></div>
    <div class="settings-simple-grid">
      <section class="card">${sectionTitle("우리집")}${cloudPrimary}${inviteRow}${row("수입 · 생활비", `기본 월수입 ${won(s.income)}`, "household", "home")}${row("운영월 · 급여일", `매월 ${s.periodStartDay ?? 10}일 시작`, "period-settings", "calendar")}${row("구성원", `${s.members.p1} · ${s.members.p2}`, "members", "heart")}${row("결제수단", "빠른 입력에서 자동으로 추천", "payment-settings", "wallet")}</section>
      <section class="card">${sectionTitle("자동 정리", "리치콕이 최대한 알아서 분류하고 계산해")}${row("거래파일 가져오기", "PDF · CSV · XLS · XLSX 자동 인식", "go-import", "upload")}${row("고정비 · 반복결제", `${state.recurring.length}개 등록 · 실제 결제와 자동 연결`, "recurring-list", "repeat")}${row("초기 3개월 분석", s.baseline?.confirmed ? "분석자료 확인 완료" : "기간을 확인하면 추천 정확도가 올라가", "baseline-settings", "chart")}${row("자동분류 규칙", `${state.rules.length}개 학습됨 · 수정하면 다음부터 기억`, "rules-list", "filter")}</section>
    </div>
    <details class="detail-disclosure settings-disclosure full-width">
      <summary><span><strong>고급 설정 · 데이터 관리</strong><small>카테고리, 카드실적, 백업, 개인정보</small></span>${icon("chevron")}</summary>
      <div class="settings-advanced-grid">
        <section class="card">${sectionTitle("세부 설정")}${row("카테고리", `${state.categories.filter((c) => !c.archived).length}개 사용 중`, "categories-list", "list")}${row("카드 실적목표", `${s.cardName} · 월 ${won(s.cardTarget)}`, "card-settings", "wallet")}${row("저축목표", "목적별 저축목표 관리", "go-budget", "chart")}<div class="settings-row"><span class="setting-icon">${icon("eye")}</span><span><strong>개인 내역 숨기기</strong><small>공동 화면에서 개인 가맹점·메모 숨김</small></span><button role="switch" aria-checked="${s.privacy}" aria-label="개인 내역 숨기기" class="switch ${s.privacy ? "on" : ""}" data-action="privacy"></button></div></section>
        <section class="card">${sectionTitle("데이터 · 앱")}${row("주간 누락 확인", "카드 누적액과 리치콕 기록 비교", "weekly-check", "repeat")}${cloud.connected ? row("다시 동기화", "두 기기 변경 충돌 확인", "cloud-conflicts", "repeat") : ""}${row("암호화 백업", "비밀번호로 보호한 파일 만들기", "backup", "download")}${row("백업 가져오기", "백업 또는 초기설정 복원", "restore", "upload")}${row("홈 화면에 설치", "앱처럼 열기", "install", "phone")}${row("개인정보 안내", cloud.connected ? "공동저장 범위와 저장방식" : "기기 저장과 원본 처리방식", "privacy-info", "shield")}${row("샘플 둘러보기", "실제 데이터와 분리된 가상공간", "sample", "sun")}${row("전체 로컬데이터 삭제", cloud.connected ? "공동가계부 연결 중 서버 기록은 유지" : "현재 기기의 모든 기록 초기화", "delete-all", "trash")}</section>
      </div>
    </details>`;
}
