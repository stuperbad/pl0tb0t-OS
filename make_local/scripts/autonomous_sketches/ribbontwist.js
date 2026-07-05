/**
 * ribbontwist — parametric twisting ribbon forms
 *
 * One or more ribbons follow a centerline path (straight, wave, arc, or
 * spiral). Along the path, the ribbon's apparent half-width is modulated by
 * cos(theta) where theta sweeps through twistRate full turns — the classic
 * 2D trick for drawing a ribbon that twists through 3D space without any
 * real 3D math: where cos(theta) >= 0 the ribbon shows its "front" face
 * (filled), where cos(theta) < 0 it shows its "back" (outline only / light
 * hatch), and the width pinches to zero exactly at each twist node. The same
 * engine reads as a barber pole (straight, 1-2 ribbons, high twist), a DNA
 * helix (straight, 2 ribbons, antiphase), a spiral vortex (spiral path,
 * multiple arms), or a flower of twisting petals (arc path, N ribbons fanned
 * around a circle).
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#1a1a1a', label: 'Ink' },
        { value: '#e63946', label: 'Red' },   { value: '#cc2200', label: 'Rust' },
        { value: '#2196f3', label: 'Blue' },  { value: '#10243a', label: 'Navy' },
        { value: '#ff9800', label: 'Orange' }, { value: '#4caf50', label: 'Green' },
        { value: '#9c27b0', label: 'Purple' }, { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        barberpole: { pathType: 'straight', numRibbons: 1, twistRate: 8, ribbonWidth: 34,
                      palette: ['#cc2200'], bgColor: '#f5f0e8', fillStyle: 'hatch', backFaceStyle: 'blank' },
        helix:      { pathType: 'straight', numRibbons: 2, twistRate: 6, ribbonWidth: 16, phaseJitter: 0,
                      palette: ['#000000'], bgColor: '#f7f4ee', fillStyle: 'hatch', backFaceStyle: 'lightHatch' },
        vortex:     { pathType: 'spiral', numRibbons: 2, twistRate: 3, ribbonWidth: 18,
                      palette: ['#10243a'], bgColor: '#eef6fb', fillStyle: 'crosshatch', backFaceStyle: 'outline' },
        petals:     { pathType: 'arc', numRibbons: 6, twistRate: 2, ribbonWidth: 22,
                      palette: ['#e63946', '#2196f3', '#ff9800', '#4caf50', '#9c27b0'],
                      bgColor: '#fffaf2', fillStyle: 'hatch', backFaceStyle: 'outline' },
        driftwave:  { pathType: 'wave', numRibbons: 5, twistRate: 4, waveAmplitude: 55, waveFreq: 1.2,
                      palette: ['#10243a'], bgColor: '#eef3f6', fillStyle: 'hatch', backFaceStyle: 'lightHatch' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'numRibbons', label: 'Ribbons', type: 'range', min: 1, max: 8, step: 1, value: 3, group: 'general' },
        { id: 'pathType', label: 'Path', type: 'select', value: 'wave', group: 'general',
          options: [{ value: 'wave', label: 'Wave' }, { value: 'straight', label: 'Straight' },
                    { value: 'arc', label: 'Arc / petals' }, { value: 'spiral', label: 'Spiral' }] },
        { id: 'twistRate', label: 'Twist rate', type: 'range', min: 0.5, max: 15, step: 0.5, value: 5, group: 'general' },
        { id: 'ribbonWidth', label: 'Ribbon width (mm)', type: 'range', min: 6, max: 50, step: 1, value: 20, group: 'general' },
        { id: 'ribbonSpacing', label: 'Ribbon spacing (mm)', type: 'range', min: 10, max: 80, step: 5, value: 35, group: 'general' },
        { id: 'waveAmplitude', label: 'Wave amplitude (mm)', type: 'range', min: 0, max: 100, step: 5, value: 45,
          group: 'general', visibleWhen: { param: 'pathType', values: ['wave'] } },
        { id: 'waveFreq', label: 'Frequency / turns', type: 'range', min: 0.5, max: 5, step: 0.1, value: 1.5,
          group: 'general', visibleWhen: { param: 'pathType', values: ['wave', 'spiral'] } },
        { id: 'fillStyle', label: 'Front fill', type: 'select', value: 'hatch', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) },
        { id: 'backFaceStyle', label: 'Back face', type: 'select', value: 'outline', group: 'general',
          options: [{ value: 'outline', label: 'Outline only' }, { value: 'lightHatch', label: 'Light hatch' },
                    { value: 'blank', label: 'Blank (gap)' }] },
        { id: 'phaseJitter', label: 'Phase jitter', type: 'range', min: 0, max: 1, step: 0.05, value: 0.15, group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function pathD(pts) {
        var s = '';
        for (var i = 0; i < pts.length; i++) s += (i === 0 ? 'M' : 'L') + pts[i].x.toFixed(2) + ',' + pts[i].y.toFixed(2);
        return s;
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

        var ox = mp, oy = mp, dW = W - 2 * mp, dH = H - 2 * mp;
        var cx = ox + dW / 2, cy = oy + dH / 2;

        var n = Math.max(1, Math.round(P.numRibbons));
        var twistRate = Number(P.twistRate) || 5;
        var ribbonWidthPx = paper.mmToPixels(Number(P.ribbonWidth) || 20);
        var ampPx = paper.mmToPixels(Number(P.waveAmplitude) || 0);
        var freq = Number(P.waveFreq) || 1.5;
        var spacingMmPx = paper.mmToPixels(Number(P.ribbonSpacing) || 35);
        var phaseJitter = Number(P.phaseJitter) || 0;
        var pathType = P.pathType || 'wave';

        var density = fills.getEffectiveDensity();
        var spacingFill = (paper.DPI / 25.4) / Math.max(0.2, density);
        var STEPS = 150;

        // vertical layout for straight/wave so every ribbon + its wave swing stays inside margins
        var padPx = ribbonWidthPx / 2 + (pathType === 'wave' ? ampPx : 0);
        var usableH = Math.max(10, dH - 2 * padPx);
        var vSpacing = n > 1 ? Math.min(spacingMmPx, usableH / (n - 1)) : 0;
        var startY = cy - vSpacing * (n - 1) / 2;

        // radial layout for arc/spiral
        var maxRadius = Math.max(20, Math.min(dW, dH) / 2 - ribbonWidthPx / 2 - 4);

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        for (var i = 0; i < n; i++) {
            var color = palette[i % palette.length];
            var phase = (i * 2 * Math.PI / n) + (rng() - 0.5) * phaseJitter * 2 * Math.PI;
            var baseline = (n > 1) ? startY + i * vSpacing : cy;

            var pts = [];
            for (var k = 0; k <= STEPS; k++) {
                var t = k / STEPS, x, y;
                if (pathType === 'straight') {
                    x = ox + t * dW; y = baseline;
                } else if (pathType === 'wave') {
                    x = ox + t * dW; y = baseline + ampPx * Math.sin(2 * Math.PI * freq * t + phase);
                } else if (pathType === 'arc') {
                    var coverage = 0.82;
                    var slice = (2 * Math.PI / n) * coverage;
                    var startAngle = i * (2 * Math.PI / n) - Math.PI / 2;
                    var angA = startAngle + t * slice;
                    x = cx + maxRadius * Math.cos(angA); y = cy + maxRadius * Math.sin(angA);
                } else { // spiral
                    var turns = freq * 3;
                    var angS = i * (2 * Math.PI / n) + t * 2 * Math.PI * turns;
                    var r = maxRadius * 0.12 + t * (maxRadius * 0.88);
                    x = cx + r * Math.cos(angS); y = cy + r * Math.sin(angS);
                }
                pts.push({ x: x, y: y, theta: 2 * Math.PI * twistRate * t + phase });
            }

            for (var k2 = 0; k2 <= STEPS; k2++) {
                var p0 = pts[Math.max(0, k2 - 1)], p1 = pts[Math.min(STEPS, k2 + 1)];
                var tx = p1.x - p0.x, ty = p1.y - p0.y;
                var len = Math.hypot(tx, ty) || 1;
                tx /= len; ty /= len;
                pts[k2].tx = tx; pts[k2].ty = ty; pts[k2].nx = -ty; pts[k2].ny = tx;
            }

            var edgeA = [], edgeB = [];
            for (var k3 = 0; k3 <= STEPS; k3++) {
                var hw = (ribbonWidthPx / 2) * Math.cos(pts[k3].theta);
                edgeA.push({ x: pts[k3].x + pts[k3].nx * hw, y: pts[k3].y + pts[k3].ny * hw });
                edgeB.push({ x: pts[k3].x - pts[k3].nx * hw, y: pts[k3].y - pts[k3].ny * hw });
            }

            // continuous silhouette edges (always drawn — this is the ribbon's outline through every twist)
            parts.push('<path d="' + pathD(edgeA) + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
            parts.push('<path d="' + pathD(edgeB) + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');

            // group into front/back runs and fill each contiguous run as one strip polygon
            var runStart = 0, runFront = Math.cos((pts[0].theta + pts[1].theta) / 2) >= 0;
            for (var k4 = 0; k4 <= STEPS; k4++) {
                var isLast = (k4 === STEPS);
                var front = isLast ? runFront : (Math.cos((pts[k4].theta + pts[k4 + 1].theta) / 2) >= 0);
                if (isLast || front !== runFront) {
                    var endIdx = isLast ? STEPS : k4;
                    if (endIdx > runStart) {
                        var mid = Math.floor((runStart + endIdx) / 2);
                        var angleDeg = Math.atan2(pts[mid].ty, pts[mid].tx) * 180 / Math.PI;
                        var runSeed = (seed ^ (i * 977 + 17) ^ (runStart * 131 + 31)) >>> 0;
                        var poly = edgeA.slice(runStart, endIdx + 1).concat(edgeB.slice(runStart, endIdx + 1).reverse());
                        if (runFront) {
                            if (P.fillStyle !== 'none') {
                                fills.fillPolyD(poly, P.fillStyle, angleDeg, spacingFill, runSeed).forEach(function (d) {
                                    parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                                });
                            }
                        } else if (P.backFaceStyle === 'lightHatch') {
                            fills.fillPolyD(poly, 'hatch', angleDeg, spacingFill * 2.3, runSeed).forEach(function (d) {
                                parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (sw * 0.7).toFixed(2) + '" stroke-linecap="round" opacity="0.55"/>');
                            });
                        }
                    }
                    runStart = k4; runFront = front;
                }
            }
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'ribbontwist',
        description: 'Parametric twisting ribbons: width modulated by cos(theta) gives the 2D illusion of a 3D twist — barber pole, DNA helix, spiral vortex, or flower petals.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Barber Pole', values: { pathType: 'straight', numRibbons: 1, twistRate: 8, ribbonWidth: 34, fillStyle: 'hatch', backFaceStyle: 'blank' } },
            { label: 'DNA Helix', values: { pathType: 'straight', numRibbons: 2, twistRate: 6, ribbonWidth: 16, phaseJitter: 0, backFaceStyle: 'lightHatch' } },
            { label: 'Spiral Vortex', values: { pathType: 'spiral', numRibbons: 2, twistRate: 3, ribbonWidth: 18, fillStyle: 'crosshatch' } },
            { label: 'Flower Petals', values: { pathType: 'arc', numRibbons: 6, twistRate: 2, ribbonWidth: 22, palette: ['#e63946', '#2196f3', '#ff9800', '#4caf50', '#9c27b0'] } },
            { label: 'Drift Waves', values: { pathType: 'wave', numRibbons: 5, twistRate: 4, waveAmplitude: 55, waveFreq: 1.2, backFaceStyle: 'lightHatch' } }
        ],
        generate: generate
    };
})();
