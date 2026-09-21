import { inPeriod } from "../period.js";
import { escape as e, won, keyText } from "../format.js";
import { scopeName, DIRECTIONS, memberName } from "../../data/defaults.js";
import { transactionRow, hiddenPersonal, icon, button, empty } from "../ui.js";
import { expenseValue } from "../budget.js";
export function filteredTransactions(state, month, filter) {
  return state.transactions
    .filter(
      (t) =>
        !t.splitParent &&
        inPeriod(t, state, month) &&
        !!t.deletedAt === !!filter.trash &&
        (!filter.owner || t.owner === filter.owner) &&
        (!filter.scope || t.scope === filter.scope) &&
        (!filter.category ||
          (!hiddenPersonal(t, state) && t.category === filter.category)) &&
        (!filter.payment ||
          (!hiddenPersonal(t, state) &&
            keyText(t.paymentMethod).includes(keyText(filter.payment)))) &&
        (!filter.direction || t.direction === filter.direction) &&
        (!filter.query ||
          [
            hiddenPersonal(t, state)
              ? "개인 지출"
              : `${t.merchantRaw} ${t.note} ${t.paymentMethod}`,
            String(t.amount),
            memberName(t.owner, state),
          ]
            .join(" ")
            .toLowerCase()
            .includes(filter.query.toLowerCase())),
    )
    .sort((a, b) => b.datetime.localeCompare(a.datetime));
}
export function transactionsView(state, month, filter) {
  const rows = filteredTransactions(state, month, filter),
    net = rows
      .filter((t) => t.scope !== "excluded" && !t.excluded)
      .reduce((n, t) => n + expenseValue(t), 0);
  let day = "";
  const active = Object.entries(filter).filter(
    ([k, v]) => v && k !== "query" && k !== "limit",
  );
  return `<div class="page-intro"><div><h1>기록</h1><p>두 사람의 소비를 한 흐름으로.</p></div>${button("직접 입력", "add-transaction", "secondary", "plus")}</div><section class="card transaction-card"><div class="transaction-toolbar"><label class="search-field">${icon("search")}<input name="transaction-search" type="search" placeholder="가맹점, 금액, 메모 검색" aria-label="거래 검색" value="${e(filter.query || "")}"></label><button class="btn secondary" data-action="filters">${icon("filter")}필터 ${active.length ? `<span class="count-badge">${active.length}</span>` : ""}</button></div>${active.length ? `<div class="filter-summary"><span>${active.map(([k, v]) => e(k === "owner" ? memberName(v, state) : k === "scope" ? scopeName(v, state) : k === "category" ? state.categories.find((c) => c.id === v)?.name : k === "direction" ? DIRECTIONS[v] : k === "trash" ? "휴지통" : v)).join(" · ")}</span>${button("초기화", "clear-filters", "text")}</div>` : ""}<div class="list-summary"><span>${rows.length}건${filter.trash ? " · 삭제한 내역" : ""}</span><strong>순지출 ${won(net)}</strong></div><div class="transactions-list">${
    rows.length
      ? rows
          .slice(0, filter.limit || 100)
          .map((t) => {
            let heading = "";
            if (t.date !== day) {
              day = t.date;
              heading = `<h2 class="date-heading">${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일</h2>`;
            }
            return heading + transactionRow(t, state);
          })
          .join("")
      : empty(
          filter.query || active.length
            ? "조건에 맞는 내역이 없어요"
            : "첫 지출을 기록해 볼까요?",
          filter.query || active.length
            ? "필터를 바꾸거나 검색어를 줄여 보세요."
            : "금액과 소비처만 넣으면 바로 저장돼요.",
          button("지출 입력", "add-transaction", "primary", "plus"),
        )
  }</div>${rows.length > (filter.limit || 100) ? button("내역 더 보기", "more-transactions", "secondary") : ""}</section>`;
}
