/**
 * facetgem — 2026-07-21
 *
 * Low-poly faceted triangulation. A point set (random, radial, ridge, or
 * jittered-grid) is triangulated with a from-scratch Bowyer-Watson Delaunay
 * algorithm. Each point also carries a synthetic height (dome/peaks/ridge/
 * random/crater), so every triangle gets a fake-3D facet normal; a single
 * light direction turns that normal into a brightness value, which drives
 * both the hatch density (dark facets = tight hatch, bright facets = sparse
 * or blank) and, in "posterized" mode, which palette swatch is used —
 * the classic low-poly game-art look, rendered as pen-plotter line work.
 */
(function () {
    var fills = window.plotFills;
    var paper = window.makeSketchUtils;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (Math.imul(1664525, s) + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#1a1a1a', label: 'Near black' },
        { value: '#e63946', label: 'Red' },   { value: '#2196f3', label: 'Blue' },
        { value: '#0d3b66', label: 'Navy' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: '#00838f', label: 'Teal' },  { value: '#c9a227', label: 'Gold' },
        { value: '#ffffff', label: 'White' }, { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        crystal: { pointMode: 'radial', heightMode: 'dome', pointCount: 160, jitterAmt: 35,
            colorMode: 'posterized', palette: ['#0d3b66', '#2196f3', '#9c27b0', '#e63946', '#ffffff'],
            bgColor: '#0a0a12', lightAngleDeg: 55, lightElevDeg: 45, shadeContrast: 130 },
        mountain: { pointMode: 'ridge', heightMode: 'peaks', pointCount: 200, jitterAmt: 45,
            colorMode: 'elevation', palette: ['#0d3b66', '#00838f', '#4caf50', '#c9a227', '#ffffff'],
            bgColor: '#f5f0e8', lightAngleDeg: 315, lightElevDeg: 35, shadeContrast: 100 },
        geode: { pointMode: 'radial', heightMode: 'random', pointCount: 260, jitterAmt: 60,
            colorMode: 'random', palette: ['#e63946', '#ff9800', '#c9a227', '#9c27b0', '#00838f', '#2196f3'],
            bgColor: '#1a1a1a', lightAngleDeg: 200, lightElevDeg: 55, shadeContrast: 90 },
        ice: { pointMode: 'gridJitter', heightMode: 'crater', pointCount: 120, jitterAmt: 55,
            colorMode: 'mono', palette: ['#0d3b66'], bgColor: '#eef6fb',
            lightAngleDeg: 60, lightElevDeg: 60, shadeContrast: 160, fillStyle: 'hatch' },
        blueprint: { pointMode: 'gridJitter', heightMode: 'ridge', pointCount: 150, jitterAmt: 30,
            colorMode: 'mono', palette: ['#bcd7ea'], bgColor: '#0d1b2a',
            fillStyle: 'none', showEdges: 'on', lightAngleDeg: 135, lightElevDeg: 40 }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a', '#4caf50', '#c9a227'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'pointCount', label: 'Point count', type: 'range', min: 30, max: 350, step: 5, value: 160, group: 'general' },
        { id: 'pointMode', label: 'Point layout', type: 'select', value: 'radial', group: 'general',
          options: [ { value: 'random', label: 'Random' }, { value: 'radial', label: 'Radial' },
                     { value: 'ridge', label: 'Ridge band' }, { value: 'gridJitter', label: 'Jittered grid' } ] },
        { id: 'jitterAmt', label: 'Jitter / spread', type: 'range', min: 0, max: 100, step: 1, value: 40, group: 'general' },
        { id: 'heightMode', label: 'Height field', type: 'select', value: 'dome', group: 'general',
          options: [ { value: 'dome', label: 'Dome' }, { value: 'peaks', label: 'Peaks' },
                     { value: 'ridge', label: 'Ridge range' }, { value: 'random', label: 'Random (crystal)' },
                     { value: 'crater', label: 'Crater' } ] },
        { id: 'lightAngleDeg', label: 'Light angle', type: 'range', min: 0, max: 359, step: 1, value: 45, group: 'general' },
        { id: 'lightElevDeg', label: 'Light elevation', type: 'range', min: 5, max: 85, step: 1, value: 45, group: 'general' },
        { id: 'shadeContrast', label: 'Shade contrast', type: 'range', min: 20, max: 200, step: 5, value: 100, group: 'general' },
        { id: 'fillStyle', label: 'Fill style', type: 'select', value: 'hatch', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) },
        { id: 'colorMode', label: 'Color mode', type: 'select', value: 'posterized', group: 'general',
          options: [ { value: 'posterized', label: 'Posterized shading' }, { value: 'elevation', label: 'By elevation' },
                     { value: 'random', label: 'Random per facet' }, { value: 'mono', label: 'Single ink' } ] },
        { id: 'showEdges', label: 'Facet edges', type: 'select', value: 'on', group: 'general',
          options: [ { value: 'on', label: 'On' }, { value: 'off', label: 'Off' } ] }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    // ---- Bowyer-Watson Delaunay triangulation ----
    function delaunay(points) {
        var pts = points.slice();
        var n = pts.length;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < n; i++) {
            minX = Math.min(minX, pts[i].x); minY = Math.min(minY, pts[i].y);
            maxX = Math.max(maxX, pts[i].x); maxY = Math.max(maxY, pts[i].y);
        }
        var dmax = Math.max(maxX - minX, maxY - minY, 1) * 20;
        var midx = (minX + maxX) / 2, midy = (minY + maxY) / 2;
        var superStart = n;
        pts.push({ x: midx - dmax, y: midy - dmax }, { x: midx + dmax, y: midy - dmax }, { x: midx, y: midy + dmax });

        function circumContains(ai, bi, ci, di) {
            var A = pts[ai], B = pts[bi], C = pts[ci], D = pts[di];
            var ax = A.x - D.x, ay = A.y - D.y;
            var bx = B.x - D.x, by = B.y - D.y;
            var cx = C.x - D.x, cy = C.y - D.y;
            var det = (ax * ax + ay * ay) * (bx * cy - cx * by)
                    - (bx * bx + by * by) * (ax * cy - cx * ay)
                    + (cx * cx + cy * cy) * (ax * by - bx * ay);
            var orient = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
            return orient > 0 ? det > 0 : det < 0;
        }

        var tris = [[superStart, superStart + 1, superStart + 2]];

        for (var pi = 0; pi < n; pi++) {
            var bad = [];
            for (var t = 0; t < tris.length; t++) {
                if (circumContains(tris[t][0], tris[t][1], tris[t][2], pi)) bad.push(t);
            }
            var edgeCount = {}, edgeList = [];
            function addEdge(a, b) {
                var key = Math.min(a, b) + '_' + Math.max(a, b);
                if (edgeCount[key] === undefined) { edgeCount[key] = 1; edgeList.push([a, b, key]); }
                else edgeCount[key]++;
            }
            for (var bi2 = 0; bi2 < bad.length; bi2++) {
                var tr = tris[bad[bi2]];
                addEdge(tr[0], tr[1]); addEdge(tr[1], tr[2]); addEdge(tr[2], tr[0]);
            }
            var boundary = edgeList.filter(function (e) { return edgeCount[e[2]] === 1; });
            var badSet = {}; bad.forEach(function (bidx) { badSet[bidx] = true; });
            var newTris = [];
            for (var t2 = 0; t2 < tris.length; t2++) { if (!badSet[t2]) newTris.push(tris[t2]); }
            for (var e = 0; e < boundary.length; e++) newTris.push([boundary[e][0], boundary[e][1], pi]);
            tris = newTris;
        }

        var result = [];
        for (var t3 = 0; t3 < tris.length; t3++) {
            var tr2 = tris[t3];
            if (tr2[0] < n && tr2[1] < n && tr2[2] < n) result.push([pts[tr2[0]], pts[tr2[1]], pts[tr2[2]]]);
        }
        return result;
    }

    // ---- color helpers ----
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
        var num = parseInt(hex, 16);
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }
    function luminance(hex) { var c = hexToRgb(hex); return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }

    function buildBoundaryPoints(x0, y0, x1, y1, count) {
        var w = x1 - x0, h = y1 - y0, perim = 2 * (w + h);
        var pts = [];
        for (var i = 0; i < count; i++) {
            var d = (i / count) * perim;
            var x, y;
            if (d < w) { x = x0 + d; y = y0; }
            else if (d < w + h) { x = x1; y = y0 + (d - w); }
            else if (d < 2 * w + h) { x = x1 - (d - w - h); y = y1; }
            else { x = x0; y = y1 - (d - 2 * w - h); }
            pts.push({ x: x, y: y });
        }
        return pts;
    }

    function generate(seed, opts) {
        var P = buildDefaults();
        if (typeof opts === 'string') {
            if (PRESETS[opts]) for (var k in PRESETS[opts]) P[k] = PRESETS[opts][k];
        } else if (opts && typeof opts === 'object') {
            for (var k2 in opts) if (opts.hasOwnProperty(k2)) P[k2] = opts[k2];
        }

        var rng = makeRng(seed);
        var hatchRng = makeRng(seed + 977);
        var dims = paper.getPaperPixels(P.paperSize || '9x12');
        var W = dims.width, H = dims.height;
        var mp = paper.getMarginPixels(parseFloat(P.margin || 0.75));
        var sw = paper.mmToPixels(Number(window._pl0tPenWidthMm) || 0.4);

        var x0 = mp, y0 = mp, x1 = W - mp, y1 = H - mp;
        var boxW = x1 - x0, boxH = y1 - y0;
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        var maxR = Math.sqrt(boxW * boxW + boxH * boxH) / 2;

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var jitter01 = Math.max(0, Math.min(100, Number(P.jitterAmt))) / 100;

        // ---- point generation ----
        var interior = [];
        var n = Math.round(P.pointCount);
        if (P.pointMode === 'gridJitter') {
            var gridCols = Math.max(2, Math.round(Math.sqrt(n * boxW / boxH)));
            var gridRows = Math.max(2, Math.round(n / gridCols));
            var cellW = boxW / gridCols, cellH = boxH / gridRows;
            for (var gy = 0; gy < gridRows; gy++) {
                for (var gx = 0; gx < gridCols; gx++) {
                    var px = x0 + (gx + 0.5) * cellW + (rng() - 0.5) * cellW * jitter01 * 1.6;
                    var py = y0 + (gy + 0.5) * cellH + (rng() - 0.5) * cellH * jitter01 * 1.6;
                    interior.push({ x: Math.max(x0 + 2, Math.min(x1 - 2, px)), y: Math.max(y0 + 2, Math.min(y1 - 2, py)) });
                }
            }
        } else if (P.pointMode === 'radial') {
            var bias = 0.3 + (1 - jitter01) * 1.5;
            var minR01 = 0.08;
            for (var i1 = 0; i1 < n; i1++) {
                var ang = rng() * Math.PI * 2;
                var r = maxR * (minR01 + (1 - minR01) * Math.pow(rng(), bias));
                interior.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * (boxH / boxW) });
            }
        } else if (P.pointMode === 'ridge') {
            var axisAng = (rng() * 40 - 20) * Math.PI / 180;
            var spread = boxH * (0.08 + jitter01 * 0.4);
            for (var i2 = 0; i2 < n; i2++) {
                var t = rng();
                var along = (t - 0.5) * boxW * 1.15;
                var across = (rng() - 0.5) * 2 * spread * (0.3 + 0.7 * Math.sin(t * Math.PI));
                var rx = cx + along * Math.cos(axisAng) - across * Math.sin(axisAng);
                var ry = cy + along * Math.sin(axisAng) + across * Math.cos(axisAng);
                interior.push({ x: Math.max(x0 + 2, Math.min(x1 - 2, rx)), y: Math.max(y0 + 2, Math.min(y1 - 2, ry)) });
            }
        } else {
            for (var i3 = 0; i3 < n; i3++) interior.push({ x: x0 + rng() * boxW, y: y0 + rng() * boxH });
        }

        var boundaryCount = Math.max(12, Math.min(60, Math.round(Math.sqrt(n) * 3)));
        var boundary = buildBoundaryPoints(x0, y0, x1, y1, boundaryCount);
        var allPoints = interior.concat(boundary);

        // ---- height field ----
        var peakList = [];
        var kPeaks = 3 + Math.floor(rng() * 4);
        for (var pk = 0; pk < kPeaks; pk++) {
            peakList.push({ x: x0 + rng() * boxW, y: y0 + rng() * boxH,
                sigma: boxW * (0.08 + rng() * 0.18), amp: 0.5 + rng() * 1.0 });
        }
        var ridgeAxis = rng() * Math.PI;
        var ridgeCount = 2 + Math.floor(rng() * 3);
        var ridgeOffsets = [];
        for (var rk = 0; rk < ridgeCount; rk++) ridgeOffsets.push((rk - (ridgeCount - 1) / 2) * boxW * 0.22 + (rng() - 0.5) * boxW * 0.08);

        function heightAt(px, py) {
            var dx = px - cx, dy = py - cy;
            var distN = Math.sqrt(dx * dx + dy * dy) / maxR;
            if (P.heightMode === 'dome') {
                return Math.max(0, 1 - Math.pow(distN, 1.6));
            } else if (P.heightMode === 'peaks') {
                var s = 0;
                for (var i4 = 0; i4 < peakList.length; i4++) {
                    var pk2 = peakList[i4];
                    var ddx = px - pk2.x, ddy = py - pk2.y;
                    s += pk2.amp * Math.exp(-(ddx * ddx + ddy * ddy) / (2 * pk2.sigma * pk2.sigma));
                }
                return s;
            } else if (P.heightMode === 'ridge') {
                var along = dx * Math.cos(ridgeAxis) + dy * Math.sin(ridgeAxis);
                var across = -dx * Math.sin(ridgeAxis) + dy * Math.cos(ridgeAxis);
                var rsum = 0;
                for (var i5 = 0; i5 < ridgeOffsets.length; i5++) {
                    var off = across - ridgeOffsets[i5];
                    rsum += Math.exp(-(off * off) / (2 * Math.pow(boxW * 0.05, 2)));
                }
                var taper = Math.max(0, 1 - Math.pow(Math.abs(along) / (boxW * 0.62), 2));
                return rsum * taper;
            } else if (P.heightMode === 'crater') {
                var rim = Math.exp(-Math.pow(distN - 0.55, 2) / (2 * 0.09 * 0.09));
                var core = Math.exp(-Math.pow(distN, 2) / (2 * 0.22 * 0.22));
                return rim * 1.0 - core * 0.8 + 0.2;
            }
            return 0; // random handled per-point directly
        }

        var hMin = Infinity, hMax = -Infinity;
        for (var i6 = 0; i6 < allPoints.length; i6++) {
            var hp = allPoints[i6];
            hp.h = (P.heightMode === 'random') ? rng() : heightAt(hp.x, hp.y);
            if (hp.h < hMin) hMin = hp.h;
            if (hp.h > hMax) hMax = hp.h;
        }
        var hRange = Math.max(1e-6, hMax - hMin);
        for (var i7 = 0; i7 < allPoints.length; i7++) allPoints[i7].h = (allPoints[i7].h - hMin) / hRange;

        var triangles = delaunay(allPoints);

        var az = P.lightAngleDeg * Math.PI / 180, el = P.lightElevDeg * Math.PI / 180;
        var Lx = Math.cos(el) * Math.cos(az), Ly = Math.cos(el) * Math.sin(az), Lz = Math.sin(el);
        var zScale = Math.min(boxW, boxH) * 0.18;

        var sortedPalette = palette.slice().sort(function (a, b) { return luminance(a) - luminance(b); });

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        var baseSpacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
        var contrast01 = Math.max(20, Math.min(200, Number(P.shadeContrast))) / 100;
        var globalAngle = fills.getFillAngle();

        for (var ti = 0; ti < triangles.length; ti++) {
            var tri = triangles[ti];
            var A = tri[0], B = tri[1], C = tri[2];
            var ux = B.x - A.x, uy = B.y - A.y, uz = (B.h - A.h) * zScale;
            var vx = C.x - A.x, vy = C.y - A.y, vz = (C.h - A.h) * zScale;
            var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
            var nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= nlen; ny /= nlen; nz /= nlen;
            var brightness = nx * Lx + ny * Ly + nz * Lz;
            brightness = Math.max(0, Math.min(1, brightness * 0.5 + 0.5));
            var avgH = (A.h + B.h + C.h) / 3;

            var color;
            if (P.colorMode === 'posterized') {
                var idx = Math.floor((1 - brightness) * sortedPalette.length);
                color = sortedPalette[Math.max(0, Math.min(sortedPalette.length - 1, idx))];
            } else if (P.colorMode === 'elevation') {
                var idx2 = Math.floor(avgH * palette.length);
                color = palette[Math.max(0, Math.min(palette.length - 1, idx2))];
            } else if (P.colorMode === 'random') {
                color = palette[Math.floor(hatchRng() * palette.length) % palette.length];
            } else {
                color = palette[0];
            }

            var poly = [{ x: A.x, y: A.y }, { x: B.x, y: B.y }, { x: C.x, y: C.y }];

            if (P.showEdges === 'on') {
                parts.push('<polygon points="' + poly.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
                    '" fill="none" stroke="' + color + '" stroke-width="' + (sw * 0.85).toFixed(2) + '" stroke-linejoin="round"/>');
            }

            var isHighlight = brightness > 0.90;
            if (P.fillStyle !== 'none' && !isHighlight) {
                var darkFactor = 0.32, lightFactor = 1.0 + contrast01 * 2.4;
                var densityFactor = darkFactor + (lightFactor - darkFactor) * brightness;
                var spacing = Math.max(1.3, baseSpacing * densityFactor);
                var angle = globalAngle + (hatchRng() - 0.5) * 24;
                var ds = fills.fillPolyD(poly, P.fillStyle, angle, spacing, seed + ti * 131);
                ds.forEach(function (d) {
                    parts.push('<path d="' + d + '" fill="none" stroke="' + color +
                        '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
                });
            }
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'facetgem',
        description: 'Low-poly Delaunay triangulation with fake-3D facet shading.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Crystal', values: { pointMode: 'radial', heightMode: 'dome', colorMode: 'posterized' } },
            { label: 'Mountain', values: { pointMode: 'ridge', heightMode: 'peaks', colorMode: 'elevation' } },
            { label: 'Geode', values: { pointMode: 'radial', heightMode: 'random', colorMode: 'random' } },
            { label: 'Engraved', values: { colorMode: 'mono', pointCount: 220, shadeContrast: 160 } }
        ],
        generate: generate
    };
})();
