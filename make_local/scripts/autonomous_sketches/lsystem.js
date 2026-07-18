/**
 * lsystem — 2026-07-18
 *
 * Formal L-system (Lindenmayer string-rewriting grammar) rendered via turtle
 * graphics. A short axiom is repeatedly expanded by per-character production
 * rules, then the resulting string is walked by a turtle (forward/turn/
 * push/pop) to trace the curve. Same tiny engine reproduces five classic
 * L-systems (Koch snowflake, Heighway dragon curve, Levy C curve, Sierpinski
 * arrowhead, and Lindenmayer's own branching fractal plant) purely by
 * swapping the grammar — a fundamentally different generative mechanism
 * (symbolic string rewriting) from every prior recursive/noise/physics-based
 * sketch in this set.
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    // LCG random
    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#1a1a1a', label: 'Charcoal' },
        { value: '#e63946', label: 'Red' },    { value: '#2196f3', label: 'Blue' },
        { value: '#ff9800', label: 'Orange' }, { value: '#4caf50', label: 'Green' },
        { value: '#9c27b0', label: 'Purple' }, { value: '#1d3557', label: 'Navy' },
        { value: '#457b9d', label: 'Steel blue' }, { value: '#40916c', label: 'Forest' },
        { value: '#ffd166', label: 'Gold' },   { value: 'custom', label: 'Custom' }
    ];

    // Classic L-system grammars (Wikipedia / "The Algorithmic Beauty of Plants").
    var RULESETS = {
        koch:       { axiom: 'F++F++F',
                      rules: { F: 'F-F++F-F' }, angle: 60, drawChars: ['F'] },
        dragon:     { axiom: 'FX',
                      rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90, drawChars: ['F'] },
        levy:       { axiom: 'F',
                      rules: { F: '+F--F+' }, angle: 45, drawChars: ['F'] },
        sierpinski: { axiom: 'A',
                      rules: { A: 'B-A-B', B: 'A+B+A' }, angle: 60, drawChars: ['A', 'B'] },
        plant:      { axiom: 'X',
                      rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25.7, drawChars: ['F'] }
    };

    var PRESETS = {
        koch_snowflake: { system: 'koch', iterations: 4, angleJitter: 1.0, colorMode: 'single',
            lineWidthMode: 'constant', palette: ['#1a1a1a'], bgColor: '#f7f3ea' },
        dragon_storm: { system: 'dragon', iterations: 12, angleJitter: 0.6, colorMode: 'sequence',
            lineWidthMode: 'constant', strokeScale: 0.9,
            palette: ['#ff6b6b', '#ffd166', '#4ecdc4', '#c9a8ff'], bgColor: '#12141c' },
        levy_lace: { system: 'levy', iterations: 11, angleJitter: 1.0, colorMode: 'sequence',
            lineWidthMode: 'constant', palette: ['#1d3557', '#457b9d'], bgColor: '#f1faee' },
        sierpinski_web: { system: 'sierpinski', iterations: 7, angleJitter: 1.2, colorMode: 'single',
            lineWidthMode: 'constant', palette: ['#3a3a3a'], bgColor: '#f5efe6' },
        fractal_garden: { system: 'plant', iterations: 5, angleJitter: 2.5, colorMode: 'depth',
            lineWidthMode: 'taper', palette: ['#1b4332', '#40916c', '#74c69d', '#b7e4c7'], bgColor: '#f8f4e9' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'system', label: 'System', type: 'select', value: 'plant', group: 'general',
          options: [
              { value: 'koch', label: 'Koch Snowflake' },
              { value: 'dragon', label: 'Dragon Curve' },
              { value: 'levy', label: 'Levy C Curve' },
              { value: 'sierpinski', label: 'Sierpinski Arrowhead' },
              { value: 'plant', label: 'Fractal Plant' }
          ] },
        { id: 'iterations', label: 'Iterations', type: 'range', min: 1, max: 14, step: 1, value: 5, group: 'general' },
        { id: 'angleScale', label: 'Angle scale', type: 'range', min: 0.5, max: 1.5, step: 0.01, value: 1, group: 'general' },
        { id: 'angleJitter', label: 'Angle jitter', type: 'range', min: 0, max: 20, step: 0.5, value: 1.5, group: 'general' },
        { id: 'startAngle', label: 'Start angle', type: 'range', min: 0, max: 360, step: 1, value: 90, group: 'general' },
        { id: 'lineWidthMode', label: 'Line width', type: 'select', value: 'taper', group: 'general',
          options: [ { value: 'taper', label: 'Taper by depth' }, { value: 'constant', label: 'Constant' } ] },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'depth', group: 'general',
          options: [
              { value: 'single', label: 'Single ink' },
              { value: 'depth', label: 'By branch depth' },
              { value: 'sequence', label: 'By sequence (gradient)' }
          ] },
        { id: 'strokeScale', label: 'Stroke weight', type: 'range', min: 0.5, max: 2.5, step: 0.05, value: 1, group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function hexToRgb(hex) {
        hex = String(hex).replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
        var num = parseInt(hex, 16) || 0;
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }
    function rgbToHex(rgb) {
        return '#' + rgb.map(function (v) {
            v = Math.max(0, Math.min(255, Math.round(v)));
            var s = v.toString(16);
            return s.length === 1 ? '0' + s : s;
        }).join('');
    }
    function paletteBlend(palette, t) {
        if (palette.length === 1) return palette[0];
        var scaled = t * (palette.length - 1);
        var i0 = Math.floor(scaled), i1 = Math.min(palette.length - 1, i0 + 1), f = scaled - i0;
        var c0 = hexToRgb(palette[i0]), c1 = hexToRgb(palette[i1]);
        return rgbToHex([c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]);
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
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4) * (Number(P.strokeScale) || 1);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#f5f0e8';

        var ruleset = RULESETS[P.system] || RULESETS.plant;
        var MAX_CHARS = 400000;
        var str = ruleset.axiom;
        // Per-seed nudges (like attractor.js) so the same params/preset never
        // renders identically twice: +/-1 iteration (MAX_CHARS/MAX_SEGMENTS
        // below bound the cost regardless), plus a small drift on the
        // system's turn angle and starting heading.
        var iterNudge = Math.round(rng() * 2) - 1;
        var iterations = Math.max(1, Math.min(14, Math.round(Number(P.iterations) || 5) + iterNudge));
        var angleDrift = 1 + (rng() - 0.5) * 0.1;
        var headingDrift = (rng() - 0.5) * 14;
        for (var it = 0; it < iterations; it++) {
            if (str.length > MAX_CHARS) break;
            var next = '';
            for (var ci = 0; ci < str.length; ci++) {
                var ch = str.charAt(ci);
                next += ruleset.rules.hasOwnProperty(ch) ? ruleset.rules[ch] : ch;
            }
            str = next;
        }

        var angleStep = ruleset.angle * (Number(P.angleScale) || 1) * angleDrift;
        var jitter = Number(P.angleJitter) || 0;
        var drawSet = {};
        ruleset.drawChars.forEach(function (c) { drawSet[c] = true; });

        var x = 0, y = 0, heading = (P.startAngle != null ? Number(P.startAngle) : 90) + headingDrift;
        var stack = [];
        var depth = 0;
        var step = 10;

        var MAX_SEGMENTS = 14000;
        var segCount = 0;
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        var buckets = {};

        var totalDrawChars = 0;
        for (var pi = 0; pi < str.length; pi++) if (drawSet[str.charAt(pi)]) totalDrawChars++;
        var drawIdx = 0;

        function bucketFor(colorKey, color, widthKey, width) {
            var key = colorKey + '|' + widthKey;
            if (!buckets[key]) buckets[key] = { color: color, width: width, segs: [] };
            return buckets[key];
        }

        for (var si = 0; si < str.length; si++) {
            if (segCount > MAX_SEGMENTS) break;
            var ch2 = str.charAt(si);
            if (ch2 === '+') {
                heading += angleStep + (rng() - 0.5) * jitter;
            } else if (ch2 === '-') {
                heading -= angleStep + (rng() - 0.5) * jitter;
            } else if (ch2 === '[') {
                stack.push({ x: x, y: y, heading: heading, depth: depth });
                depth++;
            } else if (ch2 === ']') {
                var st = stack.pop();
                if (st) { x = st.x; y = st.y; heading = st.heading; depth = st.depth; }
            } else if (drawSet[ch2]) {
                var rad = heading * Math.PI / 180;
                var nx = x + Math.cos(rad) * step;
                var ny = y - Math.sin(rad) * step;

                var colorKey, color;
                if (P.colorMode === 'depth') {
                    var di = depth % palette.length;
                    colorKey = 'd' + di; color = palette[di];
                } else if (P.colorMode === 'sequence') {
                    var t = totalDrawChars > 1 ? drawIdx / (totalDrawChars - 1) : 0;
                    var bIdx = Math.min(23, Math.floor(t * 24));
                    colorKey = 's' + bIdx; color = paletteBlend(palette, bIdx / 23);
                } else {
                    colorKey = 'single'; color = palette[0];
                }

                var widthKey, width;
                var dCap = Math.min(depth, 10);
                if (P.lineWidthMode === 'taper') {
                    widthKey = 'w' + dCap; width = sw * Math.max(0.3, 1 - dCap * 0.13);
                } else {
                    widthKey = 'wc'; width = sw;
                }

                var b = bucketFor(colorKey, color, widthKey, width);
                b.segs.push([x, y, nx, ny]);

                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
                if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;

                x = nx; y = ny;
                segCount++;
                drawIdx++;
            }
        }

        if (!isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }

        var bboxW = Math.max(1e-6, maxX - minX);
        var bboxH = Math.max(1e-6, maxY - minY);
        var availW = W - 2 * mp, availH = H - 2 * mp;
        var scale = Math.min(availW / bboxW, availH / bboxH);
        var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        var offX = W / 2, offY = H / 2;

        function tx(px) { return (px - cx) * scale + offX; }
        function ty(py) { return (py - cy) * scale + offY; }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        Object.keys(buckets).forEach(function (key) {
            var b = buckets[key];
            var d = '';
            b.segs.forEach(function (seg) {
                d += 'M' + tx(seg[0]).toFixed(2) + ' ' + ty(seg[1]).toFixed(2) +
                     ' L' + tx(seg[2]).toFixed(2) + ' ' + ty(seg[3]).toFixed(2) + ' ';
            });
            parts.push('<path d="' + d.trim() + '" fill="none" stroke="' + b.color +
                '" stroke-width="' + b.width.toFixed(2) + '" stroke-linecap="round"/>');
        });

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name:        'lsystem',
        description: 'Formal L-system grammars (Koch, dragon, Levy, Sierpinski, fractal plant) via turtle graphics.',
        presets:     Object.keys(PRESETS),
        params:      params,
        stylePresets: [
            { label: 'Koch Snowflake', values: { system: 'koch', iterations: 4, angleJitter: 1.0,
                colorMode: 'single', lineWidthMode: 'constant', palette: ['#1a1a1a'], bgColor: '#f7f3ea' } },
            { label: 'Dragon Storm', values: { system: 'dragon', iterations: 12, angleJitter: 0.6,
                colorMode: 'sequence', lineWidthMode: 'constant', strokeScale: 0.9,
                palette: ['#ff6b6b', '#ffd166', '#4ecdc4', '#c9a8ff'], bgColor: '#12141c' } },
            { label: 'Levy Lace', values: { system: 'levy', iterations: 11, angleJitter: 1.0,
                colorMode: 'sequence', lineWidthMode: 'constant',
                palette: ['#1d3557', '#457b9d'], bgColor: '#f1faee' } },
            { label: 'Sierpinski Web', values: { system: 'sierpinski', iterations: 7, angleJitter: 1.2,
                colorMode: 'single', lineWidthMode: 'constant', palette: ['#3a3a3a'], bgColor: '#f5efe6' } },
            { label: 'Fractal Garden', values: { system: 'plant', iterations: 5, angleJitter: 2.5,
                colorMode: 'depth', lineWidthMode: 'taper',
                palette: ['#1b4332', '#40916c', '#74c69d', '#b7e4c7'], bgColor: '#f8f4e9' } }
        ],
        generate:    generate
    };
})();
