// The Android app's download link, from VITE_ANDROID_APP_URL (ADR 0012, amended): the APK on the repository's releases
// page, so the one setting that carries a path. Unset or not https, there is no link; the site doesn't need the app.
// No import from session-core: the landing chunk loads this, and must stay free of zod (ADR 0017).
export function androidAppUrl(env: Record<string, string | boolean | undefined> = import.meta.env): string | null {
  const raw = String(env.VITE_ANDROID_APP_URL ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return url.href;
}
