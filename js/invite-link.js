// Invite links are bearer credentials. Only accept URLs from this exact app
// origin, and never persist the raw token in application state or a query log.
const ORIGIN = "https://richkkok.github.io";
const FORMAT = /^[A-Za-z0-9_-]{32,128}$/;

export function inviteTokenFromUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2048)
    throw Error("초대링크 전체를 붙여넣어 주세요.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Error("리치콕에서 복사한 공식 초대링크를 붙여넣어 주세요.");
  }
  if (
    url.origin !== ORIGIN ||
    (url.pathname !== "/" && url.pathname !== "/index.html") ||
    url.username ||
    url.password
  )
    throw Error("리치콕 공식 주소의 초대링크만 사용할 수 있어요.");
  let fragment = "";
  try {
    if (url.hash.startsWith("#invite="))
      fragment = decodeURIComponent(url.hash.slice("#invite=".length));
  } catch {
    throw Error("초대링크에 잘못된 문자가 있어요. 링크를 다시 복사해 주세요.");
  }
  const query = url.searchParams.get("invite");
  if (query && fragment && query !== fragment)
    throw Error("초대정보가 서로 달라요. 링크를 다시 복사해 주세요.");
  const token = query || fragment;
  if (!FORMAT.test(token || ""))
    throw Error("초대코드가 없는 링크예요. 가족에게 새 초대링크를 요청해 주세요.");
  return token;
}
