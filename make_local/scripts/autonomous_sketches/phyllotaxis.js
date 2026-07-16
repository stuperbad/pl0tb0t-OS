/**
 * phyllotaxis — 2026-07-16
 *
 * Golden-angle seed-head growth (Vogel's model): point i sits at angle
 * i * divergenceAngle, radius c*sqrt(i). At the golden angle (137.50776 deg)
 * this reproduces the exact packing a sunflower head or pinecone uses to
 * pack the most seeds with the least crowding — a closed-form number-theory
 * placement, no noise field, no simulation, no recursive splitting. The same
 * lattice can be read two ways: as discrete seed marks (circle/floret/hex
 * tiles at each point, sized by growth order), or as "parastichy" spiral
 * arms traced by connecting point i straight to point i+k for a fixed
 * Fibonacci offset k — the classic trick that makes the spiral arms visible
 * even though every individual mark is placed by angle+radius alone, with
 * no curve ever explicitly drawn. Off-golden divergence angles that are
 * rational fractions of a full turn (90, 60, ...) collapse the spiral into
 * straight radiating arms instead, since the point stream then repeats on a
 * fixed number of rays.
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

    function lerp(a, b, t) { return a + (b - a) * t; }

    function circlePoly(cx, cy, r, sides, rot) {
        rot = rot || 0;
        var pts = [];
        for (var i = 0; i < sides; i++) {
            var a = rot + i * 2 * Math.PI / sides;
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        return pts;
    }

    function floretPoly(cx, cy, r, theta) {
        var ux = Math.cos(theta), uy = Math.sin(theta);
        var vx = -uy, vy = ux;
        var tip = { x: cx + ux * r * 1.35, y: cy + uy * r * 1.35 };
        var base = { x: cx - ux * r * 0.55, y: cy - uy * r * 0.55 };
        var right = { x: cx + ux * r * 0.15 - vx * r * 0.6, y: cy + uy * r * 0.15 - vy * r * 0.6 };
        var left = { x: cx + ux * r * 0.15 + vx * r * 0.6, y: cy + uy * r * 0.15 + vy * r * 0.6 };
        return [tip, right, base, left];
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: '#c9a227', label: 'Gold' },  { value: '#7b4b27', label: 'Umber' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        sunflower: { palette: ['#7b4b27', '#c9a227'], bgColor: '#f7f0dc', colorMode: 'mono',
            seedCount: 900, divergenceMode: 'golden', boundaryShape: 'circle', renderMode: 'seeds',
            shapeStyle: 'floret', sizeMode: 'growing', sizeMinMm: 1.4, sizeMaxMm: 5.5,
            fillStyle: 'hatch' },
        pinecone: { palette: ['#5a3a22', '#8a5a2e', '#c98a3f'], bgColor: '#efe0c4', colorMode: 'index',
            seedCount: 500, divergenceMode: 'golden', boundaryShape: 'circle', renderMode: 'seeds',
            shapeStyle: 'hex', sizeMode: 'growing', sizeMinMm: 2, sizeMaxMm: 7, fillStyle: 'none' },
        spiral_web: { palette: ['#1a1a1a'], bgColor: '#f5f0e8', colorMode: 'mono',
            seedCount: 1400, divergenceMode: 'golden', boundaryShape: 'rect', renderMode: 'spiralArms',
            spiralFamilies: '8,13' },
        quasicrystal: { palette: ['#c9d8ff', '#8fb4ff', '#5c7ce0', '#2e3a6e'], bgColor: '#0a0e2a',
            colorMode: 'index', seedCount: 700, divergenceMode: 'pinwheel6', boundaryShape: 'circle',
            renderMode: 'both', shapeStyle: 'circle', sizeMode: 'constant', sizeMinMm: 1.2, sizeMaxMm: 1.6,
            spiralFamilies: '5,8', fillStyle: 'none' },
        blueprint: { palette: ['#9fc7e8'], bgColor: '#0c2233', colorMode: 'mono',
            seedCount: 1600, divergenceMode: 'golden', boundaryShape: 'rect', renderMode: 'seeds',
            shapeStyle: 'circle', sizeMode: 'constant', sizeMinMm: 1.1, sizeMaxMm: 1.1, fillStyle: 'none' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'colorMode', label: 'Color by', type: 'select', value: 'mono', group: 'color',
          options: [{ value: 'mono', label: 'Single ink' }, { value: 'random', label: 'Random' },
                    { value: 'index', label: 'Growth order' }] },
        { id: 'seedCount', label: 'Seed count', type: 'range', min: 100, max: 2500, step: 10, value: 900, group: 'general' },
        { id: 'divergenceMode', label: 'Divergence angle', type: 'select', value: 'golden', group: 'general',
          options: [{ value: 'golden', label: 'Golden (137.5 deg) — smooth spiral' },
                    { value: 'pinwheel5', label: 'Pinwheel 5 (108 deg)' },
                    { value: 'pinwheel6', label: 'Pinwheel 6 (60 deg)' },
                    { value: 'square', label: 'Square (90 deg)' },
                    { value: 'custom', label: 'Custom' }] },
        { id: 'divergenceCustomDeg', label: 'Custom angle (deg)', type: 'range', min: 30, max: 170, step: 0.1, value: 137.5, group: 'general' },
        { id: 'boundaryShape', label: 'Boundary', type: 'select', value: 'circle', group: 'general',
          options: [{ value: 'circle', label: 'Circular head' }, { value: 'rect', label: 'Full page' }] },
        { id: 'renderMode', label: 'Render', type: 'select', value: 'seeds', group: 'general',
          options: [{ value: 'seeds', label: 'Seed marks' }, { value: 'spiralArms', label: 'Spiral arm lines' },
                    { value: 'both', label: 'Both' }] },
        { id: 'shapeStyle', label: 'Seed shape', type: 'select', value: 'floret', group: 'general',
          options: [{ value: 'circle', label: 'Circle' }, { value: 'floret', label: 'Floret' }, { value: 'hex', label: 'Hex' }] },
        { id: 'sizeMode', label: 'Seed size', type: 'select', value: 'growing', group: 'general',
          options: [{ value: 'constant', label: 'Constant' }, { value: 'growing', label: 'Grows outward' },
                    { value: 'shrinking', label: 'Shrinks outward' }] },
        { id: 'sizeMinMm', label: 'Min seed size (mm)', type: 'range', min: 0.5, max: 8, step: 0.1, value: 1.5, group: 'general' },
        { id: 'sizeMaxMm', label: 'Max seed size (mm)', type: 'range', min: 1, max: 14, step: 0.1, value: 5, group: 'general' },
        { id: 'spiralFamilies', label: 'Spiral arm offsets', type: 'select', value: '8,13', group: 'general',
          options: [{ value: '13', label: 'Single arm (13)' }, { value: '8,13', label: 'Two arms (8+13)' },
                    { value: '13,21', label: 'Two arms (13+21)' }, { value: '21,34', label: 'Two arms (21+34)' },
                    { value: '5,8,13', label: 'Three arms (5+8+13)' }] },
        { id: 'fillStyle', label: 'Seed fill style', type: 'select', value: 'none', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) }
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
        var halfW = (boxX1 - boxX0) / 2, halfH = (boxY1 - boxY0) / 2;

        var divergenceDeg;
        if (P.divergenceMode === 'pinwheel5') divergenceDeg = 108;
        else if (P.divergenceMode === 'pinwheel6') divergenceDeg = 60;
        else if (P.divergenceMode === 'square') divergenceDeg = 90;
        else if (P.divergenceMode === 'custom') divergenceDeg = Number(P.divergenceCustomDeg) || 137.5;
        else divergenceDeg = 137.50776;
        var divergenceRad = divergenceDeg * Math.PI / 180;

        var seedCount = Math.max(50, Math.min(2500, Math.round(Number(P.seedCount) || 900)));
        var boundaryShape = P.boundaryShape === 'rect' ? 'rect' : 'circle';

        var rMaxTarget = boundaryShape === 'circle'
            ? Math.max(10, Math.min(halfW, halfH) - sw * 2)
            : Math.sqrt(halfW * halfW + halfH * halfH);
        var c = rMaxTarget / Math.sqrt(seedCount);

        var points = new Array(seedCount + 1);
        for (var i = 1; i <= seedCount; i++) {
            var theta = i * divergenceRad;
            var r = c * Math.sqrt(i);
            points[i] = { x: centerX + r * Math.cos(theta), y: centerY + r * Math.sin(theta), theta: theta, r: r };
        }

        function inBounds(p) {
            return boundaryShape === 'circle' || (p.x >= boxX0 && p.x <= boxX1 && p.y >= boxY0 && p.y <= boxY1);
        }

        var sizeMinPx = paper.mmToPixels(Number(P.sizeMinMm) || 1.5);
        var sizeMaxPx = paper.mmToPixels(Number(P.sizeMaxMm) || 5);
        function sizeForIndex(i) {
            var t = i / seedCount;
            if (P.sizeMode === 'growing') return lerp(sizeMinPx, sizeMaxPx, t);
            if (P.sizeMode === 'shrinking') return lerp(sizeMaxPx, sizeMinPx, t);
            return sizeMaxPx;
        }

        function colorForIndex(i, t, localRng) {
            if (P.colorMode === 'random') return palette[Math.floor(localRng() * palette.length) % palette.length];
            if (P.colorMode === 'index') return palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];
            return palette[0];
        }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        var spacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
        var globalAngle = fills.getFillAngle();

        if (P.renderMode === 'spiralArms' || P.renderMode === 'both') {
            var families = String(P.spiralFamilies || '8,13').split(',')
                .map(function (s) { return parseInt(s, 10); })
                .filter(function (n) { return n > 0 && n < seedCount; });
            families.forEach(function (step, famIdx) {
                for (var j = 1; j + step <= seedCount; j++) {
                    var p1 = points[j], p2 = points[j + step];
                    if (!inBounds(p1) || !inBounds(p2)) continue;
                    var t = j / seedCount;
                    var localRng = makeRng((seed ^ (j * 2654435761 + famIdx * 97)) >>> 0);
                    var color = P.colorMode === 'mono' ? palette[famIdx % palette.length] : colorForIndex(j, t, localRng);
                    parts.push('<line x1="' + p1.x.toFixed(2) + '" y1="' + p1.y.toFixed(2) +
                        '" x2="' + p2.x.toFixed(2) + '" y2="' + p2.y.toFixed(2) +
                        '" stroke="' + color + '" stroke-width="' + (sw * 0.7).toFixed(2) + '" stroke-linecap="round"/>');
                }
            });
        }

        if (P.renderMode === 'seeds' || P.renderMode === 'both') {
            for (var i2 = 1; i2 <= seedCount; i2++) {
                var p = points[i2];
                if (!inBounds(p)) continue;
                var t2 = i2 / seedCount;
                var size = sizeForIndex(i2);
                var rr = size / 2;
                var localRng2 = makeRng((seed ^ (i2 * 40503 + 7)) >>> 0);
                var color2 = colorForIndex(i2, t2, localRng2);

                var poly;
                if (P.shapeStyle === 'floret') poly = floretPoly(p.x, p.y, rr, p.theta);
                else if (P.shapeStyle === 'hex') poly = circlePoly(p.x, p.y, rr, 6, p.theta);
                else poly = circlePoly(p.x, p.y, rr, 14, 0);

                if (P.fillStyle !== 'none') {
                    var angleDeg = globalAngle + (p.theta * 180 / Math.PI);
                    var dArr = fills.fillPolyD(poly, P.fillStyle, angleDeg, spacing, (seed ^ (i2 * 97531 + 3)) >>> 0);
                    dArr.forEach(function (dd) {
                        if (dd) parts.push('<path d="' + dd + '" fill="none" stroke="' + color2 +
                            '" stroke-width="' + (sw * 0.6).toFixed(2) + '" stroke-linecap="round"/>');
                    });
                }

                parts.push('<polygon points="' + poly.map(function (pt) { return pt.x.toFixed(2) + ',' + pt.y.toFixed(2); }).join(' ') +
                    '" fill="none" stroke="' + color2 + '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');
            }
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'phyllotaxis',
        description: 'Golden-angle sunflower/pinecone seed-head growth (Vogel spiral) — seed marks or parastichy spiral-arm lines from a closed-form angle+radius lattice.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Sunflower', values: { colorMode: 'mono', divergenceMode: 'golden', boundaryShape: 'circle', renderMode: 'seeds', shapeStyle: 'floret', sizeMode: 'growing', fillStyle: 'hatch' } },
            { label: 'Pinecone', values: { colorMode: 'index', divergenceMode: 'golden', boundaryShape: 'circle', renderMode: 'seeds', shapeStyle: 'hex', sizeMode: 'growing', fillStyle: 'none' } },
            { label: 'Spiral web', values: { colorMode: 'mono', divergenceMode: 'golden', boundaryShape: 'rect', renderMode: 'spiralArms', spiralFamilies: '8,13' } },
            { label: 'Quasicrystal', values: { colorMode: 'index', divergenceMode: 'pinwheel6', boundaryShape: 'circle', renderMode: 'both', shapeStyle: 'circle', sizeMode: 'constant', spiralFamilies: '5,8', fillStyle: 'none' } },
            { label: 'Blueprint field', values: { colorMode: 'mono', divergenceMode: 'golden', boundaryShape: 'rect', renderMode: 'seeds', shapeStyle: 'circle', sizeMode: 'constant', fillStyle: 'none' } }
        ],
        generate: generate
    };
})();
