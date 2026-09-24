/**
 * Main-menu guide for the SkyHop SPL API (not the whole language).
 */
(function () {
  function bind() {
    var fab = document.getElementById('btnSplGuideFab');
    var screen = document.getElementById('screenSplGuide');
    var close = document.getElementById('btnSplGuideClose');
    if (fab && screen) {
      fab.addEventListener('click', function () {
        screen.classList.remove('hidden');
        screen.classList.add('flex');
      });
    }
    if (close && screen) {
      close.addEventListener('click', function () {
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
