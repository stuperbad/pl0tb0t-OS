/**
 * chladni — Chladni plate nodal-line patterns — 2026-07-03
 *
 * Rayleigh's classic square-plate approximation: F(x,y) = cos(n*pi*x)*cos(m*pi*y)
 * - cos(m*pi*x)*cos(n*pi*y), summed over a primary mode pair plus optional weighted
 * higher-frequency mode pairs, then sliced with marching squares at one or more
 * threshold bands around zero. The zero band alone reproduces the real sand-on-a-
 * vibrating-plate nodal figure; extra bands turn it into a topographic reading of
 * the plate's modal deflection. A "tiled" mode divides the sheet into an NxN grid
 * of independently-seeded (and optionally rotated) mini plates for a tessellated
 * kaleidoscope variant of the same underlying physics.
 */
(function () {
    var paper = window.makeSketchUtils;
    var fills = window.plotFills; // eslint-disable-line no-unused-vars

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    var MS = [[], [[0, 3]], [[0, 1]], [[3, 1]], [[1, 2]], [[0, 3], [1, 2]], [[0, 2]], [[3, 2]],
              [[2, 3]], [[0, 2]], [[0, 1], [2, 3]], [[1, 2]], [[1, 3]], [[0, 1]], [[0, 3]], []];
    var CORNER_COL = [0, 1, 1, 0], CORNER_ROW = [0, 0, 1, 1];
    var EDGE_A = [0, 1, 2, 3], EDGE_B = [1, 2, 3, 0];

    function edgePt(col, row, ei, hts, thresh, ox, oy, cW, cH) {
        var ea = EDGE_A[ei], eb = EDGE_B[ei];
        var ac = col + CORNER_COL[ea], ar = row + CORNER_ROW[ea];
        var bc = col + CORNER_COL[eb], br = row + CORNER_ROW[eb];
        var va = hts[ar][ac], vb = hts[br][bc];
        var t = (va === vb) ? 0.5 : Math.max(0, Math.min(1, (thresh - va) / (vb - va)));
        var ax = ox + ac * cW, ay = oy + ar * cH;
        var bx = ox + bc * cW, by = oy + br * cH;
        return { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
    }

    function fixPair(n, m) { return (n === m) ? ((n % 14) + 1) : m; }

    function evalField(nx, ny, modePairs) {
        var v = 0;
        for (var i = 0; i < modePairs.length; i++) {
            var mp = modePairs[i];
            v += mp.w * (Math.cos(mp.n * Math.PI * nx) * Math.cos(mp.m * Math.PI * ny) -
                         Math.cos(mp.m * Math.PI * nx) * Math.cos(mp.n * Math.PI * ny));
        }
        return v;
    }

    function rotateCoord(nx, ny, rot) {
        switch (rot) {
            case 1: return { x: ny, y: 1 - nx };
            case 2: return { x: 1 - nx, y: 1 - ny };
            case 3: return { x: 1 - ny, y: nx };
            default: return { x: nx, y: ny };
        }
    }

    function buildFieldGrid(gCols, gRows, modePairs, rot) {
        var hts = [], hMin = Infinity, hMax = -Infinity;
        for (var row = 0; row <= gRows; row++) {
            hts[row] = [];
            for (var col = 0; col <= gCols; col++) {
                var rc = rotateCoord(col / gCols, row / gRows, rot);
                var v = evalField(rc.x, rc.y, modePairs);
                hts[row][col] = v;
                if (v < hMin) hMin = v; if (v > hMax) hMax = v;
            }
        }
        return { hts: hts, hMin: hMin, hMax: hMax };
    }

    function computeThresholds(hMin, hMax, bandCount) {
        if (bandCount <= 1) return [0];
        var amp = Math.max(Math.abs(hMin), Math.abs(hMax)) * 0.72;
        var out = [];
        for (var i = 0; i < bandCount; i++) out.push(-amp + (2 * amp) * i / (bandCount - 1));
        return out;
    }

    function marchAndPush(hts, gCols, gRows, ox, oy, cW, cH, thresholds, sw, swIdx, idxEvery, palette, colorByBand, parts) {
        for (var lv = 0; lv < thresholds.length; lv++) {
            var thresh = thresholds[lv];
            var isIdx = idxEvery > 0 && (lv % idxEvery === 0);
            var thick = (isIdx ? swIdx : sw).toFixed(2);
            var stroke = (colorByBand === 'on') ? palette[lv % palette.length] : palette[0];
            var d = '';
            for (var r = 0; r < gRows; r++) {
                for (var c = 0; c < gCols; c++) {
                    var kase = (hts[r][c] > thresh ? 1 : 0) | (hts[r][c + 1] > thresh ? 2 : 0) |
                               (hts[r + 1][c + 1] > thresh ? 4 : 0) | (hts[r + 1][c] > thresh ? 8 : 0);
                    var msegs = MS[kase];
                    for (var s = 0; s < msegs.length; s++) {
                        var pa = edgePt(c, r, msegs[s][0], hts, thresh, ox, oy, cW, cH);
                        var pb = edgePt(c, r, msegs[s][1], hts, thresh, ox, oy, cW, cH);
                        d += 'M' + pa.x.toFixed(1) + ',' + pa.y.toFixed(1) + 'L' + pb.x.toFixed(1) + ',' + pb.y.toFixed(1);
                    }
                }
            }
            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + stroke +
                '" stroke-width="' + thick + '" stroke-linecap="round"/>');
        }
    }

    function makePairs(rng, baseN, baseM, extraModes) {
        var pairs = [{ n: baseN, m: fixPair(baseN, baseM), w: 1 }];
        for (var k = 0; k < extraModes; k++) {
            var en = 1 + Math.floor(rng() * 14);
            var em = 1 + Math.floor(rng() * 14);
            pairs.push({ n: en, m: fixPair(en, em), w: 1 / (k + 2) });
        }
        return pairs;
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#10243a', label: 'Navy' },
        { value: '#8b4513', label: 'Brown' }, { value: '#cc2200', label: 'Rust' },
        { value: '#b8860b', label: 'Gold' },  { value: '#2980b9', label: 'Blue' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        resonance: {
            patternMode: 'single', modeN: 3, modeM: 5, extraModes: 0, bandCount: 1,
            indexEvery: 0, gridDetail: 90, palette: ['#000000'], bgColor: '#f5f0e8'
        },
        harmonic_bloom: {
            patternMode: 'single', modeN: 4, modeM: 9, extraModes: 2, bandCount: 5,
            indexEvery: 2, gridDetail: 100, colorByBand: 'on',
            palette: ['#8b4513', '#cc2200', '#b8860b'], bgColor: '#f7f1e3'
        },
        kaleidoscope: {
            patternMode: 'tiled', cellsPerSide: 3, modeN: 5, modeM: 8, cellVariance: 40,
            rotateCells: 'on', bandCount: 1, indexEvery: 0, gridDetail: 80,
            palette: ['#10243a'], bgColor: '#eaf2fa'
        },
        crystal_lattice: {
            patternMode: 'tiled', cellsPerSide: 4, modeN: 2, modeM: 3, cellVariance: 20,
            rotateCells: 'off', bandCount: 3, indexEvery: 0, colorByBand: 'on',
            gridDetail: 70, palette: ['#000000', '#2980b9', '#9c27b0'], bgColor: '#f5f0e8'
        },
        storm: {
            patternMode: 'single', modeN: 7, modeM: 11, extraModes: 3, bandCount: 7,
            indexEvery: 3, gridDetail: 110, palette: ['#000000'], bgColor: '#ffffff'
        }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#000000'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'colorByBand', label: 'Color by band', type: 'select', value: 'off', group: 'color',
          options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },

        { id: 'patternMode', label: 'Layout', type: 'select', value: 'single', group: 'general',
          options: [{ value: 'single', label: 'Single plate' }, { value: 'tiled', label: 'Tiled plates' }] },
        { id: 'modeN', label: 'Mode N', type: 'range', min: 1, max: 14, step: 1, value: 3, group: 'general' },
        { id: 'modeM', label: 'Mode M', type: 'range', min: 1, max: 14, step: 1, value: 5, group: 'general' },
        { id: 'extraModes', label: 'Extra harmonics', type: 'range', min: 0, max: 3, step: 1, value: 0, group: 'general' },
        { id: 'bandCount', label: 'Contour bands', type: 'range', min: 1, max: 9, step: 1, value: 1, group: 'general' },
        { id: 'gridDetail', label: 'Detail', type: 'range', min: 20, max: 120, step: 5, value: 80, group: 'general' },
        { id: 'indexEvery', label: 'Bold every Nth', type: 'range', min: 0, max: 6, step: 1, value: 0, group: 'general' },
        { id: 'cellsPerSide', label: 'Tiles per side', type: 'range', min: 1, max: 5, step: 1, value: 3, group: 'general',
          visibleWhen: { param: 'patternMode', values: ['tiled'] } },
        { id: 'cellVariance', label: 'Tile mode variance', type: 'range', min: 0, max: 100, step: 5, value: 30, group: 'general',
          visibleWhen: { param: 'patternMode', values: ['tiled'] } },
        { id: 'rotateCells', label: 'Rotate tiles', type: 'select', value: 'on', group: 'general',
          options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
          visibleWhen: { param: 'patternMode', values: ['tiled'] } }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function generate(seed, opts) {
        var P = buildDefaults();
        if (typeof opts === 'string') { if (PRESETS[opts]) for (var k in PRESETS[opts]) P[k] = PRESETS[opts][k]; }
        else if (opts && typeof opts === 'object') { for (var k2 in opts) if (opts.hasOwnProperty(k2)) P[k2] = opts[k2]; }

        var rng = makeRng(seed);

        var dims = paper.getPaperPixels(P.paperSize || '9x12');
        var W = dims.width, H = dims.height;
        var mp = paper.getMarginPixels(parseFloat(P.margin || 0.75));
        var penMm = Number(window._pl0tPenWidthMm) || 0.4;
        var sw = paper.mmToPixels(penMm);
        var swIdx = sw * 1.7;

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#000000'];
        var bg = P.bgColor || '#f5f0e8';

        var ox = mp, oy = mp, dW = W - 2 * mp, dH = H - 2 * mp;
        var bandCount = Math.max(1, Math.round(P.bandCount));
        var idxEvery = Math.round(P.indexEvery);
        var extraModes = Math.max(0, Math.min(3, Math.round(P.extraModes)));
        var baseN = Math.max(1, Math.min(14, Math.round(P.modeN)));
        var baseM = Math.max(1, Math.min(14, Math.round(P.modeM)));

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        if (P.patternMode === 'tiled') {
            var cellsPerSide = Math.max(1, Math.min(5, Math.round(P.cellsPerSide)));
            var varAmt = Math.round((P.cellVariance / 100) * 10);
            var cW0 = dW / cellsPerSide, cH0 = dH / cellsPerSide;
            var cellPxT = Math.max(3, 16 - (P.gridDetail / 120) * 10);
            var gColsC = Math.max(8, Math.min(60, Math.round(cW0 / cellPxT)));
            var gRowsC = Math.max(8, Math.min(60, Math.round(cH0 / cellPxT)));

            for (var ty = 0; ty < cellsPerSide; ty++) {
                for (var tx = 0; tx < cellsPerSide; tx++) {
                    var cellSeed = (seed ^ (tx * 73856093) ^ (ty * 19349663)) >>> 0;
                    var cellRng = makeRng(cellSeed);
                    var n = Math.max(1, Math.min(14, baseN + Math.round((cellRng() - 0.5) * 2 * varAmt)));
                    var m = Math.max(1, Math.min(14, baseM + Math.round((cellRng() - 0.5) * 2 * varAmt)));
                    var pairs = makePairs(cellRng, n, m, extraModes);
                    var rot = (P.rotateCells === 'on') ? Math.floor(cellRng() * 4) : 0;

                    var fg = buildFieldGrid(gColsC, gRowsC, pairs, rot);
                    var thresholds = computeThresholds(fg.hMin, fg.hMax, bandCount);
                    var tox = ox + tx * cW0, toy = oy + ty * cH0;
                    marchAndPush(fg.hts, gColsC, gRowsC, tox, toy, cW0 / gColsC, cH0 / gRowsC,
                        thresholds, sw, swIdx, idxEvery, palette, P.colorByBand, parts);
                }
            }
        } else {
            var pairsS = makePairs(rng, baseN, baseM, extraModes);
            var cellPxS = Math.max(4, 24 - (P.gridDetail / 120) * 18);
            var gCols = Math.max(16, Math.min(200, Math.round(dW / cellPxS)));
            var gRows = Math.max(16, Math.min(200, Math.round(dH / cellPxS)));
            var fgS = buildFieldGrid(gCols, gRows, pairsS, 0);
            var thresholdsS = computeThresholds(fgS.hMin, fgS.hMax, bandCount);
            marchAndPush(fgS.hts, gCols, gRows, ox, oy, dW / gCols, dH / gRows,
                thresholdsS, sw, swIdx, idxEvery, palette, P.colorByBand, parts);
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'chladni',
        description: 'Chladni plate nodal-line patterns: mode-pair superposition sliced by marching squares, single or tiled.',
        stylePresets: [
            { label: 'Resonance', values: { patternMode: 'single', modeN: 3, modeM: 5, extraModes: 0, bandCount: 1, indexEvery: 0 } },
            { label: 'Harmonic bloom', values: { patternMode: 'single', modeN: 4, modeM: 9, extraModes: 2, bandCount: 5, indexEvery: 2, colorByBand: 'on', palette: ['#8b4513', '#cc2200', '#b8860b'] } },
            { label: 'Kaleidoscope', values: { patternMode: 'tiled', cellsPerSide: 3, modeN: 5, modeM: 8, cellVariance: 40, rotateCells: 'on', bandCount: 1 } },
            { label: 'Crystal lattice', values: { patternMode: 'tiled', cellsPerSide: 4, modeN: 2, modeM: 3, cellVariance: 20, rotateCells: 'off', bandCount: 3, colorByBand: 'on', palette: ['#000000', '#2980b9', '#9c27b0'] } },
            { label: 'Storm', values: { patternMode: 'single', modeN: 7, modeM: 11, extraModes: 3, bandCount: 7, indexEvery: 3 } }
        ],
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
