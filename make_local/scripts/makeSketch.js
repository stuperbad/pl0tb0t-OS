 (function(){
    var container = document.getElementById('make-sketch');
    var selector = document.getElementById('sketchSelector');
    var currentP5 = null;
    var registeredApi = null;
    var lastSketchName = null;

    function getParamGroup(pdef) {
        if (pdef.group) return pdef.group;
        var id = pdef.id || '';
        if (id === 'paperSize' || id === 'margin' || id === 'customWidth' || id === 'customHeight') return 'paper';
        if (id === 'palette' || id === 'colorMode' || id === 'viewMode' || id === 'startColor' || id === 'endColor') return 'color';
        if (id === 'density' || id === 'penWidthMm' || id === 'hatchWeight' || id === 'alpha') return 'advanced';
        return 'general';
    }

    function _drawSignatureOverlay() {
        if (!window._signatureConfig || !window._signatureConfig.enabled ||
            !window._signatureConfig.showPreview) return;
        if (!window.Signature || typeof window.Signature.drawSignaturePreview !== 'function') return;
        if (!currentP5 || !currentP5.drawingContext) return;
        // Read margin (inches) from registered API params, fall back to 1 inch
        var marginIn = 1;
        if (registeredApi && Array.isArray(registeredApi.params)) {
            var mp = registeredApi.params.find(function(x) { return x.id === 'margin'; });
            if (mp) marginIn = parseFloat(mp.value) || 1;
        }
        var marginPx = window.makeSketchUtils.getMarginPixels(marginIn);
        var mmToPx   = function(mm) { return window.makeSketchUtils.mmToPixels(mm); };
        var seed = (registeredApi && typeof registeredApi.getSignatureSeed === 'function')
            ? registeredApi.getSignatureSeed() : 0;
        var label = lastSketchName || 'pl0tb0t';
        label = label.charAt(0).toUpperCase() + label.slice(1);
        window.Signature.drawSignaturePreview(
            currentP5.drawingContext, window._signatureConfig,
            currentP5.width, currentP5.height, marginPx, mmToPx, label, seed
        );
    }

    function make(name) {
        // destroy previous instance if present
        try {
            if (currentP5 && typeof currentP5.remove === 'function') currentP5.remove();
        } catch(e) { /* ignore */ }
        currentP5 = null;
        registeredApi = null;
        if (container) container.innerHTML = '';

        var sketchFn = (window.sketches && window.sketches[name]) ? window.sketches[name] : window.sketches['default'];
        if (!sketchFn) {
            console.error('Sketch not found:', name);
            return;
        }

        // create instance
        currentP5 = new p5(function(p){
            // adapter provides a register function; sketches can call p.registerSketchAPI(register)
            p.registerSketchAPI = function(register) {
                if (typeof register === 'function') {
                    register(function(api){ registeredApi = api || registeredApi; });
                }
            };
            // call the chosen sketch function
            try {
                sketchFn(p);
            } catch (err) {
                console.error('Error initializing sketch:', err);
            }
        }, container);

        // attempt to capture the sketch API if the sketch exposes it via p.registerSketchAPI
        setTimeout(function() {
            try {
                if (currentP5 && typeof currentP5.registerSketchAPI === 'function') {
                    currentP5.registerSketchAPI(function(api){ registeredApi = api || registeredApi; });
                }
            } catch (e) { /* ignore */ }
        }, 60);

        lastSketchName = name;
        // Wrap redraw so signature overlay is painted after every draw call
        (function() {
            var _p = currentP5;
            if (!_p) return;
            var _orig = _p.redraw.bind(_p);
            _p.redraw = function() { _orig(); _drawSignatureOverlay(); };
        })();
        // First draw: show signature after the sketch's initial setup completes
        setTimeout(function() { _drawSignatureOverlay(); }, 80);


        // wire global sketchAPI used by the UI controls to sketch methods
        window.sketchAPI = {
            regenerate: function() {
                if (registeredApi && typeof registeredApi.regenerate === 'function') {
                    return registeredApi.regenerate();
                }
                if (currentP5 && typeof currentP5.regenerate === 'function') {
                    return currentP5.regenerate();
                }
            },
            togglePause: function() {
                if (registeredApi && typeof registeredApi.togglePause === 'function') {
                    return registeredApi.togglePause();
                }
                if (currentP5 && typeof currentP5.togglePause === 'function') {
                    return currentP5.togglePause();
                }
                return false;
            }
            ,
            savePNG: function() {
                try {
                    if (!currentP5 || !currentP5.canvas) {
                        alert('No canvas to save.');
                        return;
                    }
                    var data = currentP5.canvas.toDataURL('image/png');
                    var a = document.createElement('a');
                    a.href = data;
                    var ts = new Date().toISOString().replace(/[:.]/g,'-');
                    a.download = '90percentart-'+ (lastSketchName||'sketch') + '-' + ts + '.png';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                } catch (e) {
                    console.error('savePNG failed', e);
                    alert('PNG export failed: ' + e.message);
                }
            },
            saveSVG: function() {
                // prefer sketch-provided SVG export if available
                if (registeredApi && typeof registeredApi.saveSVG === 'function') {
                    try { return registeredApi.saveSVG(); } catch(e) { console.error('registeredApi.saveSVG error', e); }
                }

                // experimental fallback: try to re-render the sketch into an SVG renderer and download
                if (typeof p5 === 'undefined') {
                    alert('SVG export requires p5.');
                    return;
                }
                var svgRenderers = [];
                if (currentP5 && currentP5.SVG) svgRenderers.push(currentP5.SVG);
                if (typeof p5 !== 'undefined' && p5.SVG) svgRenderers.push(p5.SVG);
                if (typeof window !== 'undefined' && window.SVG) svgRenderers.push(window.SVG);
                if (typeof p5 !== 'undefined' && p5.RendererSVG) svgRenderers.push(p5.RendererSVG);

                var svgRenderer = svgRenderers.length ? svgRenderers[0] : null;
                var sketchFn = (window.sketches && window.sketches[lastSketchName]) ? window.sketches[lastSketchName] : window.sketches['default'];
                if (!sketchFn) {
                    alert('No sketch available for SVG export.');
                    return;
                }
                var ts = new Date().toISOString().replace(/[:.]/g,'-');
                var filename = '90percentart-'+ (lastSketchName||'sketch') + '-' + ts + '.svg';
                var fileHandlePromise = null;

                if (window.showSaveFilePicker) {
                    try {
                        fileHandlePromise = window.showSaveFilePicker({
                            suggestedName: filename,
                            types: [{
                                description: 'SVG file',
                                accept: { 'image/svg+xml': ['.svg'] }
                            }]
                        });
                    } catch (pickerErr) {
                        if (pickerErr && pickerErr.name === 'AbortError') return;
                        console.warn('showSaveFilePicker unavailable for SVG export', pickerErr);
                        fileHandlePromise = null;
                    }
                }

                // create hidden container for SVG rendering
                var hidden = document.createElement('div');
                hidden.style.position = 'fixed';
                hidden.style.left = '-99999px';
                hidden.style.top = '0';
                document.body.appendChild(hidden);
                var originalGetElementById = document.getElementById.bind(document);
                document.getElementById = function(id) {
                    if (id === 'make-sketch') return hidden;
                    return originalGetElementById(id);
                };

                var tempP5 = new p5(function(p) {
                    // force createCanvas to use SVG renderer if available
                    var origCreate = p.createCanvas;
                    p.createCanvas = function(w,h) {
                        if (svgRenderer) {
                            try { return origCreate.call(p, w, h, svgRenderer); } catch(e) {}
                        }
                        for (var i = 0; i < svgRenderers.length; i++) {
                            try { return origCreate.call(p, w, h, svgRenderers[i]); } catch(e) {}
                        }
                        return origCreate.call(p, w, h);
                    };
                    // ensure single-frame render
                    p.setup = function() {};
                    p.draw = function() {};
                    try {
                        // initialize sketch (defines setup/draw on this p instance)
                        sketchFn(p);
                    } catch (err) {
                        console.error('Error initializing sketch for SVG export:', err);
                    }
                }, hidden);

                setTimeout(function() {
                    try {
                        if (tempP5 && typeof tempP5.redraw === 'function') tempP5.redraw();
                    } catch (redrawErr) {
                        console.warn('Temporary SVG redraw failed', redrawErr);
                    }
                }, 50);

                // wait a short moment for p5 to run setup/draw, then grab svg
                setTimeout(async function() {
                    try {
                        async function exportSvgWithRetry(attempt) {
                            var svg = null;
                            if (tempP5 && tempP5._renderer && tempP5._renderer.svg) {
                                svg = tempP5._renderer.svg;
                            }
                            if (!svg) svg = hidden.querySelector('svg');
                            if (!svg) {
                                alert('SVG export failed: no <svg> element rendered. The p5.svg renderer may not be loading on this page.');
                                return;
                            }

                            var serializer = new XMLSerializer();
                            var str = serializer.serializeToString(svg);
                            var hasDrawnContent = !!svg.querySelector('path, line, rect, circle, ellipse, polyline, polygon, g');
                            if ((!str || !str.trim() || str.trim() === '<svg xmlns="http://www.w3.org/2000/svg"></svg>' || !hasDrawnContent) && attempt < 2) {
                                if (tempP5 && typeof tempP5.redraw === 'function') tempP5.redraw();
                                await new Promise(function(resolve) { setTimeout(resolve, 250); });
                                return exportSvgWithRetry(attempt + 1);
                            }
                            if (!str || !str.trim() || str.trim() === '<svg xmlns="http://www.w3.org/2000/svg"></svg>' || !hasDrawnContent) {
                                alert('SVG export failed: rendered SVG was empty.');
                                return;
                            }

                            if (fileHandlePromise) {
                                try {
                                    var fileHandle = await fileHandlePromise;
                                    var writable = await fileHandle.createWritable();
                                    await writable.write(str);
                                    await writable.close();
                                    return;
                                } catch (fileErr) {
                                    if (fileErr && fileErr.name === 'AbortError') return;
                                    console.warn('Native file save failed, falling back to download link', fileErr);
                                }
                            }

                            var blob = new Blob([str], {type: 'image/svg+xml;charset=utf-8'});
                            var url = URL.createObjectURL(blob);
                            var a = document.createElement('a');
                            a.href = url;
                            a.download = filename;
                            a.rel = 'noopener';
                            a.style.display = 'none';
                            document.body.appendChild(a);
                            try {
                                a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                            } catch (clickErr) {
                                a.click();
                            }
                            setTimeout(function() {
                                a.remove();
                                URL.revokeObjectURL(url);
                            }, 1000);
                        }

                        await exportSvgWithRetry(0);
                    } catch (e) {
                        console.error('SVG export error', e);
                        alert('SVG export failed: ' + e.message);
                    } finally {
                        document.getElementById = originalGetElementById;
                        try { tempP5.remove(); } catch(e) {}
                        hidden.remove();
                    }
                }, 400);
            }
        };
        // also expose a randomize helper
        // Reseed: light randomize — sketch-specific seeds/fields only
        window.sketchAPI.reseed = function() {
            if (registeredApi && typeof registeredApi.reseed === 'function') {
                try { registeredApi.reseed(); return; } catch(e) {}
            }
            if (typeof window.sketchAPI.regenerate === 'function') window.sketchAPI.regenerate();
        };

        // Snapshot: capture & restore full param state (used by print queue "load into editor")
        window.sketchAPI.getParamsSnapshot = function() {
            if (!registeredApi || !Array.isArray(registeredApi.params)) return [];
            return registeredApi.params
                .filter(function(p) { return p.type !== 'action'; })
                .map(function(p) { return { id: p.id, value: p.value }; });
        };
        window.sketchAPI.applyParamsSnapshot = function(snapshot) {
            if (!snapshot || !Array.isArray(snapshot)) return;
            var origRegen = window.sketchAPI.regenerate;
            window.sketchAPI.regenerate = function() {};
            snapshot.forEach(function(item) {
                if (registeredApi && typeof registeredApi.setParam === 'function') {
                    try { registeredApi.setParam(item.id, item.value); } catch(e) {}
                }
                var el = document.getElementById(item.id);
                if (el) { el.value = item.value; el.dispatchEvent(new Event('input')); }
            });
            window.sketchAPI.regenerate = origRegen;
            if (origRegen) origRegen();
        };

        window.sketchAPI.getRecipe = function() {
            var base = {
                type: 'pl0tb0t-sketch-recipe',
                version: 1,
                sketch: lastSketchName || 'sketch',
                params: window.sketchAPI.getParamsSnapshot ? window.sketchAPI.getParamsSnapshot() : [],
                state: null
            };
            if (registeredApi && typeof registeredApi.getRecipe === 'function') {
                try {
                    var custom = registeredApi.getRecipe() || {};
                    return Object.assign(base, custom, {
                        type: custom.type || base.type,
                        version: custom.version || base.version,
                        sketch: custom.sketch || base.sketch,
                        params: Array.isArray(custom.params) ? custom.params : base.params
                    });
                } catch(e) {
                    console.error('registeredApi.getRecipe error', e);
                }
            }
            return base;
        };

        window.sketchAPI.applyRecipe = function(recipe) {
            if (!recipe || typeof recipe !== 'object') return;
            if (registeredApi && typeof registeredApi.applyRecipe === 'function') {
                try {
                    registeredApi.applyRecipe(recipe);
                    return;
                } catch(e) {
                    console.error('registeredApi.applyRecipe error', e);
                }
            }
            if (Array.isArray(recipe.params)) window.sketchAPI.applyParamsSnapshot(recipe.params);
            if (registeredApi && typeof registeredApi.applyRecipeState === 'function') {
                try { registeredApi.applyRecipeState(recipe.state || {}, recipe); }
                catch(e) { console.error('registeredApi.applyRecipeState error', e); }
            }
        };

        // ShuffleLayout: randomize position+scale only, no art param changes
        window.sketchAPI.redraw = function() {
            try { if (currentP5 && typeof currentP5.redraw === 'function') currentP5.redraw();
                  else _drawSignatureOverlay(); } catch(e) {}
        };
        window.sketchAPI.shuffleLayout = function() {
            if (registeredApi && typeof registeredApi.shuffleLayout === 'function') {
                try { registeredApi.shuffleLayout(); } catch(e) { console.error(e); }
            }
        };

        // Randomize: full randomize of creative params (not paper, not advanced)
        window.sketchAPI.randomize = function() {
            if (registeredApi && typeof registeredApi.randomize === 'function') {
                try { registeredApi.randomize(); return; } catch(e) { console.error(e); }
            }
            if (!registeredApi || !Array.isArray(registeredApi.params)) return;
            var origRegen = window.sketchAPI.regenerate;
            window.sketchAPI.regenerate = function() {}; // suppress per-param redraws
            registeredApi.params.forEach(function(pdef) {
                var group = getParamGroup(pdef);
                if (group === 'paper' || group === 'advanced') return;
                if (pdef.type === 'action') return;
                var val;
                if (pdef.type === 'colorPalette') {
                    var opts = (pdef.options || []).filter(function(o) {
                        return o.value && o.value !== 'custom';
                    });
                    if (!opts.length) return;
                    var maxSel = Math.max(1, Math.min(pdef.maxSelect || 6, opts.length));
                    var count = 1 + Math.floor(Math.random() * maxSel);
                    var pool = opts.map(function(o) { return o.value; });
                    val = [];
                    while (val.length < count && pool.length) {
                        val.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
                    }
                    pdef.value = val;
                    if (typeof pdef._setUIValue === 'function') {
                        pdef._setUIValue(val);
                    } else if (registeredApi && typeof registeredApi.setParam === 'function') {
                        try { registeredApi.setParam(pdef.id, val); } catch(e) {}
                    }
                    return;
                } else if (pdef.type === 'color') {
                    val = '#' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');
                } else if (pdef.type === 'select') {
                    var opts = pdef.options || [];
                    if (!opts.length) return;
                    val = opts[Math.floor(Math.random() * opts.length)].value;
                } else if (pdef.type === 'range' || pdef.type === 'number' || !pdef.type) {
                    var lo = Number(pdef.min || 0), hi = Number(pdef.max || 100), st = Number(pdef.step || 1);
                    val = lo + Math.floor(Math.random() * (Math.floor((hi - lo) / st) + 1)) * st;
                    val = Math.min(hi, val);
                } else { return; }
                pdef.value = val;
                var el = document.getElementById(pdef.id);
                if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
                else if (registeredApi && typeof registeredApi.setParam === 'function') {
                    try { registeredApi.setParam(pdef.id, val); } catch(e) {}
                }
            });
            window.sketchAPI.regenerate = origRegen;
            if (origRegen) origRegen();
        };

        // update parameter UI if sketch provides params
        setTimeout(function(){
            try {
                var paramsContainer = document.getElementById('dynamicParams');
                var staticControls = document.getElementById('staticControls');
                var groupMeta = {
                    paper:    { title: 'Paper',    open: false },
                    general:  { title: 'General',  open: true  },
                    arcs:     { title: 'Arcs',     open: true  },
                    wedges:   { title: 'Wedges',   open: true  },
                    textures: { title: 'Textures', open: true  },
                    color:    { title: 'Color',    open: true  },
                    advanced: { title: 'Advanced', open: false }
                };
                // clear existing dynamic
                if (paramsContainer) paramsContainer.innerHTML = '';
                var params = (registeredApi && registeredApi.params) ? registeredApi.params : null;
                if (!paramsContainer) return;

                function ensureGroup(name) {
                    var existing = document.getElementById('param-group-' + name);
                    if (existing) return existing.querySelector('.param-group-body');

                    var details = document.createElement('details');
                    details.className = 'param-group';
                    details.id = 'param-group-' + name;
                    if (groupMeta[name] && groupMeta[name].open) details.open = true;

                    var summary = document.createElement('summary');
                    summary.textContent = (groupMeta[name] && groupMeta[name].title) ? groupMeta[name].title : name;

                    var body = document.createElement('div');
                    body.className = 'param-group-body';

                    details.appendChild(summary);
                    details.appendChild(body);
                    paramsContainer.appendChild(details);
                    return body;
                }

                // Pre-create only the groups used by the active sketch, in a stable order.
                // This keeps Artproofs-only groups from leaking into Whirls and other sketches.
                var preferredGroups = ['paper', 'general', 'arcs', 'wedges', 'textures', 'color', 'advanced'];
                var groupsInUse = {};
                (params || []).forEach(function(pdef) { groupsInUse[getParamGroup(pdef)] = true; });
                preferredGroups.forEach(function(k) { if (groupsInUse[k]) ensureGroup(k); });
                Object.keys(groupsInUse).forEach(function(k) {
                    if (preferredGroups.indexOf(k) === -1) ensureGroup(k);
                });

                function getParamValue(id) {
                    var input = document.getElementById(id);
                    if (!input) return undefined;
                    return input.value;
                }

                function normalizeValues(values) {
                    return Array.isArray(values) ? values.map(String) : [String(values)];
                }

                function applyConditionalUI(params) {
                    (params || []).forEach(function(pdef) {
                        var row = document.querySelector('[data-param-id="' + pdef.id + '"]');
                        if (!row) return;

                        if (pdef.visibleWhen && pdef.visibleWhen.param) {
                            var currentValue = getParamValue(pdef.visibleWhen.param);
                            var allowedValues = normalizeValues(pdef.visibleWhen.values || []);
                            var _activeVals;
                            try { var _pa=JSON.parse(currentValue); _activeVals=Array.isArray(_pa)?_pa.map(String):[String(currentValue)]; }
                            catch(e) { _activeVals=[String(currentValue)]; }
                            row.style.display = _activeVals.some(function(v){return allowedValues.indexOf(v)!==-1;}) ? '' : 'none';
                        } else {
                            row.style.display = '';
                        }

                        var labelSpan = row.querySelector('.param-label-text');
                        if (labelSpan) {
                            var labelText = pdef.label || pdef.id;
                            if (pdef.labelByValue && pdef.labelByValue.param) {
                                var labelValue = getParamValue(pdef.labelByValue.param);
                                var mapped = pdef.labelByValue.values || {};
                                labelText = Object.prototype.hasOwnProperty.call(mapped, labelValue) ? mapped[labelValue] : (mapped.default || labelText);
                            }
                            labelSpan.textContent = labelText;
                        }
                    });
                }

                if (params && params.length && paramsContainer) {
                    // hide static controls
                    if (staticControls) staticControls.style.display = 'none';
                    params.forEach(function(pdef){
                        var row = document.createElement('div');
                        row.className = 'mb-3';
                        row.setAttribute('data-param-id', pdef.id);

                        var label = document.createElement('label');
                        label.className = 'control-label';
                        var spanLabel = document.createElement('span');
                        spanLabel.className = 'param-label-text';
                        spanLabel.textContent = pdef.label || pdef.id;
                        var spanValue = document.createElement('span');
                        spanValue.className = 'value';
                        spanValue.id = pdef.id + 'Value';
                        spanValue.textContent = (typeof pdef.value !== 'undefined') ? pdef.value : '';
                        label.appendChild(spanLabel);
                        label.appendChild(spanValue);

                        if (pdef.type === 'colorPalette') {
                            var maxSel = pdef.maxSelect || 6;
                            var stdOpts = (pdef.options || []).filter(function(o){ return o.value !== 'custom'; });
                            var hasCustomOpt = (pdef.options || []).some(function(o){ return o.value === 'custom'; });
                            var initVal = Array.isArray(pdef.value) ? pdef.value : [];
                            var selStd = initVal.filter(function(v){ return stdOpts.some(function(o){ return o.value === v; }); });
                            var nonStd = initVal.filter(function(v){ return !stdOpts.some(function(o){ return o.value === v; }); });
                            var custColor = nonStd.length ? nonStd[0] : (pdef.customColor || '#ff69b4');
                            var custSel = nonStd.length > 0;
                            spanValue.textContent = initVal.length >= maxSel ? 'max' : initVal.length + ' selected';

                            function selCount(){ return selStd.length + (custSel ? 1 : 0); }
                            function getFinal(){ var a = selStd.slice(); if (custSel) a.push(custColor); return a; }
                            // Order strip — shows selected colors in gradient order, draggable to reorder
                            var orderStrip = document.createElement('div');
                            orderStrip.style.cssText = 'display:none;flex-wrap:wrap;align-items:center;gap:4px;margin-top:7px;';
                            var orderHint = document.createElement('span');
                            orderHint.style.cssText = 'font-size:9px;color:#999;white-space:nowrap;';
                            orderHint.textContent = 'gradient order →';

                            var rebuildOrderStrip = function() {
                                orderStrip.innerHTML = '';
                                var cols = getFinal();
                                if (cols.length < 2) { orderStrip.style.display = 'none'; return; }
                                orderStrip.style.display = 'flex';
                                orderStrip.appendChild(orderHint);
                                var dragSrcIdx = null;
                                cols.forEach(function(col, idx) {
                                    var d = document.createElement('div');
                                    d.draggable = true;
                                    d.title = 'Drag to reorder gradient';
                                    d.style.cssText = 'width:20px;height:20px;border-radius:3px;background:'+col+';border:2px solid #ccc;cursor:grab;flex-shrink:0;';
                                    d.addEventListener('dragstart', function(e) {
                                        dragSrcIdx = idx;
                                        e.dataTransfer.effectAllowed = 'move';
                                        setTimeout(function(){ d.style.opacity='0.35'; }, 0);
                                    });
                                    d.addEventListener('dragend', function() {
                                        d.style.opacity = '';
                                        orderStrip.querySelectorAll('div').forEach(function(x){ x.style.outline=''; });
                                    });
                                    d.addEventListener('dragover', function(e) {
                                        if (idx === dragSrcIdx) return;
                                        e.preventDefault();
                                        d.style.outline = '2px solid #111';
                                    });
                                    d.addEventListener('dragleave', function() { d.style.outline = ''; });
                                    d.addEventListener('drop', function(e) {
                                        e.preventDefault();
                                        d.style.outline = '';
                                        if (dragSrcIdx === null || idx === dragSrcIdx) return;
                                        var srcColor = cols[dragSrcIdx];
                                        // Reorder selStd; custom is always appended last by getFinal
                                        var fi = selStd.indexOf(srcColor);
                                        var ti = selStd.indexOf(col);
                                        if (fi !== -1 && ti !== -1) {
                                            selStd.splice(fi, 1);
                                            selStd.splice(ti, 0, srcColor);
                                        }
                                        dragSrcIdx = null;
                                        emitPal();
                                    });
                                    orderStrip.appendChild(d);
                                });
                            };

                            function emitPal() {
                                var c = getFinal();
                                pdef.value = c; pdef.customColor = custColor;
                                spanValue.textContent = c.length >= maxSel ? 'max' : c.length + ' selected';
                                window.controls = window.controls || {};
                                window.controls[pdef.id] = c;
                                if (registeredApi && typeof registeredApi.setParam === 'function') {
                                    try { registeredApi.setParam(pdef.id, c); } catch(e) {}
                                }
                                applyConditionalUI(params);
                                if (typeof window.sketchAPI.regenerate === 'function') window.sketchAPI.regenerate();
                                rebuildOrderStrip();
                            }

                            var pgrid = document.createElement('div');
                            pgrid.className = 'palette-grid';
                            var custInputRow, custSwEl, custInputEl, custItem;
                            var paletteItemsByValue = {};

                            function updMax() {
                                pgrid.querySelectorAll('.palette-item').forEach(function(el){
                                    el.classList.toggle('at-max', selCount() >= maxSel && !el.classList.contains('selected'));
                                });
                            }

                            stdOpts.forEach(function(opt) {
                                var item = document.createElement('div');
                                item.className = 'palette-item';
                                var sw = document.createElement('div');
                                sw.className = 'palette-swatch';
                                sw.style.background = opt.value;
                                var lbl2 = document.createElement('span');
                                lbl2.className = 'palette-label';
                                lbl2.textContent = opt.label;
                                item.appendChild(sw); item.appendChild(lbl2);
                                if (selStd.indexOf(opt.value) !== -1) item.classList.add('selected');
                                paletteItemsByValue[opt.value] = item;
                                item.addEventListener('click', function() {
                                    var isSel = item.classList.contains('selected');
                                    if (!isSel && selCount() >= maxSel) return;
                                    if (isSel) { item.classList.remove('selected'); selStd.splice(selStd.indexOf(opt.value), 1); }
                                    else { item.classList.add('selected'); selStd.push(opt.value); }
                                    updMax(); emitPal();
                                });
                                pgrid.appendChild(item);
                            });

                            if (hasCustomOpt) {
                                custItem = document.createElement('div');
                                custItem.className = 'palette-item';
                                custSwEl = document.createElement('div');
                                custSwEl.className = 'palette-swatch';
                                custSwEl.style.background = custSel ? custColor : 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)';
                                var custLbl = document.createElement('span');
                                custLbl.className = 'palette-label';
                                custLbl.textContent = 'Custom';
                                custItem.appendChild(custSwEl); custItem.appendChild(custLbl);
                                if (custSel) custItem.classList.add('selected');

                                custInputRow = document.createElement('div');
                                custInputRow.style.display = custSel ? '' : 'none';
                                custInputEl = document.createElement('input');
                                custInputEl.type = 'color';
                                custInputEl.value = custColor;
                                custInputEl.className = 'form-control form-control-sm';
                                custInputEl.style.cssText = 'height:28px;margin-top:6px';
                                custInputEl.addEventListener('input', function() {
                                    custColor = custInputEl.value;
                                    custSwEl.style.background = custColor;
                                    emitPal();
                                });
                                custInputRow.appendChild(custInputEl);

                                custItem.addEventListener('click', function() {
                                    var isSel = custItem.classList.contains('selected');
                                    if (!isSel && selCount() >= maxSel) return;
                                    if (isSel) {
                                        custItem.classList.remove('selected');
                                        custSel = false;
                                        custSwEl.style.background = 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)';
                                        custInputRow.style.display = 'none';
                                    } else {
                                        custItem.classList.add('selected');
                                        custSel = true;
                                        custSwEl.style.background = custColor;
                                        custInputRow.style.display = '';
                                    }
                                    updMax(); emitPal();
                                });
                                pgrid.appendChild(custItem);
                            }

                            pdef._setUIValue = function(values) {
                                var next = Array.isArray(values) ? values.map(String) : [];
                                selStd = next.filter(function(v) {
                                    return stdOpts.some(function(o) { return o.value === v; });
                                }).slice(0, maxSel);
                                var nonStd = next.filter(function(v) {
                                    return !stdOpts.some(function(o) { return o.value === v; });
                                });
                                if (hasCustomOpt && nonStd.length && selStd.length < maxSel) {
                                    custColor = nonStd[0];
                                    custSel = true;
                                } else {
                                    custSel = false;
                                }
                                Object.keys(paletteItemsByValue).forEach(function(value) {
                                    paletteItemsByValue[value].classList.toggle('selected', selStd.indexOf(value) !== -1);
                                });
                                if (custItem && custSwEl && custInputRow) {
                                    custItem.classList.toggle('selected', custSel);
                                    custSwEl.style.background = custSel ? custColor : 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)';
                                    custInputRow.style.display = custSel ? '' : 'none';
                                    if (custInputEl) custInputEl.value = custColor;
                                }
                                updMax();
                                var c = getFinal();
                                pdef.value = c;
                                spanValue.textContent = c.length >= maxSel ? 'max' : c.length + ' selected';
                                window.controls = window.controls || {};
                                window.controls[pdef.id] = c;
                                if (registeredApi && typeof registeredApi.setParam === 'function') {
                                    try { registeredApi.setParam(pdef.id, c); } catch(e) {}
                                }
                                applyConditionalUI(params);
                                rebuildOrderStrip();
                            };

                            updMax();
                            rebuildOrderStrip();
                            row.appendChild(label); row.appendChild(pgrid);
                            if (custInputRow) row.appendChild(custInputRow);
                            row.appendChild(orderStrip);
                            ensureGroup(getParamGroup(pdef)).appendChild(row);
                            return;
                        }

                        if (pdef.type === 'action') {
                            row.className = 'mb-0 d-inline-block';
                            if (spanValue) spanValue.style.display = 'none';
                            var actionButton = document.createElement('button');
                            actionButton.type = 'button';
                            actionButton.id = pdef.id;
                            actionButton.className = 'btn btn-outline-primary';
                            actionButton.style.cssText = 'margin:4px 4px 0 0;font-size:13px;padding:5px 10px;border-radius:10px;line-height:1.35;width:auto;';
                            actionButton.textContent = pdef.buttonLabel || pdef.label || pdef.id;
                            actionButton.addEventListener('click', function() {
                                window.controls = window.controls || {};
                                window.controls[pdef.id] = true;
                                if (registeredApi && typeof registeredApi.setParam === 'function') {
                                    try { registeredApi.setParam(pdef.id, true); } catch(e) {}
                                }
                                applyConditionalUI(params);
                                if (typeof window.sketchAPI.regenerate === 'function') window.sketchAPI.regenerate();
                            });
                            row.appendChild(actionButton);
                            ensureGroup(getParamGroup(pdef)).appendChild(row);
                            return;
                        }

                        var input;
                        if ((pdef.type === 'range') || pdef.type === undefined) {
                            input = document.createElement('input');
                            input.type = 'range';
                            input.min = pdef.min || 0;
                            input.max = pdef.max || 100;
                            input.step = (typeof pdef.step !== 'undefined') ? pdef.step : 1;
                            input.value = (typeof pdef.value !== 'undefined') ? pdef.value : input.min;
                        } else if (pdef.type === 'number') {
                            input = document.createElement('input');
                            input.type = 'number';
                            input.min = pdef.min || 0;
                            input.max = pdef.max || 100000;
                            input.step = (typeof pdef.step !== 'undefined') ? pdef.step : 1;
                            input.value = (typeof pdef.value !== 'undefined') ? pdef.value : input.min;
                        } else if (pdef.type === 'select') {
                            // Hidden input stores value; compatible with applyParamsSnapshot/applyConditionalUI
                            // When pdef.multiSelect===true, value is a JSON array string; chips toggle independently
                            input = document.createElement('input');
                            input.type = 'hidden';
                            var _multi = !!pdef.multiSelect;
                            if (_multi) {
                                var _iv = Array.isArray(pdef.value) ? pdef.value
                                    : (pdef.value ? [String(pdef.value)] : (pdef.options && pdef.options[0] ? [String(pdef.options[0].value)] : []));
                                input.value = JSON.stringify(_iv);
                            } else {
                                input.value = (typeof pdef.value !== 'undefined') ? String(pdef.value)
                                    : ((pdef.options && pdef.options[0]) ? String(pdef.options[0].value) : '');
                            }
                            // Segmented chip group (the visible touch control)
                            var _segCtrl = document.createElement('div');
                            _segCtrl.className = 'seg-ctrl';
                            (function(_inp, _sc, _opts, _isMulti) {
                                function _getArr() { try { var _a=JSON.parse(_inp.value); return Array.isArray(_a)?_a:[_inp.value]; } catch(e){ return [_inp.value]; } }
                                function _isActive(v) { return _isMulti ? _getArr().indexOf(v)>=0 : _inp.value===v; }
                                function _syncChips() { _sc.querySelectorAll('.seg-btn').forEach(function(b){ b.classList.toggle('seg-active', _isActive(b.dataset.segVal)); }); }
                                _opts.forEach(function(opt) {
                                    var btn = document.createElement('button');
                                    btn.type = 'button';
                                    btn.className = 'seg-btn' + (_isActive(String(opt.value)) ? ' seg-active' : '');
                                    btn.textContent = opt.label || String(opt.value);
                                    btn.dataset.segVal = String(opt.value);
                                    btn.addEventListener('click', function() {
                                        if (_isMulti) {
                                            var arr=_getArr(), idx=arr.indexOf(String(opt.value));
                                            if (idx>=0) { if (arr.length>1) arr.splice(idx,1); }
                                            else arr.push(String(opt.value));
                                            _inp.value=JSON.stringify(arr);
                                        } else {
                                            _inp.value = String(opt.value);
                                        }
                                        _syncChips();
                                        _inp.dispatchEvent(new Event('input'));
                                    });
                                    _sc.appendChild(btn);
                                });
                                // Sync chip visuals when value set externally (applyParamsSnapshot)
                                _inp.addEventListener('input', _syncChips);
                            })(input, _segCtrl, pdef.options || [], _multi);
                            input._segCtrl = _segCtrl;
                        } else if (pdef.type === 'color') {
                            input = document.createElement('input');
                            input.type = 'color';
                            input.value = pdef.value || '#000000';
                            if (spanValue) spanValue.style.display = 'none'; // swatch is its own indicator
                        } else {
                            input = document.createElement('input'); input.type = 'text'; input.value = pdef.value || '';
                        }

                        input.id = pdef.id;
                        input.className = 'form-control form-control-sm';
                        function commitInputValue() {
                            var val = (input.type==='range' || input.type==='number') ? Number(input.value) : input.value;
                            if (spanValue) spanValue.textContent = input.value;
                            window.controls = window.controls || {};
                            window.controls[pdef.id] = val;
                            if (registeredApi && typeof registeredApi.setParam === 'function') {
                                try { registeredApi.setParam(pdef.id, val); } catch(e){}
                            }
                            applyConditionalUI(params);
                            if (typeof window.sketchAPI.regenerate === 'function') window.sketchAPI.regenerate();
                        }
                        // on change handler
                        input.addEventListener('input', commitInputValue);
                        if (input.tagName && input.tagName.toLowerCase() === 'select') {
                            input.addEventListener('change', commitInputValue);
                        }

                        row.appendChild(label);
                        if (input._segCtrl) row.appendChild(input._segCtrl);
                        row.appendChild(input);
                        ensureGroup(getParamGroup(pdef)).appendChild(row);
                    });
                    applyConditionalUI(params);
                } else {
                    if (staticControls) staticControls.style.display = '';
                }

                // show/hide pause button based on sketch capability
                var pauseBtn = document.getElementById('pause');
                if (pauseBtn) {
                    var supportsPause = !(registeredApi && registeredApi.hasPause === false);
                    pauseBtn.style.display = supportsPause ? '' : 'none';
                    pauseBtn.textContent = 'Pause'; // reset label on sketch switch
                }
                var shuffleBtn = document.getElementById('shuffleLayout');
                if (shuffleBtn) shuffleBtn.style.display = (registeredApi && typeof registeredApi.shuffleLayout === 'function') ? '' : 'none';
            } catch(e) { console.error('build param UI error', e); }
        }, 80);
    }

    window.makeSketchApp = {
        make: make,
        remakeCurrent: function() {
            make((selector && selector.value) ? selector.value : (lastSketchName || 'default'));
        },
        getCurrentSketchName: function() {
            return (selector && selector.value) ? selector.value : lastSketchName;
        }
    };

    // create initial sketch based on selector value
    if (selector) {
        selector.addEventListener('change', function(){
            make(selector.value);
        });
        make(selector.value || 'default');
    } else {
        // no selector present - fallback to default
        make('default');
    }
})();
