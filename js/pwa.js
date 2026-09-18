import { openDialog, toast } from "./ui.js";

export function setupPWA() {
  let prompt = null,
    registration = null;

  const status = document.querySelector("#storage-status");
  const installBanner = document.querySelector("#install-banner");
  const installButton = document.querySelector("#install-app");
  const dismissButton = document.querySelector("#dismiss-install");
  const installDetail = document.querySelector("#install-banner-detail");

  const state = (t) => {
    if (!status) return;
    status.textContent = t;
    status.dataset.status = t;
  };

  const isInstalled = () =>
    matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true ||
    document.referrer.startsWith("android-app://");

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const dismissedThisSession = () => {
    try {
      return sessionStorage.getItem("richkkok-install-dismissed") === "1";
    } catch {
      return false;
    }
  };

  const hideInstallBanner = () => {
    if (installBanner) installBanner.hidden = true;
  };

  const showInstallBanner = () => {
    if (!installBanner || isInstalled() || dismissedThisSession()) return;
    if (installDetail) {
      installDetail.textContent = prompt
        ? "홈 화면에서 바로 열고 오프라인에서도 사용할 수 있어요."
        : isIOS()
          ? "홈 화면에 추가하면 주소창 없이 앱처럼 열려요."
          : "홈 화면에 설치하면 리치콕을 앱처럼 바로 열 수 있어요.";
    }
    installBanner.hidden = false;
  };

  const showInstallGuide = () => {
    const installed = isInstalled();
    openDialog(
      installed ? "앱으로 사용 중이에요" : "홈 화면에 리치콕 추가",
      installed
        ? "<p>주소창 없이 리치콕을 사용하고 있어요. 저장된 내역은 오프라인에서도 확인할 수 있어요.</p>"
        : isIOS()
          ? '<ol class="install-steps"><li><strong>iPhone · iPad</strong><p>브라우저의 공유 버튼을 누른 뒤 <b>홈 화면에 추가</b> → <b>추가</b>를 눌러 주세요.</p></li></ol><p class="small muted">설치 후 홈 화면의 리치콕 아이콘으로 열면 주소창 없이 앱처럼 실행돼요.</p>'
          : '<ol class="install-steps"><li><strong>Android · Chrome</strong><p>브라우저 메뉴 → 앱 설치 또는 홈 화면에 추가</p></li><li><strong>컴퓨터</strong><p>주소창의 설치 아이콘 또는 브라우저 메뉴에서 설치</p></li></ol><p class="small muted">브라우저가 설치창을 지원하면 상단의 설치 버튼에서 바로 연결돼요.</p>',
    );
  };

  const install = async () => {
    if (isInstalled()) {
      showInstallGuide();
      return;
    }

    if (prompt) {
      const currentPrompt = prompt;
      prompt = null;
      const result = await currentPrompt.prompt();
      if (result?.outcome === "accepted") {
        hideInstallBanner();
      } else {
        try {
          sessionStorage.setItem("richkkok-install-dismissed", "1");
        } catch {}
        hideInstallBanner();
      }
      return;
    }

    showInstallGuide();
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event;
    showInstallBanner();
  });

  window.addEventListener("appinstalled", () => {
    prompt = null;
    hideInstallBanner();
    toast("홈 화면에 리치콕을 설치했어요.");
  });

  installButton?.addEventListener("click", () => {
    install().catch(() => showInstallGuide());
  });

  dismissButton?.addEventListener("click", () => {
    try {
      sessionStorage.setItem("richkkok-install-dismissed", "1");
    } catch {}
    hideInstallBanner();
  });

  if (!isInstalled()) requestAnimationFrame(showInstallBanner);

  const displayMode = matchMedia("(display-mode: standalone)");
  displayMode.addEventListener?.("change", () => {
    if (isInstalled()) hideInstallBanner();
    else showInstallBanner();
  });

  const showUpdate = () => {
    const banner = document.querySelector("#update-banner");
    if (banner) banner.hidden = false;
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

  const applyUpdate = document.querySelector("#apply-update");
  if (applyUpdate)
    applyUpdate.onclick = () => {
      if (!registration?.waiting) return;
      if (document.querySelector("#dialog")?.open) {
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

  return { install };
}
