/**
 * riverdelta — meandering river delta network
 *
 * A single sine-generated meander curve (the Langbein-Leopold model from
 * real river geomorphology: flow direction = thetaMax*cos(2*pi*s/wavelength),
 * which produces natural-looking bends with a closed-form direction function,
 * no simulation needed) flows from a source at the top of the page. Sharp
 * bends occasionally cut off into small disconnected oxbow lakes. The stem
 * then recursively bifurcates into a cascade of ever-narrower distributary
 * channels, each with its own smaller/faster meander, reaching a coastline
 * and fanning into a few short tendrils over an open, textured sea.
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
        { value: '#0c3a52', label: 'Deep teal' }, { value: '#2196f3', label: 'Blue' },
        { value: '#5a3d24', label: 'Umber' }, { value: '#8a6d3b', label: 'Ochre' },
        { value: '#e63946', label: 'Red' }, { value: '#4caf50', label: 'Green' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        meander: { palette: ['#5a3d24', '#8a6d3b'], bgColor: '#f4ecdc', meanderAmplitude: 28,
                   meanderWavelength: 95, channelWidth: 15, branchDepth: 3, branchSpread: 40,
                   deltaStart: 0.6, oxbowDensity: 60, fillStyle: 'waves', seaStyle: 'hatch' },
        delta_fan: { palette: ['#0c3a52', '#2196f3', '#7fd8ff'], bgColor: '#eef6fb', meanderAmplitude: 22,
                   meanderWavelength: 100, channelWidth: 20, branchDepth: 6, branchSpread: 55,
                   deltaStart: 0.4, oxbowDensity: 15, fillStyle: 'waves', seaStyle: 'waves' },
        blackwater: { palette: ['#e0d8c0'], bgColor: '#10120c', meanderAmplitude: 48,
                   meanderWavelength: 105, channelWidth: 12, branchDepth: 2, branchSpread: 35,
                   deltaStart: 0.68, oxbowDensity: 85, fillStyle: 'hatch', seaStyle: 'hatch' },
        braided: { palette: ['#3a2a1a', '#8a6d3b', '#b08d57'], bgColor: '#f7f1e3', meanderAmplitude: 24,
                   meanderWavelength: 90, channelWidth: 17, branchDepth: 5, branchSpread: 26,
                   deltaStart: 0.5, oxbowDensity: 30, fillStyle: 'hatch', seaStyle: 'hatch' },
        blueprint: { palette: ['#bcd9ee'], bgColor: '#0d2136', meanderAmplitude: 26,
                   meanderWavelength: 95, channelWidth: 14, branchDepth: 4, branchSpread: 45,
                   deltaStart: 0.55, oxbowDensity: 40, fillStyle: 'none', seaStyle: 'none' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#5a3d24'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f4ecdc', group: 'color' },
        { id: 'sourceX', label: 'Source position', type: 'range', min: 20, max: 80, step: 5, value: 50, group: 'general' },
        { id: 'meanderAmplitude', label: 'Meander tightness', type: 'range', min: 8, max: 55, step: 1, value: 28, group: 'general' },
        { id: 'meanderWavelength', label: 'Meander wavelength (mm)', type: 'range', min: 40, max: 160, step: 5, value: 95, group: 'general' },
        { id: 'channelWidth', label: 'Channel width (mm)', type: 'range', min: 4, max: 30, step: 1, value: 15, group: 'general' },
        { id: 'widthDecay', label: 'Width decay per split', type: 'range', min: 0.5, max: 0.9, step: 0.02, value: 0.72, group: 'general' },
        { id: 'branchDepth', label: 'Delta depth', type: 'range', min: 1, max: 6, step: 1, value: 4, group: 'general' },
        { id: 'branchSpread', label: 'Branch spread', type: 'range', min: 18, max: 90, step: 2, value: 42, group: 'general' },
        { id: 'deltaStart', label: 'Delta start (fraction)', type: 'range', min: 0.3, max: 0.7, step: 0.05, value: 0.55, group: 'general' },
        { id: 'oxbowDensity', label: 'Oxbow lake chance', type: 'range', min: 0, max: 100, step: 5, value: 45, group: 'general' },
        { id: 'fillStyle', label: 'Water texture', type: 'select', value: 'waves', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) },
        { id: 'seaStyle', label: 'Sea texture', type: 'select', value: 'waves', group: 'general',
          options: [{ value: 'waves', label: 'Waves' }, { value: 'hatch', label: 'Hatch' }, { value: 'none', label: 'None' }] }
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
        var dW = W - 2 * mp, dH = H - 2 * mp;

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#f4ecdc';

        var density = fills.getEffectiveDensity();
        var spacingFill = (paper.DPI / 25.4) / Math.max(0.2, density);

        var baseWidthPx = paper.mmToPixels(Number(P.channelWidth) || 15);
        var minWidthPx = paper.mmToPixels(1.0);
        var widthDecay = Math.min(0.9, Math.max(0.5, Number(P.widthDecay) || 0.72));
        var branchDepth = Math.max(1, Math.round(P.branchDepth) || 4);
        var branchSpreadRad = (Number(P.branchSpread) || 42) * Math.PI / 180;
        var thetaMaxRad = (Number(P.meanderAmplitude) || 70) * Math.PI / 180;
        var wavelengthPx = paper.mmToPixels(Number(P.meanderWavelength) || 60);
        var deltaStart = Math.min(0.7, Math.max(0.3, Number(P.deltaStart) || 0.55));
        var oxbowChance = Math.min(1, Math.max(0, Number(P.oxbowDensity) || 0) / 100);

        var COAST_FRAC = 0.9;
        var deltaY = mp + dH * deltaStart;
        var coastY = mp + dH * COAST_FRAC;

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function stepMeander(x, y, heading, thetaAmp, wavelen, phase, targetY, maxSteps) {
            var stepPx = 2.2;
            var pts = [{ x: x, y: y, theta: 0 }];
            var s = 0, prevTheta = 0, prevDelta = 0;
            var apexes = [];
            for (var i = 0; i < maxSteps; i++) {
                s += stepPx;
                var theta = thetaAmp * Math.cos(2 * Math.PI * s / wavelen + phase);
                var phi = heading + theta;
                x += stepPx * Math.sin(phi);
                y += stepPx * Math.cos(phi);
                pts.push({ x: x, y: y, theta: theta, phi: phi });
                var delta = theta - prevTheta;
                if (i > 1 && delta * prevDelta < 0 && Math.abs(prevTheta) > thetaAmp * 0.6) {
                    apexes.push(pts.length - 2);
                }
                prevDelta = delta || prevDelta; prevTheta = theta;
                if (y >= targetY) break;
            }
            var lastPt = pts[pts.length - 1];
            return { pts: pts, apexes: apexes, endHeading: (lastPt.phi !== undefined) ? lastPt.phi : heading };
        }

        function buildRibbon(pts, w0, w1) {
            var n = pts.length;
            for (var i = 0; i < n; i++) {
                var p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
                var tx = p1.x - p0.x, ty = p1.y - p0.y;
                var len = Math.hypot(tx, ty) || 1;
                pts[i].tx = tx / len; pts[i].ty = ty / len;
                pts[i].nx = -pts[i].ty; pts[i].ny = pts[i].tx;
            }
            var edgeA = [], edgeB = [];
            for (var k = 0; k < n; k++) {
                var t = k / Math.max(1, n - 1);
                var hw = (w0 * (1 - t) + w1 * t) / 2;
                edgeA.push({ x: pts[k].x + pts[k].nx * hw, y: pts[k].y + pts[k].ny * hw });
                edgeB.push({ x: pts[k].x - pts[k].nx * hw, y: pts[k].y - pts[k].ny * hw });
            }
            return { edgeA: edgeA, edgeB: edgeB };
        }

        function drawSegment(pts, w0, w1, color, segSeed) {
            var rib = buildRibbon(pts, w0, w1);
            parts.push('<path d="' + pathD(rib.edgeA) + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
            parts.push('<path d="' + pathD(rib.edgeB) + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
            if (P.fillStyle !== 'none') {
                var poly = rib.edgeA.concat(rib.edgeB.slice().reverse());
                var mid = pts[Math.floor(pts.length / 2)];
                var angleDeg = Math.atan2(mid.ty || 0, mid.tx || 1) * 180 / Math.PI;
                fills.fillPolyD(poly, P.fillStyle, angleDeg, spacingFill, segSeed).forEach(function (d) {
                    parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (sw * 0.85).toFixed(2) + '" stroke-linecap="round"/>');
                });
            }
        }

        var oxbowsDrawn = 0, MAX_OXBOWS = 7;

        function drawOxbow(pt, width, sign, color, oxSeed) {
            if (oxbowsDrawn >= MAX_OXBOWS) return;
            oxbowsDrawn++;
            var r = width * 0.65 + minWidthPx * 0.3;
            var rx = r * 1.3, ry = r * 0.7;
            var cx = pt.x + pt.nx * sign * (width * 0.5 + ry * 0.8);
            var cy = pt.y + pt.ny * sign * (width * 0.5 + ry * 0.8);
            var tAngle = Math.atan2(pt.ty, pt.tx);
            var N = 20, poly = [];
            for (var i = 0; i < N; i++) {
                var a = (i / N) * Math.PI * 2;
                var lx = Math.cos(a) * rx, ly = Math.sin(a) * ry;
                var rxp = lx * Math.cos(tAngle) - ly * Math.sin(tAngle);
                var ryp = lx * Math.sin(tAngle) + ly * Math.cos(tAngle);
                poly.push({ x: cx + rxp, y: cy + ryp });
            }
            parts.push('<path d="' + pathD(poly) + ' Z" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');
            if (P.fillStyle !== 'none') {
                fills.fillPolyD(poly, P.fillStyle, tAngle * 180 / Math.PI, spacingFill * 1.2, oxSeed).forEach(function (d) {
                    parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (sw * 0.8).toFixed(2) + '" stroke-linecap="round"/>');
                });
            }
        }

        function drawFan(x, y, heading, width, colorSeedIdx) {
            var color = palette[colorSeedIdx % palette.length];
            var tendrils = 2 + Math.floor(rng() * 2);
            var seaBand = Math.max(10, (mp + dH) - coastY);
            var len = Math.max(14, Math.min(seaBand * 0.85, seaBand * (0.5 + rng() * 0.4)));
            for (var i = 0; i < tendrils; i++) {
                var spread = (tendrils <= 1) ? 0 : (i / (tendrils - 1) - 0.5) * 0.9;
                var h = heading + spread + (rng() - 0.5) * 0.2;
                var dirx = Math.sin(h), diry = Math.cos(h);
                var perpx = Math.cos(h), perpy = -Math.sin(h);
                var steps = 14;
                var pts = [{ x: x, y: y }];
                for (var s2 = 1; s2 <= steps; s2++) {
                    var t = s2 / steps;
                    var wig = Math.sin(t * Math.PI * 2.2) * width * 0.18;
                    pts.push({ x: x + dirx * len * t + perpx * wig, y: y + diry * len * t + perpy * wig });
                }
                parts.push('<path d="' + pathD(pts) + '" fill="none" stroke="' + color + '" stroke-width="' + (Math.max(sw * 0.6, width * 0.22)).toFixed(2) + '" stroke-linecap="round"/>');
            }
        }

        var branchCounter = 0, MAX_BRANCHES = 400;

        function grow(x, y, heading, depthIndex) {
            branchCounter++;
            if (branchCounter > MAX_BRANCHES) return;
            var width = Math.max(minWidthPx, baseWidthPx * Math.pow(widthDecay, depthIndex));
            if (y >= coastY || depthIndex > branchDepth) {
                drawFan(x, y, heading, width, depthIndex);
                return;
            }
            var levelSpan = (coastY - deltaY) / branchDepth;
            var targetY = Math.min(coastY, deltaY + (depthIndex + 1) * levelSpan);
            var localAmp = thetaMaxRad * Math.pow(0.85, depthIndex);
            var localWavelen = Math.max(12, wavelengthPx * Math.pow(0.82, depthIndex));
            var phase = rng() * Math.PI * 2;
            var walk = stepMeander(x, y, heading, localAmp, localWavelen, phase, targetY, 260);
            var color = palette[depthIndex % palette.length];
            drawSegment(walk.pts, width, Math.max(minWidthPx, width * 0.9), color, (seed ^ (depthIndex * 977 + branchCounter * 131)) >>> 0);

            var last = walk.pts[walk.pts.length - 1];
            var nextWidth = Math.max(minWidthPx, width * widthDecay);
            if (last.y >= coastY - 0.5) {
                drawFan(last.x, last.y, walk.endHeading, nextWidth, depthIndex + 1);
                return;
            }
            if (depthIndex >= branchDepth || nextWidth <= minWidthPx * 1.02) {
                drawFan(last.x, last.y, walk.endHeading, nextWidth, depthIndex + 1);
                return;
            }
            var triple = (rng() < 0.16 && depthIndex < branchDepth - 1);
            if (triple) grow(last.x, last.y, walk.endHeading + (rng() - 0.5) * 0.15, depthIndex + 1);
            var d1 = branchSpreadRad / 2 + (rng() - 0.5) * 0.3;
            var d2 = -branchSpreadRad / 2 + (rng() - 0.5) * 0.3;
            grow(last.x, last.y, walk.endHeading + d1, depthIndex + 1);
            grow(last.x, last.y, walk.endHeading + d2, depthIndex + 1);
        }

        if (P.seaStyle !== 'none') {
            var seaPoly = [{ x: mp, y: coastY }, { x: mp + dW, y: coastY }, { x: mp + dW, y: mp + dH }, { x: mp, y: mp + dH }];
            fills.fillPolyD(seaPoly, P.seaStyle, 0, spacingFill * 1.7, (seed ^ 0x51a) >>> 0).forEach(function (d) {
                parts.push('<path d="' + d + '" fill="none" stroke="' + palette[0] + '" stroke-width="' + (sw * 0.8).toFixed(2) + '" stroke-linecap="round" opacity="0.7"/>');
            });
        }
        parts.push('<line x1="' + mp.toFixed(2) + '" y1="' + coastY.toFixed(2) + '" x2="' + (mp + dW).toFixed(2) + '" y2="' + coastY.toFixed(2) +
            '" stroke="' + palette[0] + '" stroke-width="' + (sw * 0.7).toFixed(2) + '" stroke-dasharray="' + (sw * 3).toFixed(1) + ',' + (sw * 2.4).toFixed(1) + '" opacity="0.6"/>');

        var startX = mp + dW * (Number(P.sourceX) || 50) / 100;
        var stemHeading = (rng() - 0.5) * 0.25;
        var stemPhase = rng() * Math.PI * 2;
        var stemWalk = stepMeander(startX, mp, stemHeading, thetaMaxRad, wavelengthPx, stemPhase, deltaY, 600);
        drawSegment(stemWalk.pts, baseWidthPx, baseWidthPx * 0.95, palette[0], seed >>> 0);

        for (var ai = 0; ai < stemWalk.apexes.length; ai++) {
            if (rng() < oxbowChance) {
                var idx = stemWalk.apexes[ai];
                var pt = stemWalk.pts[idx];
                var sign = pt.theta >= 0 ? 1 : -1;
                drawOxbow(pt, baseWidthPx, sign, palette[palette.length > 1 ? 1 : 0], (seed ^ (idx * 311 + 7)) >>> 0);
            }
        }

        var stemEnd = stemWalk.pts[stemWalk.pts.length - 1];
        grow(stemEnd.x, stemEnd.y, stemWalk.endHeading, 0);

        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'riverdelta',
        description: 'A sine-generated meandering river with cutoff oxbow lakes, bifurcating into a tapering delta of distributary channels reaching an open sea.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Meander', values: { meanderAmplitude: 28, meanderWavelength: 95, branchDepth: 3, deltaStart: 0.6, oxbowDensity: 60 } },
            { label: 'Delta Fan', values: { meanderAmplitude: 22, meanderWavelength: 100, branchDepth: 6, branchSpread: 55, deltaStart: 0.4, oxbowDensity: 15, palette: ['#0c3a52', '#2196f3', '#7fd8ff'] } },
            { label: 'Blackwater', values: { meanderAmplitude: 48, meanderWavelength: 105, branchDepth: 2, oxbowDensity: 85, palette: ['#e0d8c0'], bgColor: '#10120c' } },
            { label: 'Braided', values: { meanderAmplitude: 24, meanderWavelength: 90, branchDepth: 5, branchSpread: 26, palette: ['#3a2a1a', '#8a6d3b', '#b08d57'] } },
            { label: 'Blueprint', values: { meanderAmplitude: 26, meanderWavelength: 95, fillStyle: 'none', seaStyle: 'none', palette: ['#bcd9ee'], bgColor: '#0d2136' } }
        ],
        generate: generate
    };
})();
