// Whether this browser is probably signed in, read before Clerk's script loads (ADR 0017). Clerk keeps the
// `__client_uat` cookie (its name may carry a suffix, `__client_uat_<id>`) at "0" when signed out and at a timestamp
// once someone signs in. It only decides which part of the site to load at `/`: Clerk still decides who is signed in.
// Read only; nothing here writes a cookie.
export function probablySignedIn(cookies: string = readCookies()): boolean {
  return cookies.split(";").some((pair) => {
    const at = pair.indexOf("=");
    if (at < 0) return false;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    return /^__client_uat(?:_[\w-]+)?$/.test(name) && /^[1-9]\d*$/.test(value);
  });
}

function readCookies(): string {
  return typeof document === "undefined" ? "" : document.cookie;
}
