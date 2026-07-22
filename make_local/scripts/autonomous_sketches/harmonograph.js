/**
 * harmonograph — 2026-07-19
 *
 * Simulates a classic twin-pendulum harmonograph: two coupled damped
 * sine-wave oscillators drive the X and Y axes of a pen, tracing one
 * continuous decaying spiral curve. An optional rotary-table term adds
 * continuous twist on top of the lateral swing, and multiple "pen layers"
 * overlay slightly detuned traces for a ghosted multi-pass look.
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    // LCG random — use this, not Math.random()
    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    // Headless email-path variety: each preset is a partial set of param overrides.
    // NOTE: `cycles` = number of X-pendulum loops traced (independent of freqX/freqY).
    // `damping` = normalized decay strength over the FULL traced duration (0=no decay, 1=decays to ~e^-8).
    var PRESETS = {
        rosette: { freqX: 3, freqY: 2, detune: 0.01, phaseOffset: 90, damping: 0.35, cycles: 26,
                   rotarySpeed: 0, layers: 1, layerSpread: 0, palette: ['#1a1a1a'], bgColor: '#f5f0e8' },
        spiral:  { freqX: 5, freqY: 4, detune: 0.02, phaseOffset: 90, damping: 0.65, cycles: 22,
                   rotarySpeed: 0, layers: 1, layerSpread: 0, palette: ['#7a1f2b'], bgColor: '#f7ece2' },
        ghost:   { freqX: 3, freqY: 2, detune: 0.015, phaseOffset: 90, damping: 0.3, cycles: 30,
                   rotarySpeed: 0, layers: 3, layerSpread: 0.04, palette: ['#124559', '#2c7da0', '#89c2d9'], bgColor: '#eef6fb' },
        rotary:  { freqX: 2, freqY: 3, detune: 0.012, phaseOffset: 90, damping: 0.28, cycles: 34,
                   rotarySpeed: 0.12, layers: 2, layerSpread: 0.02, palette: ['#eec643', '#c98a2b'], bgColor: '#1c1520' },
        web:     { freqX: 5, freqY: 3, detune: 0.002, phaseOffset: 90, damping: 0.06, cycles: 55,
                   rotarySpeed: 0, layers: 1, layerSpread: 0, palette: ['#16324f'], bgColor: '#dbe9f4' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'freqX', label: 'X Frequency', type: 'range', min: 1, max: 8, step: 0.01, value: 3, group: 'general' },
        { id: 'freqY', label: 'Y Frequency', type: 'range', min: 1, max: 8, step: 0.01, value: 2, group: 'general' },
        { id: 'detune', label: 'Pendulum Detune', type: 'range', min: 0, max: 0.08, step: 0.001, value: 0.01, group: 'general' },
        { id: 'phaseOffset', label: 'Phase Offset', type: 'range', min: 0, max: 360, step: 1, value: 90, group: 'general' },
        { id: 'damping', label: 'Damping', type: 'range', min: 0.02, max: 1.2, step: 0.01, value: 0.35, group: 'general' },
        { id: 'cycles', label: 'Loop Count', type: 'range', min: 8, max: 60, step: 1, value: 26, group: 'general' },
        { id: 'rotarySpeed', label: 'Rotary Twist', type: 'range', min: 0, max: 0.25, step: 0.005, value: 0, group: 'general' },
        { id: 'layers', label: 'Pen Layers', type: 'range', min: 1, max: 5, step: 1, value: 1, group: 'general' },
        { id: 'layerSpread', label: 'Layer Detune Spread', type: 'range', min: 0, max: 0.06, step: 0.001, value: 0.02, group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function generate(seed, opts) {
        var P = buildDefaults();
        if (typeof opts === 'string') {                       // headless preset path
            if (PRESETS[opts]) for (var k in PRESETS[opts]) P[k] = PRESETS[opts][k];
        } else if (opts && typeof opts === 'object') {        // Make tab param path
            for (var k2 in opts) if (opts.hasOwnProperty(k2)) P[k2] = opts[k2];
        }

        var rng = makeRng(seed);
        var dims = paper.getPaperPixels(P.paperSize || '9x12');
        var W = dims.width, H = dims.height;
        var mp = paper.getMarginPixels(parseFloat(P.margin || 0.75));
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];

        var left = mp, top = mp, right = W - mp, bottom = H - mp;
        var cx = (left + right) / 2, cy = (top + bottom) / 2;
        var ampX = (right - left) / 2 * 0.94 / 2;
        var ampY = (bottom - top) / 2 * 0.94 / 2;

        // Per-seed nudge so the same preset renders a visibly distinct piece every time —
        // independent X/Y frequency drift (changes petal count/shape), a wide phase spread
        // (rotates + reshapes the figure), and mild damping/cycle drift (fuller vs. tighter bloom).
        var freqXJitter = (rng() - 0.5) * 0.06;
        var freqYJitter = (rng() - 0.5) * 0.06;
        var basePhase = (rng() - 0.5) * 1.4;
        var phase3Base = (rng() - 0.5) * 1.4;
        var dampingMul = 1 + (rng() - 0.5) * 0.4;
        var cyclesJitter = Math.round((rng() - 0.5) * 6);

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        var layers = Math.round(clamp(P.layers, 1, 5));
        var maxW = sw * 1.9, minW = sw * 0.45;
        var cyclesEff = Math.round(clamp(P.cycles + cyclesJitter, 8, 70));

        for (var L = 0; L < layers; L++) {
            var offset = layers > 1 ? (L - (layers - 1) / 2) : 0;
            var fx1 = P.freqX + freqXJitter + P.layerSpread * offset;
            var fx2 = fx1 * (1 + P.detune);
            var fy1 = P.freqY + freqYJitter + P.layerSpread * offset * 0.8;
            var fy2 = fy1 * (1 + P.detune);
            var phase1 = basePhase;
            var phase2 = phase1 + P.phaseOffset * Math.PI / 180;
            var phase3 = Math.PI / 2 + phase3Base + L * 0.15;
            var phase4 = phase3 + P.phaseOffset * Math.PI / 180;
            var dampingL = P.damping * dampingMul * (1 + L * 0.05);

            // `cycles` = number of X-pendulum loops traced, independent of freqX's magnitude.
            var tTotal = cyclesEff * 2 * Math.PI / fx1;
            var pointsPerCycle = 30;
            var totalSteps = Math.round(clamp(cyclesEff * pointsPerCycle, 300, 9000));
            var dt = tTotal / totalSteps;

            var pts = [];
            var envs = [];
            for (var i = 0; i <= totalSteps; i++) {
                var t = i * dt;
                var progress = t / tTotal;
                var env = Math.exp(-dampingL * 8 * progress);
                var xRaw = ampX * (Math.sin(fx1 * t + phase1) + Math.sin(fx2 * t + phase2)) * env;
                var yRaw = ampY * (Math.sin(fy1 * t + phase3) + Math.sin(fy2 * t + phase4)) * env;
                var rot = P.rotarySpeed * t;
                var xr = xRaw * Math.cos(rot) - yRaw * Math.sin(rot);
                var yr = xRaw * Math.sin(rot) + yRaw * Math.cos(rot);
                pts.push({ x: cx + xr, y: cy + yr });
                envs.push(env);
            }

            var color = palette[L % palette.length];
            var segLen = 28;
            for (var s = 0; s < pts.length - 1; s += segLen) {
                var e = Math.min(s + segLen, pts.length - 1);
                var seg = pts.slice(s, e + 1);
                if (seg.length < 2) continue;
                var midEnv = envs[Math.floor((s + e) / 2)];
                var width = minW + (maxW - minW) * clamp(midEnv, 0, 1);
                var ptsStr = seg.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ');
                parts.push('<polyline points="' + ptsStr + '" fill="none" stroke="' + color +
                    '" stroke-width="' + width.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
            }
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name:        'harmonograph',
        description: 'Damped twin-pendulum harmonograph curves — a decaying spiral rosette traced by simulated pendulum physics.',
        presets:     Object.keys(PRESETS),
        params:      params,
        stylePresets: [
            { label: 'Classic Rosette', values: { freqX: 3, freqY: 2, detune: 0.01, phaseOffset: 90, damping: 0.35, cycles: 26, layers: 1 } },
            { label: 'Spiral Flower',   values: { freqX: 5, freqY: 4, detune: 0.02, damping: 0.65, cycles: 22, layers: 1 } },
            { label: 'Ghost Trio',      values: { freqX: 3, freqY: 2, damping: 0.3, cycles: 30, layers: 3, layerSpread: 0.04 } },
            { label: 'Rotary Bloom',    values: { freqX: 2, freqY: 3, damping: 0.28, cycles: 34, rotarySpeed: 0.12, layers: 2 } },
            { label: 'Lissajous Web',   values: { freqX: 5, freqY: 3, detune: 0.002, damping: 0.06, cycles: 55, layers: 1 } }
        ],
        generate:    generate
    };
})();
