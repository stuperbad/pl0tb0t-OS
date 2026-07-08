// Make-tab-owned GLOBAL paper settings.
//
// Paper used to be a per-sketch control (buildPaperParams injected paperSize /
// margin / customWidth / customHeight into every sketch). It's an author-time
// choice that should be set ONCE, so it now lives here: a single global panel,
// persisted in localStorage, exposed as window._paperSettings, which the paper
// helpers (sharedPaperControls.js) read. Because sketches build their canvas via
// getPaperPixels(), switching sketches auto-adopts the global size -- no per-sketch
// wiring. Recipes carry paper in recipe.globals.paper (see makeSketch.js), so
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

  // user edit -> persist + resize the live canvas
  function set(key, val) {
    if (KEYS.indexOf(key) < 0) return;
    config[key] = val;
    window._paperSettings = config;
    syncLandscapeGlobal();
    persist(); syncUI(); resizeActiveSketch();
  }

  // adopt paper from a loaded recipe. Quiet: sets state + UI + persist but does
  // NOT resize here -- the recipe-apply path triggers its own regenerate after.
  function adopt(src) {
    if (!src || typeof src !== 'object') return;
    var changed = false;
    KEYS.forEach(function (k) {
      if (src[k] !== undefined && src[k] !== null && src[k] !== '') {
        config[k] = (k === 'margin' || k === 'customWidth' || k === 'customHeight') ? Number(src[k]) : src[k];
        changed = true;
      }
    });
    if (changed) { window._paperSettings = config; syncLandscapeGlobal(); persist(); syncUI(); }
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

  // ---- UI ----
  var els = {};
  function syncUI() {
    if (els.paperSize) els.paperSize.value = config.paperSize;
    if (els.margin) els.margin.value = String(config.margin);
    if (els.customWidth) els.customWidth.value = config.customWidth;
    if (els.customHeight) els.customHeight.value = config.customHeight;
    if (els.orientation) els.orientation.value = config.orientation;
    var isCustom = config.paperSize === 'custom';
    if (els.customWRow) els.customWRow.style.display = isCustom ? 'flex' : 'none';
    if (els.customHRow) els.customHRow.style.display = isCustom ? 'flex' : 'none';
  }

  function row(labelText) {
    var r = document.createElement('label');
    r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#344054;margin:5px 0;';
    var span = document.createElement('span'); span.textContent = labelText; r.appendChild(span);
    return r;
  }

  function buildPanel() {
    var mount = document.getElementById('globalAuthorParams');
    if (!mount || document.getElementById('paperSettingsPanel')) return;

    var panel = document.createElement('div');
    panel.id = 'paperSettingsPanel';
    panel.style.cssText = 'border:1px solid #e4e7ec;border-radius:6px;margin:8px 0;background:#fff;';

    var open = true;
    var head = document.createElement('div');
    head.style.cssText = 'font-size:12px;font-weight:700;color:#475467;padding:8px 10px;cursor:pointer;user-select:none;';
    var body = document.createElement('div');
    body.style.cssText = 'padding:0 10px 8px;';
    function paintHead() { head.textContent = (open ? '▾' : '▸') + ' Paper'; }
    paintHead();
    head.addEventListener('click', function () { open = !open; body.style.display = open ? 'block' : 'none'; paintHead(); });

    // paper size
    var pr = row('Paper size');
    els.paperSize = document.createElement('select'); els.paperSize.style.cssText = 'font-size:12px;';
    [['5x7', '5 x 7"'], ['9x12', '9 x 12"'], ['11x14', '11 x 14"'], ['11x17', '11 x 17"'], ['14x17', '14 x 17"'], ['custom', 'Custom...']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; els.paperSize.appendChild(op); });
    els.paperSize.addEventListener('change', function () { set('paperSize', els.paperSize.value); });
    pr.appendChild(els.paperSize); body.appendChild(pr);

    // custom W/H
    els.customWRow = row('Width (in)');
    els.customWidth = document.createElement('input'); els.customWidth.type = 'number'; els.customWidth.step = '0.25'; els.customWidth.min = '1'; els.customWidth.max = '48';
    els.customWidth.style.cssText = 'font-size:12px;width:66px;';
    els.customWidth.addEventListener('change', function () { var v = parseFloat(els.customWidth.value); if (!isNaN(v)) set('customWidth', v); });
    els.customWRow.appendChild(els.customWidth); body.appendChild(els.customWRow);

    els.customHRow = row('Height (in)');
    els.customHeight = document.createElement('input'); els.customHeight.type = 'number'; els.customHeight.step = '0.25'; els.customHeight.min = '1'; els.customHeight.max = '48';
    els.customHeight.style.cssText = 'font-size:12px;width:66px;';
    els.customHeight.addEventListener('change', function () { var v = parseFloat(els.customHeight.value); if (!isNaN(v)) set('customHeight', v); });
    els.customHRow.appendChild(els.customHeight); body.appendChild(els.customHRow);

    // margin
    var mr = row('Margin');
    els.margin = document.createElement('select'); els.margin.style.cssText = 'font-size:12px;';
    [['0', '0 (none)'], ['0.5', '1/2 inch'], ['0.75', '3/4 inch'], ['1', '1 inch']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; els.margin.appendChild(op); });
    els.margin.addEventListener('change', function () { set('margin', Number(els.margin.value)); });
    mr.appendChild(els.margin); body.appendChild(mr);

    // orientation (was the per-sketch "Landscape" control -- global now, since
    // it flips the same paper the rest of this panel controls)
    var or = row('Orientation');
    els.orientation = document.createElement('select'); els.orientation.style.cssText = 'font-size:12px;';
    [['portrait', 'Portrait'], ['landscape', 'Landscape']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; els.orientation.appendChild(op); });
    els.orientation.addEventListener('change', function () { set('orientation', els.orientation.value); });
    or.appendChild(els.orientation); body.appendChild(or);

    panel.appendChild(head); panel.appendChild(body);
    mount.appendChild(panel);
    syncUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
