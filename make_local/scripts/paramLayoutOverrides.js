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
    // Show-mode visibility override: true = force-hide in Show mode even
    // though the sketch/code didn't mark it showModeHidden. There is
    // deliberately no way to force a hardcoded showModeHidden param visible.
    getShowHidden: function (id) { return !!data.showHidden[id]; },
    setShowHidden: function (id, on) {
      if (on) data.showHidden[id] = true; else delete data.showHidden[id];
      save();
    },
    // Suppressed: fully removed from the UI in both modes, EXCEPT while Edit
    // layout mode is on, where it still renders (grayed out, pushed to the
    // bottom of its group) so it can be found again and un-suppressed.
    getSuppressed: function (id) { return !!data.suppressed[id]; },
    setSuppressed: function (id, on) {
      if (on) data.suppressed[id] = true; else delete data.suppressed[id];
      save();
    },
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
