/**
 * isocubes — isometric cube-grid skyline (parametric)
 *
 * A grid of cubes in classic 2:1 isometric projection, each cube's height
 * driven by one of four height fields (random, smoothed noise, pyramid,
 * wave). Three visible faces per cube (top/right/left) are each hatched at
 * a different angle and density to fake directional shading using line
 * work alone. A gap probability punches random holes in the grid for
 * negative space. Drawn back-to-front for correct occlusion.
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#1a1a1a', label: 'Ink' },
        { value: '#e63946', label: 'Red' },   { value: '#2196f3', label: 'Blue' },
        { value: '#0a3d2e', label: 'Pine' },  { value: '#1a6b4f', label: 'Jade' },
        { value: '#ff9800', label: 'Orange' }, { value: '#9c27b0', label: 'Purple' },
        { value: '#52527a', label: 'Slate' },  { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        cityscape: { palette: ['#1a1a1a'], bgColor: '#f5f0e8', heightMode: 'random', faceStyle: 'hatch', gapProb: 12 },
        pyramid:   { palette: ['#3a2a1a'], bgColor: '#f7efe0', heightMode: 'pyramid', faceStyle: 'crosshatch', gapProb: 0 },
        circuit:   { palette: ['#0a3d2e', '#1a6b4f', '#5dba8f'], bgColor: '#eef6ee', heightMode: 'noise', faceStyle: 'hatch', gapProb: 8 },
        blueprint: { palette: ['#1a3a6b'], bgColor: '#eef3fb', heightMode: 'wave', faceStyle: 'plain', gapProb: 0 }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'gridCols', label: 'Grid columns', type: 'range', min: 3, max: 16, step: 1, value: 9, group: 'general' },
        { id: 'gridRows', label: 'Grid rows', type: 'range', min: 3, max: 16, step: 1, value: 7, group: 'general' },
        { id: 'heightScale', label: 'Height scale', type: 'range', min: 0.2, max: 3, step: 0.1, value: 1.3, group: 'general' },
        { id: 'baseHeight', label: 'Base height', type: 'range', min: 0, max: 1, step: 0.05, value: 0.15, group: 'general' },
        { id: 'heightMode', label: 'Height field', type: 'select', value: 'random', group: 'general',
          options: [{ value: 'random', label: 'Random' }, { value: 'noise', label: 'Smooth noise' },
                    { value: 'pyramid', label: 'Pyramid' }, { value: 'wave', label: 'Wave' }] },
        { id: 'gapProb', label: 'Gap %', type: 'range', min: 0, max: 60, step: 1, value: 12, group: 'general' },
        { id: 'faceStyle', label: 'Face fill', type: 'select', value: 'hatch', group: 'general',
          options: [{ value: 'contour', label: 'Contour' }, { value: 'hatch', label: 'Hatch' }, { value: 'sketchHatch', label: 'Chaotic hatch' }, { value: 'squiggleHatch', label: 'Squiggle' }, { value: 'zigzagHatch', label: 'Zigzag' }, { value: 'crosshatch', label: 'Crosshatch' }, { value: 'waves', label: 'Waves' }, { value: 'sprigFill', label: 'Scatter sprig' }, { value: 'ribbonFill', label: 'Scatter ribbon' }, { value: 'crossFill', label: 'Scatter cross' }, { value: 'asteriskFill', label: 'Scatter asterisk' }, { value: 'plain', label: 'Outline only' }] },
        { id: 'shadeStrength', label: 'Shade contrast', type: 'range', min: 0, max: 100, step: 5, value: 60, group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function addV() {
        var x = 0, y = 0;
        for (var i = 0; i < arguments.length; i++) { x += arguments[i].x; y += arguments[i].y; }
        return { x: x, y: y };
    }

    function generate(seed, opts) {
        var P = buildDefaults();
        if (typeof opts === 'string') { if (PRESETS[opts]) for (var k in PRESETS[opts]) P[k] = PRESETS[opts][k]; }
        else if (opts && typeof opts === 'object') { for (var k2 in opts) if (opts.hasOwnProperty(k2)) P[k2] = opts[k2]; }

        var rng = makeRng(seed);
        var dims = paper.getPaperPixels(P.paperSize || '9x12');
        var W = dims.width, H = dims.height;
        var mp = paper.getMarginPixels(parseFloat(P.margin || 0.75));
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#f5f0e8';

        var C = Math.max(2, Math.round(P.gridCols));
        var R = Math.max(2, Math.round(P.gridRows));
        var ax = { x: 1, y: 0.5 };
        var ay = { x: -1, y: 0.5 };

        var density = fills.getEffectiveDensity();
        var imperfection = fills.getFillImperfection();
        var globalAngle = fills.getFillAngle();
        var spacing = (paper.DPI / 25.4) / Math.max(0.2, density);

        // --- height field ---
        var heights = [], c, r;
        for (c = 0; c < C; c++) { heights[c] = []; }

        if (P.heightMode === 'noise') {
            var raw = [];
            for (c = 0; c < C; c++) { raw[c] = []; for (r = 0; r < R; r++) raw[c][r] = rng(); }
            for (c = 0; c < C; c++) {
                for (r = 0; r < R; r++) {
                    var sum = 0, n = 0;
                    for (var dc = -1; dc <= 1; dc++) {
                        for (var dr = -1; dr <= 1; dr++) {
                            var cc = c + dc, rr = r + dr;
                            if (cc >= 0 && cc < C && rr >= 0 && rr < R) { sum += raw[cc][rr]; n++; }
                        }
                    }
                    heights[c][r] = P.baseHeight + (sum / n) * P.heightScale;
                }
            }
        } else if (P.heightMode === 'pyramid') {
            var cMid = (C - 1) / 2, rMid = (R - 1) / 2;
            var maxDist = Math.sqrt(cMid * cMid + rMid * rMid) || 1;
            for (c = 0; c < C; c++) {
                for (r = 0; r < R; r++) {
                    var dist = Math.sqrt((c - cMid) * (c - cMid) + (r - rMid) * (r - rMid));
                    var factor = 1 - Math.min(1, dist / maxDist);
                    heights[c][r] = P.baseHeight + factor * P.heightScale;
                }
            }
        } else if (P.heightMode === 'wave') {
            var wOffset = rng() * 6.28;
            for (c = 0; c < C; c++) {
                for (r = 0; r < R; r++) {
                    var v = (Math.sin(c * 0.7 + wOffset) + Math.cos(r * 0.55 + wOffset) + 2) / 4;
                    heights[c][r] = P.baseHeight + v * P.heightScale;
                }
            }
        } else {
            for (c = 0; c < C; c++) { for (r = 0; r < R; r++) heights[c][r] = P.baseHeight + rng() * P.heightScale; }
        }

        var gaps = [];
        for (c = 0; c < C; c++) {
            gaps[c] = [];
            for (r = 0; r < R; r++) gaps[c][r] = rng() < (P.gapProb / 100);
        }

        // --- bounding box at unit scale, then fit to paper ---
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (c = 0; c < C; c++) {
            for (r = 0; r < R; r++) {
                var p0 = { x: c * ax.x + r * ay.x, y: c * ax.y + r * ay.y };
                var h0 = heights[c][r];
                var az0 = { x: 0, y: -h0 };
                var pts = [p0, addV(p0, ax), addV(p0, ay), addV(p0, ax, ay),
                           addV(p0, az0), addV(p0, ax, az0), addV(p0, ay, az0), addV(p0, ax, ay, az0)];
                for (var pi = 0; pi < pts.length; pi++) {
                    if (pts[pi].x < minX) minX = pts[pi].x;
                    if (pts[pi].x > maxX) maxX = pts[pi].x;
                    if (pts[pi].y < minY) minY = pts[pi].y;
                    if (pts[pi].y > maxY) maxY = pts[pi].y;
                }
            }
        }
        var bboxW = maxX - minX, bboxH = maxY - minY;
        var availW = W - 2 * mp, availH = H - 2 * mp;
        var scale = Math.min(availW / bboxW, availH / bboxH);
        var offX = mp - minX * scale + (availW - bboxW * scale) / 2;
        var offY = mp - minY * scale + (availH - bboxH * scale) / 2;

        function tx(pt) { return { x: pt.x * scale + offX, y: pt.y * scale + offY }; }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function emitPoly(poly, color) {
            parts.push('<polygon points="' + poly.map(function (pt) { return pt.x.toFixed(2) + ',' + pt.y.toFixed(2); }).join(' ') +
                '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');
        }
        function emitFill(d, color) {
            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
        }
        function fillFace(poly, angle, mult, color) {
            var sp = spacing / mult;
            fills.fillPolyD(poly, P.faceStyle, angle, sp, (seed ^ Math.round(angle * 7 + poly[0].x)) >>> 0).forEach(function (d) { emitFill(d, color); });
        }

        // draw order: back to front (increasing c+r moves down-screen, toward viewer)
        var order = [];
        for (c = 0; c < C; c++) { for (r = 0; r < R; r++) order.push([c, r]); }
        order.sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]); });

        var shade = P.shadeStrength / 100;
        var topMult = 1 - 0.4 * shade, rightMult = 1, leftMult = 1 + 0.6 * shade;

        for (var oi = 0; oi < order.length; oi++) {
            c = order[oi][0]; r = order[oi][1];
            if (gaps[c][r]) continue;
            var p = { x: c * ax.x + r * ay.x, y: c * ax.y + r * ay.y };
            var h = heights[c][r];
            var az = { x: 0, y: -h };

            var topNear = tx(addV(p, az)), topRight = tx(addV(p, ax, az));
            var topFar = tx(addV(p, ax, ay, az)), topLeft = tx(addV(p, ay, az));
            var botNear = tx(p), botRight = tx(addV(p, ax)), botLeft = tx(addV(p, ay));

            var topFace = [topNear, topRight, topFar, topLeft];
            var rightFace = [botNear, botRight, topRight, topNear];
            var leftFace = [botNear, botLeft, topLeft, topNear];

            var topColor = palette[0 % palette.length];
            var rightColor = palette[1 % palette.length];
            var leftColor = palette[2 % palette.length];

            emitPoly(topFace, topColor);
            emitPoly(rightFace, rightColor);
            emitPoly(leftFace, leftColor);

            if (P.faceStyle !== 'plain') {
                fillFace(topFace, 10 + globalAngle, topMult, topColor);
                fillFace(rightFace, 100 + globalAngle, rightMult, rightColor);
                fillFace(leftFace, 170 + globalAngle, leftMult, leftColor);
            }
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'isocubes',
        description: 'Isometric cube-grid skyline with per-face directional hatching and a punchable height field.',
        stylePresets: Object.keys(PRESETS).map(function (k) { return { label: k.replace(/_/g, ' '), values: PRESETS[k] }; }),
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
