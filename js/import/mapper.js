import { keyText } from "../format.js";
const aliases = {
  channel: ["결제경로", "간편결제", "paymentchannel"],
  operatingMonth: ["귀속운영월", "귀속월", "operatingmonth"],
  costKind: ["지출성격", "고정변동", "costkind"],
  date: [
    "거래일시",
    "승인일시",
    "이용일시",
    "거래일자",
    "승인일자",
    "이용일자",
    "결제일자",
    "날짜",
    "거래일",
    "이용일",
    "date",
    "datetime",
  ],
  time: ["시간", "거래시간", "승인시간", "이용시간", "time"],
  merchant: [
    "가맹점명",
    "가맹점",
    "사용처",
    "거래처",
    "이용처",
    "적요",
    "내용",
    "상호명",
    "merchant",
    "description",
    "payee",
  ],
  amount: [
    "이용금액",
    "거래금액",
    "승인금액",
    "결제금액",
    "사용금액",
    "금액",
    "amount",
  ],
  payment: [
    "결제수단",
    "카드명",
    "카드계좌",
    "계좌명",
    "계좌",
    "카드",
    "paymentmethod",
    "account",
  ],
  type: [
    "거래종류",
    "거래구분",
    "거래유형",
    "이용구분",
    "수입지출",
    "수입/지출",
    "구분",
    "type",
    "direction",
  ],
  note: ["메모", "비고", "note", "memo"],
  deposit: ["입금액", "입금금액", "입금", "수입금액", "credit"],
  withdrawal: ["출금액", "출금금액", "출금", "지출금액", "debit"],
};
export function inferMapping(headers) {
  const map = {};
  for (const [field, names] of Object.entries(aliases)) {
    const exact = headers.findIndex((h) =>
      names.some((n) => keyText(h) === keyText(n)),
    );
    map[field] =
      exact >= 0
        ? exact
        : headers.findIndex((h) =>
            names
              .filter((n) => n.length > 2)
              .some((n) => keyText(h).includes(keyText(n))),
          );
  }
  return map;
}
export function detectHeader(rows) {
  let best = { index: 0, score: -1, mapping: inferMapping(rows[0] || []) };
  rows.slice(0, 40).forEach((row, index) => {
    const mapping = inferMapping(row);
    const score =
      (mapping.date >= 0 ? 4 : 0) +
      (mapping.merchant >= 0 ? 3 : 0) +
      (mapping.amount >= 0 || mapping.deposit >= 0 || mapping.withdrawal >= 0
        ? 3
        : 0) +
      (mapping.payment >= 0 ? 1 : 0);
    if (score > best.score) best = { index, score, mapping };
  });
  return { ...best, confident: best.score >= 10 };
}
export function mappingValid(m) {
  return (
    m.date >= 0 &&
    m.merchant >= 0 &&
    (m.amount >= 0 || m.deposit >= 0 || m.withdrawal >= 0)
  );
}
