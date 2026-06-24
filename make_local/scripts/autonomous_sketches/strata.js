/**
 * strata — geological strata cross-section (parametric)
 *
 * Horizontal layers deformed by noise undulation. Every parameter below is
 * exposed in the Make tab; the global fill options (density, imperfection,
 * % filled, scatter) feed in too. Headless email path: generate(seed, 'earth').
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    function makeNoise1D(rng, octaves) {
        var tables = [];
        for (var o = 0; o < octaves; o++) {
            var T = [];
            for (var i = 0; i < 256; i++) T.push(rng() * 2 - 1);
            tables.push(T);
        }
        return function (x) {
            var v = 0, amp = 1, freq = 1, total = 0;
            for (var o = 0; o < tables.length; o++) {
                var xi = Math.floor(x * freq) & 255;
                var xf = (x * freq) - Math.floor(x * freq);
                var t = xf * xf * (3 - 2 * xf);
                v += (tables[o][xi] * (1 - t) + tables[o][(xi + 1) & 255] * t) * amp;
                total += amp; amp *= 0.5; freq *= 2;
            }
            return v / total;
        };
    }

    function segsToPath(segs) {
        var d = '';
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            d += 'M' + s.x1.toFixed(1) + ' ' + s.y1.toFixed(1) + 'L' + s.x2.toFixed(1) + ' ' + s.y2.toFixed(1);
        }
        return d;
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#8b4513', label: 'Brown' },
        { value: '#c8a26b', label: 'Tan' },   { value: '#2980b9', label: 'Blue' },
        { value: '#1e6091', label: 'Deep' },  { value: '#cc2200', label: 'Rust' },
        { value: '#2d5a2d', label: 'Green' },  { value: '#52527a', label: 'Slate' },
        { value: '#a0522d', label: 'Sienna' }, { value: 'custom', label: 'Custom' }
    ];

    var FILL_CYCLE = ['hatch', 'squiggle', 'zigzag', 'crosshatch', 'waves'];

    var PRESETS = {
        earth:  { palette: ['#2c1810', '#5c3317', '#8b4513', '#a0522d', '#c8a26b'] },
        ocean:  { palette: ['#0a1628', '#1a3a5c', '#1e6091', '#2980b9', '#5dade2'] },
        fire:   { palette: ['#4d0000', '#8b0000', '#cc2200', '#ff4500', '#ff8c00'] },
        slate:  { palette: ['#1c1c2e', '#3d3d5c', '#52527a', '#7070a0', '#9898c0'] },
        forest: { palette: ['#0b1a0b', '#2d5a2d', '#3d7a3d', '#5a9e5a', '#7abc7a'] }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#2c1810', '#5c3317', '#8b4513', '#a0522d', '#c8a26b'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#ffffff', group: 'advanced' },
        { id: 'layers',    label: 'Layers',        type: 'range', min: 3, max: 12, step: 1, value: 6,  group: 'general' },
        { id: 'roughness', label: 'Edge roughness', type: 'range', min: 0, max: 100, step: 5, value: 50, group: 'general' },
        { id: 'waviness',  label: 'Waviness',       type: 'range', min: 0, max: 100, step: 5, value: 40, group: 'general' },
        { id: 'hatchAngle', label: 'Hatch angle',   type: 'range', min: -90, max: 90, step: 5, value: 30, group: 'general' },
        { id: 'fillStyle', label: 'Fills', type: 'select', multiSelect: true, value: ['hatch'], group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS },
        { id: 'alternate', label: 'Alternate angle', type: 'select', value: 'on', group: 'general',
          options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
        { id: 'border', label: 'Border', type: 'select', value: 'on', group: 'general',
          options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function generate(seed, opts) {
        var P = buildDefaults();
        if (typeof opts === 'string') { if (PRESETS[opts]) for (var k in PRESETS[opts]) P[k] = PRESETS[opts][k]; }
        else if (opts && typeof opts === 'object') { for (var k2 in opts) if (opts.hasOwnProperty(k2)) P[k2] = opts[k2]; }

        var rng = makeRng(seed);
        var noise = makeNoise1D(makeRng((seed ^ 0xdeadbeef) >>> 0), 4);

        var dims = paper.getPaperPixels(P.paperSize || '9x12');
        var W = dims.width, H = dims.height;
        var mp = paper.getMarginPixels(parseFloat(P.margin || 0.75));
        var penMm = Number(window._pl0tPenWidthMm) || 0.4;
        var sw = paper.mmToPixels(penMm);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#ffffff';

        var nLayers = Math.max(2, Math.round(P.layers));
        var ampScale = P.roughness / 100;
        var freqScale = 0.2 + (P.waviness / 100) * 1.3;

        var imperfection = fills.getFillImperfection();
        var fillProb = fills.getFillProb();
        var scatter = fills.getScatterStyles();
        var density = fills.getEffectiveDensity();
        var spacing = (paper.DPI / 25.4) / Math.max(0.2, density);
        var globalAngle = fills.getFillAngle();

        var boundaries = [mp];
        for (var i = 0; i < nLayers - 1; i++) {
            var prev = boundaries[boundaries.length - 1];
            var remaining = (H - mp) - prev;
            var share = (1 / (nLayers - i)) * (0.6 + rng() * 0.8);
            boundaries.push(prev + remaining * Math.min(share, 0.7));
        }
        boundaries.push(H - mp);

        var undul = boundaries.map(function (baseY, bi) {
            return {
                baseY: baseY,
                amp: (bi === 0 || bi === boundaries.length - 1) ? 0 : (H * 0.02 + rng() * H * 0.08) * ampScale,
                freq: (0.002 + rng() * 0.006) * freqScale,
                phase: rng() * 1000
            };
        });
        function boundaryY(bi, x) { var u = undul[bi]; return u.baseY + u.amp * noise((x - mp) * u.freq + u.phase); }

        var STEPS = 28;
        function layerPoly(bi) {
            var poly = [];
            for (var s = 0; s <= STEPS; s++) { var x = mp + (W - 2 * mp) * s / STEPS; poly.push({ x: x, y: boundaryY(bi, x) }); }
            for (var s2 = STEPS; s2 >= 0; s2--) { var x2 = mp + (W - 2 * mp) * s2 / STEPS; poly.push({ x: x2, y: boundaryY(bi + 1, x2) }); }
            return poly;
        }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function emit(d, color) {
            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
        }

        for (var li = 0; li < nLayers; li++) {
            var poly = layerPoly(li);
            var color = palette[li % palette.length];
            var sign = (P.alternate === 'on') ? (li % 2 === 0 ? 1 : -1) : 1;
            var angle = sign * Number(P.hatchAngle) + globalAngle + (rng() * 16 - 8);

            var outline = poly.map(function (pt) { return pt.x.toFixed(2) + ',' + pt.y.toFixed(2); }).join(' ');
            parts.push('<polygon points="' + outline + '" fill="none" stroke="' + color +
                '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');

            if (rng() > fillProb) continue;
            fills.fillPolyMultiD(poly, P.fillStyle, angle, spacing, (seed ^ (li * 0x9e3779b1)) >>> 0).forEach(function (d) { emit(d, color); });
        }

        if (P.border === 'on') {
            parts.push('<rect x="' + mp + '" y="' + mp + '" width="' + (W - 2 * mp) + '" height="' + (H - 2 * mp) +
                '" fill="none" stroke="' + palette[0] + '" stroke-width="' + sw.toFixed(2) + '"/>');
        }
        // Artboard edge frame — matches the built-in sketches' paper border.
        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'strata',
        description: 'Geological strata cross-section: undulating parametric layers with selectable fills.',
        stylePresets: [
            { label: 'Earthy mixed', values: { fillStyle:['hatch','squiggleHatch','zigzagHatch','crosshatch','waves'], layers:6, roughness:50, waviness:40, palette:['#8b4513','#a0522d','#c8a26b','#2d5a2d'] } },
            { label: 'Ocean waves', values: { fillStyle:['waves'], layers:5, waviness:65, roughness:35, palette:['#1e6091','#2196f3'] } },
            { label: 'Sharp hatch', values: { fillStyle:['hatch'], hatchAngle:45, alternate:'on', roughness:30, layers:7 } },
            { label: 'Soft squiggle', values: { fillStyle:['squiggleHatch'], roughness:70, waviness:55, layers:8 } }
        ],
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
