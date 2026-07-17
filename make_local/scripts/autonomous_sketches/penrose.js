/**
 * penrose — aperiodic P3 rhombus tiling (parametric)
 *
 * True Penrose tiling via Robinson-triangle deflation: a wheel of 10 golden
 * ("red"/thin) triangles around the origin is recursively subdivided using
 * the classic substitution rule (each red triangle -> 1 red + 1 blue; each
 * blue triangle -> 2 blue + 1 red, new vertices placed at 1/phi along each
 * edge). After N generations every triangle is half of a rhombus (thin
 * 36 deg or thick 72 deg); the shared internal diagonal is never drawn, so
 * the result reads as the genuine non-repeating rhombus tiling, not an
 * approximation. Whole-wheel rotation and window position vary with the
 * seed so every render samples a different crop of the same infinite
 * pattern. Rhombi can be outlined only, or plotFills-filled per triangle;
 * an optional per-triangle inset breaks each rhombus into its two visible
 * half-triangles for a "shattered glass" variant of the same lattice.
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    var PHI = (1 + Math.sqrt(5)) / 2;

    function vAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
    function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
    function vScale(a, t) { return { x: a.x * t, y: a.y * t }; }
    function lerp(a, b, t) { return vAdd(a, vScale(vSub(b, a), t)); }

    // Robinson-triangle deflation. Triangle = [color, A, B, C]; color 0 = red
    // (thin-rhombus half), color 1 = blue (thick-rhombus half). A is always
    // the vertex the substitution measures new points from.
    function subdivide(triangles) {
        var result = [];
        for (var i = 0; i < triangles.length; i++) {
            var t = triangles[i], color = t[0], A = t[1], B = t[2], C = t[3];
            if (color === 0) {
                var P = lerp(A, B, 1 / PHI);
                result.push([0, C, P, B]);
                result.push([1, P, C, A]);
            } else {
                var Q = lerp(B, A, 1 / PHI);
                var R = lerp(B, C, 1 / PHI);
                result.push([1, R, C, A]);
                result.push([1, Q, R, B]);
                result.push([0, R, Q, A]);
            }
        }
        return result;
    }

    // Sutherland-Hodgman clip of convex polygon to half-plane {p : p.n <= c}.
    function clipHalfPlane(poly, nx, ny, c) {
        if (poly.length === 0) return poly;
        var out = [];
        for (var i = 0; i < poly.length; i++) {
            var cur = poly[i], nxt = poly[(i + 1) % poly.length];
            var curSide = cur.x * nx + cur.y * ny - c;
            var nxtSide = nxt.x * nx + nxt.y * ny - c;
            if (curSide <= 0) out.push(cur);
            if ((curSide <= 0) !== (nxtSide <= 0)) {
                var t = curSide / (curSide - nxtSide);
                out.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) });
            }
        }
        return out;
    }

    // Smooth multi-stop interpolation across a palette (used for byAngle/
    // byRadius so bands blend instead of hard-cutting into flat wedges).
    function hexToRgb(hex) {
        var h = hex.replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    function rgbToHex(r, g, b) {
        function c(v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }
        return '#' + c(r) + c(g) + c(b);
    }
    function paletteBlend(palette, frac) {
        if (palette.length === 1) return palette[0];
        var f = Math.max(0, Math.min(0.9999, frac)) * (palette.length - 1);
        var i0 = Math.floor(f), t = f - i0;
        var c0 = hexToRgb(palette[i0]), c1 = hexToRgb(palette[i0 + 1]);
        return rgbToHex(c0.r + (c1.r - c0.r) * t, c0.g + (c1.g - c0.g) * t, c0.b + (c1.b - c0.b) * t);
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: '#c9a227', label: 'Gold' },  { value: '#8b4513', label: 'Brown' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        classic: {
            subdivisions: 6, fillStyle: 'none', strokeOutline: 'yes', cellInset: 1.0,
            colorMode: 'byType', palette: ['#1a1a1a', '#8b4513'], bgColor: '#f5f0e8'
        },
        goldleaf: {
            subdivisions: 6, fillStyle: 'hatch', strokeOutline: 'yes', cellInset: 1.0,
            colorMode: 'byType', palette: ['#c9a227', '#1c2a4a'], bgColor: '#f7ecd0'
        },
        shattered: {
            subdivisions: 5, fillStyle: 'crosshatch', strokeOutline: 'yes', cellInset: 0.8,
            colorMode: 'byRadius', palette: ['#e63946', '#ff9800', '#9c27b0', '#2196f3'], bgColor: '#101018'
        },
        blueprint: {
            subdivisions: 7, fillStyle: 'none', strokeOutline: 'yes', cellInset: 1.0,
            colorMode: 'mono', palette: ['#bcd4ee'], bgColor: '#0e2038'
        },
        sunburst: {
            subdivisions: 6, fillStyle: 'hatch', strokeOutline: 'yes', cellInset: 1.0,
            colorMode: 'byAngle',
            palette: ['#e63946', '#ff4500', '#ff8c00', '#ffd700', '#c9a227', '#ff8c00', '#ff4500', '#e63946'],
            bgColor: '#1a1008'
        }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a', '#8b4513'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'colorMode', label: 'Color by', type: 'select', value: 'byType', group: 'color',
          options: [{ value: 'byType', label: 'Rhombus type' }, { value: 'byRadius', label: 'Distance from center' },
                    { value: 'byAngle', label: 'Angle (sunburst)' }, { value: 'mono', label: 'Single ink' }] },
        { id: 'subdivisions', label: 'Detail (deflations)', type: 'range', min: 3, max: 7, step: 1, value: 6, group: 'general' },
        { id: 'fillStyle', label: 'Fill style', type: 'select', value: 'none', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) },
        { id: 'strokeOutline', label: 'Tile edges', type: 'select', value: 'yes', group: 'general',
          options: [{ value: 'yes', label: 'On' }, { value: 'no', label: 'Off' }] },
        { id: 'cellInset', label: 'Facet gap', type: 'range', min: 0.5, max: 1.0, step: 0.01, value: 1.0, group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function generate(seed, opts) {
        var P = buildDefaults();
        if (typeof opts === 'string') {
            if (PRESETS[opts]) for (var k in PRESETS[opts]) P[k] = PRESETS[opts][k];
        } else if (opts && typeof opts === 'object') {
            for (var k2 in opts) if (opts.hasOwnProperty(k2)) P[k2] = opts[k2];
        }

        var rng = makeRng(seed);
        var dims = paper.getPaperPixels(P.paperSize || '9x12');
        var W = dims.width, H = dims.height;
        var mp = paper.getMarginPixels(parseFloat(P.margin || 0.75));
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#f5f0e8';

        var ox = mp, oy = mp, dW = W - 2 * mp, dH = H - 2 * mp;
        // Jitter the window into the (conceptually infinite) tiling per seed
        // so different seeds crop visibly different regions of the lattice.
        var cx0 = ox + dW / 2 + (rng() - 0.5) * dW * 0.16;
        var cy0 = oy + dH / 2 + (rng() - 0.5) * dH * 0.16;
        var halfDiag = Math.hypot(dW, dH) / 2;

        // Whole-wheel rotation (0-36deg) — Penrose has 10-fold symmetry, so
        // this genuinely changes which sub-lattice boundaries fall where,
        // not just a cosmetic spin.
        var rot = rng() * (Math.PI / 5);

        var triangles = [];
        for (var i0 = 0; i0 < 10; i0++) {
            var b = { x: Math.cos((2 * i0 - 1) * Math.PI / 10 + rot), y: Math.sin((2 * i0 - 1) * Math.PI / 10 + rot) };
            var c = { x: Math.cos((2 * i0 + 1) * Math.PI / 10 + rot), y: Math.sin((2 * i0 + 1) * Math.PI / 10 + rot) };
            if (i0 % 2 === 0) { var tmp = b; b = c; c = tmp; }
            triangles.push([0, { x: 0, y: 0 }, b, c]);
        }

        var subdivisions = Math.max(3, Math.min(7, Math.round(P.subdivisions)));
        for (var s = 0; s < subdivisions; s++) triangles = subdivide(triangles);

        var scaleF = halfDiag * 1.06;
        function toPx(v) { return { x: cx0 + v.x * scaleF, y: cy0 + v.y * scaleF }; }

        function clipToRect(poly) {
            var p = poly;
            p = clipHalfPlane(p, -1, 0, -ox);
            if (p.length) p = clipHalfPlane(p, 1, 0, ox + dW);
            if (p.length) p = clipHalfPlane(p, 0, -1, -oy);
            if (p.length) p = clipHalfPlane(p, 0, 1, oy + dH);
            return p;
        }

        var density = fills.getEffectiveDensity();
        var spacing = (paper.DPI / 25.4) / Math.max(0.2, density);
        var globalAngle = fills.getFillAngle();
        var insetVal = Math.max(0.5, Math.min(1, Number(P.cellInset)));
        var showGap = insetVal < 0.999;

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function emitPath(d, color) {
            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
        }

        var seenEdges = {};
        function edgeKey(p1, p2) {
            var a = Math.round(p1.x * 4) + ',' + Math.round(p1.y * 4);
            var b2 = Math.round(p2.x * 4) + ',' + Math.round(p2.y * 4);
            return a < b2 ? a + '|' + b2 : b2 + '|' + a;
        }
        function drawEdge(p1, p2, color) {
            var seg = fills.clipLineToRect(p1.x, p1.y, p2.x, p2.y, ox, oy, dW, dH);
            if (seg) parts.push('<line x1="' + seg.x1.toFixed(2) + '" y1="' + seg.y1.toFixed(2) + '" x2="' + seg.x2.toFixed(2) + '" y2="' + seg.y2.toFixed(2) +
                '" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
        }

        for (var ti = 0; ti < triangles.length; ti++) {
            var tri = triangles[ti];
            var color = tri[0];
            var A = toPx(tri[1]), B = toPx(tri[2]), C = toPx(tri[3]);
            var cen = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };

            // Quick reject: skip triangles whose bounding box is nowhere
            // near the page rect (deep-subdivision tips far outside crop).
            var minX = Math.min(A.x, B.x, C.x), maxX = Math.max(A.x, B.x, C.x);
            var minY = Math.min(A.y, B.y, C.y), maxY = Math.max(A.y, B.y, C.y);
            if (maxX < ox || minX > ox + dW || maxY < oy || minY > oy + dH) continue;

            var ink;
            if (P.colorMode === 'byType') {
                ink = palette[color === 0 ? 0 : Math.min(1, palette.length - 1)];
            } else if (P.colorMode === 'byRadius') {
                var dfrac = Math.min(1, Math.hypot(cen.x - cx0, cen.y - cy0) / halfDiag);
                ink = palette[Math.min(palette.length - 1, Math.floor(dfrac * palette.length))];
            } else if (P.colorMode === 'byAngle') {
                var afrac = (Math.atan2(cen.y - cy0, cen.x - cx0) + Math.PI) / (2 * Math.PI);
                ink = paletteBlend(palette, afrac);
            } else {
                ink = palette[0];
            }

            var pts = [A, B, C];
            if (showGap) {
                pts = pts.map(function (pt) { return { x: cen.x + (pt.x - cen.x) * insetVal, y: cen.y + (pt.y - cen.y) * insetVal }; });
            }

            if (P.fillStyle && P.fillStyle !== 'none') {
                var clipped = clipToRect(pts);
                if (clipped.length >= 3) {
                    fills.fillPolyD(clipped, P.fillStyle, globalAngle, spacing, (seed ^ (ti * 2654435761)) >>> 0).forEach(function (d) { emitPath(d, ink); });
                }
            }

            if (P.strokeOutline === 'yes') {
                if (showGap) {
                    drawEdge(pts[0], pts[1], ink);
                    drawEdge(pts[1], pts[2], ink);
                    drawEdge(pts[2], pts[0], ink);
                } else {
                    var e1 = [C, A], e2 = [A, B];
                    var k1 = edgeKey(e1[0], e1[1]);
                    if (!seenEdges[k1]) { seenEdges[k1] = true; drawEdge(e1[0], e1[1], ink); }
                    var k2 = edgeKey(e2[0], e2[1]);
                    if (!seenEdges[k2]) { seenEdges[k2] = true; drawEdge(e2[0], e2[1], ink); }
                }
            }
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'penrose',
        description: 'Aperiodic Penrose (P3) rhombus tiling via recursive Robinson-triangle deflation, outline or plotFills-filled, with a shattered-facet inset mode.',
        stylePresets: Object.keys(PRESETS).map(function (k) { return { label: k.replace(/_/g, ' '), values: PRESETS[k] }; }),
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
