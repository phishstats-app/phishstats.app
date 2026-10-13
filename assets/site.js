// Site-wide behaviour, loaded by every page.
//
// 1. The takedown address, assembled in the browser so the served HTML never
//    holds it in plain text (see lib/contact.js for the encoding). Each
//    <a class="js-contact" data-c="..."> becomes a working mailto link showing
//    the address; without JavaScript the link keeps its fallback text and href.
// 2. Links to other sites open in a new tab. The templates' static links carry
//    target="_blank" themselves (tests/site.test.js holds them to it); this
//    covers every link the pages build in script, at the moment it is clicked.
// 3. The "Copy link" button in a page's title (Phish.shareHtml in app.js
//    writes it). On a phone it opens the system share sheet; elsewhere it
//    copies the page's address and says "Copied" for a moment. The address
//    keeps the query (/song?song=...) and drops any #anchor.
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

  function pageUrl() { return location.origin + location.pathname + location.search; }
  // A touch phone with a share sheet; a desktop browser that also has one
  // (Edge, Chrome on Windows) still copies, which is what the label says.
  function useSheet() {
    return !!(navigator.share && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return copyOld(text); });
    }
    return copyOld(text);
  }
  // Older browsers, pages served over plain http on the LAN, and a browser
  // that turns the Clipboard API down.
  function copyOld(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }
  function say(btn, text) {
    var label = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', label);
    btn.textContent = text;
    clearTimeout(btn._shareTimer);
    btn._shareTimer = setTimeout(function () { btn.textContent = label; }, 2000);
  }
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button.js-share') : null;
    if (!btn) return;
    var url = pageUrl();
    if (useSheet()) {
      navigator.share({ title: document.title, url: url }).catch(function (err) {
        // Closing the sheet is a choice, not a failure.
        if (!err || err.name !== 'AbortError') copyText(url).then(function () { say(btn, 'Copied'); }, function () { say(btn, 'Couldn’t copy'); });
      });
      return;
    }
    copyText(url).then(function () { say(btn, 'Copied'); }, function () { say(btn, 'Couldn’t copy'); });
  });
})();
