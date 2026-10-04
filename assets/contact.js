// The takedown address, assembled in the browser so the served HTML never
// holds it in plain text (see lib/contact.js for the encoding). Each
// <a class="js-contact" data-c="..."> becomes a working mailto link showing
// the address; without JavaScript the link keeps its fallback text and href.
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
})();
