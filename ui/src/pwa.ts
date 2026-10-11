/// <reference types="vite/client" />
// PWA(Service Worker の登録)。本番ビルドのみ。失敗は握りつぶさず、コンソールに出す
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e: unknown) => {
      console.error("Service Worker の登録に失敗しました", e);
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
