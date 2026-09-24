import { possibleDuplicates } from "../import/duplicates.js";
import { parseBytes, inspectSheets, previewRows } from "../import/parser.js";
import { inferMapping } from "../import/mapper.js";
import { sha256, dedupe } from "../import/dedupe.js";
import {
  parseCardWorkbook,
  parseCardPdf,
  previewCardEntries,
} from "../import/card-statements.js";
import { readPdfPages } from "../import/pdf-reader.js";
import { escape as e, won } from "../format.js";
import { icon, button, select, field, toast } from "../ui.js";
import { memberName, DIRECTIONS } from "../../data/defaults.js";
import { syncAutoRecurring } from "../recurring.js";

function cardOwnerSummary(state, preview) {
  const counts = Object.entries(preview?.ownerCounts || {});
  if (!counts.length) return "";
  return counts
    .map(([owner, count]) => `${e(memberName(owner, state))} ${count}건`)
    .join(" · ");
}

export function importView(state, session) {
  const sheets = session.sheets,
    sheet = sheets?.[session.sheet || 0],
    preview = session.preview,
    cardMeta = session.cardMeta;
  return `<div class="page-intro"><div><h1>내역 가져오기</h1><p>카드사 원본 PDF·엑셀도 자동으로 읽고, 일반 CSV·엑셀은 열을 연결해서 가져와.</p></div><span class="status-pill">${icon("shield")}원본은 기기 안에서 처리</span></div>${state.demo ? '<div class="notice">샘플 공간이에요. 실제 금융파일은 샘플을 종료한 뒤 가져와 주세요.</div>' : ""}<section class="card import-card"><div class="owner-choice">${["p1", "p2"].map((p) => `<button class="owner-button ${session.owner === p ? "selected" : ""}" data-import-owner="${p}" aria-pressed="${session.owner === p}"><span class="avatar">${e(state.settings.members[p].slice(0, 1))}</span><span>${e(state.settings.members[p])} 기준</span>${icon("upload")}</button>`).join("")}</div><p class="small muted">이름이 적힌 카드 명세서는 자동 연결해. 박*영처럼 가운데가 가려진 이름도 등록된 구성원 이름과 패턴이 맞으면 박태영으로 연결해. ‘본인회원/가족회원’만 표시된 엑셀은 위에서 명세서의 본인회원을 선택하면 가족회원은 다른 구성원으로 자동 분리해.</p><input id="import-file" type="file" accept=".pdf,.csv,.xlsx,.xls" multiple hidden><div class="dropzone" tabindex="0" role="button" aria-label="거래파일 선택 또는 여기에 놓기"><span class="drop-icon">${icon("upload")}</span><h2>${session.busy ? "파일을 읽고 있어요…" : "카드사 원본 파일을 여기에 놓아 주세요"}</h2><p>또는 눌러서 파일 선택 · PDF, XLSX, XLS, CSV · 최대 20MB</p><span class="small">원본 파일은 저장·업로드하지 않아요</span></div><p class="form-error" id="import-error" role="alert">${e(session.error || "")}</p>${session.fileName ? `<div class="import-file-info"><span>${icon("list")}${e(session.fileName)}</span><span>${session.queue?.length ? `뒤에 ${session.queue.length}개 대기` : ""}</span></div>` : ""}</section>${
    cardMeta
      ? `<section class="card mapping-card"><div class="section-heading"><div><h2>${e(cardMeta.sourceLabel)} 자동 인식</h2><p>날짜·가맹점·카드·사용자를 자동 분리하고, 카드 혜택이 있으면 실제 납부금액을 지출로 저장해. 이용금액과 할인액은 별도로 보존하고 소계·합계 행은 저장하지 않아.</p></div><span class="status-pill">자동분류</span></div><div class="notice"><strong>${cardOwnerSummary(state, preview) || `${cardMeta.entriesCount || 0}건 인식`}</strong><p>${cardMeta.requiresPrimaryOwner ? `‘본인회원’은 현재 ${e(memberName(session.owner, state))} 기준으로 연결했어. 기준이 다르면 위 사용자만 바꾸면 미리보기가 다시 계산돼.` : "명세서에 적힌 이름을 현재 구성원과 자동으로 연결했어."}</p></div>${
          preview?.ownerWarnings?.length
            ? `<div class="notice warning"><strong>사용자 연결 확인</strong><ul>${preview.ownerWarnings.map((warning) => `<li>${e(warning)}</li>`).join("")}</ul></div>`
            : ""
        }${cardMeta.provider === "generic-pdf" ? '<p class="small muted">이 PDF는 일반 카드명세서 형식으로 인식했어. 저장 전 미리보기에서 날짜·금액을 꼭 확인해 줘.</p>' : ""}</section>`
      : ""
  }${
    sheet
      ? `<section class="card mapping-card"><div class="section-heading"><div><h2>열 연결 확인</h2><p>일반 파일은 실제 헤더가 다르면 행 번호와 열을 직접 고르세요.</p></div></div><div class="form-grid">${select(
          "시트",
          "import-sheet",
          sheets.map((s, i) => [i, s.name]),
          session.sheet || 0,
        )}${field("헤더 행 번호", "import-header", (session.header ?? sheet.header.index) + 1, "number", 'min="1" max="1000"')}${field("결제수단 기본값", "default-payment", session.defaultPayment || "", "text", 'placeholder="파일에 없을 때만 적용"')}</div><div class="mapping-grid">${[
          ["date", "날짜 *"],
          ["merchant", "가맹점 / 적요 *"],
          ["amount", "금액"],
          ["payment", "결제수단"],
          ["time", "시간"],
          ["type", "수입·지출 구분"],
          ["deposit", "입금액"],
          ["withdrawal", "출금액"],
          ["note", "메모"],
          ["channel", "결제경로"],
          ["operatingMonth", "귀속 운영월"],
          ["costKind", "고정·변동·일회성"],
        ]
          .map(([k, label]) =>
            select(
              label,
              `map-${k}`,
              [
                [-1, "연결 안 함"],
                ...(sheet.rows[session.header ?? sheet.header.index] || []).map(
                  (h, i) => [
                    i,
                    `${i + 1}. ${String(h ?? "빈 열").slice(0, 40)}`,
                  ],
                ),
              ],
              session.mapping?.[k] ?? sheet.header.mapping[k],
            ),
          )
          .join("")}</div>${select(
          "금액 부호 해석",
          "negative-mode",
          [
            ["refund", "카드형: 음수는 환불"],
            ["signed", "계좌형: 음수 지출, 양수 수입"],
          ],
          session.negativeMode || "refund",
        )}<p class="small muted">입금·출금 열을 연결하면 금액 열보다 우선해요. 수입·지출 구분이 있으면 부호보다 우선해요. 미리보기에서 확인해 주세요.</p>${button("미리보기 새로 확인", "preview-import", "secondary")}</section>`
      : ""
  }${
    preview
      ? `<section class="card preview-card"><div class="section-heading"><div><h2>저장 전 미리보기</h2><p>${preview.total}행 중 새 내역 ${preview.added.length}건 · 중복 ${preview.duplicates}건 · 확인 필요 ${preview.errors.length}행</p></div><span class="status-pill">${cardMeta ? "자동분류" : e(memberName(session.owner, state))}</span></div>${
          preview.errors.length
            ? `<div class="notice warning"><strong>읽지 못한 행이 있어요</strong><ul>${preview.errors
                .slice(0, 5)
                .map((x) => `<li>${x.row}행: ${e(x.message)}</li>`)
                .join(
                  "",
                )}</ul><label class="check-field"><input id="skip-errors" type="checkbox">확인한 오류 ${preview.errors.length}행을 제외하고 저장</label></div>`
            : ""
        }${preview.possible?.length ? `<div class="notice warning"><strong>승인시간이 없어 중복 확인이 필요한 항목 ${preview.possible.length}건</strong><p>승인시간이 같은 거래는 이미 자동 제외했어. 아래 항목은 시간이 없거나 한쪽에만 있어 같은 날·사용자·금액·소비처 기준으로 직접 확인해 줘. 승인시간이 서로 다르면 별도 거래로 유지해.</p>${preview.possible.map((x) => `<label class="check-field"><input type="checkbox" data-skip-duplicate="${e(x.incoming.sourceId)}" checked><span>${e(x.incoming.date)} · ${e(x.incoming.merchantRaw)} · ${won(x.incoming.amount)}<br>${e(x.incoming.paymentMethod)} ↔ ${e(x.existing.paymentMethod)} · 체크하면 새 내역 제외</span></label>`).join("")}<label class="check-field"><input id="confirm-possible" type="checkbox">중복 의심 항목을 검토했어</label></div>` : ""}<div class="preview-table"><div class="preview-heading"><span>일자 / 가맹점</span><span>분류 / 사용자·결제수단</span><span>유형 / 금액</span></div>${
          preview.added
            .slice(0, 20)
            .map(
              (t) =>
                `<div class="preview-row"><div><strong>${e(t.merchantRaw)}</strong><small>${t.date}</small></div><div><span>${e(state.categories.find((c) => c.id === t.category)?.name || "기타")} · ${e(memberName(t.owner, state))}</span><small>${e(t.paymentMethod)}${t.cardBenefitAmount ? ` · 카드혜택 ${won(t.cardBenefitAmount)} · 이용금액 ${won(t.grossAmount)}` : ""}</small></div><div><strong>${won(t.amount)}</strong><small>${DIRECTIONS[t.direction]}</small></div></div>`,
            )
            .join("") ||
          '<p class="empty-inline">새로 저장할 내역이 없어요.</p>'
        }</div><div class="import-commit"><p>${preview.added.filter((t) => t.direction === "transfer").length}건의 이체·카드대금은 지출 합계에서 제외해요.<br>처음 20건을 미리 보여드려요. 실적은 기본 ‘미확인’이에요.</p><button class="btn primary" data-action="commit-import" ${!preview.added.length || session.busy ? "disabled" : ""}>검토한 내역 저장 ${icon("check")}</button></div></section>`
      : ""
  }<section class="import-guide"><h2>안심하고 가져오는 방법</h2><ol><li><strong>카드사 원본 그대로 선택</strong><span>지원되는 PDF·엑셀은 사용자와 거래열을 자동으로 찾아요.</span></li><li><strong>자동분류 미리보기 확인</strong><span>소계·합계는 빼고 실제 이용내역만 보여줘요.</span></li><li><strong>검토 후 저장</strong><span>이미 가져온 거래와 중복 의심 거래는 다시 확인해요.</span></li></ol><p class="small muted">PDF 해석 모듈은 고정 버전으로 불러오며 금융파일 원본 자체는 외부 서버로 보내지 않아요. PDF 첫 사용에는 인터넷 연결이 필요할 수 있어요.</p></section>`;
}

