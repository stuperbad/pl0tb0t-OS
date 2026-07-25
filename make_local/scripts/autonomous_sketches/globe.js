/**
 * globe — wireframe celestial sphere (parametric)
 *
 * True 3D orthographic projection of a rotated sphere with hidden-line
 * removal. Four modes share one rotation/projection core: `graticule` draws
 * classic lat/lon grid lines, `armillary` draws a small set of tilted great-
 * circle rings (equator/ecliptic/tropics/meridians) like an antique
 * astronomical instrument, `constellation` scatters random points on the
 * sphere and connects near neighbors like a star globe, and `continents`
 * grows irregular small-circle blobs on the sphere surface (true spherical
 * geometry, not a flat approximation) over a light graticule for a
 * wireframe-atlas look. Headless: generate(seed, 'preset').
 */
(function () {
    var paper = window.makeSketchUtils;
    var fills = window.plotFills;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function () { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
    }

    var DEG = Math.PI / 180;

    // ---- 3D helpers -------------------------------------------------------
    function latLonToXYZ(latDeg, lonDeg) {
        var lat = latDeg * DEG, lon = lonDeg * DEG;
        return { x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon) };
    }

    function rotate(p, pitchRad, yawRad) {
        var x1 = p.x * Math.cos(yawRad) + p.z * Math.sin(yawRad);
        var y1 = p.y;
        var z1 = -p.x * Math.sin(yawRad) + p.z * Math.cos(yawRad);
        var x2 = x1;
        var y2 = y1 * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
        var z2 = y1 * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);
        return { x: x2, y: y2, z: z2 };
    }

    function project(p3, cx, cy, R) {
        return { sx: cx + p3.x * R, sy: cy - p3.y * R, vis: p3.z >= 0 };
    }

    function normalize(v) {
        var n = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
        return { x: v.x / n, y: v.y / n, z: v.z / n };
    }
    function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
    function scaleAdd(a, sa, b, sb) { return { x: a.x * sa + b.x * sb, y: a.y * sa + b.y * sb, z: a.z * sa + b.z * sb }; }

    // Splits a sequence of {sx,sy,vis} points into visible / hidden runs.
    // For closed loops, rotates the array to start at a break so no wrap
    // stitching is needed; adjacent runs share their boundary point so the
    // drawn lines meet with no gap.
    function splitRuns(pts, closed) {
        var arr = pts.slice();
        if (closed) {
            var breakIdx = -1;
            for (var i = 0; i < arr.length; i++) { if (!arr[i].vis) { breakIdx = i; break; } }
            if (breakIdx === -1) arr.push(arr[0]);
            else if (breakIdx > 0) arr = arr.slice(breakIdx).concat(arr.slice(0, breakIdx + 1));
        }
        var visRuns = [], hidRuns = [], curV = [], curH = [];
        for (var j = 0; j < arr.length; j++) {
            var p = arr[j];
            if (p.vis) {
                if (curH.length >= 2) hidRuns.push(curH);
                curH = curH.length ? [curH[curH.length - 1]] : [];
                curV.push(p);
            } else {
                if (curV.length >= 2) visRuns.push(curV);
                curV = curV.length ? [curV[curV.length - 1]] : [];
                curH.push(p);
            }
        }
        if (curV.length >= 2) visRuns.push(curV);
        if (curH.length >= 2) hidRuns.push(curH);
        return { vis: visRuns, hid: hidRuns };
    }

    function polylineD(run) {
        var d = 'M ' + run[0].sx.toFixed(2) + ' ' + run[0].sy.toFixed(2);
        for (var i = 1; i < run.length; i++) d += ' L ' + run[i].sx.toFixed(2) + ' ' + run[i].sy.toFixed(2);
        return d;
    }

    function emitRuns(parts, pts3d, closed, cx, cy, R, color, sw, hiddenLine) {
        var proj = pts3d.map(function (p) { return project(p, cx, cy, R); });
        var runs = splitRuns(proj, closed);
        runs.vis.forEach(function (run) {
            parts.push('<path d="' + polylineD(run) + '" fill="none" stroke="' + color +
                '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
        });
        if (hiddenLine === 'dashed') {
            runs.hid.forEach(function (run) {
                parts.push('<path d="' + polylineD(run) + '" fill="none" stroke="' + color +
                    '" stroke-width="' + (sw * 0.7).toFixed(2) + '" stroke-dasharray="' + (sw * 2.2).toFixed(2) + ' ' + (sw * 2.6).toFixed(2) +
                    '" stroke-linecap="round" stroke-linejoin="round"/>');
            });
        } else if (hiddenLine === 'show') {
            runs.hid.forEach(function (run) {
                parts.push('<path d="' + polylineD(run) + '" fill="none" stroke="' + color +
                    '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
            });
        }
    }

    var STD_PAL = [
        { value: '#000000', label: 'Black' }, { value: '#10243a', label: 'Navy' },
        { value: '#8b6b1f', label: 'Brass' }, { value: '#cc2200', label: 'Rust' },
        { value: '#2980b9', label: 'Blue' }, { value: '#f5f0e8', label: 'Cream' },
        { value: '#4caf50', label: 'Green' }, { value: '9c27b0'.replace(/^/, '#'), label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        celestial: { mode: 'graticule', hiddenLine: 'dashed', rotationX: 22, rotationY: 35, gridStep: 15,
            sphereScale: 0.42, palette: ['#10243a'], bgColor: '#f5f0e8' },
        orrery: { mode: 'armillary', hiddenLine: 'show', rotationX: 18, rotationY: 200, sphereScale: 0.4,
            palette: ['#8b6b1f'], bgColor: '#241a0d' },
        starchart: { mode: 'constellation', hiddenLine: 'hide', rotationX: 10, rotationY: 80, sphereScale: 0.44,
            starCount: 130, neighborLinks: 2, palette: ['#f5f0e8'], bgColor: '#0a0a12' },
        atlas: { mode: 'continents', hiddenLine: 'dashed', rotationX: 15, rotationY: 300, gridStep: 20,
            sphereScale: 0.4, continentCount: 6, continentSize: 0.32, palette: ['#5a3a1a', '#10243a'], bgColor: '#f5f0e8' },
        blueprint: { mode: 'graticule', hiddenLine: 'hide', rotationX: 8, rotationY: 15, gridStep: 10,
            sphereScale: 0.44, palette: ['#bcd9f0'], bgColor: '#0d1b2e' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#10243a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'mode', label: 'Mode', type: 'select', value: 'graticule', group: 'general',
          options: [{ value: 'graticule', label: 'Graticule' }, { value: 'armillary', label: 'Armillary' },
                    { value: 'constellation', label: 'Constellation' }, { value: 'continents', label: 'Continents' }] },
        { id: 'rotationX', label: 'Tilt', type: 'range', min: -80, max: 80, step: 1, value: 20, group: 'general' },
        { id: 'rotationY', label: 'Spin', type: 'range', min: 0, max: 360, step: 1, value: 30, group: 'general' },
        { id: 'gridStep', label: 'Grid step (deg)', type: 'range', min: 5, max: 30, step: 1, value: 15, group: 'general' },
        { id: 'hiddenLine', label: 'Hidden side', type: 'select', value: 'dashed', group: 'general',
          options: [{ value: 'hide', label: 'Hide' }, { value: 'dashed', label: 'Dashed' }, { value: 'show', label: 'Show' }] },
        { id: 'sphereScale', label: 'Sphere size', type: 'range', min: 0.3, max: 0.48, step: 0.01, value: 0.42, group: 'general' },
        { id: 'starCount', label: 'Star count', type: 'range', min: 10, max: 250, step: 5, value: 80, group: 'general' },
        { id: 'neighborLinks', label: 'Neighbor links', type: 'range', min: 1, max: 5, step: 1, value: 2, group: 'general' },
        { id: 'continentCount', label: 'Continent count', type: 'range', min: 2, max: 12, step: 1, value: 6, group: 'general' },
        { id: 'continentSize', label: 'Continent size', type: 'range', min: 0.15, max: 0.6, step: 0.01, value: 0.32, group: 'general' }
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

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#10243a'];
        var bg = P.bgColor || '#f5f0e8';

        var cx = W / 2, cy = H / 2;
        var R = Math.min(W, H) * P.sphereScale;

        var pitch = (P.rotationX + (rng() - 0.5) * 6) * DEG;
        var yaw = (P.rotationY + rng() * 20) * DEG;
        var hiddenLine = P.hiddenLine;

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function drawGraticule(color, lineSw, hl) {
            var step = P.gridStep;
            for (var lat = -90 + step; lat < 90; lat += step) {
                var pts = [];
                for (var lon = 0; lon <= 360; lon += 4) {
                    var p3 = rotate(latLonToXYZ(lat, lon), pitch, yaw);
                    pts.push(p3);
                }
                emitRuns(parts, pts, true, cx, cy, R, color, lineSw, hl);
            }
            for (var lon2 = 0; lon2 < 360; lon2 += step) {
                var pts2 = [];
                for (var lat2 = -90; lat2 <= 90; lat2 += 3) {
                    var p3b = rotate(latLonToXYZ(lat2, lon2), pitch, yaw);
                    pts2.push(p3b);
                }
                emitRuns(parts, pts2, false, cx, cy, R, color, lineSw, hl);
            }
        }

        if (P.mode === 'graticule') {
            drawGraticule(palette[0], sw, hiddenLine);

        } else if (P.mode === 'armillary') {
            // Fixed astronomically-flavored ring set, each a great circle
            // tilted by rotating the equator plane around a local axis.
            var rings = [
                { tilt: 0, spin: 0 },        // equator
                { tilt: 23.4, spin: 0 },     // ecliptic
                { tilt: 90, spin: 0 },       // meridian A (through poles)
                { tilt: 90, spin: 90 },      // meridian B (through poles)
                { tilt: 66.6, spin: 0 },     // arctic-ish small circle -> treat as tilted ring
                { tilt: -66.6, spin: 0 }
            ];
            rings.forEach(function (ring, ri) {
                var pts = [];
                for (var a = 0; a <= 360; a += 3) {
                    var base = latLonToXYZ(0, a); // equator point
                    var tilted = rotate(base, ring.tilt * DEG, ring.spin * DEG);
                    pts.push(rotate(tilted, pitch, yaw));
                }
                var color = palette[ri % palette.length];
                emitRuns(parts, pts, true, cx, cy, R, color, sw, hiddenLine);
            });
            // polar axis line
            var north = rotate(latLonToXYZ(90, 0), pitch, yaw);
            var south = rotate(latLonToXYZ(-90, 0), pitch, yaw);
            emitRuns(parts, [north, south], false, cx, cy, R * 1.08, palette[0], sw, 'show');

        } else if (P.mode === 'constellation') {
            var n = Math.round(P.starCount);
            var stars = [];
            for (var i = 0; i < n; i++) {
                var y = rng() * 2 - 1;
                var theta = rng() * Math.PI * 2;
                var r = Math.sqrt(Math.max(0, 1 - y * y));
                stars.push({ x: r * Math.cos(theta), y: y, z: r * Math.sin(theta) });
            }
            var rotStars = stars.map(function (s) { return rotate(s, pitch, yaw); });
            var projStars = rotStars.map(function (p) { return project(p, cx, cy, R); });

            var k = Math.round(P.neighborLinks);
            var drawnPairs = {};
            for (var si = 0; si < n; si++) {
                if (!projStars[si].vis) continue;
                var dists = [];
                for (var sj = 0; sj < n; sj++) {
                    if (sj === si || !projStars[sj].vis) continue;
                    var dx = rotStars[si].x - rotStars[sj].x, dy = rotStars[si].y - rotStars[sj].y, dz = rotStars[si].z - rotStars[sj].z;
                    dists.push({ j: sj, d: dx * dx + dy * dy + dz * dz });
                }
                dists.sort(function (a, b) { return a.d - b.d; });
                for (var ki = 0; ki < Math.min(k, dists.length); ki++) {
                    var jIdx = dists[ki].j;
                    var key = si < jIdx ? si + '_' + jIdx : jIdx + '_' + si;
                    if (drawnPairs[key]) continue;
                    drawnPairs[key] = true;
                    var a2 = projStars[si], b2 = projStars[jIdx];
                    var col = palette[0];
                    parts.push('<line x1="' + a2.sx.toFixed(2) + '" y1="' + a2.sy.toFixed(2) + '" x2="' + b2.sx.toFixed(2) +
                        '" y2="' + b2.sy.toFixed(2) + '" stroke="' + col + '" stroke-width="' + (sw * 0.7).toFixed(2) + '"/>');
                }
            }
            for (var sp = 0; sp < n; sp++) {
                if (!projStars[sp].vis) continue;
                var starR = sw * (0.9 + rng() * 1.6);
                var scol = palette[palette.length > 1 ? 1 % palette.length : 0];
                parts.push('<circle cx="' + projStars[sp].sx.toFixed(2) + '" cy="' + projStars[sp].sy.toFixed(2) +
                    '" r="' + starR.toFixed(2) + '" fill="' + scol + '" stroke="none"/>');
            }
            // faint outer sphere outline for context
            var outline = [];
            for (var oa = 0; oa <= 360; oa += 4) outline.push(rotate(latLonToXYZ(0, oa), pitch, yaw));
            emitRuns(parts, outline, true, cx, cy, R, palette[0], sw * 0.6, 'hide');

        } else if (P.mode === 'continents') {
            drawGraticule(palette[0], sw * 0.55, 'hide');
            var landColor = palette[palette.length > 1 ? 1 % palette.length : 0];
            var count = Math.round(P.continentCount);
            for (var c = 0; c < count; c++) {
                var cy3 = rng() * 2 - 1;
                var ctheta = rng() * Math.PI * 2;
                var cr = Math.sqrt(Math.max(0, 1 - cy3 * cy3));
                var center = { x: cr * Math.cos(ctheta), y: cy3, z: cr * Math.sin(ctheta) };
                var up = Math.abs(center.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
                var T = normalize(cross(up, center));
                var B = cross(center, T);

                var baseR = P.continentSize * (0.55 + rng() * 0.5);
                var wob1 = 2 + Math.floor(rng() * 3), wob2 = 4 + Math.floor(rng() * 4);
                var amp1 = 0.25 + rng() * 0.2, amp2 = 0.12 + rng() * 0.15;
                var phase1 = rng() * Math.PI * 2, phase2 = rng() * Math.PI * 2;

                var blobPts = [];
                for (var a3 = 0; a3 <= 360; a3 += 6) {
                    var ang = a3 * DEG;
                    var rr = baseR * (1 + amp1 * Math.sin(wob1 * ang + phase1) + amp2 * Math.sin(wob2 * ang + phase2));
                    rr = Math.max(0.03, rr);
                    var dir = scaleAdd(T, Math.cos(ang), B, Math.sin(ang));
                    var pOnSphere = normalize(scaleAdd(center, Math.cos(rr), dir, Math.sin(rr)));
                    blobPts.push(rotate(pOnSphere, pitch, yaw));
                }
                emitRuns(parts, blobPts, true, cx, cy, R, landColor, sw * 1.1, 'hide');
            }
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name:        'globe',
        description: 'Wireframe celestial sphere — true 3D rotation and orthographic projection with hidden-line removal, in graticule, armillary, constellation, or continent modes.',
        presets:     Object.keys(PRESETS),
        params:      params,
        stylePresets: [
            { label: 'Celestial Globe', values: { mode: 'graticule', hiddenLine: 'dashed', rotationX: 22, rotationY: 35, gridStep: 15 } },
            { label: 'Orrery',          values: { mode: 'armillary', hiddenLine: 'show', rotationX: 18, rotationY: 200, palette: ['#8b6b1f'], bgColor: '#241a0d' } },
            { label: 'Star Chart',      values: { mode: 'constellation', hiddenLine: 'hide', starCount: 130, neighborLinks: 2, palette: ['#f5f0e8'], bgColor: '#0a0a12' } },
            { label: 'Atlas',           values: { mode: 'continents', hiddenLine: 'dashed', continentCount: 6, continentSize: 0.32 } },
            { label: 'Blueprint',       values: { mode: 'graticule', hiddenLine: 'hide', gridStep: 10, palette: ['#bcd9f0'], bgColor: '#0d1b2e' } }
        ],
        generate:    generate
    };
})();
