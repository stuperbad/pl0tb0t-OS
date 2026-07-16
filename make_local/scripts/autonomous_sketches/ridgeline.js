/**
 * ridgeline — 2026-07-10
 *
 * Stacked hidden-line mountain-range profile plot, the classic pen-plotter
 * "wireframe terrain" trick (front-to-back rows of horizontal contour
 * lines where nearer ridges opaquely mask farther ones). A 2D height
 * field (Gaussian peaks / elongated ridges / dune waves / a crater bowl,
 * plus a layered-sine noise texture for ruggedness) is sampled once per
 * row at increasing depth; each row's screen line is clipped against a
 * running silhouette built by all nearer rows, so only the parts of a
 * farther ridge that poke above (or below, depending on viewpoint) the
 * nearer terrain survive as visible strokes.
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

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        alpine: {
            fieldType: 'peaks', heightScale: 130, ruggedness: 25, colorMode: 'single',
            rowSpacingMm: 4, rows: 70, groundFill: 'hatch',
            palette: ['#1a1a1a'], bgColor: '#f5f0e8'
        },
        sunset_ridges: {
            fieldType: 'ridge', colorMode: 'depth', heightScale: 110, rowSpacingMm: 5, rows: 55,
            palette: ['#e63946', '#ff9800', '#9c27b0'], bgColor: '#fff3e0', groundFill: 'crosshatch'
        },
        dune_sea: {
            fieldType: 'dunes', heightScale: 55, rowSpacingMm: 3, rows: 85, pointsPerRow: 170,
            colorMode: 'single', ruggedness: 15, palette: ['#c98a3a'], bgColor: '#fdf6e3', groundFill: 'hatch'
        },
        crater_field: {
            fieldType: 'crater', viewFrom: 'above', heightScale: 140, colorMode: 'alternating', rows: 60,
            palette: ['#2196f3', '#10243a'], bgColor: '#eef6fb', groundFill: 'none'
        },
        pulsar: {
            rows: 100, rowSpacingMm: 2.2, heightScale: 150, ruggedness: 8, pointsPerRow: 180,
            colorMode: 'single', palette: ['#000000'], bgColor: '#ffffff', groundFill: 'none'
        }
    };

    var params = [
        { id: 'rows', label: 'Rows (depth)', type: 'range', min: 20, max: 110, step: 2, value: 65, group: 'general' },
        { id: 'pointsPerRow', label: 'Resolution', type: 'range', min: 60, max: 220, step: 10, value: 150, group: 'general' },
        { id: 'rowSpacingMm', label: 'Row spacing (mm)', type: 'range', min: 1.5, max: 10, step: 0.25, value: 4.5, group: 'general' },
        { id: 'heightScale', label: 'Elevation scale', type: 'range', min: 20, max: 220, step: 5, value: 100, group: 'general' },
        { id: 'peakCount', label: 'Peak count', type: 'range', min: 2, max: 12, step: 1, value: 6, group: 'general' },
        { id: 'ruggedness', label: 'Ruggedness', type: 'range', min: 0, max: 100, step: 5, value: 30, group: 'general' },
        { id: 'fieldType', label: 'Terrain type', type: 'select', value: 'peaks', group: 'general',
          options: [
              { value: 'peaks', label: 'Peaks' }, { value: 'ridge', label: 'Ridge' },
              { value: 'dunes', label: 'Dunes' }, { value: 'crater', label: 'Crater' }
          ] },
        { id: 'viewFrom', label: 'Viewpoint', type: 'select', value: 'below', group: 'general',
          options: [ { value: 'below', label: 'Below (near at bottom)' }, { value: 'above', label: 'Above (near at top)' } ] },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'single', group: 'color',
          options: [
              { value: 'single', label: 'Single ink' }, { value: 'depth', label: 'Depth gradient' },
              { value: 'alternating', label: 'Alternating bands' }
          ] },
        { id: 'groundFill', label: 'Ground fill', type: 'select', value: 'hatch', group: 'general',
          options: (window.plotFills ? window.plotFills.FILL_STYLE_OPTIONS : []).concat([{ value: 'none', label: 'Outline only' }]) },
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' }
    ];

    var STYLE_LABELS = [
        ['Alpine Dawn', 'alpine'],
        ['Sunset Ridges', 'sunset_ridges'],
        ['Dune Sea', 'dune_sea'],
        ['Crater Field', 'crater_field'],
        ['Pulsar', 'pulsar']
    ];
    var stylePresets = STYLE_LABELS.map(function (pair) {
        return { label: pair[0], values: PRESETS[pair[1]] };
    });

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function colorFor(P, palette, rowIndex, rows) {
        if (P.colorMode === 'depth') {
            var t = rowIndex / Math.max(1, rows - 1);
            var idx = Math.min(palette.length - 1, Math.floor(t * palette.length));
            return palette[idx];
        }
        if (P.colorMode === 'alternating') return palette[rowIndex % palette.length];
        return palette[0];
    }

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

        var innerW = W - 2 * mp, innerH = H - 2 * mp;
        var rows = Math.round(P.rows);
        var pts = Math.max(2, Math.round(P.pointsPerRow));
        var rowSpacingPx = paper.mmToPixels(P.rowSpacingMm);
        var heightScalePx = P.heightScale;
        var ruggedFrac = P.ruggedness / 100;
        var peakCount = Math.round(P.peakCount);

        var peaks = [], k;
        if (P.fieldType === 'peaks') {
            for (k = 0; k < peakCount; k++) peaks.push({ cx: rng(), cz: rng(), amp: 0.55 + rng() * 0.65, sx: 0.10 + rng() * 0.14, sz: 0.10 + rng() * 0.14 });
        } else if (P.fieldType === 'ridge') {
            for (k = 0; k < peakCount; k++) peaks.push({ cx: rng(), cz: rng(), amp: 0.5 + rng() * 0.55, sx: 0.035 + rng() * 0.05, sz: 0.32 + rng() * 0.28 });
        } else if (P.fieldType === 'dunes') {
            for (k = 0; k < Math.max(3, peakCount); k++) peaks.push({ cx: rng(), cz: rng(), amp: 0.3 + rng() * 0.3, sx: 0.26 + rng() * 0.3, sz: 0.05 + rng() * 0.06 });
        } else {
            for (k = 0; k < Math.max(2, Math.min(4, peakCount)); k++) peaks.push({ cx: rng(), cz: rng(), amp: 0.28 + rng() * 0.28, sx: 0.12 + rng() * 0.14, sz: 0.12 + rng() * 0.14 });
        }

        var duneFreq = 2.4 + rng() * 3.2, dunePhase = rng() * Math.PI * 2;
        var craterCx = 0.28 + rng() * 0.44, craterCz = 0.28 + rng() * 0.44, craterR = 0.16 + rng() * 0.13, rimW = 0.045 + rng() * 0.03;

        var noiseTerms = [];
        for (k = 0; k < 4; k++) noiseTerms.push({ fx: 0.6 + rng() * 3.2, fz: 0.6 + rng() * 3.2, phase: rng() * Math.PI * 2, w: 1 / (k + 1.3) });

        function noiseAt(x, z) {
            var s = 0, wsum = 0, i2;
            for (i2 = 0; i2 < noiseTerms.length; i2++) {
                var t = noiseTerms[i2];
                s += t.w * Math.sin(t.fx * x * 6.283185 + t.fz * z * 6.283185 + t.phase);
                wsum += t.w;
            }
            return s / wsum;
        }

        function fieldBase(x, z) {
            var s = 0, i2;
            for (i2 = 0; i2 < peaks.length; i2++) {
                var p = peaks[i2];
                var dx = x - p.cx, dz = z - p.cz;
                s += p.amp * Math.exp(-(dx * dx / (2 * p.sx * p.sx) + dz * dz / (2 * p.sz * p.sz)));
            }
            if (P.fieldType === 'dunes') s += 0.4 * Math.sin(x * duneFreq * 6.283185 + dunePhase + z * 1.6);
            if (P.fieldType === 'crater') {
                var dist = Math.sqrt((x - craterCx) * (x - craterCx) + (z - craterCz) * (z - craterCz));
                s += -1.05 * Math.exp(-(dist * dist) / (2 * (craterR * 0.6) * (craterR * 0.6)));
                s += 0.85 * Math.exp(-((dist - craterR) * (dist - craterR)) / (2 * rimW * rimW));
            }
            return Math.max(-1.4, Math.min(1.4, s));
        }

        function heightAt(x, z) {
            return fieldBase(x, z) * (1 - ruggedFrac * 0.25) + noiseAt(x, z) * ruggedFrac * 0.75;
        }

        var below = (P.viewFrom !== 'above');
        var pad = Math.min(heightScalePx * 0.3, innerH * 0.12);
        var baseline0 = below ? (H - mp - pad) : (mp + pad);
        var stepSign = below ? -1 : 1;
        var frontEdgeY = below ? (H - mp) : mp;

        var xs = [];
        for (var c = 0; c < pts; c++) xs.push(mp + (innerW * c) / (pts - 1));

        var silhouette = [];
        for (c = 0; c < pts; c++) silhouette.push(below ? Infinity : -Infinity);

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        var frontRowPoints = null;

        for (var rowIndex = 0; rowIndex < rows; rowIndex++) {
            var baselineY = baseline0 + stepSign * rowIndex * rowSpacingPx;
            if (below && baselineY < mp) break;
            if (!below && baselineY > H - mp) break;

            var zNorm = rowIndex / Math.max(1, rows - 1);
            var rowColor = colorFor(P, palette, rowIndex, rows);
            var currentRun = [];
            var rowPointsFull = [];

            for (var col = 0; col < pts; col++) {
                var xNorm = col / (pts - 1);
                var hVal = heightAt(xNorm, zNorm);
                var y = baselineY - hVal * heightScalePx;
                if (y < mp) y = mp;
                if (y > H - mp) y = H - mp;

                if (rowIndex === 0) rowPointsFull.push({ x: xs[col], y: y });

                var visible;
                if (below) { visible = y < silhouette[col]; if (visible) silhouette[col] = y; }
                else { visible = y > silhouette[col]; if (visible) silhouette[col] = y; }

                if (visible) {
                    currentRun.push({ x: xs[col], y: y });
                } else {
                    if (currentRun.length >= 2) {
                        parts.push('<polyline points="' + currentRun.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
                            '" fill="none" stroke="' + rowColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
                    }
                    currentRun = [];
                }
            }
            if (currentRun.length >= 2) {
                parts.push('<polyline points="' + currentRun.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
                    '" fill="none" stroke="' + rowColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
            }

            if (rowIndex === 0) frontRowPoints = rowPointsFull;
        }

        if (P.groundFill !== 'none' && frontRowPoints && frontRowPoints.length >= 2) {
            var groundPoly = frontRowPoints.concat([
                { x: frontRowPoints[frontRowPoints.length - 1].x, y: frontEdgeY },
                { x: frontRowPoints[0].x, y: frontEdgeY }
            ]);
            var spacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
            var gAngle = fills.getFillAngle();
            var groundColor = colorFor(P, palette, 0, rows);
            fills.fillPolyD(groundPoly, P.groundFill, gAngle, spacing, (seed + 777) >>> 0).forEach(function (d) {
                parts.push('<path d="' + d + '" fill="none" stroke="' + groundColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
            });
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'ridgeline',
        description: 'Stacked hidden-line mountain ridges — classic wireframe terrain profile plot.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: stylePresets,
        generate: generate
    };
})();
