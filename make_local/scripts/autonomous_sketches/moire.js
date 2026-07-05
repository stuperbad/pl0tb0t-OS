/**
 * moire — interference grating sketch (parametric)
 *
 * Stacks several copies of one repeating line family (concentric rings,
 * parallel lines, or radial spokes) where each successive layer's origin
 * spirals outward a little, its spacing scales by a small ratio, and (for
 * lines/radial) its angle rotates a few degrees. None of those mismatches
 * are large on their own, but layered together they beat against each other
 * the way two mismatched window screens do, producing dense interference
 * bands purely from overlapping strokes — no fills, no greyscale, just line
 * density doing the work of tone.
 */
(function () {
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    var D2R = Math.PI / 180;

    function pointInRect(p, rect) {
        return p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1;
    }

    // Groups a sampled point list into the contiguous runs that fall inside
    // rect. For closed curves (circles), stitches the wrap-around seam back
    // together so a fully-interior loop still emits as one closed chain.
    function chainInside(points, closed, rect) {
        var n = points.length, chains = [], current = null;
        for (var i = 0; i < n; i++) {
            if (pointInRect(points[i], rect)) {
                if (!current) current = [];
                current.push(points[i]);
            } else if (current) {
                chains.push(current);
                current = null;
            }
        }
        if (current) chains.push(current);
        if (closed && chains.length > 1 && pointInRect(points[0], rect) && pointInRect(points[n - 1], rect)) {
            var first = chains.shift(), last = chains.pop();
            chains.push(last.concat(first));
        } else if (closed && chains.length === 1 && chains[0].length === n) {
            chains[0] = chains[0].concat([points[0]]);
        }
        return chains.filter(function (c) { return c.length > 1; });
    }

    function chainsToPathD(chains) {
        var d = '';
        for (var i = 0; i < chains.length; i++) {
            var c = chains[i];
            d += 'M' + c[0].x.toFixed(1) + ',' + c[0].y.toFixed(1);
            for (var j = 1; j < c.length; j++) d += 'L' + c[j].x.toFixed(1) + ',' + c[j].y.toFixed(1);
        }
        return d;
    }

    function jitterPt(p, amt, rng) {
        if (!amt) return p;
        return { x: p.x + (rng() - 0.5) * amt, y: p.y + (rng() - 0.5) * amt };
    }

    function sampleCircle(cx, cy, r, nseg, jitter, rng) {
        var pts = [];
        for (var i = 0; i < nseg; i++) {
            var t = (i / nseg) * Math.PI * 2;
            pts.push(jitterPt({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r }, jitter, rng));
        }
        return pts;
    }

    function sampleSegment(x0, y0, x1, y1, nseg, jitter, rng) {
        var pts = [];
        for (var i = 0; i <= nseg; i++) {
            var t = i / nseg;
            pts.push(jitterPt({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }, jitter, rng));
        }
        return pts;
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#10243a', label: 'Navy' },
        { value: '#1a0a00', label: 'Umber' }, { value: '#2980b9', label: 'Blue' },
        { value: '#cc2200', label: 'Rust' },  { value: '#4caf50', label: 'Green' },
        { value: '#9c27b0', label: 'Purple' }, { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        rings:    { patternType: 'concentric', layerCount: 3, lineSpacing: 9,  offsetDistance: 26, offsetAngleStep: 110, rotationStep: 0,  scaleStep: 0.06, jitter: 0,   palette: ['#000000'], bgColor: '#f5f0e8' },
        grid_beat:{ patternType: 'lines',      layerCount: 3, lineSpacing: 7,  offsetDistance: 14, offsetAngleStep: 70,  rotationStep: 7,  scaleStep: 0.02, jitter: 0,   palette: ['#10243a'], bgColor: '#eef3f7' },
        starburst:{ patternType: 'radial',     layerCount: 4, lineSpacing: 5,  offsetDistance: 10, offsetAngleStep: 0,  rotationStep: 11, scaleStep: 0,    jitter: 0,   palette: ['#1a0a00'], bgColor: '#f7f0e0' },
        drift:    { patternType: 'concentric', layerCount: 5, lineSpacing: 8,  offsetDistance: 60, offsetAngleStep: 47, rotationStep: 0,  scaleStep: 0.1,  jitter: 1.2, palette: ['#000000', '#cc2200'], bgColor: '#f5f0e8' },
        mono_web: { patternType: 'lines',      layerCount: 4, lineSpacing: 11, offsetDistance: 8,  offsetAngleStep: 40, rotationStep: 6,  scaleStep: 0,    jitter: 0,   palette: ['#000000'], bgColor: '#ffffff' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#000000'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'patternType', label: 'Grating type', type: 'select', value: 'concentric', group: 'general',
          options: [{ value: 'concentric', label: 'Concentric rings' },
                    { value: 'lines', label: 'Parallel lines' },
                    { value: 'radial', label: 'Radial spokes' }] },
        { id: 'layerCount', label: 'Layers', type: 'range', min: 2, max: 7, step: 1, value: 3, group: 'general' },
        { id: 'lineSpacing', label: 'Spacing', type: 'range', min: 3, max: 30, step: 1, value: 9, group: 'general' },
        { id: 'offsetDistance', label: 'Layer drift', type: 'range', min: 0, max: 150, step: 2, value: 26, group: 'general' },
        { id: 'offsetAngleStep', label: 'Drift angle step', type: 'range', min: 0, max: 180, step: 1, value: 110, group: 'general' },
        { id: 'rotationStep', label: 'Rotation per layer', type: 'range', min: 0, max: 45, step: 1, value: 0, group: 'general' },
        { id: 'scaleStep', label: 'Frequency mismatch', type: 'range', min: -0.2, max: 0.3, step: 0.01, value: 0.06, group: 'general' },
        { id: 'jitter', label: 'Wobble', type: 'range', min: 0, max: 6, step: 0.2, value: 0, group: 'general' }
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

        var rect = { x0: mp, y0: mp, x1: W - mp, y1: H - mp };
        var pageCenter = { x: W / 2, y: H / 2 };
        var diag = Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0);
        var corners = [
            { x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 },
            { x: rect.x1, y: rect.y1 }, { x: rect.x0, y: rect.y1 }
        ];

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#000000'];
        var layerCount = Math.max(2, Math.round(P.layerCount));
        var jitter = Number(P.jitter) || 0;

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + P.bgColor + '"/>'
        ];

        for (var i = 0; i < layerCount; i++) {
            var spacing = P.lineSpacing * Math.pow(1 + Number(P.scaleStep), i);
            spacing = Math.max(P.lineSpacing * 0.3, Math.min(P.lineSpacing * 3, spacing));

            var driftAngle = P.offsetAngleStep * i * D2R;
            var driftDist = i === 0 ? 0 : P.offsetDistance;
            var origin = {
                x: pageCenter.x + Math.cos(driftAngle) * driftDist,
                y: pageCenter.y + Math.sin(driftAngle) * driftDist
            };

            var rotAngle = P.rotationStep * i;
            var color = palette[i % palette.length];
            var d = '';

            if (P.patternType === 'concentric') {
                var maxR = 0;
                for (var c = 0; c < corners.length; c++) maxR = Math.max(maxR, Math.hypot(corners[c].x - origin.x, corners[c].y - origin.y));
                var nseg = 72;
                for (var r = spacing; r <= maxR + spacing; r += spacing) {
                    var pts = sampleCircle(origin.x, origin.y, r, nseg, jitter, rng);
                    d += chainsToPathD(chainInside(pts, true, rect));
                }
            } else if (P.patternType === 'lines') {
                var dir = { x: Math.cos(rotAngle * D2R), y: Math.sin(rotAngle * D2R) };
                var nrm = { x: -dir.y, y: dir.x };
                var originProj = origin.x * nrm.x + origin.y * nrm.y;
                var minProj = Infinity, maxProj = -Infinity;
                for (var c2 = 0; c2 < corners.length; c2++) {
                    var pr = corners[c2].x * nrm.x + corners[c2].y * nrm.y;
                    if (pr < minProj) minProj = pr;
                    if (pr > maxProj) maxProj = pr;
                }
                var kMin = Math.floor((minProj - originProj) / spacing) - 1;
                var kMax = Math.ceil((maxProj - originProj) / spacing) + 1;
                var half = diag * 0.7;
                var nsegL = 40;
                for (var k = kMin; k <= kMax; k++) {
                    var off = k * spacing;
                    var cx = origin.x + nrm.x * off, cy = origin.y + nrm.y * off;
                    var pts2 = sampleSegment(cx - dir.x * half, cy - dir.y * half, cx + dir.x * half, cy + dir.y * half, nsegL, jitter, rng);
                    d += chainsToPathD(chainInside(pts2, false, rect));
                }
            } else { // radial
                var angleStepDeg = Math.max(2, Math.min(60, spacing));
                var spokeLen = diag * 0.75;
                var nsegR = 30;
                for (var a = rotAngle; a < 360 + rotAngle; a += angleStepDeg) {
                    var ar = a * D2R;
                    var ex = origin.x + Math.cos(ar) * spokeLen, ey = origin.y + Math.sin(ar) * spokeLen;
                    var pts3 = sampleSegment(origin.x, origin.y, ex, ey, nsegR, jitter, rng);
                    d += chainsToPathD(chainInside(pts3, false, rect));
                }
            }

            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
        }

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'moire',
        description: 'Interference grating: overlapping concentric/parallel/radial line families with mismatched spacing, rotation, and offset beat against each other.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Rings', values: { patternType: 'concentric', layerCount: 3, lineSpacing: 9, offsetDistance: 26, offsetAngleStep: 110, scaleStep: 0.06, palette: ['#000000'] } },
            { label: 'Grid beat', values: { patternType: 'lines', layerCount: 3, lineSpacing: 7, offsetDistance: 14, offsetAngleStep: 70, rotationStep: 7, scaleStep: 0.02, palette: ['#10243a'] } },
            { label: 'Starburst', values: { patternType: 'radial', layerCount: 4, lineSpacing: 5, offsetDistance: 10, rotationStep: 11, palette: ['#1a0a00'] } },
            { label: 'Drift', values: { patternType: 'concentric', layerCount: 5, lineSpacing: 8, offsetDistance: 60, offsetAngleStep: 47, scaleStep: 0.1, jitter: 1.2, palette: ['#000000', '#cc2200'] } },
            { label: 'Mono web', values: { patternType: 'lines', layerCount: 4, lineSpacing: 11, offsetDistance: 8, offsetAngleStep: 40, rotationStep: 6, palette: ['#000000'] } }
        ],
        generate: generate
    };
})();
