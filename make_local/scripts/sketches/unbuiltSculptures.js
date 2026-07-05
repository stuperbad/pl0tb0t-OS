window.sketches = window.sketches || {};
window.sketches['unbuiltSculptures'] = function(p) {
    var paper = window.makeSketchUtils;

    var PARAMS = {
        paperSize: '9x12',
        margin: 0.5,
        preset: 'xray',
        layoutMode: 'hill',
        sculptureCount: 3,
        blendSteps: 72,
        spacingMode: 'distance',
        curveSamples: 96,
        parentVertices: 7,
        spineSamples: 12,
        crossLines: 0,
        showGuides: 'on',
        showParents: 'on',
        showSpine: 'off',
        showHelp: 'on',
        viewMode: 'multiply',
        palette: ['#e84b3c', '#0f4ea3', '#087f69', '#9c27b0'],
        penWidthMm: 0.28
    };

    var sculptures = [];
    var selectedUnit = -1;
    var hoverTarget = null;
    var dragTarget = null;
    var lastPointer = null;
    var helpEl = null;
    var SCOPED_PARAMS = ['blendSteps', 'spacingMode', 'curveSamples', 'parentVertices', 'spineSamples', 'crossLines'];

    var api = {
        hasPause: false,
        stylePresets: [
            { label: 'Hill crowd', values: { sculptureCount:8, layoutMode:'hill', blendSteps:72 } },
            { label: 'Spiral tower', values: { sculptureCount:14, layoutMode:'spiral', blendSteps:90 } },
            { label: 'Grid array', values: { sculptureCount:16, layoutMode:'grid', blendSteps:60 } },
            { label: 'Dense crowd', values: { sculptureCount:20, layoutMode:'crowd', blendSteps:50 } },
            { label: 'Spaced field', values: { sculptureCount:12, layoutMode:'spaced', blendSteps:80 } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'preset', label: 'Preset', type: 'select', value: PARAMS.preset,
              options: [
                { value: 'xray', label: 'Xray' },
                { value: 'trimBehind', label: 'Trim behind' }
              ]},
            { id: 'sculptureCount', label: 'Sculptures', type: 'range', min: 1, max: 30, step: 1, value: PARAMS.sculptureCount },
            { id: 'layoutMode', label: 'Layout', type: 'select', value: PARAMS.layoutMode,
              options: [
                { value: 'hill', label: 'Hill' },
                { value: 'spiral', label: 'Spiral tower' },
                { value: 'crowd', label: 'Dense crowd' },
                { value: 'grid', label: 'Grid' },
                { value: 'spaced', label: 'Spaced' }
              ]},
            { id: 'blendSteps', label: 'Blend steps', type: 'range', min: 12, max: 150, step: 1, value: PARAMS.blendSteps },
            { id: 'spacingMode', label: 'Spacing', type: 'select', value: PARAMS.spacingMode,
              options: [{ value: 'distance', label: 'Equal distance' }, { value: 'parametric', label: 'Per segment' }] },
            { id: 'curveSamples', label: 'Curve detail', type: 'range', min: 3, max: 96, step: 1, value: PARAMS.curveSamples },
            { id: 'parentVertices', label: 'Parent vertices', type: 'range', min: 3, max: 16, step: 1, value: PARAMS.parentVertices },
            { id: 'spineSamples', label: 'Spine detail', type: 'range', min: 1, max: 64, step: 1, value: PARAMS.spineSamples },
            { id: 'crossLines', label: 'Cross weave', type: 'range', min: 0, max: 96, step: 1, value: PARAMS.crossLines },
            { id: 'jiggleParents', label: 'Jiggle parent curves', type: 'action', buttonLabel: 'Jiggle parents' },
            { id: 'jiggleSpine', label: 'Jiggle spine', type: 'action', buttonLabel: 'Jiggle spine' },
            { id: 'sendBackward', label: 'Send backward', type: 'action', buttonLabel: 'Send backward' },
            { id: 'bringForward', label: 'Bring forward', type: 'action', buttonLabel: 'Bring forward' },
            { id: 'sendToBack', label: 'Send to back', type: 'action', buttonLabel: 'Send to back' },
            { id: 'bringToFront', label: 'Bring to front', type: 'action', buttonLabel: 'Bring to front' },
            { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 5, value: PARAMS.palette,
              options: [
                { value: '#e84b3c', label: 'Red' },
                { value: '#0f4ea3', label: 'Blue' },
                { value: '#087f69', label: 'Green' },
                { value: '#111111', label: 'Black' },
                { value: '#9c27b0', label: 'Purple' },
                { value: '#ff9800', label: 'Orange' },
                { value: 'custom', label: 'Custom' }
              ]},
            { id: 'penWidthMm', label: 'Pen width (mm)', type: 'range', min: 0.1, max: 1.2, step: 0.05, value: PARAMS.penWidthMm }
        ]),
        regenerate: function() {
            resizeIfNeeded();
            p.redraw();
        },
        reseed: function() {
            buildFieldComposition();
            p.redraw();
        },
        randomize: function() {
            PARAMS.sculptureCount = randInt(4, 12);
            PARAMS.blendSteps = randInt(36, 130);
            PARAMS.spacingMode = Math.random() < 0.75 ? 'distance' : 'parametric';
            PARAMS.curveSamples = randInt(24, 96);
            PARAMS.parentVertices = randInt(5, 14);
            PARAMS.spineSamples = randInt(5, 24);
            PARAMS.crossLines = Math.random() < 0.35 ? 0 : randInt(8, 56);

            syncParamControl('sculptureCount', PARAMS.sculptureCount);
            syncParamControl('blendSteps', PARAMS.blendSteps);
            syncParamControl('spacingMode', PARAMS.spacingMode);
            syncParamControl('curveSamples', PARAMS.curveSamples);
            syncParamControl('parentVertices', PARAMS.parentVertices);
            syncParamControl('spineSamples', PARAMS.spineSamples);
            syncParamControl('crossLines', PARAMS.crossLines);

            buildFieldComposition();
            p.redraw();
        },
        getRecipe: function() {
            return { state: { sculptures: cloneJson(sculptures) } };
        },
        applyRecipeState: function(state) {
            if (!state || !Array.isArray(state.sculptures)) return;
            sculptures = cloneJson(state.sculptures);
            PARAMS.sculptureCount = Math.max(1, sculptures.length);
            syncParamControl('sculptureCount', PARAMS.sculptureCount);
            selectedUnit = -1;
            hoverTarget = null;
            dragTarget = null;
            lastPointer = null;
            syncScopedParamControls();
            p.redraw();
        },
        setParam: function(name, val) {
            var pdef = api.params.find(function(x) { return x.id === name; });
            if (pdef) pdef.value = val;
            if (name === 'paperSize') { PARAMS.paperSize = val; resizeIfNeeded(); invalidateAllMeshes(); }
            if (name === 'margin') { PARAMS.margin = Number(val); invalidateAllMeshes(); }
            if (name === 'preset') { PARAMS.preset = val; p.redraw(); }
            if (name === 'layoutMode') { PARAMS.layoutMode = val; buildFieldComposition(); p.redraw(); }
            if (name === 'sculptureCount') { PARAMS.sculptureCount = Number(val); syncSculptureCount(); }
            if (isScopedParam(name)) {
            setScopedParam(name, val);
            if (selectedUnit >= 0) { invalidateMesh(sculptures[selectedUnit]); } else { invalidateAllMeshes(); }
        }
            if (name === 'jiggleParents') { jiggleSelectedParents(); invalidateMesh(sculptures[selectedUnit]); }
            if (name === 'jiggleSpine') { jiggleSelectedSpine(); invalidateMesh(sculptures[selectedUnit]); }
            if (name === 'sendBackward') moveSelectedInStack(-1);
            if (name === 'bringForward') moveSelectedInStack(1);
            if (name === 'sendToBack') moveSelectedToStackEdge(0);
            if (name === 'bringToFront') moveSelectedToStackEdge(activeCount() - 1);
            if (name === 'showGuides') PARAMS.showGuides = val;
            if (name === 'showParents') PARAMS.showParents = val;
            if (name === 'showSpine') PARAMS.showSpine = val;
            if (name === 'showHelp') { PARAMS.showHelp = val; updateHelpText(); }
            if (name === 'viewMode') PARAMS.viewMode = val;
            if (name === 'palette') PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
            if (name === 'penWidthMm') PARAMS.penWidthMm = Number(val);
        },
        saveSVG: function() {
            var dims = paper.getPaperPixels(PARAMS.paperSize);
            var m = paper.getMarginPixels(PARAMS.margin);
            var area = { left: m, top: m, width: dims.width - 2 * m, height: dims.height - 2 * m };
            var strokeW = Math.max(0.3, paper.mmToPixels(PARAMS.penWidthMm));
            var svg = [];
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || new Date().toISOString().replace(/[:.]/g, '-');

            svg.push('<?xml version="1.0" encoding="UTF-8"?>');
            svg.push('<svg xmlns="http://www.w3.org/2000/svg"' +
                     ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' +
                     ' width="' + dims.width + '" height="' + dims.height + '"' +
                     ' viewBox="0 0 ' + dims.width + ' ' + dims.height + '">');
            // Plotter-safe export: omit background fills, paper borders, clipPath,
            // masks, and opacity. Some SVG-to-G-code tools treat fills as plottable
            // geometry and drop low-opacity strokes.

            // No external library dependencies — uses built-in geometry functions.
            var useTrimClip = isTrimPreset();
            var meshes = [];

            for (var i = 0; i < activeCount(); i++) {
                meshes.push(buildMesh(sculptures[i], area));
            }

            for (var i = 0; i < activeCount(); i++) {
                var mesh = meshes[i];
                var color = unitColor(sculptures[i]);

                // Start with full rib data. Occlusion trimming runs before the
                // final margin clip so exported xray and trim modes share the
                // same plot-safe artboard bounds.
                var ribs  = mesh.ribs;
                var cross = mesh.cross;

                // Trim-behind: cut lower sculpture lines against the actual
                // foreground mesh cells used by the canvas preview.
                if (useTrimClip && i < meshes.length - 1) {
                    var above = meshes.slice(i + 1);
                    ribs  = svgClipPolylines(ribs,  above);
                    cross = svgClipPolylines(cross, above);
                }
                ribs = clipPolylinesToRect(ribs, area);
                cross = clipPolylinesToRect(cross, area);

                // Each sculpture gets its own Inkscape layer so vpype's linemerge
                // only connects paths within one sculpture, never across sculptures.
                svg.push('<g inkscape:groupmode="layer" inkscape:label="Sculpture ' + (i+1) +
                         '" id="layer' + (i+1) + '">');
                for (var r = 0; r < ribs.length;  r++) svg.push(polylineSvg(ribs[r],  color, 1, strokeW));
                for (var c = 0; c < cross.length; c++) svg.push(polylineSvg(cross[c], color, 1, strokeW));
                svg.push('</g>');
            }
            svg.push('</svg>');
            downloadSvgString(svg.join('\n'), '90percentart-unbuilt-sculptures-' + ts + '.svg');
        }
    };

    function resizeIfNeeded() {
        paper.resizeCanvasToPaper(p, PARAMS.paperSize);
    }

    function activeCount() {
        return Math.min(Math.max(1, PARAMS.sculptureCount), sculptures.length);
    }

    function isTrimPreset() {
        return PARAMS.preset === 'trimBehind';
    }

    function isScopedParam(name) {
        return SCOPED_PARAMS.indexOf(name) !== -1;
    }

    function defaultSettings() {
        return copySettings(PARAMS);
    }

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function copySettings(source) {
        source = source || PARAMS;
        return {
            blendSteps: source.blendSteps,
            spacingMode: source.spacingMode,
            curveSamples: source.curveSamples,
            parentVertices: source.parentVertices,
            spineSamples: source.spineSamples,
            crossLines: source.crossLines
        };
    }

    function settingsFor(unit) {
        if (unit && !unit.settings) unit.settings = defaultSettings();
        return unit && unit.settings ? unit.settings : PARAMS;
    }

    function setting(unit, name) {
        var settings = settingsFor(unit);
        return typeof settings[name] !== 'undefined' ? settings[name] : PARAMS[name];
    }

    function selectedOrDefaultSettings() {
        return selectedUnit >= 0 && sculptures[selectedUnit] ? settingsFor(sculptures[selectedUnit]) : PARAMS;
    }

    function setScopedParam(name, val) {
        var target = selectedOrDefaultSettings();
        target[name] = name === 'spacingMode' ? val : Number(val);
        if (name === 'parentVertices') {
            if (selectedUnit >= 0 && sculptures[selectedUnit]) {
                resampleParentVertices(target[name], selectedUnit);
            } else {
                PARAMS.parentVertices = target[name];
            }
        }
    }

    function syncScopedParamControls() {
        var current = selectedOrDefaultSettings();
        for (var i = 0; i < SCOPED_PARAMS.length; i++) {
            syncParamControl(SCOPED_PARAMS[i], current[SCOPED_PARAMS[i]]);
        }
    }

    function syncParamControl(id, value) {
        var input = document.getElementById(id);
        if (input) input.value = value;
        var label = document.getElementById(id + 'Value');
        if (label) label.textContent = value;
        var pdef = api.params.find(function(x) { return x.id === id; });
        if (pdef) pdef.value = value;
    }

    function setSelectedUnit(index) {
        selectedUnit = index >= 0 && sculptures[index] ? index : -1;
        syncScopedParamControls();
    }

    function moveSelectedInStack(delta) {
        if (selectedUnit < 0 || !sculptures[selectedUnit]) return;
        var target = Math.max(0, Math.min(activeCount() - 1, selectedUnit + delta));
        moveSelectedToStackEdge(target);
    }

    function moveSelectedToStackEdge(target) {
        if (selectedUnit < 0 || !sculptures[selectedUnit]) return;
        target = Math.max(0, Math.min(activeCount() - 1, target));
        if (target === selectedUnit) return;
        var unit = sculptures.splice(selectedUnit, 1)[0];
        sculptures.splice(target, 0, unit);
        setSelectedUnit(target);
        p.redraw();
    }

    function buildPreset(name) {
        sculptures = [];
        selectedUnit = -1;
        for (var i = 0; i < Math.max(1, PARAMS.sculptureCount); i++) {
            sculptures.push(makeSculpture(i, name));
        }
        syncScopedParamControls();
    }

    function syncSculptureCount() {
        var count = Math.max(1, PARAMS.sculptureCount);
        while (sculptures.length < count) sculptures.push(makeFieldSculpture(sculptures.length, count, selectedOrDefaultSettings()));
        sculptures = sculptures.slice(0, count);
        if (selectedUnit >= sculptures.length) selectedUnit = sculptures.length - 1;
        syncScopedParamControls();
    }

    function makeSculpture(index, preset, settingsSource) {
        var data = presetData(preset, index);
        var settings = copySettings(settingsSource || PARAMS);
        var unit = {
            spine: data.spine,
            parents: [],
            settings: settings,
            colorIndex: index
        };
        for (var i = 0; i < data.parentDefs.length; i++) {
            unit.parents.push(makeBlob(data.parentDefs[i], settings.parentVertices));
        }
        return unit;
    }

    function makeFieldSculpture(index, count, settingsSource) {
        var data = randomSculptureData({ index: index, count: count, field: true });
        var settings = copySettings(settingsSource || PARAMS);
        var unit = {
            spine: data.spine,
            parents: [],
            settings: settings,
            colorIndex: index
        };
        for (var i = 0; i < data.parentDefs.length; i++) {
            unit.parents.push(makeBlob(data.parentDefs[i], settings.parentVertices));
        }
        return unit;
    }

    function buildFieldComposition() {
        sculptures = [];
        selectedUnit = -1;
        var count = Math.max(1, PARAMS.sculptureCount);
        for (var i = 0; i < count; i++) {
            sculptures.push(makeFieldSculpture(i, count, PARAMS));
        }
        syncScopedParamControls();
    }

    function presetData(preset, index) {
        if (preset === 'single') {
            return {
                spine: [
                    { x: 0.24, y: 0.56 }, { x: 0.38, y: 0.34 }, { x: 0.62, y: 0.33 },
                    { x: 0.78, y: 0.50 }, { x: 0.72, y: 0.70 }, { x: 0.49, y: 0.80 },
                    { x: 0.27, y: 0.72 }
                ],
                parentDefs: [
                    { x: 0.36, y: 0.29, rx: 0.16, ry: 0.10, rot: 0.12, phase: 0.1 },
                    { x: 0.78, y: 0.50, rx: 0.12, ry: 0.18, rot: -0.24, phase: 1.2 },
                    { x: 0.48, y: 0.82, rx: 0.18, ry: 0.09, rot: 0.05, phase: 2.4 },
                    { x: 0.17, y: 0.62, rx: 0.10, ry: 0.19, rot: -0.10, phase: 3.1 }
                ]
            };
        }

        if (preset === 'wide') {
            return {
                spine: [
                    { x: 0.10, y: 0.55 }, { x: 0.24, y: 0.31 }, { x: 0.52, y: 0.28 },
                    { x: 0.86, y: 0.42 }, { x: 0.91, y: 0.66 }, { x: 0.60, y: 0.78 },
                    { x: 0.22, y: 0.75 }
                ],
                parentDefs: [
                    { x: 0.18, y: 0.55, rx: 0.11, ry: 0.18, rot: -0.25, phase: 1.7 },
                    { x: 0.45, y: 0.27, rx: 0.18, ry: 0.10, rot: 0.12, phase: 0.3 },
                    { x: 0.86, y: 0.51, rx: 0.11, ry: 0.18, rot: -0.16, phase: 2.1 },
                    { x: 0.50, y: 0.79, rx: 0.21, ry: 0.08, rot: 0.08, phase: 3.2 }
                ]
            };
        }

        var overlap = [
            {
                spine: [
                    { x: 0.12, y: 0.45 }, { x: 0.26, y: 0.36 }, { x: 0.38, y: 0.25 },
                    { x: 0.49, y: 0.35 }, { x: 0.42, y: 0.54 }, { x: 0.27, y: 0.62 },
                    { x: 0.12, y: 0.57 }
                ],
                parentDefs: [
                    { x: 0.15, y: 0.44, rx: 0.11, ry: 0.08, rot: 0.22, phase: 0.2 },
                    { x: 0.35, y: 0.27, rx: 0.08, ry: 0.12, rot: -0.18, phase: 1.4 },
                    { x: 0.43, y: 0.49, rx: 0.12, ry: 0.08, rot: 0.10, phase: 2.4 },
                    { x: 0.22, y: 0.63, rx: 0.13, ry: 0.07, rot: -0.10, phase: 3.0 }
                ]
            },
            {
                spine: [
                    { x: 0.56, y: 0.20 }, { x: 0.72, y: 0.12 }, { x: 0.89, y: 0.22 },
                    { x: 0.91, y: 0.40 }, { x: 0.75, y: 0.50 }, { x: 0.58, y: 0.43 },
                    { x: 0.49, y: 0.30 }
                ],
                parentDefs: [
                    { x: 0.58, y: 0.22, rx: 0.10, ry: 0.13, rot: 0.20, phase: 0.7 },
                    { x: 0.80, y: 0.18, rx: 0.13, ry: 0.09, rot: 0.24, phase: 1.8 },
                    { x: 0.88, y: 0.38, rx: 0.08, ry: 0.13, rot: -0.14, phase: 2.8 },
                    { x: 0.62, y: 0.46, rx: 0.14, ry: 0.08, rot: -0.05, phase: 3.5 }
                ]
            },
            {
                spine: [
                    { x: 0.14, y: 0.68 }, { x: 0.32, y: 0.50 }, { x: 0.56, y: 0.35 },
                    { x: 0.78, y: 0.47 }, { x: 0.83, y: 0.68 }, { x: 0.66, y: 0.86 },
                    { x: 0.42, y: 0.90 }, { x: 0.21, y: 0.82 }
                ],
                parentDefs: [
                    { x: 0.18, y: 0.72, rx: 0.16, ry: 0.08, rot: 0.10, phase: 0.4 },
                    { x: 0.55, y: 0.39, rx: 0.15, ry: 0.09, rot: 0.16, phase: 1.5 },
                    { x: 0.82, y: 0.62, rx: 0.10, ry: 0.17, rot: -0.18, phase: 2.4 },
                    { x: 0.51, y: 0.89, rx: 0.20, ry: 0.08, rot: 0.02, phase: 3.4 }
                ]
            }
        ];
        if (index >= overlap.length) return randomSculptureData();

        var data = overlap[index];
        return {
            spine: data.spine.map(function(pt) { return clampPoint({ x: pt.x, y: pt.y }); }),
            parentDefs: data.parentDefs
        };
    }

    function randomSculptureData(options) {
        options = options || {};
        var cx, cy, rx, ry;
        if (options.field) {
            var count = Math.max(1, options.count || 1);
            var idx = options.index || 0;
            var t = count === 1 ? 0.72 : idx / (count - 1);
            var mode = PARAMS.layoutMode || 'hill';
            if (mode === 'grid' || mode === 'spaced') {
                var cols = Math.max(1, Math.round(Math.sqrt(count * 0.75)));
                var rows = Math.max(1, Math.ceil(count / cols));
                var col = idx % cols, row = Math.floor(idx / cols);
                var cellW = 0.84 / cols, cellH = 0.84 / rows;
                var jit = (mode === 'spaced') ? 0.30 : 0.05;
                cx = 0.08 + (col + 0.5) * cellW + randomSigned(cellW * jit);
                cy = 0.08 + (row + 0.5) * cellH + randomSigned(cellH * jit);
                var fit = (mode === 'spaced') ? 0.34 : 0.44;
                rx = Math.min(cellW, cellH) * fit * (mode === 'spaced' ? (0.7 + Math.random() * 0.5) : 1);
                ry = rx * (0.82 + Math.random() * 0.3);
            } else if (mode === 'spiral') {
                var ang = -Math.PI / 2 + idx * 2.39996323;
                var rad = 0.07 + t * 0.32;
                cx = 0.5 + Math.cos(ang) * rad * 0.82 + randomSigned(0.02);
                cy = 0.5 + Math.sin(ang) * rad - t * 0.05 + randomSigned(0.02);
                var sscale = 1.05 - t * 0.62;
                rx = (0.085 + Math.random() * 0.03) * sscale;
                ry = (0.07 + Math.random() * 0.03) * sscale;
            } else if (mode === 'crowd') {
                var laneC = (idx * 0.61803398875 + Math.random() * 0.4) % 1;
                var cscale = 0.55 + Math.random() * 0.4;
                cx = 0.12 + laneC * 0.76 + randomSigned(0.05);
                cy = 0.22 + t * 0.5 + randomSigned(0.11);
                rx = (0.075 + Math.random() * 0.05) * cscale;
                ry = (0.06 + Math.random() * 0.045) * cscale;
            } else {
                var lane = (idx * 0.61803398875 + Math.random() * 0.34) % 1;
                var scale = 0.42 + Math.pow(t, 1.25) * 1.05 + Math.random() * 0.14;
                cx = 0.13 + lane * 0.74 + randomSigned(0.045);
                cy = 0.15 + t * 0.72 + randomSigned(0.055);
                rx = (0.075 + Math.random() * 0.055) * scale;
                ry = (0.060 + Math.random() * 0.050) * scale;
            }
        } else {
            cx = 0.25 + Math.random() * 0.50;
            cy = 0.25 + Math.random() * 0.50;
            rx = 0.16 + Math.random() * 0.15;
            ry = 0.13 + Math.random() * 0.13;
        }
        var rot = randomSigned(Math.PI * 0.25);
        var spineCount = 6 + Math.floor(Math.random() * 3);
        var spine = [];
        var cr = Math.cos(rot);
        var sr = Math.sin(rot);
        for (var i = 0; i < spineCount; i++) {
            var a = (i / spineCount) * Math.PI * 2;
            var wobble = 0.78 + Math.random() * 0.36;
            var x = Math.cos(a) * rx * wobble;
            var y = Math.sin(a) * ry * wobble;
            spine.push(clampPoint({
                x: cx + x * cr - y * sr,
                y: cy + x * sr + y * cr
            }));
        }

        var parentDefs = [];
        for (var j = 0; j < 4; j++) {
            var t = j / 4;
            var anchor = sampleClosed(spine, t);
            parentDefs.push({
                x: anchor.x,
                y: anchor.y,
                rx: (options.field ? rx * (0.42 + Math.random() * 0.38) : 0.08 + Math.random() * 0.10),
                ry: (options.field ? ry * (0.42 + Math.random() * 0.38) : 0.06 + Math.random() * 0.10),
                rot: rot + randomSigned(Math.PI * 0.18),
                phase: Math.random() * Math.PI * 2
            });
        }

        return { spine: spine, parentDefs: parentDefs };
    }

    function makeBlob(def, vertexCount) {
        var pts = [];
        var count = Math.max(3, vertexCount || PARAMS.parentVertices);
        for (var i = 0; i < count; i++) {
            var a = (i / count) * Math.PI * 2;
            var wobble = 1 + 0.20 * Math.sin(a * 3 + def.phase) + 0.10 * Math.cos(a * 2 - def.phase);
            var x = Math.cos(a) * def.rx * wobble;
            var y = Math.sin(a) * def.ry * wobble;
            var cr = Math.cos(def.rot);
            var sr = Math.sin(def.rot);
            pts.push(clampPoint({
                x: def.x + x * cr - y * sr,
                y: def.y + x * sr + y * cr
            }));
        }
        return pts;
    }

    function resampleParentVertices(count, unitIndex) {
        count = Math.max(3, Math.round(count));
        var start = typeof unitIndex === 'number' ? unitIndex : 0;
        var end = typeof unitIndex === 'number' ? unitIndex + 1 : sculptures.length;
        for (var u = start; u < end; u++) {
            if (!sculptures[u]) continue;
            for (var pidx = 0; pidx < sculptures[u].parents.length; pidx++) {
                sculptures[u].parents[pidx] = resampleClosedPoints(sculptures[u].parents[pidx], count);
            }
        }
        hoverTarget = null;
        dragTarget = null;
    }

    function resampleClosedPoints(points, count) {
        if (points.length === count) return points;
        var next = [];
        for (var i = 0; i < count; i++) next.push(sampleClosed(points, i / count));
        return next.map(function(pt) { return { x: pt.x, y: pt.y }; });
    }

    function drawingArea() {
        var m = paper.getMarginPixels(PARAMS.margin);
        return { left: m, top: m, width: p.width - 2 * m, height: p.height - 2 * m };
    }

    function toWorld(point, area) {
        return {
            x: area.left + point.x * area.width,
            y: area.top + point.y * area.height
        };
    }

    function toNorm(point, area) {
        return {
            x: (point.x - area.left) / area.width,
            y: (point.y - area.top) / area.height
        };
    }

    function clampPoint(pt) {
        pt.x = Math.max(0, Math.min(1, pt.x));
        pt.y = Math.max(0, Math.min(1, pt.y));
        return pt;
    }

    function sampleClosed(points, t) {
        var n = points.length;
        var f = ((t % 1) + 1) % 1 * n;
        var i = Math.floor(f) % n;
        var localT = f - Math.floor(f);
        var a = points[(i - 1 + n) % n];
        var b = points[i];
        var c = points[(i + 1) % n];
        var d = points[(i + 2) % n];
        return catmullRom(a, b, c, d, localT);
    }

    function catmullRom(a, b, c, d, t) {
        var t2 = t * t;
        var t3 = t2 * t;
        return {
            x: 0.5 * ((2 * b.x) + (-a.x + c.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * t3),
            y: 0.5 * ((2 * b.y) + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * t3)
        };
    }

    function lerpPoint(a, b, t) {
        return {
            x: p.lerp(a.x, b.x, t),
            y: p.lerp(a.y, b.y, t)
        };
    }

    function centroid(points) {
        var c = { x: 0, y: 0 };
        for (var i = 0; i < points.length; i++) {
            c.x += points[i].x;
            c.y += points[i].y;
        }
        c.x /= Math.max(1, points.length);
        c.y /= Math.max(1, points.length);
        return c;
    }

    function shiftedPoints(points, dx, dy) {
        return points.map(function(pt) {
            return { x: pt.x + dx, y: pt.y + dy };
        });
    }

    function projectedParent(unit, parentIndex) {
        var parent = unit.parents[parentIndex];
        var center = sampleSpine(unit, parentIndex / unit.parents.length);
        var from = centroid(parent);
        return shiftedPoints(parent, center.x - from.x, center.y - from.y);
    }

    function inverseProjectedParentPoint(unit, parentIndex, target, replaceIndex) {
        var parent = unit.parents[parentIndex];
        var center = sampleSpine(unit, parentIndex / unit.parents.length);
        var n = replaceIndex === null ? parent.length + 1 : parent.length;
        var sum = { x: 0, y: 0 };
        for (var i = 0; i < parent.length; i++) {
            if (i === replaceIndex) continue;
            sum.x += parent[i].x;
            sum.y += parent[i].y;
        }
        var denom = 1 - 1 / n;
        return clampPoint({
            x: (target.x - center.x + sum.x / n) / denom,
            y: (target.y - center.y + sum.y / n) / denom
        });
    }

    function sampleSpine(unit, t) {
        if (setting(unit, 'spacingMode') === 'distance') return sampleSpineByDistance(unit, t);
        return sampleSpineParametric(unit, t);
    }

    function sampleSpineParametric(unit, t) {
        var detail = spineStepCount(unit);
        var f = ((t % 1) + 1) % 1 * detail;
        var i = Math.floor(f);
        var localT = f - i;
        var a = sampleClosed(unit.spine, i / detail);
        var b = sampleClosed(unit.spine, (i + 1) / detail);
        return lerpPoint(a, b, localT);
    }

    function spineStepCount(unit) {
        return Math.max(1, setting(unit, 'spineSamples')) * Math.max(3, unit.spine.length);
    }

    function sampleSpineByDistance(unit, t) {
        var pts = spinePolyline(unit);
        var target = (((t % 1) + 1) % 1) * pts.total;
        for (var i = 0; i < pts.segments.length; i++) {
            var seg = pts.segments[i];
            if (target <= seg.end || i === pts.segments.length - 1) {
                var localT = seg.length <= 0 ? 0 : (target - seg.start) / seg.length;
                return lerpPoint(seg.a, seg.b, Math.max(0, Math.min(1, localT)));
            }
        }
        return pts.segments.length ? pts.segments[0].a : { x: 0.5, y: 0.5 };
    }

    function spinePolyline(unit) {
        var count = spineStepCount(unit);
        var points = [];
        var segments = [];
        var total = 0;
        for (var i = 0; i <= count; i++) points.push(sampleSpineParametric(unit, i / count));
        for (var j = 0; j < count; j++) {
            var a = points[j];
            var b = points[j + 1];
            var length = Math.hypot(b.x - a.x, b.y - a.y);
            segments.push({ a: a, b: b, start: total, end: total + length, length: length });
            total += length;
        }
        return { segments: segments, total: total || 1 };
    }

    function blendProfileAt(unit, t, samples) {
        var parents = unit.parents;
        var n = parents.length;
        var f = ((t % 1) + 1) % 1 * n;
        var i = Math.floor(f) % n;
        var localT = f - Math.floor(f);
        var a = parents[i];
        var b = parents[(i + 1) % n];
        var rib = [];
        for (var j = 0; j <= samples; j++) {
            var q = j / samples;
            rib.push(lerpPoint(sampleClosed(a, q), sampleClosed(b, q), smooth(localT)));
        }
        var currentCenter = centroid(rib);
        var spineCenter = sampleSpine(unit, t);
        return shiftedPoints(rib, spineCenter.x - currentCenter.x, spineCenter.y - currentCenter.y);
    }

    function smooth(t) {
        return t * t * (3 - 2 * t);
    }

    function invalidateMesh(unit) { if (unit) unit._mesh = null; }
    function invalidateAllMeshes() { for (var _i=0;_i<sculptures.length;_i++) sculptures[_i]._mesh=null; }

    function buildMesh(unit, area) {
        var ribs = [];
        var grid = [];
        var ribCount = Math.max(3, setting(unit, 'blendSteps'));
        var sampleCount = Math.max(3, setting(unit, 'curveSamples'));

        for (var i = 0; i < ribCount; i++) {
            var normRib = blendProfileAt(unit, i / ribCount, sampleCount);
            var worldRib = normRib.map(function(pt) { return toWorld(pt, area); });
            ribs.push(worldRib);
            grid.push(worldRib);
        }

        var cross = [];
        var lineCount = Math.min(Math.max(0, setting(unit, 'crossLines')), sampleCount);
        for (var k = 0; k < lineCount; k++) {
            var idx = Math.floor((k + 0.5) * sampleCount / lineCount);
            var strand = [];
            for (var r = 0; r < grid.length; r++) strand.push(grid[r][idx]);
            strand.push(grid[0][idx]);
            cross.push(strand);
        }
        return { ribs: ribs, cross: cross };
    }

    function drawMesh(unit, index, area) {
        if (!unit._mesh) unit._mesh = buildMesh(unit, area);
        var mesh = unit._mesh;
        var color = p.color(unitColor(unit));
        if (PARAMS.viewMode === 'multiply') color.setAlpha(164);
        p.stroke(color);
        p.noFill();
        for (var i = 0; i < mesh.ribs.length; i++) drawPolyline(mesh.ribs[i]);

        color.setAlpha(PARAMS.viewMode === 'multiply' ? 118 : 154);
        p.stroke(color);
        for (var j = 0; j < mesh.cross.length; j++) drawPolyline(mesh.cross[j]);
    }

    function unitColor(unit) {
        var idx = typeof unit.colorIndex === 'number' ? unit.colorIndex : 0;
        return PARAMS.palette[idx % PARAMS.palette.length] || '#111111';
    }

    function drawTrimMask(unit, area) {
        if (!unit._mesh) unit._mesh = buildMesh(unit, area);
        var masks = meshMaskPolygons(unit._mesh);
        if (!masks.length) return;
        p.push();
        p.blendMode(p.BLEND);
        p.noStroke();
        p.fill('#ffffff');
        for (var i = 0; i < masks.length; i++) {
            p.beginShape();
            for (var j = 0; j < masks[i].length; j++) p.vertex(masks[i][j].x, masks[i][j].y);
            p.endShape(p.CLOSE);
        }
        p.pop();
    }

    function drawParents(unit, index, area) {
        p.noFill();
        var editable = index === selectedUnit;
        if (editable) {
            p.stroke(index === selectedUnit ? colorWithAlpha('#19d20f', 145) : colorWithAlpha('#19d20f', 80));
            p.strokeWeight(index === selectedUnit ? 1.1 : 0.8);
            for (var i = 0; i < unit.parents.length; i++) drawClosedCurve(projectedParent(unit, i), area, Math.max(3, setting(unit, 'curveSamples')));
        }

        if (editable) {
            p.stroke(index === selectedUnit ? '#111111' : colorWithAlpha('#111111', 115));
            p.strokeWeight(index === selectedUnit ? 2.4 : 1.4);
            drawSpineCurve(unit, area);
        }

        if (editable) drawHandles(unit.spine, area, index, 'spine', -1, '#111111');
        if (editable) {
            for (var pidx = 0; pidx < unit.parents.length; pidx++) {
                drawHandles(projectedParent(unit, pidx), area, index, 'parent', pidx, '#19d20f');
            }
        }
    }

    function drawHandles(nodes, area, unitIndex, kind, parentIndex, color) {
        for (var i = 0; i < nodes.length; i++) {
            var pt = toWorld(nodes[i], area);
            var hit = hoverTarget &&
                hoverTarget.unitIndex === unitIndex &&
                hoverTarget.kind === kind &&
                hoverTarget.parentIndex === parentIndex &&
                hoverTarget.index === i;
            p.fill('#ffffff');
            p.stroke(hit ? '#111111' : color);
            p.strokeWeight(hit ? 2.6 : 1.6);
            p.circle(pt.x, pt.y, kind === 'parent' ? (hit ? 12 : 9) : (hit ? 14 : 10));
        }
    }

    function drawClosedCurve(nodes, area, samples) {
        p.beginShape();
        for (var i = 0; i <= samples; i++) {
            var pt = toWorld(sampleClosed(nodes, i / samples), area);
            p.vertex(pt.x, pt.y);
        }
        p.endShape();
    }

    function drawSpineCurve(unit, area) {
        var samples = spineStepCount(unit);
        p.beginShape();
        for (var i = 0; i <= samples; i++) {
            var pt = toWorld(sampleSpine(unit, i / samples), area);
            p.vertex(pt.x, pt.y);
        }
        p.endShape();
    }

    function drawPolyline(points) {
        p.beginShape();
        for (var i = 0; i < points.length; i++) p.vertex(points[i].x, points[i].y);
        p.endShape();
    }

    // ── Geometry helpers (same approach as whirls.js clip) ───────────────────────

    function _segIntersectT(P, Q, A, B) {
        var rx=Q.x-P.x, ry=Q.y-P.y, sx=B.x-A.x, sy=B.y-A.y;
        var den = rx*sy - ry*sx;
        if (Math.abs(den) < 1e-10) return null;
        var t = ((A.x-P.x)*sy - (A.y-P.y)*sx) / den;
        var u = ((A.x-P.x)*ry - (A.y-P.y)*rx) / den;
        return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : null;
    }

    function _pointInPoly(pt, poly) {
        var inside = false;
        for (var i = 0, j = poly.length-1; i < poly.length; j = i++) {
            var xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
            if (((yi > pt.y) !== (yj > pt.y)) && pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi)
                inside = !inside;
        }
        return inside;
    }

    function _bboxForPoly(poly) {
        var box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (var i = 0; i < poly.length; i++) {
            box.minX = Math.min(box.minX, poly[i].x);
            box.minY = Math.min(box.minY, poly[i].y);
            box.maxX = Math.max(box.maxX, poly[i].x);
            box.maxY = Math.max(box.maxY, poly[i].y);
        }
        return box;
    }

    function _bboxOverlaps(a, b) {
        return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    }

    function _segmentBBox(x1, y1, x2, y2) {
        return {
            minX: Math.min(x1, x2),
            minY: Math.min(y1, y2),
            maxX: Math.max(x1, x2),
            maxY: Math.max(y1, y2)
        };
    }

    function _dedupeSortedTs(ts) {
        ts.sort(function(a,b){ return a - b; });
        var out = [];
        for (var i = 0; i < ts.length; i++) {
            var t = Math.max(0, Math.min(1, ts[i]));
            if (!out.length || Math.abs(t - out[out.length - 1]) > 1e-7) out.push(t);
        }
        return out;
    }

    function _maskCellsForMeshes(meshes) {
        var cells = [];
        for (var m = 0; m < meshes.length; m++) {
            var polys = meshMaskPolygons(meshes[m]);
            for (var i = 0; i < polys.length; i++) {
                if (polys[i].length >= 3 && polygonAreaAbs(polys[i]) > 0.01) {
                    cells.push({ poly: polys[i], bbox: _bboxForPoly(polys[i]) });
                }
            }
        }
        return cells;
    }

    function _pointInAnyMaskCell(pt, cells, segBox) {
        var pointBox = segBox || { minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y };
        for (var i = 0; i < cells.length; i++) {
            if (_bboxOverlaps(pointBox, cells[i].bbox) && _pointInPoly(pt, cells[i].poly)) return true;
        }
        return false;
    }

    function _clipSegOutsideMaskCells(x1, y1, x2, y2, cells) {
        var dx = x2 - x1, dy = y2 - y1;
        var segBox = _segmentBBox(x1, y1, x2, y2);
        var ts = [0, 1];
        var P = { x: x1, y: y1 }, Q = { x: x2, y: y2 };
        for (var c = 0; c < cells.length; c++) {
            if (!_bboxOverlaps(segBox, cells[c].bbox)) continue;
            var poly = cells[c].poly;
            for (var i = 0; i < poly.length; i++) {
                var t = _segIntersectT(P, Q, poly[i], poly[(i + 1) % poly.length]);
                if (t !== null) ts.push(t);
            }
        }
        ts = _dedupeSortedTs(ts);

        var out = [];
        for (var j = 0; j + 1 < ts.length; j++) {
            if (ts[j + 1] - ts[j] < 1e-7) continue;
            var tm = (ts[j] + ts[j + 1]) / 2;
            var mid = { x: x1 + tm * dx, y: y1 + tm * dy };
            if (!_pointInAnyMaskCell(mid, cells)) {
                out.push({
                    x1: x1 + ts[j] * dx,
                    y1: y1 + ts[j] * dy,
                    x2: x1 + ts[j + 1] * dx,
                    y2: y1 + ts[j + 1] * dy
                });
            }
        }
        return out;
    }

    // Clip lower polylines to only the portions visible behind foreground meshes.
    // This uses the same cell polygons as the canvas trim mask instead of a
    // simplified annular silhouette, so folded/twisted tubes cut correctly.
    function svgClipPolylines(polylines, foregroundMeshes) {
        if (!polylines.length) return polylines;
        var maskPolys = _maskPolygonsForMeshes(foregroundMeshes);
        if (maskPolys.length && typeof ClipperLib !== 'undefined') {
            return clipPolylinesOutsidePolygons(polylines, maskPolys);
        }
        var cells = _maskCellsForMeshes(foregroundMeshes);
        if (!cells.length) return polylines;

        var out = [];
        polylines.forEach(function(poly) {
            var current = [];
            for (var i=0; i<poly.length-1; i++) {
                var p1=poly[i], p2=poly[i+1];
                var segs = _clipSegOutsideMaskCells(p1.x, p1.y, p2.x, p2.y, cells);
                // Reassemble surviving segments into continuous runs
                if (!segs.length) {
                    if (current.length >= 2) out.push(current);
                    current = [];
                } else {
                    for (var k=0; k<segs.length; k++) {
                        var sp={x:segs[k].x1, y:segs[k].y1}, ep={x:segs[k].x2, y:segs[k].y2};
                        if (!current.length) {
                            current = [sp, ep];
                        } else if (Math.abs(current[current.length-1].x-sp.x) < 0.5 &&
                                   Math.abs(current[current.length-1].y-sp.y) < 0.5) {
                            current.push(ep);
                        } else {
                            if (current.length >= 2) out.push(current);
                            current = [sp, ep];
                        }
                    }
                }
            }
            if (current.length >= 2) out.push(current);
        });
        return out;
    }

    function _maskPolygonsForMeshes(meshes) {
        var out = [];
        for (var m = 0; m < meshes.length; m++) {
            var polys = meshMaskPolygons(meshes[m]);
            for (var i = 0; i < polys.length; i++) {
                if (polys[i].length >= 3 && polygonAreaAbs(polys[i]) > 0.01) out.push(polys[i]);
            }
        }
        return out;
    }

    function clipPolylinesOutsidePolygons(polylines, polygons) {
        if (!polylines.length || !polygons || !polygons.length || typeof ClipperLib === 'undefined') return polylines;
        var scale = 100;
        var cpr = new ClipperLib.Clipper();
        for (var i = 0; i < polylines.length; i++) {
            if (polylines[i] && polylines[i].length >= 2 && polylineLength(polylines[i]) > 0.01) {
                cpr.AddPath(toClipperPath(polylines[i], scale), ClipperLib.PolyType.ptSubject, false);
            }
        }
        for (var j = 0; j < polygons.length; j++) {
            if (!polygons[j] || polygons[j].length < 3 || polygonAreaAbs(polygons[j]) <= 0.01) continue;
            var path = toClipperPath(polygons[j], scale);
            // Mesh quads can flip orientation on twisted sculptures. Normalize
            // orientation so the NonZero fill rule treats all cells as one mask.
            if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
            cpr.AddPath(path, ClipperLib.PolyType.ptClip, true);
        }
        var tree = new ClipperLib.PolyTree();
        cpr.Execute(
            ClipperLib.ClipType.ctDifference,
            tree,
            ClipperLib.PolyFillType.pftNonZero,
            ClipperLib.PolyFillType.pftNonZero
        );
        return ClipperLib.Clipper.OpenPathsFromPolyTree(tree)
            .map(function(path) { return fromClipperPath(path, scale); })
            .filter(function(path) { return path.length >= 2 && polylineLength(path) > 0.01; });
    }

    function clipPolylinesToRect(polylines, area) {
        var x0 = area.left;
        var y0 = area.top;
        var x1 = area.left + area.width;
        var y1 = area.top + area.height;
        var out = [];
        for (var i = 0; i < polylines.length; i++) {
            var current = [];
            var poly = polylines[i];
            if (!poly || poly.length < 2) continue;
            for (var j = 0; j < poly.length - 1; j++) {
                var clipped = clipLineSegmentToRect(poly[j], poly[j + 1], x0, y0, x1, y1);
                if (!clipped) {
                    if (current.length >= 2) out.push(current);
                    current = [];
                    continue;
                }
                if (!current.length) {
                    current = [clipped[0], clipped[1]];
                } else if (Math.abs(current[current.length - 1].x - clipped[0].x) < 0.5 &&
                           Math.abs(current[current.length - 1].y - clipped[0].y) < 0.5) {
                    current.push(clipped[1]);
                } else {
                    if (current.length >= 2) out.push(current);
                    current = [clipped[0], clipped[1]];
                }
            }
            if (current.length >= 2) out.push(current);
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
        if (t1 - t0 < 1e-7) return null;
        return [
            { x: a.x + dx * t0, y: a.y + dy * t0 },
            { x: a.x + dx * t1, y: a.y + dy * t1 }
        ];
    }

    function meshMaskPolygons(mesh) {
        var cells = [];
        var ribs = mesh.ribs || [];
        if (ribs.length < 2 || ribs[0].length < 2) return cells;
        for (var r = 0; r < ribs.length; r++) {
            var nextR = (r + 1) % ribs.length;
            var samples = Math.min(ribs[r].length, ribs[nextR].length);
            for (var s = 0; s < samples; s++) {
                var nextS = (s + 1) % samples;
                cells.push([
                    ribs[r][s],
                    ribs[nextR][s],
                    ribs[nextR][nextS],
                    ribs[r][nextS]
                ]);
            }
        }
        return cells;
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

    function updateHelpText() {
        if (!helpEl) return;
        helpEl.style.display = PARAMS.showHelp === 'on' ? 'block' : 'none';
        helpEl.textContent = 'Tap a sculpture to select it. Drag to move. Drag corner handles to scale. Drag the top handle to rotate. Layer buttons reorder.';
    }

    function colorWithAlpha(hex, alpha) {
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

    function findHandleHit(pointer) {
        var area = drawingArea();
        var best = null;
        var bestDist = 17;
        for (var u = 0; u < activeCount(); u++) {
            if (u === selectedUnit) {
                best = nearestNode(pointer, area, u, 'spine', -1, sculptures[u].spine, best, bestDist);
                if (best) bestDist = best.dist;
            }
            if (u !== selectedUnit) continue;
            for (var pidx = 0; pidx < sculptures[u].parents.length; pidx++) {
                best = nearestNode(pointer, area, u, 'parent', pidx, projectedParent(sculptures[u], pidx), best, bestDist);
                if (best) bestDist = best.dist;
            }
        }
        return best;
    }

    function nearestNode(pointer, area, unitIndex, kind, parentIndex, nodes, best, bestDist) {
        for (var i = 0; i < nodes.length; i++) {
            var pt = toWorld(nodes[i], area);
            var dist = Math.hypot(pointer.x - pt.x, pointer.y - pt.y);
            if (dist <= bestDist) {
                best = { type: 'node', unitIndex: unitIndex, kind: kind, parentIndex: parentIndex, index: i, dist: dist };
                bestDist = dist;
            }
        }
        return best;
    }

    function findSpineCurveHit(pointer) {
        var area = drawingArea();
        var best = null;
        var bestDist = 26;
        for (var u = 0; u < activeCount(); u++) {
            var detail = spineStepCount(sculptures[u]);
            for (var i = 0; i < detail; i++) {
                var pt = toWorld(sampleSpine(sculptures[u], i / detail), area);
                var dist = Math.hypot(pointer.x - pt.x, pointer.y - pt.y);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { type: 'move', unitIndex: u, dist: dist };
                }
            }
        }
        return best;
    }

    function sculptureWorldBBox(unit) {
        var area = drawingArea();
        var nodes = sculptureNodes(unit);
        var minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
        for (var i=0; i<nodes.length; i++) {
            var w = toWorld(nodes[i], area);
            if(w.x<minX)minX=w.x; if(w.y<minY)minY=w.y;
            if(w.x>maxX)maxX=w.x; if(w.y>maxY)maxY=w.y;
        }
        return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
    }

    function sculptureHandlePos(unit) {
        var bb = sculptureWorldBBox(unit);
        var pad = 18;
        var cx = bb.x + bb.w/2;
        return {
            corners: [
                {x:bb.x-pad,      y:bb.y-pad     },
                {x:bb.x+bb.w+pad, y:bb.y-pad     },
                {x:bb.x+bb.w+pad, y:bb.y+bb.h+pad},
                {x:bb.x-pad,      y:bb.y+bb.h+pad}
            ],
            rotate: {x:cx, y:bb.y-pad-36},
            bbox: {x:bb.x-pad, y:bb.y-pad, w:bb.w+pad*2, h:bb.h+pad*2}
        };
    }

    function drawSculptureHandles(unit) {
        var h = sculptureHandlePos(unit);
        p.push();
        p.blendMode(p.BLEND);
        p.noFill(); p.stroke(80,160,255); p.strokeWeight(1.5);
        p.drawingContext.setLineDash([6,4]);
        p.rect(h.bbox.x, h.bbox.y, h.bbox.w, h.bbox.h, 3);
        p.drawingContext.setLineDash([]);
        p.fill(255); p.strokeWeight(2);
        for (var i=0; i<h.corners.length; i++) p.circle(h.corners[i].x, h.corners[i].y, 28);
        p.fill(80,160,255,180); p.circle(h.rotate.x, h.rotate.y, 28);
        p.noFill(); p.strokeWeight(1); p.stroke(80,160,255,120);
        p.line(h.bbox.x+h.bbox.w/2, h.bbox.y, h.rotate.x, h.rotate.y);
        p.pop();
    }

    function findBBHandle(pointer) {
        if (selectedUnit < 0 || !sculptures[selectedUnit]) return null;
        var h = sculptureHandlePos(sculptures[selectedUnit]);
        if (Math.hypot(pointer.x-h.rotate.x, pointer.y-h.rotate.y) <= 22) {
            return { type:'rotate', unitIndex:selectedUnit };
        }
        for (var ci=0; ci<h.corners.length; ci++) {
            var ch = h.corners[ci];
            if (Math.hypot(pointer.x-ch.x, pointer.y-ch.y) <= 22) {
                return { type:'scale', unitIndex:selectedUnit, ci:ci, opp:h.corners[(ci+2)%4] };
            }
        }
        return null;
    }

    function findMeshHit(pointer) {
        var area = drawingArea();
        var best = null;
        var bestDist = 18;
        for (var u = 0; u < activeCount(); u++) {
            var mesh = buildMesh(sculptures[u], area);
            best = nearestPolylineHit(pointer, mesh.ribs, u, best, bestDist);
            if (best) bestDist = best.dist;
            best = nearestPolylineHit(pointer, mesh.cross, u, best, bestDist);
            if (best) bestDist = best.dist;
        }
        return best;
    }

    function nearestPolylineHit(pointer, polylines, unitIndex, best, bestDist) {
        for (var i = 0; i < polylines.length; i++) {
            var line = polylines[i];
            for (var j = 0; j < line.length - 1; j++) {
                var dist = pointSegmentDistance(pointer, line[j], line[j + 1]);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { type: 'move', unitIndex: unitIndex, dist: dist };
                }
            }
        }
        return best;
    }

    function pointSegmentDistance(pt, a, b) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var len2 = dx * dx + dy * dy;
        var t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        var x = a.x + dx * t;
        var y = a.y + dy * t;
        return Math.hypot(pt.x - x, pt.y - y);
    }

    function findCurveInsertHit(pointer) {
        var area = drawingArea();
        var best = null;
        var bestDist = 18;
        for (var u = 0; u < activeCount(); u++) {
            if (u === selectedUnit) {
                best = nearestCurvePoint(pointer, area, u, 'spine', -1, sculptures[u].spine, best, bestDist);
                if (best) bestDist = best.dist;
            }
            if (u !== selectedUnit) continue;
            for (var pidx = 0; pidx < sculptures[u].parents.length; pidx++) {
                best = nearestCurvePoint(pointer, area, u, 'parent', pidx, projectedParent(sculptures[u], pidx), best, bestDist);
                if (best) bestDist = best.dist;
            }
        }
        return best;
    }

    function findParentCurveHit(pointer) {
        if (selectedUnit < 0 || selectedUnit >= sculptures.length) return null;
        var area = drawingArea();
        var unit = sculptures[selectedUnit];
        var best = null;
        var bestDist = 18;
        for (var pidx = 0; pidx < unit.parents.length; pidx++) {
            best = nearestCurvePoint(pointer, area, selectedUnit, 'parent', pidx, projectedParent(unit, pidx), best, bestDist);
            if (best) bestDist = best.dist;
        }
        if (!best) return null;
        return { type: 'parentScale', unitIndex: selectedUnit, parentIndex: best.parentIndex, dist: best.dist };
    }

    function nearestCurvePoint(pointer, area, unitIndex, kind, parentIndex, nodes, best, bestDist) {
        var detail = kind === 'spine' ? spineStepCount(sculptures[unitIndex]) : Math.max(6, setting(sculptures[unitIndex], 'curveSamples') * 2);
        for (var i = 0; i < detail; i++) {
            var t = i / detail;
            var pt = toWorld(sampleClosed(nodes, t), area);
            var dist = Math.hypot(pointer.x - pt.x, pointer.y - pt.y);
            if (dist <= bestDist) {
                var insertIndex = Math.floor(t * nodes.length) + 1;
                best = { type: 'insert', unitIndex: unitIndex, kind: kind, parentIndex: parentIndex, index: insertIndex, dist: dist };
                bestDist = dist;
            }
        }
        return best;
    }

    function addVertex(hit, pointer) {
        var area = drawingArea();
        var unit = sculptures[hit.unitIndex];
        var norm = clampPoint(toNorm(pointer, area));
        if (hit.kind === 'spine') {
            unit.spine.splice(hit.index % unit.spine.length, 0, norm);
            return;
        }
        unit.parents[hit.parentIndex].splice(
            hit.index % unit.parents[hit.parentIndex].length,
            0,
            inverseProjectedParentPoint(unit, hit.parentIndex, norm, null)
        );
    }

    function removeVertex(hit) {
        var unit = sculptures[hit.unitIndex];
        if (hit.kind === 'spine') {
            if (unit.spine.length > 4) unit.spine.splice(hit.index, 1);
            return;
        }
        var parent = unit.parents[hit.parentIndex];
        if (parent.length > 4) parent.splice(hit.index, 1);
    }

    function moveSculpture(unit, dx, dy) {
        var allNodes = sculptureNodes(unit);
        for (var j = 0; j < allNodes.length; j++) {
            allNodes[j].x += dx;
            allNodes[j].y += dy;
        }
        keepNodesInBounds(allNodes);
    }

    function sculptureNodes(unit) {
        var allNodes = unit.spine.slice();
        for (var i = 0; i < unit.parents.length; i++) {
            Array.prototype.push.apply(allNodes, unit.parents[i]);
        }
        return allNodes;
    }

    function sculptureCenter(unit) {
        return centroid(sculptureNodes(unit));
    }

    function scaleSculpture(unit, center, factor) {
        var nodes = sculptureNodes(unit);
        factor = Math.max(0.08, Math.min(8, factor));
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].x = center.x + (nodes[i].x - center.x) * factor;
            nodes[i].y = center.y + (nodes[i].y - center.y) * factor;
        }
        keepNodesInBounds(nodes);
    }

    function scaleNodes(nodes, center, factor) {
        factor = Math.max(0.08, Math.min(8, factor));
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].x = center.x + (nodes[i].x - center.x) * factor;
            nodes[i].y = center.y + (nodes[i].y - center.y) * factor;
        }
        keepNodesInBounds(nodes);
    }

    function rotateNodes(nodes, center, angle, startNodes, area) {
        var ca = Math.cos(angle);
        var sa = Math.sin(angle);
        var centerWorld = toWorld(center, area);
        for (var i = 0; i < nodes.length; i++) {
            var start = startNodes && startNodes[i] ? startNodes[i] : nodes[i];
            var world = toWorld(start, area);
            var dx = world.x - centerWorld.x;
            var dy = world.y - centerWorld.y;
            var next = toNorm({
                x: centerWorld.x + dx * ca - dy * sa,
                y: centerWorld.y + dx * sa + dy * ca
            }, area);
            nodes[i].x = next.x;
            nodes[i].y = next.y;
        }
        keepNodesInBounds(nodes);
    }

    function moveNodes(nodes, dx, dy) {
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].x += dx;
            nodes[i].y += dy;
        }
        keepNodesInBounds(nodes);
    }

    function keepNodesInBounds(nodes) {
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

    function jiggleSelectedParents() {
        if (selectedUnit < 0 || !sculptures[selectedUnit]) return;
        var unit = sculptures[selectedUnit];
        for (var i = 0; i < unit.parents.length; i++) {
            jiggleClosedNodes(unit.parents[i], 0.035, 0.018);
        }
        keepNodesInBounds(sculptureNodes(unit));
        hoverTarget = null;
        dragTarget = null;
        p.redraw();
    }

    function jiggleSelectedSpine() {
        if (selectedUnit < 0 || !sculptures[selectedUnit]) return;
        var unit = sculptures[selectedUnit];
        jiggleClosedNodes(unit.spine, 0.045, 0.012);
        keepNodesInBounds(sculptureNodes(unit));
        hoverTarget = null;
        dragTarget = null;
        p.redraw();
    }

    function jiggleClosedNodes(nodes, radialAmount, driftAmount) {
        if (!nodes || nodes.length < 3) return;
        var center = centroid(nodes);
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var originalX = node.x;
            var originalY = node.y;
            var accepted = false;
            for (var attempt = 0; attempt < 8; attempt++) {
                var dx = originalX - center.x;
                var dy = originalY - center.y;
                var len = Math.max(0.001, Math.hypot(dx, dy));
                var nx = dx / len;
                var ny = dy / len;
                var tx = -ny;
                var ty = nx;
                var strength = 1 - attempt * 0.10;
                var radial = randomSigned(radialAmount * strength);
                var tangent = randomSigned(radialAmount * 0.65 * strength);
                node.x = originalX + nx * radial + tx * tangent + randomSigned(driftAmount * strength);
                node.y = originalY + ny * radial + ty * tangent + randomSigned(driftAmount * strength);
                if (!closedPathSelfIntersects(nodes)) {
                    accepted = true;
                    break;
                }
            }
            if (!accepted) {
                node.x = originalX;
                node.y = originalY;
            }
        }
    }

    function randomSigned(amount) {
        return (Math.random() * 2 - 1) * amount;
    }

    function randInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    function closedPathSelfIntersects(points) {
        if (!points || points.length < 4) return false;
        for (var i = 0; i < points.length; i++) {
            var a1 = points[i];
            var a2 = points[(i + 1) % points.length];
            for (var j = i + 1; j < points.length; j++) {
                if (Math.abs(i - j) <= 1) continue;
                if (i === 0 && j === points.length - 1) continue;
                var b1 = points[j];
                var b2 = points[(j + 1) % points.length];
                if (segmentsIntersect(a1, a2, b1, b2)) return true;
            }
        }
        return false;
    }

    function segmentsIntersect(a, b, c, d) {
        var o1 = orientation(a, b, c);
        var o2 = orientation(a, b, d);
        var o3 = orientation(c, d, a);
        var o4 = orientation(c, d, b);
        return o1 * o2 < 0 && o3 * o4 < 0;
    }

    function orientation(a, b, c) {
        var v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (Math.abs(v) < 0.000001) return 0;
        return v > 0 ? 1 : -1;
    }

    function polylineSvg(points, stroke, opacity, width) {
        return '<polyline points="' + points.map(function(pt) { return fmt(pt.x) + ',' + fmt(pt.y); }).join(' ') + '" fill="none" stroke="' + stroke + '" stroke-width="' + fmt(width) + '" stroke-linecap="round" stroke-linejoin="round"/>';
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

    function beginMarginClip(area) {
        p.drawingContext.save();
        p.drawingContext.beginPath();
        p.drawingContext.rect(area.left, area.top, area.width, area.height);
        p.drawingContext.clip();
    }

    function endMarginClip() {
        p.drawingContext.restore();
    }

    p.registerSketchAPI = function(register) {
        if (typeof register === 'function') register(api);
    };

    p.setup = function() {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;max-width:900px;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            container.appendChild(helpEl);
            updateHelpText();
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        p.pixelDensity(1);
        p.noLoop();
        buildFieldComposition();
    };

    p.draw = function() {
        var area = drawingArea();
        var strokeW = Math.max(0.3, paper.mmToPixels(PARAMS.penWidthMm));
        p.background('#ffffff');
        paper.drawPaperBorder(p);

        beginMarginClip(area);
        p.strokeWeight(strokeW);
        if (PARAMS.viewMode === 'multiply') p.blendMode(p.MULTIPLY);
        for (var i = 0; i < activeCount(); i++) {
            if (isTrimPreset() && i > 0) drawTrimMask(sculptures[i], area);
            drawMesh(sculptures[i], i, area);
        }
        p.blendMode(p.BLEND);

        for (var j = 0; j < activeCount(); j++) drawParents(sculptures[j], j, area);
        endMarginClip();
        if (selectedUnit >= 0 && sculptures[selectedUnit] && PARAMS.showGuides === 'on') {
            drawSculptureHandles(sculptures[selectedUnit]);
        }
        // Redraw on top: 0" margin or full-bleed content can paint
        // edge-to-edge and cover the border drawn at the top of this
        // function -- keep it visible as the top layer.
        paper.drawPaperBorder(p);
    };

    p.mousePressed = function() {
        if (!pointerIsOnCanvas()) return;
        var pointer = pointerToCanvas();
        var bbHit = findBBHandle(pointer);
        if (bbHit) {
            var unit = sculptures[bbHit.unitIndex];
            var area = drawingArea();
            if (bbHit.type === 'rotate') {
                var rotCenter = sculptureCenter(unit);
                var rotCenterWorld = toWorld(rotCenter, area);
                dragTarget = {
                    type: 'rotate',
                    unitIndex: bbHit.unitIndex,
                    center: rotCenter,
                    centerWorld: rotCenterWorld,
                    startAngle: Math.atan2(pointer.y - rotCenterWorld.y, pointer.x - rotCenterWorld.x),
                    startNodes: sculptureNodes(unit).map(function(node){ return {x:node.x, y:node.y}; })
                };
            } else {
                var opp = bbHit.opp;
                var oppNorm = toNorm(opp, area);
                var pointerNorm = toNorm(pointer, area);
                var startDist = Math.hypot(pointerNorm.x - oppNorm.x, pointerNorm.y - oppNorm.y);
                dragTarget = {
                    type: 'scale',
                    unitIndex: bbHit.unitIndex,
                    center: oppNorm,
                    startDist: Math.max(0.01, startDist),
                    startNodes: sculptureNodes(unit).map(function(n){return{node:n, x:n.x, y:n.y};})
                };
            }
            lastPointer = pointer;
            setSelectedUnit(bbHit.unitIndex);
            p.redraw();
            return false;
        }
        var handleHit = findHandleHit(pointer);
        if (handleHit && p.keyIsDown(16)) {
            removeVertex(handleHit);
            hoverTarget = null;
            p.redraw();
            return false;
        }

        if (rotateModifierDown()) {
            var rotateHit = handleHit || findSpineCurveHit(pointer) || findMeshHit(pointer);
            if (rotateHit) {
                var rotateUnit = sculptures[rotateHit.unitIndex];
                var rotateArea = drawingArea();
                var rotateCenter = sculptureCenter(rotateUnit);
                var rotateCenterWorld = toWorld(rotateCenter, rotateArea);
                dragTarget = {
                    type: 'rotate',
                    unitIndex: rotateHit.unitIndex,
                    center: rotateCenter,
                    centerWorld: rotateCenterWorld,
                    startAngle: Math.atan2(pointer.y - rotateCenterWorld.y, pointer.x - rotateCenterWorld.x),
                    startNodes: sculptureNodes(rotateUnit).map(function(node) {
                        return { x: node.x, y: node.y };
                    })
                };
                lastPointer = pointer;
                setSelectedUnit(rotateHit.unitIndex);
                p.redraw();
                return false;
            }
        }

        dragTarget = handleHit || (p.keyIsDown(16) ? findParentCurveHit(pointer) : null) || findSpineCurveHit(pointer) || findMeshHit(pointer);
        lastPointer = pointer;
        if (dragTarget) {
            setSelectedUnit(dragTarget.unitIndex);
            if (dragTarget.type === 'move' && p.keyIsDown(16)) {
                var scaleUnit = sculptures[dragTarget.unitIndex];
                var center = sculptureCenter(scaleUnit);
                var startNorm = toNorm(pointer, drawingArea());
                var startDist = Math.hypot(startNorm.x - center.x, startNorm.y - center.y);
                dragTarget.type = 'scale';
                dragTarget.center = center;
                dragTarget.startDist = Math.max(0.01, startDist);
                dragTarget.startNodes = sculptureNodes(scaleUnit).map(function(node) {
                    return { node: node, x: node.x, y: node.y };
                });
            }
            if (dragTarget.type === 'parentScale') {
                var parentUnit = sculptures[dragTarget.unitIndex];
                var parent = parentUnit.parents[dragTarget.parentIndex];
                var parentCenter = centroid(parent);
                var displayCenter = toWorld(sampleSpine(parentUnit, dragTarget.parentIndex / parentUnit.parents.length), drawingArea());
                var startDist = Math.hypot(pointer.x - displayCenter.x, pointer.y - displayCenter.y);
                dragTarget.center = parentCenter;
                dragTarget.displayCenter = displayCenter;
                dragTarget.startDist = Math.max(8, startDist);
                dragTarget.startNodes = parent.map(function(node) {
                    return { node: node, x: node.x, y: node.y };
                });
            }
            p.redraw();
            return false;
        }
        if (selectedUnit !== -1) {
            setSelectedUnit(-1);
            hoverTarget = null;
            p.redraw();
            return false;
        }
    };

    p.mouseDragged = function() {
        if (!dragTarget) return;
        invalidateMesh(sculptures[dragTarget.unitIndex]);
        var area = drawingArea();
        var pointer = pointerToCanvas();
        var unit = sculptures[dragTarget.unitIndex];

        if (dragTarget.type === 'move') {
            var prev = toNorm(lastPointer, area);
            var next = toNorm(pointer, area);
            moveSculpture(unit, next.x - prev.x, next.y - prev.y);
            lastPointer = pointer;
            p.redraw();
            return false;
        }

        if (dragTarget.type === 'scale') {
            var scalePointer = toNorm(pointer, area);
            var dist = Math.hypot(scalePointer.x - dragTarget.center.x, scalePointer.y - dragTarget.center.y);
            var factor = Math.max(0.08, Math.min(8, dist / dragTarget.startDist));
            for (var si = 0; si < dragTarget.startNodes.length; si++) {
                var item = dragTarget.startNodes[si];
                item.node.x = item.x;
                item.node.y = item.y;
            }
            scaleSculpture(unit, dragTarget.center, factor);
            p.redraw();
            return false;
        }

        if (dragTarget.type === 'rotate') {
            var rotateAngle = Math.atan2(pointer.y - dragTarget.centerWorld.y, pointer.x - dragTarget.centerWorld.x) - dragTarget.startAngle;
            rotateNodes(sculptureNodes(unit), dragTarget.center, rotateAngle, dragTarget.startNodes, area);
            p.redraw();
            return false;
        }

        if (dragTarget.type === 'parentScale') {
            var parentDist = Math.hypot(pointer.x - dragTarget.displayCenter.x, pointer.y - dragTarget.displayCenter.y);
            var parentFactor = Math.max(0.08, Math.min(8, parentDist / dragTarget.startDist));
            for (var pi = 0; pi < dragTarget.startNodes.length; pi++) {
                var parentItem = dragTarget.startNodes[pi];
                parentItem.node.x = parentItem.x;
                parentItem.node.y = parentItem.y;
            }
            scaleNodes(unit.parents[dragTarget.parentIndex], dragTarget.center, parentFactor);
            p.redraw();
            return false;
        }

        var norm = clampPoint(toNorm(pointer, area));
        if (dragTarget.kind === 'spine') {
            unit.spine[dragTarget.index] = norm;
        } else {
            unit.parents[dragTarget.parentIndex][dragTarget.index] =
                inverseProjectedParentPoint(unit, dragTarget.parentIndex, norm, dragTarget.index);
        }
        p.redraw();
        return false;
    };

    p.mouseReleased = function() {
        dragTarget = null;
        lastPointer = null;
    };

    p.mouseMoved = function() {
        if (!pointerIsOnCanvas()) {
            if (hoverTarget) {
                hoverTarget = null;
                p.redraw();
            }
            return;
        }
        var nextHover = findHandleHit(pointerToCanvas());
        var changed = (!hoverTarget && nextHover) ||
            (hoverTarget && !nextHover) ||
            (hoverTarget && nextHover && (
                hoverTarget.unitIndex !== nextHover.unitIndex ||
                hoverTarget.kind !== nextHover.kind ||
                hoverTarget.parentIndex !== nextHover.parentIndex ||
                hoverTarget.index !== nextHover.index
            ));
        hoverTarget = nextHover;
        if (changed) p.redraw();
    };

    p.doubleClicked = function() {
        if (!pointerIsOnCanvas()) return;
        var pointer = pointerToCanvas();
        var hit = findCurveInsertHit(pointer);
        if (hit) {
            setSelectedUnit(hit.unitIndex);
            addVertex(hit, pointer);
            p.redraw();
            return false;
        }
    };
};
