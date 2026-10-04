// Site-wide behaviour, loaded by every page.
//
// 1. The takedown address, assembled in the browser so the served HTML never
//    holds it in plain text (see lib/contact.js for the encoding). Each
//    <a class="js-contact" data-c="..."> becomes a working mailto link showing
//    the address; without JavaScript the link keeps its fallback text and href.
// 2. Links to other sites open in a new tab. The templates' static links carry
//    target="_blank" themselves (tests/site.test.js holds them to it); this
//    covers every link the pages build in script, at the moment it is clicked.
(function () {
  function decode(encoded) {
    try { return atob(encoded).split('').reverse().join(''); } catch (e) { return null; }
  }
  function fill() {
    var links = document.querySelectorAll('a.js-contact[data-c]');
    for (var i = 0; i < links.length; i++) {
      var addr = decode(links[i].getAttribute('data-c'));
      if (!addr || addr.indexOf('@') < 1) continue;
      links[i].href = 'mailto:' + addr;
      links[i].textContent = addr;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
  else fill();

  // Capture phase, so the target is set before the browser follows the link.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.protocol !== 'http:' && a.protocol !== 'https:') || a.host === location.host) return;
    a.target = '_blank';
    a.rel = 'noopener';
  }, true);
})();
