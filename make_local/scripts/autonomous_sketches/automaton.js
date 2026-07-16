/**
 * automaton — elementary cellular automaton (parametric)
 *
 * Wolfram's 1D elementary cellular automata (rule 0-255): a single row of
 * binary cells evolves generation by generation according to a fixed 3-neighbor
 * rule, each new row stacked below the last. Depending on the rule this ranges
 * from a clean Sierpinski fractal (rule 90) to dense chaotic noise (rule 30)
 * to structured "edge of chaos" gliders (rule 110). Live cells are drawn as
 * inset square/circle/diamond tiles, outline-only or filled via the shared
 * fills library, colored flat, by generation, by local neighborhood, or random.
 */
(function () {
    var paper = window.makeSketchUtils;
    var fills = window.plotFills;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    var STD_PAL = [
        { value: '#1a1a1a', label: 'Ink' }, { value: '#000000', label: 'Black' },
        { value: '#e63946', label: 'Red' }, { value: '#2196f3', label: 'Blue' },
        { value: '#ff9800', label: 'Orange' }, { value: '#4caf50', label: 'Green' },
        { value: '#9c27b0', label: 'Purple' }, { value: '#00bcd4', label: 'Cyan' },
        { value: '#2d2416', label: 'Sepia' }, { value: 'custom', label: 'Custom' }
    ];

    // Standard Wolfram elementary-CA lookup table: bit i of `rule` gives the
    // new state for neighborhood value i (000..111 -> bits 0..7).
    function ruleTable(rule) {
        var t = new Array(8);
        for (var i = 0; i < 8; i++) t[i] = (rule >> i) & 1;
        return t;
    }

    function neighborIdx(row, c, cols, wrap) {
        var l = wrap ? row[(c - 1 + cols) % cols] : (c > 0 ? row[c - 1] : 0);
        var ctr = row[c];
        var r = wrap ? row[(c + 1) % cols] : (c < cols - 1 ? row[c + 1] : 0);
        return (l << 2) | (ctr << 1) | r;
    }

    function stepRow(row, table, cols, wrap) {
        var next = new Array(cols);
        for (var i = 0; i < cols; i++) next[i] = table[neighborIdx(row, i, cols, wrap)];
        return next;
    }

    function initRow(n, mode, rng) {
        var row = new Array(n), i;
        if (mode === 'random') {
            for (i = 0; i < n; i++) row[i] = rng() < 0.5 ? 1 : 0;
        } else if (mode === 'symmetric') {
            var half = Math.ceil(n / 2), left = [];
            for (i = 0; i < half; i++) left.push(rng() < 0.35 ? 1 : 0);
            for (i = 0; i < n; i++) row[i] = i < half ? left[i] : left[n - 1 - i];
        } else {
            for (i = 0; i < n; i++) row[i] = 0;
            row[Math.floor(n / 2)] = 1;
        }
        return row;
    }

    var PRESETS = {
        cascade:    { rule: 30,  gridCols: 81, gridRows: 60, initMode: 'single', cellShape: 'square', colorMode: 'mono', fillStyle: 'none', palette: ['#1a1a1a'], bgColor: '#f5f0e8' },
        sierpinski: { rule: 90,  gridCols: 81, gridRows: 60, initMode: 'single', cellShape: 'square', colorMode: 'byRow', fillStyle: 'none', palette: ['#2d2416', '#8a5a2b', '#c98a3d'], bgColor: '#f7f2e6' },
        gliders:    { rule: 110, gridCols: 90, gridRows: 70, initMode: 'random', wrapEdges: 'wrap', cellShape: 'square', colorMode: 'byNeighborhood', fillStyle: 'none', palette: ['#10243a', '#2a6fb0', '#7fb8e6'], bgColor: '#eef6fb' },
        arrows:     { rule: 54,  gridCols: 60, gridRows: 46, initMode: 'single', cellShape: 'diamond', colorMode: 'mono', fillStyle: 'none', palette: ['#e63946'], bgColor: '#1a1a1a' },
        lace:       { rule: 122, gridCols: 55, gridRows: 42, initMode: 'random', wrapEdges: 'wrap', cellShape: 'circle', colorMode: 'random', cellGap: 0.3, fillStyle: 'none', palette: ['#4caf50', '#9c27b0', '#ff9800'], bgColor: '#121212' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'mono', group: 'color',
          options: [ { value: 'mono', label: 'Single ink' }, { value: 'byRow', label: 'By generation' },
                     { value: 'byNeighborhood', label: 'By neighborhood' }, { value: 'random', label: 'Random' } ] },
        { id: 'rule', label: 'Rule (0-255)', type: 'range', min: 0, max: 255, step: 1, value: 30, group: 'general' },
        { id: 'gridCols', label: 'Columns', type: 'range', min: 20, max: 110, step: 1, value: 70, group: 'general' },
        { id: 'gridRows', label: 'Rows', type: 'range', min: 20, max: 110, step: 1, value: 70, group: 'general' },
        { id: 'initMode', label: 'Seed row', type: 'select', value: 'single', group: 'general',
          options: [ { value: 'single', label: 'Single cell' }, { value: 'random', label: 'Random' }, { value: 'symmetric', label: 'Symmetric' } ] },
        { id: 'wrapEdges', label: 'Edges', type: 'select', value: 'wrap', group: 'general',
          options: [ { value: 'wrap', label: 'Wrap' }, { value: 'dead', label: 'Dead' } ] },
        { id: 'cellShape', label: 'Cell shape', type: 'select', value: 'square', group: 'general',
          options: [ { value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' }, { value: 'diamond', label: 'Diamond' } ] },
        { id: 'cellGap', label: 'Cell gap', type: 'range', min: 0, max: 0.6, step: 0.02, value: 0.16, group: 'general' },
        { id: 'fillStyle', label: 'Cell fill', type: 'select', value: 'none', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function cellPoly(shape, cx, cy, halfW, halfH) {
        if (shape === 'circle') {
            var n = 16, pts = [], r = Math.min(halfW, halfH);
            for (var i = 0; i < n; i++) {
                var a = (Math.PI * 2 * i) / n;
                pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
            }
            return pts;
        }
        if (shape === 'diamond') {
            return [ { x: cx, y: cy - halfH }, { x: cx + halfW, y: cy }, { x: cx, y: cy + halfH }, { x: cx - halfW, y: cy } ];
        }
        return [ { x: cx - halfW, y: cy - halfH }, { x: cx + halfW, y: cy - halfH }, { x: cx + halfW, y: cy + halfH }, { x: cx - halfW, y: cy + halfH } ];
    }

    function polyD(pts) {
        return 'M ' + pts.map(function (p) { return p.x.toFixed(2) + ' ' + p.y.toFixed(2); }).join(' L ') + ' Z';
    }

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
        var bg = P.bgColor || '#f5f0e8';

        var cols = Math.max(4, Math.round(Number(P.gridCols) || 70));
        var rows = Math.max(4, Math.round(Number(P.gridRows) || 70));
        var rule = Math.max(0, Math.min(255, Math.round(Number(P.rule))));
        var table = ruleTable(rule);
        var wrap = P.wrapEdges !== 'dead';

        var drawW = W - 2 * mp, drawH = H - 2 * mp;
        var cellW = drawW / cols, cellH = drawH / rows;
        var gap = Math.max(0, Math.min(0.9, Number(P.cellGap)));
        var halfW = (cellW / 2) * (1 - gap), halfH = (cellH / 2) * (1 - gap);

        var fillStyle = P.fillStyle;
        var fillSpacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
        var fillAngle = fills.getFillAngle();

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        var row = initRow(cols, P.initMode, rng);
        for (var r = 0; r < rows; r++) {
            var cy = mp + r * cellH + cellH / 2;
            for (var c = 0; c < cols; c++) {
                if (!row[c]) continue;
                var cx = mp + c * cellW + cellW / 2;
                var nIdx = neighborIdx(row, c, cols, wrap);

                var color;
                if (palette.length < 2 || P.colorMode === 'mono') color = palette[0];
                else if (P.colorMode === 'byRow') color = palette[Math.floor((r / rows) * palette.length) % palette.length];
                else if (P.colorMode === 'byNeighborhood') color = palette[nIdx % palette.length];
                else color = palette[Math.floor(rng() * palette.length)];

                var poly = cellPoly(P.cellShape, cx, cy, halfW, halfH);

                if (fillStyle && fillStyle !== 'none') {
                    var fSeed = (seed ^ (r * 73856093) ^ (c * 19349663)) >>> 0;
                    fills.fillPolyD(poly, fillStyle, fillAngle, fillSpacing, fSeed).forEach(function (d) {
                        parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                    });
                }
                parts.push('<path d="' + polyD(poly) + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');
            }
            row = stepRow(row, table, cols, wrap);
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'automaton',
        description: 'Wolfram elementary cellular automata (rule 0-255): a seed row evolves generation by generation into fractal, chaotic, or structured tile patterns.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Chaos cascade', values: { rule: 30, initMode: 'single', cellShape: 'square', colorMode: 'mono' } },
            { label: 'Sierpinski', values: { rule: 90, initMode: 'single', cellShape: 'square', colorMode: 'byRow' } },
            { label: 'Glider lattice', values: { rule: 110, initMode: 'random', wrapEdges: 'wrap', cellShape: 'square', colorMode: 'byNeighborhood' } },
            { label: 'Arrows', values: { rule: 54, initMode: 'single', cellShape: 'diamond', colorMode: 'mono' } },
            { label: 'Lace circles', values: { rule: 122, initMode: 'random', wrapEdges: 'wrap', cellShape: 'circle', colorMode: 'random', cellGap: 0.3 } }
        ],
        generate: generate
    };
})();
