/**
 * turing — reaction-diffusion Turing patterns (parametric)
 *
 * A Gray-Scott reaction-diffusion chemical system is simulated on a coarse
 * grid (two interacting "chemicals" U and V diffusing and reacting for
 * thousands of steps), then the resulting V concentration field is sliced
 * with marching-squares iso-contours, the same way a height field would be.
 * Depending on the feed/kill rate pair the settled pattern reads as leopard
 * spots, a labyrinthine maze, branching coral, or negative-space holes —
 * the classic Turing-pattern families from morphogenesis.
 */
(function () {
    var paper = window.makeSketchUtils;
    var fills = window.plotFills;

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

    // Classic Gray-Scott feed(F)/kill(k) pairs producing distinct settled patterns.
    var PATTERN_FK = {
        spots: { F: 0.035, k: 0.065 },
        maze:  { F: 0.029, k: 0.057 },
        coral: { F: 0.0545, k: 0.062 },
        holes: { F: 0.039, k: 0.058 }
    };
    var PATTERN_KEYS = Object.keys(PATTERN_FK);

    function simulateReactionDiffusion(simCols, simRows, F, k, steps, seedBlobs, rng) {
        var N = simCols * simRows;
        var U = new Float32Array(N), V = new Float32Array(N);
        var U2 = new Float32Array(N), V2 = new Float32Array(N);
        for (var i = 0; i < N; i++) U[i] = 1;

        for (var b = 0; b < seedBlobs; b++) {
            var cx = Math.floor(rng() * simCols), cy = Math.floor(rng() * simRows);
            var r = 2 + Math.floor(rng() * 4);
            for (var dy = -r; dy <= r; dy++) {
                for (var dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy > r * r) continue;
                    var xx = ((cx + dx) % simCols + simCols) % simCols;
                    var yy = ((cy + dy) % simRows + simRows) % simRows;
                    var idx = yy * simCols + xx;
                    U[idx] = 0.5; V[idx] = 0.25;
                }
            }
        }

        var xL = new Int32Array(simCols), xR = new Int32Array(simCols);
        for (var x = 0; x < simCols; x++) { xL[x] = (x - 1 + simCols) % simCols; xR[x] = (x + 1) % simCols; }
        var yUp = new Int32Array(simRows), yDown = new Int32Array(simRows);
        for (var y = 0; y < simRows; y++) { yUp[y] = (y - 1 + simRows) % simRows; yDown[y] = (y + 1) % simRows; }

        var Du = 1.0, Dv = 0.5, dt = 1.0;
        for (var s = 0; s < steps; s++) {
            for (var yy2 = 0; yy2 < simRows; yy2++) {
                var rowBase = yy2 * simCols;
                var upBase = yUp[yy2] * simCols, downBase = yDown[yy2] * simCols;
                for (var xx2 = 0; xx2 < simCols; xx2++) {
                    var idx2 = rowBase + xx2;
                    var u = U[idx2], v = V[idx2];
                    var xl = xL[xx2], xr = xR[xx2];
                    // Weighted 9-point Laplacian (center -1, cardinal 0.2, diagonal 0.05) —
                    // the standard stable Gray-Scott stencil; a plain 5-point sum blows up
                    // at these diffusion rates with dt=1.
                    var lapU = -u + 0.2 * (U[rowBase + xl] + U[rowBase + xr] + U[upBase + xx2] + U[downBase + xx2]) +
                                0.05 * (U[upBase + xl] + U[upBase + xr] + U[downBase + xl] + U[downBase + xr]);
                    var lapV = -v + 0.2 * (V[rowBase + xl] + V[rowBase + xr] + V[upBase + xx2] + V[downBase + xx2]) +
                                0.05 * (V[upBase + xl] + V[upBase + xr] + V[downBase + xl] + V[downBase + xr]);
                    var uvv = u * v * v;
                    U2[idx2] = u + (Du * lapU - uvv + F * (1 - u)) * dt;
                    V2[idx2] = v + (Dv * lapV + uvv - (F + k) * v) * dt;
                }
            }
            var t1 = U; U = U2; U2 = t1;
            var t2 = V; V = V2; V2 = t2;
        }
        return V;
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#1a1a1a', label: 'Charcoal' },
        { value: '#7a0c1e', label: 'Oxblood' }, { value: '#10243a', label: 'Navy' },
        { value: '#0d1a0d', label: 'Forest' }, { value: '#8b4513', label: 'Brown' },
        { value: '#2980b9', label: 'Blue' }, { value: '#cc2200', label: 'Rust' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        spots: { pattern: 'spots', palette: ['#1a1a1a'], bgColor: '#f5f0e8', levels: 12, seedBlobs: 25, steps: 3000, gridDetail: 55 },
        maze:  { pattern: 'maze',  palette: ['#10243a'], bgColor: '#eef6fb', levels: 14, seedBlobs: 8,  steps: 4000, gridDetail: 60 },
        coral: { pattern: 'coral', palette: ['#7a0c1e'], bgColor: '#fff6ee', levels: 10, seedBlobs: 14, steps: 10000, gridDetail: 55 },
        holes: { pattern: 'holes', palette: ['#0d1a0d'], bgColor: '#f2f5ea', levels: 10, seedBlobs: 20, steps: 3500, gridDetail: 50 }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'colorByBand', label: 'Color by band', type: 'select', value: 'off', group: 'color',
          options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
        { id: 'pattern', label: 'Pattern', type: 'select', value: 'maze', group: 'general',
          options: [{ value: 'spots', label: 'Spots' }, { value: 'maze', label: 'Maze' },
                    { value: 'coral', label: 'Coral' }, { value: 'holes', label: 'Holes' },
                    { value: 'random', label: 'Random' }] },
        { id: 'feedJitter', label: 'Chemistry jitter', type: 'range', min: 0, max: 100, step: 5, value: 30, group: 'general' },
        { id: 'gridDetail', label: 'Detail', type: 'range', min: 1, max: 100, step: 1, value: 55, group: 'general' },
        { id: 'steps', label: 'Growth steps', type: 'range', min: 500, max: 12000, step: 100, value: 3000, group: 'general' },
        { id: 'seedBlobs', label: 'Seed points', type: 'range', min: 1, max: 40, step: 1, value: 12, group: 'general' },
        { id: 'levels', label: 'Contour levels', type: 'range', min: 4, max: 24, step: 1, value: 14, group: 'general' },
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

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#f5f0e8';

        var ox = mp, oy = mp, dW = W - 2 * mp, dH = H - 2 * mp;

        var cellPx = 14 - (Math.max(1, Math.min(100, P.gridDetail)) / 100) * 8;
        var gCols = Math.max(8, Math.min(160, Math.round(dW / cellPx)));
        var gRows = Math.max(8, Math.min(160, Math.round(dH / cellPx)));
        var cW = dW / gCols, cH = dH / gRows;
        var simCols = gCols + 1, simRows = gRows + 1;

        var patternKey = P.pattern;
        if (patternKey === 'random' || !PATTERN_FK[patternKey]) patternKey = PATTERN_KEYS[seed % PATTERN_KEYS.length];
        var fk = PATTERN_FK[patternKey];
        var jitterAmt = (P.feedJitter / 100) * 0.15;
        var F = fk.F * (1 + (rng() - 0.5) * jitterAmt);
        var kk = fk.k * (1 + (rng() - 0.5) * jitterAmt);

        var steps = Math.max(100, Math.round(P.steps));
        var seedBlobs = Math.max(1, Math.round(P.seedBlobs));

        var V = simulateReactionDiffusion(simCols, simRows, F, kk, steps, seedBlobs, rng);

        var hts = [];
        var hMin = Infinity, hMax = -Infinity;
        for (var row = 0; row <= gRows; row++) {
            hts[row] = [];
            for (var col = 0; col <= gCols; col++) {
                var h = V[row * simCols + col];
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
            var opacity = isIdx ? '' : ' opacity="0.75"';
            var stroke = (P.colorByBand === 'on') ? palette[lv % palette.length] : palette[0];

            var d = '';
            for (var r = 0; r < gRows; r++) {
                for (var c = 0; c < gCols; c++) {
                    var kase = (hts[r][c] > thresh ? 1 : 0) | (hts[r][c + 1] > thresh ? 2 : 0) |
                               (hts[r + 1][c + 1] > thresh ? 4 : 0) | (hts[r + 1][c] > thresh ? 8 : 0);
                    var msegs = MS[kase];
                    for (var s2 = 0; s2 < msegs.length; s2++) {
                        var pa = edgePt(c, r, msegs[s2][0], hts, thresh, ox, oy, cW, cH);
                        var pb = edgePt(c, r, msegs[s2][1], hts, thresh, ox, oy, cW, cH);
                        d += 'M' + pa.x.toFixed(1) + ',' + pa.y.toFixed(1) + 'L' + pb.x.toFixed(1) + ',' + pb.y.toFixed(1);
                    }
                }
            }
            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + stroke +
                '" stroke-width="' + thick + '"' + opacity + ' stroke-linecap="round"/>');
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'turing',
        description: 'Reaction-diffusion Turing patterns: a simulated Gray-Scott chemical system, contoured into iso-lines.',
        stylePresets: [
            { label: 'Leopard spots', values: { pattern: 'spots', levels: 12, seedBlobs: 25, steps: 3000 } },
            { label: 'Maze / fingerprint', values: { pattern: 'maze', levels: 14, seedBlobs: 8, steps: 4000 } },
            { label: 'Coral growth', values: { pattern: 'coral', levels: 10, seedBlobs: 14, steps: 10000, palette: ['#7a0c1e'] } },
            { label: 'Bubbling holes', values: { pattern: 'holes', levels: 10, seedBlobs: 20, steps: 3500 } }
        ],
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
