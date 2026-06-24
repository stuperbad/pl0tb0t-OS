window.sketches = window.sketches || {};
window.sketches['zigzag'] = function(p) {
    var paper = window.makeSketchUtils;

    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        BLOCK_COUNT: 0,
        HATCH_SPACING: 3.5,
        HATCH_JITTER: 0.4,
        HATCH_WEIGHT_MM: 0.4,
        ZIGZAG_MODE: 'random',
        ZIGZAG_LENGTH: 120,
        CURVE_ENABLED: true,
        CURVE_MAG: 1,
        CURVE_FREQ: 0.5,
        ALPHA: 100,
        COLOR_MODE: 'perShape',
        viewMode: 'multiply',
        palette: ['#ff3333', '#3366ff', '#ff8800', '#33cc66', '#8833cc'],
        SQUIGGLE_AMP: 0
    };
    var blocks = [];
    var paused = false;
    var selectedBlock = -1;
    var dragTarget = null;
    var helpEl = null;
    var HANDLE_R = 14;
    var selectedRect = -1;

    var api = {
        stylePresets: [
            { label: 'Loose sketch', values: { zigzagMode:'random', zigzagLength:120, hatchSpacing:4, hatchJitter:6, curveMag:14, squiggleMag:4 } },
            { label: 'Crisp 45s', values: { zigzagMode:'snap45', zigzagLength:100, hatchSpacing:3, hatchJitter:0, curveMag:0, squiggleMag:0 } },
            { label: 'Tight 30/60', values: { zigzagMode:'snap3060', zigzagLength:80, hatchSpacing:2, hatchJitter:1, curveMag:4 } },
            { label: 'Wavy squiggle', values: { squiggleMag:14, curveMag:20, zigzagLength:160, hatchSpacing:5, zigzagMode:'random' } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
              value: ['#ff3333', '#3366ff', '#ff8800', '#33cc66', '#8833cc'],
              options: [
                { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' },
                { value: '#ffff00', label: 'Yellow' },
                { value: '#000000', label: 'Black' },
                { value: '#ff3333', label: 'Red' },
                { value: '#33cc66', label: 'Green' },
                { value: '#3366ff', label: 'Blue' },
                { value: '#8833cc', label: 'Purple' },
                { value: '#ff8800', label: 'Orange' },
                { value: 'custom', label: 'Custom' }
              ]},
            { id: 'blockCount',    label: 'Block count',    type: 'range', min: 0, max: 8,    step: 1,    value: 0 },
            { id: 'zigzagMode', label: 'Zigzag rules', type: 'select', value: 'random',
              options: [
                { value: 'random', label: 'Loose/random' },
                { value: 'snap45', label: 'Snap 45s' },
                { value: 'snap3060', label: 'Snap 30/60s' }
              ] },
            { id: 'zigzagLength', label: 'Zigzag length', type: 'range', min: 40, max: 260, step: 5, value: 120 },
            { id: 'hatchSpacing',  label: 'Hatch spacing',  type: 'range', min: 1, max: 12,   step: 1,    value: 4 },
            { id: 'hatchJitter',   label: 'Line jitter',    type: 'range', min: 0, max: 10,   step: 1,    value: 4,
              _toInternal: function(v){ return v/10; } },
            { id: 'curveMag',      label: 'Curve mag',      type: 'range', min: 0, max: 30,   step: 1,    value: 10,
              _toInternal: function(v){ return v/10; } },
            { id: 'squiggleMag',   label: 'Squiggle',       type: 'range', min: 0, max: 20,   step: 1,    value: 0,
              _toInternal: function(v){ return v/4; } },
            { id: 'hatchWeight',   label: 'Pen width (mm)', type: 'range', min: 0.1, max: 2.0, step: 0.1, value: 0.4 },
            { id: 'alpha',         label: 'Opacity',        type: 'range', min: 10, max: 255, step: 5,    value: 100 },
            { id: 'viewMode', label: 'View mode', type: 'select', value: 'multiply',
              options: [
                { value: 'normal', label: 'Normal' },
                { value: 'multiply', label: 'Multiply' }
              ]}
        ]),
        regenerate: function() { resizeIfNeeded(); p.redraw(); },
        togglePause: function() { paused = !paused; return paused; },
        reseed: function() {
            if (selectedBlock >= 0 && blocks[selectedBlock]) {
                blocks[selectedBlock] = makeZigBlock();
            } else {
                randomizeAll();
            }
            p.redraw();
        },
        randomize: function() {
            if (selectedBlock >= 0 && blocks[selectedBlock]) {
                blocks[selectedBlock] = makeZigBlock();
            } else {
                randomizeAll();
            }
            p.redraw();
        },
        redraw: function() { try { p.redraw(); } catch(e) {} },
        getSignatureSeed: function() {
            return blocks.reduce(function(acc, b) { return (acc ^ b.seed) >>> 0; }, 0);
        },
        getRecipe: function() {
            return { state: { blocks: blocks.map(blockToRecipe) } };
        },
        applyRecipeState: function(state) {
            if (state && Array.isArray(state.blocks)) {
                blocks = state.blocks.map(blockFromRecipe).filter(Boolean);
                p.redraw();
            }
        },
        saveSVG: function() {
            var dims = paper.getPaperPixels(PARAMS.paperSize);
            var strokeWidth = Math.max(0.5, paper.mmToPixels(PARAMS.HATCH_WEIGHT_MM));
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || new Date().toISOString().replace(/[:.]/g,'-');
            var filename = '90percentart-zigzag-' + ts + '.svg';
            var parts = [];

            parts.push('<?xml version="1.0" encoding="UTF-8"?>');
            parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + dims.width + '" height="' + dims.height + '" viewBox="0 0 ' + dims.width + ' ' + dims.height + '">');
            parts.push('<rect x="0" y="0" width="' + dims.width + '" height="' + dims.height + '" fill="#ffffff"/>');
            parts.push('<rect x="1" y="1" width="' + (dims.width - 2) + '" height="' + (dims.height - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
            parts.push('<g style="mix-blend-mode:multiply">');

            for (var bi = 0; bi < blocks.length; bi++) {
                exportZigBlock(parts, blocks[bi], strokeWidth);
            }

            parts.push('</g>');
            if (window._signatureConfig && window._signatureConfig.enabled &&
                !window._signatureConfig.suppressExport &&
                window.Signature && typeof window.Signature.buildSignatureSVG === 'function') {
                var _zExpMargPx = paper.getMarginPixels(PARAMS.margin);
                var _zExpSeed = blocks.reduce(function(acc, b) { return (acc ^ b.seed) >>> 0; }, 0);
                var _zSigG = window.Signature.buildSignatureSVG(window._signatureConfig,
                    dims.width, dims.height, _zExpMargPx,
                    function(mm){ return paper.mmToPixels(mm); }, 'Zigzag', _zExpSeed);
                if (_zSigG) parts.push(_zSigG);
            }
            parts.push('</svg>');
            downloadSvgString(parts.join('\n'), filename);
        },
        setParam: function(name, val) {
            var pdef = api.params.find(function(x){ return x.id === name; });
            if (pdef) pdef.value = val;
            applyParam(name, val);
        }
    };

    function applyParam(name, rawVal) {
        var pdef = api.params.find(function(x){ return x.id === name; });
        var val = (pdef && pdef._toInternal) ? pdef._toInternal(rawVal) : rawVal;
        if (name === 'paperSize')   PARAMS.paperSize = val;
        if (name === 'margin')      PARAMS.margin = Number(val);
        if (name === 'blockCount')   PARAMS.BLOCK_COUNT = val;
        if (name === 'zigzagMode')   PARAMS.ZIGZAG_MODE = val;
        if (name === 'zigzagLength') PARAMS.ZIGZAG_LENGTH = Number(val);
        if (name === 'hatchSpacing') PARAMS.HATCH_SPACING = val;
        if (name === 'hatchWeight')  PARAMS.HATCH_WEIGHT_MM = Number(val);
        if (name === 'hatchJitter')  PARAMS.HATCH_JITTER = val;
        if (name === 'curveMag')     PARAMS.CURVE_MAG = val;
        if (name === 'squiggleMag')  PARAMS.SQUIGGLE_AMP = val;
        if (name === 'alpha')        { PARAMS.ALPHA = val; for (var b of blocks) setBlockAlpha(b, val); }
        if (name === 'viewMode')     PARAMS.viewMode = val;
        if (name === 'palette')      { PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette; recolor(); }
        if (name === 'blockCount') syncBlockCount();
        if (name === 'zigzagMode' || name === 'zigzagLength') rebuildBlockConnectors();
        if (name === 'paperSize' || name === 'margin') randomizeAll();
    }

    function resizeIfNeeded() {
        paper.resizeCanvasToPaper(p, PARAMS.paperSize);
    }

    p.registerSketchAPI = function(register) { if (typeof register === 'function') register(api); };

    p.setup = function() {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            helpEl.textContent = 'Tap a block to select it, then tap a rect inside to edit individually. Drag to move. Corner handles to scale. Tap empty space to deselect.';
            container.appendChild(helpEl);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        p.pixelDensity(1);
        p.noLoop();
        randomizeAll();
    };

    p.draw = function() {
        if (paused) return;
        p.background(255);
        paper.drawPaperBorder(p);
        for (var b of blocks) drawZigBlock(b);
        if (selectedBlock >= 0 && blocks[selectedBlock]) {
            if (selectedRect >= 0 && blocks[selectedBlock].rects[selectedRect]) {
                drawRectHandles(blocks[selectedBlock].rects[selectedRect]);
            } else {
                drawSelectionHandles(blocks[selectedBlock]);
            }
        }
    };

    // ---- color helpers ----
    function makeColorWithAlpha(hex) {
        var c = p.color(hex);
        c.setAlpha(PARAMS.ALPHA);
        return c;
    }

    function buildColors(rectCount, connCount) {
        var pal = (PARAMS.palette && PARAMS.palette.length) ? PARAMS.palette : ['#000000'];
        var colors = { rects: [], conns: [] };
        for (var i = 0; i < rectCount; i++) colors.rects.push(makeColorWithAlpha(p.random(pal)));
        for (var i = 0; i < connCount; i++)  colors.conns.push(makeColorWithAlpha(p.random(pal)));
        return colors;
    }

    function recolor() {
        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            b.colors = buildColors(b.rects.length, b.rects.length - 1);
            setBlockAlpha(b, PARAMS.ALPHA);
        }
    }

    function setBlockAlpha(block, alpha) {
        var setA = function(col) { if (col) col.setAlpha(alpha); };
        block.colors.rects.forEach(setA);
        block.colors.conns.forEach(setA);
    }

    // ---- geometry helpers ----
    function normal2(dx, dy) { var L = Math.hypot(dx,dy)||1; return {x:-dy/L, y:dx/L}; }

    function segIntersectT(P, Q, A, B) { return plotFills.segIntersectT(P, Q, A, B); }

    function hatchPolygon(poly, angle, spacing, jitter, weight) {
        var dir = {x:Math.cos(angle), y:Math.sin(angle)};
        var nrm = normal2(dir.x, dir.y);
        var proj = function(pt) { return nrm.x*pt.x + nrm.y*pt.y; };
        var minP=Infinity, maxP=-Infinity;
        poly.forEach(function(pt){ var pr=proj(pt); if(pr<minP)minP=pr; if(pr>maxP)maxP=pr; });
        var pad = 2*spacing;
        var minK = Math.floor((minP-pad)/spacing);
        var maxK = Math.ceil((maxP+pad)/spacing);

        for (var k=minK; k<=maxK; k++) {
            var off = k*spacing;
            var p0 = {x:-5000*dir.x+off*nrm.x, y:-5000*dir.y+off*nrm.y};
            var p1 = {x: 5000*dir.x+off*nrm.x, y: 5000*dir.y+off*nrm.y};
            var ts = [];
            for (var i=0; i<poly.length; i++) {
                var A=poly[i], B=poly[(i+1)%poly.length];
                var t = segIntersectT(p0,p1,A,B);
                if (t!==null) ts.push(t);
            }
            ts.sort(function(a,b){return a-b;});
            for (var i=0; i+1<ts.length; i+=2) {
                var AA = {x:p0.x+(p1.x-p0.x)*ts[i],   y:p0.y+(p1.y-p0.y)*ts[i]};
                var BB = {x:p0.x+(p1.x-p0.x)*ts[i+1], y:p0.y+(p1.y-p0.y)*ts[i+1]};
                var jx = jitter ? p.randomGaussian(0,jitter) : 0;
                var jy = jitter ? p.randomGaussian(0,jitter) : 0;
                drawHatchLine({x:AA.x+jx, y:AA.y+jy}, {x:BB.x+jx, y:BB.y+jy});
            }
        }
    }

    function drawHatchLine(A, B) {
        var dx=B.x-A.x, dy=B.y-A.y;
        var len=Math.hypot(dx,dy)||1;
        var nx=-dy/len, ny=dx/len;
        var lenScale=p.constrain(len/30,0,1);
        var amp=PARAMS.CURVE_ENABLED ? PARAMS.CURVE_MAG*lenScale : 0;
        var freq=PARAMS.CURVE_FREQ*lenScale+0.0001;
        var sqAmp=PARAMS.SQUIGGLE_AMP*lenScale;
        var sqN=Math.max(2, Math.min(12, Math.round(len/12)));
        if (amp<0.01 && sqAmp<0.01) { p.line(A.x,A.y,B.x,B.y); return; }
        var phase=p.random(p.TWO_PI), phase2=p.random(p.TWO_PI);
        var segs=Math.max(8, sqN*4);
        p.noFill();
        p.beginShape();
        for (var i=0;i<=segs;i++) {
            var t=i/segs;
            var off=Math.sin(phase+t*freq*p.TWO_PI)*amp + Math.sin(phase2+t*sqN*p.TWO_PI)*sqAmp;
            p.vertex(A.x+dx*t+nx*off, A.y+dy*t+ny*off);
        }
        p.endShape();
    }

    // ---- block generation ----
    function sampleRectAngle() {
        return p.radians(p.constrain(p.randomGaussian(0,55),-80,80));
    }

    function sampleAngles(count) {
        var angles = [], minSep = p.radians(10);
        for (var i=0;i<count;i++) {
            var ang, tries=0;
            do { ang = sampleRectAngle(); tries++; }
            while (i>0 && Math.abs(Math.atan2(Math.sin(ang-angles[i-1]),Math.cos(ang-angles[i-1])))<minSep && tries<40);
            angles.push(ang);
        }
        return angles;
    }

    function sampleConnAngle() {
        if (PARAMS.ZIGZAG_MODE === 'snap45') {
            return p.radians(p.random([45, 135, 225, 315]));
        }
        if (PARAMS.ZIGZAG_MODE === 'snap3060') {
            return p.radians(p.random([30, 60, 120, 150, 210, 240, 300, 330]));
        }
        var base = p.random([20,30,40,50,60,70]);
        var usePos = p.random() < 0.75;
        if (usePos) {
            return p.radians(p.random()<0.5 ? base : 180-base);
        } else {
            return p.radians(p.random()<0.5 ? 180+base : 360-base);
        }
    }

    function sampleOffset(h) {
        var ang = sampleConnAngle();
        var cosA=Math.cos(ang), sinA=Math.sin(ang);
        var maxX=PARAMS.ZIGZAG_MODE === 'random' ? 260 : 360;
        var maxY=PARAMS.ZIGZAG_MODE === 'random' ? 320 : 420;
        var lims=[];
        if (Math.abs(cosA)>1e-4) lims.push(Math.abs(maxX/cosA));
        if (sinA>0)  lims.push(maxY/sinA);
        if (sinA<0)  lims.push(Math.abs(maxY/sinA));
        var maxLen = lims.length ? Math.min.apply(null,lims.filter(function(n){return isFinite(n)&&n>0;})) : 150;
        var targetLen = Math.max(20, PARAMS.ZIGZAG_LENGTH);
        maxLen = Math.min(maxLen, Math.max(targetLen * 1.45, h*1.25));
        var len;
        if (PARAMS.ZIGZAG_MODE === 'random') {
            var minLen = Math.min(Math.max(25, targetLen * 0.55),maxLen);
            if (minLen>maxLen) minLen=maxLen*0.9;
            len = p.random(minLen,maxLen);
        } else {
            len = Math.min(maxLen, targetLen);
        }
        return {x:len*cosA, y:len*sinA};
    }

    function buildBlockRects(w, h, offs, base) {
        var x=0, y=0, minx=0, maxx=w, miny=-h, maxy=0;
        for (var oi=0; oi<offs.length; oi++) {
            var o = offs[oi];
            x+=o.x; y+=o.y;
            minx=Math.min(minx,x); maxx=Math.max(maxx,x+w);
            miny=Math.min(miny,y-h); maxy=Math.max(maxy,y);
        }
        var pad = Math.max(24, paper.getMarginPixels(PARAMS.margin));
        var loX = pad-minx, hiX = p.width-pad-maxx;
        var loY = pad-miny, hiY = p.height-pad-maxy;
        var baseX = base ? base.x : (hiX >= loX ? p.random(loX, hiX) : (loX + hiX) / 2);
        var baseY = base ? base.y : (hiY >= loY ? p.random(loY, hiY) : (loY + hiY) / 2);
        baseX = hiX >= loX ? p.constrain(baseX, loX, hiX) : (loX + hiX) / 2;
        baseY = hiY >= loY ? p.constrain(baseY, loY, hiY) : (loY + hiY) / 2;

        var rects=[];
        var cur={x:baseX, y:baseY};
        rects.push({bl:{x:cur.x,y:cur.y}, w:w, h:h});
        for (var oj=0; oj<offs.length; oj++) {
            cur={x:cur.x+offs[oj].x, y:cur.y+offs[oj].y};
            rects.push({bl:{x:cur.x,y:cur.y}, w:w, h:h});
        }
        return rects;
    }

    function makeBlockOffsets(h, conns) {
        var offs = [];
        for (var k=0;k<conns;k++) offs.push(sampleOffset(h));
        return offs;
    }

    function makeZigBlock(shapeHint) {
        var w = shapeHint && shapeHint.w ? shapeHint.w : p.random(200,340);
        var h = shapeHint && shapeHint.h ? shapeHint.h : p.random(90,140);
        var segCount = shapeHint && shapeHint.segCount ? shapeHint.segCount : p.random([3,5,7]);
        var rectCount = (segCount+1)>>1;
        var conns = rectCount-1;
        var offs = makeBlockOffsets(h, conns);
        var rects = buildBlockRects(w, h, offs);

        return {
            rects: rects,
            offs: offs,
            w: w,
            h: h,
            segCount: segCount,
            colors: buildColors(rectCount,conns),
            angles: sampleAngles(rectCount),
            seed: Math.floor(p.random(1, 1000000000))
        };
    }

    function rectCorners(bl,w,h) {
        return [
            {x:bl.x,   y:bl.y},
            {x:bl.x+w, y:bl.y},
            {x:bl.x+w, y:bl.y-h},
            {x:bl.x,   y:bl.y-h}
        ];
    }

    function drawZigBlock(block) {
        var sp=PARAMS.HATCH_SPACING, jt=PARAMS.HATCH_JITTER, wt=Math.max(0.5, paper.mmToPixels(PARAMS.HATCH_WEIGHT_MM));
        var g = p.createGraphics(p.width, p.height);
        g.strokeCap(p.SQUARE);
        g.noFill();
        g.strokeWeight(wt);
        p.randomSeed(block.seed);

        // rectangles
        for (var i=0;i<block.rects.length;i++) {
            var rect=block.rects[i];
            var poly=rectCorners(rect.bl,rect.w,rect.h);
            g.stroke(block.colors.rects[i]||block.colors.rects[0]);
            hatchPolygonG(g, poly, block.angles[i], sp, jt, wt);
        }

        // connectors
        for (var i=0;i<block.rects.length-1;i++) {
            var rA=block.rects[i], rB=block.rects[i+1];
            var [a0,a1,a2,a3]=rectCorners(rA.bl,rA.w,rA.h);
            var [b0,b1,b2,b3]=rectCorners(rB.bl,rB.w,rB.h);
            var poly=[a2,a3,b0,b1];
            var connAng = Math.atan2(Math.sin(block.angles[i])+Math.sin(block.angles[i+1]),
                                     Math.cos(block.angles[i])+Math.cos(block.angles[i+1]));
            g.stroke(block.colors.conns[i]||block.colors.rects[i]||block.colors.rects[0]);
            hatchPolygonG(g, poly, connAng, sp, jt, wt);
        }

        p.push();
        p.blendMode(PARAMS.viewMode === 'multiply' ? p.MULTIPLY : p.BLEND);
        p.image(g,0,0);
        p.pop();
        g.remove();
    }

    function exportZigBlock(parts, block, strokeWidth) {
        var sp = PARAMS.HATCH_SPACING;
        var jt = PARAMS.HATCH_JITTER;
        p.randomSeed(block.seed);

        for (var i = 0; i < block.rects.length; i++) {
            var rect = block.rects[i];
            var poly = rectCorners(rect.bl, rect.w, rect.h);
            exportHatchPolygon(parts, poly, block.angles[i], sp, jt, strokeWidth, block.colors.rects[i] || block.colors.rects[0]);
        }

        for (var j = 0; j < block.rects.length - 1; j++) {
            var rA = block.rects[j], rB = block.rects[j + 1];
            var a = rectCorners(rA.bl, rA.w, rA.h);
            var b = rectCorners(rB.bl, rB.w, rB.h);
            var connPoly = [a[2], a[3], b[0], b[1]];
            var connAng = Math.atan2(Math.sin(block.angles[j]) + Math.sin(block.angles[j + 1]),
                                     Math.cos(block.angles[j]) + Math.cos(block.angles[j + 1]));
            exportHatchPolygon(parts, connPoly, connAng, sp, jt, strokeWidth, block.colors.conns[j] || block.colors.rects[j] || block.colors.rects[0]);
        }
    }

    // version of hatchPolygon that draws into a graphics buffer g
    function hatchPolygonG(g, poly, angle, spacing, jitter, weight) {
        var dir={x:Math.cos(angle),y:Math.sin(angle)};
        var nrm={x:-dir.y, y:dir.x};
        var proj=function(pt){return nrm.x*pt.x+nrm.y*pt.y;};
        var minP=Infinity, maxP=-Infinity;
        poly.forEach(function(pt){var pr=proj(pt); if(pr<minP)minP=pr; if(pr>maxP)maxP=pr;});
        var pad=2*spacing, minK=Math.floor((minP-pad)/spacing), maxK=Math.ceil((maxP+pad)/spacing);
        g.strokeWeight(weight); g.noFill(); g.strokeCap(p.SQUARE);
        for (var k=minK;k<=maxK;k++) {
            var off=k*spacing;
            var p0={x:-5000*dir.x+off*nrm.x,y:-5000*dir.y+off*nrm.y};
            var p1={x: 5000*dir.x+off*nrm.x,y: 5000*dir.y+off*nrm.y};
            var ts=[];
            for (var i=0;i<poly.length;i++){
                var A=poly[i],B=poly[(i+1)%poly.length];
                var t=segIntersectT(p0,p1,A,B);
                if(t!==null)ts.push(t);
            }
            ts.sort(function(a,b){return a-b;});
            for (var i=0;i+1<ts.length;i+=2){
                var AA={x:p0.x+(p1.x-p0.x)*ts[i],   y:p0.y+(p1.y-p0.y)*ts[i]};
                var BB={x:p0.x+(p1.x-p0.x)*ts[i+1], y:p0.y+(p1.y-p0.y)*ts[i+1]};
                var jx=jitter?p.randomGaussian(0,jitter):0;
                var jy=jitter?p.randomGaussian(0,jitter):0;
                drawHatchLineG(g,{x:AA.x+jx,y:AA.y+jy},{x:BB.x+jx,y:BB.y+jy});
            }
        }
    }

    function exportHatchPolygon(parts, poly, angle, spacing, jitter, strokeWidth, color) {
        var angleDeg = angle * 180 / Math.PI;
        var stroke = colorToSvg(color);
        var rows = plotFills.hatchPolyRows(poly, angleDeg, spacing);
        var d = plotFills.connectedPathD(rows);
        if (d) parts.push('<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + fmt(strokeWidth) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    }

    function drawHatchLineG(g, A, B) {
        var dx=B.x-A.x, dy=B.y-A.y, len=Math.hypot(dx,dy)||1;
        var nx=-dy/len, ny=dx/len;
        var lenScale=Math.min(len/30,1);
        var amp=PARAMS.CURVE_ENABLED ? PARAMS.CURVE_MAG*lenScale : 0;
        var freq=PARAMS.CURVE_FREQ*lenScale+0.0001;
        var sqAmp=PARAMS.SQUIGGLE_AMP*lenScale;
        var sqN=Math.max(2, Math.min(12, Math.round(len/12)));
        if (amp<0.01 && sqAmp<0.01) { g.line(A.x,A.y,B.x,B.y); return; }
        var phase=p.random(p.TWO_PI), phase2=p.random(p.TWO_PI);
        var segs=Math.max(8, sqN*4);
        g.noFill(); g.beginShape();
        for (var i=0;i<=segs;i++){
            var t=i/segs;
            var off=Math.sin(phase+t*freq*p.TWO_PI)*amp + Math.sin(phase2+t*sqN*p.TWO_PI)*sqAmp;
            g.vertex(A.x+dx*t+nx*off, A.y+dy*t+ny*off);
        }
        g.endShape();
    }

    function appendZigHatch(parts, A, B, stroke, strokeWidth) {
        var dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx,dy)||1;
        var nx = -dy/len, ny = dx/len;
        var lenScale = Math.min(len/30,1);
        var amp = PARAMS.CURVE_ENABLED ? PARAMS.CURVE_MAG*lenScale : 0;
        var freq = PARAMS.CURVE_FREQ*lenScale+0.0001;
        var sqAmp = PARAMS.SQUIGGLE_AMP*lenScale;
        var sqN = Math.max(2, Math.min(12, Math.round(len/12)));
        if (amp<0.01 && sqAmp<0.01) {
            parts.push('<line x1="' + fmt(A.x) + '" y1="' + fmt(A.y) + '" x2="' + fmt(B.x) + '" y2="' + fmt(B.y) + '" ' + strokeAttrs(stroke, strokeWidth) + '/>');
            return;
        }
        var phase = p.random(p.TWO_PI), phase2 = p.random(p.TWO_PI);
        var segs = Math.max(8, sqN*4);
        var pts = [];
        for (var i = 0; i <= segs; i++) {
            var t = i/segs;
            var off = Math.sin(phase+t*freq*p.TWO_PI)*amp + Math.sin(phase2+t*sqN*p.TWO_PI)*sqAmp;
            pts.push(fmt(A.x+dx*t+nx*off) + ',' + fmt(A.y+dy*t+ny*off));
        }
        parts.push('<polyline points="' + pts.join(' ') + '" ' + strokeAttrs(stroke, strokeWidth) + '/>');
    }

    function randomizeAll() {
        blocks.length=0;
        var n=PARAMS.BLOCK_COUNT>0?PARAMS.BLOCK_COUNT:Math.floor(p.random(1,7));
        for (var i=0;i<n;i++) blocks.push(makeZigBlock());
    }

    function syncBlockCount() {
        var target = PARAMS.BLOCK_COUNT > 0 ? PARAMS.BLOCK_COUNT : (blocks.length || Math.floor(p.random(1,7)));
        while (blocks.length < target) blocks.push(makeZigBlock());
        if (blocks.length > target) blocks.length = target;
    }

    function rebuildBlockConnectors() {
        for (var i=0; i<blocks.length; i++) {
            var b = blocks[i];
            var conns = Math.max(0, b.rects.length - 1);
            b.offs = makeBlockOffsets(b.h || b.rects[0].h, conns);
            b.rects = buildBlockRects(b.w || b.rects[0].w, b.h || b.rects[0].h, b.offs, b.rects[0].bl);
        }
    }

    function clonePoint(pt) {
        return { x: Number(pt.x), y: Number(pt.y) };
    }

    function blockToRecipe(block) {
        return {
            rects: block.rects.map(function(rect) {
                return { bl: clonePoint(rect.bl), w: Number(rect.w), h: Number(rect.h) };
            }),
            offs: block.offs.map(clonePoint),
            w: Number(block.w),
            h: Number(block.h),
            segCount: Number(block.segCount),
            colors: {
                rects: block.colors.rects.map(colorHexValue),
                conns: block.colors.conns.map(colorHexValue)
            },
            angles: block.angles.map(Number),
            seed: Number(block.seed)
        };
    }

    function blockFromRecipe(raw) {
        if (!raw || !Array.isArray(raw.rects)) return null;
        return {
            rects: raw.rects.map(function(rect) {
                return {
                    bl: clonePoint(rect.bl || { x: 0, y: 0 }),
                    w: Number(rect.w),
                    h: Number(rect.h)
                };
            }),
            offs: Array.isArray(raw.offs) ? raw.offs.map(clonePoint) : [],
            w: Number(raw.w || (raw.rects[0] && raw.rects[0].w) || 0),
            h: Number(raw.h || (raw.rects[0] && raw.rects[0].h) || 0),
            segCount: Number(raw.segCount || 3),
            colors: {
                rects: ((raw.colors && raw.colors.rects) || ['#000000']).map(makeColorWithAlpha),
                conns: ((raw.colors && raw.colors.conns) || ['#000000']).map(makeColorWithAlpha)
            },
            angles: Array.isArray(raw.angles) ? raw.angles.map(Number) : sampleAngles(raw.rects.length),
            seed: Number(raw.seed || Math.floor(p.random(1, 1000000000)))
        };
    }

    function colorHexValue(col) {
        return '#' + [p.red(col), p.green(col), p.blue(col)].map(function(v){
            var hex = Math.round(v).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    }

    function colorToSvg(col) {
        return {
            stroke: colorHexValue(col),
            opacity: (typeof col._getAlpha === 'function' ? col._getAlpha() : PARAMS.ALPHA) / 255
        };
    }

    function strokeAttrs(stroke, strokeWidth) {
        return 'fill="none" stroke="' + stroke.stroke + '" stroke-opacity="' + fmt(stroke.opacity) + '" stroke-width="' + fmt(strokeWidth) + '" stroke-linecap="square" stroke-linejoin="round"';
    }

    function fmt(n) {
        return Number(n).toFixed(3);
    }

    function downloadSvgString(str, filename) {
        var blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
            a.remove();
            URL.revokeObjectURL(url);
        }, 1000);
    }

    function pointerToCanvas() {
        if (!p.canvas) return { x: p.mouseX, y: p.mouseY };
        var rect = p.canvas.getBoundingClientRect();
        return { x: (p.winMouseX - rect.left) * (p.width / rect.width), y: (p.winMouseY - rect.top) * (p.height / rect.height) };
    }
    function pointerIsOnCanvas() {
        if (!p.canvas) return false;
        var rect = p.canvas.getBoundingClientRect();
        return p.winMouseX >= rect.left && p.winMouseX <= rect.right && p.winMouseY >= rect.top && p.winMouseY <= rect.bottom;
    }
    function blockBBox(block) {
        var minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
        for (var i=0; i<block.rects.length; i++) {
            var corners = rectCorners(block.rects[i].bl, block.rects[i].w, block.rects[i].h);
            for (var j=0; j<corners.length; j++) { if (corners[j].x<minX)minX=corners[j].x; if (corners[j].y<minY)minY=corners[j].y; if (corners[j].x>maxX)maxX=corners[j].x; if (corners[j].y>maxY)maxY=corners[j].y; }
        }
        return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
    }
    function pointInBlock(block, mx, my) {
        var pad=10;
        for (var i=0; i<block.rects.length; i++) { var r=block.rects[i]; if (mx>=r.bl.x-pad&&mx<=r.bl.x+r.w+pad&&my>=r.bl.y-r.h-pad&&my<=r.bl.y+pad) return true; }
        return false;
    }
    function pointInRect(rect, mx, my) {
        var pad=10;
        return mx>=rect.bl.x-pad && mx<=rect.bl.x+rect.w+pad && my>=rect.bl.y-rect.h-pad && my<=rect.bl.y+pad;
    }
    function selHandles(block) {
        var bb=blockBBox(block), pad=14;
        return { corners:[{x:bb.x-pad,y:bb.y-pad},{x:bb.x+bb.w+pad,y:bb.y-pad},{x:bb.x+bb.w+pad,y:bb.y+bb.h+pad},{x:bb.x-pad,y:bb.y+bb.h+pad}], bbox:{x:bb.x-pad,y:bb.y-pad,w:bb.w+pad*2,h:bb.h+pad*2} };
    }
    function rectHandlePos(rect) {
        var pad=10, x=rect.bl.x, y=rect.bl.y, w=rect.w, h=rect.h;
        return {
            corners:[
                {x:x-pad,   y:y-h-pad},
                {x:x+w+pad, y:y-h-pad},
                {x:x+w+pad, y:y+pad},
                {x:x-pad,   y:y+pad}
            ],
            bbox:{x:x-pad, y:y-h-pad, w:w+pad*2, h:h+pad*2}
        };
    }
    function updateBlockOffs(block) {
        for (var i=0; i<block.offs.length; i++) {
            block.offs[i].x = block.rects[i+1].bl.x - block.rects[i].bl.x;
            block.offs[i].y = block.rects[i+1].bl.y - block.rects[i].bl.y;
        }
    }
    function drawSelectionHandles(block) {
        var h=selHandles(block);
        p.push(); p.blendMode(p.BLEND); p.noFill(); p.stroke(80,160,255); p.strokeWeight(1.5);
        p.drawingContext.setLineDash([6,4]); p.rect(h.bbox.x,h.bbox.y,h.bbox.w,h.bbox.h,3); p.drawingContext.setLineDash([]);
        p.fill(255); p.strokeWeight(2); p.stroke(80,160,255);
        for (var i=0;i<h.corners.length;i++) p.circle(h.corners[i].x,h.corners[i].y,HANDLE_R*2);
        p.pop();
    }
    function drawRectHandles(rect) {
        var h=rectHandlePos(rect);
        p.push(); p.blendMode(p.BLEND); p.noFill(); p.stroke(255,130,30); p.strokeWeight(1.5);
        p.drawingContext.setLineDash([6,4]); p.rect(h.bbox.x,h.bbox.y,h.bbox.w,h.bbox.h,3); p.drawingContext.setLineDash([]);
        p.fill(255); p.strokeWeight(2); p.stroke(255,130,30);
        for (var i=0;i<h.corners.length;i++) p.circle(h.corners[i].x,h.corners[i].y,HANDLE_R*2);
        p.pop();
    }
    function applyBlockScale(block, factor, anchor, sR, sO) {
        block.w=sR[0].w*factor; block.h=sR[0].h*factor;
        for (var i=0;i<block.rects.length;i++) { var sr=sR[i]; block.rects[i].bl.x=anchor.x+(sr.bl.x-anchor.x)*factor; block.rects[i].bl.y=anchor.y+(sr.bl.y-anchor.y)*factor; block.rects[i].w=block.w; block.rects[i].h=block.h; }
        for (var i=0;i<block.offs.length;i++) { block.offs[i].x=sO[i].x*factor; block.offs[i].y=sO[i].y*factor; }
    }
    function applyBlockRotate(block, angle, cx, cy, sR, sO, sA) {
        var ca=Math.cos(angle), sa=Math.sin(angle);
        for (var i=0;i<block.rects.length;i++) { var sr=sR[i],dx=sr.bl.x-cx,dy=sr.bl.y-cy; block.rects[i].bl.x=cx+dx*ca-dy*sa; block.rects[i].bl.y=cy+dx*sa+dy*ca; }
        for (var i=0;i<block.offs.length;i++) { var so=sO[i]; block.offs[i].x=so.x*ca-so.y*sa; block.offs[i].y=so.x*sa+so.y*ca; }
        for (var i=0;i<block.angles.length;i++) block.angles[i]=sA[i]+angle;
    }
    p.mousePressed = function(event) {
        if (!pointerIsOnCanvas()) return;
        if (event&&event.preventDefault) event.preventDefault();
        var pt = pointerToCanvas();

        // Rect-level handles (highest priority — only when a rect is selected)
        if (selectedBlock>=0 && selectedRect>=0 && blocks[selectedBlock] && blocks[selectedBlock].rects[selectedRect]) {
            var rect = blocks[selectedBlock].rects[selectedRect];
            var rh = rectHandlePos(rect);
            for (var ci=0; ci<rh.corners.length; ci++) {
                if (Math.hypot(pt.x-rh.corners[ci].x, pt.y-rh.corners[ci].y) <= HANDLE_R+6) {
                    var opp = rh.corners[(ci+2)%4];
                    dragTarget = {type:"rectScale", blockIdx:selectedBlock, rectIdx:selectedRect,
                        anchor:{x:opp.x,y:opp.y},
                        startDist:Math.max(8, Math.hypot(pt.x-opp.x, pt.y-opp.y)),
                        startBl:{x:rect.bl.x,y:rect.bl.y}, startW:rect.w, startH:rect.h};
                    return false;
                }
            }
        }

        // Block-level handles (only when no rect selected)
        if (selectedBlock>=0 && selectedRect<0 && blocks[selectedBlock]) {
            var b = blocks[selectedBlock];
            var h = selHandles(b);
            for (var ci=0; ci<h.corners.length; ci++) {
                if (Math.hypot(pt.x-h.corners[ci].x, pt.y-h.corners[ci].y) <= HANDLE_R+6) {
                    var opp = h.corners[(ci+2)%4];
                    dragTarget = {type:"scale", blockIdx:selectedBlock,
                        anchor:{x:opp.x,y:opp.y},
                        startDist:Math.max(8, Math.hypot(pt.x-opp.x, pt.y-opp.y)),
                        startRects:b.rects.map(function(r){return{bl:{x:r.bl.x,y:r.bl.y},w:r.w,h:r.h};}),
                        startOffs:b.offs.map(function(o){return{x:o.x,y:o.y};})};
                    return false;
                }
            }
        }

        // If a block is selected, check for individual rect hit within it
        if (selectedBlock>=0 && blocks[selectedBlock]) {
            var b = blocks[selectedBlock];
            if (selectedRect >= 0) {
                // Rect already selected: same rect → allow drag; different rect → just select
                for (var ri=b.rects.length-1; ri>=0; ri--) {
                    if (pointInRect(b.rects[ri], pt.x, pt.y)) {
                        if (selectedRect === ri) {
                            dragTarget = {type:"rectMove", blockIdx:selectedBlock, rectIdx:ri, lastX:pt.x, lastY:pt.y};
                        } else {
                            selectedRect = ri;
                            dragTarget = null;
                        }
                        p.redraw(); return false;
                    }
                }
            } else {
                // No rect selected (blue bbox): press anywhere in block starts block move.
                // If press was on a rect, record it — a clean tap (no drag) will select it.
                var pendingRi = -1;
                for (var ri=b.rects.length-1; ri>=0; ri--) {
                    if (pointInRect(b.rects[ri], pt.x, pt.y)) { pendingRi = ri; break; }
                }
                if (pendingRi >= 0 || pointInBlock(b, pt.x, pt.y)) {
                    dragTarget = {type:"move", blockIdx:selectedBlock, lastX:pt.x, lastY:pt.y,
                        pendingRectIdx: pendingRi >= 0 ? pendingRi : undefined};
                    p.redraw(); return false;
                }
            }
            // Clicked in block but not on any rect and not in block body → fall through
            if (pointInBlock(b, pt.x, pt.y)) {
                selectedRect = -1;
                dragTarget = {type:"move", blockIdx:selectedBlock, lastX:pt.x, lastY:pt.y};
                p.redraw(); return false;
            }
            // Clicked outside current block → deselect rect, fall through to check other blocks
            selectedRect = -1;
        }

        // Check all blocks for initial selection
        for (var i=blocks.length-1; i>=0; i--) {
            if (pointInBlock(blocks[i], pt.x, pt.y)) {
                selectedBlock=i; selectedRect=-1;
                dragTarget={type:"move", blockIdx:i, lastX:pt.x, lastY:pt.y};
                p.redraw(); return false;
            }
        }

        selectedBlock=-1; selectedRect=-1; dragTarget=null; p.redraw();
    };
    p.mouseDragged = function(event) {
        if (!dragTarget) return;
        if (event&&event.preventDefault) event.preventDefault();
        var pt = pointerToCanvas(), b = blocks[dragTarget.blockIdx];
        if (dragTarget.type==="rectMove") {
            var rect = b.rects[dragTarget.rectIdx];
            var dx=pt.x-dragTarget.lastX, dy=pt.y-dragTarget.lastY;
            rect.bl.x+=dx; rect.bl.y+=dy;
            dragTarget.lastX=pt.x; dragTarget.lastY=pt.y;
            updateBlockOffs(b);
            p.redraw(); return false;
        }
        if (dragTarget.type==="rectScale") {
            var rect = b.rects[dragTarget.rectIdx];
            var dist = Math.max(8, Math.hypot(pt.x-dragTarget.anchor.x, pt.y-dragTarget.anchor.y));
            var factor = Math.max(0.08, Math.min(8, dist/dragTarget.startDist));
            rect.w = dragTarget.startW * factor;
            rect.h = dragTarget.startH * factor;
            rect.bl.x = dragTarget.anchor.x + (dragTarget.startBl.x - dragTarget.anchor.x) * factor;
            rect.bl.y = dragTarget.anchor.y + (dragTarget.startBl.y - dragTarget.anchor.y) * factor;
            updateBlockOffs(b);
            p.redraw(); return false;
        }
        if (dragTarget.type==="move") {
            dragTarget.didDrag = true;
            var dx=pt.x-dragTarget.lastX, dy=pt.y-dragTarget.lastY;
            for (var i=0;i<b.rects.length;i++){b.rects[i].bl.x+=dx; b.rects[i].bl.y+=dy;}
            dragTarget.lastX=pt.x; dragTarget.lastY=pt.y;
            p.redraw(); return false;
        }
        if (dragTarget.type==="scale") {
            var dist=Math.hypot(pt.x-dragTarget.anchor.x, pt.y-dragTarget.anchor.y);
            var factor=Math.max(0.12, Math.min(6, dist/dragTarget.startDist));
            applyBlockScale(b, factor, dragTarget.anchor, dragTarget.startRects, dragTarget.startOffs);
            p.redraw(); return false;
        }
    };
    p.mouseReleased = function() {
        if (dragTarget && dragTarget.type==="move" &&
            typeof dragTarget.pendingRectIdx !== "undefined" && !dragTarget.didDrag) {
            selectedRect = dragTarget.pendingRectIdx;
            dragTarget = null;
            p.redraw();
        } else {
            dragTarget = null;
        }
    };
};
