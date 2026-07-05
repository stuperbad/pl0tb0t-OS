/**
 * circuits — orthogonal PCB trace routing
 *
 * A grid of IC chip footprints is placed first and reserved; then a number
 * of "nets" are routed between random unblocked grid nodes using a
 * Manhattan (right-angle only) random walk biased toward the target, with
 * a `meander` probability of jogging onto the perpendicular axis instead of
 * stepping straight toward the goal (the thing that makes real PCB autorouters
 * — and this one — produce staircase detours instead of straight L-bends).
 * Traces optionally get their corners chamfered (cut at 45°) for a milled
 * look, gain via dots at bends, and solder pads at both ends. IC footprints
 * get a body outline plus tick-mark pins along their long edges.
 */
(function () {
    var paper = window.makeSketchUtils;
    var fills = window.plotFills; // unused for fills here (pure outline/stroke art), kept for parity

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    var STD_PAL = [
        { value: '#1a1a1a', label: 'Ink' }, { value: '#000000', label: 'Black' },
        { value: '#e63946', label: 'Red' }, { value: '#2196f3', label: 'Blue' },
        { value: '#ff9800', label: 'Orange' }, { value: '#4caf50', label: 'Green' },
        { value: '#9c27b0', label: 'Purple' }, { value: '#00bcd4', label: 'Cyan' },
        { value: '#c9952c', label: 'Gold' }, { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        pcb_green: { traceWidthMm: 0.6, gridPitchMm: 7, numNets: 26, numICs: 4, meander: 30, viaProb: 35,
                     cornerStyle: 'chamfered', colorMode: 'byNet', palette: ['#1f9e54', '#0c5c2e', '#16c172'], bgColor: '#0a1f12' },
        blueprint: { traceWidthMm: 0.5, gridPitchMm: 9, numNets: 18, numICs: 2, meander: 15, viaProb: 20,
                     cornerStyle: 'sharp', colorMode: 'single', palette: ['#bcd9f0'], bgColor: '#0e2238' },
        gold_trace: { traceWidthMm: 0.7, gridPitchMm: 8, numNets: 24, numICs: 3, meander: 35, viaProb: 40,
                     cornerStyle: 'chamfered', colorMode: 'byLength', palette: ['#c9952c', '#8a5a1f', '#e8c468'], bgColor: '#1a1208' },
        night_mode: { traceWidthMm: 0.55, gridPitchMm: 6, numNets: 34, numICs: 5, meander: 45, viaProb: 50,
                     cornerStyle: 'chamfered', colorMode: 'byNet', palette: ['#00e5ff', '#ff2bd6', '#fff200'], bgColor: '#070512' },
        mono: { traceWidthMm: 0.5, gridPitchMm: 10, numNets: 20, numICs: 3, meander: 20, viaProb: 25,
                     cornerStyle: 'sharp', colorMode: 'single', palette: ['#1a1a1a'], bgColor: '#f5f0e8' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'gridPitchMm', label: 'Grid pitch (mm)', type: 'range', min: 4, max: 14, step: 0.5, value: 8, group: 'general' },
        { id: 'numNets', label: 'Number of traces', type: 'range', min: 5, max: 50, step: 1, value: 22, group: 'general' },
        { id: 'numICs', label: 'Number of ICs', type: 'range', min: 0, max: 8, step: 1, value: 3, group: 'general' },
        { id: 'traceWidthMm', label: 'Trace width (mm)', type: 'range', min: 0.3, max: 1.5, step: 0.05, value: 0.6, group: 'general' },
        { id: 'meander', label: 'Meander %', type: 'range', min: 0, max: 100, step: 5, value: 30, group: 'general' },
        { id: 'viaProb', label: 'Via probability %', type: 'range', min: 0, max: 100, step: 5, value: 35, group: 'general' },
        { id: 'padStyle', label: 'Pad shape', type: 'select', value: 'circle', group: 'general',
          options: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }] },
        { id: 'cornerStyle', label: 'Corner style', type: 'select', value: 'chamfered', group: 'general',
          options: [{ value: 'sharp', label: 'Sharp' }, { value: 'chamfered', label: 'Chamfered' }] },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'byNet', group: 'color',
          options: [{ value: 'byNet', label: 'By net' }, { value: 'single', label: 'Single' }, { value: 'byLength', label: 'By length' }] }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

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
        var bg = P.bgColor || '#ffffff';
        var traceWidthPx = paper.mmToPixels(Math.max(0.2, Number(P.traceWidthMm) || 0.6));
        var meanderProb = clamp(Number(P.meander) || 0, 0, 100) / 100;
        var viaProb = clamp(Number(P.viaProb) || 0, 0, 100) / 100;

        var cellPx = paper.mmToPixels(Math.max(2, Number(P.gridPitchMm) || 8));
        var drawW = W - 2 * mp, drawH = H - 2 * mp;
        var cols = Math.max(4, Math.floor(drawW / cellPx));
        var rows = Math.max(4, Math.floor(drawH / cellPx));
        var gridW = cols * cellPx, gridH = rows * cellPx;
        var offX = mp + (drawW - gridW) / 2;
        var offY = mp + (drawH - gridH) / 2;

        function nodeX(c) { return offX + c * cellPx; }
        function nodeY(r) { return offY + r * cellPx; }

        // ── Place IC footprints (reserve a node bounding box each) ──────────
        var icRects = [];
        var attempts = 0, wanted = Math.round(Number(P.numICs) || 0);
        while (icRects.length < wanted && attempts < wanted * 25) {
            attempts++;
            var vertical = rng() < 0.5;
            var longCells = 4 + Math.floor(rng() * 6);   // 4-9
            var shortCells = 2 + Math.floor(rng() * 3);  // 2-4
            var icW = vertical ? shortCells : longCells;
            var icH = vertical ? longCells : shortCells;
            if (icW + 2 >= cols || icH + 2 >= rows) continue;
            var icCol = 1 + Math.floor(rng() * (cols - icW - 1));
            var icRow = 1 + Math.floor(rng() * (rows - icH - 1));
            var rect = { c0: icCol, r0: icRow, c1: icCol + icW, r1: icRow + icH, w: icW, h: icH };
            var overlaps = icRects.some(function (o) {
                return !(rect.c1 + 1 < o.c0 - 1 || rect.c0 - 1 > o.c1 + 1 || rect.r1 + 1 < o.r0 - 1 || rect.r0 - 1 > o.r1 + 1);
            });
            if (!overlaps) icRects.push(rect);
        }

        function blockedNode(c, r) {
            if (c < 0 || r < 0 || c > cols || r > rows) return true;
            for (var i = 0; i < icRects.length; i++) {
                var o = icRects[i];
                if (c >= o.c0 && c <= o.c1 && r >= o.r0 && r <= o.r1) return true;
            }
            return false;
        }

        // ── Route nets ────────────────────────────────────────────────────
        var maxStepsPerNet = (cols + rows) * 2;
        var totalPointBudget = 5500;
        var totalPoints = 0;
        var nets = [];

        function randomFreeNode() {
            for (var tries = 0; tries < 60; tries++) {
                var c = Math.floor(rng() * (cols + 1));
                var r = Math.floor(rng() * (rows + 1));
                if (!blockedNode(c, r)) return { c: c, r: r };
            }
            return null;
        }

        function routeNet(start, target) {
            var path = [{ c: start.c, r: start.r }];
            var cur = { c: start.c, r: start.r };
            var steps = 0;
            while ((cur.c !== target.c || cur.r !== target.r) && steps < maxStepsPerNet) {
                var dx = target.c - cur.c, dy = target.r - cur.r;
                var axis;
                if (dx === 0) axis = 'y';
                else if (dy === 0) axis = 'x';
                else {
                    var preferX = Math.abs(dx) >= Math.abs(dy);
                    axis = preferX ? 'x' : 'y';
                    if (rng() < meanderProb) axis = preferX ? 'y' : 'x';
                }
                var nc = cur.c, nr = cur.r;
                if (axis === 'x') nc += dx > 0 ? 1 : (dx < 0 ? -1 : (rng() < 0.5 ? 1 : -1));
                else nr += dy > 0 ? 1 : (dy < 0 ? -1 : (rng() < 0.5 ? 1 : -1));
                if (blockedNode(nc, nr)) {
                    var nc2 = cur.c, nr2 = cur.r;
                    if (axis === 'x') nr2 += dy > 0 ? 1 : (dy < 0 ? -1 : 0);
                    else nc2 += dx > 0 ? 1 : (dx < 0 ? -1 : 0);
                    if (!blockedNode(nc2, nr2) && (nc2 !== cur.c || nr2 !== cur.r)) { nc = nc2; nr = nr2; }
                    else break;
                }
                if (nc === cur.c && nr === cur.r) break;
                cur = { c: nc, r: nr };
                path.push({ c: nc, r: nr });
                steps++;
            }
            return path;
        }

        for (var n = 0; n < Math.round(Number(P.numNets) || 0); n++) {
            if (totalPoints >= totalPointBudget) break;
            var a = randomFreeNode(), b = randomFreeNode();
            if (!a || !b) continue;
            var path = routeNet(a, b);
            if (path.length < 2) continue;
            totalPoints += path.length;
            nets.push(path);
        }

        // ── Render ────────────────────────────────────────────────────────
        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function colorForNet(path, idx) {
            if (palette.length < 2 || P.colorMode === 'single') return palette[0];
            if (P.colorMode === 'byLength') {
                var bucket = path.length < 6 ? 0 : (path.length < 14 ? 1 : 2);
                return palette[bucket % palette.length];
            }
            return palette[idx % palette.length];
        }

        var chamferFrac = 0.3;
        function buildRenderPoints(path) {
            var pts = path.map(function (nd) { return { x: nodeX(nd.c), y: nodeY(nd.r) }; });
            if (P.cornerStyle !== 'chamfered' || pts.length < 3) return pts;
            var out = [pts[0]];
            for (var i = 1; i < pts.length - 1; i++) {
                var prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
                var d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
                var d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
                var len = Math.min(d1, d2) * chamferFrac;
                if (len < 0.5) { out.push(cur); continue; }
                out.push({ x: cur.x + (prev.x - cur.x) / d1 * len, y: cur.y + (prev.y - cur.y) / d1 * len });
                out.push({ x: cur.x + (next.x - cur.x) / d2 * len, y: cur.y + (next.y - cur.y) / d2 * len });
            }
            out.push(pts[pts.length - 1]);
            return out;
        }

        nets.forEach(function (path, idx) {
            var color = colorForNet(path, idx);
            var renderPts = buildRenderPoints(path);
            parts.push('<polyline points="' + renderPts.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
                '" fill="none" stroke="' + color + '" stroke-width="' + traceWidthPx.toFixed(2) +
                '" stroke-linecap="round" stroke-linejoin="miter"/>');

            // vias at interior bends
            for (var i = 1; i < path.length - 1; i++) {
                if (rng() < viaProb) {
                    var vx = nodeX(path[i].c), vy = nodeY(path[i].r);
                    parts.push('<circle cx="' + vx.toFixed(2) + '" cy="' + vy.toFixed(2) + '" r="' + (traceWidthPx * 1.4).toFixed(2) +
                        '" fill="none" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.7).toFixed(2) + '"/>');
                }
            }

            // pads at both ends
            [path[0], path[path.length - 1]].forEach(function (nd) {
                var px = nodeX(nd.c), py = nodeY(nd.r);
                var padR = traceWidthPx * 2.2;
                if (P.padStyle === 'square') {
                    var s = padR * 1.7;
                    parts.push('<rect x="' + (px - s / 2).toFixed(2) + '" y="' + (py - s / 2).toFixed(2) +
                        '" width="' + s.toFixed(2) + '" height="' + s.toFixed(2) +
                        '" fill="none" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.8).toFixed(2) + '"/>');
                } else {
                    parts.push('<circle cx="' + px.toFixed(2) + '" cy="' + py.toFixed(2) + '" r="' + padR.toFixed(2) +
                        '" fill="none" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.8).toFixed(2) + '"/>');
                }
            });
        });

        // ICs drawn last so they sit visually "on top" of any traces that pass near their footprint
        icRects.forEach(function (ic, idx) {
            var x0 = nodeX(ic.c0), y0 = nodeY(ic.r0), x1 = nodeX(ic.c1), y1 = nodeY(ic.r1);
            var color = palette[idx % palette.length];
            parts.push('<rect x="' + x0.toFixed(2) + '" y="' + y0.toFixed(2) + '" width="' + (x1 - x0).toFixed(2) +
                '" height="' + (y1 - y0).toFixed(2) + '" fill="' + bg + '" stroke="' + color +
                '" stroke-width="' + (traceWidthPx * 1.1).toFixed(2) + '"/>');

            var vertical = ic.h >= ic.w;
            var tick = cellPx * 0.32;
            if (vertical) {
                for (var r = ic.r0 + 1; r < ic.r1; r++) {
                    var y = nodeY(r);
                    parts.push('<line x1="' + (x0 - tick).toFixed(2) + '" y1="' + y.toFixed(2) + '" x2="' + x0.toFixed(2) + '" y2="' + y.toFixed(2) +
                        '" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.9).toFixed(2) + '" stroke-linecap="round"/>');
                    parts.push('<line x1="' + x1.toFixed(2) + '" y1="' + y.toFixed(2) + '" x2="' + (x1 + tick).toFixed(2) + '" y2="' + y.toFixed(2) +
                        '" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.9).toFixed(2) + '" stroke-linecap="round"/>');
                }
            } else {
                for (var c = ic.c0 + 1; c < ic.c1; c++) {
                    var x = nodeX(c);
                    parts.push('<line x1="' + x.toFixed(2) + '" y1="' + (y0 - tick).toFixed(2) + '" x2="' + x.toFixed(2) + '" y2="' + y0.toFixed(2) +
                        '" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.9).toFixed(2) + '" stroke-linecap="round"/>');
                    parts.push('<line x1="' + x.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x.toFixed(2) + '" y2="' + (y1 + tick).toFixed(2) +
                        '" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.9).toFixed(2) + '" stroke-linecap="round"/>');
                }
            }
            // pin-1 marker
            var notchR = cellPx * 0.1;
            parts.push('<circle cx="' + (x0 + notchR * 1.6).toFixed(2) + '" cy="' + (y0 + notchR * 1.6).toFixed(2) + '" r="' + notchR.toFixed(2) +
                '" fill="none" stroke="' + color + '" stroke-width="' + (traceWidthPx * 0.8).toFixed(2) + '"/>');
        });

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'circuits',
        description: 'Orthogonal PCB trace routing — Manhattan-walked nets between solder pads, with vias, chamfered corners, and tick-pin IC footprints.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'PCB green', values: { gridPitchMm: 7, numNets: 26, numICs: 4, meander: 30, viaProb: 35, cornerStyle: 'chamfered', colorMode: 'byNet' } },
            { label: 'Blueprint', values: { gridPitchMm: 9, numNets: 18, numICs: 2, meander: 15, viaProb: 20, cornerStyle: 'sharp', colorMode: 'single' } },
            { label: 'Gold trace', values: { gridPitchMm: 8, numNets: 24, numICs: 3, meander: 35, viaProb: 40, cornerStyle: 'chamfered', colorMode: 'byLength' } },
            { label: 'Night mode', values: { gridPitchMm: 6, numNets: 34, numICs: 5, meander: 45, viaProb: 50, cornerStyle: 'chamfered', colorMode: 'byNet' } },
            { label: 'Mono ink', values: { gridPitchMm: 10, numNets: 20, numICs: 3, meander: 20, viaProb: 25, cornerStyle: 'sharp', colorMode: 'single' } }
        ],
        generate: generate
    };
})();
