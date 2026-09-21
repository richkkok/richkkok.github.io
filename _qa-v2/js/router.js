const routes = new Set([
  "home",
  "transactions",
  "budget",
  "analytics",
  "settings",
  "import",
]);
export function route() {
  const value = location.hash.slice(1);
  return routes.has(value) ? value : "home";
}
export function navigate(value) {
  if (location.hash === "#" + value)
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = value;
}
export function watchRoute(callback) {
  window.addEventListener("hashchange", callback);
}
