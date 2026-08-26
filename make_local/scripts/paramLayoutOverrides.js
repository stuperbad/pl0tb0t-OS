// Editable-layout overrides: lets the operator drag param rows between groups
// (e.g. move Density from Advanced into General) and reorder them within a
// group, edit a numeric control's min/max/Show-mode-default, mark a control
// hidden-in-Show-mode, or suppress it entirely -- all from inside the make
// tab itself, instead of requiring a code change. Persisted per param id in
// localStorage so it survives sketch switches and app restarts. Edit mode
// itself is a transient authoring toggle -- NOT persisted, always off on a
// fresh load.
(function () {
  var KEY = 'pl0t_param_layout';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  // { group: {paramId: groupName}, order: {groupName: [paramId,...]},
  //   bounds: {paramId: {min, max, def}}, showHidden: {paramId: true},
  //   suppressed: {paramId: true} }
  var data = load();
  data.group = data.group || {};
  data.order = data.order || {};
  data.bounds = data.bounds || {};
  data.showHidden = data.showHidden || {};
  data.suppressed = data.suppressed || {};
  // Group-level overrides, mirroring the per-param ones: hide a whole
  // panel from Show mode, and reorder the panels themselves.
  data.groupHidden = data.groupHidden || {};
  data.groupOrder = data.groupOrder || [];
  // Which sketches appear in the chip row in Show mode. Same convention as
  // params and panels: absent = visible, so every existing sketch and any
  // added later starts ticked with no migration.
  data.sketchHidden = data.sketchHidden || {};

  // One-time reset to the new convention: a ticked box means VISIBLE in Show
  // mode, and everything starts ticked. Entries saved before this meant the
  // opposite ('ticked = hide'), so carrying them over would leave panels and
  // controls hidden for reasons nobody could reconstruct. Hard-coded
  // showModeHidden params in sketch code are untouched -- those live in code,
  // not here.
  if (data.visSchema !== 2) {
    data.groupHidden = {};
    data.showHidden = {};
    data.visSchema = 2;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  var editMode = false;
  var listeners = [];

  window.ParamLayout = {
    // Group override: null means "use the sketch/code default" (pdef.group or auto-bucket).
    getGroup: function (id) { return data.group[id] || null; },
    setGroup: function (id, group) {
      if (group) data.group[id] = group; else delete data.group[id];
      save();
    },
    // Row order within a group: array of param ids, most-recently-dragged layout wins.
    // Ids not present in the current sketch's params are simply skipped when applied.
    getOrder: function (group) { return data.order[group] || []; },
    setOrder: function (group, ids) { data.order[group] = (ids || []).slice(); save(); },
    // Numeric bounds override: {min, max, def}. `def` is NOT a general
    // "reset" value -- it's specifically what gets substituted for this
    // param while it's hidden in Show mode (see showHidden below). Editing
    // min/max here does not touch the live control until edit mode turns
    // off; editing def never touches the live control at all.
    getBounds: function (id) { return data.bounds[id] || null; },
    setBounds: function (id, bounds) { data.bounds[id] = bounds || {}; save(); },
    // Show-mode visibility override. The operator's choice is authoritative
    // in BOTH directions -- it can hide something the sketch didn't mark, and
    // it can reveal something the sketch DID mark showModeHidden.
    // Tri-state: true (user hid it) / false (user showed it) / absent (never
    // touched -> fall back to the sketch's own showModeHidden flag). Storing
    // an explicit false is what lets a user override a code-level default.
    getShowHidden: function (id) { return !!data.showHidden[id]; },
    hasShowHidden: function (id) { return Object.prototype.hasOwnProperty.call(data.showHidden, id); },
    setShowHidden: function (id, on) { data.showHidden[id] = !!on; save(); },
    // Suppressed: fully removed from the UI in both modes, EXCEPT while Edit
    // layout mode is on, where it still renders (grayed out, pushed to the
    // bottom of its group) so it can be found again and un-suppressed.
    getSuppressed: function (id) { return !!data.suppressed[id]; },
    setSuppressed: function (id, on) {
      if (on) data.suppressed[id] = true; else delete data.suppressed[id];
      save();
    },
    getGroupHidden: function (g) { return !!data.groupHidden[g]; },
    hasGroupHidden: function (g) { return Object.prototype.hasOwnProperty.call(data.groupHidden, g); },
    setGroupHidden: function (g, on) { data.groupHidden[g] = !!on; save(); },
    getSketchHidden: function (id) { return !!data.sketchHidden[id]; },
    hasSketchHidden: function (id) { return Object.prototype.hasOwnProperty.call(data.sketchHidden, id); },
    setSketchHidden: function (id, on) { data.sketchHidden[id] = !!on; save(); },
    getGroupOrder: function () { return (data.groupOrder || []).slice(); },
    setGroupOrder: function (ids) { data.groupOrder = (ids || []).slice(); save(); },
    isEditMode: function () { return editMode; },
    setEditMode: function (on) {
      editMode = !!on;
      listeners.forEach(function (fn) { try { fn(editMode); } catch (e) {} });
    },
    onEditModeChange: function (fn) { listeners.push(fn); },
    resetAll: function () {
      data.group = {}; data.order = {}; data.bounds = {}; data.showHidden = {}; data.suppressed = {};
      save();
    }
  };
})();
