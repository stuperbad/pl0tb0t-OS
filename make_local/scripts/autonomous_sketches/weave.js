/**
 * weave — interlaced ribbon textile (plain / twill / basket)
 *
 * A grid of vertical and horizontal ribbons cross each other like threads on
 * a loom. At every crossing exactly one ribbon is "over" (drawn full width)
 * and the other is "under" (drawn with a gap exactly the width of the ribbon
 * on top), so the line-work itself reads as in/out interlacing with no need
 * for occlusion tricks. Which ribbon wins each crossing is decided by a
 * selectable weave rule: plain (1-over-1-under checkerboard), twill
 * (diagonal stagger, herringbone-like), or basket (NxN block alternation).
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

    function rectPoly(x0, y0, x1, y1) {
        return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    }

    function isVerticalOver(r, c, weaveType, twillPeriod, blockSize) {
        if (weaveType === 'twill') {
            var p = Math.max(2, twillPeriod);
            var overW = Math.ceil(p / 2);
            var phase = (((r - c) % p) + p) % p;
            return phase < overW;
        }
        if (weaveType === 'basket') {
            var b = Math.max(1, blockSize);
            return (Math.floor(r / b) + Math.floor(c / b)) % 2 === 0;
        }
        return (r + c) % 2 === 0;
    }

    var PRESETS = {
        plain:     { weaveType: 'plain', cellSize: 10, ribbonWidthFrac: 0.8, fillStyle: 'hatch',
                     colorMode: 'byDirection', palette: ['#a4493b', '#3b6b54'], bgColor: '#f3ead9' },
        twill:     { weaveType: 'twill', twillPeriod: 4, cellSize: 8, ribbonWidthFrac: 0.85, fillStyle: 'hatch',
                     colorMode: 'single', palette: ['#16314f'], bgColor: '#eef3f8' },
        basket:    { weaveType: 'basket', blockSize: 2, cellSize: 12, ribbonWidthFrac: 0.82, fillStyle: 'crosshatch',
                     colorMode: 'checkerboard', palette: ['#5b3a29', '#caa86a'], bgColor: '#f6efe2' },
        blueprint: { weaveType: 'plain', cellSize: 11, ribbonWidthFrac: 0.78, fillStyle: 'none',
                     colorMode: 'single', palette: ['#bcd9f0'], bgColor: '#0e2238' },
        tapestry:  { weaveType: 'basket', blockSize: 3, cellSize: 9, ribbonWidthFrac: 0.85, fillStyle: 'hatch',
                     colorMode: 'byIndex', palette: ['#a4493b', '#3b6b54', '#c98a2c', '#3a4f7a'], bgColor: '#f3ead9' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'weaveType', label: 'Weave', type: 'select', value: 'plain', group: 'general',
          options: [{ value: 'plain', label: 'Plain' }, { value: 'twill', label: 'Twill' }, { value: 'basket', label: 'Basket' }] },
        { id: 'cellSize', label: 'Ribbon pitch (mm)', type: 'range', min: 5, max: 22, step: 1, value: 10, group: 'general' },
        { id: 'ribbonWidthFrac', label: 'Ribbon width', type: 'range', min: 0.4, max: 0.95, step: 0.05, value: 0.8, group: 'general' },
        { id: 'twillPeriod', label: 'Twill period', type: 'range', min: 2, max: 6, step: 1, value: 4, group: 'general' },
        { id: 'blockSize', label: 'Basket block', type: 'range', min: 1, max: 4, step: 1, value: 2, group: 'general' },
        { id: 'fillStyle', label: 'Ribbon fill', type: 'select', value: 'hatch', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'byDirection', group: 'color',
          options: [{ value: 'single', label: 'Single' }, { value: 'byDirection', label: 'By direction' },
                     { value: 'byIndex', label: 'By ribbon index' }, { value: 'checkerboard', label: 'By over/under' }] },
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
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#ffffff';
        var fillStyle = P.fillStyle && P.fillStyle !== 'none' ? P.fillStyle : null;
        var fillSpacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());

        var cellPx = paper.mmToPixels(Math.max(2, Number(P.cellSize)));
        var drawW = W - 2 * mp, drawH = H - 2 * mp;
        var cols = Math.max(1, Math.floor(drawW / cellPx));
        var rows = Math.max(1, Math.floor(drawH / cellPx));
        var gridW = cols * cellPx, gridH = rows * cellPx;
        var offX = mp + (drawW - gridW) / 2;
        var offY = mp + (drawH - gridH) / 2;

        var R = Math.min(cellPx * 0.48, (Number(P.ribbonWidthFrac) || 0.8) * cellPx / 2);
        var weaveType = P.weaveType, twillPeriod = Number(P.twillPeriod) || 4, blockSize = Number(P.blockSize) || 2;

        function colorFor(orientation, idx, over) {
            if (palette.length < 2 || P.colorMode === 'single') return palette[0];
            if (P.colorMode === 'byDirection') return orientation === 'v' ? palette[0] : palette[1 % palette.length];
            if (P.colorMode === 'checkerboard') return over ? palette[0] : palette[1 % palette.length];
            return palette[idx % palette.length];
        }

        function emitRect(x0, y0, x1, y1, color, fSeed) {
            if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return;
            var poly = rectPoly(x0, y0, x1, y1);
            if (fillStyle) {
                var angle = (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) ? 90 : 0;
                fills.fillPolyD(poly, fillStyle, angle, fillSpacing, fSeed).forEach(function (d) {
                    parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                });
            }
            parts.push('<polygon points="' + poly.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
                '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');
        }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>',
            '<clipPath id="gc"><rect x="' + offX.toFixed(2) + '" y="' + offY.toFixed(2) +
                '" width="' + gridW.toFixed(2) + '" height="' + gridH.toFixed(2) + '"/></clipPath>',
            '<g clip-path="url(#gc)">'
        ];

        var unders = [], overs = [];

        for (var c = 0; c < cols; c++) {
            var cx = offX + (c + 0.5) * cellPx;
            for (var r = 0; r < rows; r++) {
                var rowTop = offY + r * cellPx, rowBot = offY + (r + 1) * cellPx;
                var crossTop = offY + (r + 0.5) * cellPx - R, crossBot = offY + (r + 0.5) * cellPx + R;
                var over = isVerticalOver(r, c, weaveType, twillPeriod, blockSize);
                var color = colorFor('v', c, over);
                var fSeed = (seed ^ (r * 73856093) ^ (c * 19349663) ^ 1) >>> 0;
                if (over) {
                    overs.push(function (x0, y0, x1, y1, col, fs) { return function () { emitRect(x0, y0, x1, y1, col, fs); }; }(cx - R, rowTop, cx + R, rowBot, color, fSeed));
                } else {
                    unders.push(function (x0, y0, x1, y1, col, fs) { return function () { emitRect(x0, y0, x1, y1, col, fs); }; }(cx - R, rowTop, cx + R, crossTop, color, fSeed));
                    unders.push(function (x0, y0, x1, y1, col, fs) { return function () { emitRect(x0, y0, x1, y1, col, fs); }; }(cx - R, crossBot, cx + R, rowBot, color, fSeed ^ 7));
                }
            }
        }

        for (var r2 = 0; r2 < rows; r2++) {
            var cy = offY + (r2 + 0.5) * cellPx;
            for (var c2 = 0; c2 < cols; c2++) {
                var colLeft = offX + c2 * cellPx, colRight = offX + (c2 + 1) * cellPx;
                var crossLeft = offX + (c2 + 0.5) * cellPx - R, crossRight = offX + (c2 + 0.5) * cellPx + R;
                var vOver = isVerticalOver(r2, c2, weaveType, twillPeriod, blockSize);
                var color2 = colorFor('h', r2, !vOver);
                var fSeed2 = (seed ^ (r2 * 73856093) ^ (c2 * 19349663) ^ 2) >>> 0;
                if (!vOver) {
                    overs.push(function (x0, y0, x1, y1, col, fs) { return function () { emitRect(x0, y0, x1, y1, col, fs); }; }(colLeft, cy - R, colRight, cy + R, color2, fSeed2));
                } else {
                    unders.push(function (x0, y0, x1, y1, col, fs) { return function () { emitRect(x0, y0, x1, y1, col, fs); }; }(colLeft, cy - R, crossLeft, cy + R, color2, fSeed2));
                    unders.push(function (x0, y0, x1, y1, col, fs) { return function () { emitRect(x0, y0, x1, y1, col, fs); }; }(crossRight, cy - R, colRight, cy + R, color2, fSeed2 ^ 7));
                }
            }
        }

        unders.forEach(function (fn) { fn(); });
        overs.forEach(function (fn) { fn(); });

        parts.push('</g>');
        if (P.border === 'on') {
            parts.push('<rect x="' + offX.toFixed(2) + '" y="' + offY.toFixed(2) +
                '" width="' + gridW.toFixed(2) + '" height="' + gridH.toFixed(2) +
                '" fill="none" stroke="' + palette[0] + '" stroke-width="' + sw.toFixed(2) + '"/>');
        }
        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'weave',
        description: 'Interlaced ribbon weave (plain/twill/basket) — vertical and horizontal bands cross with true over/under gaps, like cloth on a loom.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Plain weave', values: { weaveType: 'plain', cellSize: 10, ribbonWidthFrac: 0.8, fillStyle: 'hatch', colorMode: 'byDirection' } },
            { label: 'Herringbone twill', values: { weaveType: 'twill', twillPeriod: 4, cellSize: 8, fillStyle: 'hatch', colorMode: 'single' } },
            { label: 'Basket weave', values: { weaveType: 'basket', blockSize: 2, cellSize: 12, fillStyle: 'crosshatch', colorMode: 'checkerboard' } },
            { label: 'Blueprint lattice', values: { weaveType: 'plain', cellSize: 11, fillStyle: 'none', colorMode: 'single' } },
            { label: 'Tapestry', values: { weaveType: 'basket', blockSize: 3, cellSize: 9, fillStyle: 'hatch', colorMode: 'byIndex' } }
        ],
        generate: generate
    };
})();
