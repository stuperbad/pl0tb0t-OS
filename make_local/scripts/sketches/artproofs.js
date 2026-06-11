window.sketches = window.sketches || {};
window.sketches['artproofs'] = function(p) {
    var paper = window.makeSketchUtils;

    // Global params (never per-instance)
    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        instanceCount: 1,
        penWidthMm: 0.4,
        viewMode: 'multiply'
    };
    // Shared defaults — each instance inherits these unless it has a per-instance override
    var DEFAULTS = {
        palette: ['#000000', '#e63946'],
        fillStyles: ['arcs'],
        compositeMode: 'arcTrim',
        layerWidthMean: 0.3,
        layerWidthSD: 0.15,
        eltsPerLayerMean: 0.4,
        eltsPerLayerSD: 0.2,
        fillFactor: 0.5,
        sliceProb: 0.8,
        fillBlackProb: 0.5,
        wedgeCount: 0.3,
        wedgeThetaSize: 0.3,
        wedgeRadius: 0.5,
        ringConcentricity: 0,
        arcConcentricity: 0,
        fillAngle: 45,
        fillJitter: 0
    };

    var instances = [];
    var globalSeed = 42;
    var canvasW = 0, canvasH = 0;
    var selectedInst = -1;
    var dragTarget = null;
    var baseRadius = 200;
    var _syncingControls = false;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function() { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    }

    function gaussian(rng, mean, sd) {
        var u = rng(), v = rng();
        var z = Math.sqrt(-2 * Math.log(Math.max(u, 1e-10))) * Math.cos(2 * Math.PI * v);
        return mean + sd * z;
    }

    function betaSample(rng, a, b) {
        a = Math.max(1e-10, Math.min(1e10, a));
        b = Math.max(1e-10, Math.min(1e10, b));
        var mean = a / (a + b);
        var variance = a * b / ((a + b) * (a + b) * (a + b + 1));
        return Math.max(0, Math.min(1, mean + Math.sqrt(variance) * gaussian(rng, 0, 1)));
    }

    function inkColor(hex) {
        var c = p.color(hex);
        if (PARAMS.viewMode === 'multiply') c.setAlpha(204);
        return c;
    }

    function ptAt(cx, cy, r, theta) {
        return { x: cx + r * Math.cos(-theta), y: cy + r * Math.sin(-theta) };
    }

    // ---- per-instance params ----

    function ep(inst) {
        // effective params: DEFAULTS merged with inst.settings overrides
        if (!inst || !inst.settings) return DEFAULTS;
        var out = {};
        for (var k in DEFAULTS) out[k] = DEFAULTS[k];
        for (var k in inst.settings) out[k] = inst.settings[k];
        return out;
    }

    function setInstParam(inst, name, processed) {
        if (!inst.settings) inst.settings = {};
        inst.settings[name] = processed;
    }

    // ---- instance layout ----

    function computeBaseRadius() {
        var marginPx = paper.getMarginPixels(PARAMS.margin);
        var usableW = canvasW - marginPx * 2;
        var usableH = canvasH - marginPx * 2;
        var n = PARAMS.instanceCount;
        if (n <= 1) return Math.min(usableW, usableH) / 2 - 20;
        return Math.min(usableW, usableH) * 0.21;
    }

    function defaultInstPos(i, n) {
        var marginPx = paper.getMarginPixels(PARAMS.margin) + baseRadius;
        if (n <= 1) return { x: canvasW / 2, y: canvasH / 2 };
        var rng = makeRng(0xA3F1C2B0 ^ (n * 0x9E3779B9));
        for (var s = 0; s < i; s++) { rng(); rng(); }
        var x = marginPx + rng() * (canvasW - marginPx * 2);
        var y = marginPx + rng() * (canvasH - marginPx * 2);
        return { x: x, y: y };
    }

    function buildInstElements(inst) {
        var P = ep(inst);
        var rng     = makeRng(inst.seed);
        var fillRng = makeRng(inst.seed ^ 0xDEADBEEF);
        inst.elements = [];
        var maxRadius = baseRadius;
        var pal = P.palette.length ? P.palette : ['#000000'];
        var jitterFrac   = P.fillJitter / 100;
        var ringCFrac    = P.ringConcentricity / 100;
        var arcCFrac     = P.arcConcentricity  / 100;

        var currRadius = 20;
        while (currRadius < maxRadius) {
            var layerWidth = Math.abs(gaussian(rng, P.layerWidthMean * maxRadius / 2 + 20, P.layerWidthSD * maxRadius / 5));
            if (layerWidth < 0.5 || currRadius + layerWidth > maxRadius) break;
            var numElts = Math.floor(Math.abs(gaussian(rng, P.eltsPerLayerMean * 30, P.eltsPerLayerSD * 5))) + 1;
            var eltSize = 2 * Math.PI / numElts;
            var ringDx = ringCFrac > 0 ? (fillRng() * 2 - 1) * ringCFrac * maxRadius * 0.35 : fillRng() * 0;
            var ringDy = ringCFrac > 0 ? (fillRng() * 2 - 1) * ringCFrac * maxRadius * 0.35 : fillRng() * 0;
            for (var j = 0; j < numElts; j++) {
                if (P.sliceProb > rng()) {
                    var fillFact = rng() < P.fillBlackProb ? P.fillFactor : 0;
                    var strokeIdx = Math.floor(rng() * pal.length);
                    var strokeCol = pal[strokeIdx];
                    var fillCol   = pal.length > 1 ? pal[(strokeIdx + 1) % pal.length] : strokeCol;
                    var elFillAngle    = P.fillAngle + (jitterFrac > 0 ? (fillRng() * 2 - 1) * jitterFrac * 60 : fillRng() * 0);
                    var elFillPhase    = fillRng() * Math.PI * 2;
                    var elSpacingScale = 1 + (jitterFrac > 0 ? (fillRng() * 2 - 1) * jitterFrac * 0.4 : fillRng() * 0);
                    var arcDx = arcCFrac > 0 ? (fillRng() * 2 - 1) * arcCFrac * maxRadius * 0.18 : fillRng() * 0;
                    var arcDy = arcCFrac > 0 ? (fillRng() * 2 - 1) * arcCFrac * maxRadius * 0.18 : fillRng() * 0;
                    var _el = { type: 'slice', cx: ringDx + arcDx, cy: ringDy + arcDy,
                        t0: j * eltSize, t1: (j + 1) * eltSize,
                        r0: currRadius, r1: currRadius + layerWidth,
                        fillFact: fillFact, color: strokeCol, fillColor: fillCol,
                        fillAngle: elFillAngle, fillPhase: elFillPhase, spacingScale: elSpacingScale,
                        fillStyle: P.fillStyles[Math.floor(fillRng() * P.fillStyles.length)] };
                    cacheElementGeometry(_el);
                    inst.elements.push(_el);
                }
            }
            currRadius += layerWidth + Math.abs(gaussian(rng, 2, 1));
        }

        var numWedges = Math.floor(Math.abs(gaussian(rng, P.wedgeCount * 16, P.wedgeCount * 2)));
        for (var i = 0; i < numWedges; i++) {
            var thetaSize = rng() * 0.17 + 0.03 + Math.abs(gaussian(rng, P.wedgeThetaSize * Math.PI / 6, 0.001));
            var startTheta = rng() * 2 * Math.PI - thetaSize / 2;
            var radius = Math.min(maxRadius - 20, Math.max(gaussian(rng, P.wedgeRadius * maxRadius / 1.5, maxRadius / 5), 30));
            var wedgeIdx = Math.floor(rng() * pal.length);
            var wDx = arcCFrac > 0 ? (fillRng() * 2 - 1) * arcCFrac * maxRadius * 0.25 : fillRng() * 0;
            var wDy = arcCFrac > 0 ? (fillRng() * 2 - 1) * arcCFrac * maxRadius * 0.25 : fillRng() * 0;
            inst.elements.push({ type: 'wedge', cx: wDx, cy: wDy, r: radius,
                t0: startTheta, t1: startTheta + thetaSize, color: pal[wedgeIdx] });
        }
    }

    function resetInstLayout() {
        baseRadius = computeBaseRadius();
        var n = PARAMS.instanceCount;
        instances = [];
        for (var i = 0; i < n; i++) {
            var pos = defaultInstPos(i, n);
            instances.push({ x: pos.x, y: pos.y, scale: 1, rotation: 0,
                             seed: (globalSeed + i * 0x9B74E17) >>> 0, settings: {}, elements: [] });
        }
        instances.forEach(function(inst) { buildInstElements(inst); });
    }

    function buildAllInstances() {
        baseRadius = computeBaseRadius();
        var n = PARAMS.instanceCount;
        while (instances.length < n) {
            var i = instances.length;
            var pos = defaultInstPos(i, n);
            instances.push({ x: pos.x, y: pos.y, scale: 1, rotation: 0,
                             seed: (globalSeed + i * 0x9B74E17) >>> 0, settings: {}, elements: [] });
        }
        if (instances.length > n) instances.length = n;
        instances.forEach(function(inst) { buildInstElements(inst); });
    }

    // ---- geometry / texture helpers ----

    function svgArcPath(cx, cy, r, t0, t1) {
        var p0 = ptAt(cx, cy, r, t0), p1 = ptAt(cx, cy, r, t1);
        var large = (t1 - t0) > Math.PI ? 1 : 0;
        return 'M ' + p0.x.toFixed(2) + ',' + p0.y.toFixed(2) +
               ' A ' + r.toFixed(2) + ',' + r.toFixed(2) + ' 0 ' + large + ',0 ' +
               p1.x.toFixed(2) + ',' + p1.y.toFixed(2);
    }

    function drawArc(cx, cy, r, t0, t1) {
        p.arc(cx, cy, r * 2, r * 2, -t1, -t0, p.OPEN);
    }

    function cacheElementGeometry(el) {
        if (el.type === 'wedge' || el.fillFact <= 0) { el._cache = null; return; }
        var style = el.fillStyle || 'arcs';
        if (style === 'none') { el._cache = null; return; }
        var sp = fillSpacing(el);
        if (style === 'arcs') {
            var width = el.r1 - el.r0, numLines = fillLineCount(width, el.fillFact), ls = width / (numLines + 1);
            var rings = [];
            for (var i = 0; i < numLines; i++) rings.push(el.r0 + ls * (i + 1));
            el._cache = { type: 'arcs', rings: rings }; return;
        }
        var poly = wedgePoly(el, 14);
        var segs;
        if (style === 'hatch')           { segs = hatchSegs(poly, el.fillAngle, sp); }
        else if (style === 'crosshatch') { segs = hatchSegs(poly, el.fillAngle, sp).concat(hatchSegs(poly, el.fillAngle + 90, sp)); }
        else if (style === 'sketchHatch'){ segs = noisyHatchSegs(poly, el.fillAngle, sp, el.fillPhase||0, sp*0.18, false); }
        else if (style === 'streakHatch'){ segs = noisyHatchSegs(poly, el.fillAngle, sp, el.fillPhase||0, sp*0.38, true); }
        else if (style === 'zigzagHatch'){ segs = zigzagSegs(poly, el.fillAngle, sp*1.2, el.fillPhase||0); }
        else if (style === 'waves')      { segs = waveSegs(poly, el.fillAngle, sp, el.fillPhase||0); }
        else if (style === 'tileSprigs') { segs = tilePatternSegs(poly, el.fillAngle, sp, el.fillPhase||0, 'sprigs'); }
        else if (style === 'tileRibbons'){ segs = tilePatternSegs(poly, el.fillAngle, sp, el.fillPhase||0, 'ribbons'); }
        else if (style === 'dots' || style === 'bigDots' || style === 'mixedDots') {
            var sizeMode = style === 'mixedDots' ? 'mixed' : (style === 'bigDots' ? 'big' : 'normal');
            var dotSpacing = style === 'bigDots' ? sp * 1.65 : sp;
            el._cache = { type: 'dots', pts: dotPoints(poly, dotSpacing, el.fillPhase||0, sizeMode), sp: dotSpacing }; return;
        } else { el._cache = null; return; }
        el._cache = { type: 'segs', segs: segs };
    }

    function fillLineCount(width, fillFact) {
        var penPx = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
        var maxLines = Math.max(1, Math.floor(width / penPx));
        return Math.max(1, Math.round(fillFact * maxLines));
    }

    function fillSpacing(el) {
        var penPx = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
        var width = el.r1 - el.r0;
        var numLines = fillLineCount(width, el.fillFact);
        return Math.max(penPx, width / (numLines + 1)) * (el.spacingScale || 1);
    }

    function wedgePoly(el, n) {
        var pts = [], i, t;
        for (i = 0; i <= n; i++) {
            t = el.t0 + (el.t1 - el.t0) * i / n;
            pts.push({ x: el.cx + el.r1 * Math.cos(-t), y: el.cy + el.r1 * Math.sin(-t) });
        }
        for (i = n; i >= 0; i--) {
            t = el.t0 + (el.t1 - el.t0) * i / n;
            pts.push({ x: el.cx + el.r0 * Math.cos(-t), y: el.cy + el.r0 * Math.sin(-t) });
        }
        return pts;
    }

    function wedgeElementPoly(el, n) {
        var pts = [{ x: el.cx, y: el.cy }];
        for (var i = 0; i <= n; i++) {
            var t = el.t0 + (el.t1 - el.t0) * i / n;
            pts.push({ x: el.cx + el.r * Math.cos(-t), y: el.cy + el.r * Math.sin(-t) });
        }
        return pts;
    }

    function elementMaskPoly(el) {
        if (el.type === 'slice') return wedgePoly(el, 18);
        if (el.type === 'wedge') return wedgeElementPoly(el, 18);
        return [];
    }

    function lineEdgeT(ax, ay, dx, dy, ex, ey, fx, fy) {
        var gx = fx - ex, gy = fy - ey;
        var denom = dx * gy - dy * gx;
        if (Math.abs(denom) < 1e-10) return null;
        var t = ((ex - ax) * gy - (ey - ay) * gx) / denom;
        var s = ((ex - ax) * dy - (ey - ay) * dx) / denom;
        return (s >= -1e-6 && s <= 1 + 1e-6) ? t : null;
    }

    function polyInside(pt, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            if (((yi > pt.y) !== (yj > pt.y)) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
                inside = !inside;
        }
        return inside;
    }

    function clipSegmentToPoly(x1, y1, x2, y2, poly) {
        var dx = x2 - x1, dy = y2 - y1;
        var ts = [0, 1];
        for (var i = 0; i < poly.length; i++) {
            var t = lineEdgeT(x1, y1, dx, dy, poly[i].x, poly[i].y, poly[(i+1)%poly.length].x, poly[(i+1)%poly.length].y);
            if (t !== null && t >= 0 && t <= 1) ts.push(t);
        }
        ts.sort(function(a, b) { return a - b; });
        var out = [];
        for (var j = 0; j+1 < ts.length; j++) {
            var a = ts[j], b = ts[j+1];
            if (b - a < 1e-5) continue;
            var mid = (a + b) / 2;
            if (polyInside({ x: x1 + dx * mid, y: y1 + dy * mid }, poly))
                out.push({ x1: x1+dx*a, y1: y1+dy*a, x2: x1+dx*b, y2: y1+dy*b });
        }
        return out;
    }

    function hatchSegs(poly, angleDeg, spacing) {
        var ang = angleDeg * Math.PI / 180;
        var dx = Math.cos(ang), dy = Math.sin(ang);
        var nx = -dy, ny = dx;
        var pMin = Infinity, pMax = -Infinity;
        for (var i = 0; i < poly.length; i++) {
            var proj = poly[i].x * nx + poly[i].y * ny;
            pMin = Math.min(pMin, proj); pMax = Math.max(pMax, proj);
        }
        var segs = [];
        for (var k = Math.floor(pMin / spacing); k * spacing <= pMax; k++) {
            var p0val = k * spacing, ax = p0val * nx, ay = p0val * ny, ts = [];
            for (var e = 0; e < poly.length; e++) {
                var tval = lineEdgeT(ax, ay, dx, dy, poly[e].x, poly[e].y,
                                     poly[(e+1)%poly.length].x, poly[(e+1)%poly.length].y);
                if (tval !== null) ts.push(tval);
            }
            ts.sort(function(a, b) { return a - b; });
            for (var m = 0; m+1 < ts.length; m += 2) {
                var t0 = ts[m], t1 = ts[m+1];
                if (polyInside({ x: ax + (t0+t1)/2*dx, y: ay + (t0+t1)/2*dy }, poly))
                    segs.push({ x1: ax+t0*dx, y1: ay+t0*dy, x2: ax+t1*dx, y2: ay+t1*dy });
            }
        }
        return segs;
    }

    function waveSegs(poly, angleDeg, spacing, phase) {
        spacing = Math.max(spacing, paper.mmToPixels(PARAMS.penWidthMm) * 2.5, 4);
        var ang = angleDeg * Math.PI / 180;
        var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
        var pMin = Infinity, pMax = -Infinity, tMin = Infinity, tMax = -Infinity;
        for (var i = 0; i < poly.length; i++) {
            pMin = Math.min(pMin, poly[i].x*nx+poly[i].y*ny); pMax = Math.max(pMax, poly[i].x*nx+poly[i].y*ny);
            tMin = Math.min(tMin, poly[i].x*dx+poly[i].y*dy); tMax = Math.max(tMax, poly[i].x*dx+poly[i].y*dy);
        }
        var amplitude = spacing * 0.55, frequency = 2 * Math.PI / (spacing * 3.5), segs = [];
        for (var k = Math.floor(pMin / spacing); k * spacing <= pMax; k++) {
            var p0val = k * spacing, run = [];
            var samples = Math.max(10, Math.min(48, Math.ceil((tMax - tMin) / (spacing * 0.85))));
            for (var s = 0; s <= samples; s++) {
                var tv = tMin + (tMax - tMin) * s / samples;
                var waveOff = amplitude * Math.sin(frequency * tv + phase + k * 1.3);
                var px = (p0val + waveOff) * nx + tv * dx, py = (p0val + waveOff) * ny + tv * dy;
                if (polyInside({ x: px, y: py }, poly)) { run.push({ x: px, y: py }); }
                else { for (var r = 0; r+1 < run.length; r++) segs.push({ x1: run[r].x, y1: run[r].y, x2: run[r+1].x, y2: run[r+1].y }); run = []; }
            }
            for (var r2 = 0; r2+1 < run.length; r2++) segs.push({ x1: run[r2].x, y1: run[r2].y, x2: run[r2+1].x, y2: run[r2+1].y });
        }
        return segs;
    }

    function tilePatternSegs(poly, angleDeg, spacing, phase, mode) {
        var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for (var i=0;i<poly.length;i++){minX=Math.min(minX,poly[i].x);maxX=Math.max(maxX,poly[i].x);minY=Math.min(minY,poly[i].y);maxY=Math.max(maxY,poly[i].y);}
        var tile=Math.max(spacing*3.2,16),ang=angleDeg*Math.PI/180,ca=Math.cos(ang),sa=Math.sin(ang),segs=[];
        function addLocal(cx,cy,ax,ay,bx,by){Array.prototype.push.apply(segs,clipSegmentToPoly(cx+ax*ca-ay*sa,cy+ax*sa+ay*ca,cx+bx*ca-by*sa,cy+bx*sa+by*ca,poly));}
        for(var y=Math.floor((minY-tile)/tile)*tile;y<=maxY+tile;y+=tile)for(var x=Math.floor((minX-tile)/tile)*tile;x<=maxX+tile;x+=tile){
            var jx=Math.sin(x*0.013+y*0.017+phase)*tile*0.12,jy=Math.cos(x*0.011-y*0.019+phase)*tile*0.12,cx=x+tile*0.5+jx,cy=y+tile*0.5+jy;
            if(mode==='ribbons'){addLocal(cx,cy,-tile*.35,-tile*.18,-tile*.05,tile*.18);addLocal(cx,cy,-tile*.05,tile*.18,tile*.35,-tile*.18);addLocal(cx,cy,-tile*.34,tile*.20,tile*.34,tile*.20);}
            else{addLocal(cx,cy,-tile*.30,tile*.30,tile*.28,-tile*.28);addLocal(cx,cy,-tile*.02,tile*.02,-tile*.24,-tile*.08);addLocal(cx,cy,tile*.08,-tile*.08,tile*.30,tile*.02);addLocal(cx,cy,tile*.18,-tile*.18,tile*.02,-tile*.32);}
        }
        return segs;
    }

    function noisyHatchSegs(poly, angleDeg, spacing, phase, wobble, broken) {
        var base=hatchSegs(poly,angleDeg,spacing),segs=[];
        for(var i=0;i<base.length;i++){
            var s=base[i],dx=s.x2-s.x1,dy=s.y2-s.y1,len=Math.sqrt(dx*dx+dy*dy);
            if(len<1)continue;
            var ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
            var pieces=broken?Math.max(2,Math.min(7,Math.floor(len/(spacing*2.4)))):1;
            for(var j=0;j<pieces;j++){
                var a=pieces===1?0:j/pieces,b=pieces===1?1:Math.min(1,a+0.55+0.22*Math.sin(phase+i*1.7+j));
                var gap=broken?0.12+0.08*Math.sin(phase+i*2.1+j*3.3):0.02;
                a=Math.min(0.96,a+gap);b=Math.max(a+0.02,b-gap);
                segs.push({x1:s.x1+dx*a+nx*wobble*Math.sin(phase+i*.91+j*2.4),y1:s.y1+dy*a+ny*wobble*Math.sin(phase+i*.91+j*2.4),
                            x2:s.x1+dx*b+nx*wobble*Math.sin(phase+i*1.23+j*2.9+1.7),y2:s.y1+dy*b+ny*wobble*Math.sin(phase+i*1.23+j*2.9+1.7)});
            }
        }
        return segs;
    }

    function zigzagSegs(poly, angleDeg, spacing, phase) {
        var ang=angleDeg*Math.PI/180,dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx;
        var pMin=Infinity,pMax=-Infinity,tMin=Infinity,tMax=-Infinity;
        for(var i=0;i<poly.length;i++){pMin=Math.min(pMin,poly[i].x*nx+poly[i].y*ny);pMax=Math.max(pMax,poly[i].x*nx+poly[i].y*ny);tMin=Math.min(tMin,poly[i].x*dx+poly[i].y*dy);tMax=Math.max(tMax,poly[i].x*dx+poly[i].y*dy);}
        var segs=[],zig=Math.max(spacing*1.4,7),amp=spacing*0.52;
        for(var k=Math.floor(pMin/spacing);k*spacing<=pMax;k++){
            var p0val=k*spacing,pts=[],steps=Math.max(8,Math.min(80,Math.ceil((tMax-tMin)/zig)));
            for(var s=0;s<=steps;s++){var tv=tMin+(tMax-tMin)*s/steps,side=((s+k)%2===0?-1:1),off=side*amp+Math.sin(phase+s*1.7+k)*amp*0.16;pts.push({x:(p0val+off)*nx+tv*dx,y:(p0val+off)*ny+tv*dy});}
            for(var j=0;j+1<pts.length;j++){var mid={x:(pts[j].x+pts[j+1].x)/2,y:(pts[j].y+pts[j+1].y)/2};if(polyInside(mid,poly))segs.push({x1:pts[j].x,y1:pts[j].y,x2:pts[j+1].x,y2:pts[j+1].y});}
        }
        return segs;
    }

    function dotPoints(poly, spacing, phase, sizeMode) {
        var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for(var i=0;i<poly.length;i++){minX=Math.min(minX,poly[i].x);maxX=Math.max(maxX,poly[i].x);minY=Math.min(minY,poly[i].y);maxY=Math.max(maxY,poly[i].y);}
        var pts=[];
        for(var y=Math.floor(minY/spacing)*spacing;y<=maxY;y+=spacing)for(var x=Math.floor(minX/spacing)*spacing;x<=maxX;x+=spacing){
            var jx=Math.sin(x*0.027+y*0.019+phase)*spacing*0.12,jy=Math.cos(x*0.017-y*0.031+phase)*spacing*0.12;
            var pt={x:x+jx,y:y+jy};
            if(polyInside(pt,poly)){var tone=0.5+0.5*Math.sin(x*0.041+y*0.037+phase);pts.push({x:pt.x,y:pt.y,radiusScale:sizeMode==='mixed'?0.12+tone*0.42:(sizeMode==='big'?0.46:0.22)});}
        }
        return pts;
    }

    // ---- draw helpers ----

    function drawFill(el) {
        if (!el._cache) return;
        var cache = el._cache;
        var ctx = p.drawingContext;
        p.stroke(inkColor(el.fillColor || el.color));
        if (cache.type === 'arcs') {
            for (var i = 0; i < cache.rings.length; i++) drawArc(el.cx, el.cy, cache.rings[i], el.t0, el.t1);
        } else if (cache.type === 'segs') {
            var segs = cache.segs, col = inkColor(el.fillColor || el.color);
            ctx.beginPath();
            ctx.strokeStyle = col;
            for (var j = 0; j < segs.length; j++) {
                ctx.moveTo(segs[j].x1, segs[j].y1);
                ctx.lineTo(segs[j].x2, segs[j].y2);
            }
            ctx.stroke();
        } else if (cache.type === 'dots') {
            p.noStroke(); p.fill(inkColor(el.fillColor || el.color));
            var pts = cache.pts, sp = cache.sp;
            for (var d = 0; d < pts.length; d++) p.circle(pts[d].x, pts[d].y, sp * pts[d].radiusScale * 2);
            p.noFill();
        }
    }

    function fillToSVG(el, fc, swStr) {
        if (el.fillFact <= 0) return [];
        var style = el.fillStyle || DEFAULTS.fillStyles[0] || 'arcs';
        var sp = fillSpacing(el);
        var lines = [];
        if (style === 'arcs' || !style) {
            var width = el.r1 - el.r0, numLines = fillLineCount(width, el.fillFact), lineSpacing = width / (numLines + 1);
            for (var i = 0; i < numLines; i++) lines.push('<path d="' + svgArcPath(el.cx, el.cy, el.r0 + lineSpacing*(i+1), el.t0, el.t1) + '" fill="none" stroke="' + fc + '" stroke-width="' + swStr + '"/>');
            return lines;
        }
        if (style === 'none') return [];
        var poly = wedgePoly(el, 14), segs = [];
        if (style === 'hatch' || style === 'crosshatch') {
            segs = hatchSegs(poly, el.fillAngle, sp);
            if (style === 'crosshatch') segs = segs.concat(hatchSegs(poly, el.fillAngle + 90, sp));
        } else if (style === 'sketchHatch' || style === 'streakHatch') {
            segs = noisyHatchSegs(poly, el.fillAngle, sp, el.fillPhase||0, style==='streakHatch'?sp*0.38:sp*0.18, style==='streakHatch');
        } else if (style === 'zigzagHatch') { segs = zigzagSegs(poly, el.fillAngle, sp*1.2, el.fillPhase||0);
        } else if (style === 'waves') { segs = waveSegs(poly, el.fillAngle, sp, el.fillPhase||0);
        } else if (style === 'tileSprigs' || style === 'tileRibbons') {
            segs = tilePatternSegs(poly, el.fillAngle, sp, el.fillPhase||0, style==='tileRibbons'?'ribbons':'sprigs');
        } else if (style === 'dots' || style === 'bigDots' || style === 'mixedDots') {
            var sizeMode = style==='mixedDots'?'mixed':(style==='bigDots'?'big':'normal'), dotSpacing = style==='bigDots'?sp*1.65:sp;
            dotPoints(poly, dotSpacing, el.fillPhase||0, sizeMode).forEach(function(pt) {
                lines.push('<circle cx="' + pt.x.toFixed(2) + '" cy="' + pt.y.toFixed(2) + '" r="' + (dotSpacing*pt.radiusScale).toFixed(2) + '" fill="none" stroke="' + fc + '" stroke-width="' + swStr + '"/>');
            });
            return lines;
        }
        for (var j = 0; j < segs.length; j++) lines.push('<line x1="'+segs[j].x1.toFixed(2)+'" y1="'+segs[j].y1.toFixed(2)+'" x2="'+segs[j].x2.toFixed(2)+'" y2="'+segs[j].y2.toFixed(2)+'" stroke="'+fc+'" stroke-width="'+swStr+'" stroke-linecap="round"/>');
        return lines;
    }

    function drawSlice(el) {
        var p0=ptAt(el.cx,el.cy,el.r0,el.t0),p1=ptAt(el.cx,el.cy,el.r1,el.t0),p2=ptAt(el.cx,el.cy,el.r0,el.t1),p3=ptAt(el.cx,el.cy,el.r1,el.t1);
        p.stroke(inkColor(el.color)); p.noFill();
        drawArc(el.cx,el.cy,el.r0,el.t0,el.t1); drawArc(el.cx,el.cy,el.r1,el.t0,el.t1);
        p.line(p0.x,p0.y,p1.x,p1.y); p.line(p2.x,p2.y,p3.x,p3.y);
        drawFill(el); p.noFill();
    }

    function drawElementMask(el) {
        var poly = elementMaskPoly(el);
        if (!poly.length) return;
        p.push(); p.blendMode(p.BLEND); p.noStroke(); p.fill(255);
        p.beginShape(); for (var i=0;i<poly.length;i++) p.vertex(poly[i].x,poly[i].y); p.endShape(p.CLOSE);
        p.pop();
        p.blendMode(PARAMS.viewMode==='multiply'?p.MULTIPLY:p.BLEND);
    }

    function drawWedge(el) {
        var p0=ptAt(el.cx,el.cy,el.r,el.t0),p1=ptAt(el.cx,el.cy,el.r,el.t1);
        p.stroke(inkColor(el.color)); p.noFill();
        drawArc(el.cx,el.cy,el.r,el.t0,el.t1); p.line(el.cx,el.cy,p0.x,p0.y); p.line(el.cx,el.cy,p1.x,p1.y);
    }

    function toWorldEl(el, inst) {
        var cos=Math.cos(inst.rotation),sin=Math.sin(inst.rotation),deg=inst.rotation*(180/Math.PI);
        return Object.assign({},el,{
            cx: inst.x+(el.cx*cos-el.cy*sin)*inst.scale, cy: inst.y+(el.cx*sin+el.cy*cos)*inst.scale,
            r0: el.r0!==undefined?el.r0*inst.scale:undefined, r1: el.r1!==undefined?el.r1*inst.scale:undefined,
            r:  el.r !==undefined?el.r *inst.scale:undefined,
            t0: el.t0+inst.rotation, t1: el.t1+inst.rotation,
            fillAngle: (el.fillAngle||0)+deg
        });
    }

    function sliceToSVG(el, sw) {
        var p0=ptAt(el.cx,el.cy,el.r0,el.t0),p1=ptAt(el.cx,el.cy,el.r1,el.t0),p2=ptAt(el.cx,el.cy,el.r0,el.t1),p3=ptAt(el.cx,el.cy,el.r1,el.t1);
        var sc=el.color,fc=el.fillColor||el.color,sw2=sw.toFixed(2);
        return ['<path d="'+svgArcPath(el.cx,el.cy,el.r0,el.t0,el.t1)+'" fill="none" stroke="'+sc+'" stroke-width="'+sw2+'"/>',
                '<path d="'+svgArcPath(el.cx,el.cy,el.r1,el.t0,el.t1)+'" fill="none" stroke="'+sc+'" stroke-width="'+sw2+'"/>',
                '<line x1="'+p0.x.toFixed(2)+'" y1="'+p0.y.toFixed(2)+'" x2="'+p1.x.toFixed(2)+'" y2="'+p1.y.toFixed(2)+'" stroke="'+sc+'" stroke-width="'+sw2+'"/>',
                '<line x1="'+p2.x.toFixed(2)+'" y1="'+p2.y.toFixed(2)+'" x2="'+p3.x.toFixed(2)+'" y2="'+p3.y.toFixed(2)+'" stroke="'+sc+'" stroke-width="'+sw2+'"/>']
               .concat(fillToSVG(el,fc,sw2)).join('\n');
    }

    function maskToSVG(el) {
        var poly=elementMaskPoly(el);
        return poly.length ? '<polygon points="'+poly.map(function(pt){return pt.x.toFixed(2)+','+pt.y.toFixed(2);}).join(' ')+'" fill="white" stroke="none"/>' : '';
    }

    function wedgeToSVG(el, sw) {
        var p0=ptAt(el.cx,el.cy,el.r,el.t0),p1=ptAt(el.cx,el.cy,el.r,el.t1),c=el.color,sw2=sw.toFixed(2);
        return ['<path d="'+svgArcPath(el.cx,el.cy,el.r,el.t0,el.t1)+'" fill="none" stroke="'+c+'" stroke-width="'+sw2+'"/>',
                '<line x1="'+el.cx.toFixed(2)+'" y1="'+el.cy.toFixed(2)+'" x2="'+p0.x.toFixed(2)+'" y2="'+p0.y.toFixed(2)+'" stroke="'+c+'" stroke-width="'+sw2+'"/>',
                '<line x1="'+el.cx.toFixed(2)+'" y1="'+el.cy.toFixed(2)+'" x2="'+p1.x.toFixed(2)+'" y2="'+p1.y.toFixed(2)+'" stroke="'+c+'" stroke-width="'+sw2+'"/>'].join('\n');
    }

    function polyToSVGPoints(poly) {
        return poly.map(function(pt) { return pt.x.toFixed(2)+','+pt.y.toFixed(2); }).join(' ');
    }

    function exportSVG() {
        var sw = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
        var sw2 = sw.toFixed(2);
        var marginPx = paper.getMarginPixels(PARAMS.margin);
        var BIG = canvasW + canvasH + 1000;
        var defs = ['<defs>',
            '<clipPath id="mc"><rect x="'+marginPx+'" y="'+marginPx+'" width="'+(canvasW-marginPx*2)+'" height="'+(canvasH-marginPx*2)+'"/></clipPath>'];
        var body = ['<g clip-path="url(#mc)">'];

        instances.forEach(function(inst, instIdx) {
            var P = ep(inst);
            var els = inst.elements;
            var worldEls = els.map(function(el) { return toWorldEl(el, inst); });

            for (var i = 0; i < worldEls.length; i++) {
                var el = worldEls[i];

                // Collect clip-exclusion holes for this element
                var holes = [];

                // Within-instance: later masking elements cut holes
                for (var j = i + 1; j < worldEls.length; j++) {
                    var hasClip = P.compositeMode === 'trim' || (P.compositeMode === 'arcTrim' && els[j].type === 'slice');
                    if (hasClip) {
                        var maskPoly = elementMaskPoly(worldEls[j]);
                        if (maskPoly.length) holes.push({ type: 'poly', pts: maskPoly });
                    }
                }

                var elSVG = el.type === 'slice' ? sliceToSVG(el, sw) : (el.type === 'wedge' ? wedgeToSVG(el, sw) : null);
                if (!elSVG) continue;

                if (holes.length === 0) {
                    body.push(elSVG);
                } else {
                    var cpId = 'cp_' + instIdx + '_' + i;
                    var cpLines = ['<clipPath id="' + cpId + '" clip-rule="evenodd">',
                        '<rect x="-' + BIG + '" y="-' + BIG + '" width="' + (BIG*2) + '" height="' + (BIG*2) + '"/>'];
                    holes.forEach(function(h) {
                        if (h.type === 'poly')
                            cpLines.push('<polygon points="' + polyToSVGPoints(h.pts) + '"/>');
                        else if (h.type === 'circle')
                            cpLines.push('<circle cx="' + h.cx + '" cy="' + h.cy + '" r="' + h.r + '"/>');
                    });
                    cpLines.push('</clipPath>');
                    defs.push(cpLines.join(''));
                    body.push('<g clip-path="url(#' + cpId + ')">' + elSVG + '</g>');
                }
            }
        });

        defs.push('</defs>');
        body.push('</g>');

        var _sigG = (window._signatureConfig && window._signatureConfig.enabled &&
                     !window._signatureConfig.suppressExport &&
                     window.Signature && typeof window.Signature.buildSignatureSVG === 'function')
            ? window.Signature.buildSignatureSVG(window._signatureConfig, canvasW, canvasH, marginPx,
                function(mm){ return paper.mmToPixels(mm); }, 'Artproofs', globalSeed)
            : '';
        var svg = ['<?xml version="1.0" encoding="utf-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="'+canvasW+'" height="'+canvasH+'" viewBox="0 0 '+canvasW+' '+canvasH+'">']
            .concat(defs).concat(body).concat(_sigG ? [_sigG] : []).concat(['</svg>']).join('\n');
        var blob = new Blob([svg], { type: 'image/svg+xml' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'artproofs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.svg';
        a.click(); URL.revokeObjectURL(url);
    }

    // ---- scoped control sync ----

    function syncScopedControls() {
        var inst = (selectedInst >= 0 && selectedInst < instances.length) ? instances[selectedInst] : null;
        if (!inst) return;
        var P = ep(inst);
        _syncingControls = true;

        function syncRange(id, rawVal) {
            var pdef = api.params.find(function(x) { return x.id === id; });
            if (pdef) pdef.value = rawVal;
            var inp = document.getElementById(id);
            if (inp) inp.value = rawVal;
            var lbl = document.getElementById(id + 'Value');
            if (lbl) lbl.textContent = rawVal;
        }
        function syncChips(id, val) {
            var pdef = api.params.find(function(x) { return x.id === id; });
            if (pdef) pdef.value = val;
            var inp = document.getElementById(id);
            if (inp) { inp.value = Array.isArray(val) ? JSON.stringify(val) : String(val); inp.dispatchEvent(new Event('input')); }
        }
        var s100 = function(v) { return Math.round(v * 100); };
        syncRange('layerWidthMean',    s100(P.layerWidthMean));
        syncRange('layerWidthSD',      s100(P.layerWidthSD));
        syncRange('eltsPerLayerMean',  s100(P.eltsPerLayerMean));
        syncRange('eltsPerLayerSD',    s100(P.eltsPerLayerSD));
        syncRange('fillFactor',        s100(P.fillFactor));
        syncRange('sliceProb',         s100(P.sliceProb));
        syncRange('fillBlackProb',     s100(P.fillBlackProb));
        syncRange('wedgeCount',        s100(P.wedgeCount));
        syncRange('wedgeThetaSize',    s100(P.wedgeThetaSize));
        syncRange('wedgeRadius',       s100(P.wedgeRadius));
        syncRange('ringConcentricity', P.ringConcentricity);
        syncRange('arcConcentricity',  P.arcConcentricity);
        syncRange('fillAngle',         P.fillAngle);
        syncRange('fillJitter',        P.fillJitter);
        syncChips('compositeMode', P.compositeMode);
        syncChips('fillStyle',     P.fillStyles);
        var palPdef = api.params.find(function(x) { return x.id === 'palette'; });
        if (palPdef && typeof palPdef._setUIValue === 'function') palPdef._setUIValue(P.palette);

        _syncingControls = false;
    }

    // ---- randomize helpers ----

    function randomizeArtParams(s) {
        function rnd(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
        s.layerWidthMean   = rnd(10, 70) / 100;
        s.layerWidthSD     = rnd(5,  40) / 100;
        s.eltsPerLayerMean = rnd(10, 80) / 100;
        s.eltsPerLayerSD   = rnd(5,  40) / 100;
        s.sliceProb        = rnd(50, 100) / 100;
        s.fillBlackProb    = rnd(20, 80) / 100;
        s.wedgeCount       = rnd(0,  60) / 100;
        s.wedgeThetaSize   = rnd(10, 60) / 100;
        s.wedgeRadius      = rnd(20, 80) / 100;
        s.ringConcentricity = rnd(0, 50);
        s.arcConcentricity  = rnd(0, 50);
        s.fillAngle        = rnd(0, 180);
        s.compositeMode    = ['xray', 'arcTrim', 'trim'][Math.floor(Math.random() * 3)];
        var fillOpts = ['arcs','hatch','sketchHatch','streakHatch','zigzagHatch','crosshatch','waves','tileSprigs','tileRibbons','dots'];
        var fp = fillOpts.slice(), fills = [];
        var fcount = 1 + Math.floor(Math.random() * 3);
        while (fills.length < fcount && fp.length) fills.push(fp.splice(Math.floor(Math.random() * fp.length), 1)[0]);
        s.fillStyles = fills;
    }

    // ---- interaction ----

    function getPointer() {
        var rect = p.canvas.getBoundingClientRect();
        return { x: (p.winMouseX - rect.left) * (p.width / rect.width), y: (p.winMouseY - rect.top) * (p.height / rect.height) };
    }

    function pointerIsOnCanvas() {
        if (!p.canvas) return false;
        var rect = p.canvas.getBoundingClientRect();
        return p.winMouseX >= rect.left && p.winMouseX <= rect.right && p.winMouseY >= rect.top && p.winMouseY <= rect.bottom;
    }

    function instRadius(inst) { return baseRadius * inst.scale; }

    function getHandles(idx) {
        var inst = instances[idx], r = instRadius(inst), cos = Math.cos(inst.rotation), sin = Math.sin(inst.rotation);
        var corners = [
            { x: inst.x + (-r*0.707)*cos - (-r*0.707)*sin, y: inst.y + (-r*0.707)*sin + (-r*0.707)*cos },
            { x: inst.x + ( r*0.707)*cos - (-r*0.707)*sin, y: inst.y + ( r*0.707)*sin + (-r*0.707)*cos },
            { x: inst.x + ( r*0.707)*cos - ( r*0.707)*sin, y: inst.y + ( r*0.707)*sin + ( r*0.707)*cos },
            { x: inst.x + (-r*0.707)*cos - ( r*0.707)*sin, y: inst.y + (-r*0.707)*sin + ( r*0.707)*cos }
        ];
        return { cx: inst.x, cy: inst.y, r: r, corners: corners, rotate: { x: inst.x + sin*(r+36), y: inst.y - cos*(r+36) } };
    }

    function drawHandles(idx) {
        var h = getHandles(idx), inst = instances[idx];
        p.push(); p.noFill(); p.stroke(80,160,255,200); p.strokeWeight(1.5);
        p.ellipse(h.cx, h.cy, h.r*2, h.r*2);
        p.stroke(80,160,255,130);
        p.line(h.cx + Math.sin(inst.rotation)*h.r, h.cy - Math.cos(inst.rotation)*h.r, h.rotate.x, h.rotate.y);
        p.fill(80,160,255,200); p.noStroke();
        p.circle(h.rotate.x, h.rotate.y, 22);
        h.corners.forEach(function(c) { p.circle(c.x, c.y, 14); });
        p.pop();
    }

    function findHit(pointer) {
        if (selectedInst >= 0 && selectedInst < instances.length) {
            var h = getHandles(selectedInst);
            if (Math.hypot(pointer.x-h.rotate.x, pointer.y-h.rotate.y) <= 14) return { type: 'rotate', idx: selectedInst };
            for (var ci = 0; ci < h.corners.length; ci++)
                if (Math.hypot(pointer.x-h.corners[ci].x, pointer.y-h.corners[ci].y) <= 10)
                    return { type: 'scale', idx: selectedInst };
        }
        for (var i = instances.length-1; i >= 0; i--)
            if (Math.hypot(pointer.x-instances[i].x, pointer.y-instances[i].y) <= instRadius(instances[i]) + 8)
                return { type: 'move', idx: i };
        return null;
    }

    p.mousePressed = function() {
        if (!pointerIsOnCanvas()) return;
        var ptr = getPointer(), hit = findHit(ptr);
        if (!hit) { selectedInst = -1; dragTarget = null; p.redraw(); return; }
        var prevSelected = selectedInst;
        selectedInst = hit.idx;
        var inst = instances[hit.idx];
        if (hit.type === 'move') {
            dragTarget = { type: 'move', idx: hit.idx, startX: inst.x, startY: inst.y, pStartX: ptr.x, pStartY: ptr.y };
        } else if (hit.type === 'rotate') {
            dragTarget = { type: 'rotate', idx: hit.idx, startAngle: Math.atan2(ptr.y-inst.y, ptr.x-inst.x) - inst.rotation };
        } else if (hit.type === 'scale') {
            dragTarget = { type: 'scale', idx: hit.idx, startDist: Math.hypot(ptr.x-inst.x, ptr.y-inst.y), startScale: inst.scale };
        }
        if (prevSelected !== selectedInst) syncScopedControls();
        p.redraw(); return false;
    };

    p.mouseDragged = function() {
        if (!dragTarget) return;
        var ptr = getPointer(), inst = instances[dragTarget.idx];
        if (dragTarget.type === 'move') { inst.x = dragTarget.startX + (ptr.x - dragTarget.pStartX); inst.y = dragTarget.startY + (ptr.y - dragTarget.pStartY); }
        else if (dragTarget.type === 'rotate') { inst.rotation = Math.atan2(ptr.y-inst.y, ptr.x-inst.x) - dragTarget.startAngle; }
        else if (dragTarget.type === 'scale') { var dist = Math.hypot(ptr.x-inst.x, ptr.y-inst.y); if (dragTarget.startDist > 1) inst.scale = Math.max(0.05, dragTarget.startScale * dist / dragTarget.startDist); }
        p.redraw(); return false;
    };

    p.mouseReleased = function() { dragTarget = null; };

    // ---- api ----

    var api = {
        hasPause: false,
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'instanceCount', label: 'Instances', type: 'range', min: 1, max: 8, step: 1, value: 1 },
            { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
              value: DEFAULTS.palette.slice(),
              options: [
                { value: '#000000', label: 'Black' }, { value: '#e63946', label: 'Red' },
                { value: '#2196f3', label: 'Blue' },  { value: '#ff9800', label: 'Orange' },
                { value: '#4caf50', label: 'Green' }, { value: '#9c27b0', label: 'Purple' },
                { value: '#00ffff', label: 'Cyan' },  { value: '#ff00ff', label: 'Magenta' },
                { value: '#ffff00', label: 'Yellow' }, { value: 'custom', label: 'Custom' }
              ]},
            { id: 'compositeMode', label: 'Compositing', type: 'select', value: 'arcTrim',
              options: [{ value: 'xray', label: 'Xray' }, { value: 'arcTrim', label: 'Arcs trim, wedges xray' }, { value: 'trim', label: 'Trim all' }] },
            { id: 'layerWidthMean',    label: 'Layer width',        type: 'range', min: 1,   max: 100, step: 1,   value: 30,  group: 'arcs', _toInternal: function(v){return v/100;} },
            { id: 'layerWidthSD',      label: 'Width variation',    type: 'range', min: 0,   max: 100, step: 1,   value: 15,  group: 'arcs', _toInternal: function(v){return v/100;} },
            { id: 'eltsPerLayerMean',  label: 'Segments per ring',  type: 'range', min: 1,   max: 100, step: 1,   value: 40,  group: 'arcs', _toInternal: function(v){return v/100;} },
            { id: 'eltsPerLayerSD',    label: 'Segment variation',  type: 'range', min: 0,   max: 100, step: 1,   value: 20,  group: 'arcs', _toInternal: function(v){return v/100;} },
            { id: 'fillFactor',        label: '% arcs filled',      type: 'range', min: 0,   max: 100, step: 1,   value: 50,  group: 'textures', _toInternal: function(v){return v/100;} },
            { id: 'sliceProb',         label: 'Slice probability',  type: 'range', min: 0,   max: 100, step: 1,   value: 80,  group: 'arcs', _toInternal: function(v){return v/100;} },
            { id: 'fillBlackProb',     label: 'Fill density',       type: 'range', min: 0,   max: 100, step: 1,   value: 50,  group: 'textures', _toInternal: function(v){return v/100;} },
            { id: 'wedgeCount',        label: 'Wedge amount',       type: 'range', min: 0,   max: 100, step: 1,   value: 30,  group: 'wedges', _toInternal: function(v){return v/100;} },
            { id: 'wedgeThetaSize',    label: 'Wedge width',        type: 'range', min: 0,   max: 100, step: 1,   value: 30,  group: 'wedges', _toInternal: function(v){return v/100;} },
            { id: 'wedgeRadius',       label: 'Wedge reach',        type: 'range', min: 0,   max: 100, step: 1,   value: 50,  group: 'wedges', _toInternal: function(v){return v/100;} },
            { id: 'ringConcentricity', label: 'Ring concentricity', type: 'range', min: 0,   max: 100, step: 1,   value: 0,   group: 'arcs' },
            { id: 'arcConcentricity',  label: 'Arc concentricity',  type: 'range', min: 0,   max: 100, step: 1,   value: 0,   group: 'arcs' },
            { id: 'fillStyle', label: 'Fill textures', type: 'select', multiSelect: true, value: ['arcs'], group: 'textures',
              options: [
                { value: 'arcs',        label: 'Arcs (default)' }, { value: 'hatch',       label: 'Hatch' },
                { value: 'sketchHatch', label: 'Sketch hatch' },   { value: 'streakHatch', label: 'Streak hatch' },
                { value: 'zigzagHatch', label: 'Zigzag hatch' },   { value: 'crosshatch',  label: 'Crosshatch' },
                { value: 'waves',       label: 'Waves' },          { value: 'tileSprigs',  label: 'Sprig tile' },
                { value: 'tileRibbons', label: 'Ribbon tile' },    { value: 'dots',        label: 'Dots' },
                { value: 'bigDots',     label: 'Big dots' },       { value: 'mixedDots',   label: 'Mixed dots' },
                { value: 'none',        label: 'None' }
              ]},
            { id: 'fillAngle',  label: 'Fill angle°', type: 'range', min: 0, max: 180, step: 1, value: 45,  group: 'textures',
              visibleWhen: { param: 'fillStyle', values: ['hatch','sketchHatch','streakHatch','zigzagHatch','crosshatch','waves','tileSprigs','tileRibbons'] } },
            { id: 'fillJitter', label: 'Fill jitter', type: 'range', min: 0, max: 100, step: 1, value: 0,   group: 'textures' },
            { id: 'penWidthMm', label: 'Pen width (mm)', type: 'range', min: 0.1, max: 2.0, step: 0.1, value: 0.4 },
            { id: 'viewMode',   label: 'View mode', type: 'select', value: 'multiply',
              options: [{ value: 'normal', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }] }
        ]),
        regenerate: function() { resizeIfNeeded(); buildAllInstances(); try { p.redraw(); } catch(e) {} },
        reseed: function() {
            if (selectedInst >= 0 && selectedInst < instances.length) {
                instances[selectedInst].seed = (Math.floor(Math.random() * 1e8) + 1) >>> 0;
                buildInstElements(instances[selectedInst]);
            } else {
                globalSeed = Math.floor(Math.random() * 1e8) + 1;
                instances.forEach(function(inst, i) {
                    inst.seed = (globalSeed + i * 0x9B74E17) >>> 0;
                    buildInstElements(inst);
                });
            }
            try { p.redraw(); } catch(e) {}
        },
        randomize: function() {
            if (selectedInst >= 0 && selectedInst < instances.length) {
                var inst = instances[selectedInst];
                if (!inst.settings) inst.settings = {};
                randomizeArtParams(inst.settings);
                inst.seed = (Math.floor(Math.random() * 1e8) + 1) >>> 0;
                var marginPx = paper.getMarginPixels(PARAMS.margin) + baseRadius;
                inst.x = marginPx + Math.random() * (canvasW - marginPx * 2);
                inst.y = marginPx + Math.random() * (canvasH - marginPx * 2);
                buildInstElements(inst);
                syncScopedControls();
            } else {
                randomizeArtParams(DEFAULTS);
                globalSeed = Math.floor(Math.random() * 1e8) + 1;
                var marginPx = paper.getMarginPixels(PARAMS.margin) + baseRadius;
                instances.forEach(function(inst, i) {
                    inst.settings = {};
                    inst.seed = (globalSeed + i * 0x9B74E17) >>> 0;
                    inst.x = marginPx + Math.random() * (canvasW - marginPx * 2);
                    inst.y = marginPx + Math.random() * (canvasH - marginPx * 2);
                    buildInstElements(inst);
                });
                syncScopedControls();
            }
            try { p.redraw(); } catch(e) {}
        },
        getRecipe: function() {
            return { state: {
                globalSeed: globalSeed,
                defaults: JSON.parse(JSON.stringify(DEFAULTS)),
                instances: instances.map(function(inst) {
                    return { x: inst.x, y: inst.y, scale: inst.scale, rotation: inst.rotation,
                             seed: inst.seed, settings: JSON.parse(JSON.stringify(inst.settings || {})) };
                })
            }};
        },
        applyRecipeState: function(state) {
            if (!state) return;
            if (Number.isFinite(Number(state.globalSeed))) globalSeed = Number(state.globalSeed);
            if (state.defaults) for (var k in state.defaults) DEFAULTS[k] = state.defaults[k];
            if (Array.isArray(state.instances) && state.instances.length) {
                PARAMS.instanceCount = state.instances.length;
                var pdef = api.params.find(function(x) { return x.id === 'instanceCount'; });
                if (pdef) pdef.value = PARAMS.instanceCount;
                baseRadius = computeBaseRadius();
                instances = state.instances.map(function(si) {
                    return { x: si.x, y: si.y, scale: si.scale||1, rotation: si.rotation||0,
                             seed: si.seed||globalSeed, settings: si.settings||{}, elements: [] };
                });
                instances.forEach(function(inst) { buildInstElements(inst); });
            } else {
                buildAllInstances();
            }
            try { p.redraw(); } catch(e) {}
        },
        togglePause: function() { return false; },
        setParam: function(name, rawVal) {
            var pdef = api.params.find(function(x) { return x.id === name; });
            if (pdef) pdef.value = rawVal;
            if (_syncingControls) return;
            var val = (pdef && pdef._toInternal) ? pdef._toInternal(Number(rawVal)) : rawVal;

            // Global-only params
            if (name === 'paperSize')  { PARAMS.paperSize = val; resizeIfNeeded(); resetInstLayout(); try { p.redraw(); } catch(e) {} return; }
            if (name === 'margin')     { PARAMS.margin = Number(val); buildAllInstances(); try { p.redraw(); } catch(e) {} return; }
            if (name === 'instanceCount') {
                PARAMS.instanceCount = Math.max(1, Math.min(8, Math.round(Number(rawVal))));
                selectedInst = -1; resetInstLayout(); try { p.redraw(); } catch(e) {} return;
            }
            if (name === 'penWidthMm') { PARAMS.penWidthMm = Number(rawVal); try { p.redraw(); } catch(e) {} return; }
            if (name === 'viewMode')   { PARAMS.viewMode = val; try { p.redraw(); } catch(e) {} return; }

            // Scopable params — write to selected instance or DEFAULTS
            var target = (selectedInst >= 0 && selectedInst < instances.length) ? instances[selectedInst] : null;
            var store  = target ? (target.settings || (target.settings = {})) : DEFAULTS;

            if (name === 'palette')            store.palette = Array.isArray(val) && val.length ? val : DEFAULTS.palette;
            else if (name === 'compositeMode') store.compositeMode = val;
            else if (name === 'fillStyle') {
                var _fv = val;
                if (typeof _fv === 'string') { try { _fv = JSON.parse(_fv); } catch(e) { _fv = [_fv]; } }
                if (!Array.isArray(_fv)) _fv = [String(_fv)];
                _fv = _fv.filter(function(v) { return v && v !== 'random'; });
                store.fillStyles = _fv.length ? _fv : ['arcs'];
            }
            else if (name === 'fillAngle')         store.fillAngle = Number(rawVal);
            else if (name === 'fillJitter')        store.fillJitter = Number(rawVal);
            else if (name === 'ringConcentricity') store.ringConcentricity = Number(rawVal);
            else if (name === 'arcConcentricity')  store.arcConcentricity  = Number(rawVal);
            else if (['layerWidthMean','layerWidthSD','eltsPerLayerMean','eltsPerLayerSD',
                      'fillFactor','sliceProb','fillBlackProb','wedgeCount','wedgeThetaSize','wedgeRadius'].indexOf(name) !== -1)
                store[name] = val;

            if (target) { buildInstElements(target); }
            else { instances.forEach(function(inst) { buildInstElements(inst); }); }
            try { p.redraw(); } catch(e) {}
        },
        shuffleLayout: function() {
            var marginPx = paper.getMarginPixels(PARAMS.margin) + baseRadius;
            var target = (selectedInst >= 0 && selectedInst < instances.length) ? [instances[selectedInst]] : instances;
            target.forEach(function(inst) {
                inst.x = marginPx + Math.random() * (canvasW - marginPx * 2);
                inst.y = marginPx + Math.random() * (canvasH - marginPx * 2);
                inst.scale = 0.4 + Math.random() * 1.0;
            });
            try { p.redraw(); } catch(e) {}
        },
        redraw: function() { try { p.redraw(); } catch(e) {} },
        getSignatureSeed: function() { return globalSeed; },
        saveSVG: function() { exportSVG(); }
    };

    function resizeIfNeeded() {
        paper.resizeCanvasToPaper(p, PARAMS.paperSize);
        canvasW = p.width; canvasH = p.height;
    }

    p.registerSketchAPI = function(register) { if (typeof register === 'function') register(api); };

    p.setup = function() {
        var container = document.getElementById('make-sketch');
        var helpEl;
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;max-width:900px;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            helpEl.textContent = 'Click to select. Drag to move. Corner handles = scale. Top handle = rotate. Params apply to selected instance only.';
            container.appendChild(helpEl);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        canvasW = p.width; canvasH = p.height;
        p.noLoop();
        resetInstLayout();
    };

    p.draw = function() {
        p.blendMode(p.BLEND);
        p.background(255);
        p.blendMode(PARAMS.viewMode === 'multiply' ? p.MULTIPLY : p.BLEND);
        paper.drawPaperBorder(p);
        var baseSW = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
        p.strokeWeight(baseSW);
        p.noFill();
        var marginPx = paper.getMarginPixels(PARAMS.margin);
        var ctx = p.drawingContext;
        ctx.save();
        ctx.beginPath();
        ctx.rect(marginPx, marginPx, canvasW - marginPx * 2, canvasH - marginPx * 2);
        ctx.clip();

        instances.forEach(function(inst, instIdx) {
            var P = ep(inst);
            p.push();
            p.translate(inst.x, inst.y);
            p.rotate(inst.rotation);
            p.scale(inst.scale);
            p.strokeWeight(baseSW / inst.scale);
            for (var i = 0; i < inst.elements.length; i++) {
                var elt = inst.elements[i];
                var mask = P.compositeMode === 'trim' || (P.compositeMode === 'arcTrim' && elt.type === 'slice');
                if (i > 0 && mask) drawElementMask(elt);
                if (elt.type === 'slice') drawSlice(elt);
                else if (elt.type === 'wedge') drawWedge(elt);
            }
            p.pop();
        });

        ctx.restore();
        p.blendMode(p.BLEND);
        if (selectedInst >= 0 && selectedInst < instances.length) drawHandles(selectedInst);
    };
};
