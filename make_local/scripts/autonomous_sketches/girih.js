/**
 * girih — 2026-07-02
 *
 * Islamic geometric strapwork tessellation. A lattice of N-pointed star
 * polygons (triangular or square packing) is connected tip-to-tip by
 * straight "strap" lines to each neighboring star, the same construction
 * real girih tile art uses to render interlocking star lattices as pure
 * line work — no polygon boolean ops, just nearest-tip matching between
 * adjacent lattice points.
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    // LCG random — deterministic per seed
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
        { value: '#c9a227', label: 'Gold' },  { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        girih_classic: { latticeType: 'triangular', starPoints: 8, cellSizeMm: 26, innerRatio: 0.35,
            rotationMode: 'alternate', angleJitterDeg: 0, strapStyle: 'ribbon', strapWidthMm: 1.6,
            fillStyle: 'none', palette: ['#1a1a1a'], bgColor: '#f2ead9' },
        rosette: { latticeType: 'triangular', starPoints: 12, cellSizeMm: 34, innerRatio: 0.46,
            rotationMode: 'fixed', angleJitterDeg: 0, strapStyle: 'single', strapWidthMm: 1.0,
            fillStyle: 'hatch', palette: ['#8a4b12', '#c9a227'], bgColor: '#f7ecd8' },
        lattice_blue: { latticeType: 'square', starPoints: 8, cellSizeMm: 24, innerRatio: 0.34,
            rotationMode: 'alternate', angleJitterDeg: 0, strapStyle: 'ribbon', strapWidthMm: 1.4,
            fillStyle: 'none', palette: ['#bfe0ff'], bgColor: '#0d2438' },
        mosaic: { latticeType: 'square', starPoints: 6, cellSizeMm: 17, innerRatio: 0.4,
            rotationMode: 'random', angleJitterDeg: 8, strapStyle: 'single', strapWidthMm: 0.8,
            fillStyle: 'crosshatch', palette: ['#e63946', '#2196f3', '#ff9800', '#4caf50'], bgColor: '#fbf6ec' },
        starfield: { latticeType: 'triangular', starPoints: 10, cellSizeMm: 30, innerRatio: 0.28,
            rotationMode: 'random', angleJitterDeg: 5, strapStyle: 'none', strapWidthMm: 1.0,
            fillStyle: 'sketchHatch', palette: ['#f2ead9'], bgColor: '#111318' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f2ead9', group: 'color' },
        { id: 'latticeType', label: 'Lattice', type: 'select', value: 'triangular',
          options: [{ value: 'triangular', label: 'Triangular (6 neighbors)' },
                    { value: 'square', label: 'Square (8 neighbors)' }], group: 'general' },
        { id: 'starPoints', label: 'Star points', type: 'range', min: 5, max: 12, step: 1, value: 8, group: 'general' },
        { id: 'cellSizeMm', label: 'Cell size (mm)', type: 'range', min: 12, max: 45, step: 1, value: 26, group: 'general' },
        { id: 'innerRatio', label: 'Star spikiness', type: 'range', min: 0.15, max: 0.6, step: 0.01, value: 0.35, group: 'general' },
        { id: 'rotationMode', label: 'Star rotation', type: 'select', value: 'alternate',
          options: [{ value: 'fixed', label: 'Fixed' }, { value: 'alternate', label: 'Alternating' },
                    { value: 'random', label: 'Random' }], group: 'general' },
        { id: 'angleJitterDeg', label: 'Rotation jitter', type: 'range', min: 0, max: 15, step: 1, value: 0, group: 'general' },
        { id: 'strapStyle', label: 'Strap style', type: 'select', value: 'ribbon',
          options: [{ value: 'single', label: 'Single line' }, { value: 'ribbon', label: 'Ribbon' },
                    { value: 'none', label: 'Stars only' }], group: 'general' },
        { id: 'strapWidthMm', label: 'Strap width (mm)', type: 'range', min: 0.5, max: 4, step: 0.1, value: 1.6, group: 'general' },
        { id: 'fillStyle', label: 'Star fill', type: 'select', value: 'none',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]), group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

    function starPolygon(cx, cy, N, R, r, rotation) {
        var pts = [];
        for (var k = 0; k < 2 * N; k++) {
            var ang = rotation + k * (Math.PI / N);
            var rad = (k % 2 === 0) ? R : r;
            pts.push({ x: cx + rad * Math.cos(ang), y: cy + rad * Math.sin(ang) });
        }
        return pts;
    }

    function starTips(cx, cy, N, R, rotation) {
        var tips = [];
        for (var i = 0; i < N; i++) {
            var ang = rotation + i * (2 * Math.PI / N);
            tips.push({ x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), angle: ang });
        }
        return tips;
    }

    function nearestTip(tips, dirAngle) {
        var best = null, bestDelta = Infinity;
        for (var i = 0; i < tips.length; i++) {
            var d = Math.atan2(Math.sin(tips[i].angle - dirAngle), Math.cos(tips[i].angle - dirAngle));
            var ad = Math.abs(d);
            if (ad < bestDelta) { bestDelta = ad; best = tips[i]; }
        }
        return best;
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

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var starColor = palette[0];
        var strapColor = palette.length > 1 ? palette[1] : palette[0];

        var N = Math.round(P.starPoints);
        var cellPx = paper.mmToPixels(Number(P.cellSizeMm) || 26);
        var R = cellPx * 0.4;
        var innerR = R * Math.max(0.1, Math.min(0.9, Number(P.innerRatio)));
        var jitterRad = (Number(P.angleJitterDeg) || 0) * Math.PI / 180;
        var strapWidthPx = paper.mmToPixels(Number(P.strapWidthMm) || 1.6);

        // Build lattice points that fully fit inside the margin box.
        var boxX0 = mp, boxY0 = mp, boxX1 = W - mp, boxY1 = H - mp;
        var points = [];

        function tryAdd(x, y, row, col) {
            if (x - R < boxX0 || x + R > boxX1 || y - R < boxY0 || y + R > boxY1) return;
            points.push({ x: x, y: y, row: row, col: col });
        }

        if (P.latticeType === 'triangular') {
            var dy = cellPx * Math.sqrt(3) / 2;
            var rows = Math.ceil((boxY1 - boxY0) / dy) + 2;
            var cols = Math.ceil((boxX1 - boxX0) / cellPx) + 2;
            for (var r = -1; r <= rows; r++) {
                var y = boxY0 + r * dy;
                var xOff = (r % 2 !== 0) ? cellPx / 2 : 0;
                for (var c = -1; c <= cols; c++) {
                    var x = boxX0 + c * cellPx + xOff;
                    tryAdd(x, y, r, c);
                }
            }
        } else {
            var rowsSq = Math.ceil((boxY1 - boxY0) / cellPx) + 2;
            var colsSq = Math.ceil((boxX1 - boxX0) / cellPx) + 2;
            for (var rS = -1; rS <= rowsSq; rS++) {
                for (var cS = -1; cS <= colsSq; cS++) {
                    tryAdd(boxX0 + cS * cellPx, boxY0 + rS * cellPx, rS, cS);
                }
            }
        }

        // Assign rotation + build star geometry per point.
        points.forEach(function (pt, idx) {
            var rotation;
            if (P.rotationMode === 'fixed') rotation = -Math.PI / 2;
            else if (P.rotationMode === 'random') rotation = rng() * 2 * Math.PI;
            else rotation = -Math.PI / 2 + (((pt.row + pt.col) % 2 !== 0) ? (Math.PI / N) : 0);
            if (jitterRad > 0) rotation += (rng() * 2 - 1) * jitterRad;
            pt.rotation = rotation;
            pt.poly = starPolygon(pt.x, pt.y, N, R, innerR, rotation);
            pt.tips = starTips(pt.x, pt.y, N, R, rotation);
            pt.seed = ((seed ^ (idx * 2654435761)) >>> 0);
        });

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        // Straps first (under the stars), connecting each near-neighbor pair once.
        if (P.strapStyle !== 'none') {
            var spacingTol = cellPx * 0.1;
            var diagPx = cellPx * Math.SQRT2;
            for (var i = 0; i < points.length; i++) {
                for (var j = i + 1; j < points.length; j++) {
                    var d = dist(points[i], points[j]);
                    var isNeighbor = Math.abs(d - cellPx) < spacingTol ||
                        (P.latticeType === 'square' && Math.abs(d - diagPx) < spacingTol);
                    if (!isNeighbor) continue;

                    var dirAB = Math.atan2(points[j].y - points[i].y, points[j].x - points[i].x);
                    var tipA = nearestTip(points[i].tips, dirAB);
                    var tipB = nearestTip(points[j].tips, dirAB + Math.PI);
                    if (!tipA || !tipB) continue;

                    if (P.strapStyle === 'single') {
                        parts.push('<line x1="' + tipA.x.toFixed(2) + '" y1="' + tipA.y.toFixed(2) +
                            '" x2="' + tipB.x.toFixed(2) + '" y2="' + tipB.y.toFixed(2) +
                            '" stroke="' + strapColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                    } else {
                        var perp = { x: -(tipB.y - tipA.y), y: (tipB.x - tipA.x) };
                        var plen = Math.sqrt(perp.x * perp.x + perp.y * perp.y) || 1;
                        var ox = (perp.x / plen) * (strapWidthPx / 2), oy = (perp.y / plen) * (strapWidthPx / 2);
                        parts.push('<line x1="' + (tipA.x + ox).toFixed(2) + '" y1="' + (tipA.y + oy).toFixed(2) +
                            '" x2="' + (tipB.x + ox).toFixed(2) + '" y2="' + (tipB.y + oy).toFixed(2) +
                            '" stroke="' + strapColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                        parts.push('<line x1="' + (tipA.x - ox).toFixed(2) + '" y1="' + (tipA.y - oy).toFixed(2) +
                            '" x2="' + (tipB.x - ox).toFixed(2) + '" y2="' + (tipB.y - oy).toFixed(2) +
                            '" stroke="' + strapColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                    }
                }
            }
        }

        // Stars on top: optional fill, then outline.
        var spacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
        var globalAngle = fills.getFillAngle();
        var fillProb = fills.getFillProb();
        points.forEach(function (pt) {
            if (P.fillStyle !== 'none' && rng() <= fillProb) {
                var angleDeg = globalAngle + (pt.rotation * 180 / Math.PI);
                fills.fillPolyD(pt.poly, P.fillStyle, angleDeg, spacing, pt.seed).forEach(function (d) {
                    parts.push('<path d="' + d + '" fill="none" stroke="' + starColor +
                        '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                });
            }
            parts.push('<polygon points="' + pt.poly.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
                '" fill="none" stroke="' + starColor + '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');
        });

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'girih',
        description: 'Islamic geometric strapwork — tip-to-tip star lattice tessellation.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Classic strapwork', values: { latticeType: 'triangular', starPoints: 8, rotationMode: 'alternate', strapStyle: 'ribbon', fillStyle: 'none' } },
            { label: 'Rosette', values: { latticeType: 'triangular', starPoints: 12, cellSizeMm: 34, innerRatio: 0.46, strapStyle: 'single', fillStyle: 'hatch' } },
            { label: 'Blueprint lattice', values: { latticeType: 'square', starPoints: 8, strapStyle: 'ribbon', fillStyle: 'none', palette: ['#bfe0ff'], bgColor: '#0d2438' } },
            { label: 'Mosaic', values: { latticeType: 'square', starPoints: 6, cellSizeMm: 17, rotationMode: 'random', angleJitterDeg: 8, fillStyle: 'crosshatch' } },
            { label: 'Starfield', values: { latticeType: 'triangular', starPoints: 10, strapStyle: 'none', fillStyle: 'sketchHatch' } }
        ],
        generate: generate
    };
})();
