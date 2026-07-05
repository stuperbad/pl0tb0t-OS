window.sketches = window.sketches || {};
window.sketches['lineArrays'] = function(p) {
    var paper = window.makeSketchUtils;

    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        subdivisions: 64,
        interpolation: 'linear',
        rowCount: 3,
        rowGap: 260,
        lineInset: 0,
        palette: ['#d45b6b', '#9c27b0', '#2d6ee8'],
        guideColor: '#9ea5b3',
        showGuides: 'on',
        showSkeleton: 'on',
        colorDither: 'off',
        overlapMode: 'xray',
        viewMode: 'multiply',
        penWidthMm: 0.4,
        preset: 'wave'
    };

    var rowNodes = []; // rowNodes[i] = [{x,y},...] for row i, each independently draggable
    var rowSettings = [];
    var rowSegmentColors = []; // rowSegmentColors[rowIdx][segIdx] = hex override or null
    var rowUnitDepths = []; // rowUnitDepths[rowIdx][unitIdx] = local z offset for interlaced mode
    var rowBandDepths = []; // rowBandDepths[rowIdx][unitIdx][bandIdx] = local z offset for interlaced cells
    var selectedSegment = -1;
    var selectedRow = -1;
    var selectedUnit = -1;
    var selectedLine = null;
    var selectedNode = null;
    var activeDepthNode = null;
    var dragTarget = null;
    var hoverTarget = null;
    var pressTarget = null;
    var helpEl = null;
    var ditherSeed = 1;
    var _dragOccurred = false;
    var _pickerHandled = false;
    var _lastClickAt = 0;
    var _lastClickPos = null;
    var _suppressRelease = false;

    var api = {
        hasPause: false,
        stylePresets: [
            { label: 'Smooth blend', values: { interpolation:'bezier', subdivisions:80, colorDither:'blend', overlapMode:'xray' } },
            { label: 'Stepped stack', values: { interpolation:'linear', subdivisions:48, colorDither:'off', overlapMode:'trimBehind' } },
            { label: 'Interlaced weave', values: { overlapMode:'interlaced', colorDither:'segmentBlend', subdivisions:64, interpolation:'bezier' } },
            { label: 'Random dither', values: { colorDither:'random', interpolation:'bezier', subdivisions:72, overlapMode:'xray' } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'subdivisions', label: 'Subdivisions', type: 'range', min: 8, max: 96, step: 2, value: 64 },
            { id: 'interpolation', label: 'Interpolation', type: 'select', value: 'linear',
              options: [
                { value: 'linear', label: 'Linear' },
                { value: 'bezier', label: 'Bezier' }
            ]},
            { id: 'addLineArray', label: 'Add line array', type: 'action', buttonLabel: 'Add line array' },
            { id: 'sendBackward', label: 'Send backward', type: 'action', buttonLabel: 'Send backward' },
            { id: 'bringForward', label: 'Bring forward', type: 'action', buttonLabel: 'Bring forward' },
            { id: 'sendToBack', label: 'Send to back', type: 'action', buttonLabel: 'Send to back' },
            { id: 'bringToFront', label: 'Bring to front', type: 'action', buttonLabel: 'Bring to front' },
            { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6,
              value: ['#d45b6b', '#9c27b0', '#2d6ee8'],
              options: [
                { value: '#e63946', label: 'Red' },
                { value: '#ff9800', label: 'Orange' },
                { value: '#ffd600', label: 'Yellow' },
                { value: '#4caf50', label: 'Green' },
                { value: '#00bcd4', label: 'Cyan' },
                { value: '#2196f3', label: 'Blue' },
                { value: '#9c27b0', label: 'Purple' },
                { value: '#ff00ff', label: 'Magenta' },
                { value: '#000000', label: 'Black' },
                { value: 'custom',  label: 'Custom' }
              ]},
            { id: 'colorDither', label: 'Color mode', type: 'select', value: 'off',
              options: [
                { value: 'off', label: 'Stepped' },
                { value: 'blend', label: 'Blend dither' },
                { value: 'segmentBlend', label: 'Segment blend' },
                { value: 'random', label: 'Random dither' }
              ] },
            { id: 'penWidthMm', label: 'Pen width (mm)', type: 'range', min: 0.1, max: 2.0, step: 0.1, value: 0.4 },
            { id: 'overlapMode', label: 'Overlap mode', type: 'select', value: 'xray',
              options: [
                { value: 'xray', label: 'X-ray' },
                { value: 'trimBehind', label: 'Trim behind' },
                { value: 'interlaced', label: 'Interlaced' }
              ]},
            { id: 'lineInset', label: 'Line inset', type: 'range', min: 0, max: 120, step: 2, value: 0, group: 'advanced' },
            { id: 'rowGap', label: 'Row offset', type: 'range', min: 0, max: 600, step: 4, value: 260, group: 'advanced' },
            { id: 'viewMode', label: 'View mode', type: 'select', value: 'multiply', group: 'advanced',
              options: [
                { value: 'multiply', label: 'Multiply' },
                { value: 'normal', label: 'Normal' }
              ]}
        ]),
        regenerate: function() {
            resizeIfNeeded();
            p.redraw();
        },
        reseed: function() {
            ditherSeed = Math.floor(Math.random() * 1e8) + 1;
            reseedArrayStyles();
            p.redraw();
        },
        randomize: function() {
            randomizeComposition();
            p.redraw();
        },
        getRecipe: function() {
            return {
                state: {
                    ditherSeed: ditherSeed,
                    rowNodes: cloneJson(rowNodes),
                    rowSettings: cloneJson(rowSettings),
                    rowSegmentColors: cloneJson(rowSegmentColors),
                    rowUnitDepths: cloneJson(rowUnitDepths),
                    rowBandDepths: cloneJson(rowBandDepths)
                }
            };
        },
        applyRecipeState: function(state) {
            if (!state || !Array.isArray(state.rowNodes)) return;
            ditherSeed = Number(state.ditherSeed || ditherSeed);
            rowNodes = cloneJson(state.rowNodes);
            rowSettings = cloneJson(state.rowSettings || rowNodes.map(function() { return defaultSettings(); }));
            rowSegmentColors = cloneJson(state.rowSegmentColors || rowNodes.map(function() { return []; }));
            rowUnitDepths = cloneJson(state.rowUnitDepths || rowNodes.map(function(nodes) { return defaultUnitDepths(nodes); }));
            rowBandDepths = cloneJson(state.rowBandDepths || rowNodes.map(function(_, i) { return defaultBandDepths(i); }));
            PARAMS.rowCount = rowNodes.length;
            selectedSegment = -1;
            selectedRow = -1;
            selectedUnit = -1;
            selectedLine = null;
            selectedNode = null;
            activeDepthNode = null;
            dragTarget = null;
            hoverTarget = null;
            p.redraw();
        },
        setParam: function(name, val) {
            var pdef = api.params.find(function(x){ return x.id === name; });
            if (pdef) pdef.value = val;
            if (name === 'paperSize') { PARAMS.paperSize = val; resizeIfNeeded(); }
            if (name === 'margin') PARAMS.margin = Number(val);
            if (name === 'preset') { PARAMS.preset = val; applyPreset(val); }
            if (name === 'addLineArray') addLineArray();
            if (name === 'sendBackward') { if (!adjustSelectedVertexDepth(-1000)) moveSelectedUnit(-1); }
            if (name === 'bringForward') { if (!adjustSelectedVertexDepth(1000)) moveSelectedUnit(1); }
            if (name === 'sendToBack') { if (!adjustSelectedVertexDepth(-100000)) moveSelectedUnit(-rowNodes.length); }
            if (name === 'bringToFront') { if (!adjustSelectedVertexDepth(100000)) moveSelectedUnit(rowNodes.length); }
            if (name === 'subdivisions') setScopedSetting('subdivisions', Number(val));
            if (name === 'interpolation') PARAMS.interpolation = val;
            if (name === 'rowCount') { PARAMS.rowCount = Number(val); syncRowCount(Number(val)); }
            if (name === 'rowGap') { PARAMS.rowGap = Number(val); applyPreset(PARAMS.preset); }
            if (name === 'lineInset') PARAMS.lineInset = Number(val);
            if (name === 'palette') PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
            if (name === 'guideColor') PARAMS.guideColor = val;
            if (name === 'showGuides') PARAMS.showGuides = val;
            if (name === 'showSkeleton') PARAMS.showSkeleton = val;
            if (name === 'colorDither') {
                setScopedSetting('colorDither', val);
                if (selectedUnit >= 0 && rowNodes[selectedUnit]) rowSegmentColors[selectedUnit] = [];
                else rowSegmentColors = rowNodes.map(function() { return []; });
                selectedSegment = -1;
                selectedRow = -1;
                selectedLine = null;
            }
            if (name === 'viewMode') PARAMS.viewMode = val;
            if (name === 'overlapMode') PARAMS.overlapMode = val;
            if (name === 'penWidthMm') PARAMS.penWidthMm = Number(val);
        },
        saveSVG: function() {
            var dims = paper.getPaperPixels(PARAMS.paperSize);
            var area = getDrawingArea(dims.width, dims.height);
            var rows = buildRows(area);
            var strokeW = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || new Date().toISOString().replace(/[:.]/g,'-');
            var filename = '90percentart-line-arrays-' + ts + '.svg';
            var svg = [];
            var canBoolean = typeof ClipperLib !== 'undefined';
            var mx0 = area.left, my0 = area.top;
            var mx1 = area.left + area.width, my1 = area.top + area.height;

            svg.push('<?xml version="1.0" encoding="UTF-8"?>');
            svg.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + dims.width + '" height="' + dims.height + '" viewBox="0 0 ' + dims.width + ' ' + dims.height + '">');
            // Keep exported SVG plotter-safe: do not emit paper borders, guides,
            // background fills, clipPath elements, or white cover polygons. Boolean
            // modes are baked into the open stroke geometry below.
            svg.push('<g>');
            var useBlendGroup = PARAMS.viewMode === 'multiply' && PARAMS.overlapMode === 'xray';
            if (useBlendGroup) svg.push('<g style="mix-blend-mode:multiply">');

            if (PARAMS.overlapMode === 'interlaced' && canBoolean) {
                var cells = buildInterlacedCells(rows);
                for (var ci = 0; ci < cells.length; ci++) {
                    var cell = cells[ci];
                    var aboveCells = [];
                    for (var ai = ci + 1; ai < cells.length; ai++) aboveCells.push(cells[ai].poly);
                    var cellLines = buildConnectionLines(rows[cell.rowIndex]);
                    for (var cl = 0; cl < cellLines.length; cl++) {
                        var cLine = cellLines[cl];
                        if (cLine.seg !== cell.unitIndex ||
                            (cLine.sample !== cell.bandIndex && cLine.sample !== cell.bandIndex + 1)) continue;
                        appendClippedLineSvg(svg, cLine, strokeW, [cell.poly], aboveCells, mx0, my0, mx1, my1);
                    }
                }
            } else {
                var masksByRow = [];
                for (var mi = 0; mi < rows.length; mi++) masksByRow.push(arrayCellMaskPolygons(rows[mi]));
                for (var ri = 0; ri < rows.length; ri++) {
                    var masksAbove = [];
                    if (PARAMS.overlapMode === 'trimBehind' && canBoolean) {
                        for (var aj = ri + 1; aj < rows.length; aj++) {
                            masksAbove = masksAbove.concat(masksByRow[aj]);
                        }
                    }
                    var rowLines = buildConnectionLines(rows[ri]);
                    for (var li = 0; li < rowLines.length; li++) {
                        appendClippedLineSvg(svg, rowLines[li], strokeW, null, masksAbove, mx0, my0, mx1, my1);
                    }
                }
            }
            if (useBlendGroup) svg.push('</g>');
            svg.push('</g>');
            svg.push('</svg>');
            downloadSvgString(svg.join('\n'), filename);
        }
    };

    function resizeIfNeeded() {
        paper.resizeCanvasToPaper(p, PARAMS.paperSize);
    }

    function presetNodes(name) {
        if (name === 'fan') return [
            { x: 0.00, y: 0.92 }, { x: 0.08, y: 0.18 }, { x: 0.26, y: 0.82 },
            { x: 0.46, y: 0.22 }, { x: 0.72, y: 0.84 }, { x: 1.00, y: 0.30 }
        ];
        if (name === 'sweep') return [
            { x: 0.00, y: 0.74 }, { x: 0.14, y: 0.20 }, { x: 0.30, y: 0.62 },
            { x: 0.50, y: 0.12 }, { x: 0.68, y: 0.78 }, { x: 0.86, y: 0.22 },
            { x: 1.00, y: 0.64 }
        ];
        return [
            { x: 0.00, y: 0.86 }, { x: 0.10, y: 0.14 }, { x: 0.24, y: 0.72 },
            { x: 0.40, y: 0.22 }, { x: 0.58, y: 0.80 }, { x: 0.76, y: 0.20 },
            { x: 1.00, y: 0.70 }
        ];
    }

    function cloneNodes(src) { return src.map(function(n){ return { x: n.x, y: n.y }; }); }

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function rand(lo, hi) {
        return lo + Math.random() * (hi - lo);
    }

    function randomNodes() {
        var count = 4 + Math.floor(Math.random() * 3);
        var nodes = [];
        var startX = rand(0.08, 0.28);
        var span = rand(0.42, 0.68);
        for (var i = 0; i < count; i++) {
            var t = count <= 1 ? 0 : i / (count - 1);
            nodes.push({
                x: startX + span * t + rand(-0.08, 0.08),
                y: 0.5 + Math.sin(t * Math.PI * (1.6 + Math.random() * 1.3) + rand(-0.9, 0.9)) * rand(0.18, 0.34) + rand(-0.12, 0.12)
            });
        }
        return nodes;
    }

    function transformNodes(nodes, cx, cy, scale, angle) {
        var center = centroid(nodes);
        var ca = Math.cos(angle);
        var sa = Math.sin(angle);
        for (var i = 0; i < nodes.length; i++) {
            var dx = (nodes[i].x - center.x) * scale;
            var dy = (nodes[i].y - center.y) * scale;
            nodes[i].x = cx + dx * ca - dy * sa;
            nodes[i].y = cy + dx * sa + dy * ca;
        }
        return nodes;
    }

    function centroid(nodes) {
        var sx = 0, sy = 0;
        for (var i = 0; i < nodes.length; i++) {
            sx += nodes[i].x;
            sy += nodes[i].y;
        }
        return nodes.length ? { x: sx / nodes.length, y: sy / nodes.length } : { x: 0.5, y: 0.5 };
    }

    function randomSettings() {
        var modes = ['off', 'blend', 'segmentBlend', 'random'];
        return {
            subdivisions: 18 + Math.floor(Math.random() * 55),
            colorDither: modes[Math.floor(Math.random() * modes.length)]
        };
    }

    function reseedArrayStyles() {
        var modes = ['off', 'blend', 'segmentBlend', 'random'];
        for (var i = 0; i < rowNodes.length; i++) {
            settingsFor(i).colorDither = modes[(Math.floor(Math.random() * modes.length) + i) % modes.length];
            rowSegmentColors[i] = [];
        }
        selectedSegment = -1;
        selectedRow = -1;
        selectedLine = null;
        syncScopedControls();
    }

    function randomPalette() {
        var options = [
            '#e63946', '#ff9800', '#ffd600', '#4caf50', '#00bcd4',
            '#2196f3', '#9c27b0', '#ff00ff', '#000000', '#d45b6b'
        ];
        var count = 2 + Math.floor(Math.random() * 3);
        var pool = options.slice();
        var out = [];
        while (out.length < count && pool.length) {
            out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
        return out;
    }

    function defaultSettings() {
        return {
            subdivisions: PARAMS.subdivisions,
            colorDither: PARAMS.colorDither
        };
    }

    function unitCountForNodes(nodes) {
        return Math.max(0, (nodes ? nodes.length : 0) - 2);
    }

    function defaultUnitDepths(nodes) {
        var count = unitCountForNodes(nodes);
        var depths = [];
        for (var i = 0; i < count; i++) depths.push(0);
        return depths;
    }

    function ensureUnitDepths(rowIndex) {
        var count = unitCountForNodes(rowNodes[rowIndex]);
        var depths = rowUnitDepths[rowIndex] || [];
        while (depths.length < count) depths.push(0);
        if (depths.length > count) depths = depths.slice(0, count);
        rowUnitDepths[rowIndex] = depths;
        return depths;
    }

    function bandCountForRow(rowIndex) {
        return Math.max(1, Math.round((settingsFor(rowIndex).subdivisions || PARAMS.subdivisions)) - 1);
    }

    function defaultBandDepths(rowIndex) {
        var unitCount = unitCountForNodes(rowNodes[rowIndex]);
        var bandCount = bandCountForRow(rowIndex);
        var out = [];
        for (var u = 0; u < unitCount; u++) {
            out[u] = [];
            for (var b = 0; b < bandCount; b++) out[u][b] = 0;
        }
        return out;
    }

    function ensureBandDepths(rowIndex) {
        var unitCount = unitCountForNodes(rowNodes[rowIndex]);
        var bandCount = bandCountForRow(rowIndex);
        var depths = rowBandDepths[rowIndex] || [];
        for (var u = 0; u < unitCount; u++) {
            if (!depths[u]) depths[u] = [];
            while (depths[u].length < bandCount) depths[u].push(0);
            if (depths[u].length > bandCount) depths[u] = depths[u].slice(0, bandCount);
        }
        if (depths.length > unitCount) depths = depths.slice(0, unitCount);
        rowBandDepths[rowIndex] = depths;
        return depths;
    }

    function unitsForVertex(rowIndex, vertexIndex) {
        var count = unitCountForNodes(rowNodes[rowIndex]);
        var units = [];
        for (var u = vertexIndex - 2; u <= vertexIndex; u++) {
            if (u < 0 || u >= count) continue;
            var side = 'middle';
            if (vertexIndex === u) side = 'start';
            else if (vertexIndex === u + 2) side = 'end';
            units.push({ unit: u, side: side });
        }
        return units;
    }

    function adjustSelectedVertexDepth(delta) {
        var target = selectedNode || activeDepthNode;
        if (!target || target.rowIndex < 0 || !rowNodes[target.rowIndex]) return false;
        var units = unitsForVertex(target.rowIndex, target.index);
        if (!units.length) return false;
        selectedNode = { rowIndex: target.rowIndex, index: target.index };
        activeDepthNode = { rowIndex: target.rowIndex, index: target.index };
        setSelectedUnit(target.rowIndex);
        var unitDepths = ensureUnitDepths(target.rowIndex);
        var bandDepths = ensureBandDepths(target.rowIndex);
        var bandCount = bandCountForRow(target.rowIndex);
        for (var i = 0; i < units.length; i++) {
            var unit = units[i].unit;
            unitDepths[unit] += delta * 0.15;
            for (var b = 0; b < bandCount; b++) {
                var t = bandCount <= 1 ? 0 : b / (bandCount - 1);
                var near = units[i].side === 'start' ? 1 - t : (units[i].side === 'end' ? t : 1 - Math.abs(t - 0.5) * 2);
                var weight = Math.pow(Math.max(0, near), 0.65);
                bandDepths[unit][b] += delta * weight;
            }
        }
        p.redraw();
        return true;
    }

    function settingsFor(rowIndex) {
        if (!rowSettings[rowIndex]) rowSettings[rowIndex] = defaultSettings();
        return rowSettings[rowIndex];
    }

    function scopedSetting(rowIndex, name) {
        return rowIndex >= 0 ? settingsFor(rowIndex)[name] : PARAMS[name];
    }

    function setScopedSetting(name, value) {
        if (selectedUnit >= 0 && rowNodes[selectedUnit]) {
            settingsFor(selectedUnit)[name] = value;
        } else {
            PARAMS[name] = value;
        }
    }

    function syncScopedControls() {
        if (!api || !api.params) return;
        syncControlValue('subdivisions', selectedUnit >= 0 && rowNodes[selectedUnit] ? scopedSetting(selectedUnit, 'subdivisions') : PARAMS.subdivisions);
        syncControlValue('colorDither', selectedUnit >= 0 && rowNodes[selectedUnit] ? scopedSetting(selectedUnit, 'colorDither') : PARAMS.colorDither);
    }

    function syncControlValue(id, value) {
        var pdef = api.params.find(function(x) { return x.id === id; });
        if (pdef) pdef.value = value;
        var input = document.getElementById(id);
        var label = document.getElementById(id + 'Value');
        if (input) input.value = value;
        if (label) label.textContent = value;
    }

    function syncPaletteControl() {
        var pdef = api.params.find(function(x) { return x.id === 'palette'; });
        if (pdef) pdef.value = PARAMS.palette.slice();
        var label = document.getElementById('paletteValue');
        if (label) label.textContent = PARAMS.palette.length + ' selected';
    }

    function setSelectedUnit(index) {
        selectedUnit = index >= 0 && rowNodes[index] ? index : -1;
        syncScopedControls();
    }

    function spacedPresetNodes(base, rowIndex, count) {
        var nodes = cloneNodes(base);
        var area = getDrawingArea(p.width || paper.getPaperPixels(PARAMS.paperSize).width, p.height || paper.getPaperPixels(PARAMS.paperSize).height);
        var offset = (rowIndex - (count - 1) / 2) * PARAMS.rowGap / Math.max(1, area.height);
        for (var i = 0; i < nodes.length; i++) nodes[i].y += offset;
        return nodes;
    }

    // Reset all rows to the preset shape and clear all segment overrides
    function applyPreset(name) {
        var count = Math.max(1, PARAMS.rowCount);
        rowNodes = [];
        rowSettings = [];
        rowUnitDepths = [];
        rowBandDepths = [];
        for (var i = 0; i < count; i++) {
            var nodes = transformNodes(
                randomNodes(),
                rand(0.28, 0.76),
                rand(0.24, 0.76),
                rand(0.72, 1.15),
                rand(-0.85, 0.85)
            );
            rowNodes.push(nodes);
            rowSettings.push(randomSettings());
            rowUnitDepths.push(defaultUnitDepths(nodes));
            rowBandDepths.push(defaultBandDepths(i));
        }
        rowSegmentColors = [];
        selectedSegment = -1;
        selectedRow = -1;
        setSelectedUnit(-1);
        selectedLine = null;
        selectedNode = null;
        activeDepthNode = null;
    }

    function randomizeComposition() {
        PARAMS.palette = randomPalette();
        PARAMS.rowCount = 3 + Math.floor(Math.random() * 3);
        PARAMS.lineInset = Math.floor(rand(0, 45));
        PARAMS.colorDither = ['off', 'blend', 'segmentBlend'][Math.floor(Math.random() * 3)];
        ditherSeed = Math.floor(Math.random() * 1e8) + 1;
        applyPreset(PARAMS.preset);
        syncScopedControls();
        syncControlValue('lineInset', PARAMS.lineInset);
        syncPaletteControl();
    }

    // When row count changes: add rows (copy of last) or trim without losing existing edits
    function syncRowCount(count) {
        count = Math.max(1, count);
        while (rowNodes.length < count) {
            var nodes = spacedPresetNodes(presetNodes(PARAMS.preset), rowNodes.length, count);
            rowNodes.push(nodes);
            rowSettings.push(defaultSettings());
            rowUnitDepths.push(defaultUnitDepths(nodes));
            rowBandDepths.push(defaultBandDepths(rowNodes.length - 1));
        }
        rowNodes = rowNodes.slice(0, count);
        rowSettings = rowSettings.slice(0, count);
        rowUnitDepths = rowUnitDepths.slice(0, count);
        rowBandDepths = rowBandDepths.slice(0, count);
        if (selectedUnit >= rowNodes.length) setSelectedUnit(rowNodes.length - 1);
        if (selectedRow >= rowNodes.length) {
            selectedSegment = -1;
            selectedRow = -1;
            selectedLine = null;
            selectedNode = null;
            activeDepthNode = null;
        }
    }

    function addLineArray() {
        var source = selectedUnit >= 0 && rowNodes[selectedUnit] ? rowNodes[selectedUnit] : presetNodes(PARAMS.preset);
        var next = cloneNodes(source);
        var area = getDrawingArea(p.width || paper.getPaperPixels(PARAMS.paperSize).width, p.height || paper.getPaperPixels(PARAMS.paperSize).height);
        var offset = PARAMS.rowGap / Math.max(1, area.height);
        for (var i = 0; i < next.length; i++) next[i].y += offset;
        rowNodes.push(next);
        rowSettings.push(selectedUnit >= 0 && rowSettings[selectedUnit] ? {
            subdivisions: rowSettings[selectedUnit].subdivisions,
            colorDither: rowSettings[selectedUnit].colorDither
        } : defaultSettings());
        rowUnitDepths.push(defaultUnitDepths(next));
        rowBandDepths.push(defaultBandDepths(rowNodes.length - 1));
        rowSegmentColors.push([]);
        PARAMS.rowCount = rowNodes.length;
        selectedSegment = -1;
        selectedRow = -1;
        selectedLine = null;
        selectedNode = null;
        activeDepthNode = null;
        setSelectedUnit(rowNodes.length - 1);
        p.redraw();
    }

    function deleteSelectedNode() {
        var target = selectedNode || hoverTarget;
        if (!target) return false;
        var nodes = rowNodes[target.rowIndex];
        if (!nodes || nodes.length <= 3) return false;
        nodes.splice(target.index, 1);
        rowSegmentColors[target.rowIndex] = [];
        rowUnitDepths[target.rowIndex] = defaultUnitDepths(nodes);
        rowBandDepths[target.rowIndex] = defaultBandDepths(target.rowIndex);
        selectedNode = null;
        activeDepthNode = null;
        hoverTarget = null;
        selectedSegment = -1;
        selectedRow = -1;
        selectedLine = null;
        p.redraw();
        return true;
    }

    function deleteSelectedUnit() {
        if (selectedUnit < 0 || rowNodes.length <= 1) return false;
        rowNodes.splice(selectedUnit, 1);
        rowSettings.splice(selectedUnit, 1);
        rowSegmentColors.splice(selectedUnit, 1);
        rowUnitDepths.splice(selectedUnit, 1);
        rowBandDepths.splice(selectedUnit, 1);
        PARAMS.rowCount = rowNodes.length;
        clearSelection();
        p.redraw();
        return true;
    }

    function moveArrayItem(list, from, to) {
        if (!list || from === to || from < 0 || from >= list.length) return;
        var item = list.splice(from, 1)[0];
        list.splice(to, 0, item);
    }

    function moveSelectedUnit(delta) {
        if (selectedUnit < 0 || rowNodes.length <= 1) return false;
        var from = selectedUnit;
        var to = Math.max(0, Math.min(rowNodes.length - 1, from + delta));
        if (to === from) return false;
        moveArrayItem(rowNodes, from, to);
        moveArrayItem(rowSettings, from, to);
        moveArrayItem(rowSegmentColors, from, to);
        moveArrayItem(rowUnitDepths, from, to);
        moveArrayItem(rowBandDepths, from, to);
        setSelectedUnit(to);
        selectedRow = selectedRow === from ? to : selectedRow;
        if (selectedLine && selectedLine.rowIndex === from) selectedLine.rowIndex = to;
        if (selectedNode && selectedNode.rowIndex === from) selectedNode.rowIndex = to;
        if (activeDepthNode && activeDepthNode.rowIndex === from) activeDepthNode.rowIndex = to;
        p.redraw();
        return true;
    }

    function keepNodesInBounds(nodes) {
        if (!nodes || !nodes.length) return;
        var minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (var i = 0; i < nodes.length; i++) {
            minX = Math.min(minX, nodes[i].x);
            maxX = Math.max(maxX, nodes[i].x);
            minY = Math.min(minY, nodes[i].y);
            maxY = Math.max(maxY, nodes[i].y);
        }
        var dx = minX < 0 ? -minX : (maxX > 1 ? 1 - maxX : 0);
        var dy = minY < 0 ? -minY : (maxY > 1 ? 1 - maxY : 0);
        if (dx || dy) {
            for (var j = 0; j < nodes.length; j++) {
                nodes[j].x += dx;
                nodes[j].y += dy;
            }
        }
    }

    function getDrawingArea(width, height) {
        var marginPx = paper.getMarginPixels(PARAMS.margin);
        return {
            left: marginPx,
            top: marginPx,
            width: width - 2 * marginPx,
            height: height - 2 * marginPx
        };
    }

    function buildRows(area) {
        var rows = [];
        var count = Math.max(1, PARAMS.rowCount);
        var inset = PARAMS.lineInset;
        for (var i = 0; i < count; i++) {
            rows.push({
                left: area.left + inset,
                top: area.top,
                width: area.width - inset * 2,
                height: area.height,
                nodes: rowNodes[i] || rowNodes[0],
                settings: settingsFor(i),
                rowIndex: i
            });
        }
        return rows;
    }

    function toWorld(node, area) {
        return {
            x: area.left + node.x * area.width,
            y: area.top + node.y * area.height
        };
    }

    function worldNodes(nodeList, area) {
        return nodeList.map(function(node) { return toWorld(node, area); });
    }

    function segmentSample(world, segIndex, count) {
        var pts = [];
        var a = world[Math.max(0, segIndex - 1)];
        var b = world[segIndex];
        var c = world[segIndex + 1];
        var d = world[Math.min(world.length - 1, segIndex + 2)];

        for (var i = 0; i < count; i++) {
            var t = count <= 1 ? 0 : i / (count - 1);
            if (PARAMS.interpolation === 'bezier') {
                pts.push(catmullRom(a, b, c, d, t));
            } else {
                pts.push({
                    x: p.lerp(b.x, c.x, t),
                    y: p.lerp(b.y, c.y, t)
                });
            }
        }
        return pts;
    }

    function catmullRom(a, b, c, d, t) {
        var t2 = t * t;
        var t3 = t2 * t;
        return {
            x: 0.5 * ((2 * b.x) + (-a.x + c.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * t3),
            y: 0.5 * ((2 * b.y) + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * t3)
        };
    }

    // Gaussian weights so all palette colors have overlap probability near boundaries
    function paletteWeightsAt(t) {
        var pal = PARAMS.palette;
        var n = pal.length;
        if (!pal || n <= 1) return [1];
        var sigma = 0.4, weights = [], sum = 0;
        for (var i = 0; i < n; i++) {
            var d = (t - i / (n - 1)) / sigma;
            var w = Math.exp(-0.5 * d * d);
            weights.push(w); sum += w;
        }
        if (sum > 0) for (var j = 0; j < n; j++) weights[j] /= sum;
        return weights;
    }

    function stableRandom(rowIndex, segIndex, sampleIndex) {
        var h = (ditherSeed >>> 0) ^
            ((rowIndex + 1) * 374761393) ^
            ((segIndex + 1) * 668265263) ^
            ((sampleIndex + 1) * 2246822519);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h = (h ^ (h >>> 16)) >>> 0;
        return h / 4294967296;
    }

    function pickFromWeights(weights, rowIndex, segIndex, sampleIndex) {
        var pal = PARAMS.palette;
        var r = stableRandom(rowIndex, segIndex, sampleIndex), cumul = 0;
        for (var i = 0; i < pal.length - 1; i++) {
            cumul += weights[i];
            if (r < cumul) return pal[i];
        }
        return pal[pal.length - 1];
    }

    function orderedDitherColor(t, rowIndex, segIndex, sampleIndex, sampleCount) {
        var pal = PARAMS.palette;
        if (!pal || pal.length === 0) return '#000000';
        if (pal.length === 1) return pal[0];
        var pos = Math.max(0, Math.min(1, t)) * (pal.length - 1);
        var idx = Math.min(Math.floor(pos), pal.length - 2);
        var frac = pos - idx;
        var count = Math.max(1, sampleCount);
        var threshold = (((sampleIndex * 37) + (segIndex * 17) + (rowIndex * 11)) % count) / count;
        return threshold < frac ? pal[idx + 1] : pal[idx];
    }

    function lineColorAt(mode, t, rowIndex, segIndex, sampleIndex, sampleCount) {
        if (mode === 'random') {
            return pickFromWeights(paletteWeightsAt(t), rowIndex, segIndex, sampleIndex);
        }
        if (mode === 'blend') {
            return orderedDitherColor(t, rowIndex, segIndex, sampleIndex, sampleCount);
        }
        return paletteColorAt(t);
    }

    function buildConnectionLines(area) {
        var world = worldNodes(area.nodes, area);
        var lines = [];
        var segmentCount = Math.max(0, world.length - 1);
        var subdivisions = Math.max(2, Math.round((area.settings && area.settings.subdivisions) || PARAMS.subdivisions));
        var colorMode = (area.settings && area.settings.colorDither) || PARAMS.colorDither;
        var bandCount = Math.max(1, segmentCount - 1);
        for (var seg = 0; seg < segmentCount - 1; seg++) {
            var segA = segmentSample(world, seg, subdivisions);
            var segB = segmentSample(world, seg + 1, subdivisions);
            var rowOverrides = rowSegmentColors[area.rowIndex] || [];
            var override = rowOverrides[seg] || null;
            var segmentT = bandCount <= 1 ? 0 : seg / (bandCount - 1);
            for (var i = 0; i < segA.length; i++) {
                var sampleT = segA.length <= 1 ? 0 : i / (segA.length - 1);
                var t = colorMode === 'segmentBlend' ? segmentT : (seg + sampleT) / bandCount;
                lines.push({
                    a: segA[i],
                    b: segB[i],
                    color: override || lineColorAt(colorMode, t, area.rowIndex, seg, i, segA.length),
                    seg: seg,
                    sample: i
                });
            }
        }
        return lines;
    }

    function segmentSamplesForArea(area) {
        var world = worldNodes(area.nodes, area);
        var segmentCount = Math.max(0, world.length - 1);
        var subdivisions = Math.max(2, Math.round((area.settings && area.settings.subdivisions) || PARAMS.subdivisions));
        var samples = [];
        for (var seg = 0; seg < segmentCount; seg++) {
            samples.push(segmentSample(world, seg, subdivisions));
        }
        return samples;
    }

    function arrayCellMaskPolygons(area) {
        var samples = segmentSamplesForArea(area);
        var cells = [];
        if (samples.length < 2) return cells;
        var sampleCount = samples[0].length;
        for (var seg = 0; seg < samples.length - 1; seg++) {
            for (var i = 0; i < sampleCount - 1; i++) {
                cells.push([
                    samples[seg][i],
                    samples[seg + 1][i],
                    samples[seg + 1][i + 1],
                    samples[seg][i + 1]
                ]);
            }
        }
        return cells;
    }

    function unitCellPolygons(area, unitIndex) {
        var samples = segmentSamplesForArea(area);
        var cells = [];
        if (unitIndex < 0 || unitIndex >= samples.length - 1) return cells;
        var sampleCount = samples[0].length;
        for (var sample = 0; sample < sampleCount - 1; sample++) {
            cells.push([
                samples[unitIndex][sample],
                samples[unitIndex + 1][sample],
                samples[unitIndex + 1][sample + 1],
                samples[unitIndex][sample + 1]
            ]);
        }
        return cells;
    }

    function drawArrayMask(area, strokeW) {
        var cells = arrayCellMaskPolygons(area);
        if (!cells.length) return;
        p.push();
        p.blendMode(p.BLEND);
        p.noStroke();
        p.fill('#ffffff');
        for (var c = 0; c < cells.length; c++) {
            p.beginShape();
            for (var k = 0; k < cells[c].length; k++) p.vertex(cells[c][k].x, cells[c][k].y);
            p.endShape(p.CLOSE);
        }
        p.pop();
    }

    function drawUnitMask(row, unitIndex) {
        var cells = unitCellPolygons(row, unitIndex);
        if (!cells.length) return;
        p.push();
        p.blendMode(p.BLEND);
        p.noStroke();
        p.fill('#ffffff');
        for (var c = 0; c < cells.length; c++) {
            p.beginShape();
            for (var i = 0; i < cells[c].length; i++) p.vertex(cells[c][i].x, cells[c][i].y);
            p.endShape(p.CLOSE);
        }
        p.pop();
    }

    function drawUnitLines(row, rowIndex, unitIndex, strokeW) {
        drawArrayLines(row, rowIndex, strokeW, function(seg) {
            return seg === unitIndex;
        }, true);
    }

    function drawCellLines(row, rowIndex, unitIndex, bandIndex, strokeW) {
        drawArrayLines(row, rowIndex, strokeW, function(seg, line) {
            return seg === unitIndex && (line.sample === bandIndex || line.sample === bandIndex + 1);
        }, true);
    }

    function buildInterlacedCells(rows) {
        var cells = [];
        for (var r = 0; r < rows.length; r++) {
            var unitDepths = ensureUnitDepths(r);
            var bandDepths = ensureBandDepths(r);
            var count = unitCountForNodes(rowNodes[r]);
            var rowCells = arrayCellMaskPolygons(rows[r]);
            var bandCount = bandCountForRow(r);
            for (var u = 0; u < count; u++) {
                for (var b = 0; b < bandCount; b++) {
                    var poly = rowCells[u * bandCount + b];
                    if (!poly) continue;
                    cells.push({
                        rowIndex: r,
                        unitIndex: u,
                        bandIndex: b,
                        poly: poly,
                        z: r * 1000 + (unitDepths[u] || 0) + ((bandDepths[u] && bandDepths[u][b]) || 0)
                    });
                }
            }
        }
        cells.sort(function(a, b) {
            if (a.z !== b.z) return a.z - b.z;
            if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
            if (a.unitIndex !== b.unitIndex) return a.unitIndex - b.unitIndex;
            return a.bandIndex - b.bandIndex;
        });
        return cells;
    }

    function drawInterlacedRows(rows, strokeW) {
        var cells = buildInterlacedCells(rows);
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            p.push();
            p.blendMode(p.BLEND);
            p.noStroke();
            p.fill('#ffffff');
            p.beginShape();
            for (var j = 0; j < cell.poly.length; j++) p.vertex(cell.poly[j].x, cell.poly[j].y);
            p.endShape(p.CLOSE);
            p.pop();
            drawCellLines(rows[cell.rowIndex], cell.rowIndex, cell.unitIndex, cell.bandIndex, strokeW);
        }
    }

    function drawArrayLines(row, rowIndex, strokeW, bandFilter, suppressSelection) {
        var lines = buildConnectionLines(row);
        for (var j = 0; j < lines.length; j++) {
            if (bandFilter && !bandFilter(lines[j].seg, lines[j])) continue;
            var isSelectedSegment = !suppressSelection && lines[j].seg === selectedSegment && rowIndex === selectedRow;
            var isSelectedLine = !suppressSelection && selectedLine && selectedLine.rowIndex === rowIndex && selectedLine.lineIndex === j;
            var lc = p.color(lines[j].color);
            if (PARAMS.viewMode === 'multiply' && PARAMS.overlapMode === 'xray' && !isSelectedSegment && !isSelectedLine) lc.setAlpha(204);
            p.stroke(lc);
            p.strokeWeight(isSelectedLine ? strokeW * 3 : (isSelectedSegment ? strokeW * 2 : strokeW));
            p.line(lines[j].a.x, lines[j].a.y, lines[j].b.x, lines[j].b.y);
        }
    }

    function beginMarginClip(area) {
        p.drawingContext.save();
        p.drawingContext.beginPath();
        p.drawingContext.rect(area.left, area.top, area.width, area.height);
        p.drawingContext.clip();
    }

    function endMarginClip() {
        p.drawingContext.restore();
    }

    function withMarginClip(area, drawFn) {
        var ctx = p.drawingContext;
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.width, area.height);
        ctx.clip();
        try {
            drawFn();
        } finally {
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            p.blendMode(p.BLEND);
        }
    }

    function drawGuides(area) {
        var world = worldNodes(area.nodes, area);
        if (PARAMS.showSkeleton === 'on') {
            p.noFill();
            p.stroke(area.rowIndex === selectedUnit ? '#111111' : redAlpha(PARAMS.guideColor, 110));
            p.strokeWeight(area.rowIndex === selectedUnit ? 2.2 : 1);
            p.beginShape();
            for (var i = 0; i < world.length; i++) p.vertex(world[i].x, world[i].y);
            p.endShape();
        }
        if (PARAMS.showGuides === 'on' && area.rowIndex === selectedUnit) {
            drawNodeHandles(area);
        }
    }

    function drawNodeHandles(area) {
        for (var i = 0; i < area.nodes.length; i++) {
            var node = toWorld(area.nodes[i], area);
            var active = (hoverTarget && hoverTarget.index === i && hoverTarget.rowIndex === area.rowIndex) ||
                (selectedNode && selectedNode.index === i && selectedNode.rowIndex === area.rowIndex);
            p.fill('#ffffff');
            var nodeColor = PARAMS.palette[PARAMS.palette.length - 1] || '#2d6ee8';
            p.stroke(active ? '#111111' : nodeColor);
            p.strokeWeight(active ? 2.5 : 1.5);
            p.circle(node.x, node.y, active ? 14 : 11);
        }
    }

    function rowHandlePositions(rowIndex) {
        var rows = buildRows(getDrawingArea(p.width, p.height));
        var area = rows[rowIndex];
        if (!area || !rowNodes[rowIndex]) return null;
        var minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
        for (var i=0; i<rowNodes[rowIndex].length; i++) {
            var w = toWorld(rowNodes[rowIndex][i], area);
            if(w.x<minX)minX=w.x; if(w.y<minY)minY=w.y;
            if(w.x>maxX)maxX=w.x; if(w.y>maxY)maxY=w.y;
        }
        var pad = 20;
        var cx = (minX+maxX)/2;
        return {
            corners: [
                {x:minX-pad, y:minY-pad},
                {x:maxX+pad, y:minY-pad},
                {x:maxX+pad, y:maxY+pad},
                {x:minX-pad, y:maxY+pad}
            ],
            rotate: {x:cx, y:minY-pad-36},
            bbox: {x:minX-pad, y:minY-pad, w:maxX-minX+pad*2, h:maxY-minY+pad*2},
            area: area
        };
    }

    function drawRowSelectionHandles(rowIndex) {
        var h = rowHandlePositions(rowIndex);
        if (!h) return;
        p.push();
        p.blendMode(p.BLEND);
        p.noFill(); p.stroke(80,160,255); p.strokeWeight(1.5);
        p.drawingContext.setLineDash([6,4]);
        p.rect(h.bbox.x, h.bbox.y, h.bbox.w, h.bbox.h, 3);
        p.drawingContext.setLineDash([]);
        p.fill(255); p.strokeWeight(2);
        for (var i=0;i<h.corners.length;i++) p.circle(h.corners[i].x, h.corners[i].y, 24);
        p.fill(80,160,255,180); p.circle(h.rotate.x, h.rotate.y, 24);
        p.noFill(); p.strokeWeight(1); p.stroke(80,160,255,120);
        p.line(h.bbox.x+h.bbox.w/2, h.bbox.y, h.rotate.x, h.rotate.y);
        p.pop();
    }

    function findRowHandleHit(pointer) {
        if (selectedUnit < 0) return null;
        var h = rowHandlePositions(selectedUnit);
        if (!h) return null;
        // rotation handle
        if (Math.hypot(pointer.x-h.rotate.x, pointer.y-h.rotate.y) <= 18) {
            return {type:"rotHandle", rowIndex:selectedUnit};
        }
        // corner scale handles
        for (var ci=0; ci<h.corners.length; ci++) {
            var ch = h.corners[ci];
            if (Math.hypot(pointer.x-ch.x, pointer.y-ch.y) <= 18) {
                return {type:"scaleHandle", rowIndex:selectedUnit, cornerIndex:ci};
            }
        }
        return null;
    }

    function redAlpha(hex, alpha) {
        var c = p.color(hex);
        c.setAlpha(alpha);
        return c;
    }

    function pointerToCanvas() {
        var rect = p.canvas.getBoundingClientRect();
        return {
            x: (p.winMouseX - rect.left) * (p.width / rect.width),
            y: (p.winMouseY - rect.top) * (p.height / rect.height)
        };
    }

    function pointerIsOnCanvas() {
        if (!p.canvas) return false;
        var rect = p.canvas.getBoundingClientRect();
        return p.winMouseX >= rect.left && p.winMouseX <= rect.right &&
            p.winMouseY >= rect.top && p.winMouseY <= rect.bottom;
    }

    function rotateModifierDown() {
        return p.keyIsDown(17) || p.keyIsDown(91) || p.keyIsDown(93);
    }

    function findNodeHit() {
        var pointer = pointerToCanvas();
        var rows = buildRows(getDrawingArea(p.width, p.height));
        var radius = 16;
        var start = selectedUnit >= 0 ? selectedUnit : 0;
        var end = selectedUnit >= 0 ? selectedUnit + 1 : rows.length;
        for (var r = start; r < end; r++) {
            for (var i = 0; i < rows[r].nodes.length; i++) {
                var world = toWorld(rows[r].nodes[i], rows[r]);
                if (Math.hypot(pointer.x - world.x, pointer.y - world.y) <= radius) {
                    return { index: i, row: rows[r], rowIndex: r };
                }
            }
        }
        return null;
    }

    function clampNode(node) {
        node.x = p.constrain(node.x, 0, 1);
        node.y = p.constrain(node.y, 0, 1);
    }

    function moveRow(rowIndex, dx, dy) {
        if (rowIndex < 0 || rowIndex >= rowNodes.length) return;
        var area = buildRows(getDrawingArea(p.width, p.height))[rowIndex];
        if (!area) return;
        var nx = dx / area.width;
        var ny = dy / area.height;
        for (var i = 0; i < rowNodes[rowIndex].length; i++) {
            rowNodes[rowIndex][i].x += nx;
            rowNodes[rowIndex][i].y += ny;
        }
    }

    function rowCenter(rowIndex) {
        var nodes = rowNodes[rowIndex] || [];
        if (!nodes.length) return { x: 0.5, y: 0.5 };
        var sx = 0, sy = 0;
        for (var i = 0; i < nodes.length; i++) {
            sx += nodes[i].x;
            sy += nodes[i].y;
        }
        return { x: sx / nodes.length, y: sy / nodes.length };
    }

    function scaleRow(rowIndex, center, factor, startNodes) {
        if (rowIndex < 0 || rowIndex >= rowNodes.length) return;
        for (var i = 0; i < rowNodes[rowIndex].length; i++) {
            var start = startNodes && startNodes[i] ? startNodes[i] : rowNodes[rowIndex][i];
            rowNodes[rowIndex][i].x = center.x + (start.x - center.x) * factor;
            rowNodes[rowIndex][i].y = center.y + (start.y - center.y) * factor;
        }
    }

    function keepRowInBounds(rowIndex) {
        keepNodesInBounds(rowNodes[rowIndex] || []);
    }

    function rotateRow(rowIndex, center, angle, startNodes, area) {
        if (rowIndex < 0 || rowIndex >= rowNodes.length) return;
        var ca = Math.cos(angle);
        var sa = Math.sin(angle);
        var rowArea = area || buildRows(getDrawingArea(p.width, p.height))[rowIndex];
        var centerWorld = toWorld(center, rowArea);
        for (var i = 0; i < rowNodes[rowIndex].length; i++) {
            var start = startNodes && startNodes[i] ? startNodes[i] : rowNodes[rowIndex][i];
            var world = toWorld(start, rowArea);
            var dx = world.x - centerWorld.x;
            var dy = world.y - centerWorld.y;
            rowNodes[rowIndex][i].x = (centerWorld.x + dx * ca - dy * sa - rowArea.left) / rowArea.width;
            rowNodes[rowIndex][i].y = (centerWorld.y + dx * sa + dy * ca - rowArea.top) / rowArea.height;
        }
    }

    function pointSegmentDistance(pt, a, b) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var len2 = dx * dx + dy * dy;
        var t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(pt.x - (a.x + dx * t), pt.y - (a.y + dy * t));
    }

    // ---- Segment color picker ----
    var SWATCH = 24, SWATCH_GAP = 4, AUTO_W = 36;

    function pickerLayout(seg) {
        var rows = buildRows(getDrawingArea(p.width, p.height));
        if (!rows.length) return null;
        // Position near the selected row's pivot node
        var row = rows[selectedRow >= 0 ? selectedRow : Math.floor(rows.length / 2)] || rows[0];
        var world = worldNodes(row.nodes, row);
        if (seg + 1 >= world.length) return null;
        var pivot = world[seg + 1];
        var pal = PARAMS.palette;
        var totalW = pal.length * (SWATCH + SWATCH_GAP) + SWATCH_GAP + AUTO_W + SWATCH_GAP;
        var x = Math.max(8, Math.min(p.width - totalW - 8, pivot.x - totalW / 2));
        var y = Math.max(8, pivot.y - SWATCH - 16);
        return { x: x, y: y, pal: pal, totalW: totalW };
    }

    function drawSegmentPicker() {
        if (selectedSegment === -1) return;
        var L = pickerLayout(selectedSegment);
        if (!L) return;
        var curColor = (rowSegmentColors[selectedRow] && rowSegmentColors[selectedRow][selectedSegment]) || null;
        p.blendMode(p.BLEND);
        p.fill(255, 240); p.stroke(200); p.strokeWeight(1);
        p.rect(L.x - 4, L.y - 4, L.totalW + 8, SWATCH + 8, 6);
        // Palette swatches
        for (var i = 0; i < L.pal.length; i++) {
            var sx = L.x + SWATCH_GAP + i * (SWATCH + SWATCH_GAP);
            var isActive = curColor === L.pal[i];
            p.fill(p.color(L.pal[i]));
            p.stroke(isActive ? '#111' : '#bbb');
            p.strokeWeight(isActive ? 2.5 : 1);
            p.rect(sx, L.y, SWATCH, SWATCH, 3);
        }
        // "auto" reset button
        var ax = L.x + SWATCH_GAP + L.pal.length * (SWATCH + SWATCH_GAP);
        p.fill(curColor ? 240 : 220); p.stroke(curColor ? '#bbb' : '#111'); p.strokeWeight(curColor ? 1 : 2);
        p.rect(ax, L.y, AUTO_W, SWATCH, 3);
        p.fill(80); p.noStroke(); p.textAlign(p.CENTER, p.CENTER); p.textSize(11);
        p.text('auto', ax + AUTO_W / 2, L.y + SWATCH / 2);
    }

    function findPickerHit(pointer) {
        if (selectedSegment === -1) return null;
        var L = pickerLayout(selectedSegment);
        if (!L) return null;
        for (var i = 0; i < L.pal.length; i++) {
            var sx = L.x + SWATCH_GAP + i * (SWATCH + SWATCH_GAP);
            if (pointer.x >= sx && pointer.x <= sx + SWATCH && pointer.y >= L.y && pointer.y <= L.y + SWATCH) {
                return { type: 'color', color: L.pal[i] };
            }
        }
        var ax = L.x + SWATCH_GAP + L.pal.length * (SWATCH + SWATCH_GAP);
        if (pointer.x >= ax && pointer.x <= ax + AUTO_W && pointer.y >= L.y && pointer.y <= L.y + SWATCH) {
            return { type: 'auto' };
        }
        return null;
    }

    // Returns {seg, rowIndex, sample} for the closest rendered line, or null if nothing close.
    function findLineHit(pointer) {
        var rows = buildRows(getDrawingArea(p.width, p.height));
        if (!rows.length) return null;
        var best = null;
        var bestDist = 10;
        for (var r = 0; r < rows.length; r++) {
            var lines = buildConnectionLines(rows[r]);
            for (var i = 0; i < lines.length; i++) {
                var dist = pointSegmentDistance(pointer, lines[i].a, lines[i].b);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { seg: lines[i].seg, rowIndex: r, sample: lines[i].sample, lineIndex: i, dist: dist };
                }
            }
        }
        return best;
    }

    function findSkeletonHit(pointer) {
        var rows = buildRows(getDrawingArea(p.width, p.height));
        var best = null;
        var bestDist = 18;
        for (var r = 0; r < rows.length; r++) {
            var world = worldNodes(rows[r].nodes, rows[r]);
            for (var i = 0; i < world.length - 1; i++) {
                var dist = pointSegmentDistance(pointer, world[i], world[i + 1]);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { type: 'skeleton', rowIndex: r, dist: dist };
                }
            }
        }
        return best;
    }

    function findCurveInsertHit(pointer) {
        var rows = buildRows(getDrawingArea(p.width, p.height));
        var best = null;
        var bestDist = 18;
        var start = selectedUnit >= 0 ? selectedUnit : 0;
        var end = selectedUnit >= 0 ? selectedUnit + 1 : rows.length;
        for (var r = start; r < end; r++) {
            var world = worldNodes(rows[r].nodes, rows[r]);
            for (var i = 0; i < world.length - 1; i++) {
                var dist = pointSegmentDistance(pointer, world[i], world[i + 1]);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { rowIndex: r, index: i + 1, row: rows[r], dist: dist };
                }
            }
        }
        return best;
    }

    function addVertex(hit, pointer) {
        if (!hit || !rowNodes[hit.rowIndex]) return;
        rowNodes[hit.rowIndex].splice(hit.index, 0, {
            x: (pointer.x - hit.row.left) / hit.row.width,
            y: (pointer.y - hit.row.top) / hit.row.height
        });
        rowSegmentColors[hit.rowIndex] = [];
        selectedNode = { rowIndex: hit.rowIndex, index: hit.index };
        selectedSegment = -1;
        selectedRow = -1;
        selectedLine = null;
        activeDepthNode = { rowIndex: hit.rowIndex, index: hit.index };
        setSelectedUnit(hit.rowIndex);
    }

    function selectLine(hit) {
        selectedSegment = hit ? hit.seg : -1;
        selectedRow = hit ? hit.rowIndex : -1;
        if (hit) setSelectedUnit(hit.rowIndex);
        selectedLine = hit ? { rowIndex: hit.rowIndex, lineIndex: hit.lineIndex, seg: hit.seg, sample: hit.sample } : null;
        activeDepthNode = null;
    }

    function clearSelection() {
        selectedSegment = -1;
        selectedRow = -1;
        setSelectedUnit(-1);
        selectedLine = null;
        selectedNode = null;
        activeDepthNode = null;
    }

    function paletteColorAt(t) {
        var pal = PARAMS.palette;
        if (!pal || pal.length === 0) return '#000000';
        if (pal.length === 1) return pal[0];
        var clamped = Math.max(0, Math.min(1, t));
        var idx = Math.round(clamped * (pal.length - 1));
        return pal[Math.max(0, Math.min(pal.length - 1, idx))];
    }

    function polylineSvg(points, stroke, opacity, width) {
        return '<polyline points="' + points.map(function(pt) { return fmt(pt.x) + ',' + fmt(pt.y); }).join(' ') + '" fill="none" stroke="' + stroke + '" stroke-width="' + fmt(width) + '"/>';
    }

    function appendClippedLineSvg(svg, line, strokeW, insidePolys, outsidePolys, x0, y0, x1, y1) {
        var polylines = [[line.a, line.b]];

        polylines = clipPolylinesToRect(polylines, x0, y0, x1, y1);
        if (insidePolys && insidePolys.length) {
            polylines = clipPolylinesWithPolygons(polylines, insidePolys, true);
        }
        if (outsidePolys && outsidePolys.length) {
            polylines = clipPolylinesWithPolygons(polylines, outsidePolys, false);
        }

        for (var i = 0; i < polylines.length; i++) {
            if (polylineLength(polylines[i]) > 0.01) {
                svg.push(polylineSvg(polylines[i], line.color, 1, strokeW));
            }
        }
    }

    function clipPolylinesToRect(polylines, x0, y0, x1, y1) {
        var out = [];
        for (var i = 0; i < polylines.length; i++) {
            if (!polylines[i] || polylines[i].length < 2) continue;
            var clipped = clipLineSegmentToRect(polylines[i][0], polylines[i][polylines[i].length - 1], x0, y0, x1, y1);
            if (clipped) out.push(clipped);
        }
        return out;
    }

    function clipLineSegmentToRect(a, b, x0, y0, x1, y1) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var t0 = 0;
        var t1 = 1;
        var checks = [
            { p: -dx, q: a.x - x0 },
            { p:  dx, q: x1 - a.x },
            { p: -dy, q: a.y - y0 },
            { p:  dy, q: y1 - a.y }
        ];
        for (var i = 0; i < checks.length; i++) {
            var pVal = checks[i].p;
            var qVal = checks[i].q;
            if (Math.abs(pVal) < 1e-9) {
                if (qVal < 0) return null;
            } else {
                var r = qVal / pVal;
                if (pVal < 0) {
                    if (r > t1) return null;
                    if (r > t0) t0 = r;
                } else {
                    if (r < t0) return null;
                    if (r < t1) t1 = r;
                }
            }
        }
        return [
            { x: a.x + dx * t0, y: a.y + dy * t0 },
            { x: a.x + dx * t1, y: a.y + dy * t1 }
        ];
    }

    function clipPolylinesWithPolygons(polylines, polygons, keepInside) {
        if (!polylines.length || !polygons || !polygons.length || typeof ClipperLib === 'undefined') return polylines;
        var scale = 100;
        var cpr = new ClipperLib.Clipper();
        for (var i = 0; i < polylines.length; i++) {
            if (polylines[i] && polylines[i].length >= 2) {
                cpr.AddPath(toClipperPath(polylines[i], scale), ClipperLib.PolyType.ptSubject, false);
            }
        }
        for (var j = 0; j < polygons.length; j++) {
            if (polygons[j] && polygons[j].length >= 3 && polygonAreaAbs(polygons[j]) > 0.01) {
                cpr.AddPath(toClipperPath(polygons[j], scale), ClipperLib.PolyType.ptClip, true);
            }
        }
        var tree = new ClipperLib.PolyTree();
        cpr.Execute(
            keepInside ? ClipperLib.ClipType.ctIntersection : ClipperLib.ClipType.ctDifference,
            tree,
            ClipperLib.PolyFillType.pftNonZero,
            ClipperLib.PolyFillType.pftNonZero
        );
        return ClipperLib.Clipper.OpenPathsFromPolyTree(tree)
            .map(function(path) { return fromClipperPath(path, scale); })
            .filter(function(path) { return path.length >= 2 && polylineLength(path) > 0.01; });
    }

    function toClipperPath(points, scale) {
        return points.map(function(pt) {
            return { X: Math.round(pt.x * scale), Y: Math.round(pt.y * scale) };
        });
    }

    function fromClipperPath(points, scale) {
        return points.map(function(pt) {
            return { x: pt.X / scale, y: pt.Y / scale };
        });
    }

    function polygonAreaAbs(poly) {
        var sum = 0;
        for (var i = 0; i < poly.length; i++) {
            var a = poly[i];
            var b = poly[(i + 1) % poly.length];
            sum += a.x * b.y - b.x * a.y;
        }
        return Math.abs(sum) * 0.5;
    }

    function polylineLength(points) {
        var total = 0;
        for (var i = 1; i < points.length; i++) {
            total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        }
        return total;
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

    function paintWhitePaper() {
        var ctx = p.drawingContext;
        // Use raw canvas context for the white fill — this bypasses p5's state
        // machine entirely (push/pop, blend mode, fill colour) so nothing from
        // the previous frame can leak into the clear. ctx.fillRect is always
        // source-over and always opaque regardless of p5's internal state.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if ('filter' in ctx) ctx.filter = 'none';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, p.canvas.width, p.canvas.height);
        ctx.restore();

        // Also reset p5-level state so subsequent draws start clean
        p.resetMatrix();
        p.blendMode(p.BLEND);
        p.noFill();
        p.stroke(0);
        if (p.canvas) {
            p.canvas.style.backgroundColor = '#ffffff';
            p.canvas.style.mixBlendMode = 'normal';
        }
    }

    p.registerSketchAPI = function(register) {
        if (typeof register === 'function') register(api);
    };

    p.setup = function() {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.backgroundColor = '#ffffff';
            container.style.userSelect = 'none';
            container.style.webkitUserSelect = 'none';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;max-width:900px;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            helpEl.textContent = 'Tap a line to select color. Drag an array to move. Use corner handles to scale, top handle to rotate. Double-tap a guide line to add a point. Delete removes a point or array. Layer buttons reorder arrays.';
            container.appendChild(helpEl);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        if (container) canvas.parent(container);
        if (helpEl) helpEl.style.width = p.width + 'px';
        if (canvas && canvas.elt) {
            canvas.elt.style.backgroundColor = '#ffffff';
            canvas.elt.style.mixBlendMode = 'normal';
            canvas.elt.style.userSelect = 'none';
            canvas.elt.style.webkitUserSelect = 'none';
        }
        p.pixelDensity(1);
        p.noLoop();
        ditherSeed = Math.floor(Math.random() * 1e8) + 1;
        applyPreset(PARAMS.preset); // initialises rowNodes for all rows
    };

    p.draw = function() {
        var area = getDrawingArea(p.width, p.height);
        var rows = buildRows(area);
        var strokeW = Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm));

        paintWhitePaper();
        p.drawingContext.globalCompositeOperation = 'source-over';
        p.drawingContext.globalAlpha = 1;
        paper.drawPaperBorder(p);
        p.strokeWeight(strokeW);
        p.noFill();
        withMarginClip(area, function() {
            if (PARAMS.overlapMode === 'interlaced') {
                drawInterlacedRows(rows, strokeW);
            } else {
                for (var i = 0; i < rows.length; i++) {
                    if (PARAMS.overlapMode === 'trimBehind' && i > 0) drawArrayMask(rows[i], strokeW);
                    if (PARAMS.viewMode === 'multiply' && PARAMS.overlapMode === 'xray') p.blendMode(p.MULTIPLY);
                    drawArrayLines(rows[i], i, strokeW);
                    p.blendMode(p.BLEND);
                }
            }
        });
        p.strokeWeight(strokeW); // reset

        hoverTarget = findNodeHit();
        withMarginClip(area, function() {
            for (var r = 0; r < rows.length; r++) drawGuides(rows[r]);
        });
        // drawNodeHandles sets p.fill('#ffffff') inside the clip; ctx.restore() only restores
        // the canvas context — p5's _doFill flag persists. Reset explicitly so it doesn't
        // leak into paintWhitePaper's push/pop on the next frame.
        p.noFill();
        p.stroke(0);

        // Draw segment color picker last (always on top, normal blend)
        drawSegmentPicker();
        // Same issue: drawSegmentPicker ends with p.fill(80)/p.noStroke(); reset for next frame.
        p.noFill();
        p.stroke(0);
        // Selection handles (outside clip — always visible, touch-friendly)
        if (selectedUnit >= 0 && PARAMS.showGuides === 'on') drawRowSelectionHandles(selectedUnit);
        // Redraw on top: 0" margin or full-bleed content can paint
        // edge-to-edge and cover the border drawn at the top of this
        // function -- keep it visible as the top layer.
        paper.drawPaperBorder(p);
    };

    p.mousePressed = function(event) {
        if (!pointerIsOnCanvas()) return;
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        _pickerHandled = false;
        pressTarget = null;
        var pointer = pointerToCanvas();

        // Touch-friendly bounding box handles — checked before all other hit tests
        var handleHit = findRowHandleHit(pointer);
        if (handleHit) {
            var targetRow = handleHit.rowIndex;
            var rows = buildRows(getDrawingArea(p.width, p.height));
            if (handleHit.type === "rotHandle") {
                var rotateCenterNorm = rowCenter(targetRow);
                var rotateCenterWorld = toWorld(rotateCenterNorm, rows[targetRow]);
                dragTarget = {
                    type: "rowRotate",
                    rowIndex: targetRow,
                    center: rotateCenterNorm,
                    centerWorld: rotateCenterWorld,
                    area: rows[targetRow],
                    startAngle: Math.atan2(pointer.y - rotateCenterWorld.y, pointer.x - rotateCenterWorld.x),
                    startNodes: rowNodes[targetRow].map(function(node) { return {x:node.x,y:node.y}; })
                };
                _dragOccurred = false;
                p.redraw();
                return false;
            }
            if (handleHit.type === "scaleHandle") {
                var h = rowHandlePositions(targetRow);
                var opp = h.corners[(handleHit.cornerIndex + 2) % 4];
                var oppNorm = {x:(opp.x-rows[targetRow].left)/rows[targetRow].width, y:(opp.y-rows[targetRow].top)/rows[targetRow].height};
                var startDist = Math.hypot(pointer.x-opp.x, pointer.y-opp.y);
                dragTarget = {
                    type: "rowScale",
                    rowIndex: targetRow,
                    center: oppNorm,
                    centerWorld: opp,
                    startDist: Math.max(8, startDist),
                    startNodes: rowNodes[targetRow].map(function(node) { return {x:node.x,y:node.y}; })
                };
                _dragOccurred = false;
                p.redraw();
                return false;
            }
        }

        var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        var isDoubleClick = _lastClickPos &&
            now - _lastClickAt < 340 &&
            Math.hypot(pointer.x - _lastClickPos.x, pointer.y - _lastClickPos.y) < 10;
        _lastClickAt = now;
        _lastClickPos = { x: pointer.x, y: pointer.y };

        if (isDoubleClick) {
            var insertHit = findCurveInsertHit(pointer);
            if (insertHit) {
                addVertex(insertHit, pointer);
                dragTarget = null;
                pressTarget = null;
                _dragOccurred = false;
                _pickerHandled = true;
                _suppressRelease = true;
                p.redraw();
                return false;
            }
        }

        // Picker swatches have highest priority
        var pickerHit = findPickerHit(pointer);
        if (pickerHit) {
            _pickerHandled = true;
            if (!rowSegmentColors[selectedRow]) rowSegmentColors[selectedRow] = [];
            if (pickerHit.type === 'color') {
                rowSegmentColors[selectedRow][selectedSegment] = pickerHit.color;
            } else {
                rowSegmentColors[selectedRow][selectedSegment] = null;
            }
            p.redraw();
            return false;
        }

        var rowHit = findSkeletonHit(pointer) || findLineHit(pointer);
        var nodeHit = null;
        if (!rowHit && rotateModifierDown()) nodeHit = findNodeHit();
        if ((rowHit || nodeHit) && rotateModifierDown()) {
            var targetRow = rowHit ? rowHit.rowIndex : nodeHit.rowIndex;
            pressTarget = rowHit || nodeHit;
            setSelectedUnit(targetRow);
            selectedLine = null;
            selectedNode = null;
            activeDepthNode = null;
            var rotateRows = buildRows(getDrawingArea(p.width, p.height));
            var rotateCenterNorm = rowCenter(targetRow);
            var rotateCenterWorld = toWorld(rotateCenterNorm, rotateRows[targetRow]);
            dragTarget = {
                type: 'rowRotate',
                rowIndex: targetRow,
                center: rotateCenterNorm,
                centerWorld: rotateCenterWorld,
                area: rotateRows[targetRow],
                startAngle: Math.atan2(pointer.y - rotateCenterWorld.y, pointer.x - rotateCenterWorld.x),
                startNodes: rowNodes[targetRow].map(function(node) {
                    return { x: node.x, y: node.y };
                })
            };
            _dragOccurred = false;
            p.redraw();
            return false;
        }

        if (rowHit && p.keyIsDown(16)) {
            pressTarget = rowHit;
            setSelectedUnit(rowHit.rowIndex);
            selectedLine = null;
            selectedNode = null;
            activeDepthNode = null;
            var rows = buildRows(getDrawingArea(p.width, p.height));
            var centerNorm = rowCenter(rowHit.rowIndex);
            var centerWorld = toWorld(centerNorm, rows[rowHit.rowIndex]);
            var startDist = Math.hypot(pointer.x - centerWorld.x, pointer.y - centerWorld.y);
            dragTarget = {
                type: 'rowScale',
                rowIndex: rowHit.rowIndex,
                center: centerNorm,
                centerWorld: centerWorld,
                startDist: Math.max(8, startDist),
                startNodes: rowNodes[rowHit.rowIndex].map(function(node) {
                    return { x: node.x, y: node.y };
                })
            };
            _dragOccurred = false;
            p.redraw();
            return false;
        }

        // Then node drag handles
        dragTarget = nodeHit || findNodeHit();
        _dragOccurred = false;
        if (dragTarget) {
            pressTarget = { type: 'node', rowIndex: dragTarget.rowIndex, index: dragTarget.index };
            setSelectedUnit(dragTarget.rowIndex);
            selectedLine = null;
            selectedNode = { rowIndex: dragTarget.rowIndex, index: dragTarget.index };
            activeDepthNode = { rowIndex: dragTarget.rowIndex, index: dragTarget.index };
            p.redraw();
            return false;
        }

        if (rowHit) {
            pressTarget = rowHit;
            setSelectedUnit(rowHit.rowIndex);
            selectedNode = null;
            activeDepthNode = null;
            dragTarget = { type: 'row', rowIndex: rowHit.rowIndex, last: pointer };
            p.redraw();
            return false;
        }
    };

    p.mouseDragged = function() {
        if (!dragTarget) return;
        _dragOccurred = true;
        var pointer = pointerToCanvas();
        if (dragTarget.type === 'row') {
            moveRow(dragTarget.rowIndex, pointer.x - dragTarget.last.x, pointer.y - dragTarget.last.y);
            dragTarget.last = pointer;
            p.redraw();
            return false;
        }
        if (dragTarget.type === 'rowScale') {
            var dist = Math.hypot(pointer.x - dragTarget.centerWorld.x, pointer.y - dragTarget.centerWorld.y);
            var factor = Math.max(0.08, Math.min(8, dist / dragTarget.startDist));
            scaleRow(dragTarget.rowIndex, dragTarget.center, factor, dragTarget.startNodes);
            p.redraw();
            return false;
        }
        if (dragTarget.type === 'rowRotate') {
            var angle = Math.atan2(pointer.y - dragTarget.centerWorld.y, pointer.x - dragTarget.centerWorld.x) - dragTarget.startAngle;
            rotateRow(dragTarget.rowIndex, dragTarget.center, angle, dragTarget.startNodes, dragTarget.area);
            p.redraw();
            return false;
        }
        var node = rowNodes[dragTarget.rowIndex][dragTarget.index];
        node.x = (pointer.x - dragTarget.row.left) / dragTarget.row.width;
        node.y = (pointer.y - dragTarget.row.top) / dragTarget.row.height;
        p.redraw();
        return false;
    };

    p.mouseReleased = function(event) {
        if (!pointerIsOnCanvas() && !dragTarget && !_suppressRelease) return;
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (_suppressRelease) {
            dragTarget = null;
            pressTarget = null;
            _dragOccurred = false;
            _pickerHandled = false;
            _suppressRelease = false;
            return false;
        }
        if (!_pickerHandled && !_dragOccurred) {
            // Short click with no drag and no picker hit — select/deselect a rendered line.
            var pointer = pointerToCanvas();
            if (pressTarget && pressTarget.type === 'node') {
                setSelectedUnit(pressTarget.rowIndex);
                selectedNode = { rowIndex: pressTarget.rowIndex, index: pressTarget.index };
                activeDepthNode = { rowIndex: pressTarget.rowIndex, index: pressTarget.index };
                selectedSegment = -1;
                selectedRow = -1;
                selectedLine = null;
            } else {
                var hit = findLineHit(pointer);
                if (hit) {
                if (selectedLine && selectedLine.lineIndex === hit.lineIndex && selectedLine.rowIndex === hit.rowIndex) {
                    selectedSegment = -1;
                    selectedRow = -1;
                    selectedLine = null;
                } else {
                    selectLine(hit);
                }
                selectedNode = null;
                activeDepthNode = null;
                } else if (pressTarget && pressTarget.type === 'skeleton') {
                    setSelectedUnit(pressTarget.rowIndex);
                    selectedSegment = -1;
                    selectedRow = -1;
                    selectedLine = null;
                    selectedNode = null;
                    activeDepthNode = null;
                } else if (selectedUnit !== -1) {
                    clearSelection();
                } else {
                    clearSelection();
                }
            }
            p.redraw();
        }
        dragTarget = null;
        pressTarget = null;
        _dragOccurred = false;
        _pickerHandled = false;
    };

    p.doubleClicked = function(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        return false;
    };

    p.keyPressed = function() {
        var active = document.activeElement;
        var tag = active && active.tagName ? active.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if (p.keyCode === 8 || p.keyCode === 46) {
            if (!deleteSelectedNode()) deleteSelectedUnit();
            return false;
        }
    };
};
