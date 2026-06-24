window.sketches = window.sketches || {};
window.sketches['circlesFromLines'] = function(p) {
    var paper = window.makeSketchUtils;
    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        layout: 'polar',
        diameter: 30,
        maxLines: 50,
        ringSpacing: 30,
        withinRingSpacing: 10,
        gradientMode: 'linear',
        gradient: 100,
        gradientStrength: 100,
        gradAngle: 0,
        penWidthMm: 0.4,
        viewMode: 'multiply',
        palette: ['#000000'],
        colorMode: 'circle',
        endDots: 'off'
    };

    var globalSeed = 42;

    function makeRng(seed) {
        var s = (seed >>> 0) || 1;
        return function() { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
    }

    function circleSeed(idx) {
        return Math.abs(((globalSeed | 0) * 2654435761) ^ ((idx + 1) * 2246822519)) >>> 0;
    }

    // Gaussian weight distribution — all palette colors have some probability everywhere.
    // sigma=0.4 means colors blend across zone boundaries instead of snapping.
    function paletteWeightsAt(t) {
        var pal = PARAMS.palette;
        var n = pal.length;
        if (!pal || n === 0) return [1];
        if (n === 1) return [1];
        var sigma = 0.4, weights = [], sum = 0;
        for (var i = 0; i < n; i++) {
            var center = i / (n - 1);
            var d = (t - center) / sigma;
            var w = Math.exp(-0.5 * d * d);
            weights.push(w);
            sum += w;
        }
        if (sum > 0) for (var j = 0; j < n; j++) weights[j] /= sum;
        return weights;
    }

    function pickColorFromWeights(weights, rng) {
        var pal = PARAMS.palette;
        if (!pal || pal.length === 0) return '#000000';
        if (pal.length === 1) return pal[0];
        var r = rng();
        var cumul = 0;
        for (var i = 0; i < pal.length - 1; i++) {
            cumul += weights[i];
            if (r < cumul) return pal[i];
        }
        return pal[pal.length - 1];
    }

    // Returns a solid color (circle mode) or weights array (line mode)
    function circleColorArg(t, circleIdx) {
        var weights = paletteWeightsAt(t);
        if (PARAMS.colorMode === 'line') return weights;
        var rng = makeRng(circleSeed(circleIdx) ^ 0xCAFEBABE);
        return pickColorFromWeights(weights, rng);
    }

    var api = {
        hasPause: false,
        stylePresets: [
            { label: 'Polar bloom', values: { layout:'polar', diameter:30, maxLines:60, ringSpacing:30, withinRingSpacing:10, colorMode:'circle', gradientMode:'polar' } },
            { label: 'Dense grid', values: { layout:'grid', diameter:60, maxLines:80, ringSpacing:10, colorMode:'line' } },
            { label: 'Hex weave', values: { layout:'hex', diameter:40, maxLines:50, ringSpacing:20, withinRingSpacing:16, colorMode:'circle' } },
            { label: 'Sparse dotted', values: { layout:'grid', diameter:34, maxLines:24, ringSpacing:44, endDots:'on' } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
              value: PARAMS.palette.slice(),
              options: [
                { value: '#000000', label: 'Black' },
                { value: '#e63946', label: 'Red' },
                { value: '#2196f3', label: 'Blue' },
                { value: '#ff9800', label: 'Orange' },
                { value: '#4caf50', label: 'Green' },
                { value: '#9c27b0', label: 'Purple' },
                { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' },
                { value: '#ffff00', label: 'Yellow' },
                { value: 'custom',  label: 'Custom' }
              ]},
            { id: 'colorMode', label: 'Color per', type: 'select', value: 'circle',
              options: [
                { value: 'circle', label: 'Circle' },
                { value: 'line',   label: 'Line' }
              ]},
            { id: 'endDots', label: 'End dots', type: 'select', value: 'off',
              options: [
                { value: 'off', label: 'Off' },
                { value: 'on',  label: 'On (plotted)' }
              ]},
            { id: 'layout', label: 'Layout', type: 'select', value: 'polar',
              options: [
                { value: 'polar', label: 'Polar' },
                { value: 'grid', label: 'Grid' },
                { value: 'hex', label: 'Hex' }
              ]},
            { id: 'diameter', label: 'Scale', type: 'range', min: 4, max: 200, step: 2, value: 30 },
            { id: 'maxLines', label: 'Max lines', type: 'range', min: 1, max: 200, step: 5, value: 50 },
            { id: 'ringSpacing', label: 'Padding', type: 'range', min: 0, max: 200, step: 1, value: 30,
              labelByValue: { param: 'layout', values: { polar: 'Ring padding', hex: 'Horizontal padding', default: 'Padding' } } },
            { id: 'withinRingSpacing', label: 'Secondary spacing', type: 'range', min: 0, max: 200, step: 1, value: 10,
              visibleWhen: { param: 'layout', values: ['polar', 'hex'] },
              labelByValue: { param: 'layout', values: { polar: 'Circle spacing', hex: 'Vertical padding', default: 'Secondary spacing' } } },
            { id: 'gradientMode', label: 'Gradient mode', type: 'select', value: 'linear',
              options: [
                { value: 'linear', label: 'Linear' },
                { value: 'polar', label: 'Polar' }
              ],
              visibleWhen: { param: 'layout', values: ['polar'] } },
            { id: 'gradient', label: 'Gradient', type: 'range', min: 0, max: 100, step: 5, value: 100 },
            { id: 'gradientStrength', label: 'Gradient strength', type: 'range', min: 0, max: 200, step: 5, value: 100 },
            { id: 'gradAngle', label: 'Gradient angle°', type: 'range', min: 0, max: 360, step: 1, value: 0 },
            { id: 'penWidthMm', label: 'Pen width (mm)', type: 'range', min: 0.1, max: 2.0, step: 0.1, value: 0.4 },
            { id: 'viewMode', label: 'View mode', type: 'select', value: 'multiply',
              options: [
                { value: 'normal', label: 'Normal' },
                { value: 'multiply', label: 'Multiply' }
              ]}
        ]),
        regenerate: function(){ resizeIfNeeded(); try{ p.redraw(); }catch(e){} },
        reseed: function(){ globalSeed = Math.floor(Math.random() * 1e8) + 1; try{ p.redraw(); }catch(e){} },
        getRecipe: function() {
            return { state: { globalSeed: globalSeed } };
        },
        applyRecipeState: function(state) {
            if (state && Number.isFinite(Number(state.globalSeed))) {
                globalSeed = Number(state.globalSeed);
                try{ p.redraw(); }catch(e){}
            }
        },
        togglePause: function(){ return false; },
        setParam: function(name, val) {
            var f = api.params.find(function(x){ return x.id === name; });
            if (f) f.value = val;
            if (name === 'paperSize')         { PARAMS.paperSize = val; resizeIfNeeded(); }
            if (name === 'margin')            PARAMS.margin = Number(val);
            if (name === 'layout')            PARAMS.layout = val;
            if (name === 'endDots')           PARAMS.endDots = val;
            if (name === 'diameter')          PARAMS.diameter = Number(val);
            if (name === 'maxLines')          PARAMS.maxLines = Number(val);
            if (name === 'ringSpacing')       PARAMS.ringSpacing = Number(val);
            if (name === 'withinRingSpacing') PARAMS.withinRingSpacing = Number(val);
            if (name === 'gradientMode')      PARAMS.gradientMode = val;
            if (name === 'gradient')          PARAMS.gradient = Number(val);
            if (name === 'gradientStrength')  PARAMS.gradientStrength = Number(val);
            if (name === 'gradAngle')         PARAMS.gradAngle = Number(val);
            if (name === 'penWidthMm')        PARAMS.penWidthMm = Number(val);
            if (name === 'viewMode')          PARAMS.viewMode = val;
            if (name === 'colorMode')         PARAMS.colorMode = val;
            if (name === 'palette')           PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
        },
        saveSVG: function() { exportSVG(); }
    };

    function resizeIfNeeded() { paper.resizeCanvasToPaper(p, PARAMS.paperSize); }

    // ---- gradient helpers ----
    function gradientPosition(x, y, left, top, availW, availH, angleDeg) {
        var cx = left + availW / 2, cy = top + availH / 2;
        var dx = x - cx, dy = y - cy;
        var theta = p.radians(angleDeg);
        var axisX = Math.sin(theta), axisY = Math.cos(theta);
        var projection = dx * axisX + dy * axisY;
        var maxProjection = (Math.abs(axisX) * availW + Math.abs(axisY) * availH) / 2;
        if (maxProjection <= 0) return 0;
        return p.constrain((projection + maxProjection) / (2 * maxProjection), 0, 1);
    }

    function polarGradientPosition(x, y, centerX, centerY, maxRadius, gradientCenter, gradientMode, left, top, availW, availH, angleDeg) {
        if (gradientMode === 'polar') {
            if (maxRadius <= 0) return 0;
            var dx = x - centerX, dy = y - centerY;
            var radiusT = p.constrain(Math.sqrt(dx * dx + dy * dy) / maxRadius, 0, 1);
            return Math.abs(radiusT - gradientCenter) * 2;
        }
        return gradientPosition(x, y, left, top, availW, availH, angleDeg);
    }

    function gradientLines(maxLines, t, strength) {
        var clampedT = p.constrain(t, 0, 1);
        var clampedStrength = p.constrain(strength, 0, 2);
        var shapedT = clampedStrength <= 1 ? clampedT : Math.pow(clampedT, 1 / (1 + (clampedStrength - 1) * 3));
        var fade = 1 - shapedT;
        var mix = clampedStrength <= 1 ? ((1 - clampedStrength) + (clampedStrength * fade)) : fade;
        return Math.max(0, Math.round(maxLines * mix));
    }

    function inkColor(hex) {
        var c = p.color(hex);
        if (PARAMS.viewMode === 'multiply') c.setAlpha(204);
        return c;
    }

    // ---- draw circle (canvas) ----
    function drawCircle(x, y, d, n, colorArg, circleIdx) {
        var z = d / 2;
        var lineMode = Array.isArray(colorArg);
        var geoRng = makeRng(circleSeed(circleIdx));
        var colRng = lineMode ? makeRng(circleSeed(circleIdx) ^ 0xDEADBEEF) : null;
        if (!lineMode) p.stroke(inkColor(colorArg || '#000000'));
        for (var k = 1; k < n; k++) {
            if (lineMode) p.stroke(inkColor(pickColorFromWeights(colorArg, colRng)));
            var theta1 = geoRng() * 2 * Math.PI;
            var theta2 = geoRng() * 2 * Math.PI;
            var x1 = z * Math.cos(theta1), y1 = z * Math.sin(theta1);
            var x2 = z * Math.cos(theta2), y2 = z * Math.sin(theta2);
            p.line(x1, y1, x2, y2);
            if (PARAMS.endDots === 'on') {
                p.push(); p.noFill();
                p.ellipse(x1, y1, 3);
                p.ellipse(x2, y2, 3);
                p.pop();
            }
        }
    }

    // ---- layout functions ----
    var _circleIdx; // incremented per circle each draw/export

    function drawPolarLayout(left, top, availW, availH, diameter, maxLines, ringSpacing, withinRingSpacing, gradient, gradientStrength, gradientMode, gradAngle) {
        var maxRadius = Math.max(0, Math.min(availW, availH) / 2 - diameter / 2);
        var ringStep = Math.max(1, ringSpacing + diameter / 2);
        var ringCount = Math.max(1, Math.floor(maxRadius / ringStep) + 1);
        var centerX = left + availW / 2, centerY = top + availH / 2;
        p.push(); p.translate(centerX, centerY);
        var t0 = polarGradientPosition(centerX, centerY, centerX, centerY, maxRadius, gradient, gradientMode, left, top, availW, availH, gradAngle);
        drawCircle(0, 0, diameter, gradientLines(maxLines, t0, gradientStrength), circleColorArg(t0, _circleIdx), _circleIdx++);
        for (var i = 1; i < ringCount; i++) {
            var ringDiam = i * (2 * ringSpacing + diameter);
            var ringRadius = ringDiam / 2;
            var circsPerRing = Math.max(1, Math.floor(Math.PI * ringDiam / Math.max(1, diameter + withinRingSpacing)));
            for (var m = 0; m < circsPerRing; m++) {
                var theta = 2 * Math.PI * (m / circsPerRing);
                var worldX = centerX + ringRadius * Math.cos(theta);
                var worldY = centerY + ringRadius * Math.sin(theta);
                var tP = polarGradientPosition(worldX, worldY, centerX, centerY, maxRadius, gradient, gradientMode, left, top, availW, availH, gradAngle);
                p.push(); p.translate(worldX - centerX, worldY - centerY);
                drawCircle(0, 0, diameter, gradientLines(maxLines, tP, gradientStrength), circleColorArg(tP, _circleIdx), _circleIdx++);
                p.pop();
            }
        }
        p.pop();
    }

    function drawGridLayout(left, top, availW, availH, diameter, maxLines, padding, gradientStrength, gradAngle) {
        var pitchX = diameter + Math.max(0, padding), pitchY = pitchX;
        var cols = Math.max(1, Math.floor((availW - diameter) / Math.max(1, pitchX)) + 1);
        var rows = Math.max(1, Math.floor((availH - diameter) / Math.max(1, pitchY)) + 1);
        var startX = left + (availW - (diameter + Math.max(0, cols - 1) * pitchX)) / 2 + diameter / 2;
        var startY = top  + (availH - (diameter + Math.max(0, rows - 1) * pitchY)) / 2 + diameter / 2;
        for (var row = 0; row < rows; row++) {
            for (var col = 0; col < cols; col++) {
                var x = startX + col * pitchX, y = startY + row * pitchY;
                var t = gradientPosition(x, y, left, top, availW, availH, gradAngle);
                p.push(); p.translate(x, y);
                drawCircle(0, 0, diameter, gradientLines(maxLines, t, gradientStrength), circleColorArg(t, _circleIdx), _circleIdx++);
                p.pop();
            }
        }
    }

    function drawHexLayout(left, top, availW, availH, diameter, maxLines, gapX, gapY, gradientStrength, gradAngle) {
        var pitchX = diameter + Math.max(0, gapX);
        var pitchY = Math.sqrt(3) / 2 * diameter + Math.max(0, gapY);
        var cols = Math.max(1, Math.floor((availW - diameter) / Math.max(1, pitchX)) + 1);
        var rows = Math.max(1, Math.floor((availH - diameter) / Math.max(1, pitchY)) + 1);
        var startX = left + (availW - (diameter + Math.max(0, cols - 1) * pitchX + pitchX / 2)) / 2 + diameter / 2;
        var startY = top  + (availH - (diameter + Math.max(0, rows - 1) * pitchY)) / 2 + diameter / 2;
        for (var row = 0; row < rows; row++) {
            var rowOffset = (row % 2) * (pitchX / 2);
            for (var col = 0; col < cols; col++) {
                var x = startX + rowOffset + col * pitchX, y = startY + row * pitchY;
                if (x > left + availW - diameter / 2) continue;
                var t = gradientPosition(x, y, left, top, availW, availH, gradAngle);
                p.push(); p.translate(x, y);
                drawCircle(0, 0, diameter, gradientLines(maxLines, t, gradientStrength), circleColorArg(t, _circleIdx), _circleIdx++);
                p.pop();
            }
        }
    }

    function runLayout(marginPx) {
        _circleIdx = 0;
        var availW = p.width - marginPx * 2, availH = p.height - marginPx * 2;
        if (PARAMS.layout === 'grid') {
            drawGridLayout(marginPx, marginPx, availW, availH, PARAMS.diameter, PARAMS.maxLines, PARAMS.ringSpacing, PARAMS.gradientStrength / 100, PARAMS.gradAngle);
        } else if (PARAMS.layout === 'hex') {
            drawHexLayout(marginPx, marginPx, availW, availH, PARAMS.diameter, PARAMS.maxLines, PARAMS.ringSpacing, PARAMS.withinRingSpacing, PARAMS.gradientStrength / 100, PARAMS.gradAngle);
        } else {
            drawPolarLayout(marginPx, marginPx, availW, availH, PARAMS.diameter, PARAMS.maxLines, PARAMS.ringSpacing, PARAMS.withinRingSpacing, PARAMS.gradient / 100, PARAMS.gradientStrength / 100, PARAMS.gradientMode, PARAMS.gradAngle);
        }
    }

    // ---- SVG export ----
    function circleSvgLines(cx, cy, d, n, colorArg, circleIdx, strokeW) {
        var z = d / 2;
        var lineMode = Array.isArray(colorArg);
        var geoRng = makeRng(circleSeed(circleIdx));
        var colRng = lineMode ? makeRng(circleSeed(circleIdx) ^ 0xDEADBEEF) : null;
        var parts = [];
        var sw = strokeW.toFixed(2);
        for (var k = 1; k < n; k++) {
            var color = lineMode ? pickColorFromWeights(colorArg, colRng) : colorArg;
            var theta1 = geoRng() * 2 * Math.PI, theta2 = geoRng() * 2 * Math.PI;
            var x1 = cx + z * Math.cos(theta1), y1 = cy + z * Math.sin(theta1);
            var x2 = cx + z * Math.cos(theta2), y2 = cy + z * Math.sin(theta2);
            parts.push('<line x1="'+x1.toFixed(1)+'" y1="'+y1.toFixed(1)+'" x2="'+x2.toFixed(1)+'" y2="'+y2.toFixed(1)+'" stroke="'+color+'" stroke-width="'+sw+'" stroke-linecap="round"/>');
            if (PARAMS.endDots === 'on') {
                var dr = (1.5).toFixed(1);
                parts.push('<circle cx="'+x1.toFixed(1)+'" cy="'+y1.toFixed(1)+'" r="'+dr+'" fill="none" stroke="'+color+'" stroke-width="'+sw+'"/>');
                parts.push('<circle cx="'+x2.toFixed(1)+'" cy="'+y2.toFixed(1)+'" r="'+dr+'" fill="none" stroke="'+color+'" stroke-width="'+sw+'"/>');
            }
        }
        return parts.join('\n');
    }

    function exportSVG() {
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var mp = paper.getMarginPixels(PARAMS.margin);
        var sw = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
        var availW = dims.width - mp * 2, availH = dims.height - mp * 2;
        var svgParts = [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="'+dims.width+'" height="'+dims.height+'">',
            '<rect x="0" y="0" width="'+dims.width+'" height="'+dims.height+'" fill="white"/>',
            '<defs><clipPath id="mc"><rect x="'+mp+'" y="'+mp+'" width="'+availW+'" height="'+availH+'"/></clipPath></defs>',
            '<g clip-path="url(#mc)">'
        ];

        // Replicate layout logic for SVG export (same circleIdx sequence, same seeds)
        _circleIdx = 0;
        var fakeP = { width: dims.width, height: dims.height };
        function svgGradPos(x, y) {
            var cx = mp + availW/2, cy = mp + availH/2;
            var dx = x - cx, dy = y - cy;
            var theta = PARAMS.gradAngle * Math.PI / 180;
            var axisX = Math.sin(theta), axisY = Math.cos(theta);
            var proj = dx * axisX + dy * axisY;
            var maxP = (Math.abs(axisX) * availW + Math.abs(axisY) * availH) / 2;
            return maxP <= 0 ? 0 : Math.max(0, Math.min(1, (proj + maxP) / (2 * maxP)));
        }
        function svgPolarGradPos(x, y, cX, cY, maxR, gradCenter, gradMode) {
            if (gradMode === 'polar') {
                if (maxR <= 0) return 0;
                var ddx = x - cX, ddy = y - cY;
                return Math.max(0, Math.min(1, Math.abs(Math.sqrt(ddx*ddx+ddy*ddy)/maxR - gradCenter) * 2));
            }
            return svgGradPos(x, y);
        }
        function svgGradLines(maxL, t, str) {
            var cT = Math.max(0, Math.min(1, t)), cS = Math.max(0, Math.min(2, str));
            var sT = cS <= 1 ? cT : Math.pow(cT, 1/(1+(cS-1)*3));
            var fade = 1 - sT;
            var mix = cS <= 1 ? ((1-cS)+(cS*fade)) : fade;
            return Math.max(0, Math.round(maxL * mix));
        }

        if (PARAMS.layout === 'polar') {
            var maxR = Math.max(0, Math.min(availW, availH)/2 - PARAMS.diameter/2);
            var ringStep = Math.max(1, PARAMS.ringSpacing + PARAMS.diameter/2);
            var ringCnt = Math.max(1, Math.floor(maxR/ringStep)+1);
            var cX = mp + availW/2, cY = mp + availH/2;
            var grad = PARAMS.gradient/100, gStr = PARAMS.gradientStrength/100;
            var t0 = svgPolarGradPos(cX, cY, cX, cY, maxR, grad, PARAMS.gradientMode);
            svgParts.push(circleSvgLines(cX, cY, PARAMS.diameter, svgGradLines(PARAMS.maxLines, t0, gStr), circleColorArg(t0, _circleIdx), _circleIdx++, sw));
            for (var ri = 1; ri < ringCnt; ri++) {
                var rDiam = ri*(2*PARAMS.ringSpacing+PARAMS.diameter);
                var rRad = rDiam/2;
                var cpr = Math.max(1, Math.floor(Math.PI*rDiam/Math.max(1,PARAMS.diameter+PARAMS.withinRingSpacing)));
                for (var mi = 0; mi < cpr; mi++) {
                    var ang = 2*Math.PI*(mi/cpr);
                    var wx = cX + rRad*Math.cos(ang), wy = cY + rRad*Math.sin(ang);
                    var tP = svgPolarGradPos(wx, wy, cX, cY, maxR, grad, PARAMS.gradientMode);
                    svgParts.push(circleSvgLines(wx, wy, PARAMS.diameter, svgGradLines(PARAMS.maxLines, tP, gStr), circleColorArg(tP, _circleIdx), _circleIdx++, sw));
                }
            }
        } else if (PARAMS.layout === 'grid') {
            var pX = PARAMS.diameter + Math.max(0, PARAMS.ringSpacing);
            var cols = Math.max(1, Math.floor((availW-PARAMS.diameter)/Math.max(1,pX))+1);
            var rows2 = Math.max(1, Math.floor((availH-PARAMS.diameter)/Math.max(1,pX))+1);
            var sX = mp + (availW-(PARAMS.diameter+Math.max(0,cols-1)*pX))/2 + PARAMS.diameter/2;
            var sY = mp + (availH-(PARAMS.diameter+Math.max(0,rows2-1)*pX))/2 + PARAMS.diameter/2;
            for (var r2=0;r2<rows2;r2++) for (var c2=0;c2<cols;c2++) {
                var xg = sX+c2*pX, yg = sY+r2*pX;
                var tg = svgGradPos(xg, yg);
                svgParts.push(circleSvgLines(xg, yg, PARAMS.diameter, svgGradLines(PARAMS.maxLines, tg, PARAMS.gradientStrength/100), circleColorArg(tg, _circleIdx), _circleIdx++, sw));
            }
        } else {
            var hpX = PARAMS.diameter+Math.max(0,PARAMS.ringSpacing);
            var hpY = Math.sqrt(3)/2*PARAMS.diameter+Math.max(0,PARAMS.withinRingSpacing);
            var hCols = Math.max(1, Math.floor((availW-PARAMS.diameter)/Math.max(1,hpX))+1);
            var hRows = Math.max(1, Math.floor((availH-PARAMS.diameter)/Math.max(1,hpY))+1);
            var hsX = mp+(availW-(PARAMS.diameter+Math.max(0,hCols-1)*hpX+hpX/2))/2+PARAMS.diameter/2;
            var hsY = mp+(availH-(PARAMS.diameter+Math.max(0,hRows-1)*hpY))/2+PARAMS.diameter/2;
            for (var hr=0;hr<hRows;hr++) {
                var rOff=(hr%2)*(hpX/2);
                for (var hc=0;hc<hCols;hc++) {
                    var xh=hsX+rOff+hc*hpX, yh=hsY+hr*hpY;
                    if (xh > mp+availW-PARAMS.diameter/2) continue;
                    var th = svgGradPos(xh, yh);
                    svgParts.push(circleSvgLines(xh, yh, PARAMS.diameter, svgGradLines(PARAMS.maxLines, th, PARAMS.gradientStrength/100), circleColorArg(th, _circleIdx), _circleIdx++, sw));
                }
            }
        }

        svgParts.push('</g></svg>');
        var blob = new Blob([svgParts.join('\n')], { type: 'image/svg+xml' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
        a.href = url; a.download = '90percentart-circles-from-lines-'+(_slug || new Date().toISOString().replace(/[:.]/g,'-'))+'.svg';
        a.click(); URL.revokeObjectURL(url);
    }

    p.registerSketchAPI = function(register){ if(typeof register === 'function') register(api); };

    p.setup = function(){
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            var helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;max-width:900px;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            helpEl.textContent = 'Adjust parameters on the right to compose your piece. Hit Reseed for a new variation.';
            container.appendChild(helpEl);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        p.noFill();
        p.noLoop();
    };

    p.draw = function(){
        p.background(255);
        p.blendMode(PARAMS.viewMode === 'multiply' ? p.MULTIPLY : p.BLEND);
        paper.drawPaperBorder(p);
        p.strokeWeight(Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm)));
        runLayout(paper.getMarginPixels(PARAMS.margin));
        p.blendMode(p.BLEND);
    };
};
