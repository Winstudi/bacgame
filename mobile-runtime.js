(() => {
  "use strict";

  function cleanUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  const metaApiUrl = document
    .querySelector('meta[name="ptitbac-api-url"]')
    ?.getAttribute("content");

  const explicitConfig =
    window.__PTITBAC_CONFIG__ &&
    typeof window.__PTITBAC_CONFIG__ === "object"
      ? window.__PTITBAC_CONFIG__
      : {};

  const apiUrl = cleanUrl(explicitConfig.apiUrl || metaApiUrl || "");
  const nativeShell = Boolean(
    window.Capacitor?.isNativePlatform?.() ||
    window.Capacitor?.getPlatform?.() === "ios" ||
    window.Capacitor?.getPlatform?.() === "android"
  );

  const originalIo = window.io;

  if (typeof originalIo === "function") {
    function mobileAwareIo(...args) {
      if (apiUrl && (!args.length || (args.length === 1 && typeof args[0] === "object"))) {
        return originalIo(apiUrl, args[0]);
      }
      return originalIo(...args);
    }

    try {
      Object.assign(mobileAwareIo, originalIo);
    } catch {}

    window.io = mobileAwareIo;
  }

  function emitLifecycle(type) {
    document.dispatchEvent(
      new CustomEvent("ptitbac:app-lifecycle", {
        detail: {
          type,
          visible: document.visibilityState !== "hidden",
          nativeShell,
          platform: nativeShell
            ? String(window.Capacitor?.getPlatform?.() || "native")
            : "web"
        }
      })
    );
  }

  document.documentElement.classList.toggle("ptb-native-shell", nativeShell);
  document.documentElement.dataset.ptitbacRuntime = "mobile-foundation-v1";

  document.addEventListener("visibilitychange", () => {
    emitLifecycle(
      document.visibilityState === "hidden"
        ? "background"
        : "foreground"
    );
  });

  window.addEventListener("online", () => emitLifecycle("online"));
  window.addEventListener("offline", () => emitLifecycle("offline"));
  window.addEventListener("pageshow", () => emitLifecycle("pageshow"));

  window.PtitBacRuntime = Object.freeze({
    apiUrl,
    nativeShell,
    platform: nativeShell
      ? String(window.Capacitor?.getPlatform?.() || "native")
      : "web",
    socketUsesRemoteBackend: Boolean(apiUrl),
    version: "mobile-foundation-v1"
  });
})();
