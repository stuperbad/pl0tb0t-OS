// Combo — compose whole elements taken from the other sketches.
//
// An element here is NOT a lookalike primitive: it is the real sketch, run in a
// hidden p5 instance, with its own saveSVG() output captured and flattened into
// polylines (window.pl0tCaptureSketchGeometry). So an Artproofs element IS an
// artproof, a Whirls element IS a whirl. Nothing is reimplemented, and an
// element cannot drift from the sketch it came from.
//
// Interaction matches Artproofs: click to select, drag to move, handles to
// rotate/scale, click empty canvas to deselect. Per-element controls appear
// only while something is selected, gated on a hidden `_comboSel` input.
window.sketches = window.sketches || {};
window.sketches['combo'] = function (p) {
    var paper = window.makeSketchUtils;

    var PARAMS = {
        paperSize: '9x12',
        margin: 0.5,
        palette: ['#000000', '#e63946'],
        penWidthMm: 0.4,
        showHandles: 'on'
    };

    // The real sketches, by their registry name.
    var SOURCES = [
        { id: 'artproofs',         label: 'Artproofs' },
        { id: 'zigzag',            label: 'Zigzag' },
        { id: 'whirls',            label: 'Whirls' },
        { id: 'lineArrays',        label: 'Line Arrays' },
        { id: 'unbuiltSculptures', label: 'Unbuilt Sculptures' },
        { id: 'circlesFromLines',  label: 'Circles From Lines' },
        { id: 'cmyk',              label: 'CMYK Flow' }
    ];
    var SOURCE_IDS = SOURCES.map(function (s) { return s.id; });

    // saveSVG() exports a source sketch's WHOLE PAGE, so a captured element was
    // an entire artproofs/whirls composition rather than one piece of it --
    // which is why an element looked like a shrunken copy of the whole artboard.
    // Forcing each sketch's own unit-count param down to 1 gives a single
    // element. Sketches with no count param are already single-composition.
    var SINGLE_UNIT = {
        artproofs:         { instanceCount: 1 },
        zigzag:            { blockCount: 1 },
        whirls:            { whirlCount: 1 },
        unbuiltSculptures: { sculptureCount: 1 }
    };

    var els = [];
    var selected = -1;
    var dragTarget = null;
    var globalSeed = 1234567;
    var busyMsg = '';

    function selEl() { return (selected >= 0 && selected < els.length) ? els[selected] : null; }
    function palAt(i) {
        var pal = (PARAMS.palette && PARAMS.palette.length) ? PARAMS.palette : ['#000000'];
        return pal[((i % pal.length) + pal.length) % pal.length];
    }

    // ---- capture ---------------------------------------------------------
    // Normalise captured geometry into a centred unit box so scale/rotate are
    // meaningful regardless of what page size the source sketch drew at.
    function normalize(polys) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        polys.forEach(function (pl) {
            pl.pts.forEach(function (q) {
                if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
                if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
            });
        });
        if (!isFinite(minX) || maxX <= minX || maxY <= minY) return null;
        var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        var half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
        return polys.map(function (pl) {
            return {
                color: pl.color,
                pts: pl.pts.map(function (q) { return { x: (q.x - cx) / half, y: (q.y - cy) / half }; })
            };
        });
    }
    // Everything the source sketch is told: force a single unit, hand it the
    // palette it should draw in, then apply the user's own per-element edits.
    function captureParams(el) {
        var o = {};
        var single = SINGLE_UNIT[el.source];
        if (single) Object.keys(single).forEach(function (k) { o[k] = single[k]; });
        // The palette has to go IN, not be repainted afterwards: the source
        // sketch picks its own per-shape/per-fill colours from it, so recolouring
        // the finished geometry could never reproduce that distribution -- which
        // is why elements ignored the palette before.
        o.palette = ((el.colorMode || 'single') === 'source')
            ? ((PARAMS.palette && PARAMS.palette.length) ? PARAMS.palette.slice() : ['#000000'])
            : [palAt(el.colorIdx)];
        var sv = el.srcValues || {};
        Object.keys(sv).forEach(function (k) { o[k] = sv[k]; });
        return o;
    }
    var _recapTimer = null, _recapFor = null;
    // Each capture runs the real sketch (seconds), so edits are coalesced. The
    // pending target is tracked too: a bare shared timer meant a change to one
    // element could cancel and then re-fire against a different one.
    function scheduleRecapture(el) {
        if (el.loading) return;          // already rebuilding; the edit is in srcValues
        clearTimeout(_recapTimer);
        _recapFor = el;
        _recapTimer = setTimeout(function () {
            var t = _recapFor; _recapFor = null;
            if (t) captureInto(t, false);
        }, 450);
    }
    function captureInto(el, doReseed) {
        el.loading = true;
        busyMsg = 'Building ' + (labelFor(el.source)) + ' element…';
        p.redraw();
        window.pl0tCaptureSketchGeometry(el.source, {
            presetIndex: el.variant,
            params: captureParams(el),
            reseed: !!doReseed
        }).then(function (res) {
            var polys = (res && res.polys) ? res.polys : [];
            el.presetLabels = (res && res.presets) ? res.presets : [];
            if (res && Array.isArray(res.paramDefs) && res.paramDefs.length) el.srcParams = res.paramDefs;
            var n = normalize(polys);
            // Some sources place their single unit randomly and can land it
            // degenerate or off-page, which yields an empty capture. One reseeded
            // retry beats leaving an invisible element on the canvas.
            if (!n && !el._retried) {
                el._retried = true;
                captureInto(el, true);
                return;
            }
            el._retried = false;
            el.geom = n || [];
            el.loading = false;
            busyMsg = n ? '' : ('No geometry came back from ' + el.source + ' — try Reroll');
            if (selEl() === el) syncSelectionUI();
            p.redraw();
        }).catch(function (e) {
            el.loading = false;
            el.geom = [];
            busyMsg = 'Could not build ' + el.source + ': ' + e.message;
            p.redraw();
        });
    }
    function labelFor(id) {
        var s = SOURCES.find(function (x) { return x.id === id; });
        return s ? s.label : id;
    }

    function addElement(sourceId) {
        var mgn = paper.getMarginPixels(PARAMS.margin);
        var el = {
            source: sourceId,
            x: p.width / 2 + (Math.random() - 0.5) * (p.width - mgn * 2) * 0.35,
            y: p.height / 2 + (Math.random() - 0.5) * (p.height - mgn * 2) * 0.35,
            size: Math.min(p.width, p.height) * 0.20,
            rotation: 0,
            variant: 0,
            colorIdx: els.length % Math.max(1, (PARAMS.palette || []).length),
            colorMode: 'single',     // 'single' = one pen | 'source' = the whole palette
            presetLabels: [],
            srcParams: [],           // the source sketch's own param DEFINITIONS
            srcValues: {},           // this element's edits to them
            geom: [],
            loading: true
        };
        els.push(el);
        selected = els.length - 1;
        syncSelectionUI();
        captureInto(el, true);
    }
    function deleteSelected() {
        if (selected < 0) return;
        els.splice(selected, 1);
        selected = -1;
        syncSelectionUI();
        p.redraw();
    }

    // ---- transform / hit -------------------------------------------------
    function worldPts(el, pts) {
        var cos = Math.cos(el.rotation), sin = Math.sin(el.rotation), s = el.size;
        return pts.map(function (q) {
            var x = q.x * s, y = q.y * s;
            return { x: el.x + x * cos - y * sin, y: el.y + x * sin + y * cos };
        });
    }
    function getPointer() {
        var r = p.canvas.getBoundingClientRect();
        return { x: (p.winMouseX - r.left) * (p.width / r.width),
                 y: (p.winMouseY - r.top) * (p.height / r.height) };
    }
    function pointerOnCanvas() {
        if (!p.canvas) return false;
        var r = p.canvas.getBoundingClientRect();
        return p.winMouseX >= r.left && p.winMouseX <= r.right && p.winMouseY >= r.top && p.winMouseY <= r.bottom;
    }
    function handlePos(el) {
        var r = el.size;
        return {
            rotate: { x: el.x + Math.cos(el.rotation - Math.PI / 2) * (r + 18),
                      y: el.y + Math.sin(el.rotation - Math.PI / 2) * (r + 18) },
            scale:  { x: el.x + Math.cos(el.rotation + Math.PI / 4) * (r + 14),
                      y: el.y + Math.sin(el.rotation + Math.PI / 4) * (r + 14) }
        };
    }
    function findHit(ptr) {
        for (var i = els.length - 1; i >= 0; i--) {
            var el = els[i];
            if (i === selected && PARAMS.showHandles === 'on') {
                var h = handlePos(el);
                if (Math.hypot(ptr.x - h.rotate.x, ptr.y - h.rotate.y) < 12) return { idx: i, type: 'rotate' };
                if (Math.hypot(ptr.x - h.scale.x, ptr.y - h.scale.y) < 12) return { idx: i, type: 'scale' };
            }
            if (Math.hypot(ptr.x - el.x, ptr.y - el.y) <= el.size * 1.1) return { idx: i, type: 'move' };
        }
        return null;
    }

    // ---- selection <-> params -------------------------------------------
    function ensureSelInput() {
        var el = document.getElementById('_comboSel');
        if (!el) {
            el = document.createElement('input');
            el.type = 'hidden'; el.id = '_comboSel';
            document.body.appendChild(el);
        }
        return el;
    }
    // Combo's own controls, always present. The selected element's SOURCE
    // controls get appended to this at selection time.
    var BASE_PARAMS = null;
    var SP = 'sp_';   // namespace for source params, so ids can't collide

    function buildParamList() {
        var el = selEl();
        var list = BASE_PARAMS.slice();
        if (!el || !el.srcParams || !el.srcParams.length) return list;
        // Re-declare the source sketch's real controls as Combo controls. They
        // keep their own labels, ranges, options and tips, so an Artproofs
        // element genuinely exposes Artproofs' settings rather than a stand-in.
        el.srcParams.forEach(function (d) {
            var v = (el.srcValues && el.srcValues.hasOwnProperty(d.id)) ? el.srcValues[d.id] : d.value;
            var copy = {
                id: SP + d.id,
                label: d.label || d.id,
                type: d.type || 'range',
                value: v,
                group: 'element',
                tip: d.tip
            };
            if (d.min != null) copy.min = d.min;
            if (d.max != null) copy.max = d.max;
            if (d.step != null) copy.step = d.step;
            if (d.options) copy.options = d.options;
            if (d.multiSelect) copy.multiSelect = d.multiSelect;
            // A source visibleWhen references the source's own ids -- re-point it
            // at the namespaced copies or it would silently never match.
            if (d.visibleWhen) {
                var conds = Array.isArray(d.visibleWhen) ? d.visibleWhen : [d.visibleWhen];
                copy.visibleWhen = conds.map(function (c) {
                    return (c && c.param) ? { param: SP + c.param, values: c.values } : c;
                });
            }
            list.push(copy);
        });
        return list;
    }

    var _syncing = false;
    function syncSelectionUI() {
        var el = selEl();
        ensureSelInput().value = el ? el.source : '';
        _syncing = true;
        if (el) {
            // Repopulate the variant dropdown with THIS source sketch's own preset
            // names, so you pick "Hatched rings", not index 3.
            var vdef = api.params.find(function (x) { return x.id === 'elVariant'; });
            if (vdef) {
                var labels = el.presetLabels || [];
                vdef.options = labels.length
                    ? labels.map(function (l, i) { return { value: String(i), label: l }; })
                    : [{ value: '0', label: '(source has no presets)' }];
                vdef.value = String(Math.min(el.variant, Math.max(0, labels.length - 1)));
            }
            var cdef = api.params.find(function (x) { return x.id === 'elColorMode'; });
            if (cdef) cdef.value = el.colorMode || 'single';

            [['elSize', Math.round(el.size)],
             ['elRotation', Math.round(el.rotation * 180 / Math.PI)],
             ['elColorIdx', el.colorIdx]].forEach(function (pair) {
                var pdef = api.params.find(function (x) { return x.id === pair[0]; });
                if (pdef) pdef.value = pair[1];
                var inp = document.getElementById(pair[0]);
                if (inp) inp.value = pair[1];
                var lbl = document.getElementById(pair[0] + 'Value');
                if (lbl) lbl.textContent = pair[1];
            });
        }
        api.params = buildParamList();
        // Stay guarded THROUGH the rebuild: creating controls fires input
        // events that are indistinguishable from real edits.
        try { if (window.makeSketchApp && window.makeSketchApp.refreshParamUI) window.makeSketchApp.refreshParamUI(); }
        catch (e) {}
        // Release on a later tick so any events queued by the rebuild are also
        // ignored, rather than arriving just after the flag clears.
        setTimeout(function () { _syncing = false; }, 0);
    }

    p.mousePressed = function () {
        if (!pointerOnCanvas()) return;
        var ptr = getPointer(), hit = findHit(ptr);
        if (!hit) {
            if (selected !== -1) { selected = -1; syncSelectionUI(); }
            dragTarget = null; p.redraw(); return;
        }
        var prev = selected;
        selected = hit.idx;
        var el = els[hit.idx];
        if (hit.type === 'move')        dragTarget = { type: 'move', idx: hit.idx, sx: el.x, sy: el.y, px: ptr.x, py: ptr.y };
        else if (hit.type === 'rotate') dragTarget = { type: 'rotate', idx: hit.idx, start: Math.atan2(ptr.y - el.y, ptr.x - el.x) - el.rotation };
        else                            dragTarget = { type: 'scale', idx: hit.idx, d0: Math.hypot(ptr.x - el.x, ptr.y - el.y), s0: el.size };
        if (prev !== selected) syncSelectionUI();
        p.redraw();
        return false;
    };
    p.mouseDragged = function () {
        if (!dragTarget) return;
        var ptr = getPointer(), el = els[dragTarget.idx];
        if (!el) return;
        if (dragTarget.type === 'move') {
            el.x = dragTarget.sx + (ptr.x - dragTarget.px);
            el.y = dragTarget.sy + (ptr.y - dragTarget.py);
        } else if (dragTarget.type === 'rotate') {
            el.rotation = Math.atan2(ptr.y - el.y, ptr.x - el.x) - dragTarget.start;
        } else {
            var d = Math.hypot(ptr.x - el.x, ptr.y - el.y);
            if (dragTarget.d0 > 1) el.size = Math.max(15, dragTarget.s0 * (d / dragTarget.d0));
        }
        p.redraw();
        return false;
    };
    p.mouseReleased = function () { dragTarget = null; };

    // ---- draw ------------------------------------------------------------
    function strokePx() { return Math.max(0.5, paper.mmToPixels(PARAMS.penWidthMm)); }
    // Per element, not global: one element can stay multicolour (as its source
    // sketch generated it) while its neighbours are flattened to a single pen.
    // Some sketches stringify a colour OBJECT into the stroke attribute
    // (zigzag produced literal \[object Object]\), which p5 and the SVG export
    // both render as black. Anything that isn't a usable colour falls back to
    // this element's pen rather than silently going black.
    function validColor(c) {
        return typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(c.trim());
    }
    function colorForStroke(el, srcColor) {
        var mode = el.colorMode || 'single';
        if (mode === 'source' && validColor(srcColor)) return srcColor;
        return palAt(el.colorIdx);
    }

    p.setup = function () {
        var c = paper.createPaperCanvas(p, PARAMS.paperSize);
        c.parent(document.getElementById('make-sketch'));
        p.pixelDensity(1);
        p.noLoop();
        ensureSelInput();
    };
    p.draw = function () {
        p.background(255);
        p.push(); p.noFill(); p.stroke(200); p.strokeWeight(1);
        p.rect(1, 1, p.width - 2, p.height - 2); p.pop();

        els.forEach(function (el, i) {
            if (el.loading) {
                p.push(); p.noFill(); p.stroke(180); p.drawingContext.setLineDash([4, 4]);
                p.circle(el.x, el.y, el.size * 2);
                p.drawingContext.setLineDash([]);
                p.noStroke(); p.fill(150); p.textAlign(p.CENTER); p.textSize(10);
                p.text('building…', el.x, el.y);
                p.pop();
            } else {
                p.push(); p.noFill(); p.strokeWeight(strokePx());
                (el.geom || []).forEach(function (pl) {
                    p.stroke(colorForStroke(el, pl.color));
                    var w = worldPts(el, pl.pts);
                    p.beginShape();
                    w.forEach(function (q) { p.vertex(q.x, q.y); });
                    p.endShape();
                });
                p.pop();
            }
            if (i === selected && PARAMS.showHandles === 'on') drawSelection(el);
        });

        if (busyMsg) {
            p.push(); p.noStroke(); p.fill(120); p.textAlign(p.CENTER); p.textSize(11);
            p.text(busyMsg, p.width / 2, 16); p.pop();
        }
        if (!els.length) {
            p.push(); p.noStroke(); p.fill(170); p.textAlign(p.CENTER); p.textSize(13);
            p.text('Add a real element from another sketch, then click it to edit', p.width / 2, p.height / 2);
            p.pop();
        }
    };
    function drawSelection(el) {
        p.push();
        p.noFill(); p.stroke(124, 77, 255); p.strokeWeight(1);
        p.drawingContext.setLineDash([5, 4]);
        p.circle(el.x, el.y, el.size * 2.15);
        p.drawingContext.setLineDash([]);
        var h = handlePos(el);
        p.fill(124, 77, 255); p.noStroke();
        p.circle(h.rotate.x, h.rotate.y, 10);
        p.rectMode(p.CENTER); p.rect(h.scale.x, h.scale.y, 10, 10, 2); p.rectMode(p.CORNER);
        p.pop();
    }

    // ---- SVG -------------------------------------------------------------
    function f2(n) { return Math.round(n * 100) / 100; }
    function buildSvg() {
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var sw = strokePx();
        var parts = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + dims.width + '" height="' + dims.height +
            '" viewBox="0 0 ' + dims.width + ' ' + dims.height + '">',
            '<rect x="0" y="0" width="' + dims.width + '" height="' + dims.height + '" fill="#ffffff"/>'];
        // one path group per pen colour, so each pen plots as a single layer
        var byColor = {};
        els.forEach(function (el) {
            (el.geom || []).forEach(function (pl) {
                var col = colorForStroke(el, pl.color);
                var w = worldPts(el, pl.pts);
                if (w.length < 2) return;
                var s = 'M' + f2(w[0].x) + ' ' + f2(w[0].y);
                for (var i = 1; i < w.length; i++) s += ' L' + f2(w[i].x) + ' ' + f2(w[i].y);
                (byColor[col] || (byColor[col] = [])).push(s);
            });
        });
        Object.keys(byColor).forEach(function (col) {
            parts.push('<path d="' + byColor[col].join(' ') + '" fill="none" stroke="' + col +
                       '" stroke-width="' + f2(sw) + '" stroke-linecap="round" stroke-linejoin="round"/>');
        });
        parts.push('</svg>');
        return parts.join('\n');
    }
    function downloadSvgString(str, filename) {
        var blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    // ---- params ----------------------------------------------------------
    var api = {
        hasPause: false,
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'palette', label: 'Colors', type: 'colorPalette', maxSelect: 6, group: 'color',
              value: ['#000000', '#e63946'],
              options: [
                { value: '#000000', label: 'Black' }, { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' }, { value: '#ffff00', label: 'Yellow' },
                { value: '#e63946', label: 'Red' }, { value: '#33cc66', label: 'Green' },
                { value: '#3366ff', label: 'Blue' }, { value: '#ff8800', label: 'Orange' },
                { value: 'custom', label: 'Custom' }
              ] },


            { id: 'addArtproofs',  label: 'Add element', type: 'action', buttonLabel: '+ Artproofs',  group: 'general' },
            { id: 'addZigzag',     label: 'Add element', type: 'action', buttonLabel: '+ Zigzag',     group: 'general' },
            { id: 'addWhirls',     label: 'Add element', type: 'action', buttonLabel: '+ Whirls',     group: 'general' },
            { id: 'addLineArrays', label: 'Add element', type: 'action', buttonLabel: '+ Line Arrays', group: 'general' },
            { id: 'addUnbuilt',    label: 'Add element', type: 'action', buttonLabel: '+ Unbuilt Sculptures', group: 'general' },
            { id: 'addCircles',    label: 'Add element', type: 'action', buttonLabel: '+ Circles From Lines', group: 'general' },
            { id: 'addCmyk',       label: 'Add element', type: 'action', buttonLabel: '+ CMYK Flow',  group: 'general' },

            { id: 'deleteEl', label: 'Selected', type: 'action', buttonLabel: '✕ Delete selected', group: 'general',
              visibleWhen: { param: '_comboSel', values: SOURCE_IDS } },
            { id: 'rebuildEl', label: 'Selected', type: 'action', buttonLabel: '⟳ Reroll this element', group: 'general',
              visibleWhen: { param: '_comboSel', values: SOURCE_IDS },
              tip: 'Re-runs the source sketch with a fresh seed and keeps this element\'s position, size and rotation.' },

            { id: 'elSize', label: 'Size', type: 'range', min: 15, max: 500, step: 5, value: 100, group: 'general',
              visibleWhen: { param: '_comboSel', values: SOURCE_IDS },
              tip: 'Radius of the selected element. Also draggable from the square handle.' },
            { id: 'elRotation', label: 'Rotation', type: 'range', min: -180, max: 180, step: 1, value: 0, group: 'general',
              visibleWhen: { param: '_comboSel', values: SOURCE_IDS },
              tip: 'Degrees. Also draggable from the round handle.' },
            { id: 'elVariant', label: 'Style (source preset)', type: 'select', value: '0', group: 'general',
              visibleWhen: { param: '_comboSel', values: SOURCE_IDS },
              options: [{ value: '0', label: '—' }],
              tip: 'The SOURCE sketch\'s own named style presets. The list repopulates for whichever element is selected, so these are exactly the looks that sketch offers.' },
            { id: 'elColorMode', label: 'Element colour', type: 'select', value: 'single', group: 'general',
              visibleWhen: { param: '_comboSel', values: SOURCE_IDS },
              options: [{ value: 'single', label: 'Single pen' }, { value: 'source', label: 'Multicolour (as generated)' }],
              tip: 'Per element. Single pen flattens it to one palette colour; Multicolour keeps the colours the source sketch generated, so one element can be multi-pen while its neighbours are not.' },
            { id: 'elColorIdx', label: 'Pen', type: 'range', min: 0, max: 5, step: 1, value: 0, group: 'general',
              visibleWhen: { param: '_comboSel', values: SOURCE_IDS },
              tip: 'Which palette pen draws this element. Elements sharing a pen export as one layer.' },

            { id: 'showHandles', label: 'Selection handles', type: 'select', value: 'on', group: 'advanced',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'penWidthMm', label: 'Pen width (mm)', type: 'range', min: 0.1, max: 2, step: 0.05, value: 0.4, group: 'advanced' }
        ]),

        regenerate: function () { paper.resizeCanvasToPaper(p, PARAMS.paperSize); p.redraw(); },
        getPlotColors: function () {
            var used = {};
            els.forEach(function (el) {
                if ((el.colorMode || 'single') === 'source') {
                    (el.geom || []).forEach(function (pl) { used[colorForStroke(el, pl.color)] = 1; });
                } else used[palAt(el.colorIdx)] = 1;
            });
            var list = Object.keys(used);
            return list.length ? list : [palAt(0)];
        },
        getSignatureSeed: function () { return globalSeed; },
        reseed: function () {
            globalSeed = Math.floor(Math.random() * 1e8) + 1;
            els.forEach(function (e) { captureInto(e, true); });
        },
        getRecipe: function () {
            return { state: { seed: globalSeed, els: els.map(function (e) {
                return { source: e.source, x: e.x, y: e.y, size: e.size, rotation: e.rotation,
                         variant: e.variant, colorIdx: e.colorIdx, colorMode: e.colorMode,
                         presetLabels: e.presetLabels, srcParams: e.srcParams,
                         srcValues: e.srcValues, geom: e.geom };
            }) } };
        },
        applyRecipe: function (recipe) {
            try {
                var st = recipe && recipe.state;
                if (st && Array.isArray(st.els)) {
                    els = st.els.map(function (e) { return Object.assign({ geom: [], loading: false }, e); });
                    globalSeed = st.seed || globalSeed;
                    selected = -1; syncSelectionUI(); p.redraw();
                }
            } catch (e) {}
        },
        saveSVG: function () {
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || new Date().toISOString().replace(/[:.]/g, '-');
            downloadSvgString(buildSvg(), '90percentart-combo-' + ts + '.svg');
        },
        setParam: function (name, val) {
            var ADD = { addArtproofs: 'artproofs', addZigzag: 'zigzag', addWhirls: 'whirls',
                        addLineArrays: 'lineArrays', addUnbuilt: 'unbuiltSculptures',
                        addCircles: 'circlesFromLines', addCmyk: 'cmyk' };
            if (ADD[name]) { addElement(ADD[name]); return; }
            if (name === 'deleteEl')  { deleteSelected(); return; }
            if (name === 'rebuildEl') { var e0 = selEl(); if (e0) captureInto(e0, true); return; }

            if (name === 'paperSize') { PARAMS.paperSize = val; paper.resizeCanvasToPaper(p, PARAMS.paperSize); p.redraw(); return; }
            if (name === 'margin')    { PARAMS.margin = Number(val); p.redraw(); return; }
            if (name === 'palette')   {
                PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
                els.forEach(function (e) { captureInto(e, false); });   // palette feeds the source sketches
                return;
            }
            if (name === 'penWidthMm'){ PARAMS.penWidthMm = Number(val); p.redraw(); return; }
            if (name === 'showHandles') { PARAMS.showHandles = val; p.redraw(); return; }


            // Source-sketch controls for the selected element.
            if (name.indexOf(SP) === 0) {
                if (_syncing) return;
                var selE = selEl();
                if (!selE) return;
                var srcId = name.slice(SP.length);
                var pdef0 = (selE.srcParams || []).find(function (d) { return d.id === srcId; });
                var pv = val;
                if (pdef0 && (pdef0.type === 'range' || pdef0.type === 'number')) pv = Number(val);
                selE.srcValues = selE.srcValues || {};
                selE.srcValues[srcId] = pv;
                scheduleRecapture(selE);
                return;
            }

            if (_syncing) return;          // don't echo our own control sync back
            var el = selEl();
            if (!el) return;
            if (name === 'elSize')     { el.size = Math.max(15, Number(val)); p.redraw(); }
            if (name === 'elRotation') { el.rotation = Number(val) * Math.PI / 180; p.redraw(); }
            if (name === 'elColorIdx') { el.colorIdx = Math.max(0, Math.round(Number(val))); scheduleRecapture(el); }
            if (name === 'elColorMode') { el.colorMode = val; scheduleRecapture(el); }
            if (name === 'elVariant')  {
                var vi = Math.max(0, Math.round(Number(val)));
                if (vi !== el.variant) { el.variant = vi; captureInto(el); }
            }
        }
    };
    // Snapshot the static controls before any selection mutates api.params.
    BASE_PARAMS = api.params.slice();
    p.registerSketchAPI = function (register) { if (typeof register === 'function') register(api); };
};