export function mountImport(app) {
  const session = app.importSession,
    root = document.querySelector("#main"),
    input = root.querySelector("#import-file"),
    zone = root.querySelector(".dropzone");
  if (!input) return;
  root.querySelectorAll("[data-import-owner]").forEach(
    (b) =>
      (b.onclick = async () => {
        session.owner = b.dataset.importOwner;
        if (session.cardEntries) {
          session.preview = null;
          await previewCardSource(app, false);
          app.render();
        } else if (session.sheets) {
          session.preview = null;
          app.render();
        } else input.click();
      }),
  );
  zone.onclick = () => input.click();
  zone.onkeydown = (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      input.click();
    }
  };
  zone.ondragover = (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  };
  zone.ondragleave = () => zone.classList.remove("dragging");
  zone.ondrop = (event) => {
    event.preventDefault();
    loadFiles([...event.dataTransfer.files]);
  };
  input.onchange = () => loadFiles([...input.files]);
  const sheetSelect = root.querySelector("[name=import-sheet]");
  if (sheetSelect)
    sheetSelect.onchange = () => {
      session.sheet = Number(sheetSelect.value);
      const s = session.sheets[session.sheet];
      session.header = s.header.index;
      session.mapping = s.header.mapping;
      session.preview = null;
      app.render();
    };
  const headerInput = root.querySelector("[name=import-header]");
  if (headerInput)
    headerInput.onchange = () => {
      session.header = Math.max(
        0,
        Math.min(
          session.sheets[session.sheet].rows.length - 1,
          Number(headerInput.value) - 1,
        ),
      );
      session.mapping = inferMapping(
        session.sheets[session.sheet].rows[session.header] || [],
      );
      session.preview = null;
      app.render();
    };
  async function loadFiles(files) {
    if (!files.length) return;
    if (app.state.demo) {
      toast("샘플을 종료한 뒤 실제 파일을 가져와 주세요.");
      return;
    }
    session.queue = files.slice(1);
    await app.readImport(files[0]);
  }
}

