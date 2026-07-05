/**
 * branches — recursive branching growth (parametric)
 *
 * A fractal branching structure: one or more trunks split recursively into
 * two (occasionally three) child branches, each shorter and at a deviated
 * angle from its parent, until length or depth bottoms out. The same engine
 * reads as a tree, a Lichtenberg lightning strike, a coral colony, or a
 * root system depending on growth direction, spread, jitter, and curve.
 * Stroke width tapers from thick at the trunk to thin at the tips, and
 * color can be driven by recursion depth or by trunk index.
 */
(function () {
    var paper = window.makeSketchUtils;
    var fills = window.plotFills;

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

    // Headless email-path variety: each preset is a partial set of param overrides.
    var PRESETS = {
        oak: {
            palette: ['#3a2a1a', '#4d6b3a'], bgColor: '#f5f0e4', growthDir: 'up',
            trunkCount: 3, depth: 9, branchAngle: 26, angleJitter: 8,
            lengthRatio: 0.74, branchProb: 0.18, curveAmount: 0.3,
            leafStyle: 'dot', colorMode: 'byDepth'
        },
        lightning: {
            palette: ['#fdf6d8'], bgColor: '#0c0e16', growthDir: 'down',
            trunkCount: 1, depth: 9, branchAngle: 38, angleJitter: 26,
            lengthRatio: 0.68, branchProb: 0.22, curveAmount: 0.08,
            leafStyle: 'none', colorMode: 'single'
        },
        coral: {
            palette: ['#e63946', '#ff9800', '#ffd166'], bgColor: '#1a1014', growthDir: 'radial',
            trunkCount: 6, depth: 7, branchAngle: 46, angleJitter: 16,
            lengthRatio: 0.72, branchProb: 0.32, curveAmount: 0.55,
            leafStyle: 'spark', colorMode: 'byBranch'
        },
        roots: {
            palette: ['#5a3d24'], bgColor: '#efe6d6', growthDir: 'down',
            trunkCount: 4, depth: 9, branchAngle: 30, angleJitter: 10,
            lengthRatio: 0.78, branchProb: 0.15, curveAmount: 0.4,
            leafStyle: 'none', colorMode: 'single'
        },
        neural: {
            palette: ['#0c3a52', '#2196f3', '#7fd8ff'], bgColor: '#04070c', growthDir: 'up',
            trunkCount: 5, depth: 10, branchAngle: 20, angleJitter: 14,
            lengthRatio: 0.8, branchProb: 0.12, curveAmount: 0.2,
            leafStyle: 'dot', colorMode: 'byDepth'
        }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#000000'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e4', group: 'color' },
        { id: 'growthDir', label: 'Growth direction', type: 'select', value: 'up',
          options: [
              { value: 'up', label: 'Upward (tree)' },
              { value: 'down', label: 'Downward (roots/lightning)' },
              { value: 'radial', label: 'Radial burst (coral)' }
          ], group: 'general' },
        { id: 'trunkCount', label: 'Trunks', type: 'range', min: 1, max: 6, step: 1, value: 3, group: 'general' },
        { id: 'depth', label: 'Depth', type: 'range', min: 3, max: 10, step: 1, value: 9, group: 'general' },
        { id: 'branchAngle', label: 'Branch spread', type: 'range', min: 10, max: 70, step: 1, value: 26, group: 'general' },
        { id: 'angleJitter', label: 'Angle jitter', type: 'range', min: 0, max: 30, step: 1, value: 8, group: 'general' },
        { id: 'lengthRatio', label: 'Length decay', type: 'range', min: 0.5, max: 0.85, step: 0.01, value: 0.74, group: 'general' },
        { id: 'branchProb', label: 'Extra branch chance', type: 'range', min: 0, max: 0.5, step: 0.05, value: 0.18, group: 'general' },
        { id: 'curveAmount', label: 'Curve', type: 'range', min: 0, max: 1, step: 0.05, value: 0.3, group: 'general' },
        { id: 'leafStyle', label: 'Tip marker', type: 'select', value: 'dot',
          options: [
              { value: 'none', label: 'None' },
              { value: 'dot', label: 'Dot' },
              { value: 'spark', label: 'Spark' }
          ], group: 'general' },
        { id: 'colorMode', label: 'Color by', type: 'select', value: 'byDepth',
          options: [
              { value: 'byDepth', label: 'Depth' },
              { value: 'byBranch', label: 'Trunk' },
              { value: 'single', label: 'Single' }
          ], group: 'color' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    var MAX_SEGMENTS = 6000;

    function dirVec(angle) { return { x: Math.sin(angle), y: -Math.cos(angle) }; }

    function pickColor(palette, mode, depthLevel, maxDepth, trunkIdx) {
        if (!palette.length) return '#000000';
        if (mode === 'single') return palette[0];
        if (mode === 'byBranch') return palette[trunkIdx % palette.length];
        var idx = Math.floor((depthLevel / Math.max(1, maxDepth)) * palette.length);
        return palette[Math.min(palette.length - 1, idx)];
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
        var dW = W - 2 * mp, dH = H - 2 * mp;

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#000000'];
        var maxDepth = Math.round(P.depth);
        var spreadRad = (P.branchAngle * Math.PI / 180);
        var jitterRad = (P.angleJitter * Math.PI / 180);
        var minLen = 4;

        var segments = []; // {x1,y1,x2,y2,depthLevel,trunkIdx,width}

        function branch(x, y, angle, length, depthRemaining, depthLevel, trunkIdx) {
            if (depthRemaining <= 0 || length < minLen) {
                if (P.leafStyle !== 'none') drawTip(x, y, angle, depthLevel, trunkIdx);
                return;
            }
            if (segments.length >= MAX_SEGMENTS) return;

            var v = dirVec(angle);
            var ex = x + v.x * length, ey = y + v.y * length;
            var bow = (rng() - 0.5) * 2 * P.curveAmount * length * 0.3;
            var perp = { x: -v.y, y: v.x };
            var mx = (x + ex) / 2 + perp.x * bow, my = (y + ey) / 2 + perp.y * bow;

            var widthFactor = 0.25 + 0.75 * (depthRemaining / maxDepth);
            segments.push({
                x1: x, y1: y, mx: mx, my: my, x2: ex, y2: ey,
                width: sw * widthFactor,
                color: pickColor(palette, P.colorMode, depthLevel, maxDepth, trunkIdx)
            });

            var childCount = (rng() < P.branchProb) ? 3 : 2;
            var nextLen = length * P.lengthRatio * (0.85 + rng() * 0.3);

            if (childCount === 3) {
                branch(ex, ey, angle + (rng() - 0.5) * jitterRad * 0.6, nextLen, depthRemaining - 1, depthLevel + 1, trunkIdx);
            }
            var dir1 = spreadRad / 2 + (rng() - 0.5) * jitterRad;
            var dir2 = -spreadRad / 2 + (rng() - 0.5) * jitterRad;
            branch(ex, ey, angle + dir1, nextLen, depthRemaining - 1, depthLevel + 1, trunkIdx);
            branch(ex, ey, angle + dir2, nextLen, depthRemaining - 1, depthLevel + 1, trunkIdx);
        }

        var tips = [];
        function drawTip(x, y, angle, depthLevel, trunkIdx) {
            tips.push({ x: x, y: y, angle: angle, depthLevel: depthLevel, trunkIdx: trunkIdx });
        }

        var trunkCount = Math.round(P.trunkCount);
        var baseLen;
        if (P.growthDir === 'radial') {
            baseLen = Math.min(dW, dH) * 0.24;
            var cx = mp + dW / 2, cy = mp + dH / 2;
            for (var i = 0; i < trunkCount; i++) {
                var a = (i / trunkCount) * Math.PI * 2 + (rng() - 0.5) * 0.3;
                branch(cx, cy, a, baseLen, maxDepth, 0, i);
            }
        } else if (P.growthDir === 'down') {
            baseLen = dH * 0.32;
            for (var j = 0; j < trunkCount; j++) {
                var sx = mp + dW * ((trunkCount === 1) ? 0.5 : (j + 0.5) / trunkCount);
                var sa = Math.PI + (rng() - 0.5) * 0.35;
                branch(sx, mp, sa, baseLen, maxDepth, 0, j);
            }
        } else {
            baseLen = dH * 0.32;
            for (var k = 0; k < trunkCount; k++) {
                var sx2 = mp + dW * ((trunkCount === 1) ? 0.5 : (k + 0.5) / trunkCount);
                var sa2 = (rng() - 0.5) * 0.35;
                branch(sx2, mp + dH, sa2, baseLen, maxDepth, 0, k);
            }
        }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        for (var s = 0; s < segments.length; s++) {
            var sg = segments[s];
            parts.push('<path d="M ' + sg.x1.toFixed(2) + ' ' + sg.y1.toFixed(2) +
                ' Q ' + sg.mx.toFixed(2) + ' ' + sg.my.toFixed(2) + ' ' + sg.x2.toFixed(2) + ' ' + sg.y2.toFixed(2) +
                '" fill="none" stroke="' + sg.color + '" stroke-width="' + sg.width.toFixed(2) +
                '" stroke-linecap="round"/>');
        }

        if (P.leafStyle === 'dot') {
            for (var t = 0; t < tips.length; t++) {
                var tp = tips[t];
                var col = pickColor(palette, P.colorMode, tp.depthLevel, maxDepth, tp.trunkIdx);
                var r = sw * 0.9;
                parts.push('<circle cx="' + tp.x.toFixed(2) + '" cy="' + tp.y.toFixed(2) +
                    '" r="' + r.toFixed(2) + '" fill="none" stroke="' + col + '" stroke-width="' + (sw * 0.6).toFixed(2) + '"/>');
            }
        } else if (P.leafStyle === 'spark') {
            for (var t2 = 0; t2 < tips.length; t2++) {
                var tp2 = tips[t2];
                var col2 = pickColor(palette, P.colorMode, tp2.depthLevel, maxDepth, tp2.trunkIdx);
                var rays = 4, rayLen = sw * 3.5;
                for (var rIdx = 0; rIdx < rays; rIdx++) {
                    var ra = tp2.angle + (rIdx / rays) * Math.PI * 2 + Math.PI / rays;
                    var rx = tp2.x + Math.sin(ra) * rayLen, ry = tp2.y - Math.cos(ra) * rayLen;
                    parts.push('<line x1="' + tp2.x.toFixed(2) + '" y1="' + tp2.y.toFixed(2) +
                        '" x2="' + rx.toFixed(2) + '" y2="' + ry.toFixed(2) +
                        '" stroke="' + col2 + '" stroke-width="' + (sw * 0.5).toFixed(2) + '" stroke-linecap="round"/>');
                }
            }
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name:        'branches',
        description: 'Recursive branching growth — tree, lightning, coral, or roots depending on direction and spread.',
        presets:     Object.keys(PRESETS),
        params:      params,
        stylePresets: [
            { label: 'Oak', values: { growthDir: 'up', trunkCount: 3, branchAngle: 26, curveAmount: 0.3, leafStyle: 'dot', colorMode: 'byDepth' } },
            { label: 'Lightning', values: { growthDir: 'down', trunkCount: 1, branchAngle: 38, angleJitter: 26, curveAmount: 0.08, leafStyle: 'none', colorMode: 'single' } },
            { label: 'Coral', values: { growthDir: 'radial', trunkCount: 6, branchAngle: 46, curveAmount: 0.55, leafStyle: 'spark', colorMode: 'byBranch' } },
            { label: 'Roots', values: { growthDir: 'down', trunkCount: 4, branchAngle: 30, lengthRatio: 0.78, curveAmount: 0.4, leafStyle: 'none', colorMode: 'single' } },
            { label: 'Neural', values: { growthDir: 'up', trunkCount: 5, depth: 10, branchAngle: 20, curveAmount: 0.2, leafStyle: 'dot', colorMode: 'byDepth' } }
        ],
        generate:    generate
    };
})();
