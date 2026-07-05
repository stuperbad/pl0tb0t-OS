/**
 * spirograph — 2026-06-25
 *
 * Classic roulette curves (hypotrochoid / epitrochoid) generated from
 * integer gear-tooth ratios so every curve closes perfectly. Multiple
 * layers are stacked with small per-layer randomization (tooth count,
 * pen offset), progressive scaling, and rotation, producing nested
 * flower/gear/orbit forms. Each layer is a single continuous closed
 * polyline -- ideal for plotting with minimal pen lifts.
 */
(function () {
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function gcd(a, b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b) { var t = b; b = a % b; a = t; }
        return a || 1;
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        classic: {
            layers: 1, fixedTeeth: 60, rollingTeeth: 19, penOffsetPct: 80, jitter: 0,
            curveType: 'hypotrochoid', layerScaleStep: 0, rotationStep: 0, size: 85,
            palette: ['#000000'], bgColor: '#f5f0e8'
        },
        bloom: {
            layers: 5, fixedTeeth: 72, rollingTeeth: 27, penOffsetPct: 90, jitter: 35,
            curveType: 'alternating', layerScaleStep: -10, rotationStep: 24, size: 88,
            palette: ['#e63946', '#ff9800', '#9c27b0', '#2196f3'], bgColor: '#fffaf0'
        },
        ghost_orbit: {
            layers: 3, fixedTeeth: 48, rollingTeeth: 11, penOffsetPct: 60, jitter: 15,
            curveType: 'epitrochoid', layerScaleStep: -6, rotationStep: 40, size: 90,
            palette: ['#10243a'], bgColor: '#eef6fb'
        },
        gear_storm: {
            layers: 8, fixedTeeth: 90, rollingTeeth: 33, penOffsetPct: 110, jitter: 70,
            curveType: 'alternating', layerScaleStep: -7, rotationStep: 13, size: 92,
            palette: ['#1a1a1a', '#e63946', '#2196f3'], bgColor: '#f5f0e8'
        }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'layers', label: 'Layers', type: 'range', min: 1, max: 8, step: 1, value: 4, group: 'general' },
        { id: 'fixedTeeth', label: 'Fixed gear teeth (R)', type: 'range', min: 24, max: 120, step: 1, value: 60, group: 'general' },
        { id: 'rollingTeeth', label: 'Rolling gear teeth (r)', type: 'range', min: 3, max: 80, step: 1, value: 19, group: 'general' },
        { id: 'penOffsetPct', label: 'Pen offset % of r', type: 'range', min: 0, max: 150, step: 1, value: 75, group: 'general' },
        { id: 'jitter', label: 'Per-layer jitter', type: 'range', min: 0, max: 100, step: 1, value: 30, group: 'general' },
        { id: 'curveType', label: 'Curve type', type: 'select', value: 'alternating',
          options: [
            { value: 'hypotrochoid', label: 'Hypotrochoid (inside)' },
            { value: 'epitrochoid', label: 'Epitrochoid (outside)' },
            { value: 'alternating', label: 'Alternating' }
          ], group: 'general' },
        { id: 'layerScaleStep', label: 'Layer scale step %', type: 'range', min: -20, max: 20, step: 1, value: -8, group: 'general' },
        { id: 'rotationStep', label: 'Layer rotation step (deg)', type: 'range', min: 0, max: 180, step: 1, value: 15, group: 'general' },
        { id: 'size', label: 'Overall size %', type: 'range', min: 30, max: 100, step: 1, value: 80, group: 'general' },
        { id: 'resolutionMult', label: 'Curve resolution', type: 'range', min: 1, max: 4, step: 1, value: 2, group: 'general' }
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

        var cx = W / 2, cy = H / 2;
        var halfMin = Math.min(W / 2 - mp, H / 2 - mp);
        var avail = halfMin * (P.size / 100);

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        var jitterFrac = P.jitter / 100;
        var numLayers = Math.max(1, Math.round(P.layers));

        for (var i = 0; i < numLayers; i++) {
            var RTeeth = Math.max(5, Math.round(P.fixedTeeth + (rng() - 0.5) * 2 * jitterFrac * 20));
            var rTeethRaw = Math.round(P.rollingTeeth + (rng() - 0.5) * 2 * jitterFrac * 20);
            var rTeeth = Math.max(3, Math.min(rTeethRaw, RTeeth - 1));

            var type = P.curveType;
            if (type === 'alternating') type = (i % 2 === 0) ? 'hypotrochoid' : 'epitrochoid';

            var dPct = Math.max(0, P.penOffsetPct * (1 + (rng() - 0.5) * 2 * jitterFrac * 0.8));
            var ratio = rTeeth / RTeeth;
            var offsetFrac = dPct / 100;

            var factor = (type === 'epitrochoid')
                ? (1 + ratio) + ratio * offsetFrac
                : (1 - ratio) + ratio * offsetFrac;
            factor = Math.max(0.05, factor);

            var baseR = avail / factor;
            var scaleMult = Math.pow(1 + P.layerScaleStep / 100, i);
            var R_px = Math.min(baseR * scaleMult, avail * 1.05 / factor);
            var r_px = R_px * ratio;
            var d_px = r_px * offsetFrac;

            var g = gcd(RTeeth, rTeeth);
            var revolutions = rTeeth / g;

            var samplesPerRev = Math.max(8, Math.floor(3000 / revolutions));
            samplesPerRev = Math.min(samplesPerRev, 24 + P.resolutionMult * 24);
            var totalSamples = Math.max(64, Math.round(revolutions * samplesPerRev));
            var totalRange = revolutions * 2 * Math.PI;
            var dt = totalRange / totalSamples;

            var rot = (P.rotationStep * i) * Math.PI / 180;
            var cosRot = Math.cos(rot), sinRot = Math.sin(rot);

            var pts = [];
            for (var s = 0; s <= totalSamples; s++) {
                var t = s * dt;
                var x, y;
                if (type === 'epitrochoid') {
                    x = (R_px + r_px) * Math.cos(t) - d_px * Math.cos(((R_px + r_px) / r_px) * t);
                    y = (R_px + r_px) * Math.sin(t) - d_px * Math.sin(((R_px + r_px) / r_px) * t);
                } else {
                    x = (R_px - r_px) * Math.cos(t) + d_px * Math.cos(((R_px - r_px) / r_px) * t);
                    y = (R_px - r_px) * Math.sin(t) - d_px * Math.sin(((R_px - r_px) / r_px) * t);
                }
                var xr = x * cosRot - y * sinRot;
                var yr = x * sinRot + y * cosRot;
                pts.push((cx + xr).toFixed(2) + ',' + (cy + yr).toFixed(2));
            }

            var color = palette[i % palette.length];
            parts.push('<polyline points="' + pts.join(' ') +
                '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) +
                '" stroke-linecap="round" stroke-linejoin="round"/>');
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'spirograph',
        description: 'Hypotrochoid/epitrochoid roulette curves layered into nested flower and gear forms, gear-ratio based so every loop closes perfectly.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Classic Rose', values: { layers: 1, fixedTeeth: 60, rollingTeeth: 19, penOffsetPct: 80, jitter: 0, curveType: 'hypotrochoid', layerScaleStep: 0, rotationStep: 0 } },
            { label: 'Bloom', values: { layers: 5, fixedTeeth: 72, rollingTeeth: 27, penOffsetPct: 90, jitter: 35, curveType: 'alternating', layerScaleStep: -10, rotationStep: 24 } },
            { label: 'Ghost Orbit', values: { layers: 3, fixedTeeth: 48, rollingTeeth: 11, penOffsetPct: 60, jitter: 15, curveType: 'epitrochoid', layerScaleStep: -6, rotationStep: 40 } },
            { label: 'Gear Storm', values: { layers: 8, fixedTeeth: 90, rollingTeeth: 33, penOffsetPct: 110, jitter: 70, curveType: 'alternating', layerScaleStep: -7, rotationStep: 13 } }
        ],
        generate: generate
    };
})();
