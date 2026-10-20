// Applies the color mode chosen in the app's header before the page is first drawn, so a page set to Light or Dark
// doesn't flash the system's mode. index.html loads this file as an ordinary blocking script in <head>: the CSP allows
// scripts from our own origin but no inline ones. It does what applyColorMode in src/lib/color-mode.ts does, which
// owns the setting; test/color-mode.test.tsx checks the two agree. Storage may be blocked: then nothing happens here.
(function () {
  var mode = null;
  try {
    mode = window.localStorage.getItem("builder.color-mode");
  } catch (e) {
    return;
  }
  if (mode !== "light" && mode !== "dark") return;
  document.documentElement.setAttribute("data-theme", mode);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  var color = null;
  for (var i = 0; i < metas.length; i++) {
    metas[i].setAttribute("data-default-content", metas[i].getAttribute("content") || "");
    var media = metas[i].getAttribute("media") || "";
    if (color === null && media.indexOf("prefers-color-scheme: " + mode) !== -1) color = metas[i].getAttribute("content");
  }
  if (color === null) return;
  for (var j = 0; j < metas.length; j++) metas[j].setAttribute("content", color);
})();
