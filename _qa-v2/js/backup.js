import { restoreEnvelope } from "./models.js";
const iterations = 250000;
const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function key(password, salt, usage) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}
export async function encryptBackup(state, password) {
  if (password.length < 8)
    throw Error("백업 비밀번호는 8자 이상 입력해 주세요.");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = JSON.stringify({
    format: "richkkok-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    state,
  });
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt, ["encrypt"]),
    new TextEncoder().encode(payload),
  );
  return JSON.stringify({
    format: "richkkok-encrypted",
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(new Uint8Array(ciphertext)),
  });
}
export async function decryptBackup(text, password = "") {
  if (text.length > 40 * 1024 * 1024) throw Error("백업 파일이 너무 커요.");
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw Error("백업 파일을 읽을 수 없어요.");
  }
  if (file.format !== "richkkok-encrypted")
    return {
      state: restoreEnvelope(file),
      encrypted: false,
      setup: file.format === "richkkok-private-setup",
    };
  if (
    file.version !== 1 ||
    file.iterations !== iterations ||
    file.kdf !== "PBKDF2-SHA256"
  )
    throw Error("지원하지 않는 암호화 형식이에요.");
  let payload;
  try {
    const salt = un64(file.salt),
      iv = un64(file.iv);
    if (salt.length !== 16 || iv.length !== 12) throw Error();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await key(password, salt, ["decrypt"]),
      un64(file.ciphertext),
    );
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw Error("비밀번호가 다르거나 백업 파일이 손상되었어요.");
  }
  return { state: restoreEnvelope(payload), encrypted: true, setup: false };
}
export function downloadFile(text, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
