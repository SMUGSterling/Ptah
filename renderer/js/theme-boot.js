// theme-boot.js — applies the saved interface theme before the first paint.
// A classic script in <head> (the CSP allows no inline script), so the page
// never flashes Ptah's own colours before app.js loads. An unknown key does
// nothing: style.css has no block for it, and app.js resets it (themes.js).
(function () {
  try {
    var key = localStorage.getItem('ptah.theme');
    if (key && key !== 'ptah') document.documentElement.setAttribute('data-theme', key);
  } catch (e) { /* storage unavailable: Ptah's own colours */ }
})();
