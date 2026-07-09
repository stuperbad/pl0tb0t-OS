// Editable-layout overrides: lets the operator drag param rows between groups
// (e.g. move Density from Advanced into General) and reorder them within a
// group, from inside the make tab itself, instead of requiring a code change.
// Persisted per param id in localStorage so it survives sketch switches and
// app restarts. Edit mode itself is a transient authoring toggle -- NOT
// persisted, always off on a fresh load.
(function () {
  var KEY = 'pl0t_param_layout';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  var data = load();   // { group: {paramId: groupName}, order: {groupName: [paramId,...]} }
  data.group = data.group || {};
  data.order = data.order || {};

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
    isEditMode: function () { return editMode; },
    setEditMode: function (on) {
      editMode = !!on;
      listeners.forEach(function (fn) { try { fn(editMode); } catch (e) {} });
    },
    onEditModeChange: function (fn) { listeners.push(fn); },
    resetAll: function () { data.group = {}; data.order = {}; save(); }
  };
})();
