// svgUpload.js — pl0tb0t-OS: upload an SVG and lay it out for plotting.
// Big-file safe: NO DOM parsing (DOMParser/querySelectorAll on a 30MB traced
// SVG freezes the JS thread for minutes). Dimensions come from a regex on the
// opening <svg> tag, the body from a string slice, colors from one regex scan,
// and recolor from linear regex replaces. Raster preview is gated by size —
// large files show a layout outline + an on-demand "Render preview".
window.sketches = window.sketches || {};
window.sketches['svgUpload'] = function(p) {
    var paper = window.makeSketchUtils;

    var COLOR_SCAN_MAX    = 80 * 1024 * 1024;  // regex-scan colors under this
    var PREVIEW_PATHS     = 1500;              // auto preview keeps ~this many sampled paths
    var PREVIEW_PATHS_HI  = 6000;              // "Render preview" button = sharper sample
    var PATH_BYTES        = 1470;              // rough bytes-per-path for the sample estimate

    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        palette: ['#000000'],
        fitMode: 'fit',
        scalePct: 100,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        recolor: 'nearest',
        isolate: 'all',   // 'all' = plot every colour; or a lowercased source-colour hex = plot ONLY that layer
        trimXPct: 0,
        trimYPct: 0,
        // Texture Closed Shapes
        textureFill: 'off',
        fillStyle: 'straight',
        fillAngle: 45,
        fillSpacing: 2.5,     // mm on the page
        fillCrosshatch: 'off'
    };

    var closedShapes = null;   // cached parse of fillable closed shapes
    var fillCache = null;      // cached generated fill lines (invalidated on param change)

    var helpEl = null, fileInput = null;
    var svgText = null, svgInner = '', previewOpen = '', previewImg = null, lastPreviewK = 1, previewErr = false, lastPreviewW = 900;
    var svgW = 0, svgH = 0, svgVBX = 0, svgVBY = 0, svgColors = [], svgBytes = 0;
    var detectedTrimX = null, detectedTrimY = null;   // auto-detected from exporter metadata, if any

    // ---- content-box helpers (the fit reference, after trimming baked-in margin) ----
    function contentW() { return svgW * (1 - (Math.min(90, Math.max(0, Number(PARAMS.trimXPct) || 0))) / 100); }
    function contentH() { return svgH * (1 - (Math.min(90, Math.max(0, Number(PARAMS.trimYPct) || 0))) / 100); }
    function setSliderVal(id, val) {
        var el = document.getElementById(id);
        if (el) { el.value = val; var sv = document.getElementById(id + 'Value'); if (sv) sv.textContent = String(val); }
        var pdef = api.params.find(function(x) { return x.id === id; });
        if (pdef) pdef.value = val;
    }

    // ---- helpers ----------------------------------------------------------
    function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function hexToRgb(c) {
        c = String(c || '').trim().toLowerCase();
        var m = /^#([0-9a-f]{3})$/.exec(c);
        if (m) { var h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]; }
        m = /^#([0-9a-f]{6})$/.exec(c);
        if (m) return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
        m = /rgba?\(([^)]+)\)/.exec(c);
        if (m) { var a = m[1].split(',').map(function(x) { return parseInt(x, 10) || 0; }); return [a[0] || 0, a[1] || 0, a[2] || 0]; }
        if (c === 'white') return [255, 255, 255];
        return [0, 0, 0];
    }
    function nearestPen(hex, pens) {
        if (!pens.length) return '#000000';
        var t = hexToRgb(hex), best = pens[0], bd = 1e9;
        for (var i = 0; i < pens.length; i++) {
            var r = hexToRgb(pens[i]);
            var d = (r[0] - t[0]) * (r[0] - t[0]) + (r[1] - t[1]) * (r[1] - t[1]) + (r[2] - t[2]) * (r[2] - t[2]);
            if (d < bd) { bd = d; best = pens[i]; }
        }
        return best;
    }
    function selectedPens() {
        var v = PARAMS.palette;
        return (Array.isArray(v) && v.length) ? v.slice() : ['#000000'];
    }
    function strokePxFor(hex) {
        var w = (window.plotPens && window.plotPens.widthFor) ? window.plotPens.widthFor(hex) : null;
        return w ? Math.max(0.4, paper.mmToPixels(w)) : Math.max(0.6, paper.mmToPixels(0.4));
    }

    // ===================================================================
    // Texture Closed Shapes — hatch-fill closed shapes in the uploaded SVG.
    // Approach: extract each closed shape as flattened polygons (subpaths),
    // then generate hatch lines with a SAMPLED scanline. At each sample the
    // "topmost" closed shape containing the point owns it (later in document
    // order wins), so an inner shape on top punches a hole in the one below
    // -- which is exactly how a fill='none' inner border leaves an empty
    // ring in the shape beneath it. Robust to any overlap without polygon
    // boolean math. v1 applies a shape's OWN transform attribute; shapes
    // nested inside transformed <g> groups are a known limitation.
    // ===================================================================
    function parseTransform(str) {
        // returns a 2x3 affine [a,b,c,d,e,f] mapping (x,y)->(a*x+c*y+e, b*x+d*y+f)
        var m = [1, 0, 0, 1, 0, 0];
        if (!str) return m;
        var re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi, t;
        function mul(A, B) {
            return [A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1],
                    A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3],
                    A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5]];
        }
        while ((t = re.exec(str)) !== null) {
            var fn = t[1].toLowerCase(), a = t[2].split(/[\s,]+/).map(parseFloat).filter(function(n){return !isNaN(n);});
            if (fn === 'matrix' && a.length === 6) m = mul(m, a);
            else if (fn === 'translate') m = mul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
            else if (fn === 'scale') m = mul(m, [a[0] || 1, 0, 0, (a.length > 1 ? a[1] : a[0]) || 1, 0, 0]);
            else if (fn === 'rotate') {
                var r = (a[0] || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
                if (a.length >= 3) { m = mul(m, [1,0,0,1,a[1],a[2]]); m = mul(m, [cs,sn,-sn,cs,0,0]); m = mul(m, [1,0,0,1,-a[1],-a[2]]); }
                else m = mul(m, [cs, sn, -sn, cs, 0, 0]);
            }
        }
        return m;
    }
    function applyM(m, x, y) { return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]]; }

    function flattenPathD(d) {
        // Parse an SVG path 'd' into an array of subpolygons (each [[x,y],...]).
        // Supports M m L l H h V v C c Q q Z z; arcs (A) fall back to a line to
        // the endpoint. Beziers flattened at a fixed subdivision.
        var subs = [], cur = [], x = 0, y = 0, sx = 0, sy = 0;
        var toks = d.match(/[MmLlHhVvCcQqAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
        if (!toks) return subs;
        var i = 0, cmd = '';
        function num() { return parseFloat(toks[i++]); }
        function bez(p0, p1, p2, p3) {
            var N = 10;
            for (var k = 1; k <= N; k++) {
                var t = k / N, u = 1 - t;
                var bx = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0];
                var by = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1];
                cur.push([bx, by]);
            }
        }
        function quad(p0, p1, p2) {
            var N = 8;
            for (var k = 1; k <= N; k++) {
                var t = k / N, u = 1 - t;
                cur.push([u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]]);
            }
        }
        while (i < toks.length) {
            var tk = toks[i];
            if (/[MmLlHhVvCcQqAaZz]/.test(tk)) { cmd = tk; i++; }
            var rel = (cmd === cmd.toLowerCase());
            var C = cmd.toUpperCase();
            if (C === 'M') { if (cur.length) subs.push(cur); cur = []; var nx = num(), ny = num(); if (rel) { x += nx; y += ny; } else { x = nx; y = ny; } sx = x; sy = y; cur.push([x, y]); cmd = rel ? 'l' : 'L'; }
            else if (C === 'L') { var lx = num(), ly = num(); if (rel) { x += lx; y += ly; } else { x = lx; y = ly; } cur.push([x, y]); }
            else if (C === 'H') { var hx = num(); x = rel ? x + hx : hx; cur.push([x, y]); }
            else if (C === 'V') { var vy = num(); y = rel ? y + vy : vy; cur.push([x, y]); }
            else if (C === 'C') { var c1x=num(),c1y=num(),c2x=num(),c2y=num(),ex=num(),ey=num(); var p0=[x,y]; if(rel){c1x+=x;c1y+=y;c2x+=x;c2y+=y;ex+=x;ey+=y;} bez(p0,[c1x,c1y],[c2x,c2y],[ex,ey]); x=ex; y=ey; }
            else if (C === 'Q') { var q1x=num(),q1y=num(),ex2=num(),ey2=num(); var pp0=[x,y]; if(rel){q1x+=x;q1y+=y;ex2+=x;ey2+=y;} quad(pp0,[q1x,q1y],[ex2,ey2]); x=ex2; y=ey2; }
            else if (C === 'A') { num();num();num();num();num(); var ax=num(),ay=num(); if(rel){x+=ax;y+=ay;}else{x=ax;y=ay;} cur.push([x,y]); }
            else if (C === 'Z') { if (cur.length) { cur.push([sx, sy]); subs.push(cur); cur = []; } x = sx; y = sy; }
            else { i++; }
        }
        if (cur.length) subs.push(cur);
        return subs;
    }
    function ellipsePoly(cx, cy, rx, ry) {
        var pts = [], N = 48;
        for (var k = 0; k <= N; k++) { var a = k / N * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
        return pts;
    }
    function attrNum(tag, name) { var m = new RegExp('\\b' + name + '\\s*=\\s*["\']?\\s*(-?[\\d.]+)', 'i').exec(tag); return m ? parseFloat(m[1]) : 0; }
    function attrStr(tag, name) { var m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? (m[1] != null ? m[1] : m[2]) : ''; }
    function fillOf(tag) {
        var st = attrStr(tag, 'style');
        var m = /fill\s*:\s*([^;]+)/i.exec(st);
        var f = m ? m[1].trim() : attrStr(tag, 'fill');
        return (f || '').toLowerCase();
    }

    function extractClosedShapes(inner) {
        // Regex-scan for closed shape elements in document order (big-file safe:
        // no DOM). Each -> { polys:[[[x,y]...]...], fill, order }. Transform is
        // the shape's own transform attr (v1 limitation: not group ancestors).
        var shapes = [], order = 0;
        var elRe = /<(path|rect|circle|ellipse|polygon|polyline)\b([^>]*?)\/?>/gi, m;
        while ((m = elRe.exec(inner)) !== null && shapes.length < 4000) {
            var tag = m[1].toLowerCase(), attrs = m[2];
            var full = '<' + tag + attrs + '>';
            var tf = parseTransform(attrStr(full, 'transform'));
            var fill = fillOf(full);
            var polys = [];
            if (tag === 'path') {
                var d = attrStr(full, 'd');
                if (d && /[Zz]/.test(d)) polys = flattenPathD(d);   // only closed paths fill
            } else if (tag === 'rect') {
                var rx = attrNum(full, 'x'), ry = attrNum(full, 'y'), rw = attrNum(full, 'width'), rh = attrNum(full, 'height');
                if (rw > 0 && rh > 0) polys = [[[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh], [rx, ry]]];
            } else if (tag === 'circle') {
                var ccx = attrNum(full, 'cx'), ccy = attrNum(full, 'cy'), cr = attrNum(full, 'r');
                if (cr > 0) polys = [ellipsePoly(ccx, ccy, cr, cr)];
            } else if (tag === 'ellipse') {
                var ecx = attrNum(full, 'cx'), ecy = attrNum(full, 'cy'), erx = attrNum(full, 'rx'), ery = attrNum(full, 'ry');
                if (erx > 0 && ery > 0) polys = [ellipsePoly(ecx, ecy, erx, ery)];
            } else if (tag === 'polygon' || tag === 'polyline') {
                var ptsStr = attrStr(full, 'points'), nums = ptsStr.split(/[\s,]+/).map(parseFloat).filter(function(n){return !isNaN(n);});
                var poly = [];
                for (var k = 0; k + 1 < nums.length; k += 2) poly.push([nums[k], nums[k + 1]]);
                if (poly.length >= 3) { if (tag === 'polygon') poly.push(poly[0]); polys = [poly]; }
            }
            if (polys.length) {
                // apply the element's own transform
                if (tf[0] !== 1 || tf[1] !== 0 || tf[2] !== 0 || tf[3] !== 1 || tf[4] !== 0 || tf[5] !== 0) {
                    polys = polys.map(function(pl) { return pl.map(function(pt) { return applyM(tf, pt[0], pt[1]); }); });
                }
                shapes.push({ polys: polys, fill: fill, order: order++ });
            }
        }
        return shapes;
    }

    function pointInShape(shape, x, y) {
        // even-odd across the shape's subpolys (handles donuts/holes within a shape)
        var inside = false;
        for (var s = 0; s < shape.polys.length; s++) {
            var pl = shape.polys[s];
            for (var i = 0, j = pl.length - 1; i < pl.length; j = i++) {
                var xi = pl[i][0], yi = pl[i][1], xj = pl[j][0], yj = pl[j][1];
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
            }
        }
        return inside;
    }
    function shapesBBox(shapes) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        shapes.forEach(function(sh) { sh.polys.forEach(function(pl) { pl.forEach(function(pt) {
            if (pt[0] < x0) x0 = pt[0]; if (pt[0] > x1) x1 = pt[0];
            if (pt[1] < y0) y0 = pt[1]; if (pt[1] > y1) y1 = pt[1];
        }); }); });
        return { x0: x0, y0: y0, x1: x1, y1: y1 };
    }

    // Generate hatch fill segments (in SVG user space) for the closed shapes.
    // spacingSvg / stepSvg are in SVG units (already converted from mm/scale).
    // Returns [{ color, pts:[[x,y],[x,y]] }, ...].
    function generateFill(shapes, angleDeg, spacingSvg, stepSvg, crosshatch, defaultColor) {
        var fillable = shapes.filter(function(s) { return s.fill && s.fill !== 'none'; });
        if (!fillable.length) return [];
        var bb = shapesBBox(shapes);
        if (!isFinite(bb.x0)) return [];
        var segs = [];
        function ownerAt(x, y) {
            // topmost shape containing (x,y); returns shape or null
            for (var k = shapes.length - 1; k >= 0; k--) { if (pointInShape(shapes[k], x, y)) return shapes[k]; }
            return null;
        }
        function pass(angDeg) {
            var rad = angDeg * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad), nx = -dy, ny = dx;
            var cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
            var diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2 + spacingSvg;
            var nLines = Math.ceil((2 * diag) / spacingSvg);
            for (var li = -nLines; li <= nLines; li++) {
                var ox = cx + nx * li * spacingSvg, oy = cy + ny * li * spacingSvg;
                var curSeg = null, curColor = null;
                for (var t = -diag; t <= diag; t += stepSvg) {
                    var px = ox + dx * t, py = oy + dy * t;
                    var owner = ownerAt(px, py);
                    var on = owner && owner.fill && owner.fill !== 'none';
                    if (on) {
                        var col = owner.fill;
                        if (curSeg && curColor === col) curSeg.push([px, py]);
                        else { if (curSeg && curSeg.length >= 2) segs.push({ color: curColor, pts: curSeg }); curSeg = [[px, py]]; curColor = col; }
                    } else if (curSeg) { if (curSeg.length >= 2) segs.push({ color: curColor, pts: curSeg }); curSeg = null; curColor = null; }
                }
                if (curSeg && curSeg.length >= 2) segs.push({ color: curColor, pts: curSeg });
            }
        }
        pass(angleDeg);
        if (crosshatch) pass(angleDeg + 90);
        return segs;
    }

    function ensureClosedShapes() {
        if (closedShapes === null && svgInner) {
            try { closedShapes = extractClosedShapes(svgInner); } catch (e) { closedShapes = []; console.error('extractClosedShapes failed', e); }
        }
        return closedShapes || [];
    }
    // Build fill segments for the current layout, recolored onto pens, in SVG
    // user space (so they wrap in the same transform as the artwork).
    function buildFillSegs(L) {
        if (PARAMS.textureFill !== 'on') return [];
        var shapes = ensureClosedShapes();
        if (!shapes.length) return [];
        var pens = selectedPens();
        var scale = (L && L.scale > 0) ? L.scale : 1;
        // target mm spacing on page -> SVG units (divide by layout scale)
        var spacingSvg = Math.max(0.3, paper.mmToPixels(Math.max(0.5, PARAMS.fillSpacing)) / scale);
        var stepSvg = Math.max(spacingSvg / 6, spacingSvg * 0.25);
        var raw = generateFill(shapes, Number(PARAMS.fillAngle) || 0, spacingSvg, stepSvg, PARAMS.fillCrosshatch === 'on', pens[0] || '#000000');
        // "Draw only" isolate: drop fill for every source colour except the soloed one
        if (isolateActive()) raw = raw.filter(function(seg) { return (seg.color || '').toLowerCase() === PARAMS.isolate; });
        // recolor each segment's source fill onto a pen
        raw.forEach(function(seg) {
            if (PARAMS.recolor === 'single') seg.pen = pens[0] || '#000000';
            else if (PARAMS.recolor === 'nearest') seg.pen = nearestPen(seg.color, pens);
            else seg.pen = seg.color || (pens[0] || '#000000');
        });
        return raw;
    }
    function invalidateFill() { fillCache = null; }
    // Cached fill for the on-screen preview (recomputed only when a fill-
    // affecting param changed -- generateFill is a sampled pass, too heavy to
    // run every redraw frame).
    function getFillForDraw(L) {
        if (PARAMS.textureFill !== 'on') return [];
        if (fillCache && fillCache.scale === L.scale) return fillCache.segs;
        var segs = buildFillSegs(L);
        fillCache = { scale: L.scale, segs: segs };
        return segs;
    }

    function parseSvg(txt) {
        svgW = 0; svgH = 0; svgVBX = 0; svgVBY = 0; svgInner = ''; svgColors = []; previewOpen = '';
        detectedTrimX = null; detectedTrimY = null;
        closedShapes = null; fillCache = null;
        var m = /<svg\b[^>]*>/i.exec(txt);
        var open = m ? m[0] : '';
        var vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(open);
        if (vb) { var a = vb[1].split(/[\s,]+/).map(Number); if (a.length === 4) { svgVBX = a[0]; svgVBY = a[1]; svgW = a[2]; svgH = a[3]; } }
        // Width/height fallback (no viewBox): CONVERT UNITS to user-space px.
        // Bug this fixes: "9.0in" was parsed as 9 user units, but the actual
        // path coordinates live in a 96dpi px space (9in = 864px). Treating
        // the drawing as 9 units wide while its content sits at ~100-1000
        // scaled the whole thing ~96x off the page, so vpype clipped it away
        // and the plot produced an empty/failed layer. Without a viewBox the
        // SVG user unit IS the CSS px, so unit-converting the declared size
        // recovers the correct content-space dimensions.
        function _lenToPx(numStr, unitStr) {
            var v = parseFloat(numStr) || 0;
            var u = String(unitStr || '').toLowerCase();
            var f = { 'in': 96, 'cm': 37.795275591, 'mm': 3.779527559, 'pt': 1.3333333, 'pc': 16, 'px': 1, '': 1 }[u];
            return v * (f || 1);
        }
        if (!svgW) { var w = /\bwidth\s*=\s*["']?\s*([\d.]+)\s*(in|cm|mm|pt|pc|px|%)?/i.exec(open); if (w && w[2] !== '%') svgW = _lenToPx(w[1], w[2]); }
        if (!svgH) { var h = /\bheight\s*=\s*["']?\s*([\d.]+)\s*(in|cm|mm|pt|pc|px|%)?/i.exec(open); if (h && h[2] !== '%') svgH = _lenToPx(h[1], h[2]); }
        if (!svgW) svgW = 100;
        if (!svgH) svgH = 100;
        var start = m ? (m.index + m[0].length) : 0;
        // Closing tag may have whitespace/newlines before '>' (seen in
        // DrawingBotV3 exports: "</svg\n>") -- a literal lastIndexOf('</svg>')
        // finds nothing there, silently swallowing the real close into svgInner.
        var end = -1;
        var closeRe = /<\/svg\s*>/gi, cm;
        while ((cm = closeRe.exec(txt)) !== null) { end = cm.index; }
        svgInner = (end > start) ? txt.slice(start, end) : txt.slice(start);
        // Some exporters (e.g. DrawingBotV3) bake a "Page Size" bigger than the
        // actual "Drawing Size" as intentional physical-paper margin, right in a
        // header comment. Detect it and pre-fill the trim so Manual 100% means
        // "the ink fills the target box" out of the box; still overridable below.
        var head = txt.slice(0, 6000);
        var dbv3 = /Page Size:\s*([\d.]+)\s*in\s*x\s*([\d.]+)\s*in[\s\S]{0,80}?Drawing Size:\s*([\d.]+)\s*in\s*x\s*([\d.]+)\s*in/i.exec(head);
        if (dbv3) {
            var pageW = parseFloat(dbv3[1]), pageH = parseFloat(dbv3[2]), drawW = parseFloat(dbv3[3]), drawH = parseFloat(dbv3[4]);
            if (pageW > 0 && pageH > 0 && drawW > 0 && drawH > 0) {
                detectedTrimX = Math.min(45, Math.max(0, Math.round((1 - drawW / pageW) * 100)));
                detectedTrimY = Math.min(45, Math.max(0, Math.round((1 - drawH / pageH) * 100)));
            }
        }
        if (txt.length <= COLOR_SCAN_MAX) {
            var seen = {}, re = /stroke\s*(?::|=\s*["'])\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)|[a-zA-Z]+)/g, mm, cnt = 0;
            while ((mm = re.exec(txt)) !== null && cnt < 64) {
                var c = mm[1].trim().toLowerCase();
                if (c && c !== 'none' && !seen[c]) { seen[c] = 1; svgColors.push(c); cnt++; }
            }
        }
        // opening tag with explicit width/height for reliable rasterization
        previewOpen = open.replace(/\swidth\s*=\s*["'][^"']*["']/i, '').replace(/\sheight\s*=\s*["'][^"']*["']/i, '')
                          .replace(/<svg/i, '<svg width="' + svgW + '" height="' + svgH + '"');
    }

    // Preview is rendered ON THE PI by rsvg-convert (native/fast) via the queue
    // server's /rasterize endpoint — the browser can't rasterize millions of
    // dense vector points. We POST the full SVG (same local path that already
    // ships plot SVGs) and display the returned PNG. width = px of the raster.
    function buildPreview(width) {
        previewImg = null;
        if (!svgText) { p.redraw(); return; }
        var base = window.QUEUE_URL || 'http://localhost:5001';
        var headers = { 'Content-Type': 'application/json' };
        if (window.QUEUE_API_KEY) headers['X-API-Key'] = window.QUEUE_API_KEY;
        lastPreviewK = 0;   // server renders the full art
        lastPreviewW = width || 900;
        previewErr = false;
        fetch(base + '/rasterize?w=' + (width || 900), { method: 'POST', headers: headers, body: JSON.stringify({ svg: recoloredSvgTextForPreview() }) })
            .then(function(r) { if (!r.ok) throw new Error('raster ' + r.status); return r.blob(); })
            .then(function(blob) {
                var u = URL.createObjectURL(blob);
                p.loadImage(u, function(img) { previewImg = img; try { URL.revokeObjectURL(u); } catch (e) {} updateHelp(); p.redraw(); },
                    function() { previewImg = null; previewErr = true; updateHelp(); p.redraw(); });
            })
            .catch(function(e) { previewImg = null; previewErr = true; updateHelp(); p.redraw(); });
    }

    function setSvg(txt) {
        svgText = txt;
        svgBytes = txt.length;
        parseSvg(txt);
        // New file has its own colour set — a "Draw only" pick from the previous
        // file is meaningless (or would silently drop everything). Reset to All.
        PARAMS.isolate = 'all';
        // Pre-fill the margin trim from detected exporter metadata (still a
        // manual override below); reset to 0 for files without it.
        PARAMS.trimXPct = detectedTrimX != null ? detectedTrimX : 0;
        PARAMS.trimYPct = detectedTrimY != null ? detectedTrimY : 0;
        setSliderVal('trimXPct', PARAMS.trimXPct);
        setSliderVal('trimYPct', PARAMS.trimYPct);
        previewImg = null;
        previewErr = false;
        updateHelp();
        p.redraw();
        // defer so the outline paints first, then the Pi renders the preview
        setTimeout(function() { buildPreview(900); }, 30);
        // New file \u2014 Skip Layers / Color Mapping read svgColors, which
        // parseSvg() just refreshed above. Neither goes through a full
        // param-UI rebuild on upload, so refresh them directly here too.
        if (typeof window._pl0tRenderSkipPanel === 'function') window._pl0tRenderSkipPanel();
        renderColorMap(document.getElementById('svgColorMapWrap'));
    }

    function handleFile(file) {
        if (helpEl) helpEl.textContent = 'Reading ' + file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB)…';
        var reader = new FileReader();
        reader.onload = function(e) { setSvg(String(e.target.result)); };
        reader.onerror = function() { if (helpEl) helpEl.textContent = 'Could not read file.'; };
        reader.readAsText(file);
    }

    function updateHelp() {
        if (!helpEl) return;
        if (!svgText) { helpEl.textContent = 'Upload an SVG, then position / scale / rotate it and map its colors onto your pens.'; return; }
        var mb = (svgBytes / 1048576).toFixed(1);
        var t = 'Loaded: ' + Math.round(svgW) + '×' + Math.round(svgH) + ' units, ' + mb + ' MB, ' +
            svgColors.length + ' color' + (svgColors.length === 1 ? '' : 's') + '.';
        if (detectedTrimX != null) t += ' Detected a baked-in margin — auto-trimmed ' + detectedTrimX + '%/' + detectedTrimY + '% (X/Y); adjust in Trim margin below if needed.';
        if (previewErr) t += ' Preview render unavailable (queue server) — layout via the outline; plot still works.';
        else if (previewImg) t += ' Preview rendered on the Pi — reflects your current Recolor/Pens choice. “Render preview” = sharper.';
        else t += ' Rendering preview on the Pi…';
        helpEl.textContent = t;
    }

    function layout() {
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var mgn = paper.getMarginPixels(PARAMS.margin);
        var innerW = dims.width - 2 * mgn, innerH = dims.height - 2 * mgn;
        var rot = Number(PARAMS.rotation) || 0, rad = rot * Math.PI / 180;
        var cw = contentW(), ch = contentH();
        var aw = Math.abs(cw * Math.cos(rad)) + Math.abs(ch * Math.sin(rad));
        var ah = Math.abs(cw * Math.sin(rad)) + Math.abs(ch * Math.cos(rad));
        var scale;
        if (PARAMS.fitMode === 'fit') scale = Math.min(innerW / aw, innerH / ah);
        else if (PARAMS.fitMode === 'width') scale = innerW / aw;
        else scale = (Number(PARAMS.scalePct) || 100) / 100;
        if (!(scale > 0) || !isFinite(scale)) scale = 1;
        var cx = mgn + innerW / 2 + paper.mmToPixels(Number(PARAMS.offsetX) || 0);
        var cy = mgn + innerH / 2 + paper.mmToPixels(Number(PARAMS.offsetY) || 0);
        return { dims: dims, cx: cx, cy: cy, scale: scale, rot: rot };
    }

    function transformStr(L) {
        return 'translate(' + L.cx.toFixed(2) + ',' + L.cy.toFixed(2) + ') rotate(' + L.rot + ') scale(' + L.scale.toFixed(5) + ') ' +
               'translate(' + (-(svgVBX + svgW / 2)).toFixed(2) + ',' + (-(svgVBY + svgH / 2)).toFixed(2) + ')';
    }

    function recoloredSvgTextForPreview() {
        // Mirrors recoloredGroup()'s per-color substitution but applied to the
        // full document (not wrapped in a plot <g>), so the rasterized PI
        // preview shows exactly what "single"/"nearest" will actually draw.
        // "original" leaves svgText untouched \u2014 that mode's whole point is
        // to keep the SVG's own colors, so there's nothing to remap.
        if (!svgText) return svgText;
        if (isolateActive()) return isolatedGroup(null, true);
        var mode = PARAMS.recolor, pens = selectedPens();
        if (mode === 'single') {
            var col = pens[0] || '#000000', sw = strokePxFor(col).toFixed(2);
            var stripped = svgInner
                .replace(/\sstroke\s*=\s*("[^"]*"|'[^']*')/gi, '')
                .replace(/\sfill\s*=\s*("[^"]*"|'[^']*')/gi, '')
                .replace(/\sstroke-width\s*=\s*("[^"]*"|'[^']*')/gi, '')
                .replace(/stroke\s*:\s*[^;"']*;?/gi, '')
                .replace(/fill\s*:\s*[^;"']*;?/gi, '');
            return previewOpen + '<g stroke="' + col + '" fill="none" stroke-width="' + sw + '" stroke-linecap="round">' + stripped + '</g></svg>';
        }
        if (mode === 'nearest' && svgColors.length) {
            var out = svgInner;
            svgColors.forEach(function(c) {
                var np = nearestPen(c, pens), e = escapeRe(c);
                out = out.replace(new RegExp('stroke\\s*=\\s*"\\s*' + e + '\\s*"', 'gi'), 'stroke="' + np + '"');
                out = out.replace(new RegExp("stroke\\s*=\\s*'\\s*" + e + "\\s*'", 'gi'), "stroke='" + np + "'");
                out = out.replace(new RegExp('stroke\\s*:\\s*' + e, 'gi'), 'stroke:' + np);
            });
            return previewOpen + '<g fill="none">' + out + '</g></svg>';
        }
        return svgText;
    }

    function _pl0tResolvePenFor(c, mode, pens) {
        if (mode === 'single') return pens[0] || '#000000';
        if (mode === 'nearest') return nearestPen(c, pens);
        return c;   // 'original' — kept as-is
    }

    // "Draw only" isolate: is one specific source colour soloed right now?
    function isolateActive() {
        return PARAMS.isolate && PARAMS.isolate !== 'all'
            && svgColors.map(function(c){ return c.toLowerCase(); }).indexOf(PARAMS.isolate) !== -1;
    }
    // Build a plot <g> that draws ONLY the isolated source colour, recoloured
    // onto the pen the current Recolor mode would give it; every other source
    // colour's stroke is rewritten to "none" so it doesn't plot. Reuses the same
    // per-colour regex-replace machinery the "nearest" path already relies on
    // (each entry in svgColors was scanned FROM a real stroke token, so these
    // replaces hit every drawable stroke) -- big-file safe, no DOM parse.
    function isolatedGroup(L, forPreview) {
        var pens = selectedPens();
        var iso = PARAMS.isolate;
        var penCol = _pl0tResolvePenFor(iso, PARAMS.recolor, pens);
        var out = svgInner;
        // Two-phase to avoid a recolor collision: if the isolate colour resolves
        // onto a pen that is ALSO one of the file's own source colours (e.g. solo
        // cyan drawn with a black pen, in a file that also has black strokes), a
        // single-pass "cyan->black, black->none" loop would re-blank the cyan we
        // just recoloured. Phase 1 swaps every source stroke for a unique,
        // non-colour sentinel; phase 2 resolves sentinels (isolate->pen, rest->none).
        svgColors.forEach(function(c, i) {
            var e = escapeRe(c), s = '__PL0TISO' + i + '__';
            out = out.replace(new RegExp('stroke\\s*=\\s*"\\s*' + e + '\\s*"', 'gi'), 'stroke="' + s + '"');
            out = out.replace(new RegExp("stroke\\s*=\\s*'\\s*" + e + "\\s*'", 'gi'), "stroke='" + s + "'");
            out = out.replace(new RegExp('stroke\\s*:\\s*' + e, 'gi'), 'stroke:' + s);
        });
        svgColors.forEach(function(c, i) {
            var repl = (c.toLowerCase() === iso) ? penCol : 'none';
            out = out.split('__PL0TISO' + i + '__').join(repl);
        });
        var sw = strokePxFor(penCol).toFixed(2);
        if (forPreview) return previewOpen + '<g fill="none" stroke-width="' + sw + '">' + out + '</g></svg>';
        return '<g transform="' + transformStr(L) + '" fill="none" stroke-width="' + sw + '">' + out + '</g>';
    }

    function renderColorMap(wrap) {
        if (!wrap) return;
        if (!svgText || !svgColors.length) { wrap.innerHTML = ''; return; }
        var mode = PARAMS.recolor, pens = selectedPens();
        var skip = (window._pl0tSkippedLayers || []).map(function(c) { return String(c).toLowerCase(); });
        var modeLabel = mode === 'single' ? 'Single pen' : mode === 'nearest' ? 'Nearest pen' : 'Kept as-is';
        var iso = isolateActive() ? PARAMS.isolate : 'all';

        // "Draw only" selector \u2014 the clear, direct way to plot a single source
        // colour without fighting the palette/recolor interaction. Lives here (not
        // as a static param row) because its options are the just-uploaded file's
        // own colours, which change per file.
        var drawOnly = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">'
            + '<span style="font-size:11px;font-weight:600;color:#555;">Draw only:</span>'
            + '<select id="svgIsolateSel" style="font-size:11px;flex:1;">'
            + '<option value="all"' + (iso === 'all' ? ' selected' : '') + '>All colours</option>'
            + svgColors.map(function(c) {
                var cl = c.toLowerCase();
                return '<option value="' + cl + '"' + (iso === cl ? ' selected' : '') + '>' + c + '</option>';
            }).join('')
            + '</select></div>';

        var rows = svgColors.map(function(c) {
            var cl = c.toLowerCase();
            var resolved = _pl0tResolvePenFor(c, mode, pens);
            var mutedByIso = (iso !== 'all' && cl !== iso);
            var isSkipped = !mutedByIso && skip.indexOf(String(resolved).toLowerCase()) !== -1;
            var note = mutedByIso ? 'muted \u2014 Draw only is on'
                     : isSkipped ? 'skipped \u2014 will not plot'
                     : (iso !== 'all' ? 'DRAW ONLY \u2014 plots' : modeLabel);
            return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;' + (mutedByIso || isSkipped ? 'opacity:0.4;' : '') + '">'
                + '<div style="width:16px;height:16px;border-radius:3px;border:1px solid #ccc;background:' + c + ';flex-shrink:0;"></div>'
                + '<span style="font-size:11px;color:#999;">&rarr;</span>'
                + '<div style="width:16px;height:16px;border-radius:3px;border:1px solid #ccc;background:' + resolved + ';flex-shrink:0;"></div>'
                + '<span style="font-size:11px;color:' + (iso !== 'all' && cl === iso ? '#1a7f37' : '#666') + ';font-weight:' + (iso !== 'all' && cl === iso ? '700' : '400') + ';">' + note + '</span>'
                + '</div>';
        }).join('');

        // Collapse warning \u2014 the exact footgun: a multi-colour file, Recolor =
        // "Snap to nearest", but the selected pens resolve every colour onto a
        // SINGLE pen, so the whole drawing silently prints in one colour.
        var warn = '';
        if (iso === 'all' && mode === 'nearest' && svgColors.length > 1) {
            var resolvedSet = {};
            svgColors.forEach(function(c) { resolvedSet[String(_pl0tResolvePenFor(c, mode, pens)).toLowerCase()] = 1; });
            if (Object.keys(resolvedSet).length === 1) {
                var onePen = _pl0tResolvePenFor(svgColors[0], mode, pens);
                warn = '<div style="font-size:11px;color:#8a5a00;background:#fff6e5;border:1px solid #f0d089;border-radius:5px;padding:6px 8px;margin-bottom:8px;line-height:1.4;">'
                    + '\u26a0 All ' + svgColors.length + ' colours will draw with one pen (<b>' + onePen + '</b>) \u2014 the whole drawing prints in that colour. '
                    + 'To keep colours apart, select more pens in <b>Pens (colors)</b> or switch <b>Recolor</b> to \u201cKeep original\u201d. '
                    + 'To plot just one colour, use <b>Draw only</b> above.</div>';
            }
        }

        wrap.innerHTML = '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:4px;">Colour Mapping</div>'
            + '<div style="font-size:11px;color:#777;margin-bottom:8px;">Each colour found in the uploaded SVG, and the pen it will draw with. Use <b>Draw only</b> to plot a single colour on its own.</div>'
            + drawOnly + warn + rows;

        var sel = document.getElementById('svgIsolateSel');
        if (sel) sel.addEventListener('change', function() { setIsolate(this.value); });
    }

    // Central handler for the "Draw only" selector: update state, invalidate the
    // fill cache, refresh the Pi preview + Skip panel + this panel, and redraw.
    function setIsolate(val) {
        PARAMS.isolate = (val === 'all') ? 'all' : String(val).toLowerCase();
        invalidateFill();
        if (window._pl0tRecolorPreviewTimer) clearTimeout(window._pl0tRecolorPreviewTimer);
        window._pl0tRecolorPreviewTimer = setTimeout(function() { buildPreview(lastPreviewW); }, 250);
        if (typeof window._pl0tRenderSkipPanel === 'function') window._pl0tRenderSkipPanel();
        renderColorMap(document.getElementById('svgColorMapWrap'));
        p.redraw();
    }

    function recoloredGroup(L) {
        if (!svgText) return '';
        if (isolateActive()) return isolatedGroup(L, false);
        var t = transformStr(L), mode = PARAMS.recolor, pens = selectedPens();
        if (mode === 'single') {
            var col = pens[0] || '#000000', sw = strokePxFor(col).toFixed(2);
            var stripped = svgInner
                .replace(/\sstroke\s*=\s*("[^"]*"|'[^']*')/gi, '')
                .replace(/\sfill\s*=\s*("[^"]*"|'[^']*')/gi, '')
                .replace(/\sstroke-width\s*=\s*("[^"]*"|'[^']*')/gi, '')
                .replace(/stroke\s*:\s*[^;"']*;?/gi, '')
                .replace(/fill\s*:\s*[^;"']*;?/gi, '');
            return '<g transform="' + t + '" stroke="' + col + '" fill="none" stroke-width="' + sw + '" stroke-linecap="round">' + stripped + '</g>';
        }
        if (mode === 'nearest' && svgColors.length) {
            var out = svgInner;
            svgColors.forEach(function(c) {
                var np = nearestPen(c, pens), e = escapeRe(c);
                out = out.replace(new RegExp('stroke\\s*=\\s*"\\s*' + e + '\\s*"', 'gi'), 'stroke="' + np + '"');
                out = out.replace(new RegExp("stroke\\s*=\\s*'\\s*" + e + "\\s*'", 'gi'), "stroke='" + np + "'");
                out = out.replace(new RegExp('stroke\\s*:\\s*' + e, 'gi'), 'stroke:' + np);
            });
            return '<g transform="' + t + '" fill="none">' + out + '</g>';
        }
        return '<g transform="' + t + '">' + svgInner + '</g>';
    }

    var api = {
        presetLabel: 'Quick setup',
        presetHelp: 'Pick a starting point, then fine-tune below. This just sets Sizing + Recolor together — it does not choose which colours plot.',
        stylePresets: [
            { label: 'One pen — draw everything in a single colour', values: { fitMode: 'fit', recolor: 'single', rotation: 0 } },
            { label: 'Multi-colour — map each colour to its own pen', values: { fitMode: 'fit', recolor: 'nearest', rotation: 0 } },
            { label: "Keep the file's own colours as separate layers", values: { fitMode: 'fit', recolor: 'original', rotation: 0 } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'palette', label: 'Pens (colors)', type: 'colorPalette', maxSelect: 8, group: 'color',
              tip: 'Target pens the artwork is recolored onto. Single pen uses the first selected; Nearest maps each SVG color to the closest selected pen.',
              value: ['#000000'],
              options: [
                { value: '#000000', label: 'Black' }, { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' }, { value: '#ffff00', label: 'Yellow' },
                { value: '#ff3333', label: 'Red' }, { value: '#33cc66', label: 'Green' },
                { value: '#3366ff', label: 'Blue' }, { value: '#ff8800', label: 'Orange' },
                { value: 'custom', label: 'Custom' }
              ] },
            { id: 'uploadSvg', label: 'Upload SVG', type: 'action', buttonLabel: '⬆ Upload SVG', group: 'general',
              tip: 'Choose an SVG file to lay out and plot. Large files load instantly (no in-browser parse).' },
            { id: 'renderPreview', label: 'Render preview', type: 'action', buttonLabel: '⟳ Render preview', group: 'general',
              tip: 'Re-render the preview with a denser path sample (sharper, a bit slower). The preview always samples a fraction of paths for speed; the full art still plots.' },
            { id: 'fitMode', label: 'Sizing', type: 'select', value: 'fit', group: 'general',
              tip: 'Fit = scale to fit inside the margins; Fit width = fill the width; Manual = use the scale % below.',
              options: [{ value: 'fit', label: 'Fit to margins' }, { value: 'width', label: 'Fit width' }, { value: 'manual', label: 'Manual %' }] },
            { id: 'scalePct', label: 'Scale (%)', type: 'range', min: 5, max: 400, step: 5, value: 100, group: 'general',
              tip: 'Manual scale percentage (used when Sizing = Manual).',
              visibleWhen: { param: 'fitMode', values: ['manual'] } },
            { id: 'rotation', label: 'Rotation', type: 'range', min: 0, max: 350, step: 5, value: 0, group: 'general',
              tip: 'Rotate the artwork on the page (degrees). Fit accounts for the rotated bounds.' },
            { id: 'trimXPct', label: 'Trim margin X (%)', type: 'range', min: 0, max: 45, step: 1, value: 0, group: 'general',
              tip: 'Many exported SVGs bake in a margin around the actual art (their own "page" is bigger than the drawing). This crops that fraction off each side horizontally before Fit/Manual sizing, so 100% scale means the ink fills the target. Auto-filled when detected; adjust by eye otherwise.' },
            { id: 'trimYPct', label: 'Trim margin Y (%)', type: 'range', min: 0, max: 45, step: 1, value: 0, group: 'general',
              tip: 'Same as Trim margin X, but vertical.' },
            { id: 'offsetX', label: 'Offset X (mm)', type: 'range', min: -200, max: 200, step: 1, value: 0, group: 'general',
              tip: 'Shift the artwork horizontally from center.' },
            { id: 'offsetY', label: 'Offset Y (mm)', type: 'range', min: -200, max: 200, step: 1, value: 0, group: 'general',
              tip: 'Shift the artwork vertically from center.' },
            { id: 'recolor', label: 'Recolor', type: 'select', value: 'nearest', group: 'advanced',
              tip: 'How the file\'s colours map onto your pens. Snap to nearest (default) = each SVG colour maps to the closest selected pen \u2014 WATCH OUT: if you only have one pen selected, every colour collapses onto it and the whole drawing prints in one colour. Single pen = every stroke draws with the first selected pen (intentional monochrome). Keep original = each SVG colour stays its own layer. To plot just ONE colour, use \u201cDraw only\u201d in the Colour Mapping panel below instead of deselecting pens.',
              options: [{ value: 'nearest', label: 'Snap to nearest pen' }, { value: 'single', label: 'Single pen' }, { value: 'original', label: 'Keep original' }] },
            // ---- Texture Closed Shapes ----
            { id: 'textureFill', label: 'Texture closed shapes', type: 'select', value: 'off', group: 'closedshapes',
              tip: 'Off = plot outlines only (default). On = also hatch-fill the closed shapes in the SVG. Overlaps use "top shape wins", so an inner border (fill:none) leaves an empty ring in the shape beneath it.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'fillStyle', label: 'Fill style', type: 'select', value: 'straight', group: 'closedshapes',
              visibleWhen: { param: 'textureFill', values: ['on'] },
              tip: 'Straight = parallel hatch lines. Matches the hatch styles used elsewhere.',
              options: [{ value: 'straight', label: 'Straight hatch' }] },
            { id: 'fillAngle', label: 'Fill angle', type: 'range', min: 0, max: 179, step: 1, value: 45, group: 'closedshapes',
              visibleWhen: { param: 'textureFill', values: ['on'] },
              tip: 'Angle of the hatch fill lines, in degrees.' },
            { id: 'fillSpacing', label: 'Fill spacing (mm)', type: 'range', min: 0.5, max: 10, step: 0.5, value: 2.5, group: 'closedshapes',
              visibleWhen: { param: 'textureFill', values: ['on'] },
              tip: 'Spacing between hatch fill lines, in mm on the page (independent of SVG scale).' },
            { id: 'fillCrosshatch', label: 'Crosshatch', type: 'select', value: 'off', group: 'closedshapes',
              visibleWhen: { param: 'textureFill', values: ['on'] },
              tip: 'Add a second set of fill lines at +90° for a denser cross-hatch.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] }
        ]),
        regenerate: function() { resizeIfNeeded(); p.redraw(); },
        redraw: function() { try { p.redraw(); } catch (e) {} },
        randomize: function() { p.redraw(); },
        reseed: function() { p.redraw(); },
        getSignatureSeed: function() { return 1234567; },
        saveSVG: function() {
            var L = layout(), dims = L.dims;
            var group = recoloredGroup(L);
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || 'svg';
            var parts = [];
            parts.push('<?xml version="1.0" encoding="UTF-8"?>');
            parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + dims.width + '" height="' + dims.height + '" viewBox="0 0 ' + dims.width + ' ' + dims.height + '">');
            parts.push('<rect x="0" y="0" width="' + dims.width + '" height="' + dims.height + '" fill="#ffffff"/>');
            parts.push('<rect x="1" y="1" width="' + (dims.width - 2) + '" height="' + (dims.height - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
            // Texture fill BELOW the outlines (drawn first) so outlines sit on top
            var fillSegs = buildFillSegs(L);
            if (fillSegs.length) {
                var tstr = transformStr(L);
                var byPen = {};
                fillSegs.forEach(function(sg) { (byPen[sg.pen] = byPen[sg.pen] || []).push(sg.pts); });
                Object.keys(byPen).forEach(function(pen) {
                    var sw = strokePxFor(pen).toFixed(2);
                    var pg = ['<g transform="' + tstr + '" stroke="' + pen + '" fill="none" stroke-width="' + (sw / (L.scale || 1)).toFixed(3) + '" stroke-linecap="round">'];
                    byPen[pen].forEach(function(pl) {
                        var d = 'M' + pl.map(function(pt) { return pt[0].toFixed(2) + ',' + pt[1].toFixed(2); }).join(' L');
                        pg.push('<path d="' + d + '"/>');
                    });
                    pg.push('</g>');
                    parts.push(pg.join(''));
                });
            }
            if (group) parts.push(group);
            if (window._signatureConfig && window._signatureConfig.enabled &&
                !window._signatureConfig.suppressExport &&
                window.Signature && typeof window.Signature.buildSignatureSVG === 'function') {
                var mgnPx = paper.getMarginPixels(PARAMS.margin);
                var pens = selectedPens();
                var sigCol = window.Signature.pickSignatureColor ? window.Signature.pickSignatureColor(pens) : '#000000';
                var sigG = window.Signature.buildSignatureSVG(window._signatureConfig, dims.width, dims.height, mgnPx,
                    function(mm) { return paper.mmToPixels(mm); }, 'SVG Upload', 1234567, sigCol);
                if (sigG) parts.push(sigG);
            }
            parts.push('</svg>');
            downloadSvgString(parts.join('\n'), '90percentart-svg-' + ts + '.svg');
        },
        setParam: function(name, val) {
            var pdef = api.params.find(function(x) { return x.id === name; });
            if (pdef) pdef.value = val;
            if (name === 'uploadSvg') { if (fileInput) fileInput.click(); return; }
            if (name === 'renderPreview') { updateHelp(); setTimeout(function() { buildPreview(1600); }, 10); return; }
            if (name === 'paperSize') { PARAMS.paperSize = val; resizeIfNeeded(); }
            else if (name === 'margin') PARAMS.margin = Number(val);
            else if (name === 'palette') PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
            else if (name === 'scalePct' || name === 'offsetX' || name === 'offsetY' || name === 'rotation' || name === 'trimXPct' || name === 'trimYPct' || name === 'fillAngle' || name === 'fillSpacing') PARAMS[name] = Number(val);
            else if (PARAMS.hasOwnProperty(name)) PARAMS[name] = val;
            // any fill-affecting change invalidates the cached fill preview
            if (['textureFill', 'fillStyle', 'fillAngle', 'fillSpacing', 'fillCrosshatch',
                 'recolor', 'palette', 'fitMode', 'scalePct', 'rotation', 'trimXPct', 'trimYPct',
                 'paperSize', 'margin'].indexOf(name) >= 0) invalidateFill();
            // Recolor/pens choice changes what the plot will actually draw in
            // colour \u2014 re-rasterize the Pi preview so it shows that, not
            // the SVG's original colours. Debounced: swatch clicks fire fast.
            if (name === 'recolor' || name === 'palette') {
                if (window._pl0tRecolorPreviewTimer) clearTimeout(window._pl0tRecolorPreviewTimer);
                window._pl0tRecolorPreviewTimer = setTimeout(function() { buildPreview(lastPreviewW); }, 250);
                // Skip Layers / Color Mapping don't go through a full param-UI
                // rebuild on ordinary edits, so refresh them directly here.
                if (typeof window._pl0tRenderSkipPanel === 'function') window._pl0tRenderSkipPanel();
                renderColorMap(document.getElementById('svgColorMapWrap'));
            }
            p.redraw();
        },
        getPlotColors: function() {
            // Distinct pen colors this file will actually draw with, given the
            // current Recolor mode \u2014 this is what Skip Layers and the pen
            // confirm dialog key off, not just the raw selected-pens palette.
            var pens = selectedPens();
            if (!svgText || !svgColors.length) return pens.map(function(c) { return { color: c, label: c }; });
            var mode = PARAMS.recolor;
            // When one colour is soloed via "Draw only", the plot has exactly that
            // one resolved pen — Skip Layers / the pen-confirm dialog should reflect it.
            if (isolateActive()) {
                var only = _pl0tResolvePenFor(PARAMS.isolate, mode, pens);
                return [{ color: only, label: only }];
            }
            var seen = {}, out = [];
            svgColors.forEach(function(c) {
                var resolved = _pl0tResolvePenFor(c, mode, pens);
                var key = String(resolved).toLowerCase();
                if (!seen[key]) { seen[key] = 1; out.push({ color: resolved, label: resolved }); }
            });
            return out.length ? out : [{ color: '#000000', label: '#000000' }];
        },
        buildAdvancedExtra: function(body) {
            if (!body) return;
            var wrap = body.querySelector('#svgColorMapWrap');
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.id = 'svgColorMapWrap';
                wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #eee;';
                body.appendChild(wrap);
            }
            renderColorMap(wrap);
            window._pl0tOnSkipLayersChanged = function() { renderColorMap(document.getElementById('svgColorMapWrap')); };
        }
    };

    function resizeIfNeeded() { paper.resizeCanvasToPaper(p, PARAMS.paperSize); }

    p.registerSketchAPI = function(register) { if (typeof register === 'function') register(api); };

    p.setup = function() {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            container.appendChild(helpEl);
            updateHelp();
        }
        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.svg,image/svg+xml';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', function(e) {
                var f = e.target.files && e.target.files[0];
                if (f) handleFile(f);
                e.target.value = '';
            });
            document.body.appendChild(fileInput);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        p.pixelDensity(1);
        p.noLoop();
    };

    p.draw = function() {
        p.background(255);
        paper.drawPaperBorder(p);
        var L = layout();
        if (previewImg && svgText) {
            p.push();
            p.translate(L.cx, L.cy);
            p.rotate(L.rot * Math.PI / 180);
            p.scale(L.scale);
            // Preview always shows the SVG's own colors — tinting a raster with a
            // pen color multiplies its white background too, turning the whole
            // image solid (the "black box" bug). Actual recolor applies at plot time.
            p.imageMode(p.CENTER);
            p.image(previewImg, 0, 0, svgW, svgH);
            p.pop();
        } else if (svgText) {
            // layout outline (cheap) — shows exact placement/size/rotation of the
            // trimmed content box (what will actually fill the target area)
            var hw = contentW() / 2 * L.scale, hh = contentH() / 2 * L.scale;
            var rad = L.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
            var pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(function(pt) {
                return [L.cx + pt[0] * cos - pt[1] * sin, L.cy + pt[0] * sin + pt[1] * cos];
            });
            p.push();
            p.stroke(150); p.strokeWeight(1.5); p.noFill();
            p.beginShape();
            pts.forEach(function(pt) { p.vertex(pt[0], pt[1]); });
            p.endShape(p.CLOSE);
            p.line(pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
            p.line(pts[1][0], pts[1][1], pts[3][0], pts[3][1]);
            p.noStroke(); p.fill(150); p.textAlign(p.CENTER, p.CENTER); p.textSize(13);
            p.text('rendering preview…', L.cx, L.cy);
            p.pop();
        } else {
            p.push();
            p.noStroke(); p.fill(170);
            p.textAlign(p.CENTER, p.CENTER); p.textSize(15);
            p.text('⬆  Upload an SVG', p.width / 2, p.height / 2);
            p.pop();
        }
        // Texture fill overlay (on top of the preview so you can see the hatch)
        if (svgText && PARAMS.textureFill === 'on') drawFillOverlay(L);
        // Redraw on top: full-bleed content (0" margin, or a trim-scaled preview
        // that now exceeds the page) can paint edge-to-edge and cover the border
        // drawn at the top of this function — keep it visible as the top layer.
        paper.drawPaperBorder(p);
    };

    function drawFillOverlay(L) {
        var segs = getFillForDraw(L);
        if (!segs.length) return;
        var rad = L.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        var ox = svgVBX + svgW / 2, oy = svgVBY + svgH / 2;   // matches transformStr inner translate
        p.push();
        p.noFill();
        segs.forEach(function(sg) {
            p.stroke(sg.pen);
            p.strokeWeight(Math.max(1, strokePxFor(sg.pen)));
            p.beginShape();
            sg.pts.forEach(function(pt) {
                var lx = (pt[0] - ox) * L.scale, ly = (pt[1] - oy) * L.scale;
                p.vertex(L.cx + lx * cos - ly * sin, L.cy + lx * sin + ly * cos);
            });
            p.endShape();
        });
        p.pop();
    }

    function downloadSvgString(str, filename) {
        try {
            var blob = new Blob([str], { type: 'image/svg+xml' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
        } catch (e) { console.error('SVG download failed', e); }
    }
};
