// autonomousLoader.js
// Loads autonomous-art sketches (window.__autonomousManifest) into an
// "AI sketch…" dropdown after the regular sketch chips (home mode only),
// and gives each one a full interactive param panel by driving
// makeSketchApp.buildParamUI() with a synthetic registeredApi — so they get
// the same controls (geometry params, color palette, global fill options,
// groups, show/home behavior) as the built-in sketches.
//
// Autonomous sketch contract (see scripts/autonomous_sketches/*.js):
//   window.__autonomousSketch = {
//       name, description,
//       presets: [...],                       // for the headless email path
//       params:  [ paramDef, ... ],           // same schema as built-in sketches
//       generate: function(seed, P) -> svg    // P = {paramId: value, ...}
//   }
(function () {
    'use strict';

    function loadManifestThenInit() {
        window.autonomousSketches = window.autonomousSketches || {};
        var manifest = window.__autonomousManifest || [];
        var idx = 0;
        function loadNext() {
            if (idx >= manifest.length) { buildUI(); return; }
            var entry = manifest[idx++];
            var s = document.createElement('script');
            s.src = entry.file;
            s.onload = function () {
                if (window.__autonomousSketch) {
                    window.autonomousSketches[window.__autonomousSketch.name] = window.__autonomousSketch;
                    window.__autonomousSketch = null;
                }
                loadNext();
            };
            s.onerror = function () {
                console.error('autonomousLoader: failed to load', entry.file);
                loadNext();
            };
            document.head.appendChild(s);
        }
        loadNext();
    }

    var active = null;   // { entry, paramState, registeredApi, seed }

    function buildDefaults(params) {
        var P = {};
        (params || []).forEach(function (pd) {
            P[pd.id] = (typeof pd.value !== 'undefined') ? pd.value : null;
        });
        return P;
    }

    function render() {
        if (!active) return;
        var P = {};
        Object.keys(active.paramState).forEach(function (k) { P[k] = active.paramState[k]; });
        // One shared white artboard across all AI sketches, regardless of each
        // sketch's own bgColor preset/default.
        P.bgColor = '#ffffff';
        var svg;
        try {
            svg = active.entry.generate(active.seed, P);
        } catch (e) {
            console.error('autonomous generate error (' + active.entry.name + ')', e);
            return;
        }
        svg = String(svg).replace(/^\s*<\?xml[^>]*\?>\s*/, '');

        // AI sketches render straight to SVG (no p5 canvas), so the usual
        // canvas-based drawSignaturePreview overlay (see makeSketch.js's
        // _drawSignatureOverlay) doesn't apply here -- build the same signature
        // as a real SVG <g> and splice it into the markup before it's injected.
        if (window._signatureConfig && window._signatureConfig.enabled &&
            window._signatureConfig.showPreview &&
            window.Signature && typeof window.Signature.buildSignatureSVG === 'function' &&
            window.makeSketchUtils) {
            var dims = window.makeSketchUtils.getPaperPixels(P.paperSize);
            var marginPx = window.makeSketchUtils.getMarginPixels(parseFloat(P.margin || 0.75));
            var mmToPx = function (mm) { return window.makeSketchUtils.mmToPixels(mm); };
            var _pal = Array.isArray(P.palette) ? P.palette : null;
            var _sigCol = window.Signature.pickSignatureColor ? window.Signature.pickSignatureColor(_pal) : '#000000';
            var sigG = window.Signature.buildSignatureSVG(window._signatureConfig, dims.width, dims.height,
                marginPx, mmToPx, active.entry.name, active.seed, _sigCol);
            if (sigG) svg = svg.replace(/<\/svg>\s*$/, sigG + '\n</svg>');
        }

        var container = document.getElementById('make-sketch');
        if (container) container.innerHTML = svg;
    }

    function selectAutonomous(name) {
        var entry = window.autonomousSketches[name];
        if (!entry) return;

        // Paper params first (paper size + margin integrate with Make Tab Settings),
        // then the sketch's own params.
        var paperParams = (window.makeSketchUtils && window.makeSketchUtils.buildPaperParams)
            ? window.makeSketchUtils.buildPaperParams('9x12', '0.75') : [];
        var allParams = paperParams.concat((entry.params || []).slice());

        var paramState = buildDefaults(allParams);

        var registeredApi = {
            params: allParams,
            hasPause: false,
            stylePresets: (entry.stylePresets || []),
            hideGlobalScatter: true,
            setParam: function (id, val) {
                if (typeof val === 'string' && val.charAt(0) === '[') { try { var a = JSON.parse(val); if (Array.isArray(a)) val = a; } catch (e) {} }
                paramState[id] = val;
            },
            getParamsSnapshot: function () {
                return allParams.map(function (pd) { return { id: pd.id, value: paramState[pd.id] }; });
            },
            applyParamsSnapshot: function (snap) {
                if (!Array.isArray(snap)) return;
                snap.forEach(function (p) {
                    if (!p || typeof p.id === 'undefined') return;
                    paramState[p.id] = p.value;
                    var el = document.getElementById(p.id);
                    if (el && typeof el._setUIValue === 'function') el._setUIValue(p.value);
                    else if (el) { el.value = p.value; }
                });
                render();
            }
        };

        active = {
            entry: entry,
            paramState: paramState,
            registeredApi: registeredApi,
            seed: Math.floor(Math.random() * 999999)
        };

        var reseed = function () {
            if (!active) return;
            active.seed = Math.floor(Math.random() * 999999);
            render();
        };

        var randomize = function () {
            (entry.params || []).forEach(function (pd) {
                if (pd.type === 'range') {
                    var lo = Number(pd.min || 0), hi = Number(pd.max || 100), st = Number(pd.step || 1);
                    var v = lo + Math.floor(Math.random() * (Math.floor((hi - lo) / st) + 1)) * st;
                    v = Math.min(hi, v);
                    pd.value = v; paramState[pd.id] = v;
                } else if (pd.type === 'select' && !pd.multiSelect && pd.options && pd.options.length) {
                    var o = pd.options[Math.floor(Math.random() * pd.options.length)].value;
                    pd.value = o; paramState[pd.id] = o;
                }
            });
            if (window.makeSketchApp && window.makeSketchApp.buildParamUI) {
                window.makeSketchApp.buildParamUI(registeredApi);
            }
            reseed();
        };

        window.sketchAPI = {
            regenerate: render,
            redraw: render,
            reseed: reseed,
            randomize: randomize,
            togglePause: function () { return false; },
            getParamsSnapshot: registeredApi.getParamsSnapshot,
            applyParamsSnapshot: registeredApi.applyParamsSnapshot,
            applyRecipe: function (recipe) {
                if (recipe && Array.isArray(recipe.params)) registeredApi.applyParamsSnapshot(recipe.params);
            },
            getRecipe: function () {
                return { sketch: 'autonomous:' + entry.name, params: registeredApi.getParamsSnapshot() };
            }
        };

        // Reflect selection in the chip row (deactivate built-in chips).
        var chips = document.getElementById('sketch-chips');
        if (chips) chips.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('seg-active'); });

        if (window.makeSketchApp && typeof window.makeSketchApp.buildParamUI === 'function') {
            window.makeSketchApp.buildParamUI(registeredApi);
        }
        render();
    }

    function clearAutonomousState() {
        active = null;
        var sel = document.getElementById('autonomousSketchSelector');
        if (sel) sel.value = '';
    }

    function buildUI() {
        var header = document.getElementById('sketch-header');
        if (!header) return;

        var sel = document.createElement('select');
        sel.id = 'autonomousSketchSelector';
        sel.setAttribute('data-show-mode-hidden', '1');
        sel.style.cssText = 'flex:0 0 auto;font-size:12px;padding:4px 10px;border:1.5px solid #b39ddb;' +
            'border-radius:16px;height:32px;margin-left:5px;max-width:160px;background:#faf7ff;color:#4a2d7a;';
        sel.style.display = (window.pl0tIsAdvanced && window.pl0tIsAdvanced()) ? '' : 'none';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '✦ AI sketch…';
        placeholder.disabled = true;
        placeholder.selected = true;
        sel.appendChild(placeholder);

        Object.keys(window.autonomousSketches || {}).sort().forEach(function (name) {
            var entry = window.autonomousSketches[name];
            var opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (entry.description) opt.title = entry.description;
            sel.appendChild(opt);
        });

        sel.addEventListener('change', function () {
            if (this.value) selectAutonomous(this.value);
        });
        header.appendChild(sel);

        // When a built-in sketch chip is chosen, drop autonomous state.
        var origSel = document.getElementById('sketchSelector');
        if (origSel) origSel.addEventListener('change', clearAutonomousState);
        var chips = document.getElementById('sketch-chips');
        if (chips) chips.addEventListener('click', function (e) {
            if (e.target && e.target.classList && e.target.classList.contains('seg-btn')) {
                clearAutonomousState();
            }
        });
    }

    window.addEventListener('load', loadManifestThenInit);
})();
