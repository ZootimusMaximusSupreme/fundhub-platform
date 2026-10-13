// The hiring funnels' video slot — shared by /join/ and /join/coo/.
// Each page names its file in div#vsl[data-src]. The video plays only once the
// file is really there: a HEAD that is not a 200 video leaves the placeholder up,
// so a missing file never shows a broken player.
(function () {
  var box = document.getElementById('vsl');
  var src = box && box.getAttribute('data-src');
  if (!src || !window.fetch) return;
  fetch(src, { method: 'HEAD' }).then(function (r) {
    var type = r.headers.get('content-type') || '';
    if (!r.ok || type.indexOf('video') !== 0) return;
    var v = document.createElement('video');
    v.src = src; v.autoplay = true; v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', '');
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'unmute';
    b.innerHTML = '<span class="unmute-pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>Tap for sound</span>';
    b.addEventListener('click', function () {
      v.muted = false; v.currentTime = 0; v.controls = true;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      b.classList.add('hidden');
    });
    var soon = document.getElementById('vsl-soon');
    if (soon) soon.remove();
    box.appendChild(v); box.appendChild(b);
  }).catch(function () {});
})();
