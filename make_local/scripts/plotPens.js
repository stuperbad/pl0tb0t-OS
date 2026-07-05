// plotPens.js — global pen registry, owned by the JS framework.
// Ordered list (holder-slot order, index 0 = slot 1 = rightmost chip) of
// {label, color, pen_type}, persisted in localStorage. The OS pushes the brand
// list (window._pl0tPenTypes) and per-brand tip widths
// (window._pl0tPenTipWidths) from the machine tab's Pen Type Offsets; line
// width is a brand property, so widthFor() derives it from the pen's brand.
// Defaults to a CMYK Stabilo set when nothing is saved yet.
//
// Named custom sets (user-saved snapshots of pens()) live under a separate
// localStorage key so they persist independently of whatever's currently
// loaded -- e.g. a "RL CMYK Micron" preset dialed in once and reused later.
window.plotPens = (function() {
    var KEY = 'pl0t_pens';
    var SETS_KEY = 'pl0t_pen_sets';
    var DEFAULT_SET = [
        { label: 'Cyan',    color: '#00ffff', pen_type: 'stabilo' },
        { label: 'Magenta', color: '#ff00ff', pen_type: 'stabilo' },
        { label: 'Yellow',  color: '#ffff00', pen_type: 'stabilo' },
        { label: 'Black',   color: '#000000', pen_type: 'stabilo' }
    ];
    function _default() {
        return DEFAULT_SET.map(function(p) { return { label: p.label, color: p.color, pen_type: p.pen_type }; });
    }
    function _load() {
        try {
            var a = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (Array.isArray(a) && a.length) return a;
        } catch (e) {}
        return _default();
    }
    var _pens = _load();
    window._pl0tPens = _pens;   // read-only mirror for quick inspection
    function pens() { return _pens; }
    function setPens(list) {
        _pens = (Array.isArray(list) ? list : []).slice(0, 10);
        window._pl0tPens = _pens;
        try { localStorage.setItem(KEY, JSON.stringify(_pens)); } catch (e) {}
    }
    function byColor(hex) {
        hex = String(hex || '').toLowerCase();
        for (var i = 0; i < _pens.length; i++) {
            if (String(_pens[i].color || '').toLowerCase() === hex) return _pens[i];
        }
        return null;
    }
    function types() {
        return (Array.isArray(window._pl0tPenTypes) && window._pl0tPenTypes.length)
            ? window._pl0tPenTypes : ['stabilo', 'pilot', 'micron', 'sharpie'];
    }
    function tipWidth(ptype) {
        var tips = window._pl0tPenTipWidths || {};
        var w = Number(tips[ptype]);
        return (w > 0) ? w : null;
    }
    function _loadSets() {
        try {
            var o = JSON.parse(localStorage.getItem(SETS_KEY) || 'null');
            if (o && typeof o === 'object' && !Array.isArray(o)) return o;
        } catch (e) {}
        return {};
    }
    var _sets = _loadSets();
    function _persistSets() {
        try { localStorage.setItem(SETS_KEY, JSON.stringify(_sets)); } catch (e) {}
    }
    function savedSets() { return _sets; }
    function saveSet(name, list) {
        name = String(name || '').trim();
        if (!name) return false;
        var src = Array.isArray(list) ? list : _pens;
        _sets[name] = src.map(function(p) { return { label: p.label, color: p.color, pen_type: p.pen_type }; });
        _persistSets();
        return true;
    }
    function deleteSet(name) {
        delete _sets[name];
        _persistSets();
    }
    function loadSet(name) {
        var s = _sets[name];
        return s ? s.map(function(p) { return { label: p.label, color: p.color, pen_type: p.pen_type }; }) : null;
    }
    return {
        pens: pens,
        setPens: setPens,
        types: types,
        tipWidth: tipWidth,
        savedSets: savedSets,
        saveSet: saveSet,
        deleteSet: deleteSet,
        loadSet: loadSet,
        cmykSet: function(brand) {
            return DEFAULT_SET.map(function(p) { return { label: p.label, color: p.color, pen_type: brand || 'stabilo' }; });
        },
        colors: function() { return _pens.map(function(p) { return p.color; }); },
        widthFor: function(hex) {
            var p = byColor(hex);
            if (!p) return null;
            var w = tipWidth(p.pen_type);
            if (w) return w;
            w = Number(p.width_mm);   // legacy per-pen width fallback
            return (w > 0) ? w : null;
        },
        typeFor: function(hex) { var p = byColor(hex); return p ? (p.pen_type || '') : ''; },
        labelFor: function(hex) { var p = byColor(hex); return p ? (p.label || '') : ''; }
    };
})();
