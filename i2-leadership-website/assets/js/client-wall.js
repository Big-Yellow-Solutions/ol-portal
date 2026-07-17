/* i2 Leadership — client-wall.js
   Drives the .client-wall hero (port of the "i2 Leadership Hero" design's
   drift + perspective-warp loop). Each row loops horizontally at its own
   speed and direction; every tile is warped by its distance from the hero
   center (rotateX by row, rotateY/translateZ/scale by column). Under
   prefers-reduced-motion the warp is applied once and the drift stays off. */
(function () {
  var hero = document.querySelector(".client-wall");
  var wall = document.querySelector(".cw-wall");
  if (!hero || !wall) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var GAP = 14;
  var TILES_PER_LOOP = 9;

  var rows = Array.prototype.slice.call(hero.querySelectorAll(".cw-row")).map(function (r) {
    return {
      el: r,
      i: +r.dataset.i,
      dir: +r.dataset.dir,
      speed: +r.dataset.speed,
      tiles: Array.prototype.slice.call(r.querySelectorAll(".cw-tile")),
    };
  });
  if (!rows.length) return;

  var m = { w: 0, h: 0, stride: 0, loopW: 0, vw: 0, cx: 0, wallLeft: 0, rowNy: [] };

  function measure() {
    var t = rows[0].tiles[0].getBoundingClientRect();
    m.w = t.width;
    m.h = t.height;
    m.stride = m.w + GAP;
    m.loopW = TILES_PER_LOOP * m.stride;
    m.vw = window.innerWidth;
    var heroRect = hero.getBoundingClientRect();
    var wallRect = wall.getBoundingClientRect();
    m.wallLeft = wallRect.left;
    var heroMidY = heroRect.height / 2;
    m.rowNy = rows.map(function (r) {
      var cy = (wallRect.top - heroRect.top) + r.i * (m.h + GAP) + m.h / 2;
      var ny = (cy - heroMidY) / heroMidY;
      return Math.max(-1, Math.min(1, ny));
    });
  }

  measure();
  window.addEventListener("resize", measure);

  var start = performance.now();

  function frame(now) {
    var t = (now - start) / 1000;
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      var v = (t * r.speed) % m.loopW;
      var x = r.dir < 0 ? -v : v - m.loopW;
      r.el.style.transform = "translate3d(" + x + "px,0,0)";
      var rx = -m.rowNy[ri] * 7;
      for (var j = 0; j < r.tiles.length; j++) {
        var cx = m.wallLeft + x + j * m.stride + m.w / 2;
        var nx = (cx - m.vw / 2) / (m.vw / 2);
        if (nx < -1.3 || nx > 1.3) continue;
        var ry = -nx * 16;
        var z = -(nx * nx) * 90;
        var s = 1 - nx * nx * 0.09;
        r.tiles[j].style.transform =
          "rotateX(" + rx + "deg) rotateY(" + ry + "deg) translateZ(" + z + "px) scale(" + s + ")";
      }
    }
    if (!reduced) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
