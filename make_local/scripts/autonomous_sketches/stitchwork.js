/**
 * stitchwork — 2026-07-09
 *
 * Straight-line "curve stitching" / string-art. Every mark is a single
 * straight chord between two points -- no arcs, no beziers -- yet the
 * *envelope* the chords leave behind reads as a curve. Two constructions:
 *
 *  - chords: N points evenly spaced on a circle, point i joined to point
 *    (i * multiplier) mod N for every i. This is the classic "times table
 *    on a circle" trick -- multiplier 2 traces a cardioid envelope,
 *    multiplier 3 a nephroid, higher values dense rose/star envelopes.
 *
 *  - parabola: a regular polygon's corners each host two rays running
 *    along their adjacent edges; point i on ray A joins point (P+1-i) on
 *    ray B, producing a parabolic arc tangent to both edges -- the same
 *    technique taught with thread and nails/pins on cardboard corners.
 *    Every polygon edge ends up hosting two half-arcs (one grown from
 *    each end), meeting mid-edge.
 *
 * Multiple layers stack with incremental rotation (and, for chords,
 * incremental multiplier) to build denser woven/lace compositions.
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

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        cardioid_bloom: {
            patternType: 'chords', pointCount: 120, multiplier: 2, layers: 1,
            layerRotationStep: 0, layerMultiplierStep: 0, colorMode: 'single',
            palette: ['#1a1a1a'], bgColor: '#f5f0e8', size: 88
        },
        nephroid_web: {
            patternType: 'chords', pointCount: 100, multiplier: 3, layers: 3,
            layerRotationStep: 6, layerMultiplierStep: 0, colorMode: 'rainbow',
            bgColor: '#10141c', size: 90
        },
        parabola_burst: {
            patternType: 'parabola', cornerCount: 6, pointCount: 70, edgeReachPct: 90,
            layers: 1, colorMode: 'single', palette: ['#10243a'], bgColor: '#eef6fb', size: 85
        },
        star_lace: {
            patternType: 'chords', pointCount: 96, multiplier: 17, layers: 2,
            layerRotationStep: 15, layerMultiplierStep: 0, colorMode: 'byLayer',
            palette: ['#e63946', '#2196f3'], bgColor: '#fffaf0', size: 88
        },
        woven_corners: {
            patternType: 'parabola', cornerCount: 4, pointCount: 90, edgeReachPct: 95,
            layers: 2, layerRotationStep: 45, colorMode: 'byLayer',
            palette: ['#9c27b0', '#ff9800'], bgColor: '#f5f0e8', size: 82
        }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'patternType', label: 'Pattern', type: 'select', value: 'chords',
          options: [
            { value: 'chords', label: 'Circle chords (cardioid/nephroid)' },
            { value: 'parabola', label: 'Corner parabolas' }
          ], group: 'general' },
        { id: 'pointCount', label: 'Points per arm', type: 'range', min: 12, max: 150, step: 1, value: 80, group: 'general' },
        { id: 'multiplier', label: 'Chord multiplier', type: 'range', min: 2, max: 40, step: 1, value: 2, group: 'general' },
        { id: 'cornerCount', label: 'Polygon corners', type: 'range', min: 3, max: 10, step: 1, value: 4, group: 'general' },
        { id: 'edgeReachPct', label: 'Edge reach %', type: 'range', min: 30, max: 100, step: 1, value: 88, group: 'general' },
        { id: 'layers', label: 'Layers', type: 'range', min: 1, max: 6, step: 1, value: 1, group: 'general' },
        { id: 'layerRotationStep', label: 'Layer rotation (deg)', type: 'range', min: 0, max: 60, step: 1, value: 8, group: 'general' },
        { id: 'layerMultiplierStep', label: 'Layer multiplier step', type: 'range', min: 0, max: 6, step: 1, value: 1, group: 'general' },
        { id: 'size', label: 'Overall size %', type: 'range', min: 40, max: 100, step: 1, value: 85, group: 'general' },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'single',
          options: [
            { value: 'single', label: 'Single ink' },
            { value: 'byLayer', label: 'By layer' },
            { value: 'rainbow', label: 'Rainbow' }
          ], group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function generate(seed, opts) {
        var P = buildDefaults();
        if (typeof opts === 'string') {
            if (PRESETS[opts]) for (var k in PRESETS[opts]) P[k] = PRESETS[opts][k];
        } else if (opts && typeof opts === 'object') {
            for (var k2 in opts) if (opts.hasOwnProperty(k2)) P[k2] = opts[k2];
        }

        var rng = makeRng(seed); // reserved for future jitter; unused directly keeps output deterministic per seed via layer math

        var dims = paper.getPaperPixels(P.paperSize || '9x12');
        var W = dims.width, H = dims.height;
        var mp = paper.getMarginPixels(parseFloat(P.margin || 0.75));
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];

        var cx = W / 2, cy = H / 2;
        var halfMin = Math.min(W / 2 - mp, H / 2 - mp);
        var R = halfMin * (P.size / 100);
        var numLayers = Math.max(1, Math.round(P.layers));

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        function layerColor(L, huePhase) {
            if (P.colorMode === 'byLayer') return palette[L % palette.length];
            if (P.colorMode === 'rainbow') return 'hsl(' + (huePhase % 360).toFixed(0) + ',70%,42%)';
            return palette[0];
        }

        if (P.patternType === 'parabola') {
            var C = Math.max(3, Math.round(P.cornerCount));
            var baseVerts = [];
            for (var k = 0; k < C; k++) {
                var a0 = -Math.PI / 2 + k * 2 * Math.PI / C;
                baseVerts.push({ x: cx + R * Math.cos(a0), y: cy + R * Math.sin(a0) });
            }
            var pPts = Math.max(4, Math.round(P.pointCount));
            var reach = P.edgeReachPct / 100;

            for (var L = 0; L < numLayers; L++) {
                var rot = (L * P.layerRotationStep) * Math.PI / 180;
                var cosR = Math.cos(rot), sinR = Math.sin(rot);
                var verts = baseVerts.map(function (v) {
                    var dx = v.x - cx, dy = v.y - cy;
                    return { x: cx + dx * cosR - dy * sinR, y: cy + dx * sinR + dy * cosR };
                });

                for (var c = 0; c < C; c++) {
                    var vCorner = verts[c];
                    var vPrev = verts[(c - 1 + C) % C];
                    var vNext = verts[(c + 1) % C];
                    var color = layerColor(L, (c / C) * 360 + L * (360 / numLayers));

                    for (var i = 1; i <= pPts; i++) {
                        var tA = (i / pPts) * reach;
                        var tB = ((pPts + 1 - i) / pPts) * reach;
                        var xA = vCorner.x + (vPrev.x - vCorner.x) * tA;
                        var yA = vCorner.y + (vPrev.y - vCorner.y) * tA;
                        var xB = vCorner.x + (vNext.x - vCorner.x) * tB;
                        var yB = vCorner.y + (vNext.y - vCorner.y) * tB;
                        var strokeColor = (P.colorMode === 'rainbow')
                            ? 'hsl(' + (((c / C) * 360 + L * (360 / numLayers) + (i / pPts) * 20) % 360).toFixed(0) + ',70%,42%)'
                            : color;
                        parts.push('<line x1="' + xA.toFixed(2) + '" y1="' + yA.toFixed(2) +
                            '" x2="' + xB.toFixed(2) + '" y2="' + yB.toFixed(2) +
                            '" stroke="' + strokeColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                    }
                }
            }
        } else {
            var N = Math.max(6, Math.round(P.pointCount));
            for (var L2 = 0; L2 < numLayers; L2++) {
                var m = Math.max(2, Math.round(P.multiplier + L2 * P.layerMultiplierStep));
                var rot2 = (L2 * P.layerRotationStep) * Math.PI / 180 - Math.PI / 2;
                var lColor = layerColor(L2, L2 * (360 / numLayers));

                for (var j = 0; j < N; j++) {
                    var target = (j * m) % N;
                    if (target === j) continue;
                    var a1 = rot2 + (j / N) * 2 * Math.PI;
                    var a2 = rot2 + (target / N) * 2 * Math.PI;
                    var x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
                    var x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
                    var strokeColor2 = (P.colorMode === 'rainbow')
                        ? 'hsl(' + (((j / N) * 360 + L2 * (360 / numLayers)) % 360).toFixed(0) + ',70%,42%)'
                        : lColor;
                    parts.push('<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) +
                        '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) +
                        '" stroke="' + strokeColor2 + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                }
            }
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'stitchwork',
        description: 'Straight-line curve stitching / string art -- circle "times table" chords (cardioid/nephroid envelopes) or corner-to-corner parabola arcs on a polygon, exactly like thread wound on nails.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Cardioid Bloom', values: { patternType: 'chords', pointCount: 120, multiplier: 2, layers: 1, colorMode: 'single' } },
            { label: 'Nephroid Web', values: { patternType: 'chords', pointCount: 100, multiplier: 3, layers: 3, layerRotationStep: 6, colorMode: 'rainbow' } },
            { label: 'Parabola Burst', values: { patternType: 'parabola', cornerCount: 6, pointCount: 70, edgeReachPct: 90, layers: 1, colorMode: 'single' } },
            { label: 'Star Lace', values: { patternType: 'chords', pointCount: 96, multiplier: 17, layers: 2, layerRotationStep: 15, colorMode: 'byLayer' } },
            { label: 'Woven Corners', values: { patternType: 'parabola', cornerCount: 4, pointCount: 90, edgeReachPct: 95, layers: 2, layerRotationStep: 45, colorMode: 'byLayer' } }
        ],
        generate: generate
    };
})();
