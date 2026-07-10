window.sketches = window.sketches || {};
window.sketches['whirls'] = function(p) {
    var paper = window.makeSketchUtils;

    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        whirlCount: 8,
        cellLen: 40,
        cellWidth: 22,
        rowsBase: 3,
        rowsSpread: 0.5,
        fieldScale: 0.003,
        pathMode: 'flow',
        swirlStrength: 0.7,
        showBorder: true,
        overlapMode: 'erase',
        fillStyles: ['hatch'],
        laneVariability: 0,
        cellLenVariability: 0,
        endFray: 0,
        divergentEnds: false,
        symbolScale: 1.0,
        viewMode: 'normal',
        penWidthMm: 0.4,
        palette: ['#e63946', '#2196f3', '#ff9800', '#4caf50', '#9c27b0', '#ffd600']
    };

    var whirls = [];
    var globalSeed = 1;
    var fieldAngleOffset = 0; // per-seed global rotation of the Perlin field
    var sharedSwirlCenter = null;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function() { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    }

    function cellColorIdx(whirlIdx, segIdx, rowIdx) {
        return Math.abs(
            ((globalSeed | 0) * 73856093) ^
            ((whirlIdx + 1) * 19349663) ^
            ((segIdx + 1) * 83492791) ^
            ((rowIdx + 1) * 56982631)
        ) >>> 0;
    }

    var api = {
        hasPause: false,
        stylePresets: [
            { label: 'Flow hatch', values: { pathMode:'flow', whirlCount:8, cellLen:40, cellWidth:22, rowsBase:3, fieldScale:3, fillStyle:['hatch'] } },
            { label: 'Curly chaos', values: { pathMode:'curlyq', swirlStrength:80, whirlCount:14, fieldScale:6, fillStyle:['sketchHatch'] } },
            { label: 'Shared vortex', values: { pathMode:'sharedSwirl', swirlStrength:70, whirlCount:6, cellLen:60, fillStyle:['hatch'] } },
            { label: 'Contour weave', values: { pathMode:'flow', fillStyle:['contour'], whirlCount:10, cellWidth:30, showBorder:'on' } },
            // Matches the original "noodles" algorithm's look (github.com/Fossj117/noodles_code,
            // outputs/output_1.svg): many thin (2-row) strands converging/crossing through the
            // field, not a few thick multi-row bands. rowsBase down to 2, cellWidth down to 10,
            // whirlCount way up, divergentEnds on (that toggle exists specifically to replicate
            // this algorithm's zero-smoothing path-following), border off since the reference
            // has no black grid lines between color segments.
            { label: 'Noodles', values: { pathMode:'flow', whirlCount:25, rowsBase:2, cellWidth:10, cellLen:35, divergentEnds:'on', showBorder:'off', fillStyle:['hatch'] } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
              value: PARAMS.palette.slice(),
              options: [
                { value: '#00ffff', label: 'Cyan' }, { value: '#ff00ff', label: 'Magenta' },
                { value: '#ffff00', label: 'Yellow' },{ value: '#000000', label: 'Black' },
                { value: '#e63946', label: 'Red' },   { value: '#4caf50', label: 'Green' },
                { value: '#2196f3', label: 'Blue' },  { value: '#9c27b0', label: 'Purple' },
                { value: '#ff9800', label: 'Orange' },{ value: '#ffd600', label: 'Yellow' },
                { value: 'custom',  label: 'Custom' }
              ]},
            { id: 'whirlCount', label: 'Whirls',     type: 'range', min: 2,   max: 60,  step: 1,   value: 8 },
            { id: 'cellLen',    label: 'Cell length', type: 'range', min: 10,  max: 120, step: 2,   value: 40 },
            { id: 'cellWidth',  label: 'Lane width',  type: 'range', min: 6,   max: 80,  step: 2,   value: 22 },
            { id: 'rowsBase',   label: 'Rows',         type: 'range', min: 1,   max: 10,  step: 1,   value: 3 },
            { id: 'rowsSpread', label: 'Rows spread', type: 'range', min: 0,   max: 10,  step: 1,   value: 5,
              _toInternal: function(v) { return v / 10; } },
            { id: 'laneVariability', label: 'Lane width variability', type: 'range', min: 0, max: 10, step: 1, value: 0,
              _toInternal: function(v) { return v / 10; } },
            { id: 'cellLenVariability', label: 'Cell length variability', type: 'range', min: 0, max: 10, step: 1, value: 0,
              _toInternal: function(v) { return v / 10; } },
            { id: 'endFray', label: 'End fraying', type: 'range', min: 0, max: 10, step: 1, value: 0,
              tip: 'At 0, every row/lane in a whirl runs the full length and ends together (current default). Above 0, each row independently stops somewhere in the tail of the path, so rows drop out one by one -- the whirl narrows toward its end instead of cutting off all at once.',
              _toInternal: function(v) { return v / 10; } },
            { id: 'fieldScale', label: 'Turbulence',  type: 'range', min: 1,   max: 12,  step: 1,   value: 3,
              _toInternal: function(v) { return v / 1000; } },
            { id: 'pathMode', label: 'Path mode', type: 'select', value: 'flow',
              options: [
                { value: 'flow', label: 'Flow' },
                { value: 'sharedSwirl', label: 'Shared swirl' },
                { value: 'curlyq', label: 'Curlyq' }
              ] },
            { id: 'swirlStrength', label: 'Swirl pull', type: 'range', min: 0, max: 100, step: 1, value: 70,
              visibleWhen: { param: 'pathMode', values: ['sharedSwirl', 'curlyq'] },
              _toInternal: function(v) { return v / 100; } },
            { id: 'divergentEnds', label: 'Diverging ends', type: 'select', value: 'off',
              tip: 'Off: current gentle-curve paths. On: the path direction snaps directly to the flow field every step, with no turn-rate smoothing -- matches the original "noodles" algorithm this sketch is based on, which follows the field more literally and looks more erratic/spread, especially near the ends.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'fillStyle', label: 'Fills', type: 'select', multiSelect: true, value: ['hatch'], group: 'textures',
              options: [
                { value: 'contour', label: 'Contour' },
                { value: 'hatch', label: 'Hatch' },
                { value: 'sketchHatch', label: 'Chaotic hatch' },
                { value: 'squiggleHatch', label: 'Squiggle hatch' },
                { value: 'zigzagHatch', label: 'Zigzag hatch' },
                { value: 'crosshatch', label: 'Crosshatch' },
                { value: 'waves', label: 'Waves' }
              ] },
            { id: 'showBorder', label: 'Cell border', type: 'select', value: 'on',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
        ]),
        regenerate: function() { resizeIfNeeded(); p.redraw(); },
        reseed: function() { globalSeed = Math.floor(Math.random() * 1e8) + 1; buildAllWhirls(); p.redraw(); },
        getRecipe: function() {
            return { state: { globalSeed: globalSeed } };
        },
        applyRecipeState: function(state) {
            if (state && Number.isFinite(Number(state.globalSeed))) {
                globalSeed = Number(state.globalSeed);
                buildAllWhirls();
                p.redraw();
            }
        },
        setParam: function(name, rawVal) {
            var pdef = api.params.find(function(x) { return x.id === name; });
            if (pdef) {
                // multiSelect params carry their live value as a JSON-stringified
                // array (the hidden <input>'s raw DOM value) -- pdef.value must
                // hold the PARSED array, not that raw string, or the next UI
                // rebuild (e.g. an Edit-layout toggle) re-stringifies the
                // already-stringified string. Confirmed live: a clean ["hatch"]
                // selection corrupts to ["[\"hatch\"]"] after just one rebuild.
                if (pdef.multiSelect && typeof rawVal === 'string') {
                    try { var _parsed = JSON.parse(rawVal); pdef.value = Array.isArray(_parsed) ? _parsed : [rawVal]; }
                    catch (e) { pdef.value = [rawVal]; }
                } else {
                    pdef.value = rawVal;
                }
            }
            var val = (pdef && pdef._toInternal) ? pdef._toInternal(rawVal) : rawVal;
            if (name === 'paperSize')   { PARAMS.paperSize = val; resizeIfNeeded(); }
            if (name === 'margin')      PARAMS.margin = Number(val);
            if (name === 'whirlCount')  PARAMS.whirlCount = Number(val);
            if (name === 'cellLen')     PARAMS.cellLen = Number(val);
            if (name === 'cellWidth')   PARAMS.cellWidth = Number(val);
            if (name === 'rowsBase')    PARAMS.rowsBase = Number(val);
            if (name === 'rowsSpread')  PARAMS.rowsSpread = val;
            if (name === 'laneVariability') PARAMS.laneVariability = val;
            if (name === 'cellLenVariability') PARAMS.cellLenVariability = val;
            if (name === 'endFray')    PARAMS.endFray = val;
            if (name === 'divergentEnds') PARAMS.divergentEnds = val === 'on';
            if (name === 'fieldScale')  PARAMS.fieldScale = val;
            if (name === 'pathMode')    PARAMS.pathMode = val;
            if (name === 'swirlStrength') PARAMS.swirlStrength = val;
            if (name === 'showBorder')  PARAMS.showBorder = val === 'on';
            if (name === 'overlapMode') PARAMS.overlapMode = val;
            if (name === 'fillStyle') {
                var _fv = val;
                if (typeof _fv === 'string') { try { _fv = JSON.parse(_fv); } catch(e) { _fv = [_fv]; } }
                if (!Array.isArray(_fv)) _fv = [String(_fv)];
                PARAMS.fillStyles = _fv.map(function(v){ return v==='solid'?'hatch':v; }).filter(Boolean);
                if (!PARAMS.fillStyles.length) PARAMS.fillStyles = ['hatch'];
            }
            if (name === 'penWidthMm')  PARAMS.penWidthMm = Number(val);
            if (name === 'viewMode')    PARAMS.viewMode = val;
            if (name === 'palette')     { PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette; }
            if (name === '_renderMode') { p.redraw(); }
            var rebuilds = ['whirlCount','cellLen','cellWidth','rowsBase','rowsSpread','laneVariability','cellLenVariability','endFray','divergentEnds','fieldScale','pathMode','swirlStrength','paperSize','margin'];
            if (rebuilds.indexOf(name) !== -1) buildAllWhirls();
        },
        saveSVG: function() { exportSVG(); },
        getPlotColors: function() {
            var colors = PARAMS.palette.slice();
            if (PARAMS.showBorder && colors.indexOf('#000000') === -1) colors.push('#000000');
            return colors;
        }
    };

    function resizeIfNeeded() { paper.resizeCanvasToPaper(p, PARAMS.paperSize); }

    // ---- geometry ----
    function segIntersectT(P, Q, A, B) { return plotFills.segIntersectT(P, Q, A, B); }
    function pointInPoly(pt, poly) { return plotFills.pointInPoly(pt, poly); }

    function clipLineOutsidePoly(x1, y1, x2, y2, poly) {
        return plotFills.clipLineOutsidePoly(x1, y1, x2, y2, poly);
    }


    function clipLineToRect(x1, y1, x2, y2, rx, ry, rh, rw) {
        return plotFills.clipLineToRect(x1, y1, x2, y2, rx, ry, rh, rw);
    }

    // ---- path generation ----
    function normalAt(path, i) {
        var a=path[Math.max(0,i-1)], b=path[Math.min(path.length-1,i+1)];
        var dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1;
        return {x:-dy/len, y:dx/len};
    }

    // Approximate local radius of curvature at path[i], from the turn angle
    // between the two adjacent segments. Offsetting a curve outward by more
    // than its own local radius folds the offset copy back on itself (a
    // standard offset-curve failure mode) -- used to clamp the whirl's
    // erase-mask outline so it can't self-intersect at tight turns, which
    // otherwise breaks erase-mode masking for whatever OTHER whirls are
    // supposed to clip against it.
    function localRadiusAt(path, i) {
        var a=path[Math.max(0,i-1)], b=path[i], c=path[Math.min(path.length-1,i+1)];
        var d1x=b.x-a.x, d1y=b.y-a.y, d2x=c.x-b.x, d2y=c.y-b.y;
        var l1=Math.hypot(d1x,d1y), l2=Math.hypot(d2x,d2y);
        if (l1 < 1e-6 || l2 < 1e-6) return Infinity;
        var dAng = Math.abs(normAngleDiff(Math.atan2(d2y,d2x), Math.atan2(d1y,d1x)));
        if (dAng < 1e-4) return Infinity;
        return ((l1+l2)/2) / dAng;
    }

    function _segsIntersect(a1,a2,b1,b2) {
        function cross(o,a,b){ return (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x); }
        var d1=cross(b1,b2,a1), d2=cross(b1,b2,a2), d3=cross(a1,a2,b1), d4=cross(a1,a2,b2);
        return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
    }
    function _polySelfIntersects(pts) {
        var n = pts.length;
        if (n < 4) return false;
        for (var i=0;i<n;i++) {
            var a1=pts[i], a2=pts[(i+1)%n];
            for (var j=i+2;j<n;j++) {
                if (j===n-1 && i===0) continue;
                if (_segsIntersect(a1,a2,pts[j],pts[(j+1)%n])) return true;
            }
        }
        return false;
    }
    function _buildOffsetSide(path, totalRowW, scale) {
        var side = [];
        for (var i=path.length-1; i>=0; i--) {
            var n=normalAt(path,i);
            var off = Math.min(totalRowW, localRadiusAt(path,i) * 0.6) * scale;
            side.push({x:path[i].x+n.x*off, y:path[i].y+n.y*off});
        }
        return side;
    }
    // Build the whirl's erase-mask outline: path forward at offset 0, path
    // backward at offset totalRowW. A curve offset by more than its own local
    // radius folds back on itself -- confirmed live: the raw centerline path
    // never self-intersects (capped by generatePath's orbit-revolution limit),
    // but this offset copy sometimes still did, which is what broke erase-mode
    // masking for whatever OTHER whirls were supposed to clip against it (both
    // the canvas's nonzero-winding fill and the SVG export's even-odd
    // point-in-polygon test give wrong "is this point covered" answers inside
    // a self-intersecting shape's twisted region). The per-point local-radius
    // clamp above catches most cases; this verifies the WHOLE outline is
    // actually simple and progressively shrinks the global scale if not --
    // guarantees a correct mask, at the cost of a tighter one in edge cases.
    function buildSimpleOutline(path, totalRowW) {
        var fwd = path.map(function(pt){ return {x:pt.x, y:pt.y}; });
        var scales = [1, 0.6, 0.35, 0.15, 0.05, 0.01];
        for (var s = 0; s < scales.length; s++) {
            var outline = fwd.concat(_buildOffsetSide(path, totalRowW, scales[s]));
            if (s === scales.length-1 || !_polySelfIntersects(outline)) return outline;
        }
    }

    function normAngleDiff(target, current) {
        var diff = target - current;
        return diff - Math.PI * 2 * Math.floor((diff + Math.PI) / (Math.PI * 2));
    }

    function mixAngles(a, b, amount) {
        return a + normAngleDiff(b, a) * Math.max(0, Math.min(1, amount));
    }

    function chooseSwirlCenter(rng, w, h, sx, sy) {
        if (PARAMS.pathMode === 'sharedSwirl') {
            return sharedSwirlCenter;
        }
        if (PARAMS.pathMode === 'curlyq') {
            var radius = Math.min(w, h) * (0.08 + rng() * 0.2);
            var a = rng() * Math.PI * 2;
            return {
                x: sx + Math.cos(a) * radius,
                y: sy + Math.sin(a) * radius,
                dir: rng() < 0.5 ? -1 : 1,
                targetRadius: radius * (0.55 + rng() * 0.9)
            };
        }
        return null;
    }

    function generatePath(rng, w, h) {
        var cl = 4;  // micro-step px; segsPerCell = round(cellLen/cl) in buildWhirl
        var scale = PARAMS.fieldScale;
        var sx = rng() * w;
        var sy = rng() * h;
        var center = chooseSwirlCenter(rng, w, h, sx, sy);
        // Initial direction: field sample + per-seed rotation so direction varies across seeds
        var ang = p.noise(sx * scale, sy * scale) * Math.PI * 2 + fieldAngleOffset;
        if (center) {
            ang = Math.atan2(sy - center.y, sx - center.x) + center.dir * Math.PI / 2;
        }
        var pts = [{x:sx, y:sy}];
        var x=sx, y=sy;
        var maxSteps = PARAMS.pathMode === 'flow' ? 300 : 420;
        maxSteps = Math.min(maxSteps, Math.max(160, Math.round(14000 / Math.max(1, PARAMS.whirlCount))));
        maxSteps = Math.round(maxSteps * PARAMS.cellLen / cl);
        var _sm = cl / PARAMS.cellLen;
        // Orbit-based modes (sharedSwirl/curlyq) have no natural reason to ever
        // exit the page bounds -- the center is well inside it -- so without a
        // cap the path just spirals until maxSteps runs out, which can be 10+
        // full revolutions around the same center (confirmed live: an 8402-point
        // outline for a whirl whose orbit radius implies ~150-300 steps per lap).
        // A path that loops back over itself that many times makes the whirl's
        // own outline self-intersecting, which breaks the erase-mode masking
        // (both the canvas's fill-rule-based mask and the SVG export's even-odd
        // point-in-polygon clip) for whichever OTHER whirls it's supposed to be
        // clipped against -- that's the "drawing over itself" density the
        // operator was seeing, worst in sharedSwirl specifically because every
        // whirl orbits the SAME shared center. Capping total orbital travel
        // keeps the swirl shape (still gets a full decorative loop-and-a-half)
        // without the pathological multi-lap tangle.
        var totalOrbitRad = 0, prevOrbitAng = center ? Math.atan2(sy - center.y, sx - center.x) : 0;
        var maxOrbitRad = Math.PI * 2 * 1.0;
        for (var i=0; i<maxSteps; i++) {
            var fieldAng = p.noise(x * scale, y * scale) * Math.PI * 2 + fieldAngleOffset;
            if (center) {
                var dxC = x - center.x;
                var dyC = y - center.y;
                var dist = Math.hypot(dxC, dyC) || 1;
                var orbitAng = Math.atan2(dyC, dxC) + center.dir * Math.PI / 2;
                var targetRadius = center.targetRadius || Math.min(w, h) * 0.24;
                var radialError = Math.max(-1, Math.min(1, (dist - targetRadius) / Math.max(1, targetRadius)));
                var swirlAng = orbitAng + radialError * center.dir * 0.7;
                fieldAng = mixAngles(fieldAng, swirlAng, PARAMS.swirlStrength);
            }
            if (PARAMS.divergentEnds) {
                // Original "noodles" algorithm (main2.py, construct_points()) sets the
                // direction directly to the field angle every step -- no turn-rate
                // easing at all: `angle = field.get_angle(...)`. That zero-inertia
                // following is what makes those paths visibly more erratic/spread,
                // especially near their ends where the least path history has
                // accumulated to average out the field's local jumpiness. Replicated
                // faithfully here rather than tuned by eye.
                ang = fieldAng;
            } else {
                var diff = normAngleDiff(fieldAng, ang);
                ang += diff * (center ? 0.22 : 0.15) * _sm;
            }
            x += Math.cos(ang) * cl;
            y += Math.sin(ang) * cl;
            pts.push({x:x, y:y});
            if (x < -120 || x > w+120 || y < -120 || y > h+120) break;
            if (center) {
                var curOrbitAng = Math.atan2(y - center.y, x - center.x);
                totalOrbitRad += Math.abs(normAngleDiff(curOrbitAng, prevOrbitAng));
                prevOrbitAng = curOrbitAng;
                if (totalOrbitRad > maxOrbitRad) break;
            }
        }
        var pad=80, s=0, e=pts.length-1;
        while (s < e && !inBounds(pts[s],w,h,pad)) s++;
        while (e > s && !inBounds(pts[e],w,h,pad)) e--;
        var out = pts.slice(s, e+1);
        return out.length >= 2 ? out : null;
    }

    function inBounds(pt, w, h, pad) {
        return pt.x > -pad && pt.x < w+pad && pt.y > -pad && pt.y < h+pad;
    }

    function buildWhirl(pathRng, rowsRng, dims, zIndex) {
        var path = generatePath(pathRng, dims.width, dims.height);
        if (!path || path.length < 2) return null;

        var spread = PARAMS.rowsSpread;
        var rows = Math.max(1, Math.round(PARAMS.rowsBase * (1 + (rowsRng()-0.5)*2*spread)));
        var cw = PARAMS.cellWidth;
        var laneVar = PARAMS.laneVariability || 0;
        var cells = [];

        var MICRO = 4;
        var baseSegsPerCell = Math.max(2, Math.round(PARAMS.cellLen / MICRO));
        var cellLenVar = PARAMS.cellLenVariability || 0;
        // Per-row widths: randomised if laneVariability > 0, else uniform
        var rowWidths = [];
        if (laneVar < 0.01) {
            for (var r=0; r<rows; r++) rowWidths.push(cw);
        } else {
            var _rawW=[], _rsum=0;
            for (var r=0; r<rows; r++) { var _rw=1+(rowsRng()-0.5)*2*laneVar*2; _rawW.push(Math.max(0.15,_rw)); _rsum+=_rawW[r]; }
            var _rscale=(rows*cw)/_rsum;
            for (var r=0; r<rows; r++) rowWidths.push(Math.max(cw*0.15, _rawW[r]*_rscale));
        }
        var totalRowW = rowWidths.reduce(function(a,b){return a+b;},0);
        // Per-row end point: at endFray=0 every row runs the whirl's full
        // length (current/original behavior). Above 0, each row independently
        // stops somewhere in the tail of the path -- rows keep dropping out
        // one by one as ci advances, which is what actually reads as
        // "fraying" (progressively narrower toward the end), rather than
        // every row cutting off at once.
        var endFray = PARAMS.endFray || 0;
        var rowEndCi = [];
        for (var r=0; r<rows; r++) {
            rowEndCi.push(endFray < 0.01 ? path.length : Math.round(path.length * (1 - rowsRng()*endFray)));
        }
        var ci = 0, cellIdx = 0;
        while (ci + baseSegsPerCell < path.length) {
            // Per-cell length: randomised if cellLenVariability > 0, else the fixed
            // base length -- mirrors how rowWidths above randomises per-row width.
            var segsPerCell = baseSegsPerCell;
            if (cellLenVar > 0.01) {
                var _lf = 1 + (rowsRng()-0.5)*2*cellLenVar;
                segsPerCell = Math.max(2, Math.round(baseSegsPerCell * Math.max(0.15, _lf)));
            }
            if (ci + segsPerCell >= path.length) segsPerCell = path.length - 1 - ci;
            if (segsPerCell < 2) break;
            var tangAng = Math.atan2(path[ci+1].y-path[ci].y, path[ci+1].x-path[ci].x);
            var endPi = ci + segsPerCell;
            var tangAngEnd = (endPi+1 < path.length)
                ? Math.atan2(path[endPi+1].y-path[endPi].y, path[endPi+1].x-path[endPi].x)
                : tangAng;
            var rowOff = 0;
            for (var r=0; r<rows; r++) {
                var io=rowOff, oo=rowOff+rowWidths[r]; rowOff=oo;
                // This row already frayed out -- still advance rowOff above (so
                // rows after it keep their correct lane position) but stop
                // generating cells for THIS row past its own end point.
                if (ci >= rowEndCi[r]) continue;
                var innerPts=[], outerPts=[];
                for (var j=0; j<=segsPerCell; j++) {
                    var pi=Math.min(ci+j, path.length-1);
                    var n=normalAt(path,pi);
                    innerPts.push({x:path[pi].x+n.x*io, y:path[pi].y+n.y*io});
                    outerPts.push({x:path[pi].x+n.x*oo, y:path[pi].y+n.y*oo});
                }
                var _np=innerPts.length;
                cells.push({
                    innerPts: innerPts,
                    outerPts: outerPts,
                    quad: [innerPts[0], outerPts[0], outerPts[_np-1], innerPts[_np-1]],
                    colorIdx: cellColorIdx(zIndex, cellIdx, r),
                    tangAng: tangAng,
                    tangAngEnd: tangAngEnd
                });
            }
            ci += segsPerCell;
            cellIdx++;
        }
        if (!cells.length) return null;

        var outline = buildSimpleOutline(path, totalRowW);
        return {cells:cells, outline:outline, zIndex:zIndex, rows:rows};
    }

    function buildAllWhirls() {
        p.noiseSeed(globalSeed);
        // Per-seed angle offset — rotates the entire Perlin field so dominant flow
        // direction changes completely from seed to seed
        fieldAngleOffset = makeRng(globalSeed * 999983 + 7)() * Math.PI * 2;
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var centerRng = makeRng((globalSeed ^ 0x9e3779b9) >>> 0);
        sharedSwirlCenter = {
            x: dims.width * (0.35 + centerRng() * 0.3),
            y: dims.height * (0.35 + centerRng() * 0.3),
            dir: centerRng() < 0.5 ? -1 : 1,
            targetRadius: Math.min(dims.width, dims.height) * (0.14 + centerRng() * 0.18)
        };
        whirls = [];
        for (var i=0; i<PARAMS.whirlCount; i++) {
            var pathRng = makeRng((globalSeed ^ (i * 2654435761)) >>> 0);
            var rowsRng = makeRng(((globalSeed * 1000003) ^ (i * 2246822519)) >>> 0);
            var w = buildWhirl(pathRng, rowsRng, dims, i);
            if (w) whirls.push(w);
        }
    }

    // ---- hatch (SVG) ----
    function hatchQuad(quad, angleDeg, density) {
        var spacing = (paper.DPI/25.4)/density;
        var ang = angleDeg*Math.PI/180;
        var dir={x:Math.cos(ang), y:Math.sin(ang)}, nrm={x:-Math.sin(ang), y:Math.cos(ang)};
        var proj=function(pt){return nrm.x*pt.x+nrm.y*pt.y;};
        var minP=Infinity, maxP=-Infinity;
        quad.forEach(function(pt){var pr=proj(pt); if(pr<minP)minP=pr; if(pr>maxP)maxP=pr;});
        var lines=[];
        for (var k=Math.floor((minP-spacing)/spacing); k<=Math.ceil((maxP+spacing)/spacing); k++) {
            var off=k*spacing;
            var p0={x:-9999*dir.x+off*nrm.x, y:-9999*dir.y+off*nrm.y};
            var p1={x: 9999*dir.x+off*nrm.x, y: 9999*dir.y+off*nrm.y};
            var ts=[];
            for (var i=0; i<quad.length; i++) {
                var t=segIntersectT(p0,p1,quad[i],quad[(i+1)%quad.length]);
                if (t!==null) ts.push(t);
            }
            ts.sort(function(a,b){return a-b;});
            for (var j=0; j+1<ts.length; j+=2)
                lines.push({x1:p0.x+(p1.x-p0.x)*ts[j], y1:p0.y+(p1.y-p0.y)*ts[j],
                             x2:p0.x+(p1.x-p0.x)*ts[j+1], y2:p0.y+(p1.y-p0.y)*ts[j+1]});
        }
        return lines;
    }

    // Generate symbol segments centered at origin (unrotated), given half-size s
    function effectiveHatchDensity() {
        return plotFills.getEffectiveDensity();
    }

    function getCellFillStyle(cell) {
        var styles = (PARAMS.fillStyles || []).concat(plotFills.getScatterStyles());
        if (!styles.length) return 'hatch';
        if (styles.length === 1) return styles[0];
        var idx = (Math.abs(cell.colorIdx ^ 0xDEAD5EED) >>> 0) % styles.length;
        return styles[idx];
    }

    function noisyLineSegments(lines, spacing, phase, wobble, broken) {
        var segs = [];
        for (var i = 0; i < lines.length; i++) {
            var s = lines[i];
            var dx = s.x2-s.x1, dy = s.y2-s.y1;
            var len = Math.sqrt(dx*dx+dy*dy);
            if (len < 1) continue;
            var ux=dx/len, uy=dy/len, nx=-uy, ny=ux;
            var pieces = broken ? Math.max(2, Math.min(7, Math.floor(len/(spacing*2.4)))) : 1;
            for (var j = 0; j < pieces; j++) {
                var a = pieces===1 ? 0 : j/pieces;
                var b = pieces===1 ? 1 : Math.min(1, a+0.55+0.22*Math.sin(phase+i*1.7+j));
                var gap = broken ? 0.12+0.08*Math.sin(phase+i*2.1+j*3.3) : 0.02;
                a = Math.min(0.96, a+gap);
                b = Math.max(a+0.02, b-gap);
                segs.push({
                    x1: s.x1+dx*a+nx*wobble*Math.sin(phase+i*.91+j*2.4),
                    y1: s.y1+dy*a+ny*wobble*Math.sin(phase+i*.91+j*2.4),
                    x2: s.x1+dx*b+nx*wobble*Math.sin(phase+i*1.23+j*2.9+1.7),
                    y2: s.y1+dy*b+ny*wobble*Math.sin(phase+i*1.23+j*2.9+1.7)
                });
            }
        }
        return segs;
    }

    function fillLinesForCell(cell) {
        var style = getCellFillStyle(cell);
        var hatchDeg = cell.tangAng * 180 / Math.PI + 90 + plotFills.getFillAngle();
        var density = effectiveHatchDensity();
        var spacing = (paper.DPI / 25.4) / density;
        var phase = (cell.colorIdx % 100000) * 0.001;
        if (style === 'zigzagHatch')   return zigzagQuad(cell.quad, hatchDeg, density, phase);
        if (style === 'sprigFill')     return plotFills.scatterPolyFill(cell.quad, 'sprig',    spacing, PARAMS.symbolScale, cell.colorIdx);
        if (style === 'ribbonFill')    return plotFills.scatterPolyFill(cell.quad, 'ribbon',   spacing, PARAMS.symbolScale, cell.colorIdx);
        if (style === 'crossFill')     return plotFills.scatterPolyFill(cell.quad, 'cross',    spacing, PARAMS.symbolScale, cell.colorIdx);
        if (style === 'asteriskFill')  return plotFills.scatterPolyFill(cell.quad, 'asterisk', spacing, PARAMS.symbolScale, cell.colorIdx);
        var lines = hatchQuad(cell.quad, hatchDeg, density);
        if (style === 'sketchHatch') {
            return noisyLineSegments(lines, spacing, phase, spacing * (0.6 + plotFills.getFillImperfection() * 1.4), false);
        }
        if (style === 'squiggleHatch') {
            return noisyLineSegments(lines, spacing, phase, spacing * plotFills.getFillImperfection() * 0.9, true);
        }
        return lines;
    }

    // ---- canvas ----
    p.registerSketchAPI = function(register){ if(typeof register==='function') register(api); };

    p.setup = function() {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            var helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;max-width:900px;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            helpEl.textContent = 'Adjust parameters on the right to compose your piece. Hit Reseed to shuffle colors and shapes.';
            container.appendChild(helpEl);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        p.pixelDensity(1); p.noLoop();
        globalSeed = Math.floor(Math.random()*1e8)+1;
        buildAllWhirls();
    };

    function getCellColor(cell) {
        var pal = PARAMS.palette.length ? PARAMS.palette : ['#000000'];
        var hex = pal[cell.colorIdx % pal.length];
        var c = p.color(hex);
        if (PARAMS.viewMode === 'multiply') c.setAlpha(204);
        return c;
    }

    function getCellHex(cell) {
        var pal = PARAMS.palette.length ? PARAMS.palette : ['#000000'];
        return pal[cell.colorIdx % pal.length];
    }

    // Contour fill spanning the full whirl — cross-cell bezier curves.
    // Uses different start/end tangents per cell so lines visibly curve
    // wherever the path actually bends.
    function drawWhirlContour(whirl, strokeW) {
        if (!whirl.rows) return;
        var nRows = whirl.rows;
        var nSegs = Math.round(whirl.cells.length / nRows);
        if (nSegs < 1) return;
        var cw = PARAMS.cellWidth;
        var totalW = nRows * cw;
        var sp = (paper.DPI / 25.4) / effectiveHatchDensity();
        var nLines = Math.floor(totalW / sp) - 1;
        if (nLines < 1) return;
        var startOff = (totalW - (nLines - 1) * sp) / 2;
        var ctx = p.drawingContext;
        p.strokeWeight(strokeW);
        for (var li = 0; li < nLines; li++) {
            var d = startOff + li * sp;
            var rowIdx = Math.floor(d / cw);
            var alpha = (d - rowIdx * cw) / cw;
            if (rowIdx >= nRows) continue;
            var fwd = (li % 2 === 0);
            for (var si = 0; si < nSegs; si++) {
                var i = fwd ? si : nSegs - 1 - si;
                var cellIdx = i * nRows + rowIdx;
                if (cellIdx >= whirl.cells.length) continue;
                var cell = whirl.cells[cellIdx];
                var nextIdx = (i + (fwd ? 1 : -1)) * nRows + rowIdx;
                var nextCell = (nextIdx >= 0 && nextIdx < whirl.cells.length) ? whirl.cells[nextIdx] : null;
                var q = cell.quad;
                var tang = cell.tangAng, nextTang = nextCell ? nextCell.tangAng : tang;
                var sx, sy, ex, ey, stx, sty, etx, ety;
                if (fwd) {
                    sx = q[0].x + (q[1].x-q[0].x)*alpha; sy = q[0].y + (q[1].y-q[0].y)*alpha;
                    ex = q[3].x + (q[2].x-q[3].x)*alpha; ey = q[3].y + (q[2].y-q[3].y)*alpha;
                    stx = Math.cos(tang); sty = Math.sin(tang);
                    etx = Math.cos(nextTang); ety = Math.sin(nextTang);
                } else {
                    sx = q[3].x + (q[2].x-q[3].x)*alpha; sy = q[3].y + (q[2].y-q[3].y)*alpha;
                    ex = q[0].x + (q[1].x-q[0].x)*alpha; ey = q[0].y + (q[1].y-q[0].y)*alpha;
                    stx = -Math.cos(tang); sty = -Math.sin(tang);
                    etx = -Math.cos(nextTang); ety = -Math.sin(nextTang);
                }
                var m = Math.hypot(ex-sx, ey-sy) * 0.35;
                p.stroke(getCellColor(cell));
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.bezierCurveTo(sx+stx*m/3, sy+sty*m/3, ex-etx*m/3, ey-ety*m/3, ex, ey);
                ctx.stroke();
            }
        }
    }

    // SVG contour lines spanning the full whirl.
    function contourWhirlSVGParts(whirl, whirlIndex, sw, mp, dims) {
        var nRows = whirl.rows;
        if (!nRows) return [];
        var nSegs = Math.round(whirl.cells.length / nRows);
        if (nSegs < 1) return [];
        var cw = PARAMS.cellWidth;
        var totalW = nRows * cw;
        var sp = (paper.DPI / 25.4) / effectiveHatchDensity();
        var nLines = Math.floor(totalW / sp) - 1;
        if (nLines < 1) return [];
        var startOff = (totalW - (nLines - 1) * sp) / 2;
        var clipOutlines = PARAMS.overlapMode === 'erase'
            ? whirls.slice(whirlIndex + 1).map(function(w){ return w.outline; })
            : whirls.filter(function(w){ return w.zIndex > whirl.zIndex; }).map(function(w){ return w.outline; });
        var N_SAMP = 10;
        var parts = [];
        for (var li = 0; li < nLines; li++) {
            var d = startOff + li * sp;
            var rowIdx = Math.floor(d / cw);
            var alpha = (d - rowIdx * cw) / cw;
            if (rowIdx >= nRows) continue;
            var fwd = (li % 2 === 0);
            for (var si = 0; si < nSegs; si++) {
                var i = fwd ? si : nSegs - 1 - si;
                var cellIdx = i * nRows + rowIdx;
                if (cellIdx >= whirl.cells.length) continue;
                var cell = whirl.cells[cellIdx];
                var nextIdx = (i + (fwd ? 1 : -1)) * nRows + rowIdx;
                var nextCell = (nextIdx >= 0 && nextIdx < whirl.cells.length) ? whirl.cells[nextIdx] : null;
                var q = cell.quad;
                var tang = cell.tangAng, nextTang = nextCell ? nextCell.tangAng : tang;
                var sx, sy, ex, ey, stx, sty, etx, ety;
                if (fwd) {
                    sx=q[0].x+(q[1].x-q[0].x)*alpha; sy=q[0].y+(q[1].y-q[0].y)*alpha;
                    ex=q[3].x+(q[2].x-q[3].x)*alpha; ey=q[3].y+(q[2].y-q[3].y)*alpha;
                    stx=Math.cos(tang); sty=Math.sin(tang);
                    etx=Math.cos(nextTang); ety=Math.sin(nextTang);
                } else {
                    sx=q[3].x+(q[2].x-q[3].x)*alpha; sy=q[3].y+(q[2].y-q[3].y)*alpha;
                    ex=q[0].x+(q[1].x-q[0].x)*alpha; ey=q[0].y+(q[1].y-q[0].y)*alpha;
                    stx=-Math.cos(tang); sty=-Math.sin(tang);
                    etx=-Math.cos(nextTang); ety=-Math.sin(nextTang);
                }
                var m = Math.hypot(ex-sx,ey-sy)*0.35;
                var cx1=sx+stx*m/3, cy1=sy+sty*m/3, cx2=ex-etx*m/3, cy2=ey-ety*m/3;
                var color = getCellHex(cell);
                if (!clipOutlines.length) {
                    parts.push('<path d="M'+fmt(sx)+' '+fmt(sy)+' C'+fmt(cx1)+' '+fmt(cy1)+' '+fmt(cx2)+' '+fmt(cy2)+' '+fmt(ex)+' '+fmt(ey)+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round"/>');
                } else {
                    var prev={x:sx,y:sy}, segs=[];
                    for (var s=1; s<=N_SAMP; s++) {
                        var t=s/N_SAMP, mt=1-t, mt2=mt*mt, t2=t*t;
                        var cur={x:mt2*mt*sx+3*mt2*t*cx1+3*mt*t2*cx2+t2*t*ex, y:mt2*mt*sy+3*mt2*t*cy1+3*mt*t2*cy2+t2*t*ey};
                        segs.push({x1:prev.x,y1:prev.y,x2:cur.x,y2:cur.y}); prev=cur;
                    }
                    var clipped=[];
                    segs.forEach(function(seg) {
                        var ss=[{x1:seg.x1,y1:seg.y1,x2:seg.x2,y2:seg.y2}];
                        clipOutlines.forEach(function(ol){ var nx=[]; ss.forEach(function(s){ Array.prototype.push.apply(nx,clipLineOutsidePoly(s.x1,s.y1,s.x2,s.y2,ol)); }); ss=nx; });
                        ss.forEach(function(s){ var cs=clipLineToRect(s.x1,s.y1,s.x2,s.y2,mp,mp,dims.width-2*mp,dims.height-2*mp); if(cs) clipped.push(cs); });
                    });
                    if (clipped.length) {
                        var pd='M'+fmt(clipped[0].x1)+' '+fmt(clipped[0].y1), lx=clipped[0].x1, ly=clipped[0].y1;
                        clipped.forEach(function(seg){ if(Math.hypot(seg.x1-lx,seg.y1-ly)>0.5) pd+=' M'+fmt(seg.x1)+' '+fmt(seg.y1); pd+=' L'+fmt(seg.x2)+' '+fmt(seg.y2); lx=seg.x2; ly=seg.y2; });
                        parts.push('<path d="'+pd+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                    }
                }
            }
        }
        return parts;
    }

    // Paint white over THIS CELL's own quad (innerPts+outerPts), not the
    // whole whirl's offset-path outline. A whole-whirl outline is built by
    // offsetting the ENTIRE path outward, which can fold back on itself at
    // tight turns (confirmed live) and, worse, doesn't necessarily match
    // what's actually drawn -- shrinking that outline to avoid self-
    // intersection (an earlier attempt at this fix) made the mask and the
    // real cell geometry diverge, causing BOTH unmasked overlap where the
    // mask undershot and orphaned white gaps where it overshot. A single
    // cell's own quad is short and simple enough to essentially never
    // self-intersect, and masking with the EXACT shape that's about to be
    // drawn means mask and content can never disagree.
    function drawCellMask(cell) {
        if (!cell.innerPts || !cell.innerPts.length) return;
        var curBlend = PARAMS.viewMode === 'multiply' ? p.MULTIPLY : p.BLEND;
        p.blendMode(p.BLEND);
        p.noStroke();
        p.fill(255);
        p.beginShape();
        cell.innerPts.forEach(function(pt){ p.vertex(pt.x, pt.y); });
        for (var k=cell.outerPts.length-1; k>=0; k--) p.vertex(cell.outerPts[k].x, cell.outerPts[k].y);
        p.endShape(p.CLOSE);
        p.blendMode(curBlend);
    }

    function drawCells(whirl, strokeW, doMask) {
        var ctx = p.drawingContext;
        whirl.cells.forEach(function(cell) {
            if (doMask) drawCellMask(cell);
            var _style = getCellFillStyle(cell);
            var _isScatter = _style==='sprigFill'||_style==='ribbonFill'||_style==='crossFill'||_style==='asteriskFill';
            if (_style && plotFills.getFillProb() < 1 && ((cell.colorIdx >>> 0) % 997) / 997 >= plotFills.getFillProb()) _style = null;
            var _isConn = _style==='hatch'||_style==='sketchHatch'||_style==='zigzagHatch';
            p.noFill();
            p.stroke(getCellColor(cell));
            p.strokeWeight(strokeW);
            var _hDeg = cell.tangAng*180/Math.PI + 90 + plotFills.getFillAngle();
            var _dens = effectiveHatchDensity();
            var _sp = (paper.DPI/25.4)/_dens;
            var _ph = (cell.colorIdx % 100000)*0.001;
            if (_style) {
            if (_style === 'contour') {
                var _np = cell.innerPts.length;
                var _wS = Math.hypot(cell.outerPts[0].x-cell.innerPts[0].x, cell.outerPts[0].y-cell.innerPts[0].y);
                var _wE = Math.hypot(cell.outerPts[_np-1].x-cell.innerPts[_np-1].x, cell.outerPts[_np-1].y-cell.innerPts[_np-1].y);
                var _cellW = (_wS + _wE) * 0.5;
                var _nL = Math.max(1, Math.round(_cellW / _sp));
                var _sOff = (_cellW - (_nL - 1) * _sp) / 2;
                if (_nL >= 1) {
                    ctx.beginPath();
                    for (var _k = 0; _k < _nL; _k++) {
                        var _a = (_sOff + _k * _sp) / _cellW;
                        var _fwd = (_k % 2 === 0);
                        if (_fwd) {
                            for (var _j=0; _j<_np; _j++) {
                                var _px=cell.innerPts[_j].x+(cell.outerPts[_j].x-cell.innerPts[_j].x)*_a;
                                var _py=cell.innerPts[_j].y+(cell.outerPts[_j].y-cell.innerPts[_j].y)*_a;
                                if (plotFills.isPenLift() ? _j===0 : (_k===0 && _j===0)) ctx.moveTo(_px,_py); else ctx.lineTo(_px,_py);
                            }
                        } else {
                            for (var _j=_np-1; _j>=0; _j--) {
                                var _px=cell.innerPts[_j].x+(cell.outerPts[_j].x-cell.innerPts[_j].x)*_a;
                                var _py=cell.innerPts[_j].y+(cell.outerPts[_j].y-cell.innerPts[_j].y)*_a;
                                if (plotFills.isPenLift() ? _j===_np-1 : (_k===0 && _j===_np-1)) ctx.moveTo(_px,_py); else ctx.lineTo(_px,_py);
                            }
                        }
                    }
                    ctx.stroke();
                }
            } else {
            var _cpoly = plotFills.tessellateFlowQuadV2(cell.quad, cell.tangAng, cell.tangAngEnd, paper.DPI/25.4);
            if (_style === 'squiggleHatch') {
                var _sr = plotFills.squiggleRows(plotFills.hatchPolyRows(_cpoly, _hDeg, _sp), _sp, _ph, _sp*plotFills.getFillImperfection()*0.9);
                plotFills.drawSquiggle(p.drawingContext, _sr);
            } else if (_isConn) {
                var _rows;
                if (_style === 'zigzagHatch') {
                    _rows = plotFills.zigzagPolyRows(_cpoly, _hDeg, _sp, _ph);
                } else if (_style === 'sketchHatch') {
                    _rows = plotFills.sketchHatchRows(plotFills.hatchPolyRows(_cpoly, _hDeg, _sp), _ph, _sp*(0.6+plotFills.getFillImperfection()*1.4));
                } else {
                    _rows = plotFills.hatchPolyRows(_cpoly, _hDeg, _sp);
                }
                plotFills.drawConnectedRows(p.drawingContext, _rows);
            } else if (_style === 'crosshatch') {
                plotFills.drawConnectedRows(p.drawingContext, plotFills.hatchPolyRows(_cpoly, _hDeg, _sp));
                plotFills.drawConnectedRows(p.drawingContext, plotFills.hatchPolyRows(_cpoly, _hDeg + 90, _sp));
            } else if (_style === 'waves') {
                var _wd = plotFills.waveConnectedPathD(_cpoly, _hDeg, _sp, _ph);
                if (_wd) { var _wp = new Path2D(_wd); p.drawingContext.stroke(_wp); }
            } else {
                fillLinesForCell(cell).forEach(function(ln) {
                    p.line(ln.x1, ln.y1, ln.x2, ln.y2);
                });
            }
            }
            }
            if (PARAMS.showBorder) {
                p.stroke(0);
                p.strokeWeight(strokeW);
                ctx.beginPath();
                ctx.moveTo(cell.innerPts[0].x, cell.innerPts[0].y);
                ctx.lineTo(cell.outerPts[0].x, cell.outerPts[0].y);
                for (var _bi=1; _bi<cell.outerPts.length; _bi++) ctx.lineTo(cell.outerPts[_bi].x, cell.outerPts[_bi].y);
                for (var _bi=cell.innerPts.length-1; _bi>=0; _bi--) ctx.lineTo(cell.innerPts[_bi].x, cell.innerPts[_bi].y);
                ctx.closePath();
                ctx.stroke();
            }
        });
    }

    p.draw = function() {
        p.background(255);
        paper.drawPaperBorder(p);

        var mp = paper.getMarginPixels(PARAMS.margin);
        var ctx = p.drawingContext;
        var strokeW = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));

        if (PARAMS.viewMode === 'multiply') p.blendMode(p.MULTIPLY);

        ctx.save();
        ctx.beginPath();
        ctx.rect(mp, mp, p.width-2*mp, p.height-2*mp);
        ctx.clip();

        whirls.forEach(function(whirl, i) {
            var doMask = PARAMS.overlapMode === 'erase' && i > 0;
            drawCells(whirl, strokeW, doMask);
        });

        ctx.restore();
        p.blendMode(p.BLEND);
        // Redraw on top: 0" margin or full-bleed content can paint
        // edge-to-edge and cover the border drawn at the top of this
        // function -- keep it visible as the top layer.
        paper.drawPaperBorder(p);
    };

    // ---- SVG export ----
    function exportSVG() {
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var mp = paper.getMarginPixels(PARAMS.margin);
        var sw = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
        var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
        var ts = _slug || new Date().toISOString().replace(/[:.]/g,'-');
        var parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="'+dims.width+'" height="'+dims.height+'" viewBox="0 0 '+dims.width+' '+dims.height+'">',
            '<g>'
        ];
        var useBlendGroup = PARAMS.viewMode === 'multiply' && PARAMS.overlapMode !== 'erase';
        if (useBlendGroup) parts.push('<g style="mix-blend-mode:multiply">');

        whirls.forEach(function(whirl, whirlIndex) {
            var clipOutlines = PARAMS.overlapMode === 'erase'
                ? whirls.slice(whirlIndex + 1).map(function(w){ return w.outline; })
                : whirls.filter(function(w){ return w.zIndex > whirl.zIndex; }).map(function(w){ return w.outline; });

            whirl.cells.forEach(function(cell) {
                var color = getCellHex(cell);
                var style = getCellFillStyle(cell);
                var isScatter = style==='sprigFill'||style==='ribbonFill'||style==='crossFill'||style==='asteriskFill';
                if (isScatter) {
                    var sDensity = effectiveHatchDensity();
                    var sSpacing = (paper.DPI/25.4)/sDensity;
                    var sType = style==='sprigFill'?'sprig':style==='ribbonFill'?'ribbon':style==='crossFill'?'cross':'asterisk';
                    plotFills.scatterPolyFill(cell.quad, sType, sSpacing, PARAMS.symbolScale, cell.colorIdx).forEach(function(seg) {
                        var cseg = [{x1:seg.x1,y1:seg.y1,x2:seg.x2,y2:seg.y2}];
                        clipOutlines.forEach(function(ol){var nx=[];cseg.forEach(function(s){Array.prototype.push.apply(nx,clipLineOutsidePoly(s.x1,s.y1,s.x2,s.y2,ol));});cseg=nx;});
                        cseg.forEach(function(s){var cs=clipLineToRect(s.x1,s.y1,s.x2,s.y2,mp,mp,dims.width-2*mp,dims.height-2*mp);if(cs)parts.push('<line x1="'+fmt(cs.x1)+'" y1="'+fmt(cs.y1)+'" x2="'+fmt(cs.x2)+'" y2="'+fmt(cs.y2)+'" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round"/>');});
                    });
                    return;
                }
                var hatchDeg = cell.tangAng*180/Math.PI + 90 + plotFills.getFillAngle();
                var density = effectiveHatchDensity();
                var spacing = (paper.DPI/25.4)/density;
                var phase = (cell.colorIdx % 100000)*0.001;
                if (plotFills.getFillProb() < 1 && ((cell.colorIdx >>> 0) % 997) / 997 >= plotFills.getFillProb()) return;

                if (style === 'contour') {
                    var cnp = cell.innerPts.length;
                    var cwS = Math.hypot(cell.outerPts[0].x-cell.innerPts[0].x, cell.outerPts[0].y-cell.innerPts[0].y);
                    var cwE = Math.hypot(cell.outerPts[cnp-1].x-cell.innerPts[cnp-1].x, cell.outerPts[cnp-1].y-cell.innerPts[cnp-1].y);
                    var cw = (cwS + cwE) * 0.5;
                    var cnL = Math.max(1, Math.round(cw / spacing));
                    var csOff = (cw - (cnL - 1) * spacing) / 2;
                    if (cnL >= 1) {
                        // Collect the raw (unclipped) point sets first so we can check
                        // whether ANY of them cross the margin before picking a path.
                        // The canvas preview is protected by a ctx.clip() around the
                        // whole render (see p.draw()), so this bug was invisible there
                        // -- only the SVG/gcode export was affected. clipOutlines being
                        // empty means "nothing else on top to erase against", NOT "safe
                        // to skip margin clipping" -- those are independent conditions.
                        var cnAllPts = [];
                        for (var ck = 0; ck < cnL; ck++) {
                            var ca = (csOff + ck * spacing) / cw;
                            var cpts = [];
                            for (var cj=0; cj<cnp; cj++) cpts.push({x:cell.innerPts[cj].x+(cell.outerPts[cj].x-cell.innerPts[cj].x)*ca, y:cell.innerPts[cj].y+(cell.outerPts[cj].y-cell.innerPts[cj].y)*ca});
                            cnAllPts.push(cpts);
                        }
                        var needsClip = clipOutlines.length > 0 || cnAllPts.some(function(cpts) {
                            return cpts.some(function(pt) { return pt.x < mp || pt.x > dims.width-mp || pt.y < mp || pt.y > dims.height-mp; });
                        });
                        if (!needsClip) {
                            if (plotFills.isPenLift()) {
                                // Pen-lift: separate path per contour line
                                cnAllPts.forEach(function(cpts) {
                                    var cd='M'+fmt(cpts[0].x)+' '+fmt(cpts[0].y);
                                    for (var cj=1;cj<cpts.length;cj++) cd+=' L'+fmt(cpts[cj].x)+' '+fmt(cpts[cj].y);
                                    parts.push('<path d="'+cd+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round"/>');
                                });
                            } else {
                                // Connected: single serpentine path per cell (pen stays down)
                                var cd = '';
                                cnAllPts.forEach(function(cpts, ck) {
                                    var cfwd = (ck % 2 === 0);
                                    if (cfwd) {
                                        for (var cj=0; cj<cpts.length; cj++) cd += (cd==='' ? 'M' : ' L')+fmt(cpts[cj].x)+' '+fmt(cpts[cj].y);
                                    } else {
                                        for (var cj=cpts.length-1; cj>=0; cj--) cd += (cd==='' ? 'M' : ' L')+fmt(cpts[cj].x)+' '+fmt(cpts[cj].y);
                                    }
                                });
                                if (cd) parts.push('<path d="'+cd+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                            }
                        } else {
                            // Clipped: per-line paths
                            cnAllPts.forEach(function(cpts) {
                                var cclipped=[];
                                for (var cj=0; cj<cpts.length-1; cj++) {
                                    var csegs=[{x1:cpts[cj].x,y1:cpts[cj].y,x2:cpts[cj+1].x,y2:cpts[cj+1].y}];
                                    clipOutlines.forEach(function(ol){var nx=[];csegs.forEach(function(s){Array.prototype.push.apply(nx,clipLineOutsidePoly(s.x1,s.y1,s.x2,s.y2,ol));});csegs=nx;});
                                    csegs.forEach(function(s){var cs=clipLineToRect(s.x1,s.y1,s.x2,s.y2,mp,mp,dims.width-2*mp,dims.height-2*mp);if(cs)cclipped.push(cs);});
                                }
                                if (cclipped.length) {
                                    var cpd='M'+fmt(cclipped[0].x1)+' '+fmt(cclipped[0].y1), clx=cclipped[0].x1, cly=cclipped[0].y1;
                                    cclipped.forEach(function(seg){if(Math.hypot(seg.x1-clx,seg.y1-cly)>0.5)cpd+=' M'+fmt(seg.x1)+' '+fmt(seg.y1);cpd+=' L'+fmt(seg.x2)+' '+fmt(seg.y2);clx=seg.x2;cly=seg.y2;});
                                    parts.push('<path d="'+cpd+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                                }
                            });
                        }
                    }
                    return;
                }

                var cpoly = plotFills.tessellateFlowQuadV2(cell.quad, cell.tangAng, cell.tangAngEnd, paper.DPI/25.4);

                if (style === 'squiggleHatch') {
                    var sr = plotFills.squiggleRows(plotFills.hatchPolyRows(cpoly, hatchDeg, spacing), spacing, phase, spacing*plotFills.getFillImperfection()*0.9);
                    // clipOutlines.length alone isn't the right test -- squiggleConnectedPathD
                    // never applies margin clipping either, so a piece near the paper edge
                    // needs the clipped path below even with nothing to erase against.
                    var srNeedsClip = clipOutlines.length > 0 || sr.some(function(row) {
                        return row.some(function(pc) {
                            return pc.x1 < mp || pc.x1 > dims.width-mp || pc.y1 < mp || pc.y1 > dims.height-mp ||
                                   pc.x2 < mp || pc.x2 > dims.width-mp || pc.y2 < mp || pc.y2 > dims.height-mp;
                        });
                    });
                    var sd = srNeedsClip
                        ? null  // fall through to the clipped path builder below
                        : plotFills.squiggleConnectedPathD(sr);
                    if (sd) {
                        parts.push('<path d="'+sd+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                    } else {
                        plotFills.clippedConnectedPaths(sr, clipOutlines, mp, dims).forEach(function(d) {
                            parts.push('<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                        });
                    }
                    return;
                }
                if (style === 'crosshatch') {
                    [hatchDeg, hatchDeg + 90].forEach(function(deg) {
                        plotFills.clippedConnectedPaths(plotFills.hatchPolyRows(cpoly, deg, spacing), clipOutlines, mp, dims).forEach(function(d) {
                            parts.push('<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                        });
                    });
                    return;
                }
                if (style === 'waves') {
                    // waveConnectedPathD previously only checked points against the
                    // cell's own polygon -- never against other whirls (clipOutlines)
                    // or the paper margin, unlike every other clipped fill style. Now
                    // fixed to take both, same erase-mode inputs as clippedConnectedPaths.
                    var wd = plotFills.waveConnectedPathD(cpoly, hatchDeg, spacing, phase,
                        clipOutlines, { x0: mp, y0: mp, x1: dims.width - mp, y1: dims.height - mp });
                    if (wd) parts.push('<path d="'+wd+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                    return;
                }
                var rows;
                if (style === 'zigzagHatch') {
                    rows = plotFills.zigzagPolyRows(cpoly, hatchDeg, spacing, phase);
                } else if (style === 'sketchHatch') {
                    rows = plotFills.sketchHatchRows(plotFills.hatchPolyRows(cpoly, hatchDeg, spacing), phase, spacing*(0.6+plotFills.getFillImperfection()*1.4));
                } else {
                    rows = plotFills.hatchPolyRows(cpoly, hatchDeg, spacing);
                }
                plotFills.clippedConnectedPaths(rows, clipOutlines, mp, dims).forEach(function(d) {
                    parts.push('<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="'+fmt(sw)+'" stroke-linecap="round" stroke-linejoin="round"/>');
                });
            });

            if (PARAMS.showBorder) {
                whirl.cells.forEach(function(cell) {
                    var q=plotFills.tessellateFlowQuad(cell.quad, cell.tangAng, paper.DPI/25.4);
                    for (var _bi=0; _bi<q.length; _bi++) {
                        var _a=q[_bi], _b=q[(_bi+1)%q.length];
                        var edgeSegs=[{x1:_a.x,y1:_a.y,x2:_b.x,y2:_b.y}];
                        clipOutlines.forEach(function(outline) {
                            var next=[];
                            edgeSegs.forEach(function(seg){ Array.prototype.push.apply(next, clipLineOutsidePoly(seg.x1,seg.y1,seg.x2,seg.y2,outline)); });
                            edgeSegs=next;
                        });
                        edgeSegs.forEach(function(seg) {
                            var _cs=clipLineToRect(seg.x1,seg.y1,seg.x2,seg.y2, mp,mp, dims.width-2*mp, dims.height-2*mp);
                            if (_cs) parts.push('<line x1="'+fmt(_cs.x1)+'" y1="'+fmt(_cs.y1)+'" x2="'+fmt(_cs.x2)+'" y2="'+fmt(_cs.y2)+'" stroke="#000000" stroke-width="'+fmt(sw)+'" stroke-linecap="round"/>');
                        });
                    }
                });
            }
        });

        if (useBlendGroup) parts.push('</g>');
        parts.push('</g></svg>');
        dlSvg(parts.join('\n'), '90percentart-whirls-'+ts+'.svg');
    }

    function fmt(n){ return Number(n).toFixed(3); }

    function dlSvg(str, filename) {
        var blob=new Blob([str],{type:'image/svg+xml;charset=utf-8'});
        var url=URL.createObjectURL(blob);
        var a=document.createElement('a');
        a.href=url; a.download=filename; a.style.display='none';
        document.body.appendChild(a); a.click();
        setTimeout(function(){a.remove(); URL.revokeObjectURL(url);},1000);
    }
};
