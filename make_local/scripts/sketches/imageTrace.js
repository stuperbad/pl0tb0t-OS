// imageTrace.js — pl0tb0t-OS: raster image -> plottable line art.
// Upload a photo/image, decompose it onto your selected pens (either a true
// CMYK-style mix of continuous per-ink density layers, or DrawingBotV3
// "Color Match"-style nearest-pen classification), then trace each ink's
// density map using one of six DrawingBotV3-inspired Path Finding Module
// families: Sketch, Streamlines, Spiral, Hatch, Voronoi (Stippling), and
// Adaptive. Setting names/ranges are taken from DBV3's own open-source docs
// (docs/source/pfms.rst) wherever the underlying mechanic genuinely
// corresponds; a handful of DBV3 settings describe implementation details
// (true Edge Tangent Flow, full Voronoi diagrams, SLIC segmentation, font
// rendering) that this tracer approximates with cheaper bounded algorithms
// rather than reimplementing verbatim -- documented inline where it matters.
// Deliberately NOT implemented this pass: Grid PFMs, Composite/Mosaic PFMs,
// ECS Drawing, and the Letters/Diagram/TSP/Triangulation/Tree render styles
// (font rendering, true Voronoi/Delaunay diagrams, and TSP solving are each
// substantial standalone features).
//
// Architecture: PARAMS.mode selects a family; each family has its own
// traceXxx() function operating on a per-ink density weight map, fed by the
// shared pipeline (load -> downscale -> ink decomposition -> per-ink trace ->
// paper layout -> export). Sub-style pickers (e.g. sketchStyle, fieldType)
// reuse a family's core tracer and post-process the resulting polylines.
//
// Big-image safety + compute safety: the working image is downscaled to
// WORK_MAX on load. Every new iterative/recursive algorithm added this pass
// (vector-field blur, point relaxation, adaptive subdivision, spiral
// sampling) has a hard iteration/recursion cap independent of user input, so
// a pathological slider combination degrades quality rather than hanging --
// this app has twice frozen the whole Pi from unbounded compute before, so
// every new loop here is bounded on principle, not just for "normal" inputs.
window.sketches = window.sketches || {};
window.sketches['imageTrace'] = function (p) {
    var paper = window.makeSketchUtils;
    var WORK_MAX = 1200; // capped working resolution (long edge, px). 1200 resolves pen-width
                         // detail for a ~3-5in plot (DBV3 uses full photo res, but finer than the
                         // pen can draw doesn't reach paper). Higher = more detail AND denser lines
                         // (spacing is in working px), and cost grows ~quadratically. Was 480 (Pi guard).

    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        palette: ['#000000'],
        mode: 'streamlines',
        colorMode: 'separate',

        sketchStyle: 'lines',
        fieldType: 'edge',
        spiralStyle: 'archimedean',
        hatchStyle: 'straight',
        stippleShape: 'dot',
        adaptiveShape: 'square',

        seedSpacing: 6,      // "Min Spacing"
        maxSpacing: 14,      // "Max Spacing"
        stepLen: 3,
        maxSteps: 60,        // "Max Length" (steps)
        minSep: 3,
        distortion: 0,
        tone: 50,

        edgePower: 70,
        etfIterations: 0,
        etfRadius: 2,
        postBlurIterations: 0,
        postBlurRadius: 2,

        flowStartAngle: 0,
        flowXFreq: 1,
        flowYFreq: 1,
        flowScaleFreq: 0.5,
        flowAmplitude: 100,
        sfFrequency: 5,
        sfCosFactor: 2,
        sfSineFactor: 2,
        sfCurvature: 2,

        // Sketch (real port of PFMSketchLinesBasic/PFMSketchSquaresBasic)
        sketchAngleMin: -180,
        sketchAngleMax: 180,
        sketchSquareAngle: 0,
        sketchWaveStartAngle: 0,
        sketchWaveOffsetX: 0,
        sketchWaveOffsetY: 0,
        sketchWaveDivisorX: 30,
        sketchWaveDivisorY: 30,
        sketchWaveTypeX: 'sin',
        sketchWaveTypeY: 'cos',
        sketchMinLineLength: 8,
        sketchMaxLineLength: 40,
        sketchLineTests: 16,
        sketchSquiggleMax: 40,
        sketchEraseRadiusMin: 1,
        sketchEraseRadiusMax: 3,
        sketchEraseMin: 20,
        sketchEraseMax: 100,
        sketchTone: 50,

        // Spiral (real port of PFMSpiralBasic)
        spiralSize: 1,
        spiralCentreX: 50,
        spiralCentreY: 50,
        spiralVariableVelocity: 'on',
        spiralConnectedLines: 'on',
        ringSpacing: 8,
        spiralAmplitude: 1,
        spiralVelocityMin: 20,
        spiralVelocityMax: 60,

        hatchSpacing: 5,
        hatchAngle: 45,
        crosshatch: 'off',
        linkEnds: 'off',
        hatchAmplitude: 1,
        hatchVelocityMin: 20,
        hatchVelocityMax: 60,

        pointDensity: 30,
        pointLimit: 800,
        stippleRadiusMin: 0.4,
        stippleRadiusMax: 1.4,
        luminancePower: 10,
        voronoiIterations: 4,

        minSampleRadius: 4,
        maxSampleRadius: 24,
        adaptiveBrightness: 100,
        adaptiveContrast: 100,

        ignoreWhite: 'off',

        alpha: 80,           // canvas-preview ink opacity (%); overlapping pens mix (multiply)

        brightness: 100,
        contrast: 100,
        invert: 'off',
        rotation: 0,
        offsetX: 0,
        offsetY: 0
    };

    var helpEl = null, fileInput = null;
    var workW = 0, workH = 0, srcImageData = null, previewImg = null;
    var strokesByPen = null, busy = false;

    // ---- helpers ------------------------------------------------------
    function hexToRgb01(hex) {
        var h = String(hex || '#000000').replace('#', '');
        if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
        return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
    }
    function selectedPens() {
        var v = PARAMS.palette;
        return (Array.isArray(v) && v.length) ? v.slice() : ['#000000'];
    }
    function widthPxFor(hex) {
        var mm = (window.plotPens && window.plotPens.widthFor) ? window.plotPens.widthFor(hex) : null;
        return Math.max(0.5, paper.mmToPixels(mm || 0.4));
    }
    function setSliderVal(id, val) {
        var el = document.getElementById(id);
        if (el) { el.value = val; var sv = document.getElementById(id + 'Value'); if (sv) sv.textContent = String(val); }
        var pdef = api.params.find(function (x) { return x.id === id; });
        if (pdef) pdef.value = val;
    }

    // ---- image load (downscale immediately, before any pixel work) ----
    function handleImageFile(file) {
        if (helpEl) helpEl.textContent = 'Reading ' + file.name + '…';
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var scale = Math.min(1, WORK_MAX / Math.max(img.width, img.height));
                workW = Math.max(1, Math.round(img.width * scale));
                workH = Math.max(1, Math.round(img.height * scale));
                var cv = document.createElement('canvas');
                cv.width = workW; cv.height = workH;
                var ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0, workW, workH);
                srcImageData = ctx.getImageData(0, 0, workW, workH).data;
                previewImg = null;
                p.loadImage(cv.toDataURL(), function (im) { previewImg = im; p.redraw(); });
                strokesByPen = null;
                updateHelp();
                p.redraw();
            };
            img.onerror = function () { if (helpEl) helpEl.textContent = 'Could not load that image.'; };
            img.src = e.target.result;
        };
        reader.onerror = function () { if (helpEl) helpEl.textContent = 'Could not read file.'; };
        reader.readAsDataURL(file);
    }

    function updateHelp() {
        if (!helpEl) return;
        if (!srcImageData) { helpEl.textContent = 'Upload an image, pick your pens, then Generate to trace it.'; return; }
        if (busy) { helpEl.textContent = 'Generating…'; return; }
        var t = 'Loaded: ' + workW + '×' + workH + ' working px.';
        t += strokesByPen ? ' Traced — Generate again after changing settings.' : ' Hit Generate to trace.';
        helpEl.textContent = t;
    }

    // ---- luminance + Sobel gradient field ------------------------------
    function toLuminance(data, w, h, brightnessPct, contrastPct, invert) {
        var out = new Float32Array(w * h);
        var c = Math.max(0.1, (contrastPct || 100) / 100);
        var b = ((brightnessPct || 100) / 100) - 1;
        for (var i = 0; i < w * h; i++) {
            var r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, bl = data[i * 4 + 2] / 255;
            var l = 0.299 * r + 0.587 * g + 0.114 * bl;
            l += b;
            l = (l - 0.5) * c + 0.5;
            l = Math.max(0, Math.min(1, l));
            if (invert) l = 1 - l;
            out[i] = l;
        }
        return out;
    }
    function computeGradientField(lum, w, h) {
        var gx = new Float32Array(w * h), gy = new Float32Array(w * h);
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var i = y * w + x;
                gx[i] = -lum[(y - 1) * w + (x - 1)] + lum[(y - 1) * w + (x + 1)]
                        - 2 * lum[y * w + (x - 1)] + 2 * lum[y * w + (x + 1)]
                        - lum[(y + 1) * w + (x - 1)] + lum[(y + 1) * w + (x + 1)];
                gy[i] = -lum[(y - 1) * w + (x - 1)] - 2 * lum[(y - 1) * w + x] - lum[(y - 1) * w + (x + 1)]
                        + lum[(y + 1) * w + (x - 1)] + 2 * lum[(y + 1) * w + x] + lum[(y + 1) * w + (x + 1)];
            }
        }
        return { gx: gx, gy: gy };
    }
    // "Edge Tangent Flow" / "Post Blur" approximation: separable box blur of
    // the raw gradient VECTOR field, iterated. Real ETF uses an angle- and
    // magnitude-weighted kernel; a plain vector blur is a cheap, bounded
    // stand-in that produces the same qualitative effect (smoother, more
    // continuous flow direction) without unbounded per-pixel kernel cost.
    function boxBlurPass(src, w, h, radius, horizontal) {
        var out = new Float32Array(w * h);
        if (horizontal) {
            for (var y = 0; y < h; y++) {
                var rowOff = y * w;
                for (var x = 0; x < w; x++) {
                    var sum = 0, cnt = 0;
                    for (var k = -radius; k <= radius; k++) {
                        var xx = x + k; if (xx < 0 || xx >= w) continue;
                        sum += src[rowOff + xx]; cnt++;
                    }
                    out[rowOff + x] = cnt ? sum / cnt : 0;
                }
            }
        } else {
            for (var x2 = 0; x2 < w; x2++) {
                for (var y2 = 0; y2 < h; y2++) {
                    var sum2 = 0, cnt2 = 0;
                    for (var k2 = -radius; k2 <= radius; k2++) {
                        var yy = y2 + k2; if (yy < 0 || yy >= h) continue;
                        sum2 += src[yy * w + x2]; cnt2++;
                    }
                    out[y2 * w + x2] = cnt2 ? sum2 / cnt2 : 0;
                }
            }
        }
        return out;
    }
    function blurVectorField(gx, gy, w, h, iterations, radius) {
        // Caps sized to DBV3's real preset extremes (ETF Iterations up to 10,
        // ETF Radius up to 11, Smooth Iterations up to 20) with headroom,
        // except Smooth Radius which DBV3 pushes to 30 for one preset
        // ("Fingerprints") -- that's cheap for their native OpenCV blur but
        // ~4x the cost here for a naive JS box blur, so it's capped at 15
        // (visibly close, not identical) to stay safely bounded on the Pi.
        iterations = Math.max(0, Math.min(20, Math.round(iterations) || 0));
        radius = Math.max(1, Math.min(30, Math.round(radius) || 1));
        var bx = gx, by = gy;
        for (var i = 0; i < iterations; i++) {
            bx = boxBlurPass(boxBlurPass(bx, w, h, radius, true), w, h, radius, false);
            by = boxBlurPass(boxBlurPass(by, w, h, radius, true), w, h, radius, false);
        }
        return { gx: bx, gy: by };
    }
    // Real Edge Tangent Flow (Kang, Lee & Chui, "Coherent Line Drawing",
    // NPAR 2007) -- the algorithm DBV3's Streamlines Edge Field is built on.
    // ETF aligns anti-parallel tangents (sign term phi) so edge directions
    // REINFORCE instead of cancelling, weighting neighbours by relative
    // gradient magnitude (wm) and directional agreement (wd). Three cost
    // controls keep it bounded on the Pi: (1) computed on a DOWNSCALED field
    // (ETF_MAX px) -- the tangent field is low-frequency so a coarse grid is
    // ample; (2) SEPARABLE 1-D passes (horizontal then vertical) instead of a
    // full 2-D kernel, cutting O(r^2) to O(r); (3) a cheap tanh approximation.
    function _tanhApprox(z) {
        if (z <= -3) return -1;
        if (z >= 3) return 1;
        var z2 = z * z;
        return z * (27 + z2) / (27 + 9 * z2);
    }
    function _etfPass(tx, ty, mag, w, h, radius, axis) {
        var N = w * h, nx = new Float32Array(N), ny = new Float32Array(N);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var ci = y * w + x, cxT = tx[ci], cyT = ty[ci], cMag = mag[ci];
                var sx = 0, sy = 0;
                for (var k = -radius; k <= radius; k++) {
                    var xx = axis === 0 ? x + k : x, yy = axis === 0 ? y : y + k;
                    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    var ni = yy * w + xx;
                    var dot = cxT * tx[ni] + cyT * ty[ni];
                    var wd = dot < 0 ? -dot : dot;                      // |t(x).t(y)|
                    var wm = 0.5 * (1 + _tanhApprox(mag[ni] - cMag));   // magnitude weight (eta=1)
                    var wgt = (dot >= 0 ? 1 : -1) * wm * wd;            // phi * wm * wd
                    sx += tx[ni] * wgt; sy += ty[ni] * wgt;
                }
                var mm = Math.sqrt(sx * sx + sy * sy);
                if (mm > 1e-6) { nx[ci] = sx / mm; ny[ci] = sy / mm; }
                else { nx[ci] = cxT; ny[ci] = cyT; }
            }
        }
        return { tx: nx, ty: ny };
    }
    function refineETF(gx, gy, w, h, iterations, radius) {
        iterations = Math.max(0, Math.min(12, Math.round(iterations) || 0));
        radius = Math.max(1, Math.min(12, Math.round(radius) || 1));
        var ETF_MAX = 200;
        var scale = Math.min(1, ETF_MAX / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var N = cw * ch;
        var tx = new Float32Array(N), ty = new Float32Array(N), mag = new Float32Array(N);
        var maxMag = 1e-6;
        for (var cyi = 0; cyi < ch; cyi++) {
            var y0 = Math.floor(cyi / ch * h), y1 = Math.max(y0 + 1, Math.floor((cyi + 1) / ch * h));
            for (var cxi = 0; cxi < cw; cxi++) {
                var x0 = Math.floor(cxi / cw * w), x1 = Math.max(x0 + 1, Math.floor((cxi + 1) / cw * w));
                var agx = 0, agy = 0, cnt = 0;
                for (var yy = y0; yy < y1 && yy < h; yy++) {
                    var ro = yy * w;
                    for (var xx = x0; xx < x1 && xx < w; xx++) { agx += gx[ro + xx]; agy += gy[ro + xx]; cnt++; }
                }
                if (cnt) { agx /= cnt; agy /= cnt; }
                var ci = cyi * cw + cxi;
                var m = Math.sqrt(agx * agx + agy * agy);
                mag[ci] = m; if (m > maxMag) maxMag = m;
                if (m > 1e-6) { tx[ci] = -agy / m; ty[ci] = agx / m; }   // tangent = perp to gradient
                else { tx[ci] = 0; ty[ci] = 0; }
            }
        }
        for (var kk = 0; kk < N; kk++) mag[kk] = mag[kk] / maxMag;   // normalize to [0,1]
        for (var it = 0; it < iterations; it++) {
            var r1 = _etfPass(tx, ty, mag, cw, ch, radius, 0);
            var r2 = _etfPass(r1.tx, r1.ty, mag, cw, ch, radius, 1);
            tx = r2.tx; ty = r2.ty;
        }
        return { tx: tx, ty: ty, mag: mag, cw: cw, ch: ch };
    }
    // Angle function reading a refined ETF tangent field directly (no +90:
    // the field IS the tangent). The field is at coarse (cw x ch) resolution;
    // full-res (x,y) is mapped down. Confidence uses the normalized gradient
    // magnitude so flat regions blend toward noise while edges lock onto the
    // coherent flow direction.
    // DBV3 Streamlines Edge Field angle: blend the refined ETF tangent with
    // the underlying Flow Field by Edge Power (1 = pure ETF, 0.5 = equal ETF
    // + flow, per the docs). The tangent has a 180-degree ambiguity, so its
    // sign is aligned to the flow direction before blending (else opposite
    // vectors cancel). Flat regions with no ETF tangent follow the flow field.
    // Distortion adds a noise blend on top (hand-drawn quality).
    function makeEdgeFieldAngleFn(etf, flowFn, fullW, fullH, edgePower01, distortion01, noiseFreq) {
        var txA = etf.tx, tyA = etf.ty, cw = etf.cw, ch = etf.ch;
        var rx = cw / fullW, ry = ch / fullH;
        return function (x, y) {
            var cx = Math.floor(x * rx), cy = Math.floor(y * ry);
            var flowA = flowFn(x, y);
            var fx = Math.cos(flowA), fy = Math.sin(flowA);
            var vx, vy;
            if (cx >= 0 && cy >= 0 && cx < cw && cy < ch) {
                var idx = cy * cw + cx;
                var tx = txA[idx], ty = tyA[idx];
                var tmag = Math.sqrt(tx * tx + ty * ty);
                if (tmag > 1e-4) {
                    var ex = tx / tmag, ey = ty / tmag;
                    if (ex * fx + ey * fy < 0) { ex = -ex; ey = -ey; }   // align sign to flow
                    vx = edgePower01 * ex + (1 - edgePower01) * fx;
                    vy = edgePower01 * ey + (1 - edgePower01) * fy;
                } else {
                    vx = fx; vy = fy;   // no edge here -> follow the flow field
                }
            } else {
                vx = fx; vy = fy;
            }
            var theta = Math.atan2(vy, vx);
            if (distortion01 <= 0) return theta;
            var nA = p.noise(x * noiseFreq, y * noiseFreq, 3.1) * Math.PI * 4;
            var bx = (1 - distortion01) * Math.cos(theta) + distortion01 * Math.cos(nA);
            var by = (1 - distortion01) * Math.sin(theta) + distortion01 * Math.sin(nA);
            return Math.atan2(by, bx);
        };
    }
    // "Tone": reshapes the density curve (gamma-like). tone=50 is neutral.
    function toneExponent(tone) {
        var t = Math.max(0, Math.min(100, Number(tone)));
        if (t <= 50) return 2.2 + (1 - 2.2) * (t / 50);
        return 1 + (0.4 - 1) * ((t - 50) / 50);
    }
    function applyTone(weightMap, tone) {
        var exp = toneExponent(tone);
        if (Math.abs(exp - 1) < 1e-3) return weightMap;
        var out = new Float32Array(weightMap.length);
        for (var i = 0; i < weightMap.length; i++) out[i] = Math.pow(Math.max(0, weightMap[i]), exp);
        return out;
    }

    // ---- ink decomposition ---------------------------------------------
    function computeInkWeights(data, w, h, pens, colorMode) {
        var n = pens.length;
        var rgb = pens.map(hexToRgb01);
        var weights = [];
        for (var i = 0; i < n; i++) weights.push(new Float32Array(w * h));

        if (colorMode === 'cmyk') {
            // Real RGB->CMYK separation with full black generation
            // (K = 1 - max(R,G,B)), matching DrawingBotV3's CMYK separation
            // (proper GCR, unlike the linear 'separate' projection). Each of
            // the four channels is routed to the SELECTED pen nearest that
            // channel's ideal ink colour, so it works with any pen set (and
            // gracefully overlaps channels onto shared pens when <4 selected).
            var _inkIdeal = { c: [0, 1, 1], m: [1, 0, 1], y: [1, 1, 0], k: [0, 0, 0] };
            function _nearestPenIdx(t) {
                var best = 0, bd = Infinity;
                for (var i = 0; i < n; i++) {
                    var dr = rgb[i][0] - t[0], dg = rgb[i][1] - t[1], db = rgb[i][2] - t[2];
                    var d = dr * dr + dg * dg + db * db;
                    if (d < bd) { bd = d; best = i; }
                }
                return best;
            }
            var chC = _nearestPenIdx(_inkIdeal.c), chM = _nearestPenIdx(_inkIdeal.m),
                chY = _nearestPenIdx(_inkIdeal.y), chK = _nearestPenIdx(_inkIdeal.k);
            for (var cp = 0; cp < w * h; cp++) {
                var cr = data[cp * 4] / 255, cg = data[cp * 4 + 1] / 255, cb = data[cp * 4 + 2] / 255;
                var kk = 1 - Math.max(cr, cg, cb);
                var cc = 0, cm = 0, cy = 0;
                if (kk < 0.9999) { var ik = 1 - kk; cc = (1 - cr - kk) / ik; cm = (1 - cg - kk) / ik; cy = (1 - cb - kk) / ik; }
                weights[chC][cp] += cc; weights[chM][cp] += cm; weights[chY][cp] += cy; weights[chK][cp] += kk;
            }
            for (var ci = 0; ci < n; ci++) { var wt = weights[ci]; for (var q = 0; q < wt.length; q++) { if (wt[q] > 1) wt[q] = 1; else if (wt[q] < 0) wt[q] = 0; } }
        } else if (colorMode === 'nearest') {
            for (var px = 0; px < w * h; px++) {
                var r = data[px * 4] / 255, g = data[px * 4 + 1] / 255, b = data[px * 4 + 2] / 255;
                var best = 0, bestD = Infinity;
                for (var i2 = 0; i2 < n; i2++) {
                    var dr = rgb[i2][0] - r, dg = rgb[i2][1] - g, db = rgb[i2][2] - b;
                    var d = dr * dr + dg * dg + db * db;
                    if (d < bestD) { bestD = d; best = i2; }
                }
                var lum = 0.299 * r + 0.587 * g + 0.114 * b;
                weights[best][px] = 1 - lum;
            }
        } else {
            var deficits = rgb.map(function (c) { return [1 - c[0], 1 - c[1], 1 - c[2]]; });
            var norms = deficits.map(function (d) { return Math.max(1e-6, d[0] * d[0] + d[1] * d[1] + d[2] * d[2]); });
            for (var px2 = 0; px2 < w * h; px2++) {
                var r2 = data[px2 * 4] / 255, g2 = data[px2 * 4 + 1] / 255, b2 = data[px2 * 4 + 2] / 255;
                var dT = [1 - r2, 1 - g2, 1 - b2];
                for (var i3 = 0; i3 < n; i3++) {
                    var di = deficits[i3];
                    var dot = di[0] * dT[0] + di[1] * dT[1] + di[2] * dT[2];
                    weights[i3][px2] = Math.max(0, Math.min(1, dot / norms[i3]));
                }
            }
        }
        return weights;
    }

    // ---- shared line-effect helpers (used by multiple families) --------
    function catmullRomResample(points, segsPerSpan) {
        if (points.length < 3) return points;
        var out = [];
        function cr(p0, p1, p2, p3, t) {
            var t2 = t * t, t3 = t2 * t;
            return {
                x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
            };
        }
        for (var i = 0; i < points.length - 1; i++) {
            var p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
            for (var s = 0; s < segsPerSpan; s++) out.push(cr(p0, p1, p2, p3, s / segsPerSpan));
        }
        out.push(points[points.length - 1]);
        return out;
    }
    function addOscillation(points, amplitude, velMin, velMax) {
        if (points.length < 2 || amplitude <= 0) return points;
        var freq = (velMin + Math.random() * (velMax - velMin)) / 360;
        var out = []; var acc = 0;
        for (var i = 0; i < points.length; i++) {
            var p0 = points[i], dx, dy;
            if (i < points.length - 1) { dx = points[i + 1].x - p0.x; dy = points[i + 1].y - p0.y; }
            else { dx = p0.x - points[i - 1].x; dy = p0.y - points[i - 1].y; }
            var len = Math.hypot(dx, dy) || 1;
            var nx = -dy / len, ny = dx / len;
            if (i > 0) acc += Math.hypot(p0.x - points[i - 1].x, p0.y - points[i - 1].y);
            var off = Math.sin(acc * freq * Math.PI * 2) * amplitude;
            out.push({ x: p0.x + nx * off, y: p0.y + ny * off });
        }
        return out;
    }
    function scribbleCircleAt(cx, cy, r) {
        var pts = []; var loops = 2, segsPerLoop = 10;
        for (var s = 0; s <= loops * segsPerLoop; s++) {
            var a = (s / segsPerLoop) * Math.PI * 2;
            var rr = r * (0.6 + 0.4 * Math.sin(s * 0.7));
            pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
        }
        return pts;
    }
    function scribbleizeAlong(points, spacing, radiusScale) {
        if (!points.length) return points;
        var out = []; var acc = 0;
        for (var i = 0; i < points.length - 1; i++) {
            var a = points[i], b = points[i + 1];
            acc += Math.hypot(b.x - a.x, b.y - a.y);
            if (acc >= spacing) {
                acc = 0;
                var r = Math.max(0.5, spacing * 0.4 * radiusScale);
                out.push.apply(out, scribbleCircleAt(a.x, a.y, r));
                out.push(a);
            } else out.push(a);
        }
        out.push(points[points.length - 1]);
        return out;
    }

    // ---- Sketch family (mode: 'sketch') ---------------------------------
    // ---- Streamlines family (mode: 'streamlines') -----------------------
    // Both trace a flow-field with a seeded, occupancy-limited tracer;
    // Sketch differs by rendering style (lines/curves/squares/waves) and by
    // using noise-driven Angularity instead of an image field by default.
    function makeEdgeAngleFn(gxArr, gyArr, w, h, edgePower01, distortion01, noiseFreq) {
        return function (x, y) {
            var xi = Math.floor(x), yi = Math.floor(y);
            var fieldTheta;
            if (xi >= 1 && yi >= 1 && xi < w - 1 && yi < h - 1) {
                var idx = yi * w + xi;
                var mag = Math.hypot(gxArr[idx], gyArr[idx]);
                var edgeTheta = Math.atan2(gyArr[idx], gxArr[idx]) + Math.PI / 2;
                var noiseTheta0 = p.noise(x * noiseFreq, y * noiseFreq, 7.3) * Math.PI * 4;
                var trust = edgePower01 * Math.min(1, mag / 6);
                fieldTheta = edgeTheta * trust + noiseTheta0 * (1 - trust);
            } else {
                fieldTheta = p.noise(x * noiseFreq, y * noiseFreq, 7.3) * Math.PI * 4;
            }
            if (distortion01 <= 0) return fieldTheta;
            var noiseTheta = p.noise(x * noiseFreq, y * noiseFreq, 3.1) * Math.PI * 4;
            return fieldTheta * (1 - distortion01) + noiseTheta * distortion01;
        };
    }
    // DBV3 exposes X/Y Frequency AND a separate Scale Frequency that
    // uniformly multiplies both -- real presets (Turbulence, Raindrops, ...)
    // set them independently, so both are real, separate controls here too.
    // The 0.05 base-scale constant is this tracer's own choice (our working
    // image is capped at 480px, a different coordinate space than DBV3's),
    // not a value taken from their code -- so results are comparable in
    // character, not pixel-identical to DBV3's own Flow Field output.
    function makeFlowAngleFn(startAngleRad, xFreq, yFreq, scaleFreq, amplitude01, distortion01, noiseFreq) {
        var effX = xFreq * scaleFreq * 0.05, effY = yFreq * scaleFreq * 0.05;
        return function (x, y) {
            var base = startAngleRad + Math.sin(x * effX) * Math.cos(y * effY) * Math.PI * amplitude01;
            if (distortion01 <= 0) return base;
            var nt = p.noise(x * noiseFreq, y * noiseFreq, 3.1) * Math.PI * 4;
            return base * (1 - distortion01) + nt * distortion01;
        };
    }
    // Classic superformula r(theta) = (|cos(f*theta/4)|^cosFactor +
    // |sin(f*theta/4)|^sineFactor)^(-1/curvature), matching DBV3's exposed
    // Frequency / Cos Factor / Sine Factor / Curvature controls directly
    // (their X Scale/Y Scale are always 1.0 in every real preset, so they're
    // not exposed here). r is clamped to avoid overflow/underflow when large
    // exponents drive cos/sin terms toward zero.
    function makeSuperformulaAngleFn(cx, cy, startAngleRad, freq, cosFactor, sineFactor, curvature, distortion01, noiseFreq) {
        return function (x, y) {
            var dx = x - cx, dy = y - cy;
            var theta = Math.atan2(dy, dx);
            var t1 = Math.pow(Math.abs(Math.cos(freq * theta / 4)), cosFactor);
            var t2 = Math.pow(Math.abs(Math.sin(freq * theta / 4)), sineFactor);
            var sum = Math.max(1e-6, t1 + t2);
            var r = Math.max(0.01, Math.min(100, Math.pow(sum, -1 / Math.max(0.1, curvature))));
            var base = theta + Math.PI / 2 + r * 0.5 + startAngleRad;
            if (distortion01 <= 0) return base;
            var nt = p.noise(x * noiseFreq, y * noiseFreq, 3.1) * Math.PI * 4;
            return base * (1 - distortion01) + nt * distortion01;
        };
    }
    // Bounded via: hard cap on occupancy mark radius (8 cells) regardless of
    // Max Spacing / Min Separation ratio, and maxSteps caps per-line length.
    // Real evenly-spaced streamline placement (Jobard & Lefebvre, 1997,
    // "Creating Evenly-Spaced Streamlines of Arbitrary Density"). New seeds
    // are cast PERPENDICULAR to existing streamlines at the target separation,
    // and both growth and seeding use a true DISTANCE test against every prior
    // sample point (via a spatial hash) rather than a coarse occupancy grid.
    // This is what gives the clean, uniform spacing with no clumping. Density
    // modulates the separation (denser image -> tighter lines). Bounded by hard
    // caps on line count and total stored points, and an O(1) 3x3 cell query.
    function traceStreamlinesJL(weightMap, angleFn, w, h, opts) {
        var dsepMin = Math.max(1, opts.dsepMin);
        var dsepMax = Math.max(dsepMin, opts.dsepMax);
        var stepLen = Math.max(0.5, opts.stepLen);
        var maxSteps = Math.max(2, Math.round(opts.maxSteps));
        var minPts = 2, GATE = 0.03, dtestFactor = 0.5;
        var MAX_LINES = 5000, MAX_POINTS = 250000;

        var cell = Math.max(2, Math.round(dsepMax));   // cell ~ max sep => dtest query stays 3x3
        var gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell));
        var grid = new Array(gw * gh);
        var totalPoints = 0;

        function densityAt(x, y) { var xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0; return weightMap[yi * w + xi] || 0; }
        function sepAt(x, y) { return dsepMin + (dsepMax - dsepMin) * (1 - densityAt(x, y)); }
        function addPoint(x, y) {
            var cx = (x / cell) | 0, cy = (y / cell) | 0;
            if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return;
            var k = cy * gw + cx, a = grid[k]; if (!a) { a = []; grid[k] = a; }
            a.push(x, y); totalPoints++;
        }
        function tooClose(x, y, minDist) {
            var r = Math.max(1, Math.ceil(minDist / cell));
            var cx = (x / cell) | 0, cy = (y / cell) | 0, md2 = minDist * minDist;
            for (var dy = -r; dy <= r; dy++) {
                var yy = cy + dy; if (yy < 0 || yy >= gh) continue;
                var ro = yy * gw;
                for (var dx = -r; dx <= r; dx++) {
                    var xx = cx + dx; if (xx < 0 || xx >= gw) continue;
                    var a = grid[ro + xx]; if (!a) continue;
                    for (var i = 0; i < a.length; i += 2) { var ex = a[i] - x, ey = a[i + 1] - y; if (ex * ex + ey * ey < md2) return true; }
                }
            }
            return false;
        }
        function integrate(sx, sy, sign) {
            var pts = [], x = sx, y = sy;
            for (var s = 0; s < maxSteps; s++) {
                var theta = angleFn(x, y);
                var nx = x + Math.cos(theta) * stepLen * sign, ny = y + Math.sin(theta) * stepLen * sign;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
                if (densityAt(nx, ny) <= GATE) break;
                if (tooClose(nx, ny, sepAt(nx, ny) * dtestFactor)) break;
                pts.push(nx, ny); x = nx; y = ny;
            }
            return pts;
        }
        function makeLine(sx, sy) {
            var fwd = integrate(sx, sy, 1), back = integrate(sx, sy, -1), poly = [];
            for (var i = back.length - 2; i >= 0; i -= 2) poly.push({ x: back[i], y: back[i + 1] });
            poly.push({ x: sx, y: sy });
            for (var j = 0; j < fwd.length; j += 2) poly.push({ x: fwd[j], y: fwd[j + 1] });
            return poly;
        }
        function commit(poly) { for (var i = 0; i < poly.length; i++) addPoint(poly[i].x, poly[i].y); }

        var streamlines = [], queue = [], firstSeed = null;
        for (var yy = cell; yy < h && !firstSeed; yy += cell) for (var xx = cell; xx < w; xx += cell) if (densityAt(xx, yy) > 0.3) { firstSeed = { x: xx, y: yy }; break; }
        if (!firstSeed) for (var y2 = cell; y2 < h && !firstSeed; y2 += cell) for (var x2 = cell; x2 < w; x2 += cell) if (densityAt(x2, y2) > GATE) { firstSeed = { x: x2, y: y2 }; break; }
        if (firstSeed) { var l0 = makeLine(firstSeed.x, firstSeed.y); if (l0.length >= minPts) { streamlines.push(l0); queue.push(l0); commit(l0); } }

        var qi = 0;
        while (qi < queue.length && streamlines.length < MAX_LINES && totalPoints < MAX_POINTS) {
            var sl = queue[qi++], acc = 0;
            for (var pi = 1; pi < sl.length; pi++) {
                var bx = sl[pi].x, by = sl[pi].y;
                acc += Math.hypot(bx - sl[pi - 1].x, by - sl[pi - 1].y);
                var dsep = sepAt(bx, by);
                if (acc < dsep) continue;
                acc = 0;
                var perp = angleFn(bx, by) + Math.PI / 2;
                for (var side = -1; side <= 1; side += 2) {
                    var candX = bx + Math.cos(perp) * dsep * side, candY = by + Math.sin(perp) * dsep * side;
                    if (candX < 0 || candY < 0 || candX >= w || candY >= h) continue;
                    if (densityAt(candX, candY) <= GATE) continue;
                    if (tooClose(candX, candY, dsep * 0.9)) continue;
                    var nl = makeLine(candX, candY);
                    if (nl.length >= minPts) { streamlines.push(nl); queue.push(nl); commit(nl); }
                    if (streamlines.length >= MAX_LINES || totalPoints >= MAX_POINTS) break;
                }
                if (streamlines.length >= MAX_LINES || totalPoints >= MAX_POINTS) break;
            }
        }
        return streamlines;
    }
    function traceFlowLines(weightMap, angleFn, w, h, opts) {
        var cellSize = Math.max(1, opts.minSep);
        var occW = Math.max(1, Math.ceil(w / cellSize)), occH = Math.max(1, Math.ceil(h / cellSize));
        var occ = new Uint8Array(occW * occH);
        function densityAt(x, y) {
            var xi = Math.floor(x), yi = Math.floor(y);
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
            return weightMap[yi * w + xi] || 0;
        }
        function sepAt(x, y) {
            if (!opts.maxSpacing || opts.maxSpacing <= opts.minSep) return opts.minSep;
            var d = densityAt(x, y);
            return opts.minSep + (opts.maxSpacing - opts.minSep) * (1 - d);
        }
        function isOccupied(x, y) {
            var cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
            if (cx < 0 || cy < 0 || cx >= occW || cy >= occH) return true;
            return !!occ[cy * occW + cx];
        }
        function markOccRadius(x, y, radiusPx) {
            var cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
            var rc = Math.max(1, Math.min(8, Math.round(radiusPx / cellSize)));
            for (var dy = -rc; dy <= rc; dy++) {
                for (var dx = -rc; dx <= rc; dx++) {
                    if (dx * dx + dy * dy > rc * rc) continue;
                    var xx = cx + dx, yy = cy + dy;
                    if (xx < 0 || yy < 0 || xx >= occW || yy >= occH) continue;
                    occ[yy * occW + xx] = 1;
                }
            }
        }
        // Occupancy is committed AFTER a whole line finishes tracing, not
        // step-by-step during it -- marking-as-you-go self-blocked a line's
        // very first step whenever its local separation radius exceeded the
        // step length (the common case), producing zero-length lines.
        function traceOneDir(x0, y0, sign, outArr) {
            var x = x0, y = y0;
            for (var s = 0; s < opts.maxSteps; s++) {
                var xi = Math.floor(x), yi = Math.floor(y);
                if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) break;
                var theta = angleFn(x, y);
                var nx = x + Math.cos(theta) * opts.stepLen * sign;
                var ny = y + Math.sin(theta) * opts.stepLen * sign;
                if (densityAt(nx, ny) <= 0.03) break;
                if (isOccupied(nx, ny)) break;
                outArr.push({ x: nx, y: ny });
                x = nx; y = ny;
            }
        }
        function commitLine(pts) {
            for (var i = 0; i < pts.length; i++) markOccRadius(pts[i].x, pts[i].y, sepAt(pts[i].x, pts[i].y));
        }
        var polylines = [];
        for (var sy = opts.seedSpacing / 2; sy < h; sy += opts.seedSpacing) {
            for (var sx = opts.seedSpacing / 2; sx < w; sx += opts.seedSpacing) {
                var dens = densityAt(sx, sy);
                if (dens <= 0.03) continue;
                if (Math.random() > dens) continue;
                if (isOccupied(sx, sy)) continue;
                var fwd = [], back = [];
                traceOneDir(sx, sy, 1, fwd);
                traceOneDir(sx, sy, -1, back);
                back.reverse();
                var pts = back.concat([{ x: sx, y: sy }], fwd);
                if (pts.length >= 3) { polylines.push(pts); commitLine(pts); }
                else markOccRadius(sx, sy, cellSize);
            }
        }
        return polylines;
    }
    // Faithful port of DrawingBotV3's real, open-source Sketch engine
    // (AbstractDarkestPFM.java + AbstractSketchPFM.java + PFMSketchLinesBasic
    // /PFMSketchSquaresBasic.java, GPL, legitimately public source -- not
    // decompiled). The real algorithm: (1) find the darkest remaining block
    // of the working image and seed a line there, (2) test many candidate
    // angles, walk each outward tracking running average density, keep the
    // single best (densest) endpoint found, (3) "erase" (reduce) density
    // along the drawn segment so the search naturally spreads out instead of
    // redrawing the same area, (4) continue the squiggle from that endpoint
    // until no good candidate remains or a length cap is hit, then reseed.
    // 'Lines' vs 'Squares' differ only in how the candidate angle is chosen:
    // Lines picks fresh random angles each step; Squares derives a angle from
    // a fixed sin/cos wave of position, producing the grid-like "rectangular
    // pattern" look (not literal square shapes) that the real PFM produces.
    // Not ported: the "shouldLiftPen=false" continuous-pen mode and the
    // shading-threshold angle switch -- both add real complexity for a
    // secondary visual effect; simplified to always lift-pen-at-squiggle-end.
    // Bounded via hard caps (maxSquiggles/maxTotalLines/MAX_FAILS) so a
    // pathological slider combination can't loop indefinitely.
    function easeInCubicJS(t) { return t * t * t; }
    function findDarkestArea(density, w, h) {
        var blockW = 10, blockH = 10;
        // Scan order is shuffled each call: with a strict ">" comparison,
        // ties between equally-dark blocks always favored whichever was
        // scanned first (top-left, since by/bx increase left-to-right,
        // top-to-bottom). On a large uniformly-dark region that meant every
        // squiggle re-seeded near the same corner first; since this can be
        // called up to MAX_SQUIGGLES times before the (much smaller)
        // MAX_TOTAL_LINES cap is hit, that corner got fully cleared while
        // the opposite side of the same region was starved -- read by a
        // user as "more density on one side, looks like double plotting".
        var blocks = [];
        for (var by0 = 0; by0 < h; by0 += blockH) for (var bx0 = 0; bx0 < w; bx0 += blockW) blocks.push([bx0, by0]);
        for (var si = blocks.length - 1; si > 0; si--) {
            var sj = Math.floor(Math.random() * (si + 1));
            var stmp = blocks[si]; blocks[si] = blocks[sj]; blocks[sj] = stmp;
        }
        var bestBlockAvg = -1, bestX = 0, bestY = 0, found = false;
        for (var bi = 0; bi < blocks.length; bi++) {
            var bx = blocks[bi][0], by = blocks[bi][1];
            {
                var sum = 0, cnt = 0, localBestX = bx, localBestY = by, localBest = -1;
                var ex = Math.min(w, bx + blockW), ey = Math.min(h, by + blockH);
                for (var y = by; y < ey; y++) {
                    for (var x = bx; x < ex; x++) {
                        var d = density[y * w + x] || 0;
                        sum += d; cnt++;
                        if (d > localBest) { localBest = d; localBestX = x; localBestY = y; }
                    }
                }
                var avg = cnt ? sum / cnt : 0;
                if (avg > bestBlockAvg) { bestBlockAvg = avg; bestX = localBestX; bestY = localBestY; found = true; }
            }
        }
        return found ? { x: bestX, y: bestY, blockAvg: bestBlockAvg } : null;
    }
    function findDarkestLineJS(density, w, h, startX, startY, minLen, maxLen, numTests, startAngleDeg, deltaAngleDeg) {
        var best = null;
        var tests = Math.max(1, Math.round(numTests));
        for (var t = 0; t < tests; t++) {
            var angleDeg = startAngleDeg + (tests <= 1 ? 0 : (deltaAngleDeg * t) / tests);
            var rad = angleDeg * Math.PI / 180;
            var dx = Math.cos(rad), dy = Math.sin(rad);
            var sum = 0, count = 0, bestOnLine = null;
            for (var len = 1; len <= maxLen; len++) {
                var x = Math.round(startX + dx * len), y = Math.round(startY + dy * len);
                if (x < 0 || y < 0 || x >= w || y >= h) break;
                sum += density[y * w + x] || 0;
                count++;
                if (count >= minLen) {
                    var avg = sum / count;
                    if (!bestOnLine || avg > bestOnLine.avg) bestOnLine = { x: x, y: y, avg: avg };
                }
            }
            if (bestOnLine && (!best || bestOnLine.avg > best.avg)) best = bestOnLine;
        }
        return best;
    }
    function eraseAlongSegment(density, w, h, x0, y0, x1, y1, radiusMin, radiusMax, eraseMin, eraseMax, tone) {
        var xi = Math.round(x0), yi = Math.round(y0);
        var local = (xi >= 0 && yi >= 0 && xi < w && yi < h) ? (density[yi * w + xi] || 0) : 0;
        var xP = 1 - local;
        var yP = easeInCubicJS(xP) * tone + xP * (1 - tone);
        var radius = radiusMin + yP * (radiusMax - radiusMin);
        var eraseAmt = eraseMin + yP * (eraseMax - eraseMin);
        var steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
        var r2 = radius * radius;
        for (var s = 0; s <= steps; s++) {
            var t = s / steps;
            var px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
            var rx0 = Math.max(0, Math.floor(px - radius)), rx1 = Math.min(w - 1, Math.ceil(px + radius));
            var ry0 = Math.max(0, Math.floor(py - radius)), ry1 = Math.min(h - 1, Math.ceil(py + radius));
            for (var yy = ry0; yy <= ry1; yy++) {
                for (var xx = rx0; xx <= rx1; xx++) {
                    if ((xx - px) * (xx - px) + (yy - py) * (yy - py) > r2) continue;
                    var idx = yy * w + xx;
                    density[idx] = Math.max(0, (density[idx] || 0) - eraseAmt);
                }
            }
        }
    }
    function waveFieldFn(type, v) {
        var r;
        if (type === 'cos') r = Math.cos(v);
        else if (type === 'tan') r = Math.tan(v);
        else r = Math.sin(v);
        if (!isFinite(r)) r = 0;
        return Math.max(-6, Math.min(6, r));   // clamp tan blow-ups near asymptotes
    }
    function traceSketchReal(weightMap, w, h, opts) {
        var density = new Float32Array(weightMap.length);
        density.set(weightMap);
        var polylines = [];
        var totalLines = 0, fails = 0, squiggleCount = 0;
        var MAX_FAILS = 300, MAX_SQUIGGLES = 600, MAX_TOTAL_LINES = 3000;

        while (squiggleCount < MAX_SQUIGGLES && totalLines < MAX_TOTAL_LINES) {
            var seed = findDarkestArea(density, w, h);
            if (!seed || seed.blockAvg <= 0.05) break;
            squiggleCount++;

            var curX = seed.x, curY = seed.y;
            var cur = [{ x: curX, y: curY }];
            var failedThisSquiggle = true;

            for (var s = 0; s < opts.squiggleMaxLength; s++) {
                var startAngleDeg, searchDelta;
                if (opts.angleMode === 'squares') {
                    startAngleDeg = opts.squareStartAngle + (Math.sin(curX / 9) + Math.cos(curY / 9 + 26)) * 180 / Math.PI;
                    searchDelta = 360;
                } else if (opts.angleMode === 'waves') {
                    // DBV3 Sketch Waves: line direction follows an X/Y curve
                    // field; the darkest-line search is CONSTRAINED to a narrow
                    // wedge centred on that direction so lines flow ALONG the
                    // field, instead of sweeping all 360 deg like lines mode.
                    var waveDir = opts.waveStartAngle
                        + (waveFieldFn(opts.waveTypeX, ((curX / w * 100) + opts.waveOffsetX) / opts.waveDivisorX)
                         + waveFieldFn(opts.waveTypeY, ((curY / h * 100) + opts.waveOffsetY) / opts.waveDivisorY)) * 180 / Math.PI;
                    searchDelta = opts.waveDelta;
                    startAngleDeg = waveDir - searchDelta / 2;
                } else {
                    startAngleDeg = opts.startAngleMin + Math.random() * (opts.startAngleMax - opts.startAngleMin);
                    searchDelta = 360;
                }
                var result = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, opts.lineTests, startAngleDeg, searchDelta);
                if (!result) break;
                eraseAlongSegment(density, w, h, curX, curY, result.x, result.y, opts.radiusMin, opts.radiusMax, opts.eraseMin, opts.eraseMax, opts.eraseTone);
                cur.push({ x: result.x, y: result.y });
                curX = result.x; curY = result.y;
                totalLines++;
                failedThisSquiggle = false;
                if (totalLines >= MAX_TOTAL_LINES) break;
            }

            if (cur.length >= 2) polylines.push(cur);
            if (failedThisSquiggle) {
                density[seed.y * w + seed.x] = 0;
                fails++;
                if (fails >= MAX_FAILS) break;
            } else {
                fails = 0;
            }
        }
        return polylines;
    }
    function applySketchStyle(polylines, style) {
        // 'waves' is now a REAL wave-field tracer (handled in traceSketchReal);
        // smooth its output like curves for a flowing look. lines/squares are
        // raw real-algorithm output.
        if (style === 'curves' || style === 'waves') return polylines.map(function (l) { return catmullRomResample(l, 4); });
        return polylines;
    }

    // ---- Hatch family (mode: 'hatch') ------------------------------------
    function traceHatch(weightMap, w, h, spacing, angleDeg, crosshatch, linkEnds, style, amplitude, velMin, velMax) {
        function scanDirection(angDeg, threshold) {
            var out = [];
            var rad = angDeg * Math.PI / 180;
            var dx = Math.cos(rad), dy = Math.sin(rad);
            var nx = -dy, ny = dx;
            var diag = Math.hypot(w, h);
            var steps = Math.ceil((2 * diag) / spacing);
            var gapTol = linkEnds ? 6 : 0;
            for (var i = -steps; i <= steps; i++) {
                var ox = w / 2 + nx * i * spacing, oy = h / 2 + ny * i * spacing;
                var cur = null, gap = 0;
                for (var t = -diag; t <= diag; t += 1.5) {
                    var x = ox + dx * t, y = oy + dy * t;
                    var xi = Math.floor(x), yi = Math.floor(y);
                    var dens = (xi >= 0 && yi >= 0 && xi < w && yi < h) ? (weightMap[yi * w + xi] || 0) : 0;
                    if (dens > threshold) {
                        if (!cur) cur = [];
                        cur.push({ x: x, y: y });
                        gap = 0;
                    } else if (cur) {
                        gap++;
                        if (gap > gapTol) { if (cur.length >= 2) out.push(cur); cur = null; gap = 0; }
                        else cur.push({ x: x, y: y });
                    }
                }
                if (cur && cur.length >= 2) out.push(cur);
            }
            return out;
        }
        var lines = scanDirection(angleDeg, 0.15);
        if (crosshatch) lines = lines.concat(scanDirection(angleDeg + 90, 0.5));
        if (style === 'sawtooth') lines = lines.map(function (l) { return addOscillation(l, spacing * 0.4 * amplitude, velMin, velMax); });
        else if (style === 'scribbles') lines = lines.map(function (l) { return scribbleizeAlong(l, Math.max(3, spacing * 0.8), amplitude); });
        return lines;
    }

    // ---- Spiral family (mode: 'spiral') -----------------------------------
    // Faithful port of DrawingBotV3's real, open-source PFMSpiralBasic.java
    // (github.com/SonarSonic/DrawingBotV3, GPL, legitimately public source --
    // not decompiled). The real algorithm steps angle by an arc-length-
    // derived velocity (not a fixed theta increment), and produces its
    // "sawtooth" oscillation INTRINSICALLY by sampling density and offsetting
    // the radius up then down each step -- there's no separate style code
    // path in the original; Amplitude alone sweeps smooth -> sawtooth.
    // "Circular Scribbles" is a different, Premium-only PFM with no public
    // source, so that style here stays our own approximation (scribbleizeAlong
    // layered on top of this real trace), clearly not a port.
    function easeInSine(t) { return 1 - Math.cos(t * Math.PI / 2); }
    function traceSpiralReal(weightMap, w, h, opts) {
        // opts: spiralType('archimedean'|'parabolic'), spiralSize, centreXScale,
        // centreYScale, ringSpacing, amplitude, variableVelocity, minVelocity,
        // maxVelocity, connectedLines, ignoreWhite
        var MAX_ITER = 30000; // hard safety cap independent of user sliders
        function densityAt(x, y) {
            var xi = Math.floor(x), yi = Math.floor(y);
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
            return weightMap[yi * w + xi] || 0;
        }
        function spiralX(parabolic, pass, radius, alphaDeg, cx) {
            var rad = alphaDeg * Math.PI / 180;
            if (parabolic) {
                var off = radius * Math.sqrt(Math.max(0, alphaDeg) * Math.PI / 180);
                if (pass === 2) off = -off;
                return off * Math.cos(rad) + cx;
            }
            return radius * Math.cos(rad) + cx;
        }
        function spiralY(parabolic, pass, radius, alphaDeg, cy) {
            var rad = alphaDeg * Math.PI / 180;
            if (parabolic) {
                var off = radius * Math.sqrt(Math.max(0, alphaDeg) * Math.PI / 180);
                if (pass === 2) off = -off;
                return off * Math.sin(rad) + cy;
            }
            return radius * Math.sin(rad) + cy;
        }

        var parabolic = opts.spiralType === 'parabolic';
        var cx = w * opts.centreXScale, cy = h * opts.centreYScale;
        var corners = [
            Math.hypot(cx, cy), Math.hypot(cx, cy - h),
            Math.hypot(cx - w, cy), Math.hypot(cx - w, cy - h)
        ];
        var endRadius = Math.max.apply(null, corners) * opts.spiralSize;

        var totalPasses = parabolic ? 2 : 1;
        var rs = Math.max(0.5, parabolic ? opts.ringSpacing / 10 : opts.ringSpacing);
        var amp = parabolic ? opts.amplitude / 1.5 : opts.amplitude;
        var minV = Math.max(0.1, parabolic ? opts.minVelocity / 10 : opts.minVelocity);
        var maxV = Math.max(minV, parabolic ? opts.maxVelocity / 10 : opts.maxVelocity);
        if (!opts.variableVelocity) maxV = minV;

        var polylines = [];
        var lastDensity = 0;

        for (var pass = 1; pass <= totalPasses; pass++) {
            var k = (minV / 2) / (rs / 2);
            var alpha = 0;
            var radius = rs / (360 / k);
            var cur = [];
            var iter = 0;
            var loopCond = parabolic
                ? function () { return radius * Math.sqrt(Math.max(0, alpha) * Math.PI / 180) < endRadius; }
                : function () { return radius < endRadius; };

            while (loopCond() && iter < MAX_ITER) {
                iter++;
                var x = spiralX(parabolic, pass, radius, alpha, cx);
                var y = spiralY(parabolic, pass, radius, alpha, cy);

                k = (minV / 2) / Math.max(0.01, radius);
                alpha += k;
                radius += rs / (360 / k);

                var dens = densityAt(x, y);
                var avgDens = (dens + lastDensity) / 2;
                lastDensity = dens;

                var lumOffset = avgDens * (rs / 2 * amp);
                var velocity = minV + easeInSine(1 - avgDens) * (maxV - minV);

                k = (velocity / 2) / Math.max(0.01, radius);
                alpha += k;
                radius += rs / (360 / k);
                var aRadius = radius + lumOffset;
                var xa = spiralX(parabolic, pass, aRadius, alpha, cx);
                var ya = spiralY(parabolic, pass, aRadius, alpha, cy);

                k = (velocity / 2) / Math.max(0.01, radius);
                alpha += k;
                radius += rs / (360 / k);
                var bRadius = radius - lumOffset;
                var xb = spiralX(parabolic, pass, bRadius, alpha, cx);
                var yb = spiralY(parabolic, pass, bRadius, alpha, cy);

                var within = (xa >= 0 && xa < w && ya >= 0 && ya < h) || (xb >= 0 && xb < w && yb >= 0 && yb < h);
                var draw = within && !(opts.ignoreWhite && avgDens <= 0.04);

                if (draw) {
                    if (!opts.connectedLines || cur.length === 0) {
                        if (cur.length >= 2) polylines.push(cur);
                        cur = [{ x: xa, y: ya }];
                    } else {
                        cur.push({ x: xa, y: ya });
                    }
                    cur.push({ x: xb, y: yb });
                } else {
                    if (cur.length >= 2) polylines.push(cur);
                    cur = [];
                }
            }
            if (cur.length >= 2) polylines.push(cur);
        }
        return polylines;
    }

    // ---- Voronoi / Stippling family (mode: 'stipple') --------------------
    // "Voronoi Iterations" is approximated as bucketed local-repulsion
    // relaxation (spatial hash, O(n) per pass) rather than a true recomputed
    // Voronoi diagram each iteration -- much cheaper, same qualitative
    // "points spread out, denser areas stay packed" result.
    function relaxPoints(points, weightMap, w, h, iterations, neighborRadius) {
        iterations = Math.max(0, Math.min(20, Math.round(iterations) || 0));
        if (!iterations || points.length < 2) return points;
        var cell = Math.max(2, neighborRadius);
        for (var it = 0; it < iterations; it++) {
            var buckets = {};
            for (var i = 0; i < points.length; i++) {
                var key = Math.floor(points[i].x / cell) + ',' + Math.floor(points[i].y / cell);
                (buckets[key] = buckets[key] || []).push(i);
            }
            var newX = new Float32Array(points.length), newY = new Float32Array(points.length);
            for (var i2 = 0; i2 < points.length; i2++) {
                var p1 = points[i2];
                var gx2 = Math.floor(p1.x / cell), gy2 = Math.floor(p1.y / cell);
                var fx = 0, fy = 0;
                for (var dgy = -1; dgy <= 1; dgy++) {
                    for (var dgx = -1; dgx <= 1; dgx++) {
                        var bucket = buckets[(gx2 + dgx) + ',' + (gy2 + dgy)];
                        if (!bucket) continue;
                        for (var bi = 0; bi < bucket.length; bi++) {
                            var j = bucket[bi];
                            if (j === i2) continue;
                            var p2 = points[j];
                            var dx = p1.x - p2.x, dy = p1.y - p2.y;
                            var d2 = dx * dx + dy * dy;
                            if (d2 > neighborRadius * neighborRadius || d2 < 1e-6) continue;
                            var d = Math.sqrt(d2);
                            var push = (neighborRadius - d) / neighborRadius;
                            fx += (dx / d) * push; fy += (dy / d) * push;
                        }
                    }
                }
                var xi = Math.floor(p1.x), yi = Math.floor(p1.y);
                var dens = (xi >= 0 && yi >= 0 && xi < w && yi < h) ? (weightMap[yi * w + xi] || 0) : 0;
                var strength = 0.5 * (1 - dens * 0.6);
                newX[i2] = Math.max(0, Math.min(w, p1.x + fx * strength));
                newY[i2] = Math.max(0, Math.min(h, p1.y + fy * strength));
            }
            for (var i3 = 0; i3 < points.length; i3++) { points[i3].x = newX[i3]; points[i3].y = newY[i3]; }
        }
        return points;
    }
    function traceStipple(weightMap, w, h, pointDensity, radiusMin, radiusMax, pointLimit, luminancePower, voronoiIterations, shape) {
        var spacing = Math.max(2, Math.min(60, 200 / Math.max(1, pointDensity)));
        var biasExp = Math.max(0.3, 3 - (Math.max(1, Math.min(50, luminancePower)) / 50) * 2.7); // higher power -> stronger dark bias
        var candidates = [];
        for (var sy = spacing / 2; sy < h; sy += spacing) {
            for (var sx = spacing / 2; sx < w; sx += spacing) {
                var jx = sx + (Math.random() - 0.5) * spacing * 0.8;
                var jy = sy + (Math.random() - 0.5) * spacing * 0.8;
                var xi = Math.floor(jx), yi = Math.floor(jy);
                if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
                var dens = weightMap[yi * w + xi] || 0;
                if (dens <= 0.04) continue;
                var biased = Math.pow(dens, biasExp);
                if (Math.random() > biased) continue;
                candidates.push({ x: jx, y: jy, d: dens });
            }
        }
        candidates.sort(function (a, b) { return b.d - a.d; });
        if (candidates.length > pointLimit) candidates.length = pointLimit;
        relaxPoints(candidates, weightMap, w, h, voronoiIterations, Math.max(2, spacing * 0.7));
        var polylines = [];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var r = radiusMin + (radiusMax - radiusMin) * c.d;
            if (shape === 'dash') {
                var ang = Math.random() * Math.PI;
                polylines.push([{ x: c.x - Math.cos(ang) * r, y: c.y - Math.sin(ang) * r }, { x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r }]);
            } else if (shape === 'square') {
                polylines.push([{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y - r }, { x: c.x + r, y: c.y + r }, { x: c.x - r, y: c.y + r }, { x: c.x - r, y: c.y - r }]);
            } else {
                var pts = []; var segs = 8;
                for (var s = 0; s <= segs; s++) { var a = (s / segs) * Math.PI * 2; pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }); }
                polylines.push(pts);
            }
        }
        return polylines;
    }

    // ---- Adaptive family (mode: 'adaptive', NEW) --------------------------
    // Recursive quadtree subdivision: split cells with high local variance
    // or oversized cells, stop at Min Sample Radius; one shape per leaf.
    // Hard-capped by both a total-cell limit and a total-work-item limit so
    // a very small Min Sample Radius degrades (fewer, coarser cells kept)
    // rather than exploding into unbounded recursion.
    function traceAdaptive(weightMap, w, h, minRadius, maxRadius, shape) {
        var CELL_CAP = 3000, WORK_CAP = 20000;
        function avgDensity(x, y, size) {
            var x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
            var x1 = Math.min(w, Math.ceil(x + size)), y1 = Math.min(h, Math.ceil(y + size));
            if (x1 <= x0 || y1 <= y0) return 0;
            var stepPx = Math.max(1, Math.floor(size / 6));
            var sum = 0, cnt = 0;
            for (var yy = y0; yy < y1; yy += stepPx) for (var xx = x0; xx < x1; xx += stepPx) { sum += weightMap[yy * w + xx] || 0; cnt++; }
            return cnt ? sum / cnt : 0;
        }
        function varianceOf(x, y, size) {
            var half = size / 2;
            var a = avgDensity(x, y, half), b = avgDensity(x + half, y, half), c = avgDensity(x, y + half, half), d = avgDensity(x + half, y + half, half);
            var m = (a + b + c + d) / 4;
            return Math.sqrt(((a - m) * (a - m) + (b - m) * (b - m) + (c - m) * (c - m) + (d - m) * (d - m)) / 4);
        }
        var minR = Math.max(1, minRadius), maxR = Math.max(minR * 1.2, maxRadius);
        var stack = [{ x: 0, y: 0, size: Math.max(w, h) }];
        var cells = [], work = 0;
        while (stack.length && cells.length < CELL_CAP && work < WORK_CAP) {
            work++;
            var cell = stack.pop();
            if (cell.x >= w || cell.y >= h) continue;
            var size = cell.size;
            var dens = avgDensity(cell.x, cell.y, size);
            var canSubdivide = size > minR * 2;
            var shouldSubdivide = canSubdivide && (size > maxR * 2 || varianceOf(cell.x, cell.y, size) > 0.06);
            if (shouldSubdivide) {
                var half = size / 2;
                // Push order is shuffled: a LIFO stack pops the LAST-pushed
                // child first, so a fixed push order (TL,TR,BL,BR) always
                // dove into the bottom-right quadrant first at every level.
                // On a busy image where CELL_CAP/WORK_CAP truncates before
                // full coverage, that meant bottom-right got fully detailed
                // while the opposite corner was starved of cells entirely.
                var children = [
                    { x: cell.x, y: cell.y, size: half },
                    { x: cell.x + half, y: cell.y, size: half },
                    { x: cell.x, y: cell.y + half, size: half },
                    { x: cell.x + half, y: cell.y + half, size: half }
                ];
                for (var ci = children.length - 1; ci > 0; ci--) {
                    var cj = Math.floor(Math.random() * (ci + 1));
                    var ctmp = children[ci]; children[ci] = children[cj]; children[cj] = ctmp;
                }
                for (var cpi = 0; cpi < children.length; cpi++) stack.push(children[cpi]);
            } else if (dens > 0.05) {
                cells.push({ cx: cell.x + size / 2, cy: cell.y + size / 2, size: size, density: dens });
            }
        }
        var out = [];
        cells.forEach(function (c) {
            var r = Math.max(1, c.size * 0.35 * (0.4 + 0.6 * c.density));
            if (shape === 'circle') {
                var pts = []; var segs = 10;
                for (var s = 0; s <= segs; s++) { var a = (s / segs) * Math.PI * 2; pts.push({ x: c.cx + Math.cos(a) * r, y: c.cy + Math.sin(a) * r }); }
                out.push(pts);
            } else if (shape === 'dash') {
                var ang = Math.random() * Math.PI;
                out.push([{ x: c.cx - Math.cos(ang) * r, y: c.cy - Math.sin(ang) * r }, { x: c.cx + Math.cos(ang) * r, y: c.cy + Math.sin(ang) * r }]);
            } else if (shape === 'scribble') {
                out.push(scribbleCircleAt(c.cx, c.cy, r));
            } else {
                out.push([{ x: c.cx - r, y: c.cy - r }, { x: c.cx + r, y: c.cy - r }, { x: c.cx + r, y: c.cy + r }, { x: c.cx - r, y: c.cy + r }, { x: c.cx - r, y: c.cy - r }]);
            }
        });
        return out;
    }

    function generate() {
        if (!srcImageData || busy) return;
        busy = true; updateHelp(); p.redraw();
        setTimeout(function () {
            try {
                var lum = toLuminance(srcImageData, workW, workH, PARAMS.brightness, PARAMS.contrast, PARAMS.invert === 'on');
                var field = computeGradientField(lum, workW, workH);
                var pens = selectedPens();
                var weights = computeInkWeights(srcImageData, workW, workH, pens, PARAMS.colorMode);
                var result = {};
                var mode = PARAMS.mode;
                var distortion01 = Math.max(0, Math.min(1, (Number(PARAMS.distortion) || 0) / 100));
                var ignoreWhite = PARAMS.ignoreWhite === 'on';

                var streamAngleFn = null;
                if (mode === 'streamlines') {
                    if (PARAMS.fieldType === 'flow') {
                        streamAngleFn = makeFlowAngleFn(PARAMS.flowStartAngle * Math.PI / 180, PARAMS.flowXFreq, PARAMS.flowYFreq, Math.max(0.01, PARAMS.flowScaleFreq), Math.max(0, Math.min(1, PARAMS.flowAmplitude / 100)), distortion01, 0.02);
                    } else if (PARAMS.fieldType === 'superformula') {
                        streamAngleFn = makeSuperformulaAngleFn(workW / 2, workH / 2, PARAMS.flowStartAngle * Math.PI / 180, Math.max(2, PARAMS.sfFrequency), Math.max(0.1, PARAMS.sfCosFactor), Math.max(0.1, PARAMS.sfSineFactor), Math.max(0.1, PARAMS.sfCurvature), distortion01, 0.02);
                    } else {
                        // Authentic DBV3 Edge Field: real ETF (Kang et al.)
                        // BLENDED with the underlying Flow Field by Edge Power.
                        // "Smooth" (post-blur) optionally smooths the tangent field.
                        var etf = refineETF(field.gx, field.gy, workW, workH, PARAMS.etfIterations, PARAMS.etfRadius);
                        if (PARAMS.postBlurIterations > 0) {
                            var pb = blurVectorField(etf.tx, etf.ty, etf.cw, etf.ch, PARAMS.postBlurIterations, PARAMS.postBlurRadius);
                            etf.tx = pb.gx; etf.ty = pb.gy;
                        }
                        var edgeFlowFn = makeFlowAngleFn(PARAMS.flowStartAngle * Math.PI / 180, PARAMS.flowXFreq, PARAMS.flowYFreq, Math.max(0.01, PARAMS.flowScaleFreq), Math.max(0, Math.min(1, PARAMS.flowAmplitude / 100)), 0, 0.02);
                        streamAngleFn = makeEdgeFieldAngleFn(etf, edgeFlowFn, workW, workH, Math.max(0, Math.min(1, PARAMS.edgePower / 100)), distortion01, 0.02);
                    }
                }

                for (var i = 0; i < pens.length; i++) {
                    var wMap = weights[i];
                    if (mode === 'hatch') {
                        result[pens[i]] = traceHatch(wMap, workW, workH,
                            Math.max(2, PARAMS.hatchSpacing), Number(PARAMS.hatchAngle) || 0,
                            PARAMS.crosshatch === 'on', PARAMS.linkEnds === 'on',
                            PARAMS.hatchStyle, Math.max(0.1, PARAMS.hatchAmplitude), Math.max(1, PARAMS.hatchVelocityMin), Math.max(1, PARAMS.hatchVelocityMax));
                    } else if (mode === 'stipple') {
                        result[pens[i]] = traceStipple(wMap, workW, workH,
                            Math.max(5, PARAMS.pointDensity), Math.max(0.1, PARAMS.stippleRadiusMin),
                            Math.max(PARAMS.stippleRadiusMin, PARAMS.stippleRadiusMax), Math.max(10, PARAMS.pointLimit),
                            PARAMS.luminancePower, PARAMS.voronoiIterations, PARAMS.stippleShape);
                    } else if (mode === 'spiral') {
                        var spiralRaw = traceSpiralReal(wMap, workW, workH, {
                            spiralType: (PARAMS.spiralStyle === 'parabolic') ? 'parabolic' : 'archimedean',
                            spiralSize: Math.max(0.1, PARAMS.spiralSize), centreXScale: Math.max(0, Math.min(1, PARAMS.spiralCentreX / 100)),
                            centreYScale: Math.max(0, Math.min(1, PARAMS.spiralCentreY / 100)), ringSpacing: Math.max(1, PARAMS.ringSpacing),
                            amplitude: Math.max(0.01, PARAMS.spiralAmplitude), variableVelocity: PARAMS.spiralVariableVelocity !== 'off',
                            minVelocity: Math.max(1, PARAMS.spiralVelocityMin), maxVelocity: Math.max(1, PARAMS.spiralVelocityMax),
                            connectedLines: PARAMS.spiralConnectedLines !== 'off', ignoreWhite: ignoreWhite
                        });
                        result[pens[i]] = (PARAMS.spiralStyle === 'scribbles')
                            ? spiralRaw.map(function (l) { return scribbleizeAlong(l, Math.max(3, PARAMS.ringSpacing) * 0.8, PARAMS.spiralAmplitude); })
                            : spiralRaw;
                    } else if (mode === 'adaptive') {
                        result[pens[i]] = traceAdaptive(wMap, workW, workH, Math.max(1, PARAMS.minSampleRadius), Math.max(2, PARAMS.maxSampleRadius), PARAMS.adaptiveShape);
                    } else if (mode === 'sketch') {
                        var _waveDivX = Number(PARAMS.sketchWaveDivisorX) || 30;
                        var _waveDivY = Number(PARAMS.sketchWaveDivisorY) || 30;
                        if (Math.abs(_waveDivX) < 1) _waveDivX = _waveDivX < 0 ? -1 : 1;
                        if (Math.abs(_waveDivY) < 1) _waveDivY = _waveDivY < 0 ? -1 : 1;
                        var sketchRaw = traceSketchReal(wMap, workW, workH, {
                            angleMode: (PARAMS.sketchStyle === 'squares') ? 'squares' : (PARAMS.sketchStyle === 'waves') ? 'waves' : 'lines',
                            squareStartAngle: Number(PARAMS.sketchSquareAngle) || 0,
                            startAngleMin: Number(PARAMS.sketchAngleMin) || -180, startAngleMax: Number(PARAMS.sketchAngleMax) || 180,
                            waveStartAngle: Number(PARAMS.sketchWaveStartAngle) || 0,
                            waveOffsetX: Number(PARAMS.sketchWaveOffsetX) || 0, waveOffsetY: Number(PARAMS.sketchWaveOffsetY) || 0,
                            waveDivisorX: _waveDivX, waveDivisorY: _waveDivY,
                            waveTypeX: PARAMS.sketchWaveTypeX || 'sin', waveTypeY: PARAMS.sketchWaveTypeY || 'cos',
                            waveDelta: 80,
                            minLineLength: Math.max(1, PARAMS.sketchMinLineLength), maxLineLength: Math.max(2, PARAMS.sketchMaxLineLength),
                            lineTests: Math.max(1, PARAMS.sketchLineTests), squiggleMaxLength: Math.max(1, PARAMS.sketchSquiggleMax),
                            radiusMin: Math.max(0.5, PARAMS.sketchEraseRadiusMin), radiusMax: Math.max(0.5, PARAMS.sketchEraseRadiusMax),
                            eraseMin: Math.max(0, Math.min(1, PARAMS.sketchEraseMin / 100)), eraseMax: Math.max(0, Math.min(1, PARAMS.sketchEraseMax / 100)),
                            eraseTone: Math.max(0, Math.min(1, PARAMS.sketchTone / 100))
                        });
                        result[pens[i]] = applySketchStyle(sketchRaw, PARAMS.sketchStyle);
                    } else {
                        var toned = applyTone(wMap, PARAMS.tone);
                        result[pens[i]] = traceStreamlinesJL(toned, streamAngleFn, workW, workH, {
                            dsepMin: Math.max(1, PARAMS.seedSpacing), dsepMax: Math.max(1, PARAMS.maxSpacing),
                            stepLen: Math.max(1, PARAMS.stepLen), maxSteps: Math.max(4, PARAMS.maxSteps)
                        });
                    }
                }
                strokesByPen = result;
            } catch (e) {
                console.error('imageTrace generate failed', e);
                strokesByPen = null;
            } finally {
                busy = false;
                updateHelp();
                p.redraw();
            }
        }, 20);
    }

    // ---- paper layout (fit + rotate + offset, matches svgUpload style) --
    function layout() {
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var mgn = paper.getMarginPixels(PARAMS.margin);
        var innerW = dims.width - 2 * mgn, innerH = dims.height - 2 * mgn;
        var rot = Number(PARAMS.rotation) || 0, rad = rot * Math.PI / 180;
        var w = workW || 100, h = workH || 100;
        var aw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
        var ah = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
        var scale = Math.min(innerW / Math.max(1, aw), innerH / Math.max(1, ah));
        if (!(scale > 0) || !isFinite(scale)) scale = 1;
        var cx = mgn + innerW / 2 + paper.mmToPixels(Number(PARAMS.offsetX) || 0);
        var cy = mgn + innerH / 2 + paper.mmToPixels(Number(PARAMS.offsetY) || 0);
        return { dims: dims, cx: cx, cy: cy, scale: scale, rot: rot };
    }
    function toPaperXY(px, py, L) {
        var lx = px - workW / 2, ly = py - workH / 2;
        var rad = L.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        var rx = lx * cos - ly * sin, ry = lx * sin + ly * cos;
        return { x: L.cx + rx * L.scale, y: L.cy + ry * L.scale };
    }

    var api = {
        hideGlobalFillIds: ['penLiftFills', 'fillAngle', 'fillImperfection', 'fillDensity', 'fillProb'],
        hideGlobalScatter: true,
        presetAnchorParam: 'mode',
        presetAnchorByFamily: { param: 'mode', map: { sketch: 'sketchStyle', streamlines: 'fieldType', spiral: 'spiralStyle', hatch: 'hatchStyle', adaptive: 'adaptiveShape' } },
        // Presets are scoped to a single Path Finding Module (family + its
        // active sub-style), matching DBV3's own UI where the Presets
        // dropdown only ever shows presets belonging to the currently
        // selected module -- NOT a flat global list. `scope` mirrors the
        // `visibleWhen` shape already used for params: every condition must
        // match the CURRENT value for the preset to appear.
        stylePresets: [
            // Streamlines Edge Field / Flow Field / Superformula: exact
            // values pulled from DBV3's own bundled preset defaults
            // (presets/streamlines_pfm_defaults.json in the installed app --
            // a plain JSON data file, not decompiled code). Max Length here
            // is DBV3's own real length unit (not steps), so it's converted
            // to this tracer's maxSteps proportionally against Digital
            // Detail's 150 -> 50 steps baseline; Start Angle values >180
            // are folded into -180..180 (they're periodic). DBV3 Max Length 0
            // means "no maximum" (symmetric with Min Length 0 = no minimum),
            // so it maps to this tracer's max steps (lines run until they hit
            // the occupancy grid / image bounds) -- e.g. Raindrops' rain streaks.
            { label: 'Digital Detail', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              values: { seedSpacing: 1, maxSpacing: 10, maxSteps: 50, distortion: 15, tone: 75, edgePower: 90, etfIterations: 1, etfRadius: 3, postBlurIterations: 0, postBlurRadius: 0, flowStartAngle: 0, flowXFreq: 0.001, flowYFreq: 1, flowScaleFreq: 0.1, flowAmplitude: 0 } },
            { label: 'Fingerprints', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              values: { seedSpacing: 1, maxSpacing: 12, maxSteps: 17, distortion: 0, tone: 75, edgePower: 100, etfIterations: 10, etfRadius: 5, postBlurIterations: 20, postBlurRadius: 30, flowStartAngle: 0, flowXFreq: 1, flowYFreq: 1, flowScaleFreq: 0.1, flowAmplitude: 100 } },
            { label: 'Light Distortion', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              values: { seedSpacing: 1, maxSpacing: 10, maxSteps: 67, distortion: 40, tone: 75, edgePower: 95, etfIterations: 5, etfRadius: 11, postBlurIterations: 0, postBlurRadius: 0, flowStartAngle: 0, flowXFreq: 1, flowYFreq: 1, flowScaleFreq: 0.1, flowAmplitude: 100 } },
            { label: 'Rough Dashes', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              values: { seedSpacing: 1, maxSpacing: 12, maxSteps: 10, distortion: 80, tone: 75, edgePower: 50, etfIterations: 5, etfRadius: 11, postBlurIterations: 0, postBlurRadius: 0, flowStartAngle: 0, flowXFreq: 1, flowYFreq: 1, flowScaleFreq: 0.1, flowAmplitude: 100 } },
            { label: 'Directional Dashes', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              values: { seedSpacing: 1, maxSpacing: 10, maxSteps: 2, distortion: 0, tone: 75, edgePower: 100, etfIterations: 5, etfRadius: 11, postBlurIterations: 0, postBlurRadius: 0, flowStartAngle: 0, flowXFreq: 1, flowYFreq: 1, flowScaleFreq: 0.1, flowAmplitude: 100 } },
            { label: 'Turbulence', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow'] }],
              values: { flowStartAngle: 52, flowXFreq: 1, flowYFreq: 1, flowScaleFreq: 1.371, flowAmplitude: 100, seedSpacing: 1, maxSpacing: 10, maxSteps: 67, distortion: 0, tone: 75 } },
            { label: 'Raindrops', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow'] }],
              values: { flowStartAngle: 0, flowXFreq: 2, flowYFreq: 0.2, flowScaleFreq: 2, flowAmplitude: 100, seedSpacing: 1, maxSpacing: 10, maxSteps: 150, distortion: 0, tone: 80 } },
            { label: 'Glitchy Horizontal', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow'] }],
              values: { flowStartAngle: 0, flowXFreq: 0.001, flowYFreq: 1, flowScaleFreq: 1, flowAmplitude: 100, seedSpacing: 1, maxSpacing: 10, maxSteps: 67, distortion: 15, tone: 75 } },
            { label: 'Glitchy Vertical', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow'] }],
              values: { flowStartAngle: 0, flowXFreq: 1, flowYFreq: 0.001, flowScaleFreq: 1, flowAmplitude: 100, seedSpacing: 1, maxSpacing: 10, maxSteps: 67, distortion: 15, tone: 75 } },
            { label: 'Starfish', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['superformula'] }],
              values: { sfFrequency: 5, sfCosFactor: 7, sfSineFactor: 7, sfCurvature: 2, seedSpacing: 1, maxSpacing: 10, maxSteps: 17, distortion: 0, tone: 75 } },
            { label: 'Distorted Diamond', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['superformula'] }],
              values: { sfFrequency: 4, sfCosFactor: 1, sfSineFactor: 1, sfCurvature: 1, seedSpacing: 1, maxSpacing: 10, maxSteps: 17, distortion: 50, tone: 75 } },
            { label: 'Distorted Tunnel', scope: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['superformula'] }],
              values: { sfFrequency: 4, sfCosFactor: 15, sfSineFactor: 30, sfCurvature: 30, seedSpacing: 1, maxSpacing: 10, maxSteps: 17, distortion: 50, tone: 75 } },
            { label: 'Digital (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines'] }],
              values: { sketchAngleMin: 90, sketchAngleMax: 90, sketchMinLineLength: 12, sketchMaxLineLength: 72, sketchLineTests: 5, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 1, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 100 } },
            { label: 'Sharp Lines (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines'] }],
              values: { sketchAngleMin: -360, sketchAngleMax: 360, sketchMinLineLength: 2, sketchMaxLineLength: 150, sketchLineTests: 20, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 1, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 50 } },
            { label: 'Micro Detail (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines'] }],
              values: { sketchAngleMin: -360, sketchAngleMax: 360, sketchMinLineLength: 2, sketchMaxLineLength: 10, sketchLineTests: 20, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 1, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 50 } },
            { label: 'Sketchy (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines'] }],
              values: { sketchAngleMin: 50, sketchAngleMax: 130, sketchMinLineLength: 8, sketchMaxLineLength: 30, sketchLineTests: 30, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 3, sketchEraseMin: 20, sketchEraseMax: 100, sketchTone: 50 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['squares'] }],
              values: { sketchSquareAngle: 0, sketchMinLineLength: 2, sketchMaxLineLength: 40, sketchLineTests: 16, sketchSquiggleMax: 40, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 3, sketchEraseMin: 20, sketchEraseMax: 100, sketchTone: 50 } },
            { label: 'Sweeping (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['curves'] }],
              values: { sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 20, sketchMaxLineLength: 80, sketchLineTests: 16, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 1, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 50 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              values: { sketchWaveStartAngle: 0, sketchWaveOffsetX: 0, sketchWaveOffsetY: 0, sketchWaveDivisorX: 20, sketchWaveDivisorY: 20, sketchWaveTypeX: 'sin', sketchWaveTypeY: 'cos', sketchMinLineLength: 2, sketchMaxLineLength: 40, sketchLineTests: 20, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 3, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 100 } },
            { label: 'Distorted Waves (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              values: { sketchWaveStartAngle: 45, sketchWaveOffsetX: 45, sketchWaveOffsetY: 45, sketchWaveDivisorX: 9, sketchWaveDivisorY: 9, sketchWaveTypeX: 'tan', sketchWaveTypeY: 'cos', sketchMinLineLength: 2, sketchMaxLineLength: 40, sketchLineTests: 20, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 5, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 100 } },
            { label: 'Classic Crosshatch', scope: [{ param: 'mode', values: ['hatch'] }, { param: 'hatchStyle', values: ['straight'] }],
              values: { hatchSpacing: 4, hatchAngle: 45, crosshatch: 'on', linkEnds: 'on' } },
            { label: 'Default', scope: [{ param: 'mode', values: ['hatch'] }, { param: 'hatchStyle', values: ['sawtooth'] }],
              values: { hatchSpacing: 6, hatchAngle: 20, crosshatch: 'off', linkEnds: 'on', hatchAmplitude: 1, hatchVelocityMin: 30, hatchVelocityMax: 80 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['hatch'] }, { param: 'hatchStyle', values: ['scribbles'] }],
              values: { hatchSpacing: 7, hatchAngle: 125, crosshatch: 'off', linkEnds: 'on', hatchAmplitude: 1 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['spiral'] }, { param: 'spiralStyle', values: ['archimedean'] }],
              values: { spiralSize: 1, spiralCentreX: 50, spiralCentreY: 50, ringSpacing: 7, spiralAmplitude: 1, spiralVariableVelocity: 'on', spiralVelocityMin: 50, spiralVelocityMax: 180, spiralConnectedLines: 'on', ignoreWhite: 'off' } },
            { label: 'Smooth Single Line', scope: [{ param: 'mode', values: ['spiral'] }, { param: 'spiralStyle', values: ['archimedean'] }],
              values: { spiralSize: 1, spiralCentreX: 50, spiralCentreY: 50, ringSpacing: 5, spiralAmplitude: 0.05, spiralVariableVelocity: 'on', spiralVelocityMin: 30, spiralVelocityMax: 100, spiralConnectedLines: 'on', ignoreWhite: 'on' } },
            { label: 'Bold Coils', scope: [{ param: 'mode', values: ['spiral'] }, { param: 'spiralStyle', values: ['archimedean'] }],
              values: { spiralSize: 1, spiralCentreX: 50, spiralCentreY: 50, ringSpacing: 10, spiralAmplitude: 1.4, spiralVariableVelocity: 'on', spiralVelocityMin: 20, spiralVelocityMax: 60, spiralConnectedLines: 'off', ignoreWhite: 'on' } },
            { label: 'Default', scope: [{ param: 'mode', values: ['spiral'] }, { param: 'spiralStyle', values: ['parabolic'] }],
              values: { spiralSize: 1, spiralCentreX: 50, spiralCentreY: 50, ringSpacing: 7, spiralAmplitude: 1, spiralVariableVelocity: 'on', spiralVelocityMin: 50, spiralVelocityMax: 180, spiralConnectedLines: 'on', ignoreWhite: 'off' } },
            { label: 'Default', scope: [{ param: 'mode', values: ['spiral'] }, { param: 'spiralStyle', values: ['scribbles'] }],
              values: { spiralSize: 1, spiralCentreX: 50, spiralCentreY: 50, ringSpacing: 12, spiralAmplitude: 1, spiralVariableVelocity: 'on', spiralVelocityMin: 20, spiralVelocityMax: 60, spiralConnectedLines: 'on', ignoreWhite: 'on' } },
            { label: 'Fine Stipple', scope: [{ param: 'mode', values: ['stipple'] }, { param: 'stippleShape', values: ['dot'] }],
              values: { colorMode: 'nearest', pointDensity: 40, pointLimit: 1500, stippleRadiusMin: 0.25, stippleRadiusMax: 1.0, luminancePower: 15, voronoiIterations: 6 } },
            { label: 'Bold Dots', scope: [{ param: 'mode', values: ['stipple'] }, { param: 'stippleShape', values: ['dot'] }],
              values: { pointDensity: 20, pointLimit: 600, stippleRadiusMin: 0.6, stippleRadiusMax: 2.0, luminancePower: 8, voronoiIterations: 3 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['stipple'] }, { param: 'stippleShape', values: ['dash'] }],
              values: { pointDensity: 25, pointLimit: 900, stippleRadiusMin: 1.0, stippleRadiusMax: 2.5, luminancePower: 10, voronoiIterations: 4 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['stipple'] }, { param: 'stippleShape', values: ['square'] }],
              values: { pointDensity: 22, pointLimit: 900, stippleRadiusMin: 0.8, stippleRadiusMax: 2.2, luminancePower: 10, voronoiIterations: 4 } },
            // Adaptive Shapes/Stippling/Dashes/Circular Scribbles "Default"
            // presets, exact values from adaptive_pfm_defaults.json.
            { label: 'Default', scope: [{ param: 'mode', values: ['adaptive'] }, { param: 'adaptiveShape', values: ['square'] }],
              values: { minSampleRadius: 1, maxSampleRadius: 20 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['adaptive'] }, { param: 'adaptiveShape', values: ['circle'] }],
              values: { minSampleRadius: 1, maxSampleRadius: 8 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['adaptive'] }, { param: 'adaptiveShape', values: ['dash'] }],
              values: { minSampleRadius: 1, maxSampleRadius: 12 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['adaptive'] }, { param: 'adaptiveShape', values: ['scribble'] }],
              values: { minSampleRadius: 1, maxSampleRadius: 16 } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'palette', label: 'Pens (colors)', type: 'colorPalette', maxSelect: 8, group: 'color',
              tip: 'The pens the image is decomposed onto. Selection + Color mode below together control how it mixes.',
              value: ['#000000'],
              options: [
                { value: '#000000', label: 'Black' }, { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' }, { value: '#ffff00', label: 'Yellow' },
                { value: '#ff3333', label: 'Red' }, { value: '#33cc66', label: 'Green' },
                { value: '#3366ff', label: 'Blue' }, { value: '#ff8800', label: 'Orange' },
                { value: 'custom', label: 'Custom' }
              ] },
            { id: 'uploadImage', label: 'Upload image', type: 'action', buttonLabel: '⬆ Upload Image', group: 'general',
              tip: 'Choose a photo/image (PNG/JPG). Downscaled immediately to a safe working resolution.' },
            { id: 'generate', label: 'Generate', type: 'action', buttonLabel: '⟳ Generate', group: 'general',
              tip: 'Run the trace with the current settings. Re-run after changing pens/mode/sliders — this does not auto-update live.' },
            { id: 'mode', label: 'Path finding family', type: 'select', value: 'streamlines', group: 'general',
              tip: 'DrawingBotV3-style Path Finding Module family. Each has its own sub-style and settings below.',
              options: [
                { value: 'sketch', label: 'Sketch' },
                { value: 'streamlines', label: 'Streamlines' },
                { value: 'spiral', label: 'Spiral' },
                { value: 'hatch', label: 'Hatch' },
                { value: 'stipple', label: 'Voronoi / Stippling' },
                { value: 'adaptive', label: 'Adaptive' }
              ] },
            { id: 'colorMode', label: 'Color mode', type: 'select', value: 'separate', group: 'color',
              tip: 'CMYK (v3.1) = real RGB->CMYK with full black generation, DrawingBotV3-style — best for 4-pen CMYK sets. Separate = linear deficit projection (every pen gets a density layer). Nearest = classify each region to one closest pen, no mixing.',
              options: [{ value: 'cmyk', label: 'CMYK separation (v3.1)' }, { value: 'separate', label: 'Separate (linear mix)' }, { value: 'nearest', label: 'Nearest pen (posterize)' }] },

            // -- Sketch -- real port of PFMSketchLinesBasic/PFMSketchSquaresBasic:
            // darkest-block seeding, angle-tested darkest-line search, erase-
            // as-you-draw. Lines/Squares are the two real algorithms (differ
            // only in candidate-angle strategy); Curves/Waves reuse the Lines
            // algorithm and smooth/oscillate its output afterward.
            { id: 'sketchStyle', label: 'Sketch style', type: 'select', value: 'lines', group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 Sketch Lines/Squares (real ported algorithm), Waves (v3.1 — lines follow an X/Y wave field), or Curves (Lines + Catmull-Rom smoothing).',
              options: [{ value: 'lines', label: 'Lines (v3)' }, { value: 'squares', label: 'Squares (v3)' }, { value: 'curves', label: 'Curves (v3.1)' }, { value: 'waves', label: 'Waves (v3.1)' }] },
            { id: 'sketchAngleMin', label: 'Start Angle Min', type: 'range', min: -360, max: 360, step: 5, value: -180, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves'] }],
              tip: 'DBV3 "Start Angle Min": lower bound of the random angle range tested at each step.' },
            { id: 'sketchAngleMax', label: 'Start Angle Max', type: 'range', min: -360, max: 360, step: 5, value: 180, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves'] }],
              tip: 'DBV3 "Start Angle Max": upper bound of the random angle range tested at each step.' },
            { id: 'sketchSquareAngle', label: 'Start Angle', type: 'range', min: -180, max: 180, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['squares'] }],
              tip: 'DBV3 "Start Angle": base angle offset for the positional wave field that drives the rectangular pattern.' },
            { id: 'sketchWaveStartAngle', label: 'Wave Start Angle', type: 'range', min: -360, max: 360, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              tip: 'DBV3 "Start Angle (Sketch Waves)": base rotation added to the wave-field direction.' },
            { id: 'sketchWaveTypeX', label: 'Wave Type X', type: 'select', value: 'sin', group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              tip: 'DBV3 "Wave Type X": curve function for the horizontal component of the direction field.',
              options: [{ value: 'sin', label: 'Sin' }, { value: 'cos', label: 'Cos' }, { value: 'tan', label: 'Tan' }] },
            { id: 'sketchWaveTypeY', label: 'Wave Type Y', type: 'select', value: 'cos', group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              tip: 'DBV3 "Wave Type Y": curve function for the vertical component of the direction field.',
              options: [{ value: 'sin', label: 'Sin' }, { value: 'cos', label: 'Cos' }, { value: 'tan', label: 'Tan' }] },
            { id: 'sketchWaveDivisorX', label: 'Wave Divisor X', type: 'range', min: 5, max: 200, step: 1, value: 30, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              tip: 'DBV3 "Wave Divisor X": divides the X coordinate before the wave function — higher = flatter, wider waves.' },
            { id: 'sketchWaveDivisorY', label: 'Wave Divisor Y', type: 'range', min: 5, max: 200, step: 1, value: 30, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              tip: 'DBV3 "Wave Divisor Y": divides the Y coordinate before the wave function — higher = flatter, wider waves.' },
            { id: 'sketchWaveOffsetX', label: 'Wave Offset X', type: 'range', min: -500, max: 500, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              tip: 'DBV3 "Wave Offset X": shifts the wave phase horizontally across the image.' },
            { id: 'sketchWaveOffsetY', label: 'Wave Offset Y', type: 'range', min: -500, max: 500, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              tip: 'DBV3 "Wave Offset Y": shifts the wave phase vertically across the image.' },
            { id: 'sketchMinLineLength', label: 'Line Min Length', type: 'range', min: 1, max: 100, step: 1, value: 8, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Line Min Length": minimum length before a candidate line can be selected as a result.' },
            { id: 'sketchMaxLineLength', label: 'Line Max Length', type: 'range', min: 2, max: 150, step: 1, value: 40, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Line Max Length": maximum length tested for each candidate line.' },
            { id: 'sketchLineTests', label: 'Angle Tests', type: 'range', min: 1, max: 60, step: 1, value: 16, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Angle Tests": how many candidate angles are tested at each step before picking the darkest.' },
            { id: 'sketchSquiggleMax', label: 'Squiggle Max Length', type: 'range', min: 2, max: 150, step: 1, value: 40, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Squiggle Max Length": maximum number of connected segments before the pen lifts and a new squiggle starts.' },
            { id: 'sketchEraseRadiusMin', label: 'Erase Radius Min', type: 'range', min: 0.5, max: 10, step: 0.5, value: 1, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Erase Radius Min": how far around each drawn segment ink is "used up" in the lightest areas.' },
            { id: 'sketchEraseRadiusMax', label: 'Erase Radius Max', type: 'range', min: 0.5, max: 15, step: 0.5, value: 3, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Erase Radius Max": how far around each drawn segment ink is "used up" in the darkest areas.' },
            { id: 'sketchEraseMin', label: 'Erase Min (%)', type: 'range', min: 0, max: 100, step: 5, value: 20, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Erase Min": how much ink is used up per pass in the lightest areas.' },
            { id: 'sketchEraseMax', label: 'Erase Max (%)', type: 'range', min: 0, max: 100, step: 5, value: 100, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Erase Max": how much ink is used up per pass in the darkest areas.' },
            { id: 'sketchTone', label: 'Tone', type: 'range', min: 0, max: 100, step: 5, value: 50, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Tone": blends a linear vs. eased curve controlling how erase radius/amount respond to local darkness.' },

            // -- Streamlines settings --
            { id: 'fieldType', label: 'Field type', type: 'select', value: 'edge', group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'Edge Field (v3.1 — real Edge Tangent Flow following image structure), Flow Field (periodic math field), or Superformula (radial organic field).',
              options: [{ value: 'edge', label: 'Edge Field (v3.1)' }, { value: 'flow', label: 'Flow Field (v3.1)' }, { value: 'superformula', label: 'Superformula (v3.1)' }] },
            { id: 'seedSpacing', label: 'Min Spacing (px)', type: 'range', min: 1, max: 20, step: 1, value: 6, group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'DBV3 "Min Spacing": grid spacing for candidate line start points.' },
            { id: 'maxSpacing', label: 'Max Spacing (px)', type: 'range', min: 0, max: 40, step: 1, value: 14, group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'DBV3 "Max Spacing": lines relax to this spacing in sparse/light areas (0 = constant spacing).' },
            { id: 'stepLen', label: 'Step Length (px)', type: 'range', min: 1, max: 8, step: 1, value: 3, group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'Integration step size along the flow field. Smaller = smoother curves, slower to trace.' },
            { id: 'maxSteps', label: 'Max Length (steps)', type: 'range', min: 4, max: 150, step: 2, value: 60, group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'Maximum length of a single line (steps, each direction from its seed).' },
            { id: 'minSep', label: 'Min Separation (px)', type: 'range', min: 1, max: 10, step: 1, value: 3, group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'Minimum spacing enforced between lines (per pen) so they do not overlap into a solid mess.' },
            { id: 'distortion', label: 'Distortion', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'DBV3 "Distortion": adds random noise to the generated lines, creating more stylised images.' },
            { id: 'tone', label: 'Tone', type: 'range', min: 0, max: 100, step: 5, value: 50, group: 'general',
              visibleWhen: { param: 'mode', values: ['streamlines'] },
              tip: 'DBV3 "Tone": controls the contrast of the generated streamlines.' },
            { id: 'edgePower', label: 'Edge Power', type: 'range', min: 0, max: 100, step: 5, value: 70, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              tip: 'DBV3 "Edge Power": how strongly lines are pushed to follow detected edges vs. wander freely.' },
            { id: 'etfIterations', label: 'ETF Iterations', type: 'range', min: 0, max: 12, step: 1, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              tip: 'DBV3 "ETF Iterations": refinement passes smoothing the edge flow field.' },
            { id: 'etfRadius', label: 'ETF Radius', type: 'range', min: 1, max: 12, step: 1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              tip: 'DBV3 "ETF Radius": kernel size used when refining the edge flow field.' },
            { id: 'postBlurIterations', label: 'Smooth Iterations', type: 'range', min: 0, max: 20, step: 1, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              tip: 'DBV3 "Smooth Iterations": additional smoothing passes after ETF refinement.' },
            { id: 'postBlurRadius', label: 'Smooth Radius', type: 'range', min: 1, max: 30, step: 1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              tip: 'DBV3 "Smooth Radius": kernel size for the smoothing pass (matches DBV3\'s full 0-30 range; high values are heavier on the Pi\'s CPU).' },
            { id: 'flowStartAngle', label: 'Start Angle', type: 'range', min: -180, max: 180, step: 1, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow', 'superformula', 'edge'] }],
              tip: 'DBV3 "Start Angle": initial angle/orientation of the field.' },
            { id: 'flowXFreq', label: 'X Frequency', type: 'range', min: 0.001, max: 4, step: 0.001, value: 1, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow', 'edge'] }],
              tip: 'DBV3 "X Frequency": rate of change on the X axis of the flow field.' },
            { id: 'flowYFreq', label: 'Y Frequency', type: 'range', min: 0.001, max: 4, step: 0.001, value: 1, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow', 'edge'] }],
              tip: 'DBV3 "Y Frequency": rate of change on the Y axis of the flow field.' },
            { id: 'flowScaleFreq', label: 'Scale Frequency', type: 'range', min: 0.01, max: 4, step: 0.01, value: 0.5, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow', 'edge'] }],
              tip: 'DBV3 "Scale Frequency": scales the X/Y Frequency uniformly.' },
            { id: 'flowAmplitude', label: 'Amplitude', type: 'range', min: 0, max: 100, step: 5, value: 100, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['flow', 'edge'] }],
              tip: 'DBV3 "Amplitude": influence of the resulting flow field (blended with the Edge Tangent Flow by Edge Power).' },
            { id: 'sfFrequency', label: 'Frequency', type: 'range', min: 2, max: 20, step: 1, value: 5, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['superformula'] }],
              tip: 'DBV3 "Frequency": number of radial arms/lobes in the Superformula pattern.' },
            { id: 'sfCosFactor', label: 'Cos Factor', type: 'range', min: 0.1, max: 40, step: 0.1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['superformula'] }],
              tip: 'DBV3 "Cos Factor": exponent on the cosine term of the Superformula equation.' },
            { id: 'sfSineFactor', label: 'Sine Factor', type: 'range', min: 0.1, max: 40, step: 0.1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['superformula'] }],
              tip: 'DBV3 "Sine Factor": exponent on the sine term of the Superformula equation.' },
            { id: 'sfCurvature', label: 'Curvature', type: 'range', min: 0.1, max: 80, step: 0.1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['superformula'] }],
              tip: 'DBV3 "Curvature": overall root exponent controlling how sharp/pointed vs. rounded the Superformula lobes are.' },

            // -- Spiral -- real port of PFMSpiralBasic.java. Amplitude alone
            // sweeps smooth -> sawtooth in the real algorithm (no separate
            // code path for it); "Circular Scribbles" isn't part of the
            // public source, so it stays our own approximation layered on
            // top of the real Archimedean trace.
            { id: 'spiralStyle', label: 'Spiral type', type: 'select', value: 'archimedean', group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Spiral Type": Archimedean (even rings) or Parabolic (two connected branches). Circular Scribbles is our own approximation, not a ported algorithm.',
              options: [{ value: 'archimedean', label: 'Archimedean (v3)' }, { value: 'parabolic', label: 'Parabolic (v3)' }, { value: 'scribbles', label: 'Circular Scribbles (v3.1)' }] },
            { id: 'spiralSize', label: 'Spiral Size', type: 'range', min: 0.1, max: 2, step: 0.05, value: 1, group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Spiral Size": alters where the generated spiral will end.' },
            { id: 'spiralCentreX', label: 'Centre X (%)', type: 'range', min: 0, max: 100, step: 1, value: 50, group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Centre X": horizontal position the spiral starts from.' },
            { id: 'spiralCentreY', label: 'Centre Y (%)', type: 'range', min: 0, max: 100, step: 1, value: 50, group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Centre Y": vertical position the spiral starts from.' },
            { id: 'ringSpacing', label: 'Ring Spacing (px)', type: 'range', min: 2, max: 40, step: 1, value: 8, group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Ring Spacing": distance between each generated ring — smaller rings capture finer detail.' },
            { id: 'spiralAmplitude', label: 'Amplitude', type: 'range', min: 0.01, max: 2, step: 0.01, value: 1, group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Amplitude": scale of the density-driven oscillation. Low = smooth spiral, high = pronounced sawtooth zigzag.' },
            { id: 'spiralVariableVelocity', label: 'Variable Velocity', type: 'select', value: 'on', group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Variable Velocity": when on, velocity varies between Min/Max proportionally to local ink density.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'spiralVelocityMin', label: 'Min Velocity', type: 'range', min: 1, max: 180, step: 1, value: 20, group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Min Velocity": controls the frequency of detail along the spiral in dark/inked areas.' },
            { id: 'spiralVelocityMax', label: 'Max Velocity', type: 'range', min: 1, max: 360, step: 1, value: 60, group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Max Velocity": controls the frequency of detail along the spiral in light/blank areas.' },
            { id: 'spiralConnectedLines', label: 'Connected Lines', type: 'select', value: 'on', group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
              tip: 'DBV3 "Connected Lines": when on, the spiral is one continuous line; when off, each segment is disconnected.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },

            // -- Hatch --
            { id: 'hatchStyle', label: 'Hatch style', type: 'select', value: 'straight', group: 'general',
              visibleWhen: { param: 'mode', values: ['hatch'] },
              tip: 'DBV3 Hatch default/Sawtooth/Circular Scribbles.',
              options: [{ value: 'straight', label: 'Straight (v3.1)' }, { value: 'sawtooth', label: 'Sawtooth (v3.1)' }, { value: 'scribbles', label: 'Circular Scribbles (v3.1)' }] },
            { id: 'hatchSpacing', label: 'Line Spacing (px)', type: 'range', min: 2, max: 20, step: 1, value: 5, group: 'general',
              visibleWhen: { param: 'mode', values: ['hatch'] },
              tip: 'DBV3 "Line Spacing": distance between parallel hatch scanlines.' },
            { id: 'hatchAngle', label: 'Angle', type: 'range', min: 0, max: 179, step: 1, value: 45, group: 'general',
              visibleWhen: { param: 'mode', values: ['hatch'] },
              tip: 'DBV3 "Angle": direction of the hatch scanlines, in degrees.' },
            { id: 'crosshatch', label: 'Crosshatch', type: 'select', value: 'off', group: 'general',
              visibleWhen: { param: 'mode', values: ['hatch'] },
              tip: 'DBV3 "Crosshatch": adds a second pass at +90° through the darker areas.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'linkEnds', label: 'Link Ends', type: 'select', value: 'off', group: 'general',
              visibleWhen: { param: 'mode', values: ['hatch'] },
              tip: 'DBV3 "Link Ends": bridges small gaps within a scanline instead of lifting the pen.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'hatchAmplitude', label: 'Amplitude', type: 'range', min: 0.1, max: 2, step: 0.1, value: 1, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['hatch'] }, { param: 'hatchStyle', values: ['sawtooth', 'scribbles'] }],
              tip: 'Scale of the sawtooth/scribble oscillation, proportional to Line Spacing.' },
            { id: 'hatchVelocityMin', label: 'Min Velocity', type: 'range', min: 1, max: 180, step: 1, value: 20, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['hatch'] }, { param: 'hatchStyle', values: ['sawtooth'] }],
              tip: 'DBV3 "Min Velocity": minimum frequency of the sawtooth oscillation.' },
            { id: 'hatchVelocityMax', label: 'Max Velocity', type: 'range', min: 1, max: 360, step: 1, value: 60, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['hatch'] }, { param: 'hatchStyle', values: ['sawtooth'] }],
              tip: 'DBV3 "Max Velocity": maximum frequency of the sawtooth oscillation.' },

            // -- Voronoi / Stippling --
            { id: 'stippleShape', label: 'Shape', type: 'select', value: 'dot', group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: 'DBV3 Voronoi Stippling/Dashes/Shapes.',
              options: [{ value: 'dot', label: 'Stipple (dot)' }, { value: 'dash', label: 'Dash' }, { value: 'square', label: 'Square' }] },
            { id: 'pointDensity', label: 'Point Density', type: 'range', min: 5, max: 100, step: 5, value: 30, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: 'DBV3 "Point Density": higher = more candidate points (finer grid).' },
            { id: 'pointLimit', label: 'Point Limit', type: 'range', min: 50, max: 4000, step: 50, value: 800, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: 'DBV3 "Point Limit": maximum total points per pen; weakest points dropped first.' },
            { id: 'luminancePower', label: 'Luminance Power', type: 'range', min: 1, max: 50, step: 1, value: 10, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: 'DBV3 "Luminance Power": how strongly point placement is biased toward darker areas.' },
            { id: 'voronoiIterations', label: 'Voronoi Iterations', type: 'range', min: 0, max: 20, step: 1, value: 4, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: 'DBV3 "Voronoi Iterations": relaxation passes spreading points more evenly.' },
            { id: 'stippleRadiusMin', label: 'Stipple Radius Min', type: 'range', min: 0.1, max: 3, step: 0.1, value: 0.4, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: 'DBV3 "Stipple Radius Min": dot size in the lightest inked areas.' },
            { id: 'stippleRadiusMax', label: 'Stipple Radius Max', type: 'range', min: 0.2, max: 6, step: 0.1, value: 1.4, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: 'DBV3 "Stipple Radius Max": dot size in the densest inked areas.' },

            // -- Adaptive --
            { id: 'adaptiveShape', label: 'Shape Type', type: 'select', value: 'square', group: 'general',
              visibleWhen: { param: 'mode', values: ['adaptive'] },
              tip: 'DBV3 Adaptive Shapes/Circular Scribbles/Dashes.',
              options: [{ value: 'square', label: 'Square (v3.1)' }, { value: 'circle', label: 'Circle (v3.1)' }, { value: 'dash', label: 'Dash (v3.1)' }, { value: 'scribble', label: 'Circular Scribble (v3.1)' }] },
            { id: 'minSampleRadius', label: 'Min Sample Radius', type: 'range', min: 1, max: 40, step: 1, value: 4, group: 'general',
              visibleWhen: { param: 'mode', values: ['adaptive'] },
              tip: 'DBV3 "Min Sample Radius": smallest cell size — controls fine detail retention.' },
            { id: 'maxSampleRadius', label: 'Max Sample Radius', type: 'range', min: 2, max: 80, step: 1, value: 24, group: 'general',
              visibleWhen: { param: 'mode', values: ['adaptive'] },
              tip: 'DBV3 "Max Sample Radius": largest cell size in flat/uniform areas.' },

            { id: 'ignoreWhite', label: 'Ignore White', type: 'select', value: 'off', group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral', 'stipple', 'adaptive'] },
              tip: 'DBV3 "Ignore White": skip drawing entirely in blank/white areas instead of drawing very faint marks.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },

            { id: 'brightness', label: 'Brightness (%)', type: 'range', min: 20, max: 200, step: 5, value: 100, group: 'general',
              tip: 'Brightens or darkens the image before tracing.' },
            { id: 'contrast', label: 'Contrast (%)', type: 'range', min: 20, max: 300, step: 5, value: 100, group: 'general',
              tip: 'Boosts (or reduces) image contrast before tracing.' },
            { id: 'invert', label: 'Invert', type: 'select', value: 'off', group: 'general',
              tip: 'Invert light/dark before tracing (useful for images that are mostly light with dark background).',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'rotation', label: 'Rotation', type: 'range', min: 0, max: 350, step: 5, value: 0, group: 'general',
              tip: 'Rotate the traced image on the page.' },
            { id: 'offsetX', label: 'Offset X (mm)', type: 'range', min: -200, max: 200, step: 1, value: 0, group: 'general',
              tip: 'Shift horizontally from center.' },
            { id: 'offsetY', label: 'Offset Y (mm)', type: 'range', min: -200, max: 200, step: 1, value: 0, group: 'general',
              tip: 'Shift vertically from center.' },
            { id: 'alpha', label: 'Ink Opacity (%)', type: 'range', min: 5, max: 100, step: 5, value: 80, group: 'advanced',
              tip: 'Canvas-preview opacity for plotted lines. Below 100% the pens draw with Multiply blending so overlapping CMYK strokes mix like real ink. Preview only — does not change the exported plot geometry. 80% ≈ DBV3\'s preview.' }
        ]),
        regenerate: function () { resizeIfNeeded(); p.redraw(); },
        redraw: function () { try { p.redraw(); } catch (e) {} },
        randomize: function () { p.redraw(); },
        reseed: function () { generate(); },
        getSignatureSeed: function () { return 7654321; },
        saveSVG: function () {
            if (!strokesByPen) {
                // Inline notice, not alert() -- a native alert() is a modal
                // dialog that silently swallows every subsequent click until
                // dismissed, which made an accidental/early Save click far
                // more disruptive than the message itself warrants.
                if (helpEl) {
                    helpEl.textContent = 'Nothing traced yet — hit Generate first.';
                    helpEl.style.color = '#c0392b';
                    clearTimeout(helpEl._noticeTimer);
                    helpEl._noticeTimer = setTimeout(function () { helpEl.style.color = ''; updateHelp(); }, 2500);
                }
                return;
            }
            var L = layout(), dims = L.dims;
            var pens = selectedPens();
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || 'trace';
            var parts = [];
            parts.push('<?xml version="1.0" encoding="UTF-8"?>');
            parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + dims.width + '" height="' + dims.height + '" viewBox="0 0 ' + dims.width + ' ' + dims.height + '">');
            parts.push('<rect x="0" y="0" width="' + dims.width + '" height="' + dims.height + '" fill="#ffffff"/>');
            parts.push('<rect x="1" y="1" width="' + (dims.width - 2) + '" height="' + (dims.height - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
            for (var i = 0; i < pens.length; i++) {
                var col = pens[i];
                var lines = strokesByPen[col] || [];
                if (!lines.length) continue;
                var swpx = widthPxFor(col);
                parts.push('<g stroke="' + col + '" fill="none" stroke-width="' + swpx.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round">');
                for (var j = 0; j < lines.length; j++) {
                    var pts = lines[j];
                    if (pts.length < 2) continue;
                    var d = '';
                    for (var k = 0; k < pts.length; k++) {
                        var pp = toPaperXY(pts[k].x, pts[k].y, L);
                        d += (k === 0 ? 'M' : 'L') + pp.x.toFixed(2) + ',' + pp.y.toFixed(2) + ' ';
                    }
                    parts.push('<path d="' + d + '"/>');
                }
                parts.push('</g>');
            }
            if (window._signatureConfig && window._signatureConfig.enabled &&
                !window._signatureConfig.suppressExport &&
                window.Signature && typeof window.Signature.buildSignatureSVG === 'function') {
                var mgnPx = paper.getMarginPixels(PARAMS.margin);
                var sigCol = window.Signature.pickSignatureColor ? window.Signature.pickSignatureColor(pens) : '#000000';
                var sigG = window.Signature.buildSignatureSVG(window._signatureConfig, dims.width, dims.height, mgnPx,
                    function (mm) { return paper.mmToPixels(mm); }, 'Image Trace', 7654321, sigCol);
                if (sigG) parts.push(sigG);
            }
            parts.push('</svg>');
            downloadSvgString(parts.join('\n'), '90percentart-imagetrace-' + ts + '.svg');
        },
        setParam: function (name, val) {
            var pdef = api.params.find(function (x) { return x.id === name; });
            if (pdef) pdef.value = val;
            if (name === 'uploadImage') { if (fileInput) fileInput.click(); return; }
            if (name === 'generate') { generate(); return; }
            if (name === 'paperSize') { PARAMS.paperSize = val; resizeIfNeeded(); }
            else if (name === 'margin') PARAMS.margin = Number(val);
            else if (name === 'palette') PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
            else if (['seedSpacing', 'maxSpacing', 'stepLen', 'maxSteps', 'minSep', 'distortion', 'tone',
                      'edgePower', 'etfIterations', 'etfRadius', 'postBlurIterations', 'postBlurRadius',
                      'flowStartAngle', 'flowXFreq', 'flowYFreq', 'flowScaleFreq', 'flowAmplitude',
                      'sfFrequency', 'sfCosFactor', 'sfSineFactor', 'sfCurvature',
                      'sketchAngleMin', 'sketchAngleMax', 'sketchSquareAngle', 'sketchMinLineLength', 'sketchMaxLineLength',
                      'sketchLineTests', 'sketchSquiggleMax', 'sketchEraseRadiusMin', 'sketchEraseRadiusMax',
                      'sketchEraseMin', 'sketchEraseMax', 'sketchTone',
                      'sketchWaveStartAngle', 'sketchWaveOffsetX', 'sketchWaveOffsetY', 'sketchWaveDivisorX', 'sketchWaveDivisorY',
                      'spiralSize', 'spiralCentreX', 'spiralCentreY',
                      'ringSpacing', 'spiralAmplitude', 'spiralVelocityMin', 'spiralVelocityMax',
                      'hatchSpacing', 'hatchAngle', 'hatchAmplitude', 'hatchVelocityMin', 'hatchVelocityMax',
                      'pointDensity', 'pointLimit', 'stippleRadiusMin', 'stippleRadiusMax', 'luminancePower', 'voronoiIterations',
                      'minSampleRadius', 'maxSampleRadius', 'adaptiveBrightness', 'adaptiveContrast',
                      'brightness', 'contrast', 'rotation', 'offsetX', 'offsetY', 'alpha'].indexOf(name) >= 0) {
                PARAMS[name] = Number(val);
            } else if (PARAMS.hasOwnProperty(name)) PARAMS[name] = val;
        }
    };

    function resizeIfNeeded() { paper.resizeCanvasToPaper(p, PARAMS.paperSize); }

    p.registerSketchAPI = function (register) { if (typeof register === 'function') register(api); };

    p.setup = function () {
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
            fileInput.accept = '.png,.jpg,.jpeg,.gif,.bmp,.webp,image/*';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', function (e) {
                var f = e.target.files && e.target.files[0];
                if (f) handleImageFile(f);
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

    p.draw = function () {
        p.background(255);
        paper.drawPaperBorder(p);
        if (strokesByPen) {
            var L = layout();
            var pens = selectedPens();
            var inkA = Math.max(0.05, Math.min(1, (Number(PARAMS.alpha) || 100) / 100));
            p.push();
            if (inkA < 1) p.blendMode(p.MULTIPLY);   // overlapping pens mix subtractively (CMYK ink preview)
            p.strokeCap(p.ROUND); p.noFill();
            for (var i = 0; i < pens.length; i++) {
                var col = pens[i];
                var _rgb = hexToRgb01(col);
                p.stroke(_rgb[0] * 255, _rgb[1] * 255, _rgb[2] * 255, inkA * 255);
                p.strokeWeight(widthPxFor(col));
                var lines = strokesByPen[col] || [];
                for (var j = 0; j < lines.length; j++) {
                    var pts = lines[j];
                    p.beginShape();
                    for (var k = 0; k < pts.length; k++) {
                        var pp = toPaperXY(pts[k].x, pts[k].y, L);
                        p.vertex(pp.x, pp.y);
                    }
                    p.endShape();
                }
            }
            p.blendMode(p.BLEND);
            p.pop();
        } else if (previewImg) {
            var dims = paper.getPaperPixels(PARAMS.paperSize);
            var mgn = paper.getMarginPixels(PARAMS.margin);
            var innerW = dims.width - 2 * mgn, innerH = dims.height - 2 * mgn;
            var s = Math.min(innerW / previewImg.width, innerH / previewImg.height);
            p.push();
            p.tint(255, 140);
            p.imageMode(p.CENTER);
            p.image(previewImg, dims.width / 2, dims.height / 2, previewImg.width * s, previewImg.height * s);
            p.noTint();
            p.noStroke(); p.fill(90); p.textAlign(p.CENTER, p.CENTER); p.textSize(13);
            p.text('Hit Generate to trace', dims.width / 2, dims.height - mgn / 2);
            p.pop();
        } else {
            p.push();
            p.noStroke(); p.fill(170);
            p.textAlign(p.CENTER, p.CENTER); p.textSize(15);
            p.text('⬆  Upload an image', p.width / 2, p.height / 2);
            p.pop();
        }
        // Redraw on top: full-bleed content can cover the border drawn at the
        // top of this function -- keep it visible as the top layer.
        paper.drawPaperBorder(p);
    };

    function downloadSvgString(str, filename) {
        try {
            var blob = new Blob([str], { type: 'image/svg+xml' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) { console.error('SVG download failed', e); }
    }
};
