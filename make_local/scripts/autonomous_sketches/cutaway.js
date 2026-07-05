/**
 * cutaway — architectural building section
 *
 * A multi-storey building drawn as a vertical section cut, the way an
 * architect's drawing shows a building sliced open. Each floor is divided
 * into rooms by a randomized BSP-style split of vertical partition walls,
 * with a chance for adjacent floors to merge into a double-height room.
 * Cut walls and floor slabs are filled with the plotFills hatch library
 * (representing solid material sliced by the section plane, the standard
 * architectural-drawing convention), while open rooms stay empty. Exterior
 * walls get window openings (sill + lintel + mullion), interior walls get
 * door openings with a quarter-circle swing arc, one column is reserved as
 * a stair shaft with zigzag flights between floors, and the ground below
 * the footing line is dense diagonal hatch representing cut earth.
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
        { value: '#1a1a1a', label: 'Ink' }, { value: '#000000', label: 'Black' },
        { value: '#2196f3', label: 'Blue' }, { value: '#bcd9f0', label: 'Pale blue' },
        { value: '#8a5a3a', label: 'Sienna' }, { value: '#5a4632', label: 'Umber' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    var PRESETS = {
        blueprint:  { floors: 5, roomSplitMax: 3, wallThicknessMm: 5, windowProb: 70, doorProb: 60,
                      mergeProb: 10, fillStyle: 'none', palette: ['#bcd9f0'], bgColor: '#0e2238' },
        brutalist:  { floors: 6, roomSplitMax: 5, wallThicknessMm: 9, windowProb: 35, doorProb: 45,
                      mergeProb: 15, fillStyle: 'crosshatch', palette: ['#1a1a1a'], bgColor: '#cfc9bd' },
        rowhouse:   { floors: 4, roomSplitMax: 2, wallThicknessMm: 6, windowProb: 85, doorProb: 70,
                      mergeProb: 5, fillStyle: 'hatch', palette: ['#3a2a1a'], bgColor: '#f3ead9' },
        loft:       { floors: 3, roomSplitMax: 2, wallThicknessMm: 4, windowProb: 60, doorProb: 30,
                      mergeProb: 55, fillStyle: 'hatch', palette: ['#5a4632', '#8a5a3a'], bgColor: '#f5f0e8' },
        sepia:      { floors: 5, roomSplitMax: 4, wallThicknessMm: 7, windowProb: 55, doorProb: 50,
                      mergeProb: 20, fillStyle: 'squiggle', palette: ['#6b4226', '#a9714f'], bgColor: '#f0e3cc' }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
          value: ['#1a1a1a'], options: STD_PAL },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'floors', label: 'Floors', type: 'range', min: 2, max: 9, step: 1, value: 5, group: 'general' },
        { id: 'roomSplitMax', label: 'Rooms per floor (max)', type: 'range', min: 1, max: 6, step: 1, value: 4, group: 'general' },
        { id: 'wallThicknessMm', label: 'Wall thickness (mm)', type: 'range', min: 2, max: 12, step: 0.5, value: 6, group: 'general' },
        { id: 'windowProb', label: 'Window probability %', type: 'range', min: 0, max: 100, step: 5, value: 60, group: 'general' },
        { id: 'doorProb', label: 'Door probability %', type: 'range', min: 0, max: 100, step: 5, value: 50, group: 'general' },
        { id: 'mergeProb', label: 'Double-height room %', type: 'range', min: 0, max: 70, step: 5, value: 15, group: 'general' },
        { id: 'stairs', label: 'Stair shaft', type: 'select', value: 'yes', group: 'general',
          options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
        { id: 'fillStyle', label: 'Wall cut fill', type: 'select', value: 'hatch', group: 'general',
          options: window.plotFills.FILL_STYLE_OPTIONS.concat([{ value: 'none', label: 'Outline only' }]) }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

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
        var ink = palette[0];
        var bg = P.bgColor || '#ffffff';
        var wallPx = paper.mmToPixels(Math.max(1, Number(P.wallThicknessMm) || 6));
        var spacing = (paper.DPI / 25.4) / Math.max(0.2, fills.getEffectiveDensity());
        var fillAngle = fills.getFillAngle();

        var floors = Math.round(Number(P.floors) || 5);
        var roomSplitMax = Math.max(1, Math.round(Number(P.roomSplitMax) || 4));
        var windowProb = clamp(Number(P.windowProb) || 0, 0, 100) / 100;
        var doorProb = clamp(Number(P.doorProb) || 0, 0, 100) / 100;
        var mergeProb = clamp(Number(P.mergeProb) || 0, 0, 100) / 100;
        var hasStairs = P.stairs !== 'no';
        var fillStyle = P.fillStyle || 'hatch';

        // ── Building footprint ───────────────────────────────────────────
        var groundY = H - mp;
        var roofY = mp + paper.mmToPixels(10);
        var bldgX0 = mp + paper.mmToPixels(4);
        var bldgX1 = W - mp - paper.mmToPixels(4);
        var bldgW = bldgX1 - bldgX0;
        var floorH = (groundY - roofY) / floors;

        function colorFor(idx) { return palette[idx % palette.length]; }

        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>'
        ];

        function rectPoly(x0, y0, x1, y1) {
            return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
        }

        function strokeRect(x0, y0, x1, y1, color, width) {
            parts.push('<rect x="' + x0.toFixed(2) + '" y="' + y0.toFixed(2) + '" width="' + (x1 - x0).toFixed(2) +
                '" height="' + (y1 - y0).toFixed(2) + '" fill="none" stroke="' + color +
                '" stroke-width="' + width.toFixed(2) + '"/>');
        }

        function fillCutRect(x0, y0, x1, y1, color, seedVal) {
            strokeRect(x0, y0, x1, y1, color, sw * 1.1);
            if (fillStyle === 'none') return;
            var poly = rectPoly(x0, y0, x1, y1);
            var ds = fills.fillPolyD(poly, fillStyle, fillAngle, spacing, seedVal);
            ds.forEach(function (d) {
                if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + color +
                    '" stroke-width="' + sw.toFixed(2) + '" stroke-linecap="round"/>');
            });
        }

        function line(x1, y1, x2, y2, color, width) {
            parts.push('<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) +
                '" y2="' + y2.toFixed(2) + '" stroke="' + color + '" stroke-width="' + width.toFixed(2) + '" stroke-linecap="round"/>');
        }

        // ── Per-floor vertical partition walls (irregular room widths) ───
        // partitions[f] = sorted array of x positions (including bldgX0/bldgX1)
        var partitions = [];
        for (var f = 0; f < floors; f++) {
            var n = 1 + Math.floor(rng() * roomSplitMax); // number of rooms this floor
            var xs = [bldgX0, bldgX1];
            for (var i = 1; i < n; i++) {
                var t = (i / n) + (rng() - 0.5) * (0.6 / n);
                xs.push(bldgX0 + clamp(t, 0.06, 0.94) * bldgW);
            }
            xs.sort(function (a, b) { return a - b; });
            // enforce minimum room width
            var minW = paper.mmToPixels(25);
            var cleaned = [xs[0]];
            for (var j = 1; j < xs.length; j++) {
                if (xs[j] - cleaned[cleaned.length - 1] >= minW || j === xs.length - 1) cleaned.push(xs[j]);
            }
            if (cleaned[cleaned.length - 1] !== bldgX1) cleaned[cleaned.length - 1] = bldgX1;
            partitions.push(cleaned);
        }

        // ── Decide which floor-bands merge vertically (double-height) ────
        // skip[f] true => no slab line drawn between floor f and f+1 (within matching room column band)
        var floorMerged = [];
        for (var f2 = 0; f2 < floors - 1; f2++) floorMerged.push(rng() < mergeProb);

        // ── Stair shaft: reserve the partition-column nearest building center on a couple of floors ──
        var stairCol = hasStairs ? Math.floor((roomSplitMax) / 2) : -1;

        // ── Ground hatch below footing ────────────────────────────────────
        var groundPoly = rectPoly(bldgX0 - paper.mmToPixels(15), groundY, bldgX1 + paper.mmToPixels(15), groundY + paper.mmToPixels(22));
        var groundDs = fills.fillPolyD(groundPoly, 'hatch', 45, spacing * 0.8, 999);
        groundDs.forEach(function (d) {
            if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + ink +
                '" stroke-width="' + (sw * 0.8).toFixed(2) + '" stroke-linecap="round"/>');
        });
        line(bldgX0 - paper.mmToPixels(15), groundY, bldgX1 + paper.mmToPixels(15), groundY, ink, sw * 1.4);

        // ── Outer building envelope outline ──────────────────────────────
        strokeRect(bldgX0, roofY, bldgX1, groundY, ink, sw * 1.6);

        // ── Floor slabs (horizontal, hatched, skipped where merged) ──────
        for (var fs = 1; fs < floors; fs++) {
            if (floorMerged[fs - 1]) continue;
            var slabY = groundY - fs * floorH;
            fillCutRect(bldgX0, slabY - wallPx / 2, bldgX1, slabY + wallPx / 2, ink, 100 + fs);
        }
        // roof slab
        fillCutRect(bldgX0, roofY - wallPx * 0.7, bldgX1, roofY + wallPx * 0.5, ink, 50);
        // foundation slab
        fillCutRect(bldgX0, groundY - wallPx * 0.5, bldgX1, groundY + wallPx * 0.7, ink, 51);

        // ── Per-floor vertical walls + rooms ──────────────────────────────
        for (var fl = 0; fl < floors; fl++) {
            var rowTopRaw = groundY - (fl + 1) * floorH;
            var rowBot = groundY - fl * floorH;
            // if this floor is merged with the one above, extend the room upward and skip drawing this floor's own walls (drawn as part of taller cell below)
            var mergedWithAbove = fl < floors - 1 && floorMerged[fl];
            var rowTop = rowTopRaw;
            var xs2 = partitions[fl];
            var color = colorFor(fl);

            for (var col = 0; col < xs2.length - 1; col++) {
                var cx0 = xs2[col], cx1 = xs2[col + 1];
                var cyTop = rowTop, cyBot = rowBot;
                // extend this cell upward through merged floors above (simple case: one level)
                if (mergedWithAbove) cyTop -= floorH;

                // interior partition wall (skip outer envelope edges)
                if (col > 0) {
                    var hasDoor = rng() < doorProb;
                    var wx0 = cx0 - wallPx / 2, wx1 = cx0 + wallPx / 2;
                    if (hasDoor) {
                        var doorH = paper.mmToPixels(20 + rng() * 6);
                        var doorY1 = cyBot - paper.mmToPixels(2);
                        var doorY0 = doorY1 - doorH;
                        if (doorY0 > cyTop + paper.mmToPixels(6)) {
                            fillCutRect(wx0, cyTop, wx1, doorY0, color, 200 + fl * 10 + col);
                            fillCutRect(wx0, doorY1, wx1, cyBot, color, 200 + fl * 10 + col + 5);
                            // door leaf + swing arc
                            var hinge = { x: cx0, y: doorY1 };
                            var leafLen = Math.min(doorH * 0.85, cx1 - cx0 - paper.mmToPixels(8));
                            if (leafLen > paper.mmToPixels(6)) {
                                var swingDir = (col % 2 === 0) ? 1 : -1;
                                var leafEndX = hinge.x + swingDir * leafLen;
                                line(hinge.x, hinge.y, leafEndX, hinge.y, color, sw * 0.8);
                                line(hinge.x, hinge.y, hinge.x, hinge.y - leafLen, color, sw * 0.6);
                                var largeArc = 0, sweep = swingDir > 0 ? 1 : 0;
                                parts.push('<path d="M ' + leafEndX.toFixed(2) + ' ' + hinge.y.toFixed(2) +
                                    ' A ' + leafLen.toFixed(2) + ' ' + leafLen.toFixed(2) + ' 0 ' + largeArc + ' ' + sweep + ' ' +
                                    hinge.x.toFixed(2) + ' ' + (hinge.y - leafLen).toFixed(2) +
                                    '" fill="none" stroke="' + color + '" stroke-width="' + (sw * 0.55).toFixed(2) + '" stroke-dasharray="2,3"/>');
                            }
                        } else {
                            fillCutRect(wx0, cyTop, wx1, cyBot, color, 200 + fl * 10 + col);
                        }
                    } else {
                        fillCutRect(wx0, cyTop, wx1, cyBot, color, 200 + fl * 10 + col);
                    }
                }

                // stair flight in reserved column (drawn instead of room contents)
                if (hasStairs && col === stairCol && !mergedWithAbove) {
                    var treadN = 8;
                    var sx0 = cx0 + paper.mmToPixels(6), sx1 = cx1 - paper.mmToPixels(6);
                    var sy0 = cyBot - paper.mmToPixels(4), sy1 = cyTop + paper.mmToPixels(4);
                    if (sx1 > sx0 && sy0 > sy1) {
                        var stairPts = [];
                        for (var t2 = 0; t2 <= treadN; t2++) {
                            var tx = sx0 + (sx1 - sx0) * (t2 / treadN);
                            var ty = sy0 + (sy1 - sy0) * (t2 / treadN);
                            stairPts.push({ x: tx, y: ty });
                        }
                        parts.push('<polyline points="' + stairPts.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
                            '" fill="none" stroke="' + color + '" stroke-width="' + (sw * 0.7).toFixed(2) + '" stroke-linecap="round"/>');
                        for (var t3 = 0; t3 < treadN; t3++) {
                            var p0 = stairPts[t3], p1 = stairPts[t3 + 1];
                            var perpX = -(p1.y - p0.y), perpY = (p1.x - p0.x);
                            var plen = Math.hypot(perpX, perpY) || 1;
                            var tw = paper.mmToPixels(5);
                            perpX = perpX / plen * tw; perpY = perpY / plen * tw;
                            line(p0.x - perpX / 2, p0.y - perpY / 2, p0.x + perpX / 2, p0.y + perpY / 2, color, sw * 0.5);
                        }
                    }
                }

                // exterior window on leftmost/rightmost column
                var isExteriorWindowCandidate = (col === 0 || col === xs2.length - 2) && !mergedWithAbove;
                if (isExteriorWindowCandidate && rng() < windowProb) {
                    var wallX = (col === 0) ? bldgX0 : bldgX1;
                    var sillY = cyBot - (cyBot - cyTop) * 0.32;
                    var lintelY = cyTop + (cyBot - cyTop) * 0.22;
                    var winInset = wallPx * 1.5;
                    var wxIn = (col === 0) ? wallX + winInset : wallX - winInset;
                    var wxOut = wallX;
                    line(Math.min(wxIn, wxOut), sillY, Math.max(wxIn, wxOut), sillY, color, sw * 0.8);
                    line(Math.min(wxIn, wxOut), lintelY, Math.max(wxIn, wxOut), lintelY, color, sw * 0.8);
                    line(wxIn, lintelY, wxIn, sillY, color, sw * 0.6);
                    var midX = (wxIn + wxOut) / 2;
                    line(midX, lintelY, midX, sillY, color, sw * 0.45);
                }
            }
        }

        // ── Roofline cap (simple gable hint) ─────────────────────────────
        var apexY = roofY - paper.mmToPixels(16);
        var midX2 = (bldgX0 + bldgX1) / 2;
        parts.push('<polyline points="' + bldgX0.toFixed(2) + ',' + roofY.toFixed(2) + ' ' +
            midX2.toFixed(2) + ',' + apexY.toFixed(2) + ' ' + bldgX1.toFixed(2) + ',' + roofY.toFixed(2) +
            '" fill="none" stroke="' + ink + '" stroke-width="' + (sw * 1.2).toFixed(2) + '" stroke-linejoin="round"/>');

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name: 'cutaway',
        description: 'Architectural building section — floors of irregular rooms with hatched cut walls, windows, doors with swing arcs, and a stair shaft.',
        presets: Object.keys(PRESETS),
        params: params,
        stylePresets: [
            { label: 'Blueprint', values: { floors: 5, roomSplitMax: 3, wallThicknessMm: 5, windowProb: 70, doorProb: 60, mergeProb: 10, fillStyle: 'none' } },
            { label: 'Brutalist', values: { floors: 6, roomSplitMax: 5, wallThicknessMm: 9, windowProb: 35, doorProb: 45, mergeProb: 15, fillStyle: 'crosshatch' } },
            { label: 'Row house', values: { floors: 4, roomSplitMax: 2, wallThicknessMm: 6, windowProb: 85, doorProb: 70, mergeProb: 5, fillStyle: 'hatch' } },
            { label: 'Loft', values: { floors: 3, roomSplitMax: 2, wallThicknessMm: 4, windowProb: 60, doorProb: 30, mergeProb: 55, fillStyle: 'hatch' } },
            { label: 'Sepia section', values: { floors: 5, roomSplitMax: 4, wallThicknessMm: 7, windowProb: 55, doorProb: 50, mergeProb: 20, fillStyle: 'squiggle' } }
        ],
        generate: generate
    };
})();
