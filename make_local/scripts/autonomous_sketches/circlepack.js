/**
 * circlepack — 2026-07-05
 *
 * Maximal-inscribed-circle packing. Candidate points are sampled at random;
 * each is grown to the largest radius that neither crosses the page boundary
 * nor overlaps any circle already placed (an O(1)-per-neighbor distance
 * check, no iterative growth loop needed). Packing runs in a handful of
 * passes with a shrinking size cap per pass — a few large circles first,
 * then progressively smaller ones settle into the gaps — the classic
 * "circle packing" generative-art technique, no polygon geometry involved.
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function circlePoly(cx, cy, r, sides) {
        var pts = [];
        for (var i = 0; i < sides; i++) {
            var a = i * 2 * Math.PI / sides;
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        return pts;
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: '#0f4c5c', label: 'Teal' },  { value: '#c9a227', label: 'Gold' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        pebbles: { palette: ['#1a1a1a'], bgColor: '#f5f0e8', colorMode: 'mono', fillStyle: 'none',
            boundaryShape: 'rect', maxRadiusMm: 34, minRadiusMm: 4, paddingMm: 1.4, maxPasses: 5, sizeDecay: 0.5 },
        bubbles: { palette: ['#0f4c5c', '#2ca6a4', '#7fd1cf', '#cdeef0'], bgColor: '#e8f6f8', colorMode: 'radial',
            fillStyle: 'rings', ringSpacingMm: 1.1, boundaryShape: 'circle', maxRadiusMm: 44, minRadiusMm: 3,
            paddingMm: 0.8, maxPasses: 6, sizeDecay: 0.5 },
        atoms: { palette: ['#0d1b2a', '#e63946', '#457b9d', '#e0e1dd'], bgColor: '#f1f1ea', colorMode: 'radius',
            fillStyle: 'crosshatch', boundaryShape: 'rect', maxRadiusMm: 30, minRadiusMm: 2.5, paddingMm: 2.0,
            maxPasses: 4, sizeDecay: 0.42 },
        gasket: { palette: ['#1a1a1a'], bgColor: '#ffffff', colorMode: 'pass', fillStyle: 'none',
            boundaryShape: 'rect', maxRadiusMm: 46, minRadiusMm: 1.6, paddingMm: 0.4, maxPasses: 7,
            sizeDecay: 0.6, attemptsPerPass: 1400 },
        orbits: { palette: ['#3a6ea5', '#e94f37', '#f0a202', '#4c9f70', '#c95d9c'], bgColor: '#0b1622',
            colorMode: 'radius', fillStyle: 'rings', ringSpacingMm: 1.6, boundaryShape: 'circle',
            maxRadiusMm: 50, minRadiusMm: 4, paddingMm: 1.6, maxPasses: 5, sizeDecay: 0.55 }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'colorMode', label: 'Color by', type: 'select', value: 'mono', group: 'color',
          options: [{ value: 'mono', label: 'Single ink' }, { value: 'random', label: 'Random' },
                    { value: 'radius', label: 'Circle size' }, { value: 'pass', label: 'Pack pass' },
                    { value: 'radial', label: 'Distance from center' }] },
        { id: 'boundaryShape', label: 'Boundary', type: 'select', value: 'rect', group: 'general',
          options: [{ value: 'rect', label: 'Full page' }, { value: 'circle', label: 'Circular field' }] },
        { id: 'maxPasses', label: 'Size tiers', type: 'range', min: 3, max: 7, step: 1, value: 5, group: 'general' },
        { id: 'attemptsPerPass', label: 'Attempts per tier', type: 'range', min: 300, max: 2000, step: 100, value: 900, group: 'general' },
        { id: 'maxRadiusMm', label: 'Largest circle (mm)', type: 'range', min: 15, max: 60, step: 1, value: 38, group: 'general' },
        { id: 'minRadiusMm', label: 'Smallest circle (mm)', type: 'range', min: 1, max: 10, step: 0.5, value: 3.5, group: 'general' },
        { id: 'paddingMm', label: 'Gap between circles (mm)', type: 'range', min: 0, max: 4, step: 0.1, value: 1.0, group: 'general' },
        { id: 'sizeDecay', label: 'Tier shrink rate', type: 'range', min: 0.3, max: 0.8, step: 0.05, value: 0.55, group: 'general' },
        { id: 'fillStyle', label: 'Fill style', type: 'select', value: 'none', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }, { value: 'rings', label: 'Concentric rings' }]) },
        { id: 'ringSpacingMm', label: 'Ring spacing (mm)', type: 'range', min: 0.5, max: 4, step: 0.1, value: 1.3, group: 'general' }
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
        var bg = P.bgColor || '#ffffff';

        var boxX0 = mp, boxY0 = mp, boxX1 = W - mp, boxY1 = H - mp;
        var centerX = (boxX0 + boxX1) / 2, centerY = (boxY0 + boxY1) / 2;
        var boundaryR = Math.min(boxX1 - boxX0, boxY1 - boxY0) / 2;

        var maxRadiusPx = paper.mmToPixels(Number(P.maxRadiusMm) || 38);
        var minRadiusPx = paper.mmToPixels(Number(P.minRadiusMm) || 3.5);
        var paddingPx = paper.mmToPixels(Number(P.paddingMm) || 1.0);
        var ringSpacingPx = paper.mmToPixels(Number(P.ringSpacingMm) || 1.3);
        var sizeDecay = Number(P.sizeDecay) || 0.55;
        var maxPasses = Math.max(1, Math.round(P.maxPasses));
        var attemptsPerPass = Math.max(50, Math.round(P.attemptsPerPass));
        var HARD_MAX_CIRCLES = 1500;

        var circles = [];
        var passMax = maxRadiusPx;
        for (var pass = 0; pass < maxPasses && circles.length < HARD_MAX_CIRCLES; pass++) {
            for (var a = 0; a < attemptsPerPass && circles.length < HARD_MAX_CIRCLES; a++) {
                var x = boxX0 + rng() * (boxX1 - boxX0);
                var y = boxY0 + rng() * (boxY1 - boxY0);

                var distB;
                if (P.boundaryShape === 'circle') {
                    var dcx = x - centerX, dcy = y - centerY;
                    distB = boundaryR - Math.sqrt(dcx * dcx + dcy * dcy);
                } else {
                    distB = Math.min(x - boxX0, boxX1 - x, y - boxY0, boxY1 - y);
                }

                var maxR = Math.min(distB, passMax);
                if (maxR >= minRadiusPx) {
                    for (var ci = 0; ci < circles.length; ci++) {
                        var c = circles[ci];
                        var dx = x - c.x, dy = y - c.y;
                        var d = Math.sqrt(dx * dx + dy * dy) - c.r - paddingPx;
                        if (d < maxR) maxR = d;
                        if (maxR < minRadiusPx) break;
                    }
                }
                if (maxR >= minRadiusPx) circles.push({ x: x, y: y, r: maxR, pass: pass });
            }
            passMax *= sizeDecay;
            if (passMax < minRadiusPx) break;
        }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        var spacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
        var globalAngle = fills.getFillAngle();
        var fillProb = fills.getFillProb();
        var radiusSpan = Math.max(1, maxRadiusPx - minRadiusPx);

        circles.forEach(function (c, idx) {
            var color;
            if (P.colorMode === 'random') {
                var rr = makeRng((seed ^ (idx * 2654435761)) >>> 0)();
                color = palette[Math.floor(rr * palette.length) % palette.length];
            } else if (P.colorMode === 'radius') {
                var norm = Math.max(0, Math.min(1, (c.r - minRadiusPx) / radiusSpan));
                color = palette[Math.min(palette.length - 1, Math.floor(norm * palette.length))];
            } else if (P.colorMode === 'pass') {
                color = palette[c.pass % palette.length];
            } else if (P.colorMode === 'radial') {
                var dxr = c.x - centerX, dyr = c.y - centerY;
                var dnorm = Math.max(0, Math.min(1, Math.sqrt(dxr * dxr + dyr * dyr) / Math.max(1, boundaryR)));
                color = palette[Math.min(palette.length - 1, Math.floor(dnorm * palette.length))];
            } else {
                color = palette[0];
            }

            var doFill = P.fillStyle !== 'none' && (makeRng((seed ^ (idx * 40503 + 7)) >>> 0)() <= fillProb);

            if (doFill && P.fillStyle === 'rings') {
                var rr2 = c.r - ringSpacingPx, ringCount = 0;
                while (rr2 > ringSpacingPx * 0.4 && ringCount < 24) {
                    parts.push('<circle cx="' + c.x.toFixed(2) + '" cy="' + c.y.toFixed(2) + '" r="' + rr2.toFixed(2) +
                        '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '"/>');
                    rr2 -= ringSpacingPx;
                    ringCount++;
                }
            } else if (doFill) {
                var poly = circlePoly(c.x, c.y, c.r, 20);
                var angleDeg = globalAngle + c.pass * 17;
                var dArr = fills.fillPolyD(poly, P.fillStyle, angleDeg, spacing, (seed ^ (idx * 97531 + 3)) >>> 0);
                dArr.forEach(function (dd) {
                    if (dd) parts.push('<path d="' + dd + '" fill="none" stroke="' + color +
                        '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                });
            }

            parts.push('<circle cx="' + c.x.toFixed(2) + '" cy="' + c.y.toFixed(2) + '" r="' + c.r.toFixed(2) +
                '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '"/>');
        });

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'circlepack',
        description: 'Maximal-inscribed-circle packing: random candidates grow to the largest non-overlapping radius, in shrinking size tiers.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Pebble beach', values: { colorMode: 'mono', fillStyle: 'none', boundaryShape: 'rect' } },
            { label: 'Soap bubbles', values: { colorMode: 'radial', fillStyle: 'rings', boundaryShape: 'circle' } },
            { label: 'Molecular model', values: { colorMode: 'radius', fillStyle: 'crosshatch', paddingMm: 2.0 } },
            { label: 'Apollonian gasket', values: { colorMode: 'pass', fillStyle: 'none', paddingMm: 0.4, sizeDecay: 0.6, maxPasses: 7 } },
            { label: 'Planetary rings', values: { colorMode: 'radius', fillStyle: 'rings', boundaryShape: 'circle' } }
        ],
        generate: generate
    };
})();
