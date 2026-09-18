import { openDialog, toast } from "./ui.js";
export function setupPWA() {
  let prompt = null,
    registration = null;
  const status = document.querySelector("#storage-status");
  const state = (t) => {
    status.textContent = t;
    status.dataset.status = t;
  };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event;
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    toast("홈 화면에 리치콕을 설치했어요.");
  });
  const showUpdate = () => {
    document.querySelector("#update-banner").hidden = false;
  };
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        if (reg.waiting) showUpdate();
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed") {
              if (navigator.serviceWorker.controller) showUpdate();
              else state("오프라인 준비 완료");
            }
          });
        });
        navigator.serviceWorker.ready.then(() => state("오프라인 준비 완료"));
        reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) reg.update().catch(() => {});
        });
      })
      .catch(() => state("온라인 모드"));
  } else state("온라인 모드");
  let applying = false;
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (applying) location.reload();
  });
  document.querySelector("#apply-update").onclick = () => {
    if (!registration?.waiting) return;
    if (document.querySelector("#dialog").open) {
      toast("열린 입력창을 먼저 저장하거나 닫아 주세요.");
      return;
    }
    applying = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  };
  window.addEventListener("offline", () => state("오프라인 · 기기에 저장"));
  window.addEventListener("online", () => {
    state("이 기기에 저장");
    registration?.update().catch(() => {});
  });
  return {
    async install() {
      if (prompt) {
        await prompt.prompt();
        await prompt.userChoice;
        prompt = null;
        return;
      }
      const installed =
        matchMedia("(display-mode: standalone)").matches ||
        navigator.standalone;
      openDialog(
        installed ? "앱으로 사용 중이에요" : "홈 화면에 리치콕 추가",
        installed
          ? "<p>주소창 없이 리치콕을 사용하고 있어요. 저장된 내역은 오프라인에서도 확인할 수 있어요.</p>"
          : '<ol class="install-steps"><li><strong>iPhone · iPad Safari</strong><p>공유 버튼 → 홈 화면에 추가 → 추가</p></li><li><strong>Android · Chrome</strong><p>브라우저 메뉴 → 앱 설치 또는 홈 화면에 추가</p></li><li><strong>컴퓨터</strong><p>주소창의 설치 아이콘 또는 브라우저 메뉴에서 설치</p></li></ol><p class="small muted">첫 방문은 온라인에서 열어 주세요. 앱 코드가 준비되면 저장된 내역을 오프라인에서도 볼 수 있어요.</p>',
      );
    },
  };
}
