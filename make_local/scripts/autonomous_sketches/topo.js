/**
 * topo — topographic contour map (parametric)
 *
 * Marching-squares iso-contours over a layered-Gaussian height field.
 * Terrain archetype, contour count, relief, roughness, detail, index spacing
 * and color-by-band are all exposed. Headless: generate(seed, 'range').
 */
(function () {
    var paper = window.makeSketchUtils;
    var fills = window.plotFills;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    function makeNoise2D(rng, N) {
        var g = [];
        for (var i = 0; i <= N; i++) { g[i] = []; for (var j = 0; j <= N; j++) g[i][j] = rng() * 2 - 1; }
        return function (nx, ny) {
            var gx = Math.max(0, Math.min(N - 0.001, nx * N));
            var gy = Math.max(0, Math.min(N - 0.001, ny * N));
            var xi = Math.floor(gx), yi = Math.floor(gy);
            var fx = gx - xi, fy = gy - yi;
            var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
            return g[xi][yi] * (1 - u) * (1 - v) + g[xi + 1][yi] * u * (1 - v) +
                   g[xi][yi + 1] * (1 - u) * v + g[xi + 1][yi + 1] * u * v;
        };
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

    function evalHeight(nx, ny, peaks, noiseAmp, n1, n2) {
        var h = 0;
        for (var i = 0; i < peaks.length; i++) {
            var p = peaks[i];
            var dx = (nx - p.x) / p.sx, dy = (ny - p.y) / p.sy;
            h += p.h * Math.exp(-(dx * dx + dy * dy) * 2);
        }
        h += noiseAmp * n1(nx, ny);
        h += noiseAmp * 0.45 * n2(nx, ny);
        return h;
    }

    var TERRAINS = {
        summit: [{ x: 0.5, y: 0.44, h: 1.0, sx: 0.21, sy: 0.17 }, { x: 0.34, y: 0.37, h: 0.38, sx: 0.1, sy: 0.1 },
                 { x: 0.62, y: 0.55, h: 0.27, sx: 0.1, sy: 0.12 }, { x: 0.47, y: 0.67, h: 0.22, sx: 0.12, sy: 0.09 }],
        basin:  [{ x: 0.5, y: 0.5, h: -0.92, sx: 0.22, sy: 0.18 }, { x: 0.5, y: 0.5, h: 0.52, sx: 0.36, sy: 0.3 },
                 { x: 0.3, y: 0.36, h: 0.22, sx: 0.11, sy: 0.11 }, { x: 0.7, y: 0.64, h: 0.18, sx: 0.1, sy: 0.1 }],
        range:  [{ x: 0.24, y: 0.42, h: 0.9, sx: 0.1, sy: 0.17 }, { x: 0.5, y: 0.38, h: 1.0, sx: 0.1, sy: 0.16 },
                 { x: 0.73, y: 0.44, h: 0.78, sx: 0.1, sy: 0.17 }, { x: 0.37, y: 0.56, h: 0.28, sx: 0.09, sy: 0.12 },
                 { x: 0.62, y: 0.52, h: 0.28, sx: 0.09, sy: 0.12 }],
        dunes:  [{ x: 0.5, y: 0.22, h: 0.7, sx: 0.48, sy: 0.055 }, { x: 0.5, y: 0.36, h: 0.8, sx: 0.45, sy: 0.055 },
                 { x: 0.5, y: 0.5, h: 0.75, sx: 0.46, sy: 0.055 }, { x: 0.5, y: 0.64, h: 0.65, sx: 0.43, sy: 0.055 },
                 { x: 0.5, y: 0.78, h: 0.55, sx: 0.42, sy: 0.055 }, { x: 0.5, y: 0.44, h: 0.42, sx: 0.4, sy: 0.04 }]
    };
    var TERRAIN_KEYS = Object.keys(TERRAINS);

    var STD_PAL = [
        { value: '#10243a', label: 'Navy' }, { value: '#1a0a00', label: 'Umber' },
        { value: '#0d1a0d', label: 'Forest' }, { value: '#000000', label: 'Black' },
        { value: '#2980b9', label: 'Blue' }, { value: '#cc2200', label: 'Rust' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: '#8b4513', label: 'Brown' }, { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        summit: { terrain: 'summit', palette: ['#1a0a00'], bgColor: '#f4f0e8' },
        basin:  { terrain: 'basin',  palette: ['#001033'], bgColor: '#e8eef4' },
        range:  { terrain: 'range',  palette: ['#0d1a0d'], bgColor: '#f2f0eb' },
        dunes:  { terrain: 'dunes',  palette: ['#1a1200'], bgColor: '#f5f0d8' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#10243a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#ffffff', group: 'color' },
        { id: 'colorByBand', label: 'Color by elevation', type: 'select', value: 'off', group: 'color',
          options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
        { id: 'terrain', label: 'Terrain', type: 'select', value: 'range', group: 'general',
          options: [{ value: 'range', label: 'Range' }, { value: 'summit', label: 'Summit' },
                    { value: 'basin', label: 'Basin' }, { value: 'dunes', label: 'Dunes' },
                    { value: 'random', label: 'Random' }] },
        { id: 'levels',    label: 'Contour levels', type: 'range', min: 6, max: 30, step: 1, value: 18, group: 'general' },
        { id: 'relief',    label: 'Relief / height', type: 'range', min: 20, max: 100, step: 5, value: 60, group: 'general' },
        { id: 'roughness', label: 'Roughness',       type: 'range', min: 0, max: 100, step: 5, value: 35, group: 'general' },
        { id: 'detail',    label: 'Detail',          type: 'range', min: 1, max: 100, step: 1, value: 50, group: 'general' },
        { id: 'indexEvery', label: 'Bold every Nth', type: 'range', min: 0, max: 8, step: 1, value: 4, group: 'general' }
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

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#10243a'];
        var bg = P.bgColor || '#ffffff';

        var ox = mp, oy = mp, dW = W - 2 * mp, dH = H - 2 * mp;
        // detail 1..100 → cell px 20..8 (higher detail = smaller cells)
        var cellPx = 20 - (Math.max(1, Math.min(100, P.detail)) / 100) * 12;
        var gCols = Math.max(8, Math.round(dW / cellPx));
        var gRows = Math.max(8, Math.round(dH / cellPx));
        var cW = dW / gCols, cH = dH / gRows;

        var terrainKey = P.terrain;
        if (terrainKey === 'random' || !TERRAINS[terrainKey]) terrainKey = TERRAIN_KEYS[seed % TERRAIN_KEYS.length];
        var basePeaks = TERRAINS[terrainKey];

        var reliefScale = P.relief / 60;     // 60 = nominal
        var noiseAmp = (P.roughness / 100) * 0.22;
        var n1 = makeNoise2D(rng, 7 + (seed % 3));
        var n2 = makeNoise2D(rng, 12 + (seed % 4));

        var peaks = basePeaks.map(function (p) {
            return {
                x: p.x + (rng() - 0.5) * 0.07, y: p.y + (rng() - 0.5) * 0.07,
                h: p.h * (0.88 + rng() * 0.24) * reliefScale, sx: p.sx, sy: p.sy
            };
        });

        var hts = [], hMin = Infinity, hMax = -Infinity;
        for (var row = 0; row <= gRows; row++) {
            hts[row] = [];
            for (var col = 0; col <= gCols; col++) {
                var h = evalHeight(col / gCols, row / gRows, peaks, noiseAmp, n1, n2);
                hts[row][col] = h;
                if (h < hMin) hMin = h; if (h > hMax) hMax = h;
            }
        }

        var nLevels = Math.max(2, Math.round(P.levels));
        var lo = hMin + (hMax - hMin) * 0.04;
        var hi = hMin + (hMax - hMin) * 0.96;
        var idxEvery = Math.round(P.indexEvery);

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        for (var lv = 0; lv < nLevels; lv++) {
            var thresh = lo + (hi - lo) * lv / (nLevels - 1);
            var isIdx = idxEvery > 0 && (lv % idxEvery === 0);
            var thick = (isIdx ? swIdx : sw).toFixed(2);
            var opacity = isIdx ? '' : ' opacity="0.72"';
            var stroke = (P.colorByBand === 'on') ? palette[lv % palette.length] : palette[0];

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
                '" stroke-width="' + thick + '"' + opacity + ' stroke-linecap="round"/>');
        }

        // Artboard edge frame — matches the built-in sketches' paper border.
        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'topo',
        description: 'Topographic contour map: marching-squares iso-contours with selectable terrain and relief.',
        stylePresets: [
            { label: 'Mountain range', values: { terrain:'range', levels:18, relief:60, roughness:35, indexEvery:4 } },
            { label: 'Lone summit', values: { terrain:'summit', levels:22, relief:70, indexEvery:5 } },
            { label: 'Caldera basin', values: { terrain:'basin', levels:20, relief:55, roughness:30 } },
            { label: 'Sand dunes', values: { terrain:'dunes', levels:16, relief:45, roughness:25 } }
        ],
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