async function readWorkbook(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../import/worker.js", import.meta.url));
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("파일 처리 시간이 길어요. 기간을 나눠 내보내 주세요."));
    }, 20000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      event.data.error ? reject(Error(event.data.error)) : resolve(event.data.sheets);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(
        Error(
          "엑셀 파서를 실행하지 못했어요. 새로고침 후 다시 시도해 주세요.",
        ),
      );
    };
    worker.postMessage(bytes, [bytes]);
  });
}

export async function readImport(app, file) {
  const s = app.importSession;
  s.busy = true;
  s.error = "";
  s.preview = null;
  s.sheets = null;
  s.cardEntries = null;
  s.cardMeta = null;
  s.fileName = file.name;
  app.render();
  try {
    if (!/\.(pdf|csv|xlsx|xls)$/i.test(file.name))
      throw Error("PDF, CSV, XLS, XLSX 파일을 선택해 주세요.");
    if (file.size > 20 * 1024 * 1024) throw Error("파일은 20MB까지 지원해요.");
    if (!file.size) throw Error("비어 있는 파일이에요.");
    const bytes = await file.arrayBuffer();
    s.fileHash = await sha256(bytes);
    const ext = file.name.split(".").at(-1).toLowerCase();
    if (ext === "pdf") {
      const pages = await readPdfPages(bytes);
      const card = parseCardPdf(pages);
      if (!card)
        throw Error(
          "이 PDF에서 카드 이용내역 표를 자동 인식하지 못했어요. 카드사 원본 엑셀을 사용하거나 텍스트가 선택되는 원본 PDF를 내려받아 주세요.",
        );
      s.cardEntries = card.entries;
      s.cardMeta = { ...card, entries: undefined, entriesCount: card.entries.length };
      await previewCardSource(app, false);
      return;
    }
    let sheets;
    if (ext === "csv") sheets = parseBytes(bytes, file.name);
    else sheets = await readWorkbook(bytes);
    if (ext !== "csv") {
      const card = parseCardWorkbook(sheets);
      if (card) {
        s.cardEntries = card.entries;
        s.cardMeta = { ...card, entries: undefined, entriesCount: card.entries.length };
        await previewCardSource(app, false);
        return;
      }
    }
    s.sheets = inspectSheets(sheets);
    if (!s.sheets.some((x) => x.rows.length))
      throw Error("거래가 들어 있는 시트를 찾지 못했어요.");
    s.sheet = s.sheets.reduce(
      (best, x, i) => (x.header.score > s.sheets[best].header.score ? i : best),
      0,
    );
    s.header = s.sheets[s.sheet].header.index;
    s.mapping = s.sheets[s.sheet].header.mapping;
    if (s.sheets[s.sheet].header.confident) await previewImport(app, false);
  } catch (error) {
    s.error = error.message;
  } finally {
    s.busy = false;
    app.render();
  }
}

