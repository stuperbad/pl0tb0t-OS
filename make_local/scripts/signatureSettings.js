// Make-tab-owned signature settings.
//
// Migrated off the Python OS: the desktop app used to push `window._signatureConfig`
// into the page on load (_push_signature_config). Signature is an AUTHOR-time
// choice, so the make tab now OWNS it end-to-end -- config lives here, is edited
// here, persisted in localStorage, and consumed by signature.js (buildSignatureSVG).
// Nothing hardware-side is involved until plot, so this belongs in the JS layer.
(function () {
  var KEY = 'pl0t_signature_config';
  var DEFAULTS = {
    enabled: false, showPreview: true, suppressExport: false, showLogo: true, showSeedName: true,
    onlySignature: false,   // suppress the sketch's own art; canvas + exported/queued SVG show only the signature band
    font: 'ef', customMsg: '', heightMm: 2.0, scale: 2.0, fromMarginMm: -1,
    hPadMm: 0.0, penWidthMm: 0.4, logoScale: 1.0, sepScale: 1.3, sepPad: 1.3,
    logoOffsetPct: 80   // logo fill: each inset pass steps in by this % of pen width
  };

  function load() {
    var cfg = {}; for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (var j in s) if (j in DEFAULTS) cfg[j] = s[j];
    } catch (e) {}
    return cfg;
  }

  var config = load();
  window._signatureConfig = config;   // make tab now owns this (was Python-pushed)

  function apply() {
    window._signatureConfig = config;
    try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (e) {}
    try { if (window.sketchAPI && window.sketchAPI.redraw) window.sketchAPI.redraw(); } catch (e) {}
  }
  function set(key, val) { if (key in DEFAULTS) { config[key] = val; apply(); } }
  window.SignatureSettings = { get: function () { return config; }, set: set, DEFAULTS: DEFAULTS };

  // ---- UI panel (collapsible, mounts in the global-authorship column) ----
  var CHECKS = [
    ['enabled', 'Enable signature'],
    ['showPreview', 'Show preview on canvas'],
    ['suppressExport', 'Suppress from SVG export'],
    ['showLogo', 'Include 90% logo'],
    ['showSeedName', 'Include seed name'],
    ['onlySignature', 'Signature only (suppress art)']
  ];
  var NUMS = [
    ['heightMm', 'Text height (mm)', 0.1],
    ['scale', 'Scale', 0.1],
    ['fromMarginMm', 'Offset into margin (mm)', 0.1],
    ['hPadMm', 'Band padding (mm)', 0.1],
    ['penWidthMm', 'Pen width (mm)', 0.05],
    ['logoScale', 'Logo scale', 0.1],
    ['logoOffsetPct', 'Logo fill offset (%)', 5],
    ['sepScale', 'Separator scale', 0.1],
    ['sepPad', 'Separator padding (em)', 0.1]
  ];

  function row(labelText) {
    var r = document.createElement('label');
    r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#344054;margin:5px 0;';
    var span = document.createElement('span'); span.textContent = labelText; r.appendChild(span);
    return r;
  }

  function buildPanel() {
    var mount = document.getElementById('globalAuthorParams');
    if (!mount || document.getElementById('sigSettingsPanel')) return;

    var panel = document.createElement('div');
    panel.id = 'sigSettingsPanel';
    panel.style.cssText = 'border:1px solid #e4e7ec;border-radius:6px;margin:8px 0;background:#fff;';

    var open = false;
    var head = document.createElement('div');
    head.textContent = '▸ Signature';
    head.style.cssText = 'font-size:12px;font-weight:700;color:#475467;padding:8px 10px;cursor:pointer;user-select:none;';
    var body = document.createElement('div');
    body.style.cssText = 'padding:0 10px 8px;display:none;';
    head.addEventListener('click', function () {
      open = !open; body.style.display = open ? 'block' : 'none';
      head.textContent = (open ? '▾' : '▸') + ' Signature';
    });

    CHECKS.forEach(function (c) {
      var r = row(c[1]);
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!config[c[0]];
      cb.addEventListener('change', function () { set(c[0], cb.checked); });
      r.appendChild(cb); body.appendChild(r);
    });

    var fr = row('Font');
    var fs = document.createElement('select'); fs.style.cssText = 'font-size:12px;';
    [['ef', 'EF Script'], ['hershey', 'Hershey']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; fs.appendChild(op);
    });
    fs.value = config.font; fs.addEventListener('change', function () { set('font', fs.value); });
    fr.appendChild(fs); body.appendChild(fr);

    var mr = row('Custom message');
    var mi = document.createElement('input'); mi.type = 'text'; mi.value = config.customMsg;
    mi.style.cssText = 'font-size:12px;width:130px;';
    mi.addEventListener('input', function () { set('customMsg', mi.value); });
    mr.appendChild(mi); body.appendChild(mr);

    NUMS.forEach(function (n) {
      var r = row(n[1]);
      var ni = document.createElement('input'); ni.type = 'number'; ni.step = String(n[2]); ni.value = config[n[0]];
      ni.style.cssText = 'font-size:12px;width:66px;';
      ni.addEventListener('change', function () { var v = parseFloat(ni.value); if (!isNaN(v)) set(n[0], v); });
      r.appendChild(ni); body.appendChild(r);
    });

    panel.appendChild(head); panel.appendChild(body);
    mount.appendChild(panel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
