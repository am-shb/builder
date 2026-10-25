import { describe, expect, it } from "vitest";
import { androidAppUrl } from "../src/lib/android-app-url.ts";

// The Android app's download link comes from VITE_ANDROID_APP_URL, like the other settings (ADR 0012, amended).
describe("androidAppUrl", () => {
  it("takes an https URL to the APK, with its path", () => {
    expect(androidAppUrl({ VITE_ANDROID_APP_URL: " https://releases.example.test/builder/v0.1.0/builder-android.apk " }))
      .toBe("https://releases.example.test/builder/v0.1.0/builder-android.apk");
  });

  it("is null when the setting is missing or empty: the site has no app to offer", () => {
    expect(androidAppUrl({})).toBeNull();
    expect(androidAppUrl({ VITE_ANDROID_APP_URL: "" })).toBeNull();
    expect(androidAppUrl({ VITE_ANDROID_APP_URL: "   " })).toBeNull();
  });

  it("refuses anything but https, and a URL with credentials: an installable file never travels in clear text", () => {
    for (const bad of ["http://releases.example.test/builder-android.apk", "ftp://releases.example.test/a.apk", "javascript:alert(1)", "builder-android.apk", "/builder-android.apk", "https://user:pw@releases.example.test/a.apk"]) {
      expect(androidAppUrl({ VITE_ANDROID_APP_URL: bad }), bad).toBeNull();
    }
  });
});
