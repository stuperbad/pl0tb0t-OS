window.sketches = window.sketches || {};
window.sketches['cmyk'] = function(p) {

    var paper = window.makeSketchUtils;

    var PARAMS = {
        paperSize:  '9x12',
        margin:     1,
        shape:      'polygon',
        vertexCount: 4,
        filletPct:  0,
        fillMode:   'lines',
        viewMode:   'normal',
        fieldSeed:  1,
        shapeSeed:  1,
        colorSeed:  1,
        circleSize: 50,
        paddingMm:  2,
        borderRotation: 0,
        borderField: 'off',
        lineRotation: 0,
        lineField: 'on',
        fieldRelation: 'same',
        shapeAspect: 100,
        overlap: 0,
        starPoints: 5,
        composition: 50,
        penWidthMm: 0.4,
        noiseScale: 0.10,
        lineNoiseScale: 0.10,
        gradAngle:  0,
        density:    100,   // % of the reference pen width; 100 = lines exactly one pen-width apart
        startColor: '#ff6600',
        endColor:   '#0066cc',
        palette: ['#00ffff', '#ff00ff', '#ffff00', '#000000'],
        viewMode: 'multiply'
    };

    // Old recipes/queued jobs may carry one of the pre-consolidation shape ids
    // (each shape option used to be its own dropdown entry -- squares,
    // rectangles, rounded squares, circles, ovals, triangles, pentagons,
    // hexagons). They're all just a regular polygon at a given vertex count
    // and fillet %, so map them onto that instead of breaking/defaulting.
    var LEGACY_SHAPE_MAP = {
        boxes:      { vertexCount: 4,  filletPct: 0 },
        rectangle:  { vertexCount: 4,  filletPct: 0 },
        roundRect:  { vertexCount: 4,  filletPct: 50 },
        circles:    { vertexCount: 24, filletPct: 100 },
        oval:       { vertexCount: 24, filletPct: 100 },
        triangle:   { vertexCount: 3,  filletPct: 0 },
        pentagon:   { vertexCount: 5,  filletPct: 0 },
        hexagon:    { vertexCount: 6,  filletPct: 0 }
    };

    // Normalize hex color to [0-1] per-channel RGB array
    function hexToRgbN(hex) {
        return [
            parseInt(hex.slice(1,3),16) / 255,
            parseInt(hex.slice(3,5),16) / 255,
            parseInt(hex.slice(5,7),16) / 255
        ];
    }

    // Lerp two hex colors in RGB space
    function lerpHex(a, b, t) {
        var ac = hexToRgbN(a), bc = hexToRgbN(b);
        return '#' + [0,1,2].map(function(i){
            var v = Math.round((ac[i] + (bc[i]-ac[i]) * t) * 255).toString(16);
            return v.length === 1 ? '0'+v : v;
        }).join('');
    }

    // Decompose a target hex color into weights for each palette color.
    // Each weight = 1 / (rgb_distance + epsilon). epsilon=0.30 (in normalized [0-1] space)
    // gives good overlap: the closest ink dominates (~5x) but others still contribute.
    // For CMYK palette this approximates the original CMYK decomposition;
    // for any other palette the same distance math distributes the gradient similarly.
    function colorDecompose(targetHex) {
        var pal = PARAMS.palette;
        var target = hexToRgbN(targetHex);
        var weights = [], sum = 0, eps = 0.30;
        for (var i = 0; i < pal.length; i++) {
            var c = hexToRgbN(pal[i]);
            var d = Math.sqrt(
                (target[0]-c[0])*(target[0]-c[0]) +
                (target[1]-c[1])*(target[1]-c[1]) +
                (target[2]-c[2])*(target[2]-c[2])
            );
            var w = 1 / (d + eps);
            weights.push(w);
            sum += w;
        }
        if (sum > 0) for (var j = 0; j < weights.length; j++) weights[j] /= sum;
        return weights;
    }

    // At gradient position t (0–1), lerp between startColor and endColor then
    // decompose into palette ink weights. All palette colors overlap everywhere;
    // the gradient shifts which ink dominates.
    function paletteWeightsAt(t) {
        return colorDecompose(lerpHex(PARAMS.startColor, PARAMS.endColor, t));
    }

    function pickFromWeights(weights, rng) {
        var pal = PARAMS.palette;
        var r = rng ? rng() : Math.random();
        var cumul = 0;
        for (var i = 0; i < pal.length - 1; i++) {
            cumul += weights[i];
            if (r < cumul) return pal[i];
        }
        return pal[pal.length - 1];
    }

    var api = {
        hasPause: false,
        stylePresets: [
            { label: 'CMYK halftone', values: { shape:'polygon', vertexCount:24, filletPct:100, fillMode:'texture', viewMode:'multiply', composition:50, overlap:20, palette:['#00ffff','#ff00ff','#ffff00','#000000'] } },
            { label: 'Color-line boxes', values: { shape:'polygon', vertexCount:4, filletPct:0, fillMode:'lines', viewMode:'multiply', composition:50, overlap:0 } },
            { label: 'Woven rectangles', values: { shape:'polygon', vertexCount:4, filletPct:0, shapeAspect:35, overlap:60, fillMode:'lines', borderField:'on', lineField:'on', fieldRelation:'mirror' } },
            { label: 'Confetti blobs', values: { shape:'blob', fillMode:'lines', overlap:40, shapeAspect:75, composition:55 } },
            { label: 'Star scatter', values: { shape:'star', starPoints:5, fillMode:'lines', overlap:25 } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'shape', label: 'Shape', type: 'select', value: 'polygon',
              options: [
                { value: 'polygon', label: 'Polygon' },
                { value: 'star', label: 'Star' },
                { value: 'blob', label: 'Random blob' }
              ]},
            { id: 'vertexCount', label: 'Vertices', type: 'range', min: 3, max: 24, step: 1, value: 4,
              visibleWhen: { param: 'shape', values: ['polygon'] },
              tip: '3 = triangle, 4 = square, 5 = pentagon... higher counts approximate a circle, especially combined with a high Fillet %.' },
            { id: 'filletPct', label: 'Fillet %', type: 'range', min: 0, max: 100, step: 5, value: 0,
              visibleWhen: { param: 'shape', values: ['polygon'] },
              tip: '0 = sharp vertices. 100 = maximally rounded (each corner rounds out to its edges\' midpoints) -- combined with Aspect below 100%, this gives an oval instead of a circle.' },
            { id: 'viewMode', label: 'View mode', type: 'select', value: 'multiply', group: 'advanced',
              options: [
                { value: 'normal', label: 'Normal' },
                { value: 'multiply', label: 'Multiply' }
              ]},
            { id: 'fillMode', label: 'Fill mode', type: 'select', value: 'lines',
              options: [
                { value: 'lines', label: 'Color lines' },
                { value: 'texture', label: 'Ink screens' }
              ]},
            { id: 'circleSize', label: 'Shape size (px)', type: 'range', min: 15, max: 150, step: 5,  value: 50  },
            { id: 'composition', label: 'Composition', type: 'range', min: 0, max: 100, step: 1, value: 50 },
            { id: 'paddingMm', label: 'Padding (mm)', type: 'range', min: 0, max: 10, step: 0.1, value: 2,
              _toInternal: function(v){ return v; } },
            { id: 'borderRotation', label: 'Border rotation°', type: 'range', min: 0, max: 360, step: 5, value: 0, group: 'orientation' },
            { id: 'borderField', label: 'Border follows field', type: 'select', value: 'off', group: 'orientation',
              options: [ { value: 'off', label: 'Fixed' }, { value: 'on', label: 'Follow Perlin' } ] },
            { id: 'lineRotation', label: 'Line rotation°', type: 'range', min: 0, max: 360, step: 5, value: 0, group: 'orientation' },
            { id: 'lineField', label: 'Lines follow field', type: 'select', value: 'on', group: 'orientation',
              options: [ { value: 'off', label: 'Fixed' }, { value: 'on', label: 'Follow Perlin' } ] },
            { id: 'fieldRelation', label: 'Border/line fields', type: 'select', value: 'same', group: 'orientation',
              options: [ { value: 'same', label: 'Same' }, { value: 'mirror', label: 'Mirror' }, { value: 'unique', label: 'Unique' } ] },
            { id: 'shapeAspect', label: 'Aspect (short side %)', type: 'range', min: 20, max: 100, step: 5, value: 100 },
            { id: 'overlap', label: 'Overlap %', type: 'range', min: 0, max: 100, step: 5, value: 0 },
            { id: 'starPoints', label: 'Star points', type: 'range', min: 3, max: 9, step: 1, value: 5,
              visibleWhen: { param: 'shape', values: ['star'] } },
            { id: 'reseedFlow',   label: 'Reseed flow',   type: 'action', buttonLabel: '\u27f3 Flow' },
            { id: 'reseedShapes', label: 'Reseed shapes', type: 'action', buttonLabel: '\u27f3 Shapes' },
            { id: 'reseedColors', label: 'Reseed colors', type: 'action', buttonLabel: '\u27f3 Colors' },
            { id: 'penWidthMm', label: 'Pen width (mm)', type: 'range', min: 0.1, max: 2.0, step: 0.1, value: 0.4 },
            { id: 'noiseScale', label: 'Perlin scale', type: 'range', min: 1, max: 50, step: 1, value: 10, group: 'orientation',
              labelByValue: { param: 'fieldRelation', values: { unique: 'Border Perlin scale', default: 'Perlin scale' } } },
            { id: 'lineNoiseScale', label: 'Line Perlin scale', type: 'range', min: 1, max: 50, step: 1, value: 10, group: 'orientation',
              visibleWhen: { param: 'fieldRelation', values: ['unique'] } },
            { id: 'gradAngle',  label: 'Gradient angle°', type: 'range', min: 0,   max: 355, step: 5,   value: 0, group: 'general' },
            { id: 'density',    label: 'Density (%)', type: 'range', min: 20, max: 300, step: 5, value: 100,
              tip: '% of the loaded pen width. 100% = lines spaced exactly one pen-width apart (edge-to-edge, no gap/overlap). Above 100% lines overlap (denser); below spreads them out. Based on your palette’s thinnest loaded pen if widths are known, else the Pen width slider.' },
            { id: 'palette', label: 'Inks', type: 'colorPalette', maxSelect: 6, group: 'general',
              value: PARAMS.palette.slice(),
              options: [
                { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' },
                { value: '#ffff00', label: 'Yellow' },
                { value: '#000000', label: 'Black' },
                { value: '#e63946', label: 'Red' },
                { value: '#2196f3', label: 'Blue' },
                { value: '#ff9800', label: 'Orange' },
                { value: '#4caf50', label: 'Green' },
                { value: '#9c27b0', label: 'Purple' },
                { value: 'custom',  label: 'Custom' }
              ]},
            { id: 'startColor', label: 'Gradient start', type: 'color', value: '#ff6600', group: 'general' },
            { id: 'endColor',   label: 'Gradient end',   type: 'color', value: '#0066cc', group: 'general' }
        ]),
        regenerate: function() { resizeIfNeeded(); _updateHelp(); renderChunked(); },
        reseed: function() {
            PARAMS.fieldSeed = Math.floor(Math.random() * 1e6);
            PARAMS.shapeSeed = Math.floor(Math.random() * 1e6);
            PARAMS.colorSeed = Math.floor(Math.random() * 1e6);
            p.redraw();
        },
        getRecipe: function() {
            return { state: { fieldSeed: PARAMS.fieldSeed, shapeSeed: PARAMS.shapeSeed, colorSeed: PARAMS.colorSeed } };
        },
        applyRecipeState: function(state) {
            if (state && Number.isFinite(Number(state.fieldSeed))) {
                PARAMS.fieldSeed = Number(state.fieldSeed);
                if (Number.isFinite(Number(state.shapeSeed))) PARAMS.shapeSeed = Number(state.shapeSeed);
                if (Number.isFinite(Number(state.colorSeed))) PARAMS.colorSeed = Number(state.colorSeed);
                p.redraw();
            }
        },
        saveSVG: function() {
            var dims = paper.getPaperPixels(PARAMS.paperSize);
            var marginPx  = paper.getMarginPixels(PARAMS.margin);
            var paddingPx = paper.mmToPixels(PARAMS.paddingMm);
            var cellSize  = PARAMS.circleSize;
            var availW    = dims.width  - 2 * marginPx;
            var availH    = dims.height - 2 * marginPx;
            var grid      = resolveGrid(availW, availH, cellSize + paddingPx, PARAMS.composition);
            var cols      = grid.cols;
            var rows      = grid.rows;
            var contentW  = cols * cellSize + Math.max(0, cols - 1) * paddingPx;
            var contentH  = rows * cellSize + Math.max(0, rows - 1) * paddingPx;
            var offsetX   = marginPx + (availW - contentW) / 2;
            var offsetY   = marginPx + (availH - contentH) / 2;
            var strokeW   = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
            var gradRad   = p.radians(PARAMS.gradAngle);
            var gdx       = Math.cos(gradRad);
            var gdy       = Math.sin(gradRad);
            var pMin = Infinity;
            var pMax = -Infinity;
            var svgParts = [];
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || new Date().toISOString().replace(/[:.]/g,'-');
            var filename = '90percentart-cmyk-' + ts + '.svg';
            p.noiseSeed(PARAMS.fieldSeed);

            for (var ix = 0; ix < cols; ix++) {
                for (var jy = 0; jy < rows; jy++) {
                    var proj = (offsetX + (ix + 0.5) * cellSize) * gdx +
                               (offsetY + (jy + 0.5) * cellSize) * gdy;
                    if (proj < pMin) pMin = proj;
                    if (proj > pMax) pMax = proj;
                }
            }

            svgParts.push('<?xml version="1.0" encoding="UTF-8"?>');
            svgParts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + dims.width + '" height="' + dims.height + '" viewBox="0 0 ' + dims.width + ' ' + dims.height + '">');
            if (PARAMS.viewMode === 'multiply') svgParts.push('<g style="mix-blend-mode:multiply">');
            svgParts.push('<rect x="1" y="1" width="' + (dims.width - 2) + '" height="' + (dims.height - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');

            for (var i = 0; i < cols; i++) {
                for (var j = 0; j < rows; j++) {
                    var cx = offsetX + i * (cellSize + paddingPx) + cellSize / 2;
                    var cy = offsetY + j * (cellSize + paddingPx) + cellSize / 2;
                    var t  = (pMax > pMin) ? ((cx * gdx + cy * gdy) - pMin) / (pMax - pMin) : 0;
                    var weights = paletteWeightsAt(t);
                    var angle = p.noise(i * PARAMS.noiseScale, j * PARAMS.noiseScale) * p.TWO_PI;
                    var _o = cellOrient(i, j, cols, angle);
                    var rng   = makeRng(cellSeedWith(PARAMS.colorSeed, i, j));
                    var _shapeRng = makeRng(cellSeedWith(PARAMS.shapeSeed, i, j) ^ 0x51ED);
                    if (PARAMS.fillMode === 'texture') {
                        var _poly = buildCellPoly(cx, cy, cellSize, _o.shape, _shapeRng);
                        var _tsegs = cellTextureSegs(_poly, weights, _o.hatch, cellSize, cellSeedWith(PARAMS.shapeSeed, i, j));
                        for (var _ti = 0; _ti < _tsegs.length; _ti++) {
                            var _t = _tsegs[_ti];
                            appendSvgLine(svgParts, _t.x1, _t.y1, _t.x2, _t.y2, _t.color, strokeW);
                        }
                    } else {
                        var _rows = cellShapeRows(cx, cy, cellSize, _o.hatch, _o.shape, _shapeRng);
                        for (var _r = 0; _r < _rows.length; _r++) {
                            var _row = _rows[_r];
                            for (var _sx = 0; _sx < _row.length; _sx++) {
                                var _sg = _row[_sx];
                                appendSvgLine(svgParts, _sg.x1, _sg.y1, _sg.x2, _sg.y2, pickFromWeights(weights, rng), strokeW);
                            }
                        }
                    }
                }
            }

            if (PARAMS.viewMode === 'multiply') svgParts.push('</g>');
            svgParts.push('</svg>');
            downloadSvgString(svgParts.join('\n'), filename);
        },
        hideGlobalFillIds: ['fillAngle', 'fillDensity', 'fillProb', 'penLiftFills'],
        setParam: function(name, val) {
            var pdef = api.params.find(function(x){ return x.id === name; });
            if (pdef) pdef.value = val;
            if (name === 'paperSize')  { PARAMS.paperSize = val; resizeIfNeeded(); }
            if (name === 'margin')     PARAMS.margin     = Number(val);
            if (name === 'shape') {
                var _legacy = LEGACY_SHAPE_MAP[val];
                if (_legacy) {
                    PARAMS.shape = 'polygon';
                    PARAMS.vertexCount = _legacy.vertexCount;
                    PARAMS.filletPct   = _legacy.filletPct;
                    if (pdef) pdef.value = 'polygon';
                    setSliderById('vertexCount', _legacy.vertexCount);
                    setSliderById('filletPct', _legacy.filletPct);
                } else {
                    PARAMS.shape = val;
                }
            }
            if (name === 'vertexCount') PARAMS.vertexCount = Number(val);
            if (name === 'filletPct')   PARAMS.filletPct   = Number(val);
            if (name === 'fillMode')   PARAMS.fillMode = val;
            if (name === 'viewMode')   PARAMS.viewMode = val;
            if (name === 'circleSize') PARAMS.circleSize = Number(val);
            if (name === 'paddingMm')  PARAMS.paddingMm = Number(val);
            if (name === 'borderRotation') PARAMS.borderRotation = Number(val);
            if (name === 'borderField') PARAMS.borderField = val;
            if (name === 'lineRotation') PARAMS.lineRotation = Number(val);
            if (name === 'lineField') PARAMS.lineField = val;
            if (name === 'fieldRelation') PARAMS.fieldRelation = val;
            if (name === 'reseedFlow'   && val) PARAMS.fieldSeed = Math.floor(Math.random() * 1e6);
            if (name === 'reseedShapes' && val) PARAMS.shapeSeed = Math.floor(Math.random() * 1e6);
            if (name === 'reseedColors' && val) PARAMS.colorSeed = Math.floor(Math.random() * 1e6);
            if (name === 'shapeAspect') PARAMS.shapeAspect = Number(val);
            if (name === 'overlap') PARAMS.overlap = Number(val);
            if (name === 'starPoints') PARAMS.starPoints = Number(val);
            if (name === 'composition') PARAMS.composition = Number(val);
            if (name === 'penWidthMm') PARAMS.penWidthMm = Number(val);
            if (name === 'noiseScale') PARAMS.noiseScale = Number(val) / 100;
            if (name === 'lineNoiseScale') PARAMS.lineNoiseScale = Number(val) / 100;
            if (name === 'gradAngle')  PARAMS.gradAngle  = Number(val);
            if (name === 'density')    PARAMS.density    = Number(val);
            if (name === 'startColor') PARAMS.startColor = val;
            if (name === 'endColor')   PARAMS.endColor   = val;
            if (name === 'palette')    PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
        }
    };

    function setSliderById(id, val) {
        var pdef = api.params.find(function(x){ return x.id === id; });
        if (pdef) pdef.value = val;
        var el = document.getElementById(id);
        if (el) { el.value = val; }
        var vEl = document.getElementById(id + 'Value');
        if (vEl) vEl.textContent = val;
    }

    function resizeIfNeeded() {
        paper.resizeCanvasToPaper(p, PARAMS.paperSize);
    }

    p.registerSketchAPI = function(register) {
        if (typeof register === 'function') register(api);
    };

    var helpEl = null;
    var HELP_DEFAULT = 'Adjust sliders and palette on the right to design your piece. Hit Reseed for a new flow pattern.';

    // Density-driven line spacing is based on the THINNEST pen currently loaded
    // for the active palette (falls back to the manual Pen width slider if the
    // pen registry doesn't know a colour's width). A mixed-width palette means
    // thicker pens will visually overlap more than the density % implies --
    // surfaced as a warning in the help line rather than silently applying.
    function _paletteLoadedWidthsMm() {
        var pal = PARAMS.palette, widths = [];
        if (window.plotPens && typeof window.plotPens.widthFor === 'function') {
            for (var i = 0; i < pal.length; i++) {
                var w = window.plotPens.widthFor(pal[i]);
                if (w > 0) widths.push(w);
            }
        }
        return widths;
    }
    function _referencePenWidthMm() {
        var widths = _paletteLoadedWidthsMm();
        return widths.length ? Math.min.apply(null, widths) : (PARAMS.penWidthMm || 0.4);
    }
    function _lineSpacingPx() {
        var refMm = _referencePenWidthMm();
        var pct = Math.max(5, PARAMS.density);
        return paper.mmToPixels(refMm * (100 / pct));
    }
    function _updateHelp() {
        if (!helpEl) return;
        var widths = _paletteLoadedWidthsMm();
        var mixed = widths.length > 1 && Math.min.apply(null, widths) !== Math.max.apply(null, widths);
        if (mixed) {
            helpEl.textContent = 'Density is based on your palette’s thinnest loaded pen (' +
                Math.min.apply(null, widths).toFixed(2) + 'mm) — your palette has mixed pen widths (' +
                Math.min.apply(null, widths).toFixed(2) + '–' + Math.max.apply(null, widths).toFixed(2) +
                'mm), so thicker pens will lay down denser/more-overlapping lines than the % implies.';
            helpEl.style.color = '#b45309';
        } else {
            helpEl.textContent = HELP_DEFAULT;
            helpEl.style.color = '#667085';
        }
    }

    p.setup = function() {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;max-width:900px;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            helpEl.textContent = HELP_DEFAULT;
            container.appendChild(helpEl);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        _updateHelp();
        p.pixelDensity(1);
        p.noLoop();
    };

    var _chunkRaf = null;
    // Generation token: cancelAnimationFrame() is not an airtight guarantee against
    // timing races -- if a stale render's RAF callback has already been committed to
    // run by the browser in the instant before a newer render cancels it, it can still
    // fire and draw a cell using the OLD (now-superseded) grid geometry, leaving a
    // stray/misplaced cell in the final composite (reproduced on real hardware where
    // renders take long enough to interrupt mid-flight). Each renderChunked() call gets
    // a new generation id; a stale step() checks it's still current before drawing.
    var _renderGen = 0;

    function cmykFrameCtx() {
        var marginPx  = paper.getMarginPixels(PARAMS.margin);
        var paddingPx = paper.mmToPixels(PARAMS.paddingMm);
        var cellSize  = PARAMS.circleSize;
        var pitch     = cellSize + paddingPx;
        var availW    = p.width  - 2 * marginPx;
        var availH    = p.height - 2 * marginPx;
        var grid      = resolveGrid(availW, availH, pitch, PARAMS.composition);
        var cols      = grid.cols, rows = grid.rows;
        var contentW  = cols * cellSize + Math.max(0, cols - 1) * paddingPx;
        var contentH  = rows * cellSize + Math.max(0, rows - 1) * paddingPx;
        var offsetX   = marginPx + (availW - contentW) / 2;
        var offsetY   = marginPx + (availH - contentH) / 2;
        var gradRad   = p.radians(PARAMS.gradAngle);
        var gdx = Math.cos(gradRad), gdy = Math.sin(gradRad);
        var pMin = Infinity, pMax = -Infinity;
        for (var i = 0; i < cols; i++) {
            for (var j = 0; j < rows; j++) {
                var proj = (offsetX + (i + 0.5) * cellSize) * gdx + (offsetY + (j + 0.5) * cellSize) * gdy;
                if (proj < pMin) pMin = proj;
                if (proj > pMax) pMax = proj;
            }
        }
        return { cellSize: cellSize, paddingPx: paddingPx, cols: cols, rows: rows,
                 offsetX: offsetX, offsetY: offsetY, gdx: gdx, gdy: gdy, pMin: pMin, pMax: pMax };
    }

    function drawCmykCell(ctx, i, j) {
        var cellSize = ctx.cellSize, paddingPx = ctx.paddingPx;
        var cx = ctx.offsetX + i * (cellSize + paddingPx) + cellSize / 2;
        var cy = ctx.offsetY + j * (cellSize + paddingPx) + cellSize / 2;
        var t  = (ctx.pMax > ctx.pMin) ? ((cx * ctx.gdx + cy * ctx.gdy) - ctx.pMin) / (ctx.pMax - ctx.pMin) : 0;
        var weights = paletteWeightsAt(t);
        var angle = p.noise(i * PARAMS.noiseScale, j * PARAMS.noiseScale) * p.TWO_PI;
        var _o = cellOrient(i, j, ctx.cols, angle);
        p.randomSeed(cellSeedWith(PARAMS.colorSeed, i, j));
        var _shapeRng = makeRng(cellSeedWith(PARAMS.shapeSeed, i, j) ^ 0x51ED);
        if (PARAMS.fillMode === 'texture') {
            var _poly = buildCellPoly(cx, cy, cellSize, _o.shape, _shapeRng);
            var _tsegs = cellTextureSegs(_poly, weights, _o.hatch, cellSize, cellSeedWith(PARAMS.shapeSeed, i, j));
            for (var _ti = 0; _ti < _tsegs.length; _ti++) {
                var _t = _tsegs[_ti];
                p.stroke(inkColor(_t.color));
                p.line(_t.x1, _t.y1, _t.x2, _t.y2);
            }
        } else {
            var _rows = cellShapeRows(cx, cy, cellSize, _o.hatch, _o.shape, _shapeRng);
            for (var _r = 0; _r < _rows.length; _r++) {
                var _row = _rows[_r];
                for (var _sx = 0; _sx < _row.length; _sx++) {
                    var _sg = _row[_sx];
                    p.stroke(getRandomColor(weights));
                    p.line(_sg.x1, _sg.y1, _sg.x2, _sg.y2);
                }
            }
        }
    }

    function cmykPaintStart() {
        p.background(255);
        p.noiseSeed(PARAMS.fieldSeed);
        paper.drawPaperBorder(p);
        p.blendMode(PARAMS.viewMode === 'multiply' ? p.MULTIPLY : p.BLEND);
        p.strokeWeight(Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm)));
    }

    p.draw = function() {
        if (_chunkRaf) { window.cancelAnimationFrame(_chunkRaf); _chunkRaf = null; }
        _renderGen++;   // supersede any in-flight chunked render's stale generation
        cmykPaintStart();
        var ctx = cmykFrameCtx();
        for (var i = 0; i < ctx.cols; i++)
            for (var j = 0; j < ctx.rows; j++) drawCmykCell(ctx, i, j);
        p.blendMode(p.BLEND);
        // Redraw on top: 0" margin or full-bleed content can paint
        // edge-to-edge and cover the border drawn at the top of this
        // function -- keep it visible as the top layer.
        paper.drawPaperBorder(p);
    };

    // Progressive render: draw cells in ~10ms frame-budget batches, yielding to
    // the browser between batches so the UI stays responsive and the piece
    // builds up visibly. A new edit cancels the in-flight render and restarts.
    function renderChunked() {
        if (_chunkRaf) { window.cancelAnimationFrame(_chunkRaf); _chunkRaf = null; }
        var myGen = ++_renderGen;
        cmykPaintStart();
        var ctx = cmykFrameCtx();
        var total = ctx.cols * ctx.rows, k = 0;
        var nowFn = (window.performance && window.performance.now)
            ? function() { return window.performance.now(); } : function() { return Date.now(); };
        function finish() {
            p.blendMode(p.BLEND);
            _chunkRaf = null;
            if (window.makeSketchApp && typeof window.makeSketchApp.drawSignatureOverlay === 'function') {
                window.makeSketchApp.drawSignatureOverlay();
            }
        }
        function step() {
            if (myGen !== _renderGen) return;   // superseded -- a newer render already started/cleared; abort silently
            var start = nowFn();
            while (k < total) {
                drawCmykCell(ctx, Math.floor(k / ctx.rows), k % ctx.rows);
                k++;
                if (nowFn() - start > 10) break;
            }
            if (k < total) _chunkRaf = window.requestAnimationFrame(step);
            else finish();
        }
        step();
    }

    // Round each vertex of a polygon by cutting back along both adjacent
    // edges (capped at half the shorter edge, so cuts from neighbouring
    // corners can never overlap/self-intersect) and bridging the cut with a
    // quadratic-bezier arc using the original vertex as control point.
    // filletPct 0 = the cut length is 0 (sharp corner, vertex unchanged);
    // 100 = the cut reaches each edge's midpoint (maximally rounded -- for a
    // regular N-gon this is exactly its inscribed circle, i.e. a smooth
    // circle/ellipse once N is reasonably large).
    function _filletPolygon(verts, filletPct) {
        var f = Math.max(0, Math.min(100, filletPct)) / 100;
        if (f <= 0.001 || verts.length < 3) return verts;
        var n = verts.length, out = [], ARC_SEGS = 8;
        for (var i = 0; i < n; i++) {
            var prev = verts[(i - 1 + n) % n], cur = verts[i], next = verts[(i + 1) % n];
            var tpx = prev.x - cur.x, tpy = prev.y - cur.y, lp = Math.hypot(tpx, tpy) || 1e-9;
            var tnx = next.x - cur.x, tny = next.y - cur.y, ln = Math.hypot(tnx, tny) || 1e-9;
            var cut = f * 0.5 * Math.min(lp, ln);
            var p1x = cur.x + tpx / lp * cut, p1y = cur.y + tpy / lp * cut;
            var p2x = cur.x + tnx / ln * cut, p2y = cur.y + tny / ln * cut;
            for (var k = 0; k <= ARC_SEGS; k++) {
                var t = k / ARC_SEGS, mt = 1 - t;
                out.push({
                    x: mt * mt * p1x + 2 * mt * t * cur.x + t * t * p2x,
                    y: mt * mt * p1y + 2 * mt * t * cur.y + t * t * p2y
                });
            }
        }
        return out;
    }

    // ── Mask-shape geometry ─────────────────────────────────────────────
    // Build a closed polygon (global coords) for the requested shape, centered
    // at (cx,cy), sized w x h, rotated by theta. Concave shapes (stars, blobs)
    // are fine — the scanline hatch pairs intersections correctly.
    function buildShapePoly(shape, cx, cy, w, h, theta, starPoints, rng, vertexCount, filletPct) {
        var rx = w / 2, ry = h / 2, TWO = Math.PI * 2, pts = [];
        var ct = Math.cos(theta), st = Math.sin(theta);
        function add(lx, ly) { pts.push({ x: cx + lx * ct - ly * st, y: cy + lx * st + ly * ct }); }
        if (shape === 'polygon') {
            // Squares/rectangles/rounded squares/circles/ovals/triangles/pentagons/
            // hexagons were all separate shape options; they're really just this
            // one shape (a regular N-gon with optionally-rounded corners) at
            // different vertex counts and fillet amounts, so they're consolidated
            // here. A high vertex count + 100% fillet reads as a circle/ellipse.
            var n = Math.max(3, Math.round(vertexCount || 4));
            // Even-sided polygons default flat-side-up (n=4 -> an axis-aligned
            // square, matching the old "boxes" shape) rather than vertex-up
            // (which for a square specifically reads as a diamond, a visible
            // surprise vs. the pre-consolidation default). Odd-sided polygons
            // (n=3 -> apex-up triangle) keep the vertex-up look, which is the
            // conventional/expected orientation there.
            var phase = (n % 2 === 0) ? (Math.PI / n) : 0;
            var verts = [];
            for (var vi = 0; vi < n; vi++) {
                var av = -Math.PI / 2 + phase + vi / n * TWO;
                verts.push({ x: rx * Math.cos(av), y: ry * Math.sin(av) });
            }
            verts = _filletPolygon(verts, filletPct || 0);
            for (var vj = 0; vj < verts.length; vj++) add(verts[vj].x, verts[vj].y);
        } else if (shape === 'star') {
            var sp = Math.max(3, Math.round(starPoints || 5));
            for (var i3 = 0; i3 < sp * 2; i3++) { var rr = (i3 % 2 === 0) ? 1 : 0.42; var a3 = -Math.PI / 2 + i3 / (sp * 2) * TWO; add(rx * rr * Math.cos(a3), ry * rr * Math.sin(a3)); }
        } else if (shape === 'blob') {
            var nb = 18, raw = [];
            for (var i4 = 0; i4 < nb; i4++) raw.push(0.55 + (rng ? rng() : Math.random()) * 0.45);
            for (var i5 = 0; i5 < nb; i5++) {
                var sm = (raw[(i5 - 1 + nb) % nb] + raw[i5] * 2 + raw[(i5 + 1) % nb]) / 4;
                var a5 = i5 / nb * TWO; add(rx * sm * Math.cos(a5), ry * sm * Math.sin(a5));
            }
        } else {
            add(-rx, -ry); add(rx, -ry); add(rx, ry); add(-rx, ry);
        }
        return pts;
    }

    // Scanline-hatch rows (global coords) for one cell's shape. Used by both
    // the live canvas and SVG export so they stay identical.
    // Per-cell orientation by rotation mode: returns hatch-line direction and
    // shape rotation. clean=fixed shape/field hatch, field=follow noise,
    // mirror=noise sampled mirrored across the grid, unique=random per cell.
    function cellOrient(i, j, cols, fieldAngle) {
        // Border and line orientation are independent: each = manual rotation
        // + (optional) Perlin field. fieldRelation sets how the LINE's Perlin
        // relates to the BORDER's: same / mirror (across grid) / unique (independent).
        var rel = PARAMS.fieldRelation;
        var lineFieldA;
        if (rel === 'mirror')      lineFieldA = p.noise((cols - 1 - i) * PARAMS.noiseScale, j * PARAMS.noiseScale) * p.TWO_PI;
        else if (rel === 'unique') lineFieldA = p.noise((i + 1000) * PARAMS.lineNoiseScale, (j + 1000) * PARAMS.lineNoiseScale) * p.TWO_PI;
        else                       lineFieldA = fieldAngle;
        var shape = p.radians(PARAMS.borderRotation) + (PARAMS.borderField === 'on' ? fieldAngle : 0);
        var hatch = p.radians(PARAMS.lineRotation)   + (PARAMS.lineField   === 'on' ? lineFieldA : 0);
        return { hatch: hatch, shape: shape };
    }

    var SCREEN_ANGLES = [15, 75, 0, 45, 30, 60];

    function buildCellPoly(cx, cy, cellSize, shapeTheta, shapeRng) {
        var grow = 1 + (PARAMS.overlap / 100);
        var aspect = PARAMS.shapeAspect / 100;
        var w = cellSize * 0.92 * grow;
        var h = w * aspect;
        return buildShapePoly(PARAMS.shape, cx, cy, w, h, shapeTheta, PARAMS.starPoints, shapeRng, PARAMS.vertexCount, PARAMS.filletPct);
    }

    function cellShapeRows(cx, cy, cellSize, hatchAngle, shapeTheta, shapeRng) {
        var poly = buildCellPoly(cx, cy, cellSize, shapeTheta, shapeRng);
        var spacing = _lineSpacingPx();
        var hatchDeg = hatchAngle * 180 / Math.PI;
        return window.plotFills.hatchPolyRows(poly, hatchDeg, spacing);
    }

    // Ink-screen fill: one pass per palette ink, density proportional to its
    // weight in the color decomposition. Returns colored segments. Uses the
    // selected scatter Textures if any, else angled hatch (per-ink screen angle).
    function cellTextureSegs(poly, weights, lineTheta, cellSize, seed) {
        var out = [];
        var pal = PARAMS.palette;
        var baseSpacing = _lineSpacingPx();
        var scatter = window.plotFills.getScatterStyles();
        var imp = window.plotFills.getFillImperfection();
        for (var i = 0; i < pal.length; i++) {
            var wgt = weights[i];
            if (!(wgt > 0.08)) continue;
            var col = pal[i];
            if (scatter && scatter.length) {
                var spc = baseSpacing / Math.max(0.25, Math.sqrt(wgt));
                var st = scatter[i % scatter.length].replace('Fill', '');
                var segs = window.plotFills.scatterPolyFill(poly, st, spc * 1.4, 1.0, (seed ^ ((i + 1) * 0x9E3779B1)) >>> 0);
                for (var k = 0; k < segs.length; k++) out.push({ x1: segs[k].x1, y1: segs[k].y1, x2: segs[k].x2, y2: segs[k].y2, color: col });
            } else {
                var sp = Math.min(cellSize * 0.9, baseSpacing / wgt);
                if (!(sp > 0.3)) sp = 0.3;
                var angDeg = lineTheta * 180 / Math.PI + SCREEN_ANGLES[i % SCREEN_ANGLES.length];
                var rows = window.plotFills.hatchPolyRows(poly, angDeg, sp);
                if (imp > 0) rows = window.plotFills.sketchHatchRows(rows, i * 1.7, sp * imp * 0.6);
                for (var r = 0; r < rows.length; r++) { var row = rows[r]; for (var s2 = 0; s2 < row.length; s2++) { var sg = row[s2]; out.push({ x1: sg.x1, y1: sg.y1, x2: sg.x2, y2: sg.y2, color: col }); } }
            }
        }
        return out;
    }

    function inkColor(hex) {
        var c = p.color(hex);
        if (PARAMS.viewMode === 'multiply') c.setAlpha(204);
        return c;
    }

    function resolveGrid(availW, availH, cellSize, composition) {
        var baseCols = Math.max(1, Math.floor(availW / cellSize));
        var baseRows = Math.max(1, Math.floor(availH / cellSize));
        var totalCells = Math.max(1, baseCols * baseRows);
        var pageRatio = baseCols / Math.max(1, baseRows);
        var horizontalRatio = Math.max(pageRatio, totalCells);
        var verticalRatio = Math.min(pageRatio, 1 / totalCells);
        var t = composition / 100;
        var targetRatio;

        if (t < 0.5) {
            targetRatio = expLerp(horizontalRatio, pageRatio, t / 0.5);
        } else if (t > 0.5) {
            targetRatio = expLerp(pageRatio, verticalRatio, (t - 0.5) / 0.5);
        } else {
            targetRatio = pageRatio;
        }

        var cols = Math.max(1, Math.round(Math.sqrt(totalCells * targetRatio)));
        var rows = Math.max(1, Math.round(totalCells / cols));

        while (cols * cellSize > availW && cols > 1) cols--;
        while (rows * cellSize > availH && rows > 1) rows--;

        if (cols < 1) cols = 1;
        if (rows < 1) rows = 1;

        return { cols: cols, rows: rows };
    }

    function expLerp(a, b, t) {
        return Math.exp(Math.log(a) * (1 - t) + Math.log(b) * t);
    }

    function cellSeedWith(base, i, j) {
        return Math.abs(
            ((base + 1) * 73856093) ^
            ((i + 1) * 19349663) ^
            ((j + 1) * 83492791)
        );
    }
    function cellSeed(i, j) {
        return cellSeedWith(PARAMS.fieldSeed, i, j);
    }

    function getRandomColor(weights) {
        var c = p.color(pickFromWeights(weights, function(){ return p.random(); }));
        if (PARAMS.viewMode === 'multiply') c.setAlpha(204);
        return c;
    }

    function appendSvgLine(parts, x1, y1, x2, y2, stroke, strokeW) {
        parts.push('<line x1="' + fmt(x1) + '" y1="' + fmt(y1) + '" x2="' + fmt(x2) + '" y2="' + fmt(y2) + '" stroke="' + stroke + '" stroke-width="' + fmt(strokeW) + '" stroke-linecap="square" fill="none"/>');
    }

    function fmt(n) {
        return Number(n).toFixed(3);
    }

    function makeRng(seed) {
        var state = (seed >>> 0) || 1;
        return function() {
            state = (1664525 * state + 1013904223) >>> 0;
            return state / 4294967296;
        };
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
};
