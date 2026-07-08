// Make-tab-owned GLOBAL paper settings (state module -- no UI of its own).
//
// Paper used to be a per-sketch control (buildPaperParams injected paperSize /
// margin / customWidth / customHeight into every sketch); it's an author-time
// choice that should be set ONCE, so the STATE lives here: persisted in
// localStorage, exposed as window._paperSettings, which the paper helpers
// (sharedPaperControls.js) read. The UI itself is rendered by makeSketch.js in
// the standard 'paper' param group (same placement/format as every other
// group -- Paper size / Width / Height / Margin / Orientation, near the top of
// the controls column) via generic per-sketch injection (see the 'paperSize'/
// 'landscape' blocks there); those controls just read/write through this module
// instead of a per-sketch default, so every sketch shares one paper setting.
// Recipes carry paper in recipe.globals.paper (see makeSketch.js), so
// "edit from queue" restores the exact size the job was made at.
(function () {
  var KEY = 'pl0t_paper_settings';
  var DEFAULTS = { paperSize: '9x12', margin: 1, customWidth: 8.5, customHeight: 11, orientation: 'portrait' };
  var KEYS = ['paperSize', 'margin', 'customWidth', 'customHeight', 'orientation'];

  function load() {
    var cfg = {}; for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (var j in s) if (j in DEFAULTS) cfg[j] = s[j];
    } catch (e) {}
    return cfg;
  }

  var config = load();
  window._paperSettings = config;
  window._pl0tLandscape = (config.orientation === 'landscape');   // was previously a per-sketch 'landscape' control

  function persist() { try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (e) {} }
  function resizeActiveSketch() {
    try { if (window.sketchAPI && window.sketchAPI.regenerate) window.sketchAPI.regenerate(); } catch (e) {}
  }
  function syncLandscapeGlobal() { window._pl0tLandscape = (config.orientation === 'landscape'); }
  // Rebuild the standard param panel so its Paper controls reflect a change that
  // did NOT originate from the user editing them directly (e.g. a loaded recipe) --
  // user-driven edits already flow through makeSketch.js's own control-change
  // handling, which keeps its DOM in sync without needing this.
  function refreshControlsUI() {
    try { if (window.makeSketchApp && window.makeSketchApp.refreshParamUI) window.makeSketchApp.refreshParamUI(); } catch (e) {}
  }

  // user edit -> persist + resize the live canvas
  function set(key, val) {
    if (KEYS.indexOf(key) < 0) return;
    config[key] = val;
    window._paperSettings = config;
    syncLandscapeGlobal();
    persist(); resizeActiveSketch();
  }

  // adopt paper from a loaded recipe. Quiet: sets state + refreshes the controls'
  // display but does NOT resize here -- the recipe-apply path triggers its own
  // regenerate after.
  function adopt(src) {
    if (!src || typeof src !== 'object') return;
    var changed = false;
    KEYS.forEach(function (k) {
      if (src[k] !== undefined && src[k] !== null && src[k] !== '') {
        config[k] = (k === 'margin' || k === 'customWidth' || k === 'customHeight') ? Number(src[k]) : src[k];
        changed = true;
      }
    });
    if (changed) { window._paperSettings = config; syncLandscapeGlobal(); persist(); refreshControlsUI(); }
  }
  // legacy recipes carried paperSize/margin/custom* AND the old per-sketch
  // 'landscape' (on/off) control inside params[] -- map both into this global.
  function adoptFromParams(params) {
    if (!Array.isArray(params)) return;
    var m = {};
    params.forEach(function (p) {
      if (!p) return;
      if (KEYS.indexOf(p.id) >= 0) m[p.id] = p.value;
      else if (p.id === 'landscape') m.orientation = (p.value === 'on') ? 'landscape' : 'portrait';
    });
    adopt(m);
  }

  window.PaperSettings = {
    get: function () { return config; },
    set: set, adopt: adopt, adoptFromParams: adoptFromParams, DEFAULTS: DEFAULTS
  };
})();
