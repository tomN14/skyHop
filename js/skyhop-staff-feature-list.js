/**
 * Feature catalog FAB — opens full Sky Hop feature list (all players).
 */
(function () {
  function bind() {
    var screen = document.getElementById('screenStaffFeatureList');
    var fab = document.getElementById('btnStaffFeatureList');
    var close = document.getElementById('btnStaffFeatureListClose');
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
