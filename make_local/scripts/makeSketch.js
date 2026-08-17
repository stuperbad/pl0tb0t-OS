 (function(){
    var container = document.getElementById('make-sketch');
    var selector = document.getElementById('sketchSelector');
    var currentP5 = null;
    var registeredApi = null;
    var lastSketchName = null;
    var _lastBuiltParams = null;   // registeredApi.params + buildParamUI's own generic injections (paper, advanced, etc.)
    // Row currently being dragged in Edit layout mode. Shared between the
    // per-row dragstart handlers (rebuilt fresh every buildParamUI call) and
    // the per-group dragover/drop handlers (bound ONCE when a group's DOM is
    // first created and never rebuilt), so it has to live at module scope --
    // not as a buildParamUI()-local var, which those persistent listeners
    // would see a stale copy of after the first sketch switch.
    var draggedRow = null;
    // Per-launch random fallback for the signature/print name, used when the
    // active sketch doesn't supply its own getSignatureSeed(). Re-rolled on Reseed.
    if (typeof window._pl0tSigSeed === 'undefined' || !window._pl0tSigSeed) {
        window._pl0tSigSeed = Math.floor(Math.random() * 1e9) + 1;
    }

    function isShowHidden(pdef) {
        return !!(pdef.showModeHidden || (window.ParamLayout && window.ParamLayout.getShowHidden(pdef.id)));
    }
    function isSuppressed(pdef) {
        return !!(window.ParamLayout && window.ParamLayout.getSuppressed(pdef.id));
    }

    // Rebuild on every Edit-layout toggle. This is what makes suppressed rows
    // actually disappear when edit mode turns off (the suppress-skip guard in
    // buildParamUI only runs at build time, so without a rebuild a row that
    // was suppressed mid-session would just keep sitting in the DOM). It also
    // covers editable min/max "snapping in" to the live control for free --
    // a rebuilt <input> picks up ParamLayout.getBounds() fresh, which already
    // has whatever the operator just typed (Min/Max fields save on every
    // change), so there's no separate live-patch step needed. buildParamUI()
    // itself is registeredApi-driven, not a Home/Show mode switch, so this
    // never touches window._pl0tMode or triggers a render.
    if (window.ParamLayout) {
        window.ParamLayout.onEditModeChange(function() { try { buildParamUI(registeredApi); } catch(e) {} });
    }

    // A hidden-in-Show-mode numeric param's "Show default" (Edit layout mode)
    // is substituted only for the duration of a Show-mode session -- never
    // written into the live Home-mode slider permanently, so switching back
    // to Home mode restores exactly what the operator had before, protecting
    // art in progress. _showModeStash holds the pre-substitution values.
    var _showModeStash = null;
    function applyShowModeLockedDefaults() {
        if ((window._pl0tMode || 'fast') === 'full') return;
        if (!window.ParamLayout || _showModeStash) return;   // already applied this Show-mode session
        var stash = {};
        (_lastBuiltParams || []).forEach(function(pdef) {
            if (!isShowHidden(pdef)) return;
            if (pdef.type !== 'range' && pdef.type !== 'number' && pdef.type !== undefined) return;
            var b = window.ParamLayout.getBounds(pdef.id);
            if (!b || b.def === undefined || b.def === '' || b.def === null) return;
            var v = Number(b.def);
            if (isNaN(v)) return;
            stash[pdef.id] = (typeof pdef.value !== 'undefined') ? pdef.value : v;
            pdef.value = v;
            window.controls = window.controls || {};
            window.controls[pdef.id] = v;
            if (registeredApi && typeof registeredApi.setParam === 'function') { try { registeredApi.setParam(pdef.id, v); } catch(e) {} }
            var el = document.getElementById(pdef.id);
            if (el) el.value = v;
        });
        if (Object.keys(stash).length) _showModeStash = stash;
    }
    function restoreShowModeStash() {
        if (!_showModeStash) return;
        var stash = _showModeStash;
        _showModeStash = null;
        Object.keys(stash).forEach(function(id) {
            var v = stash[id];
            var pdefFound = (_lastBuiltParams || []).find(function(p) { return p.id === id; });
            if (pdefFound) pdefFound.value = v;
            window.controls = window.controls || {};
            window.controls[id] = v;
            if (registeredApi && typeof registeredApi.setParam === 'function') { try { registeredApi.setParam(id, v); } catch(e) {} }
            var el = document.getElementById(id);
            if (el) el.value = v;
        });
    }

    function getParamGroup(pdef) {
        // A user-dragged placement (Edit layout mode) always wins over the
        // sketch/code default -- that's the whole point of letting it be dragged.
        if (window.ParamLayout) {
            var override = window.ParamLayout.getGroup(pdef.id);
            if (override) return override;
        }
        if (pdef.group) return pdef.group;
        var id = pdef.id || '';
        if (id === 'paperSize' || id === 'margin' || id === 'customWidth' || id === 'customHeight') return 'paper';
        if (id === 'palette' || id === 'colorMode' || id === 'viewMode' || id === 'startColor' || id === 'endColor') return 'color';
        // penWidthMm intentionally NOT auto-bucketed to 'advanced' -- pen width is
        // now set per pen-type in the Pens panel (window.plotPens), so a manual
        // per-sketch override slider doesn't belong in the global Advanced group.
        if (id === 'density' || id === 'hatchWeight' || id === 'alpha') return 'advanced';
        return 'general';
    }

    // Paper controls (paperSize/customWidth/customHeight/margin/landscape) are
    // injected generically like Draw order etc (same placement/format as always),
    // but their backing store is the GLOBAL paperSettings.js module, shared by
    // every sketch. Route a change to that store; returns true if id was a paper field.
    var PAPER_ID_MAP = { paperSize: 'paperSize', customWidth: 'customWidth', customHeight: 'customHeight', margin: 'margin' };
    function routePaperChange(id, pv) {
        if (!window.PaperSettings) return false;
        if (PAPER_ID_MAP[id]) {
            var key = PAPER_ID_MAP[id];
            var v = (key === 'margin' || key === 'customWidth' || key === 'customHeight') ? Number(pv) : pv;
            window.PaperSettings.set(key, v);
            return true;
        }
        if (id === 'landscape') { window.PaperSettings.set('orientation', pv === 'on' ? 'landscape' : 'portrait'); return true; }
        return false;
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
            ? registeredApi.getSignatureSeed() : (window._pl0tSigSeed || 0);
        var DISPLAY_NAMES = {
            'cmyk':             'CMYK Flow',
            'artproofs':        'Artproofs',
            'circlesFromLines': 'Circles From Lines',
            'lineArrays':       'Line Arrays',
            'zigzag':           'Zigzag',
            'whirls':           'Whirls',
            'unbuiltSculptures':'Unbuilt Sculptures',
            'patternTest':      'Pattern Test',
            'calibration':      'Calibration',
            'svgUpload':        'SVG Upload',
            'imageTrace':       'Image Trace'
        };
        var label = DISPLAY_NAMES[lastSketchName] ||
            (lastSketchName ? lastSketchName.charAt(0).toUpperCase() + lastSketchName.slice(1) : 'pl0tb0t');
        var _pal = null;
        if (window.sketchAPI && window.sketchAPI.getPlotColors) { try { _pal = window.sketchAPI.getPlotColors(); } catch(e){} }
        if ((!_pal || !_pal.length) && registeredApi && Array.isArray(registeredApi.params)) {
            var _pp = registeredApi.params.find(function(x){ return x.id === 'palette'; });
            if (_pp && Array.isArray(_pp.value)) _pal = _pp.value;
        }
        var _sigCol = window.Signature.pickSignatureColor ? window.Signature.pickSignatureColor(_pal) : '#000000';
        window.Signature.drawSignaturePreview(
            currentP5.drawingContext, window._signatureConfig,
            currentP5.width, currentP5.height, marginPx, mmToPx, label, seed, _sigCol
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
        // Wrap draw so "Signature only" (window._signatureConfig.onlySignature) can
        // short-circuit the sketch's own art -- centralised here so no per-sketch
        // changes are needed. Wrap redraw so the signature overlay is painted after
        // every draw call.
        (function() {
            var _p = currentP5;
            if (!_p) return;
            var _origDraw = _p.draw;
            _p.draw = function() {
                if (window._signatureConfig && window._signatureConfig.onlySignature) {
                    _p.background(255);
                    if (window.makeSketchUtils && window.makeSketchUtils.drawPaperBorder) window.makeSketchUtils.drawPaperBorder(_p);
                    return;
                }
                if (typeof _origDraw === 'function') _origDraw();
            };
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
                    var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
                var ts = _slug || new Date().toISOString().replace(/[:.]/g,'-');
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
                var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
                var ts = _slug || new Date().toISOString().replace(/[:.]/g,'-');
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
                state: null,
                // global authorship settings (paper now; more later) so the recipe is a
                // complete snapshot -- "edit from queue" restores the exact paper size.
                globals: (window.PaperSettings ? { paper: Object.assign({}, window.PaperSettings.get()) } : undefined)
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
            // Global authorship settings (paper) travel in recipe.globals; legacy recipes
            // carried paperSize/margin/custom* inside params[] -> adopt those as a fallback.
            // Set the global BEFORE the sketch applies params so the resize below uses it.
            if (window.PaperSettings) {
                if (recipe.globals && recipe.globals.paper) window.PaperSettings.adopt(recipe.globals.paper);
                else if (Array.isArray(recipe.params)) window.PaperSettings.adoptFromParams(recipe.params);
            }
            if (registeredApi && typeof registeredApi.applyRecipe === 'function') {
                try {
                    registeredApi.applyRecipe(recipe);
                    try { if (window.sketchAPI.regenerate) window.sketchAPI.regenerate(); } catch(e) {}
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
        setTimeout(function(){ buildParamUI(registeredApi); }, 80);
    }

    // Groups that live in the far-left "global authorship" column instead of
    // the per-sketch controls on the right -- true across every sketch, not
    // specific to the one on screen. That container is never cleared on a
    // sketch switch (unlike #dynamicParams), so ensureGroup() below clears an
    // already-existing global group's body itself before repopulating it,
    // rather than relying on the container wipe every other group gets.
    var GLOBAL_GROUPS = { paper: true, advanced: true };

    function buildParamUI(registeredApi) {
            // A fresh params array means any stashed pre-Show-mode values belong to
            // the PREVIOUS sketch's pdefs/registeredApi -- discard rather than risk
            // restoring stale values into whatever sketch is active when Home mode
            // is next entered. applyShowModeLockedDefaults() re-stashes below if
            // still in Show mode.
            _showModeStash = null;
            try {
                var paramsContainer = document.getElementById('dynamicParams');
                var globalParamsContainer = document.getElementById('globalDynamicParams');
                // ensureGroup() is called once PER ROW (not once per group) as controls
                // are placed, so a global group's body must only be cleared on the FIRST
                // touch in this build pass -- clearing on every call would wipe out each
                // previously-placed row, leaving only the last one.
                var _clearedGlobalGroupsThisBuild = {};
                var staticControls = document.getElementById('staticControls');
                var groupMeta = {
                    pens:     { title: 'Pens',     open: false },
                    paper:    { title: 'Paper',    open: false },
                    general:  { title: 'General',  open: true  },
                    orientation: { title: 'Orientation', open: true },
                    arcs:     { title: 'Arcs',     open: true  },
                    wedges:   { title: 'Wedges',   open: true  },
                    textures: { title: 'Textures', open: true  },
                    closedshapes: { title: 'Texture Closed Shapes', open: true },
                    color:    { title: 'Color',    open: true  },
                    advanced: { title: 'Advanced', open: false }
                };
                // Preserve group open/closed state across rebuilds (pens edits etc.)
                var _openState = {};
                if (paramsContainer) {
                    paramsContainer.querySelectorAll('details.param-group').forEach(function(d) {
                        _openState[d.id] = d.open;
                    });
                }
                // clear existing dynamic
                if (paramsContainer) paramsContainer.innerHTML = '';
                var params = (registeredApi && registeredApi.params) ? registeredApi.params : null;
                // Paper (size/margin/custom W&H) carries across sketch switches via the
                // global paperSettings.js module (window._paperSettings), not a per-sketch
                // default -- see the 'paperSize' injection block below.
                // Home mode: color palettes select from the global pen registry
                // (window._pl0tPens, pushed by the OS). The sketch keeps its own
                // options in Show mode / when no registry is set.
                var _regApplied = false;
                if (params && (window._pl0tMode || 'fast') === 'full' &&
                    window.plotPens && window.plotPens.pens().length) {
                    params.forEach(function(pdef) {
                        if (pdef.type !== 'colorPalette') return;
                        var regOpts = window.plotPens.pens().map(function(pn) {
                            return { value: pn.color, label: pn.label || pn.color };
                        });
                        pdef.options = regOpts;
                        pdef._regHidden = true;   // pens strip is the selector; hide this row
                        var cur = Array.isArray(pdef.value) ? pdef.value.filter(function(v) {
                            return regOpts.some(function(o) { return String(o.value).toLowerCase() === String(v).toLowerCase(); });
                        }) : [];
                        // First sync for this sketch instance: always pick a fresh multi-pen
                        // default. A coincidental 1-color match against the sketch's hardcoded
                        // default (e.g. ['#000000']) shouldn't silently lock the user to one pen.
                        if (!pdef._regSynced || !cur.length) {
                            cur = regOpts.slice(0, Math.min(pdef.maxSelect || 4, regOpts.length)).map(function(o) { return o.value; });
                        }
                        pdef._regSynced = true;
                        pdef.value = cur;
                        if (registeredApi && typeof registeredApi.setParam === 'function') {
                            try { registeredApi.setParam(pdef.id, cur); } catch(e) {}
                        }
                        _regApplied = true;
                    });
                    if (_regApplied) { try { scheduleRender(); } catch(e) {} }
                }
                // Show mode: the Machine-tab "Show Mode Palette" defines the
                // available colours for every Show-mode colour picker. (Home
                // mode uses the live pen registry above instead.)
                if (params && (window._pl0tMode || 'fast') !== 'full' &&
                    Array.isArray(window._pl0tShowPalette) && window._pl0tShowPalette.length) {
                    params.forEach(function(pdef) {
                        if (pdef.type !== 'colorPalette') return;
                        pdef.options = window._pl0tShowPalette.map(function(c) { return { value: c, label: c }; });
                        var opts = pdef.options;
                        var cur = Array.isArray(pdef.value) ? pdef.value.filter(function(v) {
                            return opts.some(function(o) { return String(o.value).toLowerCase() === String(v).toLowerCase(); });
                        }) : [];
                        if (!cur.length) cur = opts.slice(0, Math.min(pdef.maxSelect || 4, opts.length)).map(function(o) { return o.value; });
                        pdef.value = cur;
                        if (registeredApi && typeof registeredApi.setParam === 'function') { try { registeredApi.setParam(pdef.id, cur); } catch(e) {} }
                    });
                }
                // Inject global fill params that apply to all sketches
                if (params && !params.some(function(p){return p.id==='penLiftFills';}) && !(registeredApi && registeredApi.hideGlobalFillIds && registeredApi.hideGlobalFillIds.indexOf('penLiftFills') !== -1)) {
                    params = params.concat([{ id:'penLiftFills', label:'Pen lifts during fills', type:'select',
                        value:'off', group:'textures', showModeHidden:true,
                        options:[{value:'off',label:'Off (connected)'},{value:'on',label:'On (lift pen)'}] }]);
                }
                if (params && !params.some(function(p){return p.id==='scatterFill';}) && !(registeredApi && registeredApi.hideGlobalScatter)) {
                    params = params.concat([{ id:'scatterFill', label:'Scatter fills', type:'select', multiSelect:true, value:[], group:'textures', showModeHidden:true,
                        options:[{value:'sprigFill',label:'Scatter sprig'},{value:'ribbonFill',label:'Scatter ribbon'},{value:'crossFill',label:'Scatter cross'},{value:'asteriskFill',label:'Scatter asterisk'}] }]);
                }
                if (params && !params.some(function(p){return p.id==='fillAngle';}) && !(registeredApi && registeredApi.hideGlobalFillIds && registeredApi.hideGlobalFillIds.indexOf('fillAngle') !== -1)) {
                    params = params.concat([{ id:'fillAngle', label:'Fill angle', type:'range', min:0, max:180, step:5, value:0, group:'textures', showModeHidden:true }]);
                }
                if (params && !params.some(function(p){return p.id==='fillImperfection';}) && !(registeredApi && registeredApi.hideGlobalFillIds && registeredApi.hideGlobalFillIds.indexOf('fillImperfection') !== -1)) {
                    params = params.concat([{ id:'fillImperfection', label:'Stroke imperfection', type:'range', min:0, max:100, step:5, value:0, group:'textures', showModeHidden:true }]);
                }
                if (params && !params.some(function(p){return p.id==='fillDensity';}) && !(registeredApi && registeredApi.hideGlobalFillIds && registeredApi.hideGlobalFillIds.indexOf('fillDensity') !== -1)) {
                    params = params.concat([{ id:'fillDensity', label:'Fill density', type:'range', min:30, max:150, step:5, value:50, group:'textures', showModeHidden:true }]);
                }
                // Per-fill density multipliers: one appears for each fill that is
                // currently selected (structural fills watch 'fillStyle', scatter
                // fills watch 'scatterFill'). Each scales the global Fill density
                // for just that fill, default 1x.
                if (params && !(registeredApi && registeredApi.hideGlobalFillIds && registeredApi.hideGlobalFillIds.indexOf('fillDensity') !== -1)) {
                    var _fillMultDefs = [
                        {k:'contour',n:'Contour',w:'fillStyle'}, {k:'spiral',n:'Spiral',w:'fillStyle'},
                        {k:'hatch',n:'Hatch',w:'fillStyle'}, {k:'sketchHatch',n:'Chaotic hatch',w:'fillStyle'},
                        {k:'squiggleHatch',n:'Squiggle',w:'fillStyle'}, {k:'zigzagHatch',n:'Zigzag',w:'fillStyle'},
                        {k:'crosshatch',n:'Crosshatch',w:'fillStyle'}, {k:'waves',n:'Waves',w:'fillStyle'},
                        {k:'sprigFill',n:'Scatter sprig',w:'scatterFill'}, {k:'ribbonFill',n:'Scatter ribbon',w:'scatterFill'},
                        {k:'crossFill',n:'Scatter cross',w:'scatterFill'}, {k:'asteriskFill',n:'Scatter asterisk',w:'scatterFill'}
                    ];
                    _fillMultDefs.forEach(function(fm){
                        var pid = 'fillMult_' + fm.k;
                        if (!params.some(function(p){ return p.id === pid; })) {
                            params = params.concat([{ id:pid, label:fm.n + ' density', type:'mult', min:0.25, max:3, step:0.25, value:1, group:'textures', showModeHidden:true,
                                visibleWhen:[{ param: fm.w, values:[fm.k] }] }]);
                        }
                    });
                }
                if (params && !params.some(function(p){return p.id==='fillProb';}) && !(registeredApi && registeredApi.hideGlobalFillIds && registeredApi.hideGlobalFillIds.indexOf('fillProb') !== -1)) {
                    params = params.concat([{ id:'fillProb', label:'% cells filled', type:'range', min:0, max:100, step:5, value:100, group:'textures', showModeHidden:true }]);
                }
                // Paper: same placement/format as always (generic injection, 'paper'
                // group, positioned near the top like Landscape/Draw order below) --
                // but the backing store is the GLOBAL paperSettings.js module now, not
                // a per-sketch default, so every sketch shows/shares the same paper.
                if (params && !params.some(function(p){return p.id==='paperSize';})) {
                    var _ps = (window.PaperSettings && window.PaperSettings.get()) || (window.PaperSettings && window.PaperSettings.DEFAULTS) || {};
                    params = params.concat([
                        { id: 'paperSize', label: 'Paper size', type: 'select', showModeHidden: true, group: 'paper',
                          value: _ps.paperSize || '9x12',
                          options: [
                              { value: '5x7', label: '5 x 7"' },
                              { value: '9x12',   label: '9 x 12"' },
                              { value: '11x14', label: '11 x 14"' },
                              { value: '11x17', label: '11 x 17"' },
                              { value: '14x17', label: '14 x 17"' },
                              { value: 'custom', label: 'Custom...' }
                          ] },
                        { id: 'customWidth', label: 'Width (inches)', type: 'number', showModeHidden: true, group: 'paper',
                          value: _ps.customWidth != null ? _ps.customWidth : 8.5, min: 1, max: 48, step: 0.25,
                          visibleWhen: { param: 'paperSize', values: ['custom'] } },
                        { id: 'customHeight', label: 'Height (inches)', type: 'number', showModeHidden: true, group: 'paper',
                          value: _ps.customHeight != null ? _ps.customHeight : 11, min: 1, max: 48, step: 0.25,
                          visibleWhen: { param: 'paperSize', values: ['custom'] } },
                        { id: 'margin', label: 'Margin', type: 'select', showModeHidden: true, group: 'paper',
                          value: String(_ps.margin != null ? _ps.margin : 1),
                          options: [
                              { value: '0', label: '0 (none)' },
                              { value: '0.5', label: '1/2 inch' },
                              { value: '0.75', label: '3/4 inch' },
                              { value: '1', label: '1 inch' }
                          ] }
                    ]);
                }
                if (params && !params.some(function(p){return p.id==='landscape';})) {
                    var _psO = (window.PaperSettings && window.PaperSettings.get()) || {};
                    params = params.concat([{ id:'landscape', label:'Orientation', type:'select',
                        value: (_psO.orientation === 'landscape') ? 'on' : 'off', group:'paper',
                        options:[{value:'off',label:'Portrait'},{value:'on',label:'Landscape'}] }]);
                }
                if (params && !params.some(function(p){return p.id==='plotHorizontal';})) {
                    params = params.concat([{ id:'plotHorizontal', label:'Plot horizontal', type:'select',
                        value: window._pl0tPlotHorizontal ? 'on' : 'off', group:'advanced', showModeHidden:true,
                        options:[{value:'off',label:'Off'},{value:'on',label:'On (rotate plot 90\u00b0)'}] }]);
                }
                if (params && !params.some(function(p){return p.id==='drawOrder';})) {
                    params = params.concat([{ id:'drawOrder', label:'Draw order', type:'select',
                        value: window._pl0tDrawOrder || 'lightest_to_darkest', group:'advanced', showModeHidden:true,
                        tip: 'Order pens are picked up in for a multi-color plot. Left to right = by physical holder position (leftmost first). Lightest to darkest = by ink luminance, darkest passes go down last. Synced with the Machine tab\'s Pen Holder Management panel.',
                        options:[{value:'lightest_to_darkest',label:'Lightest to darkest'},{value:'left_to_right',label:'Left to right'}] }]);
                }
                if (params && !params.some(function(p){return p.id==='delayRender';})) {
                    params = params.concat([{ id:'delayRender', label:'Delay render', type:'select',
                        value: window._pl0tDelayRender ? 'on' : 'off', group:'advanced', showModeHidden:true,
                        options:[{value:'off',label:'Off (live)'},{value:'on',label:'On (manual)'}] }]);
                }
                // Paper/orientation/plotHorizontal/drawOrder/delayRender etc. above are
                // injected into this LOCAL `params` array, not registeredApi.params -- the
                // sketch itself never declares them. setRenderMode() needs their
                // visibleWhen conditions (e.g. Custom Width only when Paper size =
                // Custom) to correctly re-sync visibility when switching Home/Show mode,
                // so the fully-augmented list is captured here for it to read.
                _lastBuiltParams = params;
                if (!paramsContainer) return;

                function ensureGroup(name) {
                    var isGlobal = !!GLOBAL_GROUPS[name];
                    var existing = document.getElementById('param-group-' + name);
                    if (existing) {
                        var existingBody = existing.querySelector('.param-group-body');
                        // Global groups' container persists across sketch switches (unlike
                        // #dynamicParams, which is fully wiped every rebuild), so an existing
                        // global group needs its OWN body cleared here or re-populating it
                        // would append duplicate rows on top of the last sketch's -- but only
                        // on the FIRST touch this build pass (ensureGroup is called once per
                        // row placed, not once per group).
                        if (isGlobal && existingBody && !_clearedGlobalGroupsThisBuild[name]) {
                            existingBody.innerHTML = '';
                            _clearedGlobalGroupsThisBuild[name] = true;
                        }
                        return existingBody;
                    }

                    var details = document.createElement('details');
                    details.className = 'param-group';
                    details.id = 'param-group-' + name;
                    if (groupMeta[name] && groupMeta[name].open) details.open = true;
                    if (Object.prototype.hasOwnProperty.call(_openState, 'param-group-' + name)) details.open = _openState['param-group-' + name];

                    var summary = document.createElement('summary');
                    summary.textContent = (groupMeta[name] && groupMeta[name].title) ? groupMeta[name].title : name;

                    var body = document.createElement('div');
                    body.className = 'param-group-body';
                    if (isGlobal) _clearedGlobalGroupsThisBuild[name] = true;   // freshly-created body starts empty; no need to clear it again this pass

                    // Drop target for Edit-layout drag/reorder. 'pens' is excluded --
                    // it's a custom chip editor (buildPensEditor), not a list of plain
                    // param rows. Bound ONCE here (groups persist across rebuilds, this
                    // branch only runs the first time a group's DOM is created), so this
                    // must read live/global state (window.ParamLayout, getParamGroup,
                    // _lastBuiltParams) rather than anything captured from the current
                    // buildParamUI() call, which will be stale after the next sketch switch.
                    if (name !== 'pens') {
                        body.addEventListener('dragover', function(e) {
                            if (!draggedRow || !window.ParamLayout || !window.ParamLayout.isEditMode()) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            body.classList.add('drag-over');
                        });
                        body.addEventListener('dragleave', function(e) {
                            if (e.target === body) body.classList.remove('drag-over');
                        });
                        body.addEventListener('drop', function(e) {
                            if (!draggedRow) return;
                            e.preventDefault();
                            body.classList.remove('drag-over');
                            var rows = Array.prototype.filter.call(body.children, function(el) {
                                return el.hasAttribute('data-param-id') && el !== draggedRow;
                            });
                            var before = null;
                            for (var i = 0; i < rows.length; i++) {
                                var r = rows[i].getBoundingClientRect();
                                if (e.clientY < r.top + r.height / 2) { before = rows[i]; break; }
                            }
                            if (before) body.insertBefore(draggedRow, before); else body.appendChild(draggedRow);

                            var newGroup = name;
                            var draggedId = draggedRow.getAttribute('data-param-id');
                            if (window.ParamLayout && draggedId) {
                                var pdefFound = (_lastBuiltParams || []).find(function(p) { return p.id === draggedId; });
                                var priorGroup = pdefFound ? getParamGroup(pdefFound) : null;
                                if (priorGroup !== newGroup) window.ParamLayout.setGroup(draggedId, newGroup);
                                var idsNow = Array.prototype.filter.call(body.children, function(el) {
                                    return el.hasAttribute('data-param-id');
                                }).map(function(el) { return el.getAttribute('data-param-id'); });
                                window.ParamLayout.setOrder(newGroup, idsNow);
                            }
                            draggedRow.classList.remove('drag-ghost');
                            draggedRow = null;
                        });
                    }

                    details.appendChild(summary);
                    details.appendChild(body);
                    var target = (isGlobal && globalParamsContainer) ? globalParamsContainer : paramsContainer;
                    target.appendChild(details);
                    return body;
                }

                function buildPensEditor(body) {
                    if (!body) return;
                    body.innerHTML = '';
                    var pens = window.plotPens.pens();
                    var types = window.plotPens.types();
                    var palDef = (params && params.find) ? params.find(function(p) { return p.type === 'colorPalette'; }) : null;
                    var maxSel = palDef ? (palDef.maxSelect || 6) : 10;
                    function commit(next, editIdx) {
                        window._pl0tPenEditIdx = (typeof editIdx === 'number') ? editIdx : null;
                        window.plotPens.setPens(next);
                        try { buildParamUI(registeredApi); } catch(e) {}
                    }
                    function isSel(colorHex) {
                        if (!palDef || !Array.isArray(palDef.value)) return false;
                        return palDef.value.some(function(v) { return String(v).toLowerCase() === String(colorHex).toLowerCase(); });
                    }
                    function toggleSel(i) {
                        if (!palDef) return;
                        var colorHex = pens[i].color;
                        var vals = Array.isArray(palDef.value) ? palDef.value.slice() : [];
                        var idx = -1;
                        for (var k = 0; k < vals.length; k++) {
                            if (String(vals[k]).toLowerCase() === String(colorHex).toLowerCase()) idx = k;
                        }
                        if (idx >= 0) {
                            if (vals.length <= 1) return;   // keep at least one pen selected
                            vals.splice(idx, 1);
                        } else {
                            if (vals.length >= maxSel) return;
                            vals.push(colorHex);
                        }
                        palDef.value = vals;
                        if (typeof palDef._setUIValue === 'function') {
                            try { palDef._setUIValue(vals); } catch(e) {}
                        } else {
                            window.controls = window.controls || {};
                            window.controls[palDef.id] = vals;
                            if (registeredApi && typeof registeredApi.setParam === 'function') {
                                try { registeredApi.setParam(palDef.id, vals); } catch(e) {}
                            }
                        }
                        updateChipSel();
                        maybeRegen();
                    }

                    var hint = document.createElement('div');
                    hint.style.cssText = 'font-size:11px;color:#667085;margin-bottom:4px;';
                    hint.textContent = 'Rightmost = slot 1. Tap a pen to edit it; double-tap to toggle it on/off for this sketch' + (palDef ? ' (max ' + maxSel + ')' : '') + '; drag to reorder.';
                    body.appendChild(hint);

                    var setsRow = document.createElement('div');
                    setsRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;justify-content:flex-end;flex-wrap:wrap;';
                    var setsLbl = document.createElement('span');
                    setsLbl.style.cssText = 'font-size:10px;color:#98a2b3;';
                    setsLbl.textContent = 'Sets:';
                    setsRow.appendChild(setsLbl);
                    [['CMYK Stabilo', 'stabilo'], ['CMYK Micron', 'micron']].forEach(function(sd) {
                        var b = document.createElement('button');
                        b.type = 'button'; b.textContent = sd[0];
                        b.style.cssText = 'border:1px solid #ccc;background:#fff;border-radius:10px;padding:2px 9px;cursor:pointer;font-size:11px;color:#555;';
                        b.addEventListener('click', function() { commit(window.plotPens.cmykSet(sd[1]), null); });
                        setsRow.appendChild(b);
                    });
                    var customSets = window.plotPens.savedSets();
                    Object.keys(customSets).sort().forEach(function(name) {
                        var b = document.createElement('button');
                        b.type = 'button';
                        b.style.cssText = 'border:1px solid #ccc;background:#fff;border-radius:10px;padding:2px 3px 2px 9px;cursor:pointer;font-size:11px;color:#555;display:inline-flex;align-items:center;gap:4px;';
                        var lbl = document.createElement('span');
                        lbl.textContent = name;
                        b.appendChild(lbl);
                        var del = document.createElement('span');
                        del.textContent = '\u00d7';
                        del.title = 'Delete this saved set';
                        del.style.cssText = 'color:#b0b0b0;padding:0 2px;';
                        del.addEventListener('click', function(ev) {
                            ev.stopPropagation();
                            window.plotPens.deleteSet(name);
                            buildPensEditor(body);
                        });
                        b.appendChild(del);
                        b.addEventListener('click', function() { commit(window.plotPens.loadSet(name), null); });
                        setsRow.appendChild(b);
                    });
                    var saveWrap = document.createElement('span');
                    saveWrap.style.cssText = 'display:inline-flex;align-items:center;gap:3px;';
                    var saveInput = document.createElement('input');
                    saveInput.type = 'text'; saveInput.placeholder = 'set name';
                    saveInput.style.cssText = 'font-size:11px;padding:2px 5px;border:1px solid #ccc;border-radius:6px;width:96px;';
                    var saveBtn = document.createElement('button');
                    saveBtn.type = 'button'; saveBtn.textContent = '+ Save';
                    saveBtn.style.cssText = 'border:1px dashed #999;background:#fff;border-radius:10px;padding:2px 9px;cursor:pointer;font-size:11px;color:#555;';
                    function doSave() {
                        var name = (saveInput.value || '').trim();
                        if (!name) { saveInput.focus(); return; }
                        window.plotPens.saveSet(name, window.plotPens.pens());
                        buildPensEditor(body);
                    }
                    saveBtn.addEventListener('click', doSave);
                    saveInput.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') doSave(); });
                    saveWrap.appendChild(saveInput); saveWrap.appendChild(saveBtn);
                    setsRow.appendChild(saveWrap);
                    body.appendChild(setsRow);

                    var strip = document.createElement('div');
                    // row-reverse + flex-start packs chips against the RIGHT edge with
                    // index 0 (slot 1) rightmost -- matching the physical holster order.
                    strip.style.cssText = 'display:flex;flex-direction:row-reverse;justify-content:flex-start;align-items:flex-start;gap:6px;flex-wrap:wrap;min-height:46px;padding:4px 2px;';
                    body.appendChild(strip);

                    var editorHost = document.createElement('div');
                    body.appendChild(editorHost);

                    var dragSrc = null;
                    var chipEls = [];

                    function updateChipSel() {
                        chipEls.forEach(function(entry) {
                            var sel = isSel(pens[entry.idx].color);
                            entry.sw.style.borderColor = sel ? '#111' : '#ccc';
                            entry.chip.style.opacity = sel ? '1' : '0.45';
                            entry.num.style.fontWeight = sel ? '700' : '400';
                        });
                    }
                    function highlight() {
                        var i = window._pl0tPenEditIdx;
                        chipEls.forEach(function(entry) {
                            entry.sw.style.boxShadow = (entry.idx === i) ? '0 0 0 2px #111' : '';
                        });
                    }
                    function openEditor(i) {
                        window._pl0tPenEditIdx = i;
                        renderEditor();
                        highlight();
                    }

                    function renderEditor() {
                        editorHost.innerHTML = '';
                        var i = window._pl0tPenEditIdx;
                        if (typeof i !== 'number' || i < 0 || i >= pens.length) { window._pl0tPenEditIdx = null; return; }
                        var pen = pens[i];
                        var ed = document.createElement('div');
                        ed.style.cssText = 'border:1px solid #ddd;border-radius:8px;padding:8px;margin-top:4px;background:#fafafa;';
                        var r1 = document.createElement('div');
                        r1.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
                        var slotLbl = document.createElement('span');
                        slotLbl.style.cssText = 'font-size:12px;font-weight:700;color:#333;white-space:nowrap;';
                        slotLbl.textContent = 'Slot ' + (i + 1);
                        var col = document.createElement('input'); col.type = 'color';
                        col.value = pen.color || '#000000';
                        col.style.cssText = 'width:38px;height:30px;padding:0;border:1px solid #ccc;border-radius:4px;flex-shrink:0;';
                        col.addEventListener('change', function() { var n = pens.slice(); n[i] = Object.assign({}, pen, { color: col.value }); commit(n, i); });
                        var lab = document.createElement('input'); lab.type = 'text';
                        lab.value = pen.label || ''; lab.placeholder = 'label';
                        lab.className = 'form-control form-control-sm';
                        lab.style.cssText = 'flex:1;min-width:40px;';
                        lab.addEventListener('change', function() { var n = pens.slice(); n[i] = Object.assign({}, pen, { label: lab.value.trim() }); commit(n, i); });
                        r1.appendChild(slotLbl); r1.appendChild(col); r1.appendChild(lab);
                        var r2 = document.createElement('div');
                        r2.style.cssText = 'display:flex;align-items:center;gap:6px;';
                        var typ = document.createElement('select');
                        typ.className = 'form-control form-control-sm';
                        typ.style.cssText = 'flex:1;';
                        types.forEach(function(t) { var o = document.createElement('option'); o.value = t; o.textContent = t.charAt(0).toUpperCase() + t.slice(1); typ.appendChild(o); });
                        typ.value = (types.indexOf(pen.pen_type) >= 0) ? pen.pen_type : types[0];
                        typ.addEventListener('change', function() { var n = pens.slice(); n[i] = Object.assign({}, pen, { pen_type: typ.value }); commit(n, i); });
                        var tip = document.createElement('span');
                        tip.style.cssText = 'font-size:11px;color:#667085;white-space:nowrap;';
                        var tw = window.plotPens.tipWidth(typ.value);
                        tip.textContent = 'tip ' + (tw ? tw + ' mm' : '\u2014 (set in machine tab)');
                        r2.appendChild(typ); r2.appendChild(tip);
                        var r3 = document.createElement('div');
                        r3.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
                        function mkBtn(txt, fn, dis) {
                            var b = document.createElement('button'); b.type = 'button'; b.textContent = txt;
                            b.style.cssText = 'border:1px solid #ccc;background:#fff;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:12px;';
                            if (dis) { b.disabled = true; b.style.opacity = '0.35'; }
                            b.addEventListener('click', fn);
                            return b;
                        }
                        // on-screen directions: left = higher slot number, right = toward slot 1
                        r3.appendChild(mkBtn('\u25c0', function() {
                            var n = pens.slice(); var t = n[i + 1]; n[i + 1] = n[i]; n[i] = t; commit(n, i + 1);
                        }, i >= pens.length - 1));
                        r3.appendChild(mkBtn('\u25b6', function() {
                            var n = pens.slice(); var t = n[i - 1]; n[i - 1] = n[i]; n[i] = t; commit(n, i - 1);
                        }, i <= 0));
                        var sp = document.createElement('span'); sp.style.cssText = 'flex:1;';
                        r3.appendChild(sp);
                        r3.appendChild(mkBtn('Remove', function() {
                            var n = pens.slice(); n.splice(i, 1); commit(n, null);
                        }));
                        r3.appendChild(mkBtn('Done', function() {
                            window._pl0tPenEditIdx = null; renderEditor(); highlight();
                        }));
                        ed.appendChild(r1); ed.appendChild(r2); ed.appendChild(r3);
                        editorHost.appendChild(ed);
                    }

                    pens.forEach(function(pen, i) {
                        var chip = document.createElement('div');
                        chip.dataset.penIdx = i;
                        chip.draggable = true;
                        chip.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;cursor:grab;user-select:none;flex-shrink:0;';
                        var sw = document.createElement('div');
                        sw.style.cssText = 'width:32px;height:32px;border-radius:6px;border:2px solid #ccc;background:' + (pen.color || '#000000') + ';';
                        var _tw = window.plotPens.tipWidth(pen.pen_type);
                        sw.title = (pen.label || '') + ' \u00b7 ' + (pen.pen_type || '') + (_tw ? ' \u00b7 ' + _tw + 'mm' : '');
                        var num = document.createElement('span');
                        num.style.cssText = 'font-size:10px;color:#667085;font-family:monospace;';
                        num.textContent = String(i + 1);
                        chip.appendChild(sw); chip.appendChild(num);
                        // tap = select (open editor); double-tap = toggle on/off for this sketch
                        var clickTimer = null;
                        chip.addEventListener('click', function() {
                            if (clickTimer) return;
                            clickTimer = setTimeout(function() { clickTimer = null; openEditor(i); }, 260);
                        });
                        chip.addEventListener('dblclick', function() {
                            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                            toggleSel(i);
                        });
                        chip.addEventListener('contextmenu', function(e) {
                            e.preventDefault();
                            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                            openEditor(i);
                        });
                        chip.addEventListener('dragstart', function(e) {
                            dragSrc = i; e.dataTransfer.effectAllowed = 'move';
                            setTimeout(function() { chip.style.opacity = '0.35'; }, 0);
                        });
                        chip.addEventListener('dragend', function() {
                            updateChipSel();
                            chipEls.forEach(function(entry) { entry.chip.style.outline = ''; });
                        });
                        chip.addEventListener('dragover', function(e) {
                            if (dragSrc === null || dragSrc === i) return;
                            e.preventDefault();
                            chip.style.outline = '2px solid #111';
                        });
                        chip.addEventListener('dragleave', function() { chip.style.outline = ''; });
                        chip.addEventListener('drop', function(e) {
                            e.preventDefault(); chip.style.outline = '';
                            if (dragSrc === null || dragSrc === i) return;
                            var n = pens.slice();
                            var moved = n.splice(dragSrc, 1)[0];
                            n.splice(i, 0, moved);
                            dragSrc = null;
                            commit(n, i);
                        });
                        strip.appendChild(chip);
                        chipEls.push({ chip: chip, sw: sw, num: num, idx: i });
                    });

                    // [+] appended last => leftmost on screen (new pens grow leftward)
                    if (pens.length < 10) {
                        var add = document.createElement('button');
                        add.type = 'button'; add.textContent = '+';
                        add.title = 'Add pen';
                        add.style.cssText = 'width:32px;height:32px;border-radius:6px;border:2px dashed #bbb;background:#fff;color:#888;font-size:18px;line-height:1;cursor:pointer;flex-shrink:0;';
                        add.addEventListener('click', function() {
                            var n = pens.slice();
                            n.push({ label: 'Pen ' + (n.length + 1), color: '#000000', pen_type: types[0] });
                            commit(n, n.length - 1);
                        });
                        strip.appendChild(add);
                    }

                    updateChipSel();
                    if (typeof window._pl0tPenEditIdx === 'number') openEditor(window._pl0tPenEditIdx);
                }

                function buildSkipLayersUI(body) {
                    if (!body) return;
                    var wrap = body.querySelector('#skipLayersWrap');
                    if (!wrap) {
                        wrap = document.createElement('div');
                        wrap.id = 'skipLayersWrap';
                        wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #eee;';
                        wrap.innerHTML = '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:4px;">Skip Layers</div>'
                            + '<div style="font-size:11px;color:#777;margin-bottom:6px;">Tap a swatch to exclude that colour from the next plot \u2014 its g-code and tool change are left out, the rest plots as usual. Resets on app restart.</div>'
                            + '<div id="skipLayersGrid" class="palette-grid"></div>';
                        body.appendChild(wrap);
                    }
                    if (typeof window._pl0tRenderSkipPanel === 'function') window._pl0tRenderSkipPanel();
                }

                // Pre-create only the groups used by the active sketch, in a stable order.
                // This keeps Artproofs-only groups from leaking into Whirls and other sketches.
                // Pens registry editor — first group, Home mode only
                if ((window._pl0tMode || 'fast') === 'full' && window.plotPens) {
                    try { buildPensEditor(ensureGroup('pens')); } catch(e) {}
                }
                var preferredGroups = ['pens', 'paper', 'advanced', 'general', 'orientation', 'arcs', 'wedges', 'textures', 'color'];
                var groupsInUse = {};
                (params || []).forEach(function(pdef) { groupsInUse[getParamGroup(pdef)] = true; });
                preferredGroups.forEach(function(k) { if (groupsInUse[k]) ensureGroup(k); });
                Object.keys(groupsInUse).forEach(function(k) {
                    if (preferredGroups.indexOf(k) === -1) ensureGroup(k);
                });
                // Paper group stays visible in both modes (its rows hide individually
                // via showModeHidden; Orientation has none, so it's visible in Show mode).
                var _pg = document.getElementById('param-group-paper');
                if (_pg) _pg.style.display = '';

                function getParamValue(id) {
                    var input = document.getElementById(id);
                    if (!input) return undefined;
                    return input.value;
                }

                function normalizeValues(values) {
                    return Array.isArray(values) ? values.map(String) : [String(values)];
                }

                function maybeRegen() {
                    if (window._pl0tDelayRender && (window._pl0tMode === 'full')) { if (typeof window._pl0tMarkDirty === 'function') window._pl0tMarkDirty(); return; }
                    scheduleRender();
                }

                // Apply a preset's param values, reusing each control's own commit
                // path so side-effects (plotFills globals, chip sync) all fire; the
                // new render scheduler coalesces them into a single render.
                function applyStylePreset(values) {
                    if (!values) return;
                    Object.keys(values).forEach(function(id) {
                        var val = values[id];
                        var pdef = (params || []).find(function(pp){ return pp.id === id; });
                        if (pdef) pdef.value = val;
                        var el = document.getElementById(id);
                        if (el && typeof el._setUIValue === 'function') { el._setUIValue(val); return; }   // colorPalette
                        // Update the control directly (NO input dispatch — avoids the range
                        // debounce that caused a stale first render then a corrected second).
                        if (el) {
                            if (el.type === 'hidden') {
                                el.value = Array.isArray(val) ? JSON.stringify(val) : String(val);
                                if (el._segCtrl) {
                                    var _arr; try { _arr = JSON.parse(el.value); if (!Array.isArray(_arr)) _arr = [String(el.value)]; } catch(e) { _arr = [String(el.value)]; }
                                    el._segCtrl.querySelectorAll('.seg-btn').forEach(function(b){ b.classList.toggle('seg-active', _arr.indexOf(b.dataset.segVal) >= 0); });
                                }
                            } else {
                                el.value = val;
                                var sv = document.getElementById(id + 'Value'); if (sv) sv.textContent = String(val);
                            }
                        }
                        var pv = el ? ((el.type === 'range' || el.type === 'number') ? Number(el.value) : el.value) : val;
                        if (window.plotFills) {
                            if (id === 'fillAngle') window.plotFills.setFillAngle(Number(pv));
                            else if (id === 'fillImperfection') window.plotFills.setFillImperfection(Number(pv));
                            else if (id === 'fillDensity') window.plotFills.setFillDensity(Number(pv));
                            else if (id === 'fillProb') window.plotFills.setFillProb(Number(pv) / 100);
                            else if (id.indexOf('fillMult_') === 0) window.plotFills.setFillMultiplier(id.slice(9), Number(pv));
                            else if (id === 'penLiftFills') window.plotFills.setPenLift(pv === 'on');
                            else if (id === 'scatterFill') { var _sf; try { _sf = JSON.parse(pv); } catch(e) { _sf = [pv]; } if (!Array.isArray(_sf)) _sf = [String(pv)]; window.plotFills.setScatterStyles(_sf.filter(Boolean)); }
                        }
                        if (routePaperChange(id, pv)) { /* handled via global paper state */ }
                        else if (id === 'plotHorizontal') { window._pl0tPlotHorizontal = (pv === 'on'); if (typeof window._pl0tApplyOrientation === 'function') window._pl0tApplyOrientation(); }
                        else if (id === 'drawOrder') { window._pl0tDrawOrder = pv; }
                        else if (id === 'delayRender') { window._pl0tDelayRender = (pv === 'on'); var _rb = document.getElementById('renderNow'); if (_rb) _rb.style.display = (pv === 'on') ? '' : 'none'; }
                        window.controls = window.controls || {};
                        window.controls[id] = pv;
                        if (registeredApi && typeof registeredApi.setParam === 'function') { try { registeredApi.setParam(id, pv); } catch(e){} }
                    });
                    applyConditionalUI(params);
                    maybeRegen();
                }

                function repositionPresetRow() {
                    // The Preset dropdown belongs UNDER the sub-style selector
                    // (presets are per-style, not per-family). Sub-style
                    // selectors sit at different positions per family, so on
                    // every conditional-UI pass we re-anchor the Preset row to
                    // the currently-active family's sub-style selector.
                    if (!registeredApi || !registeredApi.presetAnchorByFamily) return;
                    var cfg = registeredApi.presetAnchorByFamily;
                    var presetRow = document.querySelector('[data-param-id="__stylePreset"]');
                    if (!presetRow) return;
                    var famVal = getParamValue(cfg.param);
                    var anchorId = (cfg.map && cfg.map[famVal]) || cfg.param;
                    var anchorRow = document.querySelector('[data-param-id="' + anchorId + '"]');
                    if (!anchorRow || !anchorRow.parentNode) return;
                    if (anchorRow.nextSibling !== presetRow) {
                        anchorRow.parentNode.insertBefore(presetRow, anchorRow.nextSibling);
                    }
                }
                function applyConditionalUI(params) {
                    repositionPresetRow();
                    (params || []).forEach(function(pdef) {
                        var row = document.querySelector('[data-param-id="' + pdef.id + '"]');
                        if (!row) return;
                        if (pdef._regHidden) { row.style.display = 'none'; return; }

                        if (pdef.visibleWhen) {
                            var _vwConds = Array.isArray(pdef.visibleWhen) ? pdef.visibleWhen : [pdef.visibleWhen];
                            var _vwAllMatch = _vwConds.every(function(cond) {
                                if (!cond || !cond.param) return true;
                                var currentValue = getParamValue(cond.param);
                                var allowedValues = normalizeValues(cond.values || []);
                                var _activeVals;
                                try { var _pa=JSON.parse(currentValue); _activeVals=Array.isArray(_pa)?_pa.map(String):[String(currentValue)]; }
                                catch(e) { _activeVals=[String(currentValue)]; }
                                return _activeVals.some(function(v){return allowedValues.indexOf(v)!==-1;});
                            });
                            row.style.display = _vwAllMatch ? '' : 'none';
                        } else if (isShowHidden(pdef) && (window._pl0tMode || 'fast') === 'fast') {
                            row.style.display = 'none';
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
                    hideEmptyGroups();
                    refreshPresetOptions();
                }

                function presetMatchesScope(ps) {
                    if (!ps || !Array.isArray(ps.scope) || !ps.scope.length) return true;
                    return ps.scope.every(function(cond) {
                        var cur = getParamValue(cond.param);
                        var allowed = normalizeValues(cond.values || []);
                        var curVals;
                        try { var pa = JSON.parse(cur); curVals = Array.isArray(pa) ? pa.map(String) : [String(cur)]; }
                        catch (e) { curVals = [String(cur)]; }
                        return curVals.some(function(v) { return allowed.indexOf(v) !== -1; });
                    });
                }
                function refreshPresetOptions() {
                    var sel = document.getElementById('__stylePreset');
                    if (!sel || !registeredApi || !Array.isArray(registeredApi.stylePresets)) return;
                    var isHome = (window._pl0tMode || 'fast') === 'full';
                    var prevVal = sel.value;
                    sel.innerHTML = '';
                    var ph = document.createElement('option');
                    ph.value = ''; ph.textContent = 'Choose a preset\u2026'; ph.disabled = true; ph.selected = true;
                    sel.appendChild(ph);
                    registeredApi.stylePresets.forEach(function(ps, idx) {
                        if (ps && ps.home && !isHome) return;
                        if (!presetMatchesScope(ps)) return;
                        var o = document.createElement('option');
                        o.value = String(idx); o.textContent = ps.label || ('Preset ' + (idx + 1));
                        sel.appendChild(o);
                    });
                    var stillValid = false;
                    for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === prevVal) { stillValid = true; break; } }
                    if (stillValid) sel.value = prevVal;
                }

                if (params && params.length && paramsContainer) {
                    // hide static controls
                    if (staticControls) staticControls.style.display = 'none';
                    params.forEach(function(pdef){
                        // Suppressed params are fully removed from the UI outside Edit
                        // layout mode -- that's the point (park a control you don't want
                        // to see or delete-and-re-add every time). In edit mode they still
                        // render (grayed, pushed to the bottom) so they can be restored.
                        if (isSuppressed(pdef) && !(window.ParamLayout && window.ParamLayout.isEditMode())) return;

                        var row = document.createElement('div');
                        row.className = 'mb-3';
                        row.setAttribute('data-param-id', pdef.id);
                        if (pdef.tip) row.title = pdef.tip;   // hover tooltip
                        // Hide in show mode; home mode (full) always shows. isShowHidden()
                        // also honors a user-set override from Edit layout mode, not just
                        // the sketch/code's own hardcoded showModeHidden flag.
                        if (isShowHidden(pdef)) {
                            row.dataset.showModeHidden = '1';
                            if ((window._pl0tMode || 'fast') === 'fast') row.style.display = 'none';
                        }
                        if (isSuppressed(pdef)) row.classList.add('param-suppressed');

                        // Edit-layout affordances: hide-in-Show checkbox, suppress toggle,
                        // drag handle. Always created (every row type exits through this
                        // same `row` var), visibility is CSS-gated on body.pl0t-edit-mode
                        // so toggling edit mode needs no rebuild. draggable is scoped to
                        // the handle only -- never the row -- so it can't hijack normal
                        // slider/input interaction.
                        var editControls = document.createElement('span');
                        editControls.className = 'param-edit-controls';

                        var hideCb = document.createElement('input');
                        hideCb.type = 'checkbox';
                        hideCb.title = 'Hide in Show mode';
                        hideCb.checked = isShowHidden(pdef);
                        hideCb.disabled = !!pdef.showModeHidden;   // hardcoded-hidden params aren't user-toggleable back on
                        hideCb.addEventListener('change', function() {
                            if (window.ParamLayout) window.ParamLayout.setShowHidden(pdef.id, hideCb.checked);
                            // Keep dataset in sync too -- setRenderMode()'s blanket show/hide
                            // toggle on mode switch keys off [data-show-mode-hidden], not
                            // isShowHidden(), so a checkbox-only override needs it set here
                            // or a later Show->Home switch would leave this row stuck hidden.
                            if (isShowHidden(pdef)) row.dataset.showModeHidden = '1'; else delete row.dataset.showModeHidden;
                            applyConditionalUI(params);
                        });
                        editControls.appendChild(hideCb);

                        var suppressBtn = document.createElement('button');
                        suppressBtn.type = 'button';
                        suppressBtn.className = 'param-suppress-btn';
                        function updateSuppressBtn() {
                            var supp = isSuppressed(pdef);
                            suppressBtn.textContent = supp ? '↺' : '×';
                            suppressBtn.title = supp ? 'Restore this control' : 'Suppress this control (hide outside Edit layout mode)';
                            row.classList.toggle('param-suppressed', supp);
                        }
                        suppressBtn.addEventListener('click', function() {
                            var supp = !isSuppressed(pdef);
                            if (window.ParamLayout) window.ParamLayout.setSuppressed(pdef.id, supp);
                            updateSuppressBtn();
                            if (supp) {
                                var body = row.closest('.param-group-body');
                                if (body) {
                                    body.appendChild(row);   // push to the bottom of its group
                                    var g = row.closest('.param-group');
                                    var gname = g ? g.id.replace('param-group-', '') : null;
                                    if (gname && window.ParamLayout) {
                                        var idsNow = Array.prototype.filter.call(body.children, function(el) { return el.hasAttribute('data-param-id'); })
                                            .map(function(el) { return el.getAttribute('data-param-id'); });
                                        window.ParamLayout.setOrder(gname, idsNow);
                                    }
                                }
                            }
                        });
                        updateSuppressBtn();
                        editControls.appendChild(suppressBtn);

                        var dragHandle = document.createElement('span');
                        dragHandle.className = 'param-drag-handle';
                        dragHandle.textContent = '⠇';
                        dragHandle.title = 'Drag to move this control';
                        dragHandle.draggable = true;
                        dragHandle.addEventListener('dragstart', function(e) {
                            draggedRow = row;
                            e.dataTransfer.effectAllowed = 'move';
                            try { e.dataTransfer.setData('text/plain', pdef.id); } catch(err) {}
                            setTimeout(function() { row.classList.add('drag-ghost'); }, 0);
                        });
                        dragHandle.addEventListener('dragend', function() {
                            row.classList.remove('drag-ghost');
                            document.querySelectorAll('.param-group-body.drag-over').forEach(function(b) { b.classList.remove('drag-over'); });
                            draggedRow = null;
                        });
                        editControls.appendChild(dragHandle);
                        row.appendChild(editControls);

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
                                maybeRegen();
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
                            if (pdef._regHidden) row.style.display = 'none';
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
                                maybeRegen();
                            });
                            row.appendChild(actionButton);
                            ensureGroup(getParamGroup(pdef)).appendChild(row);
                            return;
                        }

                        var input;
                        // User-edited min/max (Edit layout mode) override the sketch's own
                        // bounds. Only min/max apply here -- the "Show default" field never
                        // touches input.value, it's read separately (applyShowModeLockedDefaults).
                        var _savedBounds = window.ParamLayout ? (window.ParamLayout.getBounds(pdef.id) || {}) : {};
                        if ((pdef.type === 'range') || pdef.type === undefined) {
                            input = document.createElement('input');
                            input.type = 'range';
                            input.min = (_savedBounds.min !== undefined && _savedBounds.min !== '') ? _savedBounds.min : (pdef.min || 0);
                            input.max = (_savedBounds.max !== undefined && _savedBounds.max !== '') ? _savedBounds.max : (pdef.max || 100);
                            input.step = (typeof pdef.step !== 'undefined') ? pdef.step : 1;
                            input.value = (typeof pdef.value !== 'undefined') ? pdef.value : input.min;
                        } else if (pdef.type === 'number') {
                            input = document.createElement('input');
                            input.type = 'number';
                            input.min = (_savedBounds.min !== undefined && _savedBounds.min !== '') ? _savedBounds.min : (pdef.min || 0);
                            input.max = (_savedBounds.max !== undefined && _savedBounds.max !== '') ? _savedBounds.max : (pdef.max || 100000);
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
                            (function(_inp, _sc, _opts, _isMulti, _requireOne) {
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
                                            // _requireOne is opt-in per param (pdef.requireOne) -- most multi-selects
                                            // (e.g. scatterFill) default to [] and should allow deselecting to zero.
                                            if (idx>=0) { if (!_requireOne || arr.length>1) arr.splice(idx,1); }
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
                            })(input, _segCtrl, pdef.options || [], _multi, !!pdef.requireOne);
                            input._segCtrl = _segCtrl;
                        } else if (pdef.type === 'mult') {
                            // Compact [-] value x [+] stepper (tiny multiplier buttons),
                            // instead of a full-width slider per fill. Hidden input holds
                            // the value; the visible control is appended via _segCtrl.
                            input = document.createElement('input');
                            input.type = 'hidden';
                            var _mmin = (typeof pdef.min !== 'undefined') ? pdef.min : 0.25;
                            var _mmax = (typeof pdef.max !== 'undefined') ? pdef.max : 3;
                            var _mstep = (typeof pdef.step !== 'undefined') ? pdef.step : 0.25;
                            input.value = (typeof pdef.value !== 'undefined') ? String(pdef.value) : '1';
                            var _stp = document.createElement('div');
                            _stp.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
                            function _mkMultBtn(t) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.style.cssText = 'width:22px;height:22px;line-height:1;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;font-size:14px;padding:0;'; return b; }
                            var _dec = _mkMultBtn('\u2212'), _inc = _mkMultBtn('+');
                            var _disp = document.createElement('span'); _disp.style.cssText = 'min-width:36px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums;';
                            function _fmtMult(v) { return (Math.round(v * 100) / 100) + '\u00d7'; }
                            function _setMult(v) { v = Math.max(_mmin, Math.min(_mmax, Math.round(v / _mstep) * _mstep)); input.value = String(v); _disp.textContent = _fmtMult(v); input.dispatchEvent(new Event('input')); }
                            _disp.textContent = _fmtMult(Number(input.value));
                            _dec.addEventListener('click', function() { _setMult(Number(input.value) - _mstep); });
                            _inc.addEventListener('click', function() { _setMult(Number(input.value) + _mstep); });
                            input.addEventListener('input', function() { _disp.textContent = _fmtMult(Number(input.value)); });
                            _stp.appendChild(_dec); _stp.appendChild(_disp); _stp.appendChild(_inc);
                            input._segCtrl = _stp;
                            if (spanValue) spanValue.style.display = 'none';
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
                            if (input.type === 'range') {
                                if (input._redrawTimer) clearTimeout(input._redrawTimer);
                                input._redrawTimer = setTimeout(function() {
                                    var v = Number(input.value);
                                    if (pdef.id === 'fillAngle')        { window.plotFills && window.plotFills.setFillAngle(v); }
                                    if (pdef.id === 'fillImperfection') { window.plotFills && window.plotFills.setFillImperfection(v); }
                                    if (pdef.id === 'fillDensity')      { window.plotFills && window.plotFills.setFillDensity(v); }
                                    if (pdef.id === 'fillProb')         { window.plotFills && window.plotFills.setFillProb(v / 100); }
                                    if (pdef.id.indexOf('fillMult_') === 0) { window.plotFills && window.plotFills.setFillMultiplier(pdef.id.slice(9), v); }
                                    if (registeredApi && typeof registeredApi.setParam === 'function') {
                                        try { registeredApi.setParam(pdef.id, v); } catch(e){}
                                    }
                                    applyConditionalUI(params);
                                    maybeRegen();
                                }, 150);
                            } else {
                                if (pdef.id === 'penLiftFills') { window.plotFills && window.plotFills.setPenLift(val === 'on'); }
                                if (pdef.id === 'scatterFill') {
                                    var _sfv = val;
                                    if (typeof _sfv === 'string') { try { _sfv = JSON.parse(_sfv); } catch(e) { _sfv = [_sfv]; } }
                                    if (!Array.isArray(_sfv)) _sfv = [String(_sfv)];
                                    window.plotFills && window.plotFills.setScatterStyles(_sfv.filter(Boolean));
                                }
                                routePaperChange(pdef.id, val);
                                if (pdef.id === 'plotHorizontal') { window._pl0tPlotHorizontal = (val === 'on'); if (typeof window._pl0tApplyOrientation === 'function') window._pl0tApplyOrientation(); }
                                if (pdef.id === 'drawOrder')      { window._pl0tDrawOrder = val; }
                                if (pdef.id.indexOf('fillMult_') === 0) { window.plotFills && window.plotFills.setFillMultiplier(pdef.id.slice(9), Number(val)); }
                                if (pdef.id === 'delayRender')    { window._pl0tDelayRender = (val === 'on'); var _rb = document.getElementById('renderNow'); if (_rb) _rb.style.display = (val === 'on') ? '' : 'none'; }
                                if (registeredApi && typeof registeredApi.setParam === 'function') {
                                    try { registeredApi.setParam(pdef.id, val); } catch(e){}
                                }
                                applyConditionalUI(params);
                                maybeRegen();
                            }
                        }
                        // on change handler
                        input.addEventListener('input', commitInputValue);
                        if (input.tagName && input.tagName.toLowerCase() === 'select') {
                            input.addEventListener('change', commitInputValue);
                        }

                        row.appendChild(label);
                        if (input._segCtrl) row.appendChild(input._segCtrl);
                        row.appendChild(input);

                        // Editable bounds (Edit layout mode only, numeric controls only).
                        // Min/Max snap into the live control's own min/max when edit mode
                        // turns off (rebuild picks up the freshly-saved bounds -- see the
                        // onEditModeChange registration near the top) -- never live, to avoid
                        // jumping a slider the operator may be mid-tweaking. Show default
                        // never touches the live control at all; it's only read when
                        // generating a Show-mode plot with this param hidden (see
                        // applyShowModeLockedDefaults).
                        if (input.type === 'range' || input.type === 'number') {
                            var boundsRow = document.createElement('div');
                            boundsRow.className = 'param-bounds-editor';
                            function mkBoundField(labelText, key, fallback, titleText) {
                                var wrap = document.createElement('label');
                                var lab = document.createElement('span'); lab.textContent = labelText;
                                var fld = document.createElement('input');
                                fld.type = 'number';
                                fld.title = titleText || '';
                                var savedVal = _savedBounds[key];
                                fld.value = (savedVal !== undefined && savedVal !== '') ? savedVal : fallback;
                                fld.addEventListener('change', function() {
                                    var cur = (window.ParamLayout && window.ParamLayout.getBounds(pdef.id)) || {};
                                    cur[key] = (fld.value === '') ? undefined : Number(fld.value);
                                    if (window.ParamLayout) window.ParamLayout.setBounds(pdef.id, cur);
                                });
                                wrap.appendChild(lab); wrap.appendChild(fld);
                                return wrap;
                            }
                            boundsRow.appendChild(mkBoundField('Min', 'min', pdef.min || 0));
                            boundsRow.appendChild(mkBoundField('Max', 'max', pdef.max || (input.type === 'range' ? 100 : 100000)));
                            boundsRow.appendChild(mkBoundField('Show', 'def',
                                (typeof pdef.value !== 'undefined') ? pdef.value : '',
                                'Value used for this control while it\'s hidden in Show mode'));
                            row.appendChild(boundsRow);
                        }

                        ensureGroup(getParamGroup(pdef)).appendChild(row);
                    });
                    applyConditionalUI(params);
                    if (registeredApi && typeof registeredApi.buildAdvancedExtra === 'function') {
                        try { registeredApi.buildAdvancedExtra(ensureGroup('advanced')); } catch(e) {}
                    }
                    // Fixed display order within Advanced, regardless of which
                    // order these pieces were appended in above. Unlisted
                    // advanced params (other sketches' own) fall in wherever
                    // they were appended, ahead of this fixed block.
                    (function() {
                        var advBody = ensureGroup('advanced');
                        var order = ['plotHorizontal', 'recolor', 'drawOrder', 'svgColorMapWrap', 'delayRender'];
                        order.forEach(function(key) {
                            var el = advBody.querySelector('[data-param-id="' + key + '"]') || document.getElementById(key);
                            if (el) advBody.appendChild(el);
                        });
                    })();
                    // Upfront Preset selector (first control in General).
                    if (registeredApi && Array.isArray(registeredApi.stylePresets) && registeredApi.stylePresets.length) {
                        var _isHome = (window._pl0tMode || 'fast') === 'full';
                        var _genBody = ensureGroup('general');
                        var _pRow = document.createElement('div'); _pRow.className = 'mb-3'; _pRow.setAttribute('data-param-id', '__stylePreset');
                        var _pLab = document.createElement('label'); _pLab.className = 'control-label';
                        var _pSpan = document.createElement('span'); _pSpan.className = 'param-label-text';
                        // Label is sketch-overridable (registeredApi.presetLabel) so a
                        // sketch can name it something clearer than the generic "Preset"
                        // -- e.g. svgUpload calls it "Quick setup". Optional one-line
                        // help (registeredApi.presetHelp) renders under the dropdown.
                        _pSpan.textContent = registeredApi.presetLabel || 'Preset';
                        _pLab.appendChild(_pSpan); _pRow.appendChild(_pLab);
                        if (registeredApi.presetHelp) {
                            var _pHelp = document.createElement('div');
                            _pHelp.style.cssText = 'font-size:11px;color:#777;margin:2px 0 5px;line-height:1.35;';
                            _pHelp.textContent = registeredApi.presetHelp;
                            _pRow.appendChild(_pHelp);
                        }
                        var _pSel = document.createElement('select'); _pSel.id = '__stylePreset'; _pSel.className = 'form-control form-control-sm';
                        _pSel.addEventListener('change', function() {
                            var ps = registeredApi.stylePresets[Number(this.value)];
                            if (ps) applyStylePreset(ps.values);
                        });
                        _pRow.appendChild(_pSel);
                        if (_genBody) {
                            var _anchorId = registeredApi.presetAnchorParam;
                            var _anchorRow = _anchorId ? _genBody.querySelector('[data-param-id="' + _anchorId + '"]') : null;
                            if (_anchorRow) { _genBody.insertBefore(_pRow, _anchorRow.nextSibling); }
                            else { _genBody.insertBefore(_pRow, _genBody.firstChild); }
                        }
                        refreshPresetOptions();
                        repositionPresetRow();
                    }
                } else {
                    if (staticControls) staticControls.style.display = '';
                }

                // Re-apply any user-dragged row order. Groups without a saved order are
                // left completely untouched (natural declaration order / the fixed
                // "Advanced" ordering block above), so this only affects groups the
                // operator has actually reordered via Edit layout mode.
                (function applyStoredOrder() {
                    if (!window.ParamLayout) return;
                    var groupIds = {};
                    if (paramsContainer) paramsContainer.querySelectorAll('.param-group').forEach(function(d) { groupIds[d.id.replace('param-group-', '')] = true; });
                    if (globalParamsContainer) globalParamsContainer.querySelectorAll('.param-group').forEach(function(d) { groupIds[d.id.replace('param-group-', '')] = true; });
                    Object.keys(groupIds).forEach(function(g) {
                        var order = window.ParamLayout.getOrder(g);
                        if (!order || !order.length) return;
                        var details = document.getElementById('param-group-' + g);
                        var body = details && details.querySelector('.param-group-body');
                        if (!body) return;
                        var rows = Array.prototype.filter.call(body.children, function(el) { return el.hasAttribute('data-param-id'); });
                        if (rows.length < 2) return;
                        var byId = {};
                        rows.forEach(function(r) { byId[r.getAttribute('data-param-id')] = r; });
                        var ordered = [];
                        order.forEach(function(id) { if (byId[id]) { ordered.push(byId[id]); delete byId[id]; } });
                        rows.forEach(function(r) { if (byId[r.getAttribute('data-param-id')]) ordered.push(r); });   // unlisted rows keep their natural relative order, appended after
                        ordered.forEach(function(r) { body.appendChild(r); });
                    });
                })();

                // Fresh load / sketch switch while already in Show mode: lock in any
                // hidden numeric params' Show defaults immediately (setRenderMode()
                // handles the transition case when Home <-> Show is toggled live).
                applyShowModeLockedDefaults();

                // show/hide pause button based on sketch capability
                var pauseBtn = document.getElementById('pause');
                if (pauseBtn) {
                    var supportsPause = !(registeredApi && registeredApi.hasPause === false);
                    pauseBtn.style.display = supportsPause ? '' : 'none';
                    pauseBtn.textContent = 'Pause'; // reset label on sketch switch
                }
                var shuffleBtn = document.getElementById('shuffleLayout');
                if (shuffleBtn) shuffleBtn.style.display = (registeredApi && typeof registeredApi.shuffleLayout === 'function') ? '' : 'none';
                var _renderBtn = document.getElementById('renderNow');
                if (_renderBtn) _renderBtn.style.display = window._pl0tDelayRender ? '' : 'none';
            } catch(e) { console.error('build param UI error', e); }
    }

    // ── Coalesced deferred render ───────────────────────────────────────
    // Param edits update controls immediately; the heavy (main-thread) render
    // is debounced + deferred a couple frames so the UI paints first and rapid
    // changes collapse into one render. A subtle badge shows during long renders.
    function _renderIndicator(on) {
        var el = document.getElementById('pl0t-render-indicator');
        if (!el) {
            if (!on) return;
            el = document.createElement('div');
            el.id = 'pl0t-render-indicator';
            el.textContent = '\u27f3 rendering\u2026';
            el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9998;' +
                'background:rgba(124,77,255,0.92);color:#fff;font:600 11px system-ui,sans-serif;' +
                'padding:4px 10px;border-radius:12px;pointer-events:none;opacity:0;' +
                'transition:opacity .12s ease;box-shadow:0 1px 6px rgba(0,0,0,.25);';
            document.body.appendChild(el);
        }
        el.style.opacity = on ? '1' : '0';
    }

    function scheduleRender() {
        if (window._pl0tRenderTimer) clearTimeout(window._pl0tRenderTimer);
        window._pl0tRenderTimer = setTimeout(function() {
            window._pl0tRenderTimer = null;
            _renderIndicator(true);
            // Two frames so the badge + control state paint before the blocking render.
            requestAnimationFrame(function() { requestAnimationFrame(function() {
                try { if (window.sketchAPI && typeof window.sketchAPI.regenerate === 'function') window.sketchAPI.regenerate(); }
                finally { _renderIndicator(false); }
            }); });
        }, 30);
    }

    function hideEmptyGroups() {
        var groups = document.querySelectorAll('.param-group');
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            var rows = g.querySelectorAll('[data-param-id]');
            if (!rows.length) { g.style.display = ''; continue; }
            var anyVisible = false;
            for (var j = 0; j < rows.length; j++) { if (rows[j].style.display !== 'none') { anyVisible = true; break; } }
            g.style.display = anyVisible ? '' : 'none';
        }
    }

    window.makeSketchApp = {
        make: make,
        buildParamUI: buildParamUI,
        // Rebuild the current sketch's control panel from its live registeredApi.
        // Used by paperSettings.js after an external (non-UI-driven) paper change
        // -- e.g. a loaded recipe -- so the Paper group's controls stay in sync.
        refreshParamUI: function() { try { if (registeredApi) buildParamUI(registeredApi); } catch (e) {} },
        drawSignatureOverlay: function() { try { _drawSignatureOverlay(); } catch (e) {} },
        getSeedSlug: function() {
            try {
                if (!window.Signature || !window.Signature.seedToName) return '';
                var seed = (registeredApi && typeof registeredApi.getSignatureSeed === 'function')
                    ? registeredApi.getSignatureSeed() : (window._pl0tSigSeed || 0);
                var snap = (window.sketchAPI && window.sketchAPI.getParamsSnapshot)
                    ? window.sketchAPI.getParamsSnapshot() : [];
                // FNV-1a 32-bit hash over serialised params + seed
                var str = JSON.stringify(snap) + '|' + seed;
                var h = 2166136261;
                for (var i = 0; i < str.length; i++) {
                    h ^= str.charCodeAt(i);
                    h = Math.imul(h, 16777619) >>> 0;
                }
                return window.Signature.seedToName(h).replace(/\s+/g, '-');
            } catch(e) {}
            return '';
        },
        setRenderMode: function(mode) {
            window._pl0tMode = mode;
            // Toggle paper params and group for Show mode ONLY -- Web mode
            // keeps them (it's "like Show but keeps the global Settings
            // column", see _isWeb below). This used to key off "mode !==
            // full", which lumped Web in with Show and hid paper size etc.
            // on the /studio page even though the column itself was visible.
            var _isHome = (mode === 'full');
            var _hideShowOnly = (mode === 'fast');
            document.querySelectorAll('[data-show-mode-hidden]').forEach(function(el) {
                el.style.display = _hideShowOnly ? 'none' : '';
            });
            // Three modes:
            //   full ('Home') - full authoring surface
            //   fast ('Show') - gallery/performance: no global Settings column
            //   web           - online: like Show, but KEEPS the global Settings
            //                   column so paper size etc. are available online
            var _isWeb = (mode === 'web');
            var _gc = document.getElementById('global-col');
            if (_gc) _gc.style.display = (_isHome || _isWeb) ? '' : 'none';
            // Lock in / restore hidden numeric params' Show defaults (Edit layout
            // mode). Restoring on the way back to Home mode is what keeps this from
            // clobbering art in progress -- see applyShowModeLockedDefaults above.
            if (_isHome) restoreShowModeStash(); else applyShowModeLockedDefaults();
            // The blanket un-hide above only knows about showModeHidden -- it doesn't
            // re-check a param's OWN visibleWhen condition (e.g. Custom Width/Height
            // only apply when Paper size = Custom), so entering Home mode could leave
            // a conditionally-hidden row incorrectly visible. Re-apply those here.
            try {
                var _vwParams = _lastBuiltParams || [];
                _vwParams.forEach(function(pdef) {
                    if (!pdef.visibleWhen) return;
                    var _row = document.querySelector('[data-param-id="' + pdef.id + '"]');
                    if (!_row) return;
                    var _conds = Array.isArray(pdef.visibleWhen) ? pdef.visibleWhen : [pdef.visibleWhen];
                    var _match = _conds.every(function(cond) {
                        if (!cond || !cond.param) return true;
                        var _valEl = document.getElementById(cond.param);
                        var _cur = _valEl ? _valEl.value : '';
                        var _allowed = (cond.values || []).map(String);
                        try { var _pa = JSON.parse(_cur); if (Array.isArray(_pa)) return _pa.map(String).some(function(v){return _allowed.indexOf(v)!==-1;}); } catch(e) {}
                        return _allowed.indexOf(String(_cur)) !== -1;
                    });
                    _row.style.display = _match ? '' : 'none';
                });
            } catch(e) {}
            var _paperGrp = document.getElementById('param-group-paper');
            if (_paperGrp) _paperGrp.style.display = '';   // Landscape lives here; visible in both modes
            // Keep a hidden input so getParamValue('_renderMode') works for visibleWhen
            var _rmEl = document.getElementById('_renderMode');
            if (!_rmEl) {
                _rmEl = document.createElement('input');
                _rmEl.type = 'hidden';
                _rmEl.id = '_renderMode';
                document.body.appendChild(_rmEl);
            }
            _rmEl.value = mode;
            // Toggle visibility of params gated on _renderMode (e.g. scatterFill --
            // itself a generic buildParamUI injection, so _lastBuiltParams, not
            // registeredApi.params, is where its visibleWhen actually lives)
            try {
                var _params = _lastBuiltParams || [];
                _params.forEach(function(pdef) {
                    if (!pdef.visibleWhen || pdef.visibleWhen.param !== '_renderMode') return;
                    var _row = document.querySelector('[data-param-id="' + pdef.id + '"]');
                    if (!_row) return;
                    var _allowed = (pdef.visibleWhen.values || []).map(String);
                    _row.style.display = _allowed.indexOf(mode) !== -1 ? '' : 'none';
                });
            } catch(e) {}
            try {
                if (registeredApi && typeof registeredApi.setParam === 'function')
                    registeredApi.setParam('_renderMode', mode);
            } catch(e) {}
            try { hideEmptyGroups(); } catch(e) {}
            try {
                if (window.sketchAPI && typeof window.sketchAPI.regenerate === 'function')
                    window.sketchAPI.regenerate();
                else if (currentP5 && typeof currentP5.redraw === 'function')
                    currentP5.redraw();
            } catch(e) {}
        },
        onPensChanged: function() { try { buildParamUI(registeredApi); } catch(e) {} },
        remakeCurrent: function() {
            make((selector && selector.value) ? selector.value : (lastSketchName || 'default'));
        },
        getCurrentSketchName: function() {
            return (selector && selector.value) ? selector.value : lastSketchName;
        },
        getSignatureSvgForQueue: function(svgElement) {
            try {
            if (!window._signatureConfig || !window._signatureConfig.enabled) return '';
            if (!window.Signature || typeof window.Signature.buildSignatureSVG !== 'function') return '';
            var cfg = window._signatureConfig;
            var svgW, svgH;
            if (svgElement) {
                var vb = svgElement.viewBox && svgElement.viewBox.baseVal;
                svgW = (vb && vb.width) ? vb.width : (parseFloat(svgElement.getAttribute('width')) || (currentP5 ? currentP5.width : 800));
                svgH = (vb && vb.height) ? vb.height : (parseFloat(svgElement.getAttribute('height')) || (currentP5 ? currentP5.height : 800));
            } else {
                svgW = currentP5 ? currentP5.width : 800;
                svgH = currentP5 ? currentP5.height : 800;
            }
            var marginIn = 1;
            if (registeredApi && Array.isArray(registeredApi.params)) {
                var mp = registeredApi.params.find(function(x) { return x.id === 'margin'; });
                if (mp) marginIn = parseFloat(mp.value) || 1;
            }
            var marginPx = window.makeSketchUtils && window.makeSketchUtils.getMarginPixels
                ? window.makeSketchUtils.getMarginPixels(marginIn) : marginIn * 96;
            var mmToPx = function(mm) {
                return window.makeSketchUtils && window.makeSketchUtils.mmToPixels
                    ? window.makeSketchUtils.mmToPixels(mm) : mm * 3.7795;
            };
            var seed = (registeredApi && typeof registeredApi.getSignatureSeed === 'function')
                ? registeredApi.getSignatureSeed() : (window._pl0tSigSeed || 0);
            var DISPLAY_NAMES = {
                'cmyk': 'CMYK Flow', 'artproofs': 'Artproofs',
                'circlesFromLines': 'Circles From Lines', 'lineArrays': 'Line Arrays',
                'zigzag': 'Zigzag', 'whirls': 'Whirls',
                'unbuiltSculptures': 'Unbuilt Sculptures', 'patternTest': 'Pattern Test',
                'calibration': 'Calibration', 'svgUpload': 'SVG Upload', 'imageTrace': 'Image Trace'
            };
            var label = DISPLAY_NAMES[lastSketchName] ||
                (lastSketchName ? lastSketchName.charAt(0).toUpperCase() + lastSketchName.slice(1) : 'pl0tb0t');
            var _pal = null;
            if (window.sketchAPI && window.sketchAPI.getPlotColors) { try { _pal = window.sketchAPI.getPlotColors(); } catch(e){} }
            if ((!_pal || !_pal.length) && registeredApi && Array.isArray(registeredApi.params)) {
                var _pp = registeredApi.params.find(function(x){ return x.id === 'palette'; });
                if (_pp && Array.isArray(_pp.value)) _pal = _pp.value;
            }
            var _sigCol = window.Signature.pickSignatureColor ? window.Signature.pickSignatureColor(_pal) : '#000000';
            var _sig = window.Signature.buildSignatureSVG(cfg, svgW, svgH, marginPx, mmToPx, label, seed, _sigCol);
            // Plot-horizontal rotates the whole page 90deg via rotateSvgForPlot(). The
            // plot pipeline regenerates this signature fresh (for the edition #) and
            // appends it at the TOP level of an ALREADY-rotated page with no further
            // rotation -- so it must carry the SAME transform or it lands off the
            // landscape page (the "plot horizontal drops the signature" bug).
            // Only the null-svgElement caller (Python plot) needs this: the getSvgString()
            // path passes an element and rotates the whole SVG afterward, so pre-wrapping
            // there would double-rotate. svgH (portrait height) becomes the landscape width.
            if (_sig && !svgElement && window._pl0tPlotHorizontal) {
                _sig = '<g transform="translate(' + svgH + ',0) rotate(90)">' + _sig + '</g>';
            }
            return _sig;
            } catch(e) { return ''; }
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
