/**
 * dendrite — diffusion-limited aggregation (DLA) growth
 *
 * Particles are released one at a time and take a random walk until they
 * land within sticking distance of the growing cluster, at which point they
 * freeze in place and become part of it. This is a fundamentally different
 * generative mechanism from recursive branching (branches.js) or PDE
 * reaction-diffusion (turing.js): the tree shape emerges purely from
 * thousands of independent stochastic walks, which is what gives real DLA
 * clusters their characteristic frost/lightning/coral/mineral-dendrite look.
 * Each stuck particle remembers its parent (whatever it touched first), so
 * the whole cluster is a tree; edges render as tapered segments (thick near
 * the root, thin at the tips) sized by descendant count, the same trick
 * real branch/root/vein structures use.
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
        { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
        { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
        { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
        { value: 'custom', label: 'Custom' }
    ];

    // Headless email-path variety: each preset is a partial set of param overrides.
    var PRESETS = {
        frost: {
            palette: ['#2f6a8a', '#7fb2c9'], bgColor: '#f4f8fa',
            growthMode: 'baseline', driftBias: 0.3, stickRadiusMm: 2.2,
            particleCount: 1700, taperStrength: 0.7, maxStrokeWidthMm: 1.2,
            colorMode: 'depth', tipDotProb: 0.1
        },
        lightning: {
            palette: ['#f5e642'], bgColor: '#101820',
            growthMode: 'radial', seedPosition: 'top', driftBias: -0.55,
            stickRadiusMm: 3.2, particleCount: 900, taperStrength: 0.85,
            maxStrokeWidthMm: 2.2, colorMode: 'single', tipDotProb: 0
        },
        coral: {
            palette: ['#ff7043', '#ffb74d', '#e64a72', '#26a69a'], bgColor: '#eaf6f6',
            growthMode: 'multiseed', seedCount: 5, driftBias: -0.12,
            stickRadiusMm: 3.4, particleCount: 1500, taperStrength: 0.55,
            maxStrokeWidthMm: 1.8, colorMode: 'branch', tipDotProb: 0.25
        },
        crystal: {
            palette: ['#1a1a1a'], bgColor: '#ffffff',
            growthMode: 'multiseed', seedCount: 10, driftBias: 0,
            stickRadiusMm: 2.4, particleCount: 1300, taperStrength: 0.4,
            maxStrokeWidthMm: 1.4, colorMode: 'single', tipDotProb: 0.05
        },
        veins: {
            palette: ['#6d4c2f', '#a9744f'], bgColor: '#f3ece0',
            growthMode: 'radial', seedPosition: 'corner', driftBias: -0.12,
            stickRadiusMm: 4.0, particleCount: 1100, taperStrength: 0.8,
            maxStrokeWidthMm: 1.6, colorMode: 'depth', tipDotProb: 0.15
        }
    };

    var params = [
        { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
          value: ['#1a1a1a'], options: STD_PAL, group: 'color' },
        { id: 'bgColor', label: 'Background', type: 'color', value: '#f5f0e8', group: 'color' },
        { id: 'colorMode', label: 'Color by', type: 'select', value: 'depth',
          options: [
              { value: 'depth', label: 'Depth (root to tip)' },
              { value: 'branch', label: 'Origin seed' },
              { value: 'single', label: 'Single' }
          ], group: 'color' },
        { id: 'growthMode', label: 'Growth mode', type: 'select', value: 'radial',
          options: [
              { value: 'radial', label: 'Radial (single seed)' },
              { value: 'baseline', label: 'Baseline (rising frost)' },
              { value: 'multiseed', label: 'Multi-seed (colonies)' }
          ], group: 'general' },
        { id: 'seedPosition', label: 'Seed position', type: 'select', value: 'center',
          options: [
              { value: 'center', label: 'Center' }, { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' }, { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' }, { value: 'corner', label: 'Corner' }
          ], group: 'general' },
        { id: 'seedCount', label: 'Seed count', type: 'range', min: 2, max: 16, step: 1, value: 6, group: 'general' },
        { id: 'particleCount', label: 'Particles', type: 'range', min: 200, max: 2500, step: 50, value: 1200, group: 'general' },
        { id: 'stickRadiusMm', label: 'Branch fineness', type: 'range', min: 1.5, max: 8, step: 0.25, value: 3.5, group: 'general' },
        { id: 'driftBias', label: 'Drift bias', type: 'range', min: -1, max: 1, step: 0.05, value: 0, group: 'general' },
        { id: 'taperStrength', label: 'Taper strength', type: 'range', min: 0, max: 1, step: 0.05, value: 0.65, group: 'general' },
        { id: 'maxStrokeWidthMm', label: 'Trunk width (mm)', type: 'range', min: 0.4, max: 4, step: 0.1, value: 1.6, group: 'general' },
        { id: 'tipDotProb', label: 'Tip marker chance', type: 'range', min: 0, max: 1, step: 0.05, value: 0.15, group: 'general' }
    ];

    function buildDefaults() { var P = {}; params.forEach(function (pd) { P[pd.id] = pd.value; }); return P; }

    function pickColor(palette, mode, t, rootId) {
        if (!palette.length) return '#000000';
        if (mode === 'single') return palette[0];
        if (mode === 'branch') return palette[rootId % palette.length];
        var idx = Math.floor(t * palette.length);
        return palette[Math.min(palette.length - 1, idx)];
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

        var minX = mp, minY = mp, maxX = W - mp, maxY = H - mp;
        var boxW = maxX - minX, boxH = maxY - minY;

        var palette = (Array.isArray(P.palette) && P.palette.length) ? P.palette : ['#1a1a1a'];
        var stickR = paper.mmToPixels(P.stickRadiusMm);
        var stepSize = stickR * 0.6;
        var cellSize = stickR;
        var maxStrokeW = paper.mmToPixels(P.maxStrokeWidthMm);
        var targetCount = Math.round(P.particleCount);
        var driftBias = P.driftBias;

        // ── Spatial hash grid for O(1) nearest-cluster-point queries ─────────
        var grid = {};
        function cellKey(cx, cy) { return cx + ',' + cy; }
        function addToGrid(i, x, y) {
            var k = cellKey(Math.floor(x / cellSize), Math.floor(y / cellSize));
            (grid[k] = grid[k] || []).push(i);
        }
        function nearestClusterPoint(x, y) {
            var cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
            var best = -1, bestD2 = stickR * stickR;
            for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                    var bucket = grid[cellKey(cx + dx, cy + dy)];
                    if (!bucket) continue;
                    for (var bi = 0; bi < bucket.length; bi++) {
                        var ni = bucket[bi];
                        var nx = nodes[ni].x, ny = nodes[ni].y;
                        var ddx = x - nx, ddy = y - ny;
                        var d2 = ddx * ddx + ddy * ddy;
                        if (d2 < bestD2) { bestD2 = d2; best = ni; }
                    }
                }
            }
            return best;
        }

        // ── Seed placement ────────────────────────────────────────────────────
        var nodes = []; // { x, y, parent, depth, root }

        // Anchors for new growth are drawn only from a live "frontier pool" of
        // nodes with fewer than MAX_FANOUT children, not from all nodes
        // uniformly. Uniform selection lets already-dense colonies get picked
        // more often (a rich-get-richer effect), collapsing multi-seed/radial
        // growth into one dense round clump instead of sprawling dendrites —
        // capping fanout and retiring saturated nodes from the pool forces new
        // growth to happen at the actual growing tips, matching how real DLA
        // clusters branch outward rather than filling in their interior.
        //
        // The pool is kept per-root (per colony), and each walker first picks
        // a colony uniformly at random, then samples within that colony's own
        // tips — giving every colony an equal turn regardless of its current
        // size. Sampling from one flat pool across all colonies would let
        // whichever colony has more nodes dominate future picks too (the same
        // rich-get-richer effect, just moved up one level), starving smaller
        // or unluckier colonies permanently.
        var MAX_FANOUT = 2;
        var growChildCount = [];
        var rootIds = [];
        var tipPoolByRoot = {};
        function rootPoolAdd(root, i) {
            if (!tipPoolByRoot[root]) { tipPoolByRoot[root] = { list: [], idx: {} }; rootIds.push(root); }
            var p = tipPoolByRoot[root];
            p.idx[i] = p.list.length; p.list.push(i);
        }
        function rootPoolRemove(root, i) {
            var p = tipPoolByRoot[root];
            var pos = p.idx[i], last = p.list.length - 1, lastNode = p.list[last];
            p.list[pos] = lastNode; p.idx[lastNode] = pos;
            p.list.pop(); delete p.idx[i];
        }
        // Used only when driftBias === 0 (see tipScore below): scores tips by
        // radial distance from their own colony's seed, so growth keeps
        // extending outward rather than backfilling the interior.
        var seedPosByRoot = {};
        // Used only when driftBias !== 0: baseline mode proves the pattern
        // that actually produces directional, reaching growth — spawn a
        // walker just *ahead* of the cluster's leading edge (in the empty
        // territory it hasn't grown into yet), then let the drift term pull
        // it back toward the existing mass so it sticks near that edge and
        // extends it further. An anchor-centered ring (spawn around a random
        // existing point) can't reproduce this: it has no notion of "ahead",
        // so the drift term just perturbs an otherwise symmetric ring and
        // barely shows up in the final shape. growthDir is the sign the
        // frontier actually advances in — opposite to driftBias's own sign,
        // since driftBias describes the walker's return trip, not the
        // cluster's growth.
        var growthDir = driftBias > 0 ? -1 : (driftBias < 0 ? 1 : 0);
        var frontierByRoot = {}, lateralMinByRoot = {}, lateralMaxByRoot = {};
        function addNode(x, y, parent, depth, root) {
            var idx = nodes.length;
            nodes.push({ x: x, y: y, parent: parent, depth: depth, root: root });
            addToGrid(idx, x, y);
            growChildCount.push(0);
            rootPoolAdd(root, idx);
            if (parent === -1) {
                seedPosByRoot[root] = { x: x, y: y };
                frontierByRoot[root] = y;
                lateralMinByRoot[root] = x; lateralMaxByRoot[root] = x;
            } else {
                if (growthDir === -1 && y < frontierByRoot[root]) frontierByRoot[root] = y;
                else if (growthDir === 1 && y > frontierByRoot[root]) frontierByRoot[root] = y;
                if (x < lateralMinByRoot[root]) lateralMinByRoot[root] = x;
                if (x > lateralMaxByRoot[root]) lateralMaxByRoot[root] = x;
            }
            return idx;
        }
        function tipScore(node, seed) {
            var dx = node.x - seed.x, dy = node.y - seed.y;
            return dx * dx + dy * dy;
        }

        function seedPos(pos) {
            if (pos === 'top')    return { x: minX + boxW * 0.5, y: minY + boxH * 0.12 };
            if (pos === 'bottom') return { x: minX + boxW * 0.5, y: minY + boxH * 0.88 };
            if (pos === 'left')   return { x: minX + boxW * 0.12, y: minY + boxH * 0.5 };
            if (pos === 'right')  return { x: minX + boxW * 0.88, y: minY + boxH * 0.5 };
            if (pos === 'corner') return { x: minX + boxW * 0.15, y: minY + boxH * 0.15 };
            return { x: minX + boxW * 0.5, y: minY + boxH * 0.5 };
        }

        var frontierY = maxY; // used only by baseline mode

        if (P.growthMode === 'baseline') {
            var numSeeds = Math.max(3, Math.min(14, Math.round(boxW / (stickR * 3))));
            for (var si = 0; si < numSeeds; si++) {
                var sx = minX + boxW * ((si + 0.5) / numSeeds);
                addNode(sx, maxY, -1, 0, si);
            }
        } else if (P.growthMode === 'multiseed') {
            var seedCount = Math.round(P.seedCount);
            for (var mi = 0; mi < seedCount; mi++) {
                var px = minX + boxW * (0.12 + 0.76 * rng());
                var py = minY + boxH * (0.12 + 0.76 * rng());
                addNode(px, py, -1, 0, mi);
            }
        } else { // radial
            var root = seedPos(P.seedPosition);
            addNode(root.x, root.y, -1, 0, 0);
        }

        // ── Growth loop ────────────────────────────────────────────────────────
        // Non-baseline walkers launch from a small ring around a randomly
        // chosen frontier-pool anchor (rather than a single ring around the
        // whole cluster's bounding region) — this keeps launches close to
        // actual growing mass regardless of how spread out multiple seed
        // colonies are, which is what makes multiseed/radial growth converge
        // in reasonable time instead of wasting walkers on empty space.
        var maxAttemptsPerWalker = 2500;
        var maxSpawnAttempts = targetCount * 60;
        var maxTotalSteps = 5000000;
        var totalSteps = 0;
        var spawnAttempts = 0;
        // Capped relative to the margin itself so a walker can never wander
        // past the physical page edge, however large stickRadiusMm is set.
        var padOut = Math.min(stickR * 2, mp * 0.9);

        while (nodes.length < targetCount &&
               spawnAttempts < maxSpawnAttempts && totalSteps < maxTotalSteps) {
            spawnAttempts++;
            var wx, wy, spawnCenterX, spawnCenterY, spawnR;
            if (P.growthMode === 'baseline') {
                wx = minX + rng() * boxW;
                wy = Math.max(minY, frontierY - stickR * 6);
            } else if (driftBias !== 0) {
                // Directional growth: spawn just ahead of a fairly-chosen
                // colony's own leading edge (frontierByRoot), in the empty
                // territory it hasn't grown into yet, with lateral position
                // drawn from however wide that colony has already fanned out.
                // The per-step drift then pulls the walker back toward the
                // existing mass, mirroring baseline's proven mechanism.
                var pickRootD = rootIds[Math.floor(rng() * rootIds.length)];
                var lo = lateralMinByRoot[pickRootD], hi = lateralMaxByRoot[pickRootD];
                var lateralJitter = Math.max(stickR * 4, (hi - lo) * 0.15);
                wx = lo + rng() * (hi - lo) + (rng() * 2 - 1) * lateralJitter;
                var offset = stickR * 6;
                wy = frontierByRoot[pickRootD] + growthDir * offset;
                spawnCenterX = wx; spawnCenterY = wy; spawnR = offset + stickR * 10;
            } else {
                // Isotropic growth (no drift): pick a colony uniformly first
                // (fair turn for every colony), then within that colony grow
                // from whichever tip has physically reached furthest from its
                // own seed — real DLA's incoming particles can't reach
                // shielded interior points without crossing outer branches
                // first, so this cheaply approximates that screening effect
                // without letting a bigger colony crowd out a smaller one's
                // turn, and without any drift to give spawning a "direction"
                // to launch from.
                var pickRoot = rootIds[Math.floor(rng() * rootIds.length)];
                var rpool = tipPoolByRoot[pickRoot].list;
                var seed = seedPosByRoot[pickRoot];
                var anchor = null, bestScore = -Infinity;
                for (var ac = 0; ac < rpool.length; ac++) {
                    var cnode = nodes[rpool[ac]];
                    var score = tipScore(cnode, seed);
                    if (score > bestScore) { bestScore = score; anchor = cnode; }
                }
                var ang = rng() * Math.PI * 2;
                spawnR = stickR * (3 + rng() * 4);
                spawnCenterX = anchor.x;
                spawnCenterY = anchor.y;
                wx = spawnCenterX + Math.cos(ang) * spawnR;
                wy = spawnCenterY + Math.sin(ang) * spawnR;
            }

            var stuckTo = -1;
            for (var step = 0; step < maxAttemptsPerWalker; step++) {
                totalSteps++;
                wx += (rng() * 2 - 1) * stepSize;
                wy += (rng() * 2 - 1) * stepSize + driftBias * stepSize;

                if (wx < minX - padOut || wx > maxX + padOut || wy < minY - padOut || wy > maxY + padOut) break;
                if (P.growthMode !== 'baseline') {
                    var dcx = wx - spawnCenterX, dcy = wy - spawnCenterY;
                    if ((dcx * dcx + dcy * dcy) > Math.pow(spawnR + stickR * 12, 2)) break;
                }

                var near = nearestClusterPoint(wx, wy);
                if (near >= 0) { stuckTo = near; break; }
                if (totalSteps >= maxTotalSteps) break;
            }

            if (stuckTo >= 0) {
                var parentNode = nodes[stuckTo];
                addNode(wx, wy, stuckTo, parentNode.depth + 1, parentNode.root);
                growChildCount[stuckTo]++;
                if (growChildCount[stuckTo] >= MAX_FANOUT) rootPoolRemove(parentNode.root, stuckTo);
                if (P.growthMode === 'baseline' && wy < frontierY) frontierY = wy;
            }
        }

        // ── Tree metrics: subtree size (for taper) and leaf detection ────────
        var n = nodes.length;
        var subtreeSize = new Array(n);
        var childCount = new Array(n);
        var maxDepth = 0;
        for (var a = 0; a < n; a++) { subtreeSize[a] = 1; childCount[a] = 0; if (nodes[a].depth > maxDepth) maxDepth = nodes[a].depth; }
        for (var b = n - 1; b >= 1; b--) {
            var p = nodes[b].parent;
            if (p >= 0) { subtreeSize[p] += subtreeSize[b]; childCount[p]++; }
        }
        var rootTotals = {};
        for (var c = 0; c < n; c++) {
            if (nodes[c].parent === -1) rootTotals[nodes[c].root] = subtreeSize[c];
        }

        // ── Render ─────────────────────────────────────────────────────────────
        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
            '<rect width="' + W + '" height="' + H + '" fill="' + (P.bgColor || '#ffffff') + '"/>'
        ];

        for (var e = 0; e < n; e++) {
            var node = nodes[e];
            if (node.parent === -1) continue;
            var par = nodes[node.parent];
            var total = rootTotals[node.root] || 1;
            var frac = subtreeSize[e] / total;
            var w = sw + (maxStrokeW - sw) * ((1 - P.taperStrength) + P.taperStrength * frac);
            var t = maxDepth > 0 ? node.depth / maxDepth : 0;
            var color = pickColor(palette, P.colorMode, t, node.root);
            parts.push('<line x1="' + par.x.toFixed(2) + '" y1="' + par.y.toFixed(2) +
                '" x2="' + node.x.toFixed(2) + '" y2="' + node.y.toFixed(2) +
                '" stroke="' + color + '" stroke-width="' + w.toFixed(2) + '" stroke-linecap="round"/>');
        }

        if (P.tipDotProb > 0) {
            for (var f = 0; f < n; f++) {
                if (childCount[f] !== 0) continue;
                if (rng() > P.tipDotProb) continue;
                var tf = maxDepth > 0 ? nodes[f].depth / maxDepth : 0;
                var col = pickColor(palette, P.colorMode, tf, nodes[f].root);
                var r = sw * 1.4;
                parts.push('<circle cx="' + nodes[f].x.toFixed(2) + '" cy="' + nodes[f].y.toFixed(2) +
                    '" r="' + r.toFixed(2) + '" fill="none" stroke="' + col + '" stroke-width="' + (sw * 0.7).toFixed(2) + '"/>');
            }
        }

        parts.push('</svg>');
        return parts.join('\n');
    }

    window.__autonomousSketch = {
        name:        'dendrite',
        description: 'Diffusion-limited aggregation growth — frost, lightning, coral, or crystal forms from thousands of random walks sticking to a growing cluster.',
        presets:     Object.keys(PRESETS),
        params:      params,
        stylePresets: [
            { label: 'Lightning', values: { growthMode: 'radial', seedPosition: 'top', driftBias: -0.5, colorMode: 'single', palette: ['#1a1a1a'] } },
            { label: 'Frost', values: { growthMode: 'baseline', driftBias: 0.3, stickRadiusMm: 2.2, colorMode: 'depth' } },
            { label: 'Coral Reef', values: { growthMode: 'multiseed', seedCount: 5, driftBias: -0.15, colorMode: 'branch' } },
            { label: 'Crystal', values: { growthMode: 'multiseed', seedCount: 10, driftBias: 0, stickRadiusMm: 2.5, colorMode: 'single' } }
        ],
        generate:    generate
    };
})();
