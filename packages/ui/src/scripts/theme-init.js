// Applies the saved theme before the page is drawn, so there is no flash of
// the wrong colours. Loaded as a tiny blocking script in <head>; it must stay
// a separate file (not inline) so our Content Security Policy allows it.
(function () {
  try {
    var theme = localStorage.getItem('shkriuss:theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (_error) {
    // Storage unavailable: follow the device setting.
  }
})();
