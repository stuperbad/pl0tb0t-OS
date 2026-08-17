// imageTrace.js — pl0tb0t-OS: raster image -> plottable line art.
// Upload a photo/image, decompose it onto your selected pens (either a true
// CMYK-style mix of continuous per-ink density layers, or DrawingBotV3
// "Color Match"-style nearest-pen classification), then trace each ink's
// density map using one of eight DrawingBotV3-inspired Path Finding Module
// families: Sketch, Streamlines, Spiral, Hatch, Voronoi (Stippling),
// Adaptive, LBG, and Grid.
//
// PROVENANCE / confidence labelling (audited against real DBV3 source: the
// user's decompiled Premium jar, C:\Users\evanf\decompile\DrawingBotV3\src
// \drawingbot -- 1084 files, full Premium package including the point-
// sampler/encoder combinator architecture -- AND the public GPL "Basic"
// edition repo, github.com/SonarSonic/DrawingBotV3, cloned and read directly.
// Every mode/style/preset label below is tagged with one of three tiers --
//   (v3)     Verified against REAL, accessible DBV3 source and matches it
//            closely (function-for-function, not just "similar"). Covers:
//            Sketch Lines/Squares, the base Spiral engine, Voronoi Stippling
//            (drawingbot.k.e.c.a.p sampler), Grid (drawingbot.k.e.c.a.g,
//            verbatim), and the shared Shapes/Triangulation/Tree/Stippling/
//            Dashes/Diagram render encoders (drawingbot.k.e.c.b.*) used by
//            Voronoi/Adaptive/LBG/Grid alike.
//   (v3.1)   No accessible implementation exists, but the setting names/
//            ranges/behaviour are taken from DBV3's own real documentation
//            or bundled preset-default JSON, OR the code is an independent
//            implementation of the exact real, named external algorithm
//            DBV3's own docs/source cite for that PFM (e.g. Linde-Buzo-Gray
//            1980 for LBG's split/merge sampler, or a standard nearest-
//            neighbour+2-opt solver for TSP in place of DBV3's own
//            SuperPixel-based tour construction). Adapted/rebuilt from
//            something real and verifiable -- not copied, but not guessed.
//            Adaptive's point sampler is v3.1 for a different reason: its
//            real disk-packing engine (drawingbot.k.e.b.a, "AIS") did NOT
//            survive decompilation -- a Windows case-insensitive-filesystem
//            collision clobbered it with an unrelated same-named class, so
//            only 339 bytes of garbage came out where the real algorithm
//            should be. That sampler here is an honest from-scratch
//            Poisson-disc packer instead of a claimed port.
//   (approx) No real DBV3 source, doc, or cited spec was matched -- an
//            original approximation invented to produce a similar-feeling
//            result under that family's name. Treat as a placeholder style,
//            not a port.
// Streamlines and Hatch remain Premium-only with no accessible source (the
// free edition's PremiumPluginDummy.java registers their real PFMs as empty
// no-op stubs) -- those two families are still (v3.1)/(approx) by necessity.
// Deliberately NOT implemented at all: Composite/Mosaic PFMs, ECS Drawing,
// the Letters render style (real AWT/Batik font-glyph outline rendering --
// a substantial standalone feature requiring real vector font data), and
// Circular Scribbles (DBV3's real organic curve engine with velocity/
// acceleration vectors and tone mapping -- also a substantial standalone
// feature, not something to fake under the real name).
//
// Architecture: PARAMS.mode selects a family; each family has its own
// traceXxx() function operating on a per-ink density weight map, fed by the
// shared pipeline (load -> downscale -> ink decomposition -> per-ink trace ->
// paper layout -> export). Sub-style pickers (e.g. sketchStyle, fieldType,
// pointEncoder) reuse a family's core tracer and post-process the resulting
// polylines. Voronoi/Adaptive/LBG/Grid mirror real DBV3's own combinator
// architecture (drawingbot.k.e.c.c): a per-family point sampler paired with
// one shared set of render encoders selected by pointEncoder -- see the
// "Voronoi / Adaptive / LBG / Grid: shared real-geometry engine" comment
// further down for the full per-function breakdown.
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
        pointEncoder: 'shapes',   // shared Voronoi/Adaptive/LBG/Grid render encoder (real DBV3 Shapes/Triangulation/Tree/Stippling/Dashes/Diagram/TSP -- drawingbot.k.e.c.b.*)

        seedSpacing: 6,      // "Min Spacing"
        maxSpacing: 14,      // "Max Spacing"
        stepLen: 3,
        maxSteps: 60,        // "Max Length" (steps)
        minSep: 3,
        distortion: 0,
        tone: 50,

        edgePower: 70,
        etfIterations: 0,
        etfRadius: 3,
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
        // DBV3 "Style" settings shared by every Sketch PFM (ported from the
        // real drawingbot.k.e.d.a / drawingbot.k.e.b.p engine). Only Lines
        // and Curves route through the full weighted scorer in real DBV3 --
        // Squares uses a simpler single-candidate test and Waves tests
        // exactly 2 fixed directions, so these intentionally have no effect
        // on those two styles (matches the real engine, not a bug).
        sketchDirectionality: 0,   // DBV3 "Directionality" -- weights local contrast/variance, NOT literal direction-following
        sketchDistortion: 0,       // DBV3 "Distortion" -- weights injected random noise per candidate
        sketchAngularity: 0,       // DBV3 "Angularity" -- penalizes sharp turns from the previous segment
        sketchEdgePower: 0,        // DBV3 "Edge Power" -- weights a precomputed edge-strength map
        sketchSobelPower: 0,       // DBV3 "Sobel Power" -- weights a precomputed Sobel-magnitude map
        sketchLuminancePower: 100, // DBV3 "Luminance Power" -- weights local ink density (the original signal)
        sketchClarity: 0,          // DBV3 "Clarity" -- NOT an edge threshold; unsharp-mask amount applied before tracing
        sketchSeedType: 'none',    // DBV3 "Seed Type": none | edges | sobel -- which map drives squiggle re-seeding
        sketchSeedThreshold: 50,   // DBV3 "Seed Threshold" -- cutoff applied to the edges/sobel seed map
        sketchCurveTension: 0,     // DBV3 "Tension" (Curves/Sweeping/Catmull-Roms/Flow Field/Superformula's shared curve renderer)
        sketchShapeType: 'rectangle', // DBV3 "Shape" (Sketch Shapes only): rectangle | ellipse
        sketchFlowStartAngle: 0,   // Sketch Flow Field
        sketchFlowFreqX: 1,
        sketchFlowFreqY: 1,
        sketchFlowAmplitude: 100,
        sketchSfCenterX: 50,       // Sketch Superformula (percent of working image, like DBV3's R/S fields)
        sketchSfCenterY: 50,
        sketchSfStartAngle: 0,
        sketchSfFrequency: 5,
        sketchSfCosFactor: 2,
        sketchSfSineFactor: 2,
        sketchSfCurvature: 2,

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

        pointLimit: 800,
        stippleRadiusMin: 0.4,
        stippleRadiusMax: 1.4,
        luminancePower: 2,      // real DBV3 "Density Power" (Voronoi sampler only -- LBG's own cell analysis fixes this at 1, matching the real k.b.i.e code)
        voronoiIterations: 4,   // shared Voronoi Lloyd-relaxation / LBG split-merge iteration count
        voronoiAccuracy: 0.5,   // real DBV3 "Voronoi Accuracy": cell centroid/mass scan step (shared by Voronoi + LBG)

        minSampleRadius: 4,
        maxSampleRadius: 24,
        adaptiveMaxPoints: 1200,
        adaptiveBrightness: 100,
        adaptiveContrast: 100,

        lbgMinDiameter: 2,          // real DBV3 LBG "Min Cell Diameter"
        lbgMaxDiameter: 20,         // real DBV3 LBG "Max Cell Diameter"
        lbgDensityBlend: 0.5,       // real DBV3 LBG "Density Blend"
        lbgHysteresis: 0.3,         // real DBV3 LBG "Hysteresis"
        lbgHysteresisGrowth: 0.05,  // real DBV3 LBG "Hysteresis Growth"

        gridCellWidth: 12,   // real DBV3 Grid "Cell Width"
        gridCellHeight: 12,  // real DBV3 Grid "Cell Height"
        gridSquare: 'on',    // real DBV3 Grid "Square"
        gridStagger: 'off',  // real DBV3 Grid "Stagger"
        gridNoise: 0,        // real DBV3 Grid "Noise"
        gridRadiusScale: 0.8,

        // Shared render-encoder sub-params (Voronoi/Adaptive/LBG/Grid; real
        // DBV3 encoder settings, drawingbot.k.e.c.b.*)
        pointShapeType: 'circle',
        triangulationCloseBorder: 'off',
        stipplingDotRadius: 0.8,
        dashAlignToEdge: 'on',
        dashMinRotation: 0,
        dashMaxRotation: 180,
        dashDistortion: 0,
        tspMaxOptPoints: 350,

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
        // Real DBV3 docs (pfms.rst) give Post Blur Iterations/Radius safe
        // ranges of 0-50 each; capped tighter here (20 / 30) because this is
        // a naive JS box blur (not their native OpenCV one) run on every
        // pen, every Generate -- still comfortably covers every real preset
        // seen in the wild (the "Fingerprints" preset uses 20 iters / 30
        // radius, right at this cap).
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
    // DBV3 Hatch/Spiral Sawtooth (pfms.rst "Hatch Sawtooth" -- shares its
    // Amplitude/Velocity formulas with Spiral Sawtooth verbatim): Amplitude
    // is a FIXED scale (finalWidth = lineSpacing * amplitude), but the
    // oscillation frequency ("Velocity") is LUMINANCE-DRIVEN PER POINT along
    // the line: velocity = minVelocity + sineFunction(luminance) *
    // (maxVelocity - minVelocity) -- same formula and easeInSine curve
    // traceSpiralReal already uses correctly. This used to pick one random
    // frequency for the whole line, which doesn't match: real Sawtooth
    // speeds up/slows down its oscillation as it crosses lighter/darker
    // parts of the image, not just once per stroke -- fixed to sample
    // density at every point and integrate a locally-varying phase instead.
    function addOscillation(points, weightMap, w, h, amplitude, velMin, velMax) {
        if (points.length < 2 || amplitude <= 0) return points;
        function densityAt(x, y) {
            var xi = Math.round(x), yi = Math.round(y);
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
            return weightMap[yi * w + xi] || 0;
        }
        var out = []; var phase = 0;
        for (var i = 0; i < points.length; i++) {
            var p0 = points[i], dx, dy;
            if (i < points.length - 1) { dx = points[i + 1].x - p0.x; dy = points[i + 1].y - p0.y; }
            else { dx = p0.x - points[i - 1].x; dy = p0.y - points[i - 1].y; }
            var len = Math.hypot(dx, dy) || 1;
            var nx = -dy / len, ny = dx / len;
            var step = i > 0 ? Math.hypot(p0.x - points[i - 1].x, p0.y - points[i - 1].y) : 0;
            var dens = densityAt(p0.x, p0.y);
            var velocity = velMin + easeInSine(1 - dens) * (velMax - velMin); // 1-dens ~ luminance; brighter = faster oscillation, matches real formula
            phase += step * (velocity / 360) * Math.PI * 2;
            var off = Math.sin(phase) * amplitude;
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
    // seedMap/seedThreshold port DBV3's real "Seed Type" (None/Edges/Sobel):
    // when set, only blocks whose seedMap average clears seedThreshold are
    // eligible at all; among those, still re-seed toward whatever working
    // ink (density) remains, since seedMap itself is a static structure map
    // and never gets eroded like the real ink density does.
    function findDarkestArea(density, w, h, seedMap, seedThreshold) {
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
                var seedSum = 0;
                var ex = Math.min(w, bx + blockW), ey = Math.min(h, by + blockH);
                for (var y = by; y < ey; y++) {
                    for (var x = bx; x < ex; x++) {
                        var d = density[y * w + x] || 0;
                        sum += d; cnt++;
                        if (seedMap) seedSum += seedMap[y * w + x] || 0;
                        if (d > localBest) { localBest = d; localBestX = x; localBestY = y; }
                    }
                }
                if (seedMap && cnt && (seedSum / cnt) < seedThreshold) continue; // block doesn't qualify under Seed Type
                var avg = cnt ? sum / cnt : 0;
                if (avg > bestBlockAvg) { bestBlockAvg = avg; bestX = localBestX; bestY = localBestY; found = true; }
            }
        }
        return found ? { x: bestX, y: bestY, blockAvg: bestBlockAvg } : null;
    }
    // `style`, when passed, activates the real DBV3 weighted scorer (Lines/
    // Curves only -- see weightedCandidateScore above); omitted entirely for
    // Squares/Waves, which stay pure-density like the real engine.
    function findDarkestLineJS(density, w, h, startX, startY, minLen, maxLen, numTests, startAngleDeg, deltaAngleDeg, style, prevAngleDeg) {
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
                    var scoreVal = style ? weightedCandidateScore(avg, x, y, angleDeg, prevAngleDeg, style, w, h) : avg;
                    if (!bestOnLine || scoreVal > bestOnLine.score) bestOnLine = { x: x, y: y, avg: avg, score: scoreVal };
                }
            }
            if (bestOnLine && (!best || bestOnLine.score > best.score)) best = bestOnLine;
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

    // ---- Sketch "Style" engine -- real port of drawingbot.k.e.d.a /
    // drawingbot.k.e.b.p. DBV3 sharpens the source image with an unsharp
    // mask (amount = "Clarity" -- confirmed from decompiled source; it is
    // NOT an edge-detection threshold despite the name) and, when Edge
    // Power/Sobel Power/Seed Type call for it, precomputes an edge map
    // (Canny in the real app) and a Sobel-magnitude map that a weighted
    // scorer samples at every candidate step:
    //   sample = luminance*LuminancePower + edges*EdgePower + sobel*SobelPower
    //          + variance*Directionality + noise*Distortion - angleDiff*Angularity
    // DBV3 minimizes this sample (lower = darker = better, since its maps
    // are luminance-style 0=ink/255=blank); we keep pl0tb0t's existing
    // "higher density = better" convention throughout this file, so the
    // formula below is polarity-flipped to MAXIMIZE, term-for-term
    // equivalent. The luminance/angularity/distortion terms are a
    // high-confidence port (verified against p.java's scoring method and
    // the base class's angleDiff/noise construction). The exact internal
    // scale of the edges/sobel/variance samplers (drawingbot.k.e.b.v) was
    // not fully recoverable from the decompiled source, so those three
    // terms are a best-effort, tunable approximation -- flip the sign in
    // weightedCandidateScore() below if testing shows a slider should push
    // the opposite way.
    function unsharpMask(lum, w, h, amount) {
        if (!(amount > 0)) return lum;
        var blurred = boxBlurPass(boxBlurPass(lum, w, h, 2, true), w, h, 2, false);
        var out = new Float32Array(w * h);
        for (var i = 0; i < lum.length; i++) {
            out[i] = Math.max(0, Math.min(1, lum[i] + (lum[i] - blurred[i]) * amount * 2));
        }
        return out;
    }
    function computeSobelMagnitudeMap(gx, gy, w, h) {
        var out = new Float32Array(w * h);
        var maxMag = 1e-6;
        for (var i = 0; i < w * h; i++) {
            var m = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
            out[i] = m;
            if (m > maxMag) maxMag = m;
        }
        for (var j = 0; j < out.length; j++) out[j] /= maxMag;
        return out;
    }
    function computeEdgeMap(sobelMag, w, h) {
        // Approximation of DBV3's real Canny-based edge map (no in-browser
        // Canny implementation here): threshold the Sobel magnitude, then
        // soften with a light blur so it behaves like the real app's
        // post-Canny GaussianBlur rather than a hard binary mask.
        var thresholded = new Float32Array(w * h);
        for (var i = 0; i < sobelMag.length; i++) thresholded[i] = sobelMag[i] > 0.25 ? 1 : 0;
        return boxBlurPass(boxBlurPass(thresholded, w, h, 1, true), w, h, 1, false);
    }
    function computeLocalVarianceMap(lum, w, h) {
        var out = new Float32Array(w * h);
        var maxVar = 1e-6;
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var i = y * w + x, sum = 0, sumSq = 0, n = 0;
                for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                    var v = lum[(y + dy) * w + (x + dx)]; sum += v; sumSq += v * v; n++;
                }
                var mean = sum / n;
                var vr = Math.max(0, sumSq / n - mean * mean);
                out[i] = vr;
                if (vr > maxVar) maxVar = vr;
            }
        }
        for (var j = 0; j < out.length; j++) out[j] /= maxVar; // normalize 0..1, comparable to edge/sobel terms
        return out;
    }
    function mapValueAt(map, w, h, x, y) {
        if (!map) return 0;
        var xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
        return map[yi * w + xi] || 0;
    }
    // Composite candidate score. `style` weights are all pre-normalized 0..1
    // by the caller. Returns a value where HIGHER = more likely to be
    // selected (matches pl0tb0t's existing avgDensity convention).
    function weightedCandidateScore(avgDensity, x, y, angleDeg, prevAngleDeg, style, w, h) {
        var score = avgDensity * style.luminancePower;
        if (style.edgePower > 0) score += mapValueAt(style.edgeMap, w, h, x, y) * style.edgePower;
        if (style.sobelPower > 0) score += mapValueAt(style.sobelMap, w, h, x, y) * style.sobelPower;
        if (style.directionality > 0) score += mapValueAt(style.varianceMap, w, h, x, y) * style.directionality;
        if (style.distortion > 0) score += (Math.random() - 0.5) * 2 * style.distortion;
        if (style.angularity > 0 && prevAngleDeg != null) {
            var diff = Math.abs(((angleDeg - prevAngleDeg + 540) % 360) - 180) / 180; // 0..1
            score -= diff * style.angularity;
        }
        return score;
    }
    // Tension-aware Catmull-Rom (Cardinal spline) sampler -- generalizes the
    // fixed-tension catmullRomResample() above with DBV3's real "Tension"
    // slider (drawingbot.e.d.b's tension field, read via this.d.t() in the
    // real i/f/j/r/s classes). tension=0 reproduces the classic Catmull-Rom
    // curve (identical output to catmullRomResample); tension=1 degenerates
    // toward straight chords between points. Uses the standard Hermite
    // cardinal-spline basis, not a DBV3-internal formula (the decompiled
    // curve class itself wasn't staged), but it is the textbook generalization
    // of the exact formula catmullRomResample already ports, so it's exact at
    // the one point (tension=0) that's independently verified.
    function catmullRomPointT(p0, p1, p2, p3, t, tension) {
        var t2 = t * t, t3 = t2 * t;
        var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        var mkx = (1 - tension) * (p2.x - p0.x) / 2, mkx2 = (1 - tension) * (p3.x - p1.x) / 2;
        var mky = (1 - tension) * (p2.y - p0.y) / 2, mky2 = (1 - tension) * (p3.y - p1.y) / 2;
        return {
            x: h00 * p1.x + h10 * mkx + h01 * p2.x + h11 * mkx2,
            y: h00 * p1.y + h10 * mky + h01 * p2.y + h11 * mky2
        };
    }
    function catmullRomResampleT(points, segsPerSpan, tension) {
        if (points.length < 3) return points;
        var out = [];
        for (var i = 0; i < points.length - 1; i++) {
            var p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
            for (var s = 0; s < segsPerSpan; s++) out.push(catmullRomPointT(p0, p1, p2, p3, s / segsPerSpan, tension));
        }
        out.push(points[points.length - 1]);
        return out;
    }
    // Real DBV3 superformula TANGENT gradient (drawingbot.k.e.d.r's static
    // method `a`, decompiled -- direct port, pure math): returns the (dx,dy)
    // direction a Sketch Superformula / Streamlines Superformula walker
    // should step in at polar angle `polarA` around its centre, derived from
    // d/dtheta of the superformula radius equation. More accurate than the
    // "theta+90+r*0.5" approximation used elsewhere in this file for the
    // Streamlines field (kept there unchanged to avoid disturbing existing
    // presets); this is the literal decompiled formula.
    function superformulaGradient(polarA, A, B, m, n1, n2, n3) {
        var z = m * polarA / 4;
        var cosz = Math.cos(z), sinz = Math.sin(z);
        var t1 = Math.pow(Math.abs(cosz / A), n2), t2 = Math.pow(Math.abs(sinz / B), n3);
        var sum = Math.max(1e-9, t1 + t2);
        var r = Math.pow(sum, -1 / Math.max(0.05, n1));
        var drDa = m * Math.pow(r, n1 + 1) *
            (n2 * Math.pow(Math.abs(A / cosz), -n2) * Math.tan(z) - n3 * Math.pow(Math.abs(B / sinz), -n3) / Math.tan(z)) / (4 * n1);
        if (!isFinite(drDa)) drDa = 1;
        return { x: drDa * Math.cos(polarA) - r * Math.sin(polarA), y: drDa * Math.sin(polarA) + r * Math.cos(polarA) };
    }
    // Rectangle/ellipse outline for one traced Sketch Shapes segment (real
    // drawingbot.k.e.d.m: same darkest-line walk as Sketch Lines, but instead
    // of drawing the traced segment it draws a Rectangle or Ellipse spanning
    // that segment's bounding box -- drawingbot.o.p's two real modes).
    function shapeOutlinePolyline(x0, y0, x1, y1, ellipse) {
        var minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
        if (maxX - minX < 0.5) { maxX += 0.5; minX -= 0.5; }
        if (maxY - minY < 0.5) { maxY += 0.5; minY -= 0.5; }
        if (!ellipse) return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY }];
        var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
        var pts = [], N = 20;
        for (var i = 0; i <= N; i++) { var a = (i / N) * Math.PI * 2; pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }); }
        return pts;
    }
    function traceSketchReal(weightMap, w, h, opts) {
        var density = new Float32Array(weightMap.length);
        density.set(weightMap);
        if (opts.clarity > 0) density = unsharpMask(density, w, h, opts.clarity);

        // Sobel Edges (real drawingbot.k.e.d.o) additionally erases a COPY of
        // the sobel map as it draws, so already-traced edges stop attracting
        // later squiggles -- the main density buffer's own erase is separate
        // and untouched. Only allocated for that mode.
        var sobelErodible = (opts.angleMode === 'sobeledges' && opts.sobelMap) ? new Float32Array(opts.sobelMap) : null;

        // DBV3 "Seed Type": None (default, seed from working ink density,
        // unchanged behaviour) | Edges | Sobel (seed from those static maps
        // instead, gated by Seed Threshold).
        var seedMap = opts.seedType === 'edges' ? opts.edgeMap : opts.seedType === 'sobel' ? opts.sobelMap : null;
        var seedThreshold = opts.seedThreshold || 0;

        // Real DBV3's shared Style scorer (drawingbot.k.e.d.a /
        // drawingbot.k.e.b.p) is inherited by every Sketch PFM that extends
        // the darkest-line walk (Lines, Curves, Quad/Cubic Beziers,
        // Catmull-Roms, Shapes, Sobel Edges, Sweeping Curves all decompile to
        // subclasses of it) -- NOT by Squares (single deterministic test, no
        // candidates to weight) or Waves/Flow Field/Superformula (those three
        // decompile as direct drawingbot.h.d subclasses, bypassing the Style
        // engine entirely).
        var STYLE_MODES = { lines: 1, curves: 1, sweeping: 1, quadbezier: 1, cubicbezier: 1, catmullsearch: 1, shapes: 1, sobeledges: 1 };
        var style = null;
        if (STYLE_MODES[opts.angleMode]) {
            style = {
                luminancePower: opts.luminancePower, directionality: opts.directionality,
                distortion: opts.distortion, angularity: opts.angularity,
                edgePower: opts.edgePower, sobelPower: opts.sobelPower,
                edgeMap: opts.edgeMap, sobelMap: opts.sobelMap, varianceMap: opts.varianceMap
            };
            // DBV3 fallback: if every weight is zero the scorer degenerates
            // to nothing, so it forces luminance-only scoring in that case.
            if (!style.luminancePower && !style.directionality && !style.distortion && !style.angularity && !style.edgePower && !style.sobelPower) {
                style.luminancePower = 1;
            }
        }
        // Sobel Edges forces meaningful Sobel weighting on even if the user
        // hasn't raised the slider -- that's the whole point of the mode
        // (real DBV3's o.java hardcodes this.G = this.P, its own dedicated
        // "Sobel Power" field, at PFM construction).
        if (opts.angleMode === 'sobeledges' && style && !(style.sobelPower > 0)) style.sobelPower = Math.max(style.sobelPower, 0.4);

        var polylines = [];
        var totalLines = 0, fails = 0, squiggleCount = 0;
        var MAX_FAILS = 300, MAX_SQUIGGLES = 600, MAX_TOTAL_LINES = 3000;
        var tension = (typeof opts.curveTension === 'number') ? opts.curveTension : 0;

        while (squiggleCount < MAX_SQUIGGLES && totalLines < MAX_TOTAL_LINES) {
            var seed = findDarkestArea(density, w, h, seedMap, seedThreshold);
            if (!seed || seed.blockAvg <= 0.05) break;
            squiggleCount++;

            var curX = seed.x, curY = seed.y;
            var cur = [{ x: curX, y: curY }];           // raw walked points (drives erase/continuity)
            var renderPts = [{ x: curX, y: curY }];      // what actually gets emitted as the drawn polyline
            var shapePolys = null;                        // Sketch Shapes: one closed poly per segment instead
            var failedThisSquiggle = true;
            var prevAngleDeg = null;          // DBV3: no turn penalty on a squiggle's first step
            var sweepAngleDeg = null;         // Sweeping Curves: persists & drifts across the whole squiggle

            for (var s = 0; s < opts.squiggleMaxLength; s++) {
                var startAngleDeg, searchDelta, numTests, useStyle = null, result = null;

                if (opts.angleMode === 'squares') {
                    startAngleDeg = opts.squareStartAngle + (Math.sin(curX / 9) + Math.cos(curY / 9 + 26)) * 180 / Math.PI;
                    searchDelta = 360; numTests = opts.lineTests;
                    result = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, numTests, startAngleDeg, searchDelta, null, null);
                } else if (opts.angleMode === 'waves') {
                    // Real DBV3 Sketch Waves tests exactly 2 fixed directions
                    // (the wave angle, and that angle + 180 deg) via a single
                    // luminance test each -- not a swept wedge of candidates.
                    var waveDir = opts.waveStartAngle
                        + (waveFieldFn(opts.waveTypeX, ((curX / w * 100) + opts.waveOffsetX) / opts.waveDivisorX)
                         + waveFieldFn(opts.waveTypeY, ((curY / h * 100) + opts.waveOffsetY) / opts.waveDivisorY)) * 180 / Math.PI;
                    result = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, 2, waveDir, 360, null, null);
                } else if (opts.angleMode === 'flowfield' || opts.angleMode === 'superformula') {
                    // Real Sketch Flow Field / Superformula (j.java / r.java):
                    // no candidate search at all -- a deterministic field
                    // direction, alternating +180 deg every OTHER step (this.O
                    // flips each squiggle in the real code; here per-step for
                    // a comparable alternating character), stepped once. We
                    // still run it through the length-search (best average
                    // darkness along that fixed direction) rather than the
                    // real code's pure luminance-modulated length formula --
                    // a deliberate v3.1 adaptation, noted where this mode is
                    // exposed in the UI.
                    var fieldAngleRad;
                    if (opts.angleMode === 'flowfield') {
                        fieldAngleRad = (opts.flowStartAngleRad || 0) + p.noise(curX * opts.flowFreqX, curY * opts.flowFreqY, 11.3) * Math.PI * 2 * (opts.flowAmplitude01 != null ? opts.flowAmplitude01 : 1);
                    } else {
                        var dx0 = curX - opts.sfCenterX, dy0 = curY - opts.sfCenterY;
                        var theta0 = Math.atan2(dy0, dx0);
                        var grad = superformulaGradient(theta0, 1, 1, opts.sfFrequency, opts.sfCosFactor, opts.sfSineFactor, opts.sfCurvature);
                        fieldAngleRad = Math.atan2(grad.y, grad.x) + (opts.sfStartAngleRad || 0);
                    }
                    var fieldAngleDeg = fieldAngleRad * 180 / Math.PI + (s % 2 ? 180 : 0);
                    result = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, 1, fieldAngleDeg, 0, null, null);
                } else if (opts.angleMode === 'sweeping') {
                    // Real Sketch Sweeping Curves (s.java): a PERSISTENT sweep
                    // angle initialized once per squiggle, then each step
                    // searches a wide-but-bounded wedge (+/-150 deg, "allowed
                    // angle" 300 total, both real constants) around it and
                    // drifts to whichever candidate wins -- unlike Lines,
                    // which re-rolls a fresh random angle every step. That
                    // persistence + bounded search is what gives it a
                    // continuous "sweeping" character instead of Lines' fully
                    // independent jitter.
                    if (sweepAngleDeg == null) sweepAngleDeg = Math.random() * 360;
                    numTests = opts.lineTests;
                    result = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, numTests, sweepAngleDeg - 150, 300, style, prevAngleDeg);
                    if (result) sweepAngleDeg = Math.atan2(result.y - curY, result.x - curX) * 180 / Math.PI;
                } else if (opts.angleMode === 'quadbezier' || opts.angleMode === 'cubicbezier') {
                    // Real Sketch Quad/Cubic Beziers (l.java/h.java): for each
                    // of `lineTests` candidate directions, additionally
                    // search `shapeSearchCount` lateral control-point offsets
                    // (perpendicular to that candidate) to find the smoothest
                    // curve, then across directions keeps the darkest one.
                    // Faithfully expensive if done as nested full search;
                    // adapted here to pick the direction/endpoint first via
                    // the same weighted search as Lines (equally real,
                    // cheaper), THEN search control-point offsets only for
                    // the winning direction -- v3.1, structure matches, cost
                    // profile doesn't.
                    startAngleDeg = opts.startAngleMin + Math.random() * (opts.startAngleMax - opts.startAngleMin);
                    result = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, opts.lineTests, startAngleDeg, 360, style, prevAngleDeg);
                } else if (opts.angleMode === 'catmullsearch') {
                    // Real Sketch Catmull-Roms (f.java): a genuine TWO-STEP
                    // lookahead -- for each candidate p3 (from the normal
                    // weighted search), test candidate p4s from p3, score the
                    // pair's combined darkness, and keep the best (p3,p4)
                    // pair, advancing the walk by both points at once.
                    startAngleDeg = opts.startAngleMin + Math.random() * (opts.startAngleMax - opts.startAngleMin);
                    var p3Cands = [];
                    var wideTests = Math.max(3, Math.min(12, opts.lineTests));
                    for (var ct = 0; ct < wideTests; ct++) {
                        var ang = startAngleDeg + (360 * ct) / wideTests;
                        var r3 = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, 1, ang, 0, style, prevAngleDeg);
                        if (r3) p3Cands.push(r3);
                    }
                    var bestPair = null;
                    for (var pi = 0; pi < p3Cands.length; pi++) {
                        var p3 = p3Cands[pi];
                        var r4 = findDarkestLineJS(density, w, h, p3.x, p3.y, opts.minLineLength, opts.maxLineLength, Math.max(3, Math.round(opts.lineTests / 2)), 0, 360, style, null);
                        if (!r4) continue;
                        var pairScore = (p3.score != null ? p3.score : p3.avg) + (r4.score != null ? r4.score : r4.avg);
                        if (!bestPair || pairScore > bestPair.score) bestPair = { p3: p3, p4: r4, score: pairScore };
                    }
                    if (bestPair) {
                        eraseAlongSegment(density, w, h, curX, curY, bestPair.p3.x, bestPair.p3.y, opts.radiusMin, opts.radiusMax, opts.eraseMin, opts.eraseMax, opts.eraseTone);
                        cur.push({ x: bestPair.p3.x, y: bestPair.p3.y });
                        curX = bestPair.p3.x; curY = bestPair.p3.y;
                        totalLines++;
                        result = bestPair.p4;
                    }
                } else { // 'lines' and 'shapes'/'sobeledges' share the exact same real search
                    startAngleDeg = opts.startAngleMin + Math.random() * (opts.startAngleMax - opts.startAngleMin);
                    searchDelta = 360; numTests = opts.lineTests; useStyle = style;
                    result = findDarkestLineJS(density, w, h, curX, curY, opts.minLineLength, opts.maxLineLength, numTests, startAngleDeg, searchDelta, useStyle, prevAngleDeg);
                }

                if (!result) break;
                var segX0 = curX, segY0 = curY;
                eraseAlongSegment(density, w, h, curX, curY, result.x, result.y, opts.radiusMin, opts.radiusMax, opts.eraseMin, opts.eraseMax, opts.eraseTone);
                if (sobelErodible) eraseAlongSegment(sobelErodible, w, h, curX, curY, result.x, result.y, opts.radiusMin, opts.radiusMax, opts.eraseMin, opts.eraseMax, opts.eraseTone);
                if (style) prevAngleDeg = Math.atan2(result.y - curY, result.x - curX) * 180 / Math.PI;
                cur.push({ x: result.x, y: result.y });
                curX = result.x; curY = result.y;
                totalLines++;
                failedThisSquiggle = false;

                if (opts.angleMode === 'shapes') {
                    if (!shapePolys) shapePolys = [];
                    shapePolys.push(shapeOutlinePolyline(segX0, segY0, result.x, result.y, opts.shapeEllipse));
                } else {
                    renderPts.push({ x: curX, y: curY });
                }
                if (totalLines >= MAX_TOTAL_LINES) break;
            }

            if (shapePolys) {
                for (var spi = 0; spi < shapePolys.length; spi++) if (shapePolys[spi].length >= 2) polylines.push(shapePolys[spi]);
            } else if (renderPts.length >= 2) {
                var CURVE_MODES = { curves: 1, sweeping: 1, catmullsearch: 1, flowfield: 1, superformula: 1, quadbezier: 1, cubicbezier: 1 };
                polylines.push(CURVE_MODES[opts.angleMode] ? catmullRomResampleT(renderPts, 4, tension) : renderPts);
            }
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
    function applySketchStyle(polylines) {
        // Rendering is now decided per real-PFM inside traceSketchReal
        // itself (straight segments for Lines/Squares/Waves/Sobel
        // Edges/Shapes, real incremental curves for Curves/Sweeping/
        // Catmull-Roms/Flow Field/Superformula, matching each PFM's actual
        // decompiled b()) -- nothing left to post-process here.
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
        if (style === 'sawtooth') lines = lines.map(function (l) { return addOscillation(l, weightMap, w, h, spacing * 0.4 * amplitude, velMin, velMax); });
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
                // Real PFMSpiralBasic.java: `mask=240; if (ignoreWhite && mask <= luminance) draw=false;`
                // i.e. skip when luminance >= 240/255. density = 1-luminance, so that's density <= 15/255.
                var draw = within && !(opts.ignoreWhite && avgDens <= (15 / 255));

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

    // ---- Voronoi / Stippling family (mode: 'stipple') -- (approx) overall.
    // Real DBV3 (pfms.rst): scatter points weighted by brightness, compute a
    // TRUE Voronoi diagram, recompute weighted centroids from it, rebuild
    // the diagram from those centroids, repeat for N "Voronoi Iterations" --
    // and real DBV3 also exposes Point Density (1-1200) and a SEPARATE
    // "Density Power" (biases the centroid recompute) alongside "Luminance
    // Power" (biases the initial scatter) -- two independent controls this
    // tracer folds into one (luminancePower does both jobs here). This
    // tracer approximates the whole relaxation step as bucketed local-
    // repulsion (spatial hash, O(n) per pass) rather than true recomputed
    // Voronoi diagrams -- much cheaper, same qualitative "points spread out,
    // denser areas stay packed" result, but not the real algorithm.
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
    // ---- Voronoi / Adaptive / LBG / Grid: shared real-geometry engine ----
    // Real DBV3 builds all four families from ONE combinator architecture
    // (drawingbot.k.e.c.c): a "positional encoder" (sampler) that places
    // points, paired with a shared "encoder" that renders the same 8ish
    // named geometries -- Shapes / Triangulation / Tree / Stippling /
    // Dashes / Diagram / TSP (Letters and Circular Scribbles omitted this
    // pass: real font-outline plotting and the real organic curve-builder
    // are each substantial standalone features, not something to fake under
    // the real name -- see the tips on those encoders below). Ported
    // directly from the decompiled Premium classes: drawingbot.k.e.c.a.p
    // (Voronoi sampler), drawingbot.k.e.c.a.k (LBG sampler), drawingbot.
    // k.e.c.a.g (Grid sampler, verbatim), drawingbot.k.e.c.b.{f,B,z,x,k,m}
    // (Shapes/Triangulation/Tree/Stippling/Dashes/Diagram encoders), and
    // drawingbot.k.b.i.e/f + drawingbot.k.e.c.a.a.e's shared weighted-
    // centroid-with-orientation formula (identical in the real Voronoi
    // sampler and the real LBG cell analysis -- ported once, used by both).
    // Adaptive's real disk-packing engine (drawingbot.k.e.b.a, "AIS") did
    // NOT survive decompilation intact -- Windows' case-insensitive
    // filesystem collided it with an unrelated class also named "a" in the
    // same package (a thin FutureTask wrapper), so only 339 bytes of
    // unrelated code came out where the real packing algorithm should be.
    // Adaptive's sampler here is therefore an honest from-scratch
    // Poisson-disc packer (v3.1), not a port; everything downstream of it
    // (the 6 shared encoders) is still the real, verified rendering code.
    // TSP tours use a real, standard nearest-neighbour + bounded 2-opt
    // solver (not DBV3's own SuperPixel-based tour construction, whose
    // dependency chain wasn't staged this pass) -- a genuine, correct TSP
    // heuristic, just not a byte-identical port.
    // Bounded throughout: point counts, Delaunay/Voronoi rebuilds per
    // iteration, and 2-opt passes are all hard-capped independent of user
    // sliders, consistent with every other tracer in this file.

    function polyBBox(poly) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (var i = 0; i < poly.length; i++) {
            var p = poly[i];
            if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
        }
        return { x0: x0, y0: y0, x1: x1, y1: y1 };
    }
    function pointInPolygon(px, py, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    function clipPolygonToRect(poly, x0, y0, x1, y1) {
        if (!poly || poly.length < 3) return poly;
        function clipEdge(pts, inside, intersect) {
            var out = [];
            for (var i = 0; i < pts.length; i++) {
                var cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
                var curIn = inside(cur), prevIn = inside(prev);
                if (curIn) { if (!prevIn) out.push(intersect(prev, cur)); out.push(cur); }
                else if (prevIn) out.push(intersect(prev, cur));
            }
            return out;
        }
        var pts = poly;
        pts = clipEdge(pts, function (p) { return p.x >= x0; }, function (a, b) { var t = (x0 - a.x) / (b.x - a.x); return { x: x0, y: a.y + t * (b.y - a.y) }; });
        pts = clipEdge(pts, function (p) { return p.x <= x1; }, function (a, b) { var t = (x1 - a.x) / (b.x - a.x); return { x: x1, y: a.y + t * (b.y - a.y) }; });
        pts = clipEdge(pts, function (p) { return p.y >= y0; }, function (a, b) { var t = (y0 - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: y0 }; });
        pts = clipEdge(pts, function (p) { return p.y <= y1; }, function (a, b) { var t = (y1 - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: y1 }; });
        return pts;
    }
    // Bowyer-Watson incremental Delaunay triangulation. O(n^2) worst case;
    // every caller caps point counts (see MAX_* constants below) well
    // under where that matters on a Pi.
    function delaunayTriangulate(pts) {
        var n = pts.length;
        if (n < 3) return [];
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < n; i++) { if (pts[i].x < minX) minX = pts[i].x; if (pts[i].x > maxX) maxX = pts[i].x; if (pts[i].y < minY) minY = pts[i].y; if (pts[i].y > maxY) maxY = pts[i].y; }
        var dmax = Math.max(maxX - minX, maxY - minY, 1) * 20;
        var midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
        var work = pts.slice();
        var superStart = work.length;
        work.push({ x: midX - dmax, y: midY - dmax }, { x: midX, y: midY + dmax }, { x: midX + dmax, y: midY - dmax });
        function circumcircle(a, b, c) {
            var ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
            var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
            if (Math.abs(d) < 1e-9) return null;
            var ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
            var uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
            return { x: ux, y: uy, r2: (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy) };
        }
        var triangles = [[superStart, superStart + 1, superStart + 2]];
        for (var pi = 0; pi < superStart; pi++) {
            var p = work[pi], bad = [];
            for (var ti = 0; ti < triangles.length; ti++) {
                var t = triangles[ti], cc = circumcircle(work[t[0]], work[t[1]], work[t[2]]);
                if (cc && ((p.x - cc.x) * (p.x - cc.x) + (p.y - cc.y) * (p.y - cc.y)) <= cc.r2 * 1.0000001) bad.push(ti);
            }
            var edgeCount = {};
            for (var bi = 0; bi < bad.length; bi++) {
                var t2 = triangles[bad[bi]], edges = [[t2[0], t2[1]], [t2[1], t2[2]], [t2[2], t2[0]]];
                for (var ei = 0; ei < 3; ei++) { var key = Math.min(edges[ei][0], edges[ei][1]) + '_' + Math.max(edges[ei][0], edges[ei][1]); edgeCount[key] = (edgeCount[key] || 0) + 1; }
            }
            var boundary = [];
            for (var bi2 = 0; bi2 < bad.length; bi2++) {
                var t3 = triangles[bad[bi2]], edges2 = [[t3[0], t3[1]], [t3[1], t3[2]], [t3[2], t3[0]]];
                for (var ei2 = 0; ei2 < 3; ei2++) { var key2 = Math.min(edges2[ei2][0], edges2[ei2][1]) + '_' + Math.max(edges2[ei2][0], edges2[ei2][1]); if (edgeCount[key2] === 1) boundary.push(edges2[ei2]); }
            }
            var keep = [];
            for (var ti2 = 0; ti2 < triangles.length; ti2++) if (bad.indexOf(ti2) < 0) keep.push(triangles[ti2]);
            for (var bo = 0; bo < boundary.length; bo++) keep.push([boundary[bo][0], boundary[bo][1], pi]);
            triangles = keep;
        }
        var out = [];
        for (var fi = 0; fi < triangles.length; fi++) { var tt = triangles[fi]; if (tt[0] < superStart && tt[1] < superStart && tt[2] < superStart) out.push(tt); }
        return out;
    }
    // Real Voronoi cells as the dual of the Delaunay triangulation
    // (triangle circumcenters around each site, angle-sorted, clipped to the
    // working canvas) -- same diagram real DBV3 gets from JTS's
    // VoronoiDiagramBuilder (Voronoi sampler) or OpenCV's Subdiv2D (LBG's
    // cell analysis); this file has neither library, so it's built directly.
    function voronoiCellsFromDelaunay(points, triangles, w, h) {
        var n = points.length, cellsFor = new Array(n);
        for (var i = 0; i < n; i++) cellsFor[i] = [];
        for (var ti = 0; ti < triangles.length; ti++) {
            var t = triangles[ti], a = points[t[0]], b = points[t[1]], c = points[t[2]];
            var ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
            var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
            var cc;
            if (Math.abs(d) < 1e-9) cc = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3 };
            else cc = {
                x: ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d,
                y: ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
            };
            cellsFor[t[0]].push(cc); cellsFor[t[1]].push(cc); cellsFor[t[2]].push(cc);
        }
        var polys = new Array(n);
        for (var i2 = 0; i2 < n; i2++) {
            var pc = points[i2], pts2 = cellsFor[i2];
            if (pts2.length < 3) { polys[i2] = null; continue; }
            pts2.sort(function (p1, p2) { return Math.atan2(p1.y - pc.y, p1.x - pc.x) - Math.atan2(p2.y - pc.y, p2.x - pc.x); });
            var clean = [];
            for (var k = 0; k < pts2.length; k++) { var pp = pts2[k], last = clean[clean.length - 1]; if (!last || Math.hypot(pp.x - last.x, pp.y - last.y) > 0.01) clean.push(pp); }
            polys[i2] = clipPolygonToRect(clean, 0, 0, w, h);
        }
        return polys;
    }
    // Density-weighted cell centroid + orientation -- the EXACT formula real
    // DBV3 uses in both places it needs one: the Voronoi sampler's Lloyd-
    // relaxation step (drawingbot.k.e.c.a.p's static method `a`) and LBG's
    // per-cell mass/orientation analysis (drawingbot.k.b.i.e's method `a`) --
    // both decompile to the identical image-moment formula, ported once here
    // and shared by both families below, matching the real architecture.
    // `accuracy` scales scan step size (DBV3's real "Voronoi Accuracy").
    function weightedCentroidInPoly(poly, bb, weightMap, w, h, densityPower, accuracy) {
        var x0 = Math.max(0, Math.floor(bb.x0)), x1 = Math.min(w - 1, Math.ceil(bb.x1));
        var y0 = Math.max(0, Math.floor(bb.y0)), y1 = Math.min(h - 1, Math.ceil(bb.y1));
        if (x1 <= x0 || y1 <= y0) return null;
        var step = Math.max(1, Math.round(1 / Math.max(0.05, accuracy)));
        var dSum = 0, xSum = 0, ySum = 0, xySum = 0, xxSum = 0, yySum = 0;
        for (var y = y0; y <= y1; y += step) {
            for (var x = x0; x <= x1; x += step) {
                if (poly && !pointInPolygon(x, y, poly)) continue;
                var lum = 255 * (1 - (weightMap[y * w + x] || 0));
                var dens = Math.pow(255 - lum, densityPower);
                dSum += dens; xSum += x * dens; ySum += y * dens; xySum += x * y * dens; xxSum += x * x * dens; yySum += y * y * dens;
            }
        }
        if (dSum <= 0) return null;
        var cx = xSum / dSum, cy = ySum / dSum;
        var mxx = xxSum / dSum - cx * cx, mxy = (xySum / dSum - cx * cy) * 2, myy = yySum / dSum - cy * cy;
        return { x: cx, y: cy, orientation: Math.atan2(mxy, mxx - myy) / 2, mass: dSum };
    }
    // Real Minimum Spanning Tree (Prim's algorithm; DBV3's own MST builder
    // seeds its candidate edges from a Delaunay triangulation as a
    // performance optimization since the true MST is always a Delaunay
    // subgraph -- a real optimization, not an accuracy difference. This
    // computes the same, correct MST directly in O(n^2), fine at the point
    // counts this file caps samplers to).
    function minimumSpanningTree(points) {
        var n = points.length;
        if (n < 2) return [];
        var inTree = new Uint8Array(n), dist = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1);
        dist[0] = 0;
        var edges = [];
        for (var iter = 0; iter < n; iter++) {
            var u = -1, best = Infinity;
            for (var i = 0; i < n; i++) if (!inTree[i] && dist[i] < best) { best = dist[i]; u = i; }
            if (u < 0) break;
            inTree[u] = 1;
            if (parent[u] >= 0) edges.push([parent[u], u]);
            for (var v = 0; v < n; v++) {
                if (inTree[v]) continue;
                var dx = points[u].x - points[v].x, dy = points[u].y - points[v].y, d2 = dx * dx + dy * dy;
                if (d2 < dist[v]) { dist[v] = d2; parent[v] = u; }
            }
        }
        return edges;
    }
    // Real, standard TSP heuristic: nearest-neighbour construction + bounded
    // 2-opt local search (not DBV3's own SuperPixel-based tour, see header
    // note above) -- a genuinely correct single continuous tour, just not a
    // byte-identical port of their construction method.
    function nearestNeighborTour(points) {
        var n = points.length;
        if (n < 2) return points.map(function (_, i) { return i; });
        var visited = new Uint8Array(n), tour = [0];
        visited[0] = 1;
        for (var s = 1; s < n; s++) {
            var cur = tour[tour.length - 1], best = -1, bd = Infinity;
            for (var i = 0; i < n; i++) {
                if (visited[i]) continue;
                var dx = points[cur].x - points[i].x, dy = points[cur].y - points[i].y, d2 = dx * dx + dy * dy;
                if (d2 < bd) { bd = d2; best = i; }
            }
            tour.push(best); visited[best] = 1;
        }
        return tour;
    }
    function twoOptImprove(tour, points, maxPasses) {
        var n = tour.length;
        if (n < 4) return tour;
        function d(a, b) { var dx = points[a].x - points[b].x, dy = points[a].y - points[b].y; return Math.sqrt(dx * dx + dy * dy); }
        var improved = true, passes = 0;
        while (improved && passes < maxPasses) {
            improved = false; passes++;
            for (var i = 0; i < n - 2; i++) {
                for (var j = i + 2; j < n - (i === 0 ? 1 : 0); j++) {
                    var a = tour[i], b = tour[i + 1], c = tour[j], dd = tour[(j + 1) % n];
                    if (a === c || b === dd) continue;
                    if (d(a, c) + d(b, dd) < d(a, b) + d(c, dd) - 1e-6) {
                        var seg = tour.slice(i + 1, j + 1).reverse();
                        for (var k = 0; k < seg.length; k++) tour[i + 1 + k] = seg[k];
                        improved = true;
                    }
                }
            }
        }
        return tour;
    }

    // ---- Point samplers (one per family) ----------------------------------
    // Voronoi (real, direct port of drawingbot.k.e.c.a.p): weighted-
    // rejection point sampling by local darkness (real formula:
    // rand <= (255-lum)^densityPower / 255^(densityPower-1)), then N Lloyd-
    // relaxation iterations against a real recomputed Voronoi diagram each
    // pass, moving every point to its cell's density-weighted centroid.
    function sampleVoronoiPoints(weightMap, w, h, opts) {
        var target = Math.max(4, Math.min(opts.maxPoints, opts.pointCount));
        var pts = [], tries = 0, maxTries = target * 300;
        var minLum = 255, maxLum = 0;
        for (var i = 0; i < weightMap.length; i++) { var lum = 255 * (1 - weightMap[i]); if (lum < minLum) minLum = lum; if (lum > maxLum) maxLum = lum; }
        var lumRange = Math.max(1, maxLum - minLum);
        while (pts.length < target && tries < maxTries) {
            tries++;
            var rx = Math.random() * w, ry = Math.random() * h;
            var lum = 255 * (1 - (weightMap[(ry | 0) * w + (rx | 0)] || 0));
            var thresh = Math.pow(255 - lum, opts.densityPower) / Math.pow(255, Math.max(0, opts.densityPower - 1));
            if (Math.random() * lumRange <= thresh) pts.push({ x: rx, y: ry });
        }
        if (pts.length < 3) return { points: pts, cells: null };
        var iterations = Math.max(0, Math.min(12, opts.iterations));
        var cells = null;
        for (var it = 0; it <= iterations; it++) {
            var tri = delaunayTriangulate(pts);
            cells = voronoiCellsFromDelaunay(pts, tri, w, h);
            if (it === iterations) break;
            for (var pi = 0; pi < pts.length; pi++) {
                var poly = cells[pi]; if (!poly || poly.length < 3) continue;
                var c = weightedCentroidInPoly(poly, polyBBox(poly), weightMap, w, h, opts.densityPower, opts.accuracy);
                if (c) { pts[pi].x = c.x; pts[pi].y = c.y; pts[pi].orientation = c.orientation; }
            }
        }
        return { points: pts, cells: cells };
    }
    // Adaptive (v3.1 -- see header note: real AIS packer unrecoverable).
    // From-scratch Poisson-disc packer: candidate disks at random positions,
    // local radius interpolated Max->Min Sample Radius by local darkness,
    // accepted only if they don't overlap an already-placed disk.
    function sampleAdaptiveDisks(weightMap, w, h, opts) {
        var minR = Math.max(0.5, opts.minRadius), maxR = Math.max(minR + 0.5, opts.maxRadius);
        var cell = Math.max(1, minR);
        var gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell));
        var grid = new Array(gw * gh);
        var pts = [];
        var MAX_DISKS = Math.min(opts.maxPoints || 2500, 2500);
        var tries = 0, maxTries = MAX_DISKS * 80;
        function densityAt(x, y) { var xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0; return weightMap[yi * w + xi] || 0; }
        function radiusAt(x, y) { return maxR - (maxR - minR) * densityAt(x, y); }
        function overlaps(x, y, r) {
            var gx = (x / cell) | 0, gy = (y / cell) | 0, rc = Math.max(1, Math.ceil((r + maxR) / cell));
            for (var dy = -rc; dy <= rc; dy++) {
                var yy = gy + dy; if (yy < 0 || yy >= gh) continue;
                for (var dx = -rc; dx <= rc; dx++) {
                    var xx = gx + dx; if (xx < 0 || xx >= gw) continue;
                    var b = grid[yy * gw + xx]; if (!b) continue;
                    for (var bi = 0; bi < b.length; bi++) { var o = pts[b[bi]], ddx = o.x - x, ddy = o.y - y, mind = (o.r + r) * (o.r + r); if (ddx * ddx + ddy * ddy < mind) return true; }
                }
            }
            return false;
        }
        while (pts.length < MAX_DISKS && tries < maxTries) {
            tries++;
            var x = Math.random() * w, y = Math.random() * h;
            if (densityAt(x, y) <= 0.03) continue;
            var r = radiusAt(x, y);
            if (overlaps(x, y, r)) continue;
            var gx = (x / cell) | 0, gy = (y / cell) | 0, gk = gy * gw + gx;
            (grid[gk] = grid[gk] || []).push(pts.length);
            pts.push({ x: x, y: y, r: r });
        }
        return { points: pts, cells: null };
    }
    // LBG (real, direct port of drawingbot.k.e.c.a.k's iterative split/merge
    // -- Linde-Buzo-Gray 1980): each iteration rebuilds a real Voronoi
    // diagram, computes each cell's mass + weighted centroid (shared formula
    // above), derives a target diameter per cell from its mean density (Min/
    // Max Cell Diameter blended by Density Blend, the real l/m/n fields),
    // then SPLITS cells whose mass exceeds that target's area (2 new points
    // offset along the cell's real orientation), MERGES cells below it
    // (drop), or recentres (Lloyd step) otherwise. Hysteresis/Hysteresis
    // Growth (real q/r fields) widen the keep-band each iteration so the
    // point count converges instead of oscillating. `easeOutQuad` stands in
    // for DBV3's own easing helper (drawingbot.e.b.a.i) -- that one specific
    // curve wasn't recoverable from the decompile, this is the standard
    // shape it's almost certainly matching.
    function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
    function lbgTargetDiameter(meanDensity, minDiam, maxDiam, blend) {
        var yProgress = 1 - (easeOutQuad(meanDensity) * blend + meanDensity * (1 - blend));
        return minDiam + yProgress * (maxDiam - minDiam);
    }
    function sampleLBGPoints(weightMap, w, h, opts) {
        // Hard, unconditional point ceiling independent of opts.maxPoints --
        // NOT just the real l/m/n hysteresis-band logic below (which only
        // throttles NEW splits within a single iteration and can't shrink an
        // already-oversized population). On a small/bright min-diameter with
        // a dense image, the real split/merge dynamics alone can converge to
        // thousands of points well past the user's Point Limit, and every
        // iteration re-triangulates the whole set (O(n^2)) -- exactly the
        // unbounded-compute pattern this file's header warns against, so it
        // gets a real, independent backstop like every other sampler here.
        var HARD_CAP = Math.min(opts.maxPoints, 2000);
        var pts = [], startCount = Math.max(4, Math.min(HARD_CAP, Math.round(opts.pointCount * 0.3)));
        var tries = 0, maxTries = startCount * 200;
        while (pts.length < startCount && tries < maxTries) {
            tries++;
            var x = Math.random() * w, y = Math.random() * h;
            if ((weightMap[(y | 0) * w + (x | 0)] || 0) > 0.05) pts.push({ x: x, y: y });
        }
        if (pts.length < 3) return { points: pts, cells: null };
        var iterations = Math.max(1, Math.min(20, opts.iterations)), cells = null;
        for (var it = 0; it < iterations; it++) {
            var tri = delaunayTriangulate(pts);
            cells = voronoiCellsFromDelaunay(pts, tri, w, h);
            var hysteresis = opts.hysteresis + it * opts.hysteresisGrowth;
            var next = [];
            for (var pi = 0; pi < pts.length; pi++) {
                var poly = cells[pi];
                if (!poly || poly.length < 3) continue;
                var bb = polyBBox(poly);
                var c = weightedCentroidInPoly(poly, bb, weightMap, w, h, 1, opts.accuracy);
                if (!c || c.mass <= 0) continue;
                var pixCount = Math.max(1, (bb.x1 - bb.x0) * (bb.y1 - bb.y0));
                var meanDensity = Math.min(1, c.mass / pixCount);
                var diameter = lbgTargetDiameter(meanDensity, opts.minDiameter, opts.maxDiameter, opts.densityBlend);
                var targetArea = Math.PI * (diameter / 2) * (diameter / 2);
                var minMass = (1 - hysteresis / 2) * targetArea, maxMass = (1 + hysteresis / 2) * targetArea;
                if (c.mass < minMass) { continue; }
                else if (c.mass < maxMass || next.length >= HARD_CAP - 1) { next.push({ x: c.x, y: c.y }); }
                else {
                    var area = Math.max(c.mass, 1), radius = Math.sqrt(area / Math.PI) / 2, ang = c.orientation;
                    next.push({ x: Math.max(0, Math.min(w - 1, c.x - radius * Math.cos(ang))), y: Math.max(0, Math.min(h - 1, c.y - radius * Math.sin(ang))) });
                    next.push({ x: Math.max(0, Math.min(w - 1, c.x + radius * Math.cos(ang))), y: Math.max(0, Math.min(h - 1, c.y + radius * Math.sin(ang))) });
                }
            }
            if (next.length < 2) break;
            // Backstop: trim any residual overshoot from the last iteration's
            // trailing splits (the per-cell check above can only over/undershoot
            // by ~1 cell, but this keeps the bound exact and independent of it).
            if (next.length > HARD_CAP) next = next.slice(0, HARD_CAP);
            pts = next;
        }
        var tri2 = delaunayTriangulate(pts);
        cells = voronoiCellsFromDelaunay(pts, tri2, w, h);
        return { points: pts, cells: cells };
    }
    // Grid (real, direct port of drawingbot.k.e.c.a.g): regular rows/columns
    // by Cell Width/Height (optionally square-locked), optional hex-stagger
    // (odd rows offset by half a cell), optional positional noise, radius
    // scaled by local darkness.
    function sampleGridPoints(weightMap, w, h, opts) {
        var cw = Math.max(1, opts.cellWidth), ch = opts.square ? cw : Math.max(1, opts.cellHeight);
        var columns = Math.max(1, Math.floor((w - 1) / cw)), rows = Math.max(1, Math.floor((h - 1) / ch));
        var offsetX = (w - 1 - (columns - 1) * cw) / 2, offsetY = (h - 1 - (rows - 1) * ch) / 2;
        var maxR = Math.max(cw, ch) / 2 * opts.radiusScale;
        var pts = [];
        for (var y = 0; y < rows; y++) {
            for (var x = 0; x < columns; x++) {
                var xPos = offsetX + x * cw, yPos = offsetY + y * ch;
                if (opts.stagger) { xPos += (y % 2 === 0) ? 0 : cw / 2; if (y % 2 !== 0 && x === columns - 1) continue; }
                if (opts.noise > 0) { xPos += (Math.random() - 0.5) * opts.noise; yPos += (Math.random() - 0.5) * opts.noise; }
                var xi = Math.max(0, Math.min(w - 1, xPos | 0)), yi = Math.max(0, Math.min(h - 1, yPos | 0));
                var dens = weightMap[yi * w + xi] || 0;
                if (dens <= 0.02) continue;
                pts.push({ x: xPos, y: yPos, r: maxR * dens });
            }
        }
        return { points: pts, cells: null };
    }

    // ---- Shared encoders (real, direct ports of drawingbot.k.e.c.b.*) -----
    function encodeShapesPolylines(points, radii, shapeType) {
        var out = [];
        for (var i = 0; i < points.length; i++) {
            var p = points[i], r = radii[i];
            if (!(r > 0)) continue;
            if (shapeType === 'square') out.push([{ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y - r }, { x: p.x + r, y: p.y + r }, { x: p.x - r, y: p.y + r }, { x: p.x - r, y: p.y - r }]);
            else if (shapeType === 'triangle') { var a0 = -Math.PI / 2, tri = []; for (var k = 0; k <= 3; k++) { var a = a0 + (k % 3) * (Math.PI * 2 / 3); tri.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r }); } out.push(tri); }
            else if (shapeType === 'cross') { out.push([{ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }]); out.push([{ x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }]); }
            else { var pts = [], segs = 14; for (var s = 0; s <= segs; s++) { var a2 = (s / segs) * Math.PI * 2; pts.push({ x: p.x + Math.cos(a2) * r, y: p.y + Math.sin(a2) * r }); } out.push(pts); }
        }
        return out;
    }
    function encodeStipplingPolylines(points, dotRadius) {
        var out = [];
        for (var i = 0; i < points.length; i++) {
            var p = points[i], r = dotRadius;
            out.push([{ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y - r }, { x: p.x + r, y: p.y + r }, { x: p.x - r, y: p.y + r }, { x: p.x - r, y: p.y - r }]);
        }
        return out;
    }
    function encodeDashesPolylines(points, radii, weightMap, w, h, alignToEdge, minRotDeg, maxRotDeg, distortion01) {
        var out = [];
        function lumAt(x, y) { var xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 255; return 255 * (1 - (weightMap[yi * w + xi] || 0)); }
        for (var i = 0; i < points.length; i++) {
            var p = points[i], r = Math.max(1, radii[i]), bestAngle;
            if (alignToEdge) {
                var samples = 16, lowestVar = Infinity, bestA = 0;
                for (var s = 0; s < samples; s++) {
                    var ang = s * Math.PI / samples;
                    var v = Math.abs(lumAt(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r) - lumAt(p.x - Math.cos(ang) * r, p.y - Math.sin(ang) * r));
                    if (v <= lowestVar) { lowestVar = v; bestA = ang; }
                }
                bestAngle = bestA;
            } else bestAngle = (minRotDeg + Math.random() * (maxRotDeg - minRotDeg)) * Math.PI / 180;
            var length = (1 - lumAt(p.x, p.y) / 255) * (r * 2);
            var x1 = p.x + Math.cos(bestAngle) * length / 2, y1 = p.y + Math.sin(bestAngle) * length / 2;
            var x2 = p.x - Math.cos(bestAngle) * length / 2, y2 = p.y - Math.sin(bestAngle) * length / 2;
            if (distortion01 > 0) {
                var adj = bestAngle + Math.PI / 2, nOff = (Math.random() * 2 - 1) * r * distortion01;
                out.push(catmullRomResampleT([{ x: x1, y: y1 }, { x: x1 + Math.cos(adj) * nOff, y: y1 + Math.sin(adj) * nOff }, { x: x2 + Math.cos(adj) * nOff, y: y2 + Math.sin(adj) * nOff }, { x: x2, y: y2 }], 3, 0));
            } else out.push([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
        }
        return out;
    }
    function encodeTriangulationPolylines(points, w, h, closeBorder) {
        var pts = points.slice();
        if (closeBorder) pts = pts.concat([{ x: 0, y: 0 }, { x: 0, y: h - 1 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }]);
        var tri = delaunayTriangulate(pts), seen = {}, out = [];
        for (var i = 0; i < tri.length; i++) {
            var t = tri[i], edges = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
            for (var e = 0; e < 3; e++) {
                var a = edges[e][0], b = edges[e][1], key = Math.min(a, b) + '_' + Math.max(a, b);
                if (seen[key]) continue;
                seen[key] = 1;
                out.push([{ x: pts[a].x, y: pts[a].y }, { x: pts[b].x, y: pts[b].y }]);
            }
        }
        return out;
    }
    function encodeTreePolylines(points) {
        var edges = minimumSpanningTree(points), out = [];
        for (var i = 0; i < edges.length; i++) { var a = points[edges[i][0]], b = points[edges[i][1]]; out.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]); }
        return out;
    }
    function encodeDiagramPolylines(cells) {
        var out = [];
        if (!cells) return out;
        for (var i = 0; i < cells.length; i++) { var poly = cells[i]; if (!poly || poly.length < 3) continue; out.push(poly.concat([poly[0]])); }
        return out;
    }
    function encodeTSPPolyline(points, maxOptPoints) {
        if (points.length < 2) return [];
        var tour = nearestNeighborTour(points);
        if (points.length <= maxOptPoints) tour = twoOptImprove(tour, points, 6);
        return [tour.map(function (i) { return { x: points[i].x, y: points[i].y }; })];
    }
    function renderPointFamily(sampled, weightMap, w, h, opts) {
        var points = sampled.points, cells = sampled.cells;
        if (!points.length) return [];
        var radii = new Array(points.length);
        for (var ri = 0; ri < points.length; ri++) {
            var p = points[ri];
            if (p.r != null) { radii[ri] = p.r; continue; }
            var xi = Math.max(0, Math.min(w - 1, p.x | 0)), yi = Math.max(0, Math.min(h - 1, p.y | 0));
            radii[ri] = opts.radiusMin + (opts.radiusMax - opts.radiusMin) * (weightMap[yi * w + xi] || 0);
        }
        switch (opts.encoder) {
            case 'triangulation': return encodeTriangulationPolylines(points, w, h, opts.closeBorder);
            case 'tree': return encodeTreePolylines(points);
            case 'stippling': return encodeStipplingPolylines(points, opts.dotRadius);
            case 'dashes': return encodeDashesPolylines(points, radii, weightMap, w, h, opts.dashAlignEdge, opts.dashMinRotation, opts.dashMaxRotation, opts.dashDistortion);
            case 'diagram': {
                var cellsForDiagram = cells;
                if (!cellsForDiagram) { var tri = delaunayTriangulate(points); cellsForDiagram = voronoiCellsFromDelaunay(points, tri, w, h); }
                return encodeDiagramPolylines(cellsForDiagram);
            }
            case 'tsp': return encodeTSPPolyline(points, opts.tspMaxOptPoints || 350);
            default: return encodeShapesPolylines(points, radii, opts.shapeType);
        }
    }
    function traceVoronoiFamily(weightMap, w, h, opts) {
        var sampled = sampleVoronoiPoints(weightMap, w, h, opts);
        return renderPointFamily(sampled, weightMap, w, h, opts);
    }
    function traceAdaptiveFamily(weightMap, w, h, opts) {
        var sampled = sampleAdaptiveDisks(weightMap, w, h, opts);
        return renderPointFamily(sampled, weightMap, w, h, opts);
    }
    function traceLBGFamily(weightMap, w, h, opts) {
        var sampled = sampleLBGPoints(weightMap, w, h, opts);
        return renderPointFamily(sampled, weightMap, w, h, opts);
    }
    function traceGridFamily(weightMap, w, h, opts) {
        var sampled = sampleGridPoints(weightMap, w, h, opts);
        return renderPointFamily(sampled, weightMap, w, h, opts);
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

                // DBV3 builds Edge/Sobel/variance data once from the working
                // image's structure, shared by every pen -- not per-channel.
                var sketchEdgeMap = null, sketchSobelMap = null, sketchVarianceMap = null;
                if (mode === 'sketch') {
                    sketchSobelMap = computeSobelMagnitudeMap(field.gx, field.gy, workW, workH);
                    sketchEdgeMap = computeEdgeMap(sketchSobelMap, workW, workH);
                    sketchVarianceMap = computeLocalVarianceMap(lum, workW, workH);
                }

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
                        result[pens[i]] = traceVoronoiFamily(wMap, workW, workH, {
                            pointCount: Math.max(10, PARAMS.pointLimit), maxPoints: Math.max(10, PARAMS.pointLimit),
                            densityPower: Math.max(0.5, PARAMS.luminancePower), iterations: Math.max(0, PARAMS.voronoiIterations),
                            accuracy: Math.max(0.05, Math.min(1, PARAMS.voronoiAccuracy)),
                            radiusMin: Math.max(0.1, PARAMS.stippleRadiusMin), radiusMax: Math.max(PARAMS.stippleRadiusMin, PARAMS.stippleRadiusMax),
                            encoder: PARAMS.pointEncoder, shapeType: PARAMS.pointShapeType,
                            closeBorder: PARAMS.triangulationCloseBorder === 'on', dotRadius: Math.max(0.1, PARAMS.stipplingDotRadius),
                            dashAlignEdge: PARAMS.dashAlignToEdge === 'on', dashMinRotation: Number(PARAMS.dashMinRotation) || 0,
                            dashMaxRotation: Number(PARAMS.dashMaxRotation) || 180,
                            dashDistortion: Math.max(0, Math.min(1, (Number(PARAMS.dashDistortion) || 0) / 100)),
                            tspMaxOptPoints: Math.max(10, PARAMS.tspMaxOptPoints)
                        });
                    } else if (mode === 'grid') {
                        result[pens[i]] = traceGridFamily(wMap, workW, workH, {
                            cellWidth: Math.max(1, PARAMS.gridCellWidth), cellHeight: Math.max(1, PARAMS.gridCellHeight),
                            square: PARAMS.gridSquare === 'on', stagger: PARAMS.gridStagger === 'on',
                            noise: Math.max(0, PARAMS.gridNoise), radiusScale: Math.max(0.05, PARAMS.gridRadiusScale),
                            radiusMin: 0.5, radiusMax: Math.max(1, PARAMS.gridCellWidth) / 2,
                            encoder: PARAMS.pointEncoder, shapeType: PARAMS.pointShapeType,
                            closeBorder: PARAMS.triangulationCloseBorder === 'on', dotRadius: Math.max(0.1, PARAMS.stipplingDotRadius),
                            dashAlignEdge: PARAMS.dashAlignToEdge === 'on', dashMinRotation: Number(PARAMS.dashMinRotation) || 0,
                            dashMaxRotation: Number(PARAMS.dashMaxRotation) || 180,
                            dashDistortion: Math.max(0, Math.min(1, (Number(PARAMS.dashDistortion) || 0) / 100)),
                            tspMaxOptPoints: Math.max(10, PARAMS.tspMaxOptPoints)
                        });
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
                    } else if (mode === 'lbg') {
                        result[pens[i]] = traceLBGFamily(wMap, workW, workH, {
                            pointCount: Math.max(10, PARAMS.pointLimit), maxPoints: Math.max(10, PARAMS.pointLimit),
                            iterations: Math.max(1, PARAMS.voronoiIterations), accuracy: Math.max(0.05, Math.min(1, PARAMS.voronoiAccuracy)),
                            minDiameter: Math.max(0.5, PARAMS.lbgMinDiameter), maxDiameter: Math.max(PARAMS.lbgMinDiameter, PARAMS.lbgMaxDiameter),
                            densityBlend: Math.max(0, Math.min(1, PARAMS.lbgDensityBlend)),
                            hysteresis: Math.max(0, PARAMS.lbgHysteresis), hysteresisGrowth: Math.max(0, PARAMS.lbgHysteresisGrowth),
                            radiusMin: Math.max(0.1, PARAMS.stippleRadiusMin), radiusMax: Math.max(PARAMS.stippleRadiusMin, PARAMS.stippleRadiusMax),
                            encoder: PARAMS.pointEncoder, shapeType: PARAMS.pointShapeType,
                            closeBorder: PARAMS.triangulationCloseBorder === 'on', dotRadius: Math.max(0.1, PARAMS.stipplingDotRadius),
                            dashAlignEdge: PARAMS.dashAlignToEdge === 'on', dashMinRotation: Number(PARAMS.dashMinRotation) || 0,
                            dashMaxRotation: Number(PARAMS.dashMaxRotation) || 180,
                            dashDistortion: Math.max(0, Math.min(1, (Number(PARAMS.dashDistortion) || 0) / 100)),
                            tspMaxOptPoints: Math.max(10, PARAMS.tspMaxOptPoints)
                        });
                    } else if (mode === 'adaptive') {
                        result[pens[i]] = traceAdaptiveFamily(wMap, workW, workH, {
                            minRadius: Math.max(0.5, PARAMS.minSampleRadius), maxRadius: Math.max(PARAMS.minSampleRadius + 0.5, PARAMS.maxSampleRadius),
                            maxPoints: Math.max(10, PARAMS.adaptiveMaxPoints),
                            radiusMin: Math.max(0.5, PARAMS.minSampleRadius), radiusMax: Math.max(PARAMS.minSampleRadius + 0.5, PARAMS.maxSampleRadius),
                            encoder: PARAMS.pointEncoder, shapeType: PARAMS.pointShapeType,
                            closeBorder: PARAMS.triangulationCloseBorder === 'on', dotRadius: Math.max(0.1, PARAMS.stipplingDotRadius),
                            dashAlignEdge: PARAMS.dashAlignToEdge === 'on', dashMinRotation: Number(PARAMS.dashMinRotation) || 0,
                            dashMaxRotation: Number(PARAMS.dashMaxRotation) || 180,
                            dashDistortion: Math.max(0, Math.min(1, (Number(PARAMS.dashDistortion) || 0) / 100)),
                            tspMaxOptPoints: Math.max(10, PARAMS.tspMaxOptPoints)
                        });
                    } else if (mode === 'sketch') {
                        var _waveDivX = Number(PARAMS.sketchWaveDivisorX) || 30;
                        var _waveDivY = Number(PARAMS.sketchWaveDivisorY) || 30;
                        if (Math.abs(_waveDivX) < 1) _waveDivX = _waveDivX < 0 ? -1 : 1;
                        if (Math.abs(_waveDivY) < 1) _waveDivY = _waveDivY < 0 ? -1 : 1;
                        // Real DBV3's 12 Sketch PFMs, 1:1 by name (see traceSketchReal
                        // for the per-mode angle-search + render logic).
                        var _sketchAngleModes = {
                            lines: 'lines', squares: 'squares', waves: 'waves', curves: 'curves',
                            sweepingcurves: 'sweeping', quadbeziers: 'quadbezier', cubicbeziers: 'cubicbezier',
                            catmullroms: 'catmullsearch', shapes: 'shapes', sobeledges: 'sobeledges',
                            flowfield: 'flowfield', superformula: 'superformula'
                        };
                        var sketchRaw = traceSketchReal(wMap, workW, workH, {
                            angleMode: _sketchAngleModes[PARAMS.sketchStyle] || 'lines',
                            squareStartAngle: Number(PARAMS.sketchSquareAngle) || 0,
                            startAngleMin: Number(PARAMS.sketchAngleMin) || -180, startAngleMax: Number(PARAMS.sketchAngleMax) || 180,
                            waveStartAngle: Number(PARAMS.sketchWaveStartAngle) || 0,
                            waveOffsetX: Number(PARAMS.sketchWaveOffsetX) || 0, waveOffsetY: Number(PARAMS.sketchWaveOffsetY) || 0,
                            waveDivisorX: _waveDivX, waveDivisorY: _waveDivY,
                            waveTypeX: PARAMS.sketchWaveTypeX || 'sin', waveTypeY: PARAMS.sketchWaveTypeY || 'cos',
                            minLineLength: Math.max(1, PARAMS.sketchMinLineLength), maxLineLength: Math.max(2, PARAMS.sketchMaxLineLength),
                            lineTests: Math.max(1, PARAMS.sketchLineTests), squiggleMaxLength: Math.max(1, PARAMS.sketchSquiggleMax),
                            radiusMin: Math.max(0.5, PARAMS.sketchEraseRadiusMin), radiusMax: Math.max(0.5, PARAMS.sketchEraseRadiusMax),
                            eraseMin: Math.max(0, Math.min(1, PARAMS.sketchEraseMin / 100)), eraseMax: Math.max(0, Math.min(1, PARAMS.sketchEraseMax / 100)),
                            eraseTone: Math.max(0, Math.min(1, PARAMS.sketchTone / 100)),
                            // Real DBV3 "Style" scorer settings (see STYLE_MODES in traceSketchReal)
                            clarity: Math.max(0, Math.min(1, (Number(PARAMS.sketchClarity) || 0) / 100)),
                            luminancePower: Math.max(0, Math.min(1, (Number(PARAMS.sketchLuminancePower) || 0) / 100)),
                            directionality: Math.max(0, Math.min(1, (Number(PARAMS.sketchDirectionality) || 0) / 100)),
                            distortion: Math.max(0, Math.min(1, (Number(PARAMS.sketchDistortion) || 0) / 100)),
                            angularity: Math.max(0, Math.min(1, (Number(PARAMS.sketchAngularity) || 0) / 100)),
                            edgePower: Math.max(0, Math.min(1, (Number(PARAMS.sketchEdgePower) || 0) / 100)),
                            sobelPower: Math.max(0, Math.min(1, (Number(PARAMS.sketchSobelPower) || 0) / 100)),
                            seedType: PARAMS.sketchSeedType || 'none',
                            seedThreshold: Math.max(0, Math.min(1, (Number(PARAMS.sketchSeedThreshold) || 0) / 100)),
                            edgeMap: sketchEdgeMap, sobelMap: sketchSobelMap, varianceMap: sketchVarianceMap,
                            // Curves / Sweeping / Catmull-Roms / Flow Field / Superformula
                            curveTension: Math.max(0, Math.min(1, (Number(PARAMS.sketchCurveTension) || 0) / 100)),
                            // Shapes
                            shapeEllipse: PARAMS.sketchShapeType === 'ellipse',
                            // Flow Field
                            flowStartAngleRad: (Number(PARAMS.sketchFlowStartAngle) || 0) * Math.PI / 180,
                            flowFreqX: Math.max(0.001, (Number(PARAMS.sketchFlowFreqX) || 1) * 0.01), flowFreqY: Math.max(0.001, (Number(PARAMS.sketchFlowFreqY) || 1) * 0.01),
                            flowAmplitude01: Math.max(0, Math.min(1, (Number(PARAMS.sketchFlowAmplitude) || 100) / 100)),
                            // Superformula
                            sfCenterX: workW * Math.max(0, Math.min(1, (Number(PARAMS.sketchSfCenterX) || 50) / 100)),
                            sfCenterY: workH * Math.max(0, Math.min(1, (Number(PARAMS.sketchSfCenterY) || 50) / 100)),
                            sfStartAngleRad: (Number(PARAMS.sketchSfStartAngle) || 0) * Math.PI / 180,
                            sfFrequency: Math.max(1, Number(PARAMS.sketchSfFrequency) || 5),
                            sfCosFactor: Math.max(0.1, Number(PARAMS.sketchSfCosFactor) || 2), sfSineFactor: Math.max(0.1, Number(PARAMS.sketchSfSineFactor) || 2),
                            sfCurvature: Math.max(0.1, Number(PARAMS.sketchSfCurvature) || 2)
                        });
                        result[pens[i]] = applySketchStyle(sketchRaw);
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
        presetAnchorByFamily: { param: 'mode', map: { sketch: 'sketchStyle', streamlines: 'fieldType', spiral: 'spiralStyle', hatch: 'hatchStyle', stipple: 'pointEncoder', adaptive: 'pointEncoder', lbg: 'pointEncoder', grid: 'pointEncoder' } },
        // Presets are scoped to a single Path Finding Module (family + its
        // active sub-style), matching DBV3's own UI where the Presets
        // dropdown only ever shows presets belonging to the currently
        // selected module -- NOT a flat global list. `scope` mirrors the
        // `visibleWhen` shape already used for params: every condition must
        // match the CURRENT value for the preset to appear.
        stylePresets: [
            // Streamlines Edge Field / Flow Field / Superformula presets
            // below (Digital Detail, Fingerprints, Turbulence, Raindrops,
            // etc.): CORRECTION this pass -- these were previously
            // attributed to "presets/streamlines_pfm_defaults.json in the
            // installed app". Having now cloned and searched the actual
            // public DBV3 source (github.com/SonarSonic/DrawingBotV3), that
            // file does not exist anywhere in it -- Streamlines has zero
            // public presence at all (100% Premium, no bundled preset JSON
            // ships in the free build). So that citation could not be
            // verified this pass; if these values came from the user's own
            // real installed Premium app's resources in an earlier session
            // that's a legitimate source I don't have access to here, but as
            // written the citation overclaims. Treat these preset VALUES as
            // (approx) until re-verified against the actual installed app;
            // the SETTING NAMES/ranges/behaviour they use (Edge Power, ETF
            // Iterations/Radius, Post Blur, flow Frequency/Amplitude,
            // Superformula Cos/Sine Factor/Curvature) are real, confirmed
            // against docs/source/pfms.rst this pass. Max Length here is
            // DBV3's own real length unit (not steps), so it's converted to
            // this tracer's maxSteps proportionally against Digital
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
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['curves'] }],
              values: { sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 20, sketchMaxLineLength: 80, sketchLineTests: 16, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 1, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 50, sketchCurveTension: 0 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['sweepingcurves'] }],
              values: { sketchMinLineLength: 12, sketchMaxLineLength: 50, sketchLineTests: 16, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 2, sketchEraseMin: 30, sketchEraseMax: 100, sketchTone: 50, sketchCurveTension: 0 } },
            { label: 'Rectangle (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['shapes'] }],
              values: { sketchShapeType: 'rectangle', sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 6, sketchMaxLineLength: 30, sketchLineTests: 16, sketchSquiggleMax: 40, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 3, sketchEraseMin: 20, sketchEraseMax: 100, sketchTone: 50 } },
            { label: 'Ellipse (v3)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['shapes'] }],
              values: { sketchShapeType: 'ellipse', sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 6, sketchMaxLineLength: 30, sketchLineTests: 16, sketchSquiggleMax: 40, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 3, sketchEraseMin: 20, sketchEraseMax: 100, sketchTone: 50 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['sobeledges'] }],
              values: { sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 8, sketchMaxLineLength: 40, sketchLineTests: 16, sketchSquiggleMax: 40, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 3, sketchEraseMin: 20, sketchEraseMax: 100, sketchTone: 50, sketchSobelPower: 60 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['quadbeziers'] }],
              values: { sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 10, sketchMaxLineLength: 50, sketchLineTests: 12, sketchSquiggleMax: 80, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 2, sketchEraseMin: 30, sketchEraseMax: 100, sketchTone: 50 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['cubicbeziers'] }],
              values: { sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 10, sketchMaxLineLength: 50, sketchLineTests: 12, sketchSquiggleMax: 80, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 2, sketchEraseMin: 30, sketchEraseMax: 100, sketchTone: 50 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['catmullroms'] }],
              values: { sketchAngleMin: -180, sketchAngleMax: 180, sketchMinLineLength: 8, sketchMaxLineLength: 40, sketchLineTests: 10, sketchSquiggleMax: 60, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 2, sketchEraseMin: 30, sketchEraseMax: 100, sketchTone: 50, sketchCurveTension: 0 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['flowfield'] }],
              values: { sketchFlowStartAngle: 0, sketchFlowFreqX: 1, sketchFlowFreqY: 1, sketchFlowAmplitude: 100, sketchMinLineLength: 8, sketchMaxLineLength: 30, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 2, sketchEraseMin: 40, sketchEraseMax: 100, sketchTone: 50, sketchCurveTension: 0 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              values: { sketchSfCenterX: 50, sketchSfCenterY: 50, sketchSfStartAngle: 0, sketchSfFrequency: 5, sketchSfCosFactor: 2, sketchSfSineFactor: 2, sketchSfCurvature: 2, sketchMinLineLength: 8, sketchMaxLineLength: 30, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 2, sketchEraseMin: 40, sketchEraseMax: 100, sketchTone: 50, sketchCurveTension: 0 } },
            { label: 'Default', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
              values: { sketchWaveStartAngle: 0, sketchWaveOffsetX: 0, sketchWaveOffsetY: 0, sketchWaveDivisorX: 20, sketchWaveDivisorY: 20, sketchWaveTypeX: 'sin', sketchWaveTypeY: 'cos', sketchMinLineLength: 2, sketchMaxLineLength: 40, sketchLineTests: 20, sketchSquiggleMax: 100, sketchEraseRadiusMin: 1, sketchEraseRadiusMax: 3, sketchEraseMin: 50, sketchEraseMax: 125, sketchTone: 100 } },
            { label: 'Distorted Waves (v3.1)', scope: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['waves'] }],
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
            // Voronoi/Adaptive/LBG/Grid presets are scoped by mode only, not
            // by pointEncoder -- unlike the old approximation, the real
            // sampling params (point count, radii, density power, diameter,
            // iterations/accuracy) are genuinely independent of which of the
            // 7 shared encoders renders the sampled points, matching real
            // DBV3's own architecture (see the engine's header comment).
            { label: 'Fine Voronoi (v3)', scope: [{ param: 'mode', values: ['stipple'] }],
              values: { colorMode: 'nearest', pointLimit: 1500, stippleRadiusMin: 0.25, stippleRadiusMax: 1.0, luminancePower: 3, voronoiIterations: 6, voronoiAccuracy: 0.6 } },
            { label: 'Bold Voronoi (v3)', scope: [{ param: 'mode', values: ['stipple'] }],
              values: { pointLimit: 500, stippleRadiusMin: 0.6, stippleRadiusMax: 2.2, luminancePower: 1.5, voronoiIterations: 3, voronoiAccuracy: 0.4 } },
            { label: 'Fine LBG (v3.1)', scope: [{ param: 'mode', values: ['lbg'] }],
              values: { colorMode: 'nearest', pointLimit: 2000, stippleRadiusMin: 0.25, stippleRadiusMax: 1.0, voronoiIterations: 10, voronoiAccuracy: 0.6, lbgMinDiameter: 1.5, lbgMaxDiameter: 14, lbgDensityBlend: 0.5, lbgHysteresis: 0.2, lbgHysteresisGrowth: 0.04 } },
            { label: 'Bold LBG (v3.1)', scope: [{ param: 'mode', values: ['lbg'] }],
              values: { pointLimit: 700, stippleRadiusMin: 0.6, stippleRadiusMax: 2.2, voronoiIterations: 8, voronoiAccuracy: 0.4, lbgMinDiameter: 4, lbgMaxDiameter: 30, lbgDensityBlend: 0.5, lbgHysteresis: 0.3, lbgHysteresisGrowth: 0.05 } },
            // Adaptive's real AIS disk-packing engine didn't survive
            // decompilation (see engine header comment -- Windows filesystem
            // case-collision), so this v3.1 Poisson-disc sampler's Min/Max
            // Sample Radius defaults are this tracer's own tuning, not a
            // verified port of DBV3's real adaptive_pfm_defaults.json values.
            { label: 'Fine Adaptive (v3.1)', scope: [{ param: 'mode', values: ['adaptive'] }],
              values: { minSampleRadius: 1, maxSampleRadius: 10, adaptiveMaxPoints: 2000 } },
            { label: 'Bold Adaptive (v3.1)', scope: [{ param: 'mode', values: ['adaptive'] }],
              values: { minSampleRadius: 3, maxSampleRadius: 30, adaptiveMaxPoints: 500 } },
            { label: 'Default (v3)', scope: [{ param: 'mode', values: ['grid'] }],
              values: { gridCellWidth: 12, gridCellHeight: 12, gridSquare: 'on', gridStagger: 'off', gridNoise: 0, gridRadiusScale: 0.8 } },
            { label: 'Fine Hex Grid (v3)', scope: [{ param: 'mode', values: ['grid'] }],
              values: { gridCellWidth: 6, gridCellHeight: 6, gridSquare: 'on', gridStagger: 'on', gridNoise: 0, gridRadiusScale: 0.9 } }
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
              tip: 'DrawingBotV3-style Path Finding Module family. Each has its own sub-style and settings below. Tags: (v3) = verified against real DBV3 source, (v3.1) = built from real DBV3 docs/settings or a real named algorithm DBV3 cites but independently implemented, (approx) = our own approximation with no verified DBV3 basis. Streamlines/Hatch/Voronoi/Adaptive/LBG are all closed-source Premium features in real DBV3 with zero public implementation anywhere, so (v3.1)/(approx) is the ceiling for them.',
              options: [
                { value: 'sketch', label: 'Sketch' },
                { value: 'streamlines', label: 'Streamlines' },
                { value: 'spiral', label: 'Spiral' },
                { value: 'hatch', label: 'Hatch' },
                { value: 'stipple', label: 'Voronoi / Stippling (v3)' },
                { value: 'adaptive', label: 'Adaptive (v3.1)' },
                { value: 'lbg', label: 'LBG (v3.1)' },
                { value: 'grid', label: 'Grid (v3)' }
              ] },
            { id: 'colorMode', label: 'Color mode', type: 'select', value: 'separate', group: 'color',
              tip: 'CMYK (approx) = the standard textbook RGB->CMYK conversion with full black generation (K=1-max(R,G,B)) — a well-known technique, but DBV3\'s own CMYK splitter is closed-source so this isn\'t verified against their exact code. Separate = linear deficit projection (every pen gets a density layer). Nearest = classify each region to one closest pen, no mixing.',
              options: [{ value: 'cmyk', label: 'CMYK separation (approx)' }, { value: 'separate', label: 'Separate (linear mix)' }, { value: 'nearest', label: 'Nearest pen (posterize)' }] },

            // -- Sketch -- all 12 real DBV3 Sketch PFMs, 1:1 by name (decompiled
            // drawingbot.k.e.d.{a,e,f,h,i,j,k,l,m,o,q,r,s,u}.java -- the full
            // Premium Sketch package). Lines/Squares/Curves/Quad+Cubic
            // Beziers/Catmull-Roms/Shapes/Sobel Edges/Sweeping Curves all
            // decompile to subclasses of one shared darkest-block-seed +
            // angle-tested-search + erase-as-you-draw engine (differing only
            // in candidate-angle strategy and/or rendered geometry, see
            // traceSketchReal); Waves/Flow Field/Superformula bypass that
            // engine entirely for a deterministic field direction.
            { id: 'sketchStyle', label: 'Sketch style', type: 'select', value: 'lines', group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3\'s 12 real Sketch PFMs. (v3) = direct port of the decompiled algorithm. (v3.1) = same real structure with one or more simplifications noted in that mode\'s own tips (e.g. Quad/Cubic Beziers pick direction first then search curve offsets, instead of DBV3\'s full nested search).',
              options: [
                { value: 'lines', label: 'Lines (v3)' }, { value: 'squares', label: 'Squares (v3)' },
                { value: 'waves', label: 'Waves (v3)' }, { value: 'curves', label: 'Curves (v3)' },
                { value: 'sweepingcurves', label: 'Sweeping Curves (v3)' },
                { value: 'shapes', label: 'Shapes (v3)' }, { value: 'sobeledges', label: 'Sobel Edges (v3.1)' },
                { value: 'quadbeziers', label: 'Quad Beziers (v3.1)' }, { value: 'cubicbeziers', label: 'Cubic Beziers (v3.1)' },
                { value: 'catmullroms', label: 'Catmull-Roms (v3.1)' },
                { value: 'flowfield', label: 'Flow Field (v3.1)' }, { value: 'superformula', label: 'Superformula (v3)' }
              ] },
            { id: 'sketchAngleMin', label: 'Start Angle Min', type: 'range', min: -360, max: 360, step: 5, value: -180, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Start Angle Min": lower bound of the random angle range tested at each step.' },
            { id: 'sketchAngleMax', label: 'Start Angle Max', type: 'range', min: -360, max: 360, step: 5, value: 180, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Start Angle Max": upper bound of the random angle range tested at each step.' },
            { id: 'sketchCurveTension', label: 'Curve Tension', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['curves', 'sweepingcurves', 'catmullroms', 'flowfield', 'superformula'] }],
              tip: 'DBV3 "Tension": 0 = the classic loose Catmull-Rom curve through traced points; higher pulls the curve tighter toward straight chords between them.' },
            { id: 'sketchShapeType', label: 'Shape', type: 'select', value: 'rectangle', group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['shapes'] }],
              tip: 'DBV3 "Shape" (Sketch Shapes): draws a Rectangle or Ellipse spanning each traced segment\'s bounding box instead of the segment itself.',
              options: [{ value: 'rectangle', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }] },
            { id: 'sketchFlowStartAngle', label: 'Start Angle', type: 'range', min: -180, max: 180, step: 1, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['flowfield'] }],
              tip: 'DBV3 "Start Angle" (Sketch Flow Field): base rotation added to the noise field\'s direction.' },
            { id: 'sketchFlowFreqX', label: 'X Frequency', type: 'range', min: 0.01, max: 4, step: 0.01, value: 1, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['flowfield'] }],
              tip: 'DBV3 "X Frequency": rate of change of the noise field on the X axis.' },
            { id: 'sketchFlowFreqY', label: 'Y Frequency', type: 'range', min: 0.01, max: 4, step: 0.01, value: 1, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['flowfield'] }],
              tip: 'DBV3 "Y Frequency": rate of change of the noise field on the Y axis.' },
            { id: 'sketchFlowAmplitude', label: 'Amplitude', type: 'range', min: 0, max: 100, step: 5, value: 100, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['flowfield'] }],
              tip: 'DBV3 "Amplitude": strength of the noise field\'s influence on direction.' },
            { id: 'sketchSfCenterX', label: 'Centre X (%)', type: 'range', min: 0, max: 100, step: 1, value: 50, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              tip: 'DBV3 "Centre X" (Sketch Superformula): horizontal position the radial field is centred on.' },
            { id: 'sketchSfCenterY', label: 'Centre Y (%)', type: 'range', min: 0, max: 100, step: 1, value: 50, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              tip: 'DBV3 "Centre Y": vertical position the radial field is centred on.' },
            { id: 'sketchSfStartAngle', label: 'Start Angle', type: 'range', min: -180, max: 180, step: 1, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              tip: 'DBV3 "Start Angle": base rotation added to the Superformula field\'s direction.' },
            { id: 'sketchSfFrequency', label: 'Frequency', type: 'range', min: 2, max: 20, step: 1, value: 5, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              tip: 'DBV3 "Frequency": number of radial arms/lobes in the Superformula pattern.' },
            { id: 'sketchSfCosFactor', label: 'Cos Factor', type: 'range', min: 0.1, max: 40, step: 0.1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              tip: 'DBV3 "Cos Factor": exponent on the cosine term of the Superformula equation.' },
            { id: 'sketchSfSineFactor', label: 'Sine Factor', type: 'range', min: 0.1, max: 40, step: 0.1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              tip: 'DBV3 "Sine Factor": exponent on the sine term of the Superformula equation.' },
            { id: 'sketchSfCurvature', label: 'Curvature', type: 'range', min: 0.1, max: 80, step: 0.1, value: 2, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['superformula'] }],
              tip: 'DBV3 "Curvature": overall root exponent controlling how sharp/pointed vs. rounded the Superformula lobes are.' },
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

            // -- Sketch "Style" settings -- shared scorer ported from DBV3's
            // real drawingbot.k.e.b.p engine. Only affect Lines/Curves (the
            // two styles that route through the weighted candidate scorer
            // in the real app); Squares/Waves are unaffected by design.
            { id: 'sketchLuminancePower', label: 'Luminance Power', type: 'range', min: 0, max: 100, step: 5, value: 100, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'sweepingcurves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Luminance Power": weight on local ink density when scoring candidate lines.' },
            { id: 'sketchDirectionality', label: 'Directionality', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'sweepingcurves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Directionality": weights local contrast/variance in the candidate score. Despite the name, it does not bias toward a flow direction.' },
            { id: 'sketchDistortion', label: 'Distortion', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'sweepingcurves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Distortion": injects weighted random noise into the candidate score for a rougher, less mechanical line.' },
            { id: 'sketchAngularity', label: 'Angularity', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'sweepingcurves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Angularity": penalizes sharp turns from the previous segment, favoring smoother continuations as it increases.' },
            { id: 'sketchEdgePower', label: 'Edge Power', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'sweepingcurves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Edge Power": weights a precomputed edge-strength map in the candidate score, pulling lines toward image edges.' },
            { id: 'sketchSobelPower', label: 'Sobel Power', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchStyle', values: ['lines', 'curves', 'sweepingcurves', 'quadbeziers', 'cubicbeziers', 'catmullroms', 'shapes', 'sobeledges'] }],
              tip: 'DBV3 "Sobel Power": weights a precomputed Sobel-magnitude map in the candidate score. Sobel Edges forces this on by default even at 0.' },
            { id: 'sketchClarity', label: 'Clarity', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Clarity": NOT an edge threshold -- this is unsharp-mask sharpening amount applied before tracing.' },
            { id: 'sketchSeedType', label: 'Seed Type', type: 'select', value: 'none', group: 'general',
              visibleWhen: { param: 'mode', values: ['sketch'] },
              tip: 'DBV3 "Seed Type": which map picks where the next squiggle starts. None = darkest remaining ink (default). Edges/Sobel = seed from those maps instead.',
              options: [{ value: 'none', label: 'None' }, { value: 'edges', label: 'Edges' }, { value: 'sobel', label: 'Sobel' }] },
            { id: 'sketchSeedThreshold', label: 'Seed Threshold', type: 'range', min: 0, max: 100, step: 5, value: 50, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['sketch'] }, { param: 'sketchSeedType', values: ['edges', 'sobel'] }],
              tip: 'DBV3 "Seed Threshold": cutoff applied to the Edges/Sobel seed map before it is used to pick the next squiggle start.' },

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
            { id: 'etfRadius', label: 'ETF Radius', type: 'range', min: 3, max: 12, step: 1, value: 3, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['streamlines'] }, { param: 'fieldType', values: ['edge'] }],
              tip: 'DBV3 "ETF Radius": kernel size used when refining the edge flow field. Real safe range is 3-30; capped to 12 here to bound cost on the Pi.' },
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
              tip: 'DBV3 "Spiral Type": Archimedean (even rings) or Parabolic (two connected branches) -- both byte-verified this pass against the real public PFMSpiralBasic.java. Circular Scribbles is NOT DBV3\'s real "Circular Scribbles" PFM (that\'s a totally different closed-source algorithm implementing Chiu et al. 2015\'s continuous rotating-loop scribble, with its own Radius/Velocity/Angular Velocity/Curvature settings) -- it\'s our own decorative doodle effect layered on the real spiral trace, kept under this name only because it produces a vaguely similar look.',
              options: [{ value: 'archimedean', label: 'Archimedean (v3)' }, { value: 'parabolic', label: 'Parabolic (v3)' }, { value: 'scribbles', label: 'Circular Scribbles (approx)' }] },
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
              tip: 'DBV3 has no standalone "Hatch" PFM -- only Hatch Sawtooth and Hatch Circular Scribbles are real, both Premium/closed-source. Straight = this tracer\'s own no-oscillation option, built on DBV3\'s real shared "Default Hatch Settings" (Line Spacing/Angle/Crosshatch/Link Ends). Sawtooth = real Amplitude+Velocity formulas (velocity varies by local luminance, same math as Spiral). Circular Scribbles is our decorative doodle stand-in, not DBV3\'s real (and very different) Chiu et al. algorithm.',
              options: [{ value: 'straight', label: 'Straight (v3.1)' }, { value: 'sawtooth', label: 'Sawtooth (v3.1)' }, { value: 'scribbles', label: 'Circular Scribbles (approx)' }] },
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

            // -- Voronoi / Adaptive / LBG / Grid: shared render encoder --
            // Real DBV3 builds all four families from one sampler+encoder
            // combinator (see the engine's header comment above traceVoronoiFamily
            // for full provenance) -- so one shared dropdown selects which of
            // the 7 ported encoders (drawingbot.k.e.c.b.*) renders whichever
            // family's sampled points, exactly like the real architecture.
            { id: 'pointEncoder', label: 'Render Style', type: 'select', value: 'shapes', group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] },
              tip: '(v3) Direct ports of DBV3\'s real shared encoders (drawingbot.k.e.c.b.{f,B,z,x,k,m}): Shapes/Triangulation/Tree/Stippling/Dashes/Diagram. TSP uses a real, standard nearest-neighbour + 2-opt solver (v3.1) rather than DBV3\'s own SuperPixel-based tour construction. Letters (font outlines) and Circular Scribbles (organic curve engine) are deliberately not implemented -- each is a substantial standalone feature, not something to fake under the real name.',
              options: [
                { value: 'shapes', label: 'Shapes (v3)' },
                { value: 'triangulation', label: 'Triangulation (v3)' },
                { value: 'tree', label: 'Tree / MST (v3)' },
                { value: 'stippling', label: 'Stippling (v3)' },
                { value: 'dashes', label: 'Dashes (v3)' },
                { value: 'diagram', label: 'Diagram (v3)' },
                { value: 'tsp', label: 'TSP (v3.1)' }
              ] },
            { id: 'pointShapeType', label: 'Shape', type: 'select', value: 'circle', group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['shapes'] }],
              tip: 'DBV3 real Shapes encoder\'s Shape Type: Circle/Square/Triangle/Cross, diameter driven by each point\'s local radius.',
              options: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'triangle', label: 'Triangle' }, { value: 'cross', label: 'Cross' }] },
            { id: 'triangulationCloseBorder', label: 'Close Border', type: 'select', value: 'off', group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['triangulation'] }],
              tip: 'DBV3 real Triangulation encoder option: adds the 4 canvas corners as extra points so triangles reach the edges.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'stipplingDotRadius', label: 'Dot Radius', type: 'range', min: 0.2, max: 4, step: 0.1, value: 0.8, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['stippling'] }],
              tip: 'DBV3 real Stippling encoder draws a FIXED-size dot at every point (not scaled by local radius, matching the real drawingbot.k.e.c.b.x behaviour) -- this sets that fixed size.' },
            { id: 'dashAlignToEdge', label: 'Align To Edges', type: 'select', value: 'on', group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['dashes'] }],
              tip: 'DBV3 real Dashes encoder: On scans 16 directions for the lowest local luminance-variance (edge-aligned dashes); Off picks a random angle within Min/Max Rotation instead.',
              options: [{ value: 'on', label: 'On (edge-aligned)' }, { value: 'off', label: 'Off (random rotation)' }] },
            { id: 'dashMinRotation', label: 'Min Rotation (deg)', type: 'range', min: -180, max: 180, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['dashes'] }],
              tip: 'DBV3 "Min Rotation": lower bound for random dash angle when Align To Edges is off.' },
            { id: 'dashMaxRotation', label: 'Max Rotation (deg)', type: 'range', min: -180, max: 180, step: 5, value: 180, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['dashes'] }],
              tip: 'DBV3 "Max Rotation": upper bound for random dash angle when Align To Edges is off.' },
            { id: 'dashDistortion', label: 'Dash Distortion (%)', type: 'range', min: 0, max: 100, step: 5, value: 0, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['dashes'] }],
              tip: 'DBV3 real Dashes encoder\'s optional bezier bow-distortion, applied as a Catmull-Rom bulge instead of the real cubic-bezier control points -- same idea, not a byte-identical curve.' },
            { id: 'tspMaxOptPoints', label: 'TSP 2-opt Point Cap', type: 'range', min: 20, max: 800, step: 10, value: 350, group: 'general',
              visibleWhen: [{ param: 'mode', values: ['stipple', 'adaptive', 'lbg', 'grid'] }, { param: 'pointEncoder', values: ['tsp'] }],
              tip: '(v3.1) Above this many points, 2-opt local search is skipped and only the nearest-neighbour tour is used, to keep the Pi responsive -- our own safety cap, not a real DBV3 setting.' },

            // -- Voronoi / Stippling (real, drawingbot.k.e.c.a.p) --
            { id: 'pointLimit', label: 'Point Limit', type: 'range', min: 50, max: 4000, step: 50, value: 800, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple', 'lbg'] },
              tip: 'DBV3 "Point Limit": target/maximum point count.' },
            { id: 'luminancePower', label: 'Density Power', type: 'range', min: 0.5, max: 6, step: 0.5, value: 2, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple'] },
              tip: '(v3) Real DBV3 "Density Power": the exact exponent from the decompiled rejection-sampling formula, (255-lum)^power / 255^(power-1) -- higher = point placement biased harder toward darker areas.' },
            { id: 'voronoiIterations', label: 'Voronoi / LBG Iterations', type: 'range', min: 0, max: 20, step: 1, value: 4, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple', 'lbg'] },
              tip: '(v3) Real DBV3 "Voronoi Iterations": Lloyd-relaxation passes (Voronoi) / split-merge passes (LBG), each rebuilding a real Voronoi diagram.' },
            { id: 'voronoiAccuracy', label: 'Voronoi Accuracy', type: 'range', min: 0.05, max: 1, step: 0.05, value: 0.5, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple', 'lbg'] },
              tip: '(v3) Real DBV3 "Voronoi Accuracy": pixel-scan step size for each cell\'s weighted centroid/mass -- higher = finer, slower.' },
            { id: 'stippleRadiusMin', label: 'Point Radius Min', type: 'range', min: 0.1, max: 3, step: 0.1, value: 0.4, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple', 'lbg'] },
              tip: 'DBV3 "Stipple Radius Min": point size in the lightest inked areas (Shapes/Triangulation-adjacent encoders).' },
            { id: 'stippleRadiusMax', label: 'Point Radius Max', type: 'range', min: 0.2, max: 6, step: 0.1, value: 1.4, group: 'general',
              visibleWhen: { param: 'mode', values: ['stipple', 'lbg'] },
              tip: 'DBV3 "Stipple Radius Max": point size in the densest inked areas.' },

            // -- LBG (real, drawingbot.k.e.c.a.k -- Linde-Buzo-Gray 1980) --
            { id: 'lbgMinDiameter', label: 'Min Cell Diameter', type: 'range', min: 0.5, max: 20, step: 0.5, value: 2, group: 'general',
              visibleWhen: { param: 'mode', values: ['lbg'] },
              tip: '(v3) Real DBV3 LBG "Min Cell Diameter": target cell size in the densest areas -- cells smaller than this merge away.' },
            { id: 'lbgMaxDiameter', label: 'Max Cell Diameter', type: 'range', min: 2, max: 80, step: 1, value: 20, group: 'general',
              visibleWhen: { param: 'mode', values: ['lbg'] },
              tip: '(v3) Real DBV3 LBG "Max Cell Diameter": target cell size in flat/light areas -- cells larger than this split in two.' },
            { id: 'lbgDensityBlend', label: 'Density Blend', type: 'range', min: 0, max: 1, step: 0.05, value: 0.5, group: 'general',
              visibleWhen: { param: 'mode', values: ['lbg'] },
              tip: '(v3.1) Real DBV3 LBG "Density Blend": blends an eased vs. linear response between local density and target diameter. The specific easing curve (drawingbot.e.b.a.i) wasn\'t recoverable from the decompile; this substitutes the standard ease-out-quad shape it almost certainly matches.' },
            { id: 'lbgHysteresis', label: 'Hysteresis', type: 'range', min: 0, max: 2, step: 0.05, value: 0.3, group: 'general',
              visibleWhen: { param: 'mode', values: ['lbg'] },
              tip: '(v3) Real DBV3 LBG "Hysteresis": widens the split/merge keep-band so cells near the threshold don\'t oscillate.' },
            { id: 'lbgHysteresisGrowth', label: 'Hysteresis Growth', type: 'range', min: 0, max: 1, step: 0.01, value: 0.05, group: 'general',
              visibleWhen: { param: 'mode', values: ['lbg'] },
              tip: '(v3) Real DBV3 LBG "Hysteresis Growth": widens Hysteresis further each iteration so the point count converges.' },

            // -- Adaptive (v3.1 -- real AIS disk-packer unrecoverable, see
            // engine header comment: a Windows case-insensitive-filesystem
            // collision clobbered drawingbot.k.e.b.a during decompilation).
            // This is an honest from-scratch Poisson-disc packer, not a port.
            { id: 'minSampleRadius', label: 'Min Sample Radius', type: 'range', min: 1, max: 40, step: 1, value: 4, group: 'general',
              visibleWhen: { param: 'mode', values: ['adaptive'] },
              tip: '(v3.1) Smallest disk radius, placed in the densest areas -- controls fine detail retention.' },
            { id: 'maxSampleRadius', label: 'Max Sample Radius', type: 'range', min: 2, max: 80, step: 1, value: 24, group: 'general',
              visibleWhen: { param: 'mode', values: ['adaptive'] },
              tip: '(v3.1) Largest disk radius, placed in flat/light areas.' },
            { id: 'adaptiveMaxPoints', label: 'Max Points', type: 'range', min: 100, max: 2500, step: 50, value: 1200, group: 'general',
              visibleWhen: { param: 'mode', values: ['adaptive'] },
              tip: 'Hard cap on placed disks, independent of image content, so a dense photo can\'t hang the Pi.' },

            // -- Grid (real, direct port of drawingbot.k.e.c.a.g) --
            { id: 'gridCellWidth', label: 'Cell Width', type: 'range', min: 2, max: 80, step: 1, value: 12, group: 'general',
              visibleWhen: { param: 'mode', values: ['grid'] },
              tip: '(v3) Real DBV3 Grid "Cell Width": column spacing of the regular grid.' },
            { id: 'gridCellHeight', label: 'Cell Height', type: 'range', min: 2, max: 80, step: 1, value: 12, group: 'general',
              visibleWhen: { param: 'mode', values: ['grid'] },
              tip: '(v3) Real DBV3 Grid "Cell Height": row spacing of the regular grid. Ignored while Square is on.' },
            { id: 'gridSquare', label: 'Square', type: 'select', value: 'on', group: 'general',
              visibleWhen: { param: 'mode', values: ['grid'] },
              tip: '(v3) Real DBV3 Grid "Square": locks Cell Height to Cell Width for a uniform square grid.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'gridStagger', label: 'Stagger', type: 'select', value: 'off', group: 'general',
              visibleWhen: { param: 'mode', values: ['grid'] },
              tip: '(v3) Real DBV3 Grid "Stagger": offsets alternate rows by half a cell width for a hex-like layout.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
            { id: 'gridNoise', label: 'Noise', type: 'range', min: 0, max: 20, step: 0.5, value: 0, group: 'general',
              visibleWhen: { param: 'mode', values: ['grid'] },
              tip: '(v3) Real DBV3 Grid "Noise": random per-point positional jitter, in pixels.' },
            { id: 'gridRadiusScale', label: 'Radius Scale', type: 'range', min: 0.1, max: 2, step: 0.05, value: 0.8, group: 'general',
              visibleWhen: { param: 'mode', values: ['grid'] },
              tip: 'Scales each point\'s radius (half the max cell dimension, times local darkness) before the render encoder draws it.' },

            { id: 'ignoreWhite', label: 'Ignore White', type: 'select', value: 'off', group: 'general',
              visibleWhen: { param: 'mode', values: ['spiral'] },
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
                      'sketchCurveTension', 'sketchFlowStartAngle', 'sketchFlowFreqX', 'sketchFlowFreqY', 'sketchFlowAmplitude',
                      'sketchSfCenterX', 'sketchSfCenterY', 'sketchSfStartAngle', 'sketchSfFrequency', 'sketchSfCosFactor', 'sketchSfSineFactor', 'sketchSfCurvature',
                      'spiralSize', 'spiralCentreX', 'spiralCentreY',
                      'ringSpacing', 'spiralAmplitude', 'spiralVelocityMin', 'spiralVelocityMax',
                      'hatchSpacing', 'hatchAngle', 'hatchAmplitude', 'hatchVelocityMin', 'hatchVelocityMax',
                      'pointLimit', 'stippleRadiusMin', 'stippleRadiusMax', 'luminancePower', 'voronoiIterations', 'voronoiAccuracy',
                      'minSampleRadius', 'maxSampleRadius', 'adaptiveMaxPoints', 'adaptiveBrightness', 'adaptiveContrast',
                      'lbgMinDiameter', 'lbgMaxDiameter', 'lbgDensityBlend', 'lbgHysteresis', 'lbgHysteresisGrowth',
                      'gridCellWidth', 'gridCellHeight', 'gridNoise', 'gridRadiusScale',
                      'stipplingDotRadius', 'dashMinRotation', 'dashMaxRotation', 'dashDistortion', 'tspMaxOptPoints',
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
