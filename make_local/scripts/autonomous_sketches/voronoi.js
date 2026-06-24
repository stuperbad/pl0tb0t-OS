/**
 * voronoi — relaxed Voronoi mosaic (parametric)
 *
 * True polygonal Voronoi cells built by half-plane clipping (Sutherland-
 * Hodgman) of a bounding rectangle against every other seed's perpendicular
 * bisector — no external geometry library. Optional Lloyd relaxation moves
 * each seed to its cell centroid over a few iterations, settling random
 * points into the even, organic "soap bubble" packing classic Voronoi art
 * is known for. Each cell is then inset slightly (gap between cells) and
 * hatch-filled, with color/angle driven by one of several per-cell rules.
 * Headless email path: generate(seed, 'fractured').
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    // Clip convex polygon `poly` to the half-plane { x : x.n <= c }.
    function clipHalfPlane(poly, nx, ny, c) {
        if (poly.length === 0) return poly;
        var out = [];
        for (var i = 0; i < poly.length; i++) {
            var cur = poly[i], nxt = poly[(i + 1) % poly.length];
            var curSide = cur.x * nx + cur.y * ny - c;
            var nxtSide = nxt.x * nx + nxt.y * ny - c;
            if (curSide <= 0) out.push(cur);
            if ((curSide <= 0) !== (nxtSide <= 0)) {
                var t = curSide / (curSide - nxtSide);
                out.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) });
            }
        }
        return out;
    }

    function voronoiCell(seeds, i, bboxPoly) {
        var p = seeds[i], poly = bboxPoly;
        for (var j = 0; j < seeds.length; j++) {
            if (j === i) continue;
            var q = seeds[j];
            var nx = q.x - p.x, ny = q.y - p.y;
            var c = (q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y) / 2;
            poly = clipHalfPlane(poly, nx, ny, c);
            if (poly.length === 0) break;
        }
        return poly;
    }

    // Signed area (shoelace) and area-weighted centroid of a simple polygon.
    function polyAreaCentroid(poly) {
        var a = 0, cx = 0, cy = 0;
        for (var i = 0; i < poly.length; i++) {
            var p0 = poly[i], p1 = poly[(i + 1) % poly.length];
            var cross = p0.x * p1.y - p1.x * p0.y;
            a += cross; cx += (p0.x + p1.x) * cross; cy += (p0.y + p1.y) * cross;
        }
        a /= 2;
        if (Math.abs(a) < 1e-6) {
            var sx = 0, sy = 0;
            for (var k = 0; k < poly.length; k++) { sx += poly[k].x; sy += poly[k].y; }
            return { area: 0, x: sx / poly.length, y: sy / poly.length };
        }
        return { area: Math.abs(a), x: cx / (6 * a), y: cy / (6 * a) };
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: '#8b4513', label: 'Brown' }, { value: '#52527a', label: 'Slate' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        organic:      { seedDistribution: 'gridJitter', relaxIterations: 3, cellScale: 0.88,
                        fillStyle: 'hatch', colorMode: 'byDistance', numSeeds: 70,
                        palette: ['#5c3317', '#8b4513', '#a0522d', '#c8a26b'] },
        fractured:    { seedDistribution: 'random', relaxIterations: 0, cellScale: 0.97,
                        fillStyle: 'crosshatch', colorMode: 'randomPerCell', numSeeds: 110,
                        palette: ['#1c1c2e', '#3d3d5c', '#52527a', '#cc2200'] },
        radial_bloom: { seedDistribution: 'radial', relaxIterations: 2, hatchAngleMode: 'radialFromCenter',
                        fillStyle: 'hatch', colorMode: 'byCellSize', numSeeds: 80,
                        palette: ['#ff4500', '#ff8c00', '#ffd700', '#e63946', '#ff9800'] },
        blueprint_cells: { seedDistribution: 'gridJitter', relaxIterations: 4, fillStyle: 'none',
                        strokeOutline: 'yes', colorMode: 'single', numSeeds: 55,
                        palette: ['#bcd4ee'] }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#000000'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#ffffff', group: 'advanced' },
        { id: 'numSeeds', label: 'Cell count', type: 'range', min: 10, max: 150, step: 5, value: 60, group: 'general' },
        { id: 'seedDistribution', label: 'Seed layout', type: 'select', value: 'random', group: 'general',
          options: [{ value: 'random', label: 'Random' }, { value: 'gridJitter', label: 'Grid jitter' },
                    { value: 'radial', label: 'Radial' }] },
        { id: 'relaxIterations', label: 'Relax (Lloyd)', type: 'range', min: 0, max: 4, step: 1, value: 2, group: 'general' },
        { id: 'cellScale', label: 'Cell inset', type: 'range', min: 0.5, max: 1.0, step: 0.01, value: 0.92, group: 'general' },
        { id: 'fillStyle', label: 'Fills', type: 'select', multiSelect: true, value: ['hatch'], group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS },
        { id: 'hatchAngleMode', label: 'Hatch angle', type: 'select', value: 'perCellRandom', group: 'general',
          options: [{ value: 'fixed', label: 'Fixed' }, { value: 'perCellRandom', label: 'Per-cell random' },
                    { value: 'radialFromCenter', label: 'Radial from center' }] },
        { id: 'strokeOutline', label: 'Cell borders', type: 'select', value: 'yes', group: 'general',
          options: [{ value: 'yes', label: 'On' }, { value: 'no', label: 'Off' }] },
        { id: 'colorMode', label: 'Color by', type: 'select', value: 'randomPerCell', group: 'color',
          options: [{ value: 'single', label: 'Single' }, { value: 'randomPerCell', label: 'Random per cell' },
                    { value: 'byDistance', label: 'Distance from center' }, { value: 'byCellSize', label: 'Cell size' }] }
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
        var penMm = Number(window._pl0tPenWidthMm) || 0.4;
        var sw = paper.mmToPixels(penMm);

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var bg = P.bgColor || '#ffffff';

        var ox = mp, oy = mp, dW = W - 2 * mp, dH = H - 2 * mp;
        var cx0 = ox + dW / 2, cy0 = oy + dH / 2;
        var bboxPoly = [{ x: ox, y: oy }, { x: ox + dW, y: oy }, { x: ox + dW, y: oy + dH }, { x: ox, y: oy + dH }];

        var n = Math.max(4, Math.round(P.numSeeds));
        var seeds = [];
        if (P.seedDistribution === 'gridJitter') {
            var cols = Math.max(2, Math.round(Math.sqrt(n * dW / dH)));
            var rows = Math.max(2, Math.ceil(n / cols));
            var cw = dW / cols, ch = dH / rows;
            for (var r = 0; r < rows && seeds.length < n; r++) {
                for (var c = 0; c < cols && seeds.length < n; c++) {
                    seeds.push({
                        x: ox + (c + 0.5) * cw + (rng() - 0.5) * cw * 0.8,
                        y: oy + (r + 0.5) * ch + (rng() - 0.5) * ch * 0.8
                    });
                }
            }
        } else if (P.seedDistribution === 'radial') {
            seeds.push({ x: cx0, y: cy0 });
            var rings = Math.max(2, Math.round(Math.sqrt(n)));
            var maxR = Math.min(dW, dH) / 2;
            var placed = 1;
            for (var ring = 1; ring <= rings && placed < n; ring++) {
                var ringR = maxR * ring / rings;
                var count = Math.max(4, Math.round(6 * ring));
                for (var a = 0; a < count && placed < n; a++) {
                    var ang = (a / count) * Math.PI * 2 + rng() * 0.3;
                    var rr = ringR * (0.85 + rng() * 0.3);
                    seeds.push({ x: cx0 + Math.cos(ang) * rr, y: cy0 + Math.sin(ang) * rr });
                    placed++;
                }
            }
        } else {
            for (var i0 = 0; i0 < n; i0++) seeds.push({ x: ox + rng() * dW, y: oy + rng() * dH });
        }

        var relax = Math.max(0, Math.round(P.relaxIterations));
        for (var iter = 0; iter < relax; iter++) {
            for (var ri = 0; ri < seeds.length; ri++) {
                var cell = voronoiCell(seeds, ri, bboxPoly);
                if (cell.length >= 3) {
                    var ac = polyAreaCentroid(cell);
                    if (ac.area > 1) seeds[ri] = { x: ac.x, y: ac.y };
                }
            }
        }

        var cells = [];
        for (var fi = 0; fi < seeds.length; fi++) {
            var poly = voronoiCell(seeds, fi, bboxPoly);
            if (poly.length >= 3) cells.push({ seed: seeds[fi], poly: poly });
        }

        var maxArea = 0;
        for (var ca = 0; ca < cells.length; ca++) {
            cells[ca].metrics = polyAreaCentroid(cells[ca].poly);
            if (cells[ca].metrics.area > maxArea) maxArea = cells[ca].metrics.area;
        }
        var maxDist = Math.max(1, Math.hypot(dW, dH) / 2);

        var density = fills.getEffectiveDensity();
        var imperfection = fills.getFillImperfection();
        var fillProb = fills.getFillProb();
        var spacing = (paper.DPI / 25.4) / Math.max(0.2, density);
        var globalAngle = fills.getFillAngle();
        var scale = Math.max(0.5, Math.min(1, Number(P.cellScale)));

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function emit(d, color) {
            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
        }

        for (var i = 0; i < cells.length; i++) {
            var c = cells[i], m = c.metrics;
            var inset = c.poly.map(function (pt) {
                return { x: m.x + (pt.x - m.x) * scale, y: m.y + (pt.y - m.y) * scale };
            });

            var color;
            if (P.colorMode === 'single') color = palette[0];
            else if (P.colorMode === 'byDistance') {
                var dist = Math.hypot(m.x - cx0, m.y - cy0) / maxDist;
                color = palette[Math.min(palette.length - 1, Math.floor(dist * palette.length))];
            } else if (P.colorMode === 'byCellSize') {
                var frac = maxArea > 0 ? m.area / maxArea : 0;
                color = palette[Math.min(palette.length - 1, Math.floor(frac * palette.length))];
            } else {
                color = palette[Math.floor(rng() * palette.length)];
            }

            if (P.strokeOutline === 'yes') {
                var outline = inset.map(function (pt) { return pt.x.toFixed(2) + ',' + pt.y.toFixed(2); }).join(' ');
                parts.push('<polygon points="' + outline + '" fill="none" stroke="' + color +
                    '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"/>');
            }

            if (rng() > fillProb) continue;

            var angle;
            if (P.hatchAngleMode === 'fixed') angle = globalAngle;
            else if (P.hatchAngleMode === 'radialFromCenter') angle = Math.atan2(m.y - cy0, m.x - cx0) * 180 / Math.PI;
            else angle = rng() * 180;

            fills.fillPolyMultiD(inset, P.fillStyle, angle, spacing, (seed ^ (i * 2654435761)) >>> 0).forEach(function (d) { emit(d, color); });
        }

        // Artboard edge frame — matches the built-in sketches' paper border.
        parts.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'voronoi',
        description: 'Relaxed Voronoi mosaic: true polygonal cells via half-plane clipping, optional Lloyd relaxation, per-cell hatch fills.',
        stylePresets: Object.keys(PRESETS).map(function (k) { return { label: k.replace(/_/g, ' '), values: PRESETS[k] }; }),
        presets: Object.keys(PRESETS),
        params: params,
        generate: generate
    };
})();
