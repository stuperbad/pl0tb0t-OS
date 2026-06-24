// Shared fill geometry for plotter SVG export.
// Exposed as window.plotFills — loaded before all sketch scripts.
window.plotFills = (function () {
    'use strict';

    var EPS = 0.8;
    var _penLift = false;
    function setPenLift(v) { _penLift = !!v; }
    function isPenLift() { return _penLift; }

    var _scatterStyles = [];
    function setScatterStyles(arr) { _scatterStyles = Array.isArray(arr) ? arr : []; }
    function getScatterStyles() { return (window._pl0tMode || 'fast') === 'full' ? _scatterStyles : []; }

    var _fillAngle = 0;
    function setFillAngle(v) { _fillAngle = Number(v) || 0; }
    function getFillAngle() { return _fillAngle; }

    var _fillImperfection = 0;
    function setFillImperfection(v) { _fillImperfection = Math.max(0, Math.min(100, Number(v) || 0)); }
    function getFillImperfection() { return _fillImperfection / 100; }

    var _fillDensity = 50;
    function setFillDensity(v) { _fillDensity = Math.max(10, Number(v) || 50); }
    function getFillDensity() { return _fillDensity; }
    function getEffectiveDensity() {
        var penMm = Math.max(0.1, Number(window._pl0tPenWidthMm) || 0.4);
        return _fillDensity / (penMm * 100);
    }

    var _fillProb = 1.0;
    function setFillProb(v) { _fillProb = Math.max(0, Math.min(1, Number(v) || 1)); }
    function getFillProb() { return _fillProb; }

    function _makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function() { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    }

    function _makeSymbol(type, s) {
        if (type === 'sprig') {
            return [
                {x1: 0,      y1: -s*0.5,  x2: 0,       y2:  s*0.5},
                {x1: 0,      y1:  s*0.1,  x2:  s*0.35, y2: -s*0.15},
                {x1: 0,      y1:  s*0.1,  x2: -s*0.35, y2: -s*0.15},
                {x1: 0,      y1: -s*0.2,  x2:  s*0.25, y2: -s*0.45},
                {x1: 0,      y1: -s*0.2,  x2: -s*0.25, y2: -s*0.45}
            ];
        }
        if (type === 'ribbon') {
            var steps = 12, segs = [], prev = null;
            for (var _i = 0; _i <= steps; _i++) {
                var _t = _i / steps;
                var _rx = (_t - 0.5) * s, _ry = Math.sin(_t * Math.PI * 2) * s * 0.28;
                if (prev) segs.push({x1: prev.x, y1: prev.y, x2: _rx, y2: _ry});
                prev = {x: _rx, y: _ry};
            }
            return segs;
        }
        if (type === 'cross') {
            return [
                {x1: -s*0.45, y1: 0,       x2:  s*0.45, y2: 0},
                {x1: 0,       y1: -s*0.45, x2:  0,      y2: s*0.45}
            ];
        }
        if (type === 'asterisk') {
            var _out = [];
            for (var _a = 0; _a < 3; _a++) {
                var _ang = _a * Math.PI / 3;
                _out.push({x1: Math.cos(_ang)*s*0.45, y1: Math.sin(_ang)*s*0.45,
                           x2: -Math.cos(_ang)*s*0.45, y2: -Math.sin(_ang)*s*0.45});
            }
            return _out;
        }
        return [{x1: -s*0.2, y1: 0, x2: s*0.2, y2: 0}];
    }

    function _clipSegToPoly(x1, y1, x2, y2, poly) {
        var dx = x2 - x1, dy = y2 - y1;
        var ts = [0, 1];
        var P0 = {x: x1, y: y1}, P1 = {x: x2, y: y2};
        for (var i = 0; i < poly.length; i++) {
            var t = segIntersectT(P0, P1, poly[i], poly[(i + 1) % poly.length]);
            if (t !== null) ts.push(t);
        }
        ts.sort(function(a, b) { return a - b; });
        var out = [];
        for (var j = 0; j + 1 < ts.length; j++) {
            var tm = (ts[j] + ts[j + 1]) / 2;
            if (pointInPoly({x: x1 + tm * dx, y: y1 + tm * dy}, poly))
                out.push({x1: x1 + ts[j] * dx, y1: y1 + ts[j] * dy,
                          x2: x1 + ts[j + 1] * dx, y2: y1 + ts[j + 1] * dy});
        }
        return out;
    }

    function scatterPolyFill(poly, type, spacing, symScale, seed) {
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        poly.forEach(function(pt) {
            minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
        });
        var symSize = spacing * Math.max(0.1, symScale || 1.0);
        var area = (maxX - minX) * (maxY - minY);
        var count = Math.max(0, Math.round(area / (spacing * spacing)));
        var rng = _makeRng((seed ^ 0x5A3C9F) >>> 0);
        var out = [];
        for (var _i = 0; _i < count; _i++) {
            var cx = minX + rng() * (maxX - minX);
            var cy = minY + rng() * (maxY - minY);
            if (!pointInPoly({x: cx, y: cy}, poly)) continue;
            var angle = rng() * Math.PI * 2;
            var cos = Math.cos(angle), sin = Math.sin(angle);
            var rawSegs = _makeSymbol(type, symSize);
            rawSegs.forEach(function(seg) {
                var rx1 = cx + seg.x1 * cos - seg.y1 * sin, ry1 = cy + seg.x1 * sin + seg.y1 * cos;
                var rx2 = cx + seg.x2 * cos - seg.y2 * sin, ry2 = cy + seg.x2 * sin + seg.y2 * cos;
                Array.prototype.push.apply(out, _clipSegToPoly(rx1, ry1, rx2, ry2, poly));
            });
        }
        return out;
    }

    function fmt(n) { return n.toFixed(2); }

    // ── Geometry primitives ───────────────────────────────────────────────────

    function segIntersectT(P, Q, A, B) {
        var rx = Q.x - P.x, ry = Q.y - P.y;
        var sx = B.x - A.x, sy = B.y - A.y;
        var den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-10) return null;
        var t = ((A.x - P.x) * sy - (A.y - P.y) * sx) / den;
        var u = ((A.x - P.x) * ry - (A.y - P.y) * rx) / den;
        return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : null;
    }

    function pointInPoly(pt, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            if (((yi > pt.y) !== (yj > pt.y)) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
                inside = !inside;
        }
        return inside;
    }

    // Keep portions of segment OUTSIDE poly (for whirls overlap-erase)
    function clipLineOutsidePoly(x1, y1, x2, y2, poly) {
        var dx = x2 - x1, dy = y2 - y1, ts = [0, 1];
        var P = { x: x1, y: y1 }, Q = { x: x2, y: y2 };
        for (var i = 0; i < poly.length; i++) {
            var t = segIntersectT(P, Q, poly[i], poly[(i + 1) % poly.length]);
            if (t !== null) ts.push(t);
        }
        ts.sort(function (a, b) { return a - b; });
        var out = [];
        for (var j = 0; j + 1 < ts.length; j++) {
            var tm = (ts[j] + ts[j + 1]) / 2;
            if (!pointInPoly({ x: x1 + tm * dx, y: y1 + tm * dy }, poly))
                out.push({ x1: x1 + ts[j] * dx, y1: y1 + ts[j] * dy,
                           x2: x1 + ts[j + 1] * dx, y2: y1 + ts[j + 1] * dy });
        }
        return out;
    }

    // Liang-Barsky rectangle clip
    function clipLineToRect(x1, y1, x2, y2, rx, ry, rw, rh) {
        var dx = x2 - x1, dy = y2 - y1;
        var p = [-dx, dx, -dy, dy];
        var q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
        var t0 = 0, t1 = 1;
        for (var i = 0; i < 4; i++) {
            if (Math.abs(p[i]) < 1e-10) { if (q[i] < 0) return null; }
            else { var t = q[i] / p[i]; if (p[i] < 0) { if (t > t0) t0 = t; } else { if (t < t1) t1 = t; } }
        }
        if (t0 > t1) return null;
        return { x1: x1 + t0 * dx, y1: y1 + t0 * dy, x2: x1 + t1 * dx, y2: y1 + t1 * dy };
    }

    // ── Row generation ────────────────────────────────────────────────────────

    // Straight hatch clipped to poly, grouped by scan row.
    // Returns [[{x1,y1,x2,y2},...], ...]
    function hatchPolyRows(poly, angleDeg, spacing) {
        if (!poly.length || spacing <= 0) return [];
        var ang = angleDeg * Math.PI / 180;
        var dir = { x: Math.cos(ang), y: Math.sin(ang) };
        var nrm = { x: -Math.sin(ang), y: Math.cos(ang) };
        var proj = function (pt) { return nrm.x * pt.x + nrm.y * pt.y; };
        var minP = Infinity, maxP = -Infinity;
        poly.forEach(function (pt) { var pr = proj(pt); if (pr < minP) minP = pr; if (pr > maxP) maxP = pr; });
        var rows = [];
        for (var k = Math.floor((minP - spacing) / spacing); k <= Math.ceil((maxP + spacing) / spacing); k++) {
            var off = k * spacing;
            var p0 = { x: -9999 * dir.x + off * nrm.x, y: -9999 * dir.y + off * nrm.y };
            var p1 = { x:  9999 * dir.x + off * nrm.x, y:  9999 * dir.y + off * nrm.y };
            var ts = [];
            for (var i = 0; i < poly.length; i++) {
                var t = segIntersectT(p0, p1, poly[i], poly[(i + 1) % poly.length]);
                if (t !== null) ts.push(t);
            }
            ts.sort(function (a, b) { return a - b; });
            var row = [];
            for (var j = 0; j + 1 < ts.length; j += 2)
                row.push({ x1: p0.x + (p1.x - p0.x) * ts[j],     y1: p0.y + (p1.y - p0.y) * ts[j],
                           x2: p0.x + (p1.x - p0.x) * ts[j + 1], y2: p0.y + (p1.y - p0.y) * ts[j + 1] });
            if (row.length) rows.push(row);
        }
        return rows;
    }

    // Chaotic hatch: subdivide each line and push it along a tapered random
    // walk (perpendicular + slight along-line jitter) so lines wander and jag
    // rather than merely tilting. Ends stay anchored. `wobble` = chaos amplitude.
    function sketchHatchRows(baseRows, phase, wobble) {
        var gi = 0;
        var amp = wobble || 0;
        return baseRows.map(function (row) {
            var out = [];
            for (var li = 0; li < row.length; li++) {
                var ln = row[li];
                var dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1, len = Math.hypot(dx, dy);
                gi++;
                if (len < 1 || amp <= 0.01) { out.push(ln); continue; }
                var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
                var segN = Math.max(3, Math.min(14, Math.round(len / Math.max(5, amp * 1.2))));
                var seed = gi * 1013904223;
                var rnd = function (t) {
                    var v = Math.sin(seed * 1e-4 + t * 12.9898 + phase * 1.3) * 43758.5453;
                    return (v - Math.floor(v)) * 2 - 1;
                };
                var prevX = ln.x1, prevY = ln.y1, walk = rnd(0) * 0.5;
                for (var sIdx = 1; sIdx <= segN; sIdx++) {
                    var f = sIdx / segN;
                    var taper = Math.sin(Math.PI * f);
                    walk += rnd(sIdx) * 0.85;
                    if (walk > 1.8) walk = 1.8; else if (walk < -1.8) walk = -1.8;
                    var off = amp * taper * (walk + 0.6 * Math.sin(phase * 2.1 + f * 11 + gi * 0.7));
                    var tan = amp * 0.4 * taper * rnd(sIdx + 137);
                    var bx = ln.x1 + dx * f, by = ln.y1 + dy * f;
                    var px = bx + nx * off + ux * tan;
                    var py = by + ny * off + uy * tan;
                    out.push({ x1: prevX, y1: prevY, x2: px, y2: py });
                    prevX = px; prevY = py;
                }
            }
            return out;
        });
    }

    // Zigzag rows clipped to poly.
    function zigzagPolyRows(poly, angleDeg, spacing, phase) {
        var base = hatchPolyRows(poly, angleDeg, spacing * 1.0);
        return base.map(function (row, i) {
            var result = [];
            row.forEach(function (ln) {
                var dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1, len = Math.hypot(dx, dy);
                if (len < 2) return;
                var nx = -dy / len, ny = dx / len;
                var steps = Math.max(2, Math.min(16, Math.floor(len / Math.max(5, spacing * 1.2))));
                var prev = null;
                for (var s = 0; s <= steps; s++) {
                    var t = s / steps;
                    var side = (s + i) % 2 === 0 ? -1 : 1;
                    var off = (s === 0 || s === steps) ? 0 : side * spacing * 0.45 + Math.sin(phase + s * 1.7 + i) * spacing * 0.09;
                    var pt = { x: ln.x1 + dx * t + nx * off, y: ln.y1 + dy * t + ny * off };
                    if (prev) result.push({ x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y });
                    prev = pt;
                }
            });
            return result;
        }).filter(function (r) { return r.length > 0; });
    }

    // ── Contour fill (inset polygon rings) ───────────────────────────────────

    // Inset a convex polygon by `amount` pixels (inward offset of all edges).
    function insetPoly(poly, amount) {
        var n = poly.length;
        if (n < 3) return null;
        var area = 0;
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
        }
        var sign = area > 0 ? 1 : -1;
        var result = [];
        for (var i = 0; i < n; i++) {
            var prev = poly[(i - 1 + n) % n], curr = poly[i], next = poly[(i + 1) % n];
            var e1x = curr.x - prev.x, e1y = curr.y - prev.y;
            var e2x = next.x - curr.x, e2y = next.y - curr.y;
            var l1 = Math.hypot(e1x, e1y), l2 = Math.hypot(e2x, e2y);
            if (l1 < 1e-6 || l2 < 1e-6) { result.push({ x: curr.x, y: curr.y }); continue; }
            var n1x =  sign * e1y / l1, n1y = -sign * e1x / l1;
            var n2x =  sign * e2y / l2, n2y = -sign * e2x / l2;
            var bx = n1x + n2x, by = n1y + n2y, bl = Math.hypot(bx, by);
            if (bl < 1e-6) { result.push({ x: curr.x + n1x * amount, y: curr.y + n1y * amount }); continue; }
            var cos_a = (n1x * bx + n1y * by) / bl;
            var scale = cos_a > 0.1 ? amount / cos_a : amount * 10;
            result.push({ x: curr.x + (bx / bl) * scale, y: curr.y + (by / bl) * scale });
        }
        var newArea = 0;
        for (var i = 0; i < result.length; i++) {
            var j = (i + 1) % result.length;
            newArea += result[i].x * result[j].y - result[j].x * result[i].y;
        }
        if (Math.abs(newArea) < 4 || (newArea > 0) !== (area > 0)) return null;
        return result;
    }

    // Generate concentric inset rings of a polygon at `spacing` intervals.
    function contourPolyRows(poly, spacing) {
        var rows = [];
        var current = poly;
        for (var iter = 0; iter < 200; iter++) {
            var inset = insetPoly(current, spacing);
            if (!inset) break;
            rows.push(inset);
            current = inset;
        }
        return rows;
    }

    // SVG path D string for contour rows — alternating direction, connected.
    function contourConnectedPathD(rows) {
        if (!rows.length) return '';
        var d = '';
        for (var i = 0; i < rows.length; i++) {
            var poly = rows[i], n = poly.length;
            var fwd = (i % 2 === 0);
            var start = fwd ? 0 : n - 1, dir = fwd ? 1 : -1;
            d += (d ? ' L' : 'M') + fmt(poly[start].x) + ' ' + fmt(poly[start].y);
            for (var j = 1; j <= n; j++) {
                var idx = ((start + dir * j) % n + n) % n;
                d += ' L' + fmt(poly[idx].x) + ' ' + fmt(poly[idx].y);
            }
        }
        return d;
    }

    // Canvas: draw contour rows — alternating direction, connected.
    function drawContourRows(ctx, rows) {
        if (!rows.length) return;
        ctx.beginPath();
        var started = false;
        for (var i = 0; i < rows.length; i++) {
            var poly = rows[i], n = poly.length;
            var fwd = (i % 2 === 0);
            var start = fwd ? 0 : n - 1, dir = fwd ? 1 : -1;
            var sx = poly[start].x, sy = poly[start].y;
            ctx.moveTo(sx, sy);
            for (var j = 1; j <= n; j++) {
                var idx = ((start + dir * j) % n + n) % n;
                ctx.lineTo(poly[idx].x, poly[idx].y);
            }
        }
        ctx.stroke();
    }

    // ── Bezier-based flow contour (whirl cells) ──────────────────────────────

    // Canvas: draw contour lines using bilinear Hermite sampling (8 pts/line).
    // quad = [inner-start, outer-start, outer-end, inner-end]
    function drawContourFlow(ctx, quad, tangAngRad, spacingPx) {
        var tx = Math.cos(tangAngRad), ty = Math.sin(tangAngRad);
        var wS = Math.hypot(quad[1].x-quad[0].x, quad[1].y-quad[0].y);
        var wE = Math.hypot(quad[2].x-quad[3].x, quad[2].y-quad[3].y);
        var cellW = (wS + wE) * 0.5;
        if (cellW < spacingPx * 1.5 || spacingPx <= 0) return;
        var nLines = Math.floor(cellW / spacingPx) - 1;
        if (nLines < 1) return;
        var startOff = (cellW - (nLines - 1) * spacingPx) / 2;
        var N = 8;
        var mIn  = Math.hypot(quad[3].x-quad[0].x, quad[3].y-quad[0].y) * 0.35;
        var mOut = Math.hypot(quad[2].x-quad[1].x, quad[2].y-quad[1].y) * 0.35;
        ctx.beginPath();
        for (var k = 0; k < nLines; k++) {
            var alpha = (startOff + k * spacingPx) / cellW;
            var m = (1-alpha)*mIn + alpha*mOut;
            var fwd = (k % 2 === 0);
            for (var s = 0; s <= N; s++) {
                var u = fwd ? s/N : 1-s/N;
                var u2=u*u, u3=u2*u;
                var h00=2*u3-3*u2+1, h10=u3-2*u2+u, h01=-2*u3+3*u2, h11=u3-u2;
                var inX=h00*quad[0].x+h10*tx*mIn+h01*quad[3].x+h11*tx*mIn;
                var inY=h00*quad[0].y+h10*ty*mIn+h01*quad[3].y+h11*ty*mIn;
                var outX=h00*quad[1].x+h10*tx*mOut+h01*quad[2].x+h11*tx*mOut;
                var outY=h00*quad[1].y+h10*ty*mOut+h01*quad[2].y+h11*ty*mOut;
                var px=(1-alpha)*inX+alpha*outX, py=(1-alpha)*inY+alpha*outY;
                if (s===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
    }

    // SVG path D: contour flow lines via bilinear Hermite, centered, alternating direction.
    function contourFlowPathD(quad, tangAngRad, spacingPx) {
        var tx = Math.cos(tangAngRad), ty = Math.sin(tangAngRad);
        var wS = Math.hypot(quad[1].x-quad[0].x, quad[1].y-quad[0].y);
        var wE = Math.hypot(quad[2].x-quad[3].x, quad[2].y-quad[3].y);
        var cellW = (wS + wE) * 0.5;
        if (cellW < spacingPx * 1.5 || spacingPx <= 0) return '';
        var nLines = Math.floor(cellW / spacingPx) - 1;
        if (nLines < 1) return '';
        var startOff = (cellW - (nLines - 1) * spacingPx) / 2;
        var N = 8;
        var mIn  = Math.hypot(quad[3].x-quad[0].x, quad[3].y-quad[0].y) * 0.35;
        var mOut = Math.hypot(quad[2].x-quad[1].x, quad[2].y-quad[1].y) * 0.35;
        var d = '', lx, ly;
        for (var k = 0; k < nLines; k++) {
            var alpha = (startOff + k * spacingPx) / cellW;
            var fwd = (k % 2 === 0);
            var firstPt = true;
            for (var s = 0; s <= N; s++) {
                var u = fwd ? s/N : 1-s/N;
                var u2=u*u, u3=u2*u;
                var h00=2*u3-3*u2+1, h10=u3-2*u2+u, h01=-2*u3+3*u2, h11=u3-u2;
                var inX=h00*quad[0].x+h10*tx*mIn+h01*quad[3].x+h11*tx*mIn;
                var inY=h00*quad[0].y+h10*ty*mIn+h01*quad[3].y+h11*ty*mIn;
                var outX=h00*quad[1].x+h10*tx*mOut+h01*quad[2].x+h11*tx*mOut;
                var outY=h00*quad[1].y+h10*ty*mOut+h01*quad[2].y+h11*ty*mOut;
                var px=(1-alpha)*inX+alpha*outX, py=(1-alpha)*inY+alpha*outY;
                if (firstPt) {
                    d += (!d || Math.hypot(px-lx, py-ly) < EPS) ? (d ? '' : 'M'+fmt(px)+' '+fmt(py)) : ' M'+fmt(px)+' '+fmt(py);
                    if (!d) d = 'M'+fmt(px)+' '+fmt(py);
                    firstPt = false;
                } else {
                    d += ' L'+fmt(px)+' '+fmt(py);
                }
                lx = px; ly = py;
            }
        }
        return d;
    }

    // SVG with clip-outline support: bilinear Hermite sampling + polygon clipping.
    function clippedContourFlowPaths(quad, tangAngRad, spacingPx, clipOutlines, margin, dims) {
        var N = 8;
        var tx = Math.cos(tangAngRad), ty = Math.sin(tangAngRad);
        var wS = Math.hypot(quad[1].x-quad[0].x, quad[1].y-quad[0].y);
        var wE = Math.hypot(quad[2].x-quad[3].x, quad[2].y-quad[3].y);
        var cellW = (wS + wE) * 0.5;
        if (cellW < spacingPx * 1.5 || spacingPx <= 0) return [];
        var nLines = Math.floor(cellW / spacingPx) - 1;
        if (nLines < 1) return [];
        var startOff = (cellW - (nLines - 1) * spacingPx) / 2;
        var mIn  = Math.hypot(quad[3].x-quad[0].x, quad[3].y-quad[0].y) * 0.35;
        var mOut = Math.hypot(quad[2].x-quad[1].x, quad[2].y-quad[1].y) * 0.35;
        var allSegs = [];
        for (var k = 0; k < nLines; k++) {
            var alpha = (startOff + k * spacingPx) / cellW;
            var fwd = (k % 2 === 0);
            var prev = null;
            for (var s = 0; s <= N; s++) {
                var u = fwd ? s/N : 1-s/N;
                var u2=u*u, u3=u2*u;
                var h00=2*u3-3*u2+1, h10=u3-2*u2+u, h01=-2*u3+3*u2, h11=u3-u2;
                var inX=h00*quad[0].x+h10*tx*mIn+h01*quad[3].x+h11*tx*mIn;
                var inY=h00*quad[0].y+h10*ty*mIn+h01*quad[3].y+h11*ty*mIn;
                var outX=h00*quad[1].x+h10*tx*mOut+h01*quad[2].x+h11*tx*mOut;
                var outY=h00*quad[1].y+h10*ty*mOut+h01*quad[2].y+h11*ty*mOut;
                var cur = {x:(1-alpha)*inX+alpha*outX, y:(1-alpha)*inY+alpha*outY};
                if (prev) allSegs.push({x1:prev.x, y1:prev.y, x2:cur.x, y2:cur.y});
                prev = cur;
            }
        }
        var clipped = [];
        allSegs.forEach(function(ln) {
            var segs = [{x1:ln.x1,y1:ln.y1,x2:ln.x2,y2:ln.y2}];
            clipOutlines.forEach(function(outline) {
                var next = [];
                segs.forEach(function(seg) {
                    Array.prototype.push.apply(next, clipLineOutsidePoly(seg.x1,seg.y1,seg.x2,seg.y2,outline));
                });
                segs = next;
            });
            segs.forEach(function(seg) {
                var cs = clipLineToRect(seg.x1,seg.y1,seg.x2,seg.y2, margin,margin, dims.width-2*margin,dims.height-2*margin);
                if (cs) clipped.push(cs);
            });
        });
        if (!clipped.length) return [];
        var paths = [];
        var d = 'M'+fmt(clipped[0].x1)+' '+fmt(clipped[0].y1)+' L'+fmt(clipped[0].x2)+' '+fmt(clipped[0].y2);
        var lx = clipped[0].x2, ly = clipped[0].y2;
        for (var i = 1; i < clipped.length; i++) {
            var seg = clipped[i];
            if (Math.hypot(seg.x1-lx, seg.y1-ly) < EPS) {
                d += ' L'+fmt(seg.x2)+' '+fmt(seg.y2);
            } else {
                paths.push(d);
                d = 'M'+fmt(seg.x1)+' '+fmt(seg.y1)+' L'+fmt(seg.x2)+' '+fmt(seg.y2);
            }
            lx = seg.x2; ly = seg.y2;
        }
        paths.push(d);
        return paths;
    }

    // ── Flow-quad tessellation ────────────────────────────────────────────────

    // Subdivide the long (flow-direction) edges of a whirl cell quad into a
    // curved polygon using Hermite splines, making fills follow the flow curve.
    // quad = [inner-start, outer-start, outer-end, inner-end]
    // tangAngRad = flow tangent angle (radians) at the cell
    // spacingPx  = subdivision spacing in pixels (e.g. paper.DPI/25.4 for 1 mm)
    // Like tessellateFlowQuad but uses different tangents at start (tang0) and end (tang1)
    // so the along-path edges actually curve where the path bends.
    function tessellateFlowQuadV2(quad, tang0, tang1, spacingPx) {
        var tx0 = Math.cos(tang0), ty0 = Math.sin(tang0);
        var tx1 = Math.cos(tang1), ty1 = Math.sin(tang1);
        var outerLen = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
        var N = Math.max(2, Math.ceil(outerLen / spacingPx));
        function hermitePts(p0, p1, t0x, t0y, t1x, t1y) {
            var pts = [], m = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.35;
            for (var i = 1; i <= N; i++) {
                var t = i / N, t2 = t * t, t3 = t2 * t;
                pts.push({
                    x: (2*t3-3*t2+1)*p0.x + (t3-2*t2+t)*t0x*m + (-2*t3+3*t2)*p1.x + (t3-t2)*t1x*m,
                    y: (2*t3-3*t2+1)*p0.y + (t3-2*t2+t)*t0y*m + (-2*t3+3*t2)*p1.y + (t3-t2)*t1y*m
                });
            }
            return pts;
        }
        var pts = [quad[0], quad[1]];
        // outer edge: quad[1] -> quad[2], tangent changes from tang0 to tang1
        hermitePts(quad[1], quad[2],  tx0,  ty0,  tx1,  ty1).forEach(function(p) { pts.push(p); });
        pts.push(quad[3]);
        // inner edge traversed backward: quad[3] -> quad[0], tangent reversed
        hermitePts(quad[3], quad[0], -tx1, -ty1, -tx0, -ty0).forEach(function(p) { pts.push(p); });
        return pts;
    }

    function tessellateFlowQuad(quad, tangAngRad, spacingPx) {
        var tx = Math.cos(tangAngRad), ty = Math.sin(tangAngRad);
        var outerLen = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
        var N = Math.max(2, Math.ceil(outerLen / spacingPx));
        function hermitePts(p0, p1, t0x, t0y, t1x, t1y) {
            var pts = [], m = Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.35;
            for (var i = 1; i <= N; i++) {
                var t = i / N, t2 = t * t, t3 = t2 * t;
                pts.push({
                    x: (2*t3-3*t2+1)*p0.x + (t3-2*t2+t)*t0x*m + (-2*t3+3*t2)*p1.x + (t3-t2)*t1x*m,
                    y: (2*t3-3*t2+1)*p0.y + (t3-2*t2+t)*t0y*m + (-2*t3+3*t2)*p1.y + (t3-t2)*t1y*m
                });
            }
            return pts;
        }
        var pts = [quad[0], quad[1]];
        hermitePts(quad[1], quad[2],  tx,  ty,  tx,  ty).forEach(function(p) { pts.push(p); });
        pts.push(quad[3]);
        hermitePts(quad[3], quad[0], -tx, -ty, -tx, -ty).forEach(function(p) { pts.push(p); });
        return pts;
    }

    // ── Continuous path builders ──────────────────────────────────────────────

    // Build a single SVG path D string from rows (straight hatch).
    function connectedPathD(rows) {
        if (!rows.length) return '';
        var d = '', lx = NaN, ly = NaN;

        function moveTo(x, y) {
            if (!isNaN(lx) && Math.hypot(x - lx, y - ly) < EPS) {
                d += ' L' + fmt(x) + ' ' + fmt(y);
            } else {
                d += (d ? ' M' : 'M') + fmt(x) + ' ' + fmt(y);
            }
            lx = x; ly = y;
        }
        function lineTo(x, y) {
            d += ' L' + fmt(x) + ' ' + fmt(y);
            lx = x; ly = y;
        }

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i], fwd = (i % 2 === 0);
            if (fwd) {
                for (var j = 0; j < row.length; j++) {
                    moveTo(row[j].x1, row[j].y1);
                    lineTo(row[j].x2, row[j].y2);
                }
            } else {
                for (var j = row.length - 1; j >= 0; j--) {
                    moveTo(row[j].x2, row[j].y2);
                    lineTo(row[j].x1, row[j].y1);
                }
            }
        }
        return d;
    }

    // Wave: point-by-point traversal with inside-poly check; alternating row direction.
    function waveConnectedPathD(poly, angleDeg, spacing, phase) {
        if (!poly.length || spacing <= 0) return '';
        var ang = angleDeg * Math.PI / 180;
        var dir = { x: Math.cos(ang), y: Math.sin(ang) };
        var nrm = { x: -Math.sin(ang), y: Math.cos(ang) };
        var pMin = Infinity, pMax = -Infinity, tMin = Infinity, tMax = -Infinity;
        poly.forEach(function (pt) {
            var pv = nrm.x * pt.x + nrm.y * pt.y, tv = dir.x * pt.x + dir.y * pt.y;
            if (pv < pMin) pMin = pv; if (pv > pMax) pMax = pv;
            if (tv < tMin) tMin = tv; if (tv > tMax) tMax = tv;
        });
        var amp = spacing * 0.55, freq = 2 * Math.PI / (spacing * 3.5);
        var parts = [], pd = false, ki = 0;
        for (var k = Math.floor(pMin / spacing); k * spacing <= pMax; k++, ki++) {
            var samples = Math.max(10, Math.min(48, Math.ceil((tMax - tMin) / (spacing * 0.85))));
            var rowFwd = [];
            for (var s = 0; s <= samples; s++) {
                var tv2 = tMin + (tMax - tMin) * s / samples;
                var off = amp * Math.sin(freq * tv2 + phase + k * 1.3);
                rowFwd.push({ x: (k * spacing + off) * nrm.x + tv2 * dir.x,
                               y: (k * spacing + off) * nrm.y + tv2 * dir.y });
            }
            var pts = (ki % 2 === 0) ? rowFwd : rowFwd.slice().reverse();
            for (var j = 0; j < pts.length; j++) {
                if (pointInPoly(pts[j], poly)) {
                    parts.push((pd ? 'L' : 'M') + fmt(pts[j].x) + ' ' + fmt(pts[j].y));
                    pd = true;
                } else { pd = false; }
            }
        }
        return parts.join(' ');
    }

    // Zigzag: point-by-point with midpoint inside-poly check; alternating row direction.
    function zigzagConnectedPathD(poly, angleDeg, spacing, phase) {
        if (!poly.length || spacing <= 0) return '';
        var ang = angleDeg * Math.PI / 180;
        var dir = { x: Math.cos(ang), y: Math.sin(ang) };
        var nrm = { x: -Math.sin(ang), y: Math.cos(ang) };
        var pMin = Infinity, pMax = -Infinity, tMin = Infinity, tMax = -Infinity;
        poly.forEach(function (pt) {
            var pv = nrm.x * pt.x + nrm.y * pt.y, tv = dir.x * pt.x + dir.y * pt.y;
            if (pv < pMin) pMin = pv; if (pv > pMax) pMax = pv;
            if (tv < tMin) tMin = tv; if (tv > tMax) tMax = tv;
        });
        var zig = Math.max(spacing * 1.4, 7), amp = spacing * 0.52;
        var parts = [], pd = false, ki = 0;
        for (var k = Math.floor(pMin / spacing); k * spacing <= pMax; k++, ki++) {
            var steps = Math.max(8, Math.min(80, Math.ceil((tMax - tMin) / zig)));
            var rowFwd = [];
            for (var s = 0; s <= steps; s++) {
                var tv2 = tMin + (tMax - tMin) * s / steps;
                var side = ((s + k) % 2 === 0 ? -1 : 1);
                var off = side * amp + Math.sin(phase + s * 1.7 + k) * amp * 0.16;
                rowFwd.push({ x: (k * spacing + off) * nrm.x + tv2 * dir.x,
                               y: (k * spacing + off) * nrm.y + tv2 * dir.y });
            }
            var pts = (ki % 2 === 0) ? rowFwd : rowFwd.slice().reverse();
            for (var j = 0; j + 1 < pts.length; j++) {
                var mid = { x: (pts[j].x + pts[j + 1].x) / 2, y: (pts[j].y + pts[j + 1].y) / 2 };
                if (pointInPoly(mid, poly)) {
                    if (!pd) { parts.push('M' + fmt(pts[j].x) + ' ' + fmt(pts[j].y)); pd = true; }
                    parts.push('L' + fmt(pts[j + 1].x) + ' ' + fmt(pts[j + 1].y));
                } else { pd = false; }
            }
        }
        return parts.join(' ');
    }

    // ── Squiggle hatch (broken streak pieces with S-curve connectors) ─────────

    // Generate per-row arrays of squiggle pieces (broken segments with wobble).
    function squiggleRows(baseRows, spacing, phase, wobble) {
        var gi = 0;
        return baseRows.map(function(row) {
            var pieces = [];
            row.forEach(function(ln) {
                var dx = ln.x2-ln.x1, dy = ln.y2-ln.y1, len = Math.sqrt(dx*dx+dy*dy);
                if (len < 1) { gi++; return; }
                var nx = -dy/len, ny = dx/len;
                var numP = Math.max(2, Math.min(7, Math.floor(len / (spacing * 2.4))));
                for (var j = 0; j < numP; j++) {
                    var a = j/numP, b = Math.min(1, a + 0.55 + 0.22*Math.sin(phase+gi*1.7+j));
                    var gap = 0.12 + 0.08*Math.sin(phase+gi*2.1+j*3.3);
                    a = Math.min(0.96, a+gap); b = Math.max(a+0.02, b-gap);
                    pieces.push({
                        x1: ln.x1+dx*a+nx*wobble*Math.sin(phase+gi*.91+j*2.4),
                        y1: ln.y1+dy*a+ny*wobble*Math.sin(phase+gi*.91+j*2.4),
                        x2: ln.x1+dx*b+nx*wobble*Math.sin(phase+gi*1.23+j*2.9+1.7),
                        y2: ln.y1+dy*b+ny*wobble*Math.sin(phase+gi*1.23+j*2.9+1.7)
                    });
                }
                gi++;
            });
            return pieces;
        }).filter(function(r) { return r.length > 0; });
    }

    // SVG path D connecting squiggle rows with S-curve cubic beziers between pieces.
    function squiggleConnectedPathD(rows) {
        if (!rows.length) return '';
        var d = '', lx = NaN, ly = NaN;
        function sCurveTo(x, y) {
            if (isNaN(lx)) {
                d += (d ? ' M' : 'M') + fmt(x) + ' ' + fmt(y);
            } else if (Math.hypot(x-lx, y-ly) < EPS) {
                d += ' L' + fmt(x) + ' ' + fmt(y);
            } else {
                var mdx=x-lx, mdy=y-ly, mlen=Math.max(Math.hypot(mdx,mdy), 0.001);
                var mnx=-mdy/mlen, mny=mdx/mlen, amp=Math.min(mlen*0.3, 8);
                d += ' C'+fmt(lx+mdx*.33+mnx*amp)+' '+fmt(ly+mdy*.33+mny*amp)+
                     ' '+fmt(lx+mdx*.67-mnx*amp)+' '+fmt(ly+mdy*.67-mny*amp)+
                     ' '+fmt(x)+' '+fmt(y);
            }
            lx=x; ly=y;
        }
        function lineTo(x, y) { d += ' L'+fmt(x)+' '+fmt(y); lx=x; ly=y; }
        for (var i = 0; i < rows.length; i++) {
            var row=rows[i], fwd=(i%2===0);
            if (fwd) { for (var j=0; j<row.length; j++) { sCurveTo(row[j].x1,row[j].y1); lineTo(row[j].x2,row[j].y2); } }
            else     { for (var j=row.length-1; j>=0; j--) { sCurveTo(row[j].x2,row[j].y2); lineTo(row[j].x1,row[j].y1); } }
            if (!isNaN(lx) && i+1<rows.length && rows[i+1].length) {
                var nr=rows[i+1];
                sCurveTo(fwd ? nr[nr.length-1].x2 : nr[0].x1, fwd ? nr[nr.length-1].y2 : nr[0].y1);
            }
        }
        return d;
    }

    // Canvas: draw squiggle rows with S-curve cubic beziers between pieces.
    function drawSquiggle(ctx, rows) {
        if (_penLift) { drawSquiggleSeparate(ctx, rows); return; }
        if (!rows.length) return;
        var lx = NaN, ly = NaN;
        ctx.beginPath();
        function sCurveTo(x, y) {
            if (isNaN(lx)) { ctx.moveTo(x, y); }
            else if (Math.hypot(x-lx, y-ly) < EPS) { ctx.lineTo(x, y); }
            else {
                var mdx=x-lx, mdy=y-ly, mlen=Math.max(Math.hypot(mdx,mdy), 0.001);
                var mnx=-mdy/mlen, mny=mdx/mlen, amp=Math.min(mlen*0.3, 8);
                ctx.bezierCurveTo(lx+mdx*.33+mnx*amp, ly+mdy*.33+mny*amp,
                                  lx+mdx*.67-mnx*amp, ly+mdy*.67-mny*amp, x, y);
            }
            lx=x; ly=y;
        }
        for (var i=0; i<rows.length; i++) {
            var row=rows[i], fwd=(i%2===0);
            if (fwd) { for (var j=0; j<row.length; j++) { sCurveTo(row[j].x1,row[j].y1); ctx.lineTo(row[j].x2,row[j].y2); lx=row[j].x2; ly=row[j].y2; } }
            else     { for (var j=row.length-1; j>=0; j--) { sCurveTo(row[j].x2,row[j].y2); ctx.lineTo(row[j].x1,row[j].y1); lx=row[j].x1; ly=row[j].y1; } }
            if (!isNaN(lx) && i+1<rows.length && rows[i+1].length) {
                var nr=rows[i+1];
                sCurveTo(fwd ? nr[nr.length-1].x2 : nr[0].x1, fwd ? nr[nr.length-1].y2 : nr[0].y1);
            }
        }
        ctx.stroke();
    }

    // ── Straight hatch connected draw ─────────────────────────────────────────

    // Per-row squiggle — each row drawn as its own stroke (pen lifts between rows).
    function drawSquiggleSeparate(ctx, rows) {
        var lx = NaN, ly = NaN;
        function sCurveTo(x, y) {
            if (isNaN(lx)) { ctx.moveTo(x, y); }
            else if (Math.hypot(x-lx, y-ly) < EPS) { ctx.lineTo(x, y); }
            else {
                var mdx=x-lx, mdy=y-ly, mlen=Math.max(Math.hypot(mdx,mdy), 0.001);
                var mnx=-mdy/mlen, mny=mdx/mlen, amp=Math.min(mlen*0.3, 8);
                ctx.bezierCurveTo(lx+mdx*.33+mnx*amp, ly+mdy*.33+mny*amp,
                                  lx+mdx*.67-mnx*amp, ly+mdy*.67-mny*amp, x, y);
            }
            lx=x; ly=y;
        }
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (!row.length) continue;
            lx = NaN; ly = NaN;
            ctx.beginPath();
            for (var j = 0; j < row.length; j++) {
                sCurveTo(row[j].x1, row[j].y1);
                ctx.lineTo(row[j].x2, row[j].y2);
                lx = row[j].x2; ly = row[j].y2;
            }
            ctx.stroke();
        }
    }

    // Draw connected rows directly to a canvas 2D context.
    function drawConnectedRows(ctx, rows) {
        if (_penLift) { drawSeparateRows(ctx, rows); return; }
        if (!rows.length) return;
        var lx = NaN, ly = NaN;
        ctx.beginPath();
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i], fwd = (i % 2 === 0);
            if (fwd) {
                for (var j = 0; j < row.length; j++) {
                    if (!isNaN(lx) && Math.hypot(row[j].x1 - lx, row[j].y1 - ly) < EPS) {
                        ctx.lineTo(row[j].x1, row[j].y1);
                    } else {
                        ctx.moveTo(row[j].x1, row[j].y1);
                    }
                    ctx.lineTo(row[j].x2, row[j].y2);
                    lx = row[j].x2; ly = row[j].y2;
                }
            } else {
                for (var j = row.length - 1; j >= 0; j--) {
                    if (!isNaN(lx) && Math.hypot(row[j].x2 - lx, row[j].y2 - ly) < EPS) {
                        ctx.lineTo(row[j].x2, row[j].y2);
                    } else {
                        ctx.moveTo(row[j].x2, row[j].y2);
                    }
                    ctx.lineTo(row[j].x1, row[j].y1);
                    lx = row[j].x1; ly = row[j].y1;
                }
            }
            if (!isNaN(lx) && i + 1 < rows.length && rows[i + 1].length) {
                var nr = rows[i + 1];
                var tx = fwd ? nr[nr.length - 1].x2 : nr[0].x1;
                var ty = fwd ? nr[nr.length - 1].y2 : nr[0].y1;
                ctx.lineTo(tx, ty);
                lx = tx; ly = ty;
            }
        }
        ctx.stroke();
    }

    // Per-row separate strokes — each row is its own beginPath/stroke (pen lifts between rows).
    function drawSeparateRows(ctx, rows) {
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (!row.length) continue;
            var lx = NaN, ly = NaN;
            ctx.beginPath();
            for (var j = 0; j < row.length; j++) {
                if (!isNaN(lx) && Math.hypot(row[j].x1 - lx, row[j].y1 - ly) < EPS) {
                    ctx.lineTo(row[j].x1, row[j].y1);
                } else {
                    ctx.moveTo(row[j].x1, row[j].y1);
                }
                ctx.lineTo(row[j].x2, row[j].y2);
                lx = row[j].x2; ly = row[j].y2;
            }
            ctx.stroke();
        }
    }

    // Build connected path D strings with polygon/rect clipping (for whirls overlap-erase).
    function clippedConnectedPaths(rows, clipOutlines, margin, dims) {
        if (!rows.length) return [];
        var ordered = [];
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i], fwd = (i % 2 === 0);
            if (fwd) {
                for (var j = 0; j < row.length; j++) ordered.push(row[j]);
            } else {
                for (var j = row.length - 1; j >= 0; j--)
                    ordered.push({ x1: row[j].x2, y1: row[j].y2, x2: row[j].x1, y2: row[j].y1 });
            }
            if (i + 1 < rows.length && rows[i + 1].length) {
                var nr = rows[i + 1], fx, fy, tx, ty;
                if (fwd) {
                    fx = row[row.length - 1].x2; fy = row[row.length - 1].y2;
                    tx = nr[nr.length - 1].x2;   ty = nr[nr.length - 1].y2;
                } else {
                    fx = row[0].x1; fy = row[0].y1;
                    tx = nr[0].x1;  ty = nr[0].y1;
                }
                ordered.push({ x1: fx, y1: fy, x2: tx, y2: ty });
            }
        }
        var clipped = [];
        ordered.forEach(function (ln) {
            var segs = [{ x1: ln.x1, y1: ln.y1, x2: ln.x2, y2: ln.y2 }];
            clipOutlines.forEach(function (outline) {
                var next = [];
                segs.forEach(function (seg) {
                    Array.prototype.push.apply(next, clipLineOutsidePoly(seg.x1, seg.y1, seg.x2, seg.y2, outline));
                });
                segs = next;
            });
            segs.forEach(function (seg) {
                var cs = clipLineToRect(seg.x1, seg.y1, seg.x2, seg.y2,
                                        margin, margin, dims.width - 2 * margin, dims.height - 2 * margin);
                if (cs) clipped.push(cs);
            });
        });
        if (!clipped.length) return [];
        var paths = [];
        var d = 'M' + fmt(clipped[0].x1) + ' ' + fmt(clipped[0].y1) + ' L' + fmt(clipped[0].x2) + ' ' + fmt(clipped[0].y2);
        var lx = clipped[0].x2, ly = clipped[0].y2;
        for (var i = 1; i < clipped.length; i++) {
            var seg = clipped[i];
            if (Math.hypot(seg.x1 - lx, seg.y1 - ly) < EPS) {
                d += ' L' + fmt(seg.x2) + ' ' + fmt(seg.y2);
            } else {
                paths.push(d);
                d = 'M' + fmt(seg.x1) + ' ' + fmt(seg.y1) + ' L' + fmt(seg.x2) + ' ' + fmt(seg.y2);
            }
            lx = seg.x2; ly = seg.y2;
        }
        paths.push(d);
        return paths;
    }

    // Labeled fill styles for sketch param dropdowns.
    var FILL_STYLE_OPTIONS = [
        { value: 'contour',      label: 'Contour' },
        { value: 'hatch',        label: 'Hatch' },
        { value: 'sketchHatch',  label: 'Chaotic hatch' },
        { value: 'squiggleHatch',label: 'Squiggle' },
        { value: 'zigzagHatch',  label: 'Zigzag' },
        { value: 'crosshatch',   label: 'Crosshatch' },
        { value: 'waves',        label: 'Waves' },
        { value: 'sprigFill',    label: 'Scatter sprig' },
        { value: 'ribbonFill',   label: 'Scatter ribbon' },
        { value: 'crossFill',    label: 'Scatter cross' },
        { value: 'asteriskFill', label: 'Scatter asterisk' }
    ];

    function _segsToD(segs) {
        var d = '';
        for (var i = 0; i < segs.length; i++) { var sg = segs[i]; d += 'M' + fmt(sg.x1) + ' ' + fmt(sg.y1) + 'L' + fmt(sg.x2) + ' ' + fmt(sg.y2); }
        return d;
    }

    // Fill a polygon with ONE style chosen (by seed) from a list of allowed
    // styles — for sketches that let several fills be toggled on at once.
    function fillPolyMultiD(poly, styles, angleDeg, spacing, seed) {
        var arr = Array.isArray(styles) ? styles : (styles ? [styles] : []);
        arr = arr.filter(function (x) { return x && x !== 'none' && x !== 'plain'; });
        if (!arr.length) return [];
        var idx = Math.abs(seed || 0) % arr.length;
        return fillPolyD(poly, arr[idx], angleDeg, spacing, seed);
    }

    // Fill one polygon with any shared style. Returns an array of SVG path-d
    // strings (crosshatch/cross styles return two). Honors global Stroke
    // imperfection. 'none' returns []. style defaults to 'hatch'.
    function fillPolyD(poly, style, angleDeg, spacing, seed) {
        if (!poly || poly.length < 3 || !(spacing > 0)) return [];
        var imp = getFillImperfection();
        var ph = ((seed || 0) % 1000) * 0.013;
        var out = [];
        function pushRows(rows) { var d = connectedPathD(rows); if (d) out.push(d); }
        if (style === 'none') return [];
        if (style === 'contour') { var dc = contourConnectedPathD(contourPolyRows(poly, spacing)); if (dc) out.push(dc); }
        else if (style === 'waves') { var dw = waveConnectedPathD(poly, angleDeg, spacing, ph); if (dw) out.push(dw); }
        else if (style === 'zigzagHatch') { pushRows(zigzagPolyRows(poly, angleDeg, spacing, ph)); }
        else if (style === 'squiggleHatch') { pushRows(squiggleRows(hatchPolyRows(poly, angleDeg, spacing), spacing * 0.8, ph, spacing * (0.4 + imp))); }
        else if (style === 'crosshatch') {
            var r1 = hatchPolyRows(poly, angleDeg, spacing);
            if (imp > 0) r1 = sketchHatchRows(r1, ph, spacing * imp * 0.6);
            pushRows(r1);
            pushRows(hatchPolyRows(poly, angleDeg + 90, spacing));
        }
        else if (style === 'sketchHatch') { pushRows(sketchHatchRows(hatchPolyRows(poly, angleDeg, spacing), ph, spacing * (0.6 + imp * 1.4))); }
        else if (style === 'sprigFill' || style === 'ribbonFill' || style === 'crossFill' || style === 'asteriskFill') {
            var dsc = _segsToD(scatterPolyFill(poly, style.replace('Fill', ''), spacing * 1.4, 1.0, (seed || 1) >>> 0)); if (dsc) out.push(dsc);
        }
        else {
            var hr = hatchPolyRows(poly, angleDeg, spacing);
            if (imp > 0) hr = sketchHatchRows(hr, ph, spacing * imp * 0.6);
            pushRows(hr);
        }
        return out.filter(Boolean);
    }

    return {
        fmt:                    fmt,
        segIntersectT:          segIntersectT,
        pointInPoly:            pointInPoly,
        clipLineOutsidePoly:    clipLineOutsidePoly,
        clipLineToRect:         clipLineToRect,
        hatchPolyRows:          hatchPolyRows,
        sketchHatchRows:        sketchHatchRows,
        zigzagPolyRows:         zigzagPolyRows,
        insetPoly:              insetPoly,
        contourPolyRows:        contourPolyRows,
        contourConnectedPathD:  contourConnectedPathD,
        drawContourRows:        drawContourRows,
        drawContourFlow:        drawContourFlow,
        contourFlowPathD:       contourFlowPathD,
        clippedContourFlowPaths: clippedContourFlowPaths,
        tessellateFlowQuad:     tessellateFlowQuad,
        tessellateFlowQuadV2:   tessellateFlowQuadV2,
        squiggleRows:           squiggleRows,
        squiggleConnectedPathD: squiggleConnectedPathD,
        setPenLift:             setPenLift,
        isPenLift:              isPenLift,
        setScatterStyles:       setScatterStyles,
        getScatterStyles:       getScatterStyles,
        setFillAngle:           setFillAngle,
        getFillAngle:           getFillAngle,
        setFillImperfection:    setFillImperfection,
        getFillImperfection:    getFillImperfection,
        setFillDensity:         setFillDensity,
        getFillDensity:         getFillDensity,
        getEffectiveDensity:    getEffectiveDensity,
        setFillProb:            setFillProb,
        getFillProb:            getFillProb,
        scatterPolyFill:        scatterPolyFill,
        drawSquiggle:           drawSquiggle,
        drawSquiggleSeparate:   drawSquiggleSeparate,
        connectedPathD:         connectedPathD,
        fillPolyD:              fillPolyD,
        fillPolyMultiD:         fillPolyMultiD,
        FILL_STYLE_OPTIONS:     FILL_STYLE_OPTIONS,
        drawConnectedRows:      drawConnectedRows,
        drawSeparateRows:       drawSeparateRows,
        waveConnectedPathD:     waveConnectedPathD,
        zigzagConnectedPathD:   zigzagConnectedPathD,
        clippedConnectedPaths:  clippedConnectedPaths
    };
})();
