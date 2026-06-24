/**
 * truchet — tile arcs / diagonals (parametric)
 *
 * A grid of two-orientation tiles (quarter-circle arcs, diagonal lines, or a
 * mix) forming continuous flowing line-work. Tile size, line weight, pattern
 * bias, tile type, color mode and border are exposed. Headless: generate(seed,'maze').
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

    var PRESETS = {
        maze:      { palette: ['#1a1a1a'], cellSize: 7,  curviness: 'arcs' },
        circuit:   { palette: ['#1b9e5a'], cellSize: 9,  curviness: 'mixed' },
        linen:     { palette: ['#2d2416'], cellSize: 13, curviness: 'diagonals' },
        blueprint: { palette: ['#2a6fb0'], cellSize: 8,  curviness: 'arcs' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#ffffff', group: 'advanced' },
        { id: 'fillStyle', label: 'Cell fills', type: 'select', multiSelect: true, value: [], group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'single', group: 'color',
          options: [{ value: 'single', label: 'Single' }, { value: 'random', label: 'Random' }, { value: 'checker', label: 'Checker' }] },
        { id: 'cellSize',   label: 'Tile size (mm)', type: 'range', min: 4, max: 20, step: 1, value: 9, group: 'general' },
        { id: 'curviness', label: 'Tile type', type: 'select', value: 'arcs', group: 'general',
          options: [{ value: 'arcs', label: 'Arcs' }, { value: 'diagonals', label: 'Diagonals' }, { value: 'mixed', label: 'Mixed' }] },
        { id: 'biasSplit', label: 'Pattern bias', type: 'range', min: 0, max: 100, step: 5, value: 50, group: 'general' },
        { id: 'border', label: 'Border', type: 'select', value: 'on', group: 'general',
          options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] }
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

        var cellPx = paper.mmToPixels(Math.max(2, Number(P.cellSize)));
        var R = cellPx / 2;
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#ffffff';
        var fillStyles = (Array.isArray(P.fillStyle) ? P.fillStyle : (P.fillStyle ? [P.fillStyle] : [])).filter(function (x) { return x && x !== 'none'; });
        var fillSpacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
        var fillProb = fills.getFillProb();
        var fillAngle = fills.getFillAngle();
        var bias = Math.max(0, Math.min(1, Number(P.biasSplit) / 100));

        var drawW = W - 2 * mp, drawH = H - 2 * mp;
        var cols = Math.ceil(drawW / cellPx), rows = Math.ceil(drawH / cellPx);
        var offX = mp + (drawW - cols * cellPx) / 2;
        var offY = mp + (drawH - rows * cellPx) / 2;
        var gridW = cols * cellPx, gridH = rows * cellPx;

        function colorFor(row, col) {
            if (palette.length < 2 || P.colorMode === 'single') return palette[0];
            if (P.colorMode === 'checker') return palette[(row + col) % palette.length];
            return palette[Math.floor(rng() * palette.length)];
        }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>',
            '<clipPath id="gc"><rect x="' + offX.toFixed(2) + '" y="' + offY.toFixed(2) +
                '" width="' + gridW.toFixed(2) + '" height="' + gridH.toFixed(2) + '"/></clipPath>',
            '<g clip-path="url(#gc)">'
        ];

        for (var row = 0; row < rows; row++) {
            for (var col = 0; col < cols; col++) {
                var cx = offX + col * cellPx, cy = offY + row * cellPx;
                var topX = cx + R, topY = cy;
                var rgtX = cx + cellPx, rgtY = cy + R;
                var botX = cx + R, botY = cy + cellPx;
                var lftX = cx, lftY = cy + R;
                var typeA = rng() < bias;
                var color = colorFor(row, col);

                var mode = P.curviness;
                if (mode === 'mixed') mode = (rng() < 0.5) ? 'arcs' : 'diagonals';

                var d;
                if (mode === 'diagonals') {
                    d = typeA
                        ? 'M ' + topX.toFixed(2) + ' ' + topY.toFixed(2) + ' L ' + rgtX.toFixed(2) + ' ' + rgtY.toFixed(2) +
                          ' M ' + botX.toFixed(2) + ' ' + botY.toFixed(2) + ' L ' + lftX.toFixed(2) + ' ' + lftY.toFixed(2)
                        : 'M ' + topX.toFixed(2) + ' ' + topY.toFixed(2) + ' L ' + lftX.toFixed(2) + ' ' + lftY.toFixed(2) +
                          ' M ' + botX.toFixed(2) + ' ' + botY.toFixed(2) + ' L ' + rgtX.toFixed(2) + ' ' + rgtY.toFixed(2);
                } else {
                    d = typeA
                        ? 'M ' + topX.toFixed(2) + ' ' + topY.toFixed(2) + ' A ' + R.toFixed(2) + ' ' + R.toFixed(2) + ' 0 0 0 ' +
                          rgtX.toFixed(2) + ' ' + rgtY.toFixed(2) + ' M ' + botX.toFixed(2) + ' ' + botY.toFixed(2) +
                          ' A ' + R.toFixed(2) + ' ' + R.toFixed(2) + ' 0 0 0 ' + lftX.toFixed(2) + ' ' + lftY.toFixed(2)
                        : 'M ' + topX.toFixed(2) + ' ' + topY.toFixed(2) + ' A ' + R.toFixed(2) + ' ' + R.toFixed(2) + ' 0 0 1 ' +
                          lftX.toFixed(2) + ' ' + lftY.toFixed(2) + ' M ' + botX.toFixed(2) + ' ' + botY.toFixed(2) +
                          ' A ' + R.toFixed(2) + ' ' + R.toFixed(2) + ' 0 0 1 ' + rgtX.toFixed(2) + ' ' + rgtY.toFixed(2);
                }

                if (fillStyles.length && rng() < fillProb) {
                    var cellPoly = [{ x: cx, y: cy }, { x: cx + cellPx, y: cy }, { x: cx + cellPx, y: cy + cellPx }, { x: cx, y: cy + cellPx }];
                    var fSeed = (seed ^ (row * 73856093) ^ (col * 19349663)) >>> 0;
                    fills.fillPolyMultiD(cellPoly, fillStyles, fillAngle, fillSpacing, fSeed).forEach(function (fd) {
                        parts.push('<path d="' + fd + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                    });
                }
                parts.push('<path d="' + d + '" fill="none" stroke="' + color +
                    '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
            }
        }

        parts.push('</g>');
        if (P.border === 'on') {
            parts.push('<rect x="' + offX.toFixed(2) + '" y="' + offY.toFixed(2) +
                '" width="' + gridW.toFixed(2) + '" height="' + gridH.toFixed(2) +
                '" fill="none" stroke="' + palette[0] + '" stroke-width="' + sw.toFixed(2) + '"/>');
        }
        // Artboard edge frame — matches the built-in sketches' paper border.
        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'truchet',
        description: 'Truchet tiles: arcs or diagonals in a two-orientation grid forming flowing maze/weave line-work.',
        stylePresets: [
            { label: 'Maze arcs', values: { curviness:'arcs', cellSize:7, biasSplit:50, colorMode:'single' } },
            { label: 'Diagonal weave', values: { curviness:'diagonals', cellSize:11, biasSplit:50 } },
            { label: 'Mixed circuit', values: { curviness:'mixed', cellSize:9, colorMode:'random', biasSplit:55 } },
            { label: 'Big checker', values: { curviness:'arcs', cellSize:16, colorMode:'checker', biasSplit:50 } }
        ],
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