export async function previewCardSource(app, render = true) {
  const s = app.importSession;
  if (!s.cardEntries) return;
  s.preview = await previewCardEntries(
    s.cardEntries,
    app.state,
    {
      primaryOwner: s.owner,
      sourceType: s.cardMeta?.provider === "woori-pdf" ? "card-pdf" : "card-original",
    },
    app.state.transactions,
  );
  s.preview.possible = possibleDuplicates(s.preview.added, app.state.transactions);
  s.error = "";
  if (render) app.render();
}

export async function previewImport(app, readUI = true) {
  const s = app.importSession;
  if (s.cardEntries) return previewCardSource(app, readUI);
  if (!s.sheets) return;
  if (readUI) {
    s.mapping = Object.fromEntries(
      [...document.querySelectorAll('[name^="map-"]')].map((el) => [
        el.name.slice(4),
        Number(el.value),
      ]),
    );
    s.negativeMode =
      document.querySelector("[name=negative-mode]")?.value || "refund";
    s.defaultPayment =
      document.querySelector("[name=default-payment]")?.value || "";
  }
  s.preview = await previewRows(
    s.sheets[s.sheet],
    s.header,
    s.mapping,
    {
      owner: s.owner,
      sourceType: s.fileName.split(".").at(-1),
      rules: app.state.rules,
      recurring: app.state.recurring,
      members: app.state.settings.members,
      defaultPayment: s.defaultPayment,
      negativeMode: s.negativeMode,
    },
    app.state.transactions,
  );
  s.preview.possible = possibleDuplicates(
    s.preview.added,
    app.state.transactions,
  );
  s.error = "";
  if (readUI) app.render();
}

export async function commitImport(app) {
  const s = app.importSession;
  if (!s.preview || s.busy) return;
  if (
    s.preview.errors.length &&
    !document.querySelector("#skip-errors")?.checked
  )
    throw Error("확인 필요 행을 살펴보고 제외 여부를 선택해 주세요.");
  if (
    s.preview.possible?.length &&
    !document.querySelector("#confirm-possible")?.checked
  )
    throw Error("중복 의심 항목을 검토해 주세요.");
  const skip = new Set(
    [...document.querySelectorAll("[data-skip-duplicate]:checked")].map(
      (el) => el.dataset.skipDuplicate,
    ),
  );
  const incoming = s.preview.valid.filter((t) => !skip.has(t.sourceId));
  s.busy = true;
  try {
    let count = 0;
    await app.update((state) => {
      const result = dedupe(incoming, state.transactions);
      count = result.added.length;
      if (state.transactions.length + count > 100000)
        throw Error("한 가계부는 100,000건까지 보관할 수 있어요.");
      state.transactions.push(...result.added);
      syncAutoRecurring(state);
      state.imports.push({
        id: crypto.randomUUID(),
        fileHash: s.fileHash,
        owner: s.owner,
        count,
        createdAt: new Date().toISOString(),
      });
    });
    toast(`${count}건 저장했어요. 중복 내역은 건너뛰었어요.`);
    const next = s.queue?.shift();
    s.preview = null;
    s.sheets = null;
    s.cardEntries = null;
    s.cardMeta = null;
    s.fileName = "";
    if (next) {
      s.busy = false;
      await readImport(app, next);
    } else {
      s.busy = false;
      app.navigate("analytics");
    }
  } finally {
    s.busy = false;
  }
}
