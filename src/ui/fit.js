// Full screen on any phone / tablet (classic script, loaded from index.html).
// - --hud-z: one zoom for the HUD and touch controls, from the free screen
//   size (the layout is tuned for 800 x 360 CSS px, e.g. a Samsung A04 in
//   landscape). Exactly 1 near that size, so the tuned layout is untouched.
// - Re-sends 'resize' when the visible area changes without a window resize
//   (address bar, rotation, leaving full screen), so the 3D canvas
//   (src/main.js onResize) always fills the screen.
// - Browser only: goes full screen (and locks landscape) on the first tap.
(function () {
  var root = document.documentElement;
  var probe = null;
  function safe() {
    if (!probe) {
      probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:var(--hud-t,0px) var(--hud-r,0px) var(--hud-b,0px) var(--hud-l,0px)';
      (document.body || root).appendChild(probe);
    }
    var cs = getComputedStyle(probe);
    return {
      l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0,
      t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0,
    };
  }
  function size() {
    var vv = window.visualViewport;
    return { w: vv ? vv.width * (vv.scale || 1) : innerWidth, h: vv ? vv.height * (vv.scale || 1) : innerHeight };
  }
  var lastZ = '';
  function fit() {
    var s = size(), i = safe();
    var w = Math.max(1, s.w - i.l - i.r), h = Math.max(1, s.h - i.t - i.b);
    // landscape layout reference 800 x 360; portrait (browser) uses the short side
    var z = w >= h ? Math.min(h / 360, w / 800) : Math.min(w / 360, h / 800);
    z = Math.max(0.8, Math.min(1.5, z));
    if (Math.abs(z - 1) < 0.08) z = 1;
    z = String(Math.round(z * 20) / 20);
    if (z !== lastZ) { lastZ = z; root.style.setProperty('--hud-z', z); }
    root.dataset.fit = Math.round(s.w) + 'x' + Math.round(s.h) + '@' + z;
  }
  var t1 = 0, t2 = 0;
  function nudge() {
    // let the game re-measure; again a little later for phones that report
    // the new size late after a rotation
    fit();
    window.dispatchEvent(new Event('resize'));
    clearTimeout(t1); clearTimeout(t2);
    t1 = setTimeout(function () { fit(); window.dispatchEvent(new Event('resize')); }, 250);
    t2 = setTimeout(function () { fit(); window.dispatchEvent(new Event('resize')); window.scrollTo(0, 0); }, 700);
  }
  window.addEventListener('resize', fit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', nudge);
  window.addEventListener('orientationchange', nudge);
  document.addEventListener('fullscreenchange', nudge);
  document.addEventListener('webkitfullscreenchange', nudge);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fit); else fit();
  window.__izkFit = fit;

  // ---- Browser: full screen + landscape on a tap (the Android app is already full screen) ----
  var inApp = !!window.IZKNative;
  var touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  function goFull() {
    if (inApp || !touch) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) return;
    try {
      var p = req.call(root, { navigationUI: 'hide' });
      if (p && p.then) {
        p.then(function () {
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
        }).catch(function () {});
      }
    } catch (e) { /* not allowed here: keep playing in the normal page */ }
  }
  // every tap while not full screen tries again (like the app's sticky mode)
  document.addEventListener('pointerup', goFull, true);
})();
