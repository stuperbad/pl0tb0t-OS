// calibration.js — pl0tb0t-OS plotter calibration / test card
// A deterministic diagnostic sheet. Every element is plottable strokes so the
// preview == the plot. Sections toggle on/off so you print only what you need.
//
// FIT MODEL: the card adapts to any paper size. Layout is derived from the
// available inner width, and a shrink-to-fit factor (vs) is applied to all the
// NON-measurement dimensions (heights, gaps, swatch/target sizes, ruler tick
// LENGTHS). The MEASURED quantities stay at true millimetres regardless of
// paper size: pen-width line spacings, fill hatch spacings, and ruler tick
// POSITIONS — so the diagnostics remain accurate even squeezed onto 5x7.
window.sketches = window.sketches || {};
window.sketches['calibration'] = function(p) {
    var paper = window.makeSketchUtils;

    var PARAMS = {
        paperSize: '9x12',
        margin: 1,
        palette: ['#000000', '#00ffff', '#ff00ff', '#ffff00'],
        penWidth: 0.4,
        secMargin: 'on',
        secRegistration: 'on',
        secPenWidth: 'on',
        secFill: 'on',
        secColorMix: 'off',
        secRulers: 'on',
        secGeometry: 'off',
        secContinuity: 'on',
        secVernier: 'on',
        regScale: 1.0,  // registration target size multiplier
        penMax: 1.0,   // pen-width ladder: coarsest spacing (mm)
        penMin: 0.2,   // pen-width ladder: finest spacing (mm)
        fillMax: 1.0,  // fill swatches: coarsest hatch spacing (mm)
        fillMin: 0.2,  // fill swatches: finest hatch spacing (mm)
        mixSpacing: 0.5 // color-mix grid: hatch spacing (mm)
    };

    var helpEl = null;

    // ---- tiny 7-seg number renderer (so labels are plottable) --------------
    var SEG = {
        a: [[0, 0], [1, 0]], b: [[1, 0], [1, 0.5]], c: [[1, 0.5], [1, 1]],
        d: [[0, 1], [1, 1]], e: [[0, 0.5], [0, 1]], f: [[0, 0], [0, 0.5]], g: [[0, 0.5], [1, 0.5]]
    };
    var DIG = {
        '0': 'abcdef', '1': 'bc', '2': 'abgde', '3': 'abgcd', '4': 'fgbc',
        '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg'
    };
    function numOps(ops, str, x, y, h, col) {
        var cw = h * 0.55, cx = x;
        for (var i = 0; i < str.length; i++) {
            var ch = str[i];
            if (ch === '.') {
                ops.push({ x1: cx + cw * 0.25, y1: y + h - Math.max(1, h * 0.14), x2: cx + cw * 0.25, y2: y + h, color: col });
                cx += cw * 0.5; continue;
            }
            if (ch === '-') {
                var sm = SEG.g;
                ops.push({ x1: cx + sm[0][0] * cw, y1: y + sm[0][1] * h, x2: cx + sm[1][0] * cw, y2: y + sm[1][1] * h, color: col });
                cx += cw + h * 0.2; continue;
            }
            if (ch === ' ') { cx += cw * 0.6; continue; }
            var segs = DIG[ch];
            if (segs) {
                for (var k = 0; k < segs.length; k++) {
                    var s = SEG[segs[k]];
                    ops.push({ x1: cx + s[0][0] * cw, y1: y + s[0][1] * h, x2: cx + s[1][0] * cw, y2: y + s[1][1] * h, color: col });
                }
            }
            cx += cw + h * 0.2;
        }
        return cx - x;
    }
    function numW(str, h) { return str.length * (h * 0.55 + h * 0.2); }

    // ---- geometry op helpers ----------------------------------------------
    function line(ops, x1, y1, x2, y2, col) { ops.push({ x1: x1, y1: y1, x2: x2, y2: y2, color: col }); }
    function rectOps(ops, x, y, w, h, col) {
        line(ops, x, y, x + w, y, col); line(ops, x + w, y, x + w, y + h, col);
        line(ops, x + w, y + h, x, y + h, col); line(ops, x, y + h, x, y, col);
    }
    function ringOps(ops, cx, cy, r, col, segN) {
        segN = segN || 48; var prev = null;
        for (var i = 0; i <= segN; i++) {
            var a = i / segN * Math.PI * 2;
            var pt = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
            if (prev) line(ops, prev.x, prev.y, pt.x, pt.y, col);
            prev = pt;
        }
    }
    function crossOps(ops, cx, cy, r, col) {
        line(ops, cx - r, cy, cx + r, cy, col); line(ops, cx, cy - r, cx, cy + r, col);
    }
    function hatchRectOps(ops, x, y, w, h, spacingPx, angleDeg, col) {
        var poly = [{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }];
        var sp = Math.max(0.3, spacingPx);
        if (window.plotFills && window.plotFills.hatchPolyRows) {
            var rows = window.plotFills.hatchPolyRows(poly, angleDeg, sp);
            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                for (var s = 0; s < row.length; s++) {
                    var g = row[s];
                    ops.push({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, color: col });
                }
            }
        } else {
            for (var yy = y; yy <= y + h; yy += sp) line(ops, x, yy, x + w, yy, col);
        }
    }
    function on(v) { return v === 'on' || v === true; }
    function fmt(v) { return (Math.round(v * 100) / 100).toString(); }
    function ramp(a, b, n) { var out = []; if (n <= 1) return [a]; for (var i = 0; i < n; i++) out.push(a + (b - a) * i / (n - 1)); return out; }

    // ---- build the whole card as color-tagged segments (adaptive) ---------
    function buildOps() {
        var ops = [];
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var mm = function (v) { return paper.mmToPixels(v); };
        var mgn = paper.getMarginPixels(PARAMS.margin);
        var x0 = mgn, y0 = mgn, x1 = dims.width - mgn, y1 = dims.height - mgn;
        var innerW = x1 - x0, innerH = y1 - y0;
        var pal = (PARAMS.palette && PARAMS.palette.length) ? PARAMS.palette : ['#000000'];
        var nP = pal.length;
        var sigCol = (window.Signature && window.Signature.pickSignatureColor)
            ? window.Signature.pickSignatureColor(pal) : '#000000';
        var pad = mm(3);
        var availW = Math.max(mm(15), innerW - 2 * pad);
        var sx = x0 + pad;

        var secs = [];
        if (on(PARAMS.secRegistration)) secs.push('reg');
        if (on(PARAMS.secContinuity)) secs.push('cont');
        if (on(PARAMS.secVernier) && nP >= 2) secs.push('vern');
        if (on(PARAMS.secPenWidth)) secs.push('pen');
        if (on(PARAMS.secFill)) secs.push('fill');
        if (on(PARAMS.secColorMix) && nP >= 2) secs.push('mix');
        if (on(PARAMS.secRulers)) secs.push('rul');
        if (on(PARAMS.secGeometry)) secs.push('geo');

        // natural (pre-scale) metrics
        var gapNat = mm(6), labHNat = mm(3), topNat = mm(7);
        var regOuterNat = Math.min((mm(2.5) + nP * mm(1.6)) * PARAMS.regScale, availW / 7);
        var contVLenNat = mm(40);
        var penRowNat = mm(11);
        var fillGap = mm(2.5);
        var fslotNat = Math.min(mm(15), (availW - 5 * fillGap) / 6);
        var mixGap = mm(1.5);
        var csqNat = Math.min(mm(12), (availW - (nP - 1) * mixGap) / nP);
        var geoNat = Math.min(mm(45), availW);
        var vRulNat = mm(45);

        function natH(s) {
            if (s === 'reg') return 2 * regOuterNat;
            if (s === 'cont') return contVLenNat + mm(7);
            if (s === 'vern') return mm(38);
            if (s === 'pen') return nP * penRowNat + labHNat + mm(2);
            if (s === 'fill') return nP * (fslotNat + mm(1.5)) + labHNat + mm(2);
            if (s === 'mix') return nP * (csqNat + mixGap);
            if (s === 'rul') return mm(9) + vRulNat;
            if (s === 'geo') return geoNat;
            return 0;
        }
        var Hnat = topNat;
        for (var i = 0; i < secs.length; i++) { Hnat += natH(secs[i]); if (i < secs.length - 1) Hnat += gapNat; }
        var vs = Math.min(1, (innerH - mm(8)) / Math.max(1, Hnat));

        var gap = gapNat * vs, labH = Math.max(mm(1.4), labHNat * vs), topOff = topNat * vs;

        if (on(PARAMS.secMargin)) {
            rectOps(ops, x0, y0, innerW, innerH, sigCol);
            var cl = Math.min(mm(5), innerW * 0.12, innerH * 0.12);
            line(ops, x0, y0 + cl, x0 + cl, y0 + cl, sigCol); line(ops, x0 + cl, y0, x0 + cl, y0 + cl, sigCol);
            line(ops, x1 - cl, y0, x1 - cl, y0 + cl, sigCol); line(ops, x1 - cl, y0 + cl, x1, y0 + cl, sigCol);
            line(ops, x0, y1 - cl, x0 + cl, y1 - cl, sigCol); line(ops, x0 + cl, y1 - cl, x0 + cl, y1, sigCol);
            line(ops, x1 - cl, y1 - cl, x1, y1 - cl, sigCol); line(ops, x1 - cl, y1 - cl, x1 - cl, y1, sigCol);
        }

        var cy = y0 + topOff;

        for (var si = 0; si < secs.length; si++) {
            var sec = secs[si];

            if (sec === 'reg') {
                var baseR = mm(2.5) * vs * PARAMS.regScale, step = mm(1.6) * vs * PARAMS.regScale;
                var outerR = baseR + nP * step;
                var ty = cy + outerR;
                var txs = [sx + outerR, x0 + innerW / 2, x1 - pad - outerR];
                for (var t = 0; t < txs.length; t++) {
                    for (var ci = 0; ci < nP; ci++) {
                        var r = baseR + ci * step;
                        ringOps(ops, txs[t], ty, r, pal[ci]);
                        crossOps(ops, txs[t], ty, r, pal[ci]);
                    }
                    crossOps(ops, txs[t], ty, mm(1) * vs, sigCol);
                }
                cy = ty + outerR + gap;

            } else if (sec === 'cont') {
                // Verticality / horizontality: one H and one V line, each split into a
                // segment per pen drawn end-to-end. Aligned pens => dead-straight line;
                // a pen offset shows as a step at its segment (directly shows the Y-offset).
                var tick = mm(2) * vs;
                var hy = cy + tick + mm(1) * vs;
                var hseg = availW / nP;
                for (var hi = 0; hi < nP; hi++) line(ops, sx + hi * hseg, hy, sx + (hi + 1) * hseg, hy, pal[hi]);
                for (var hb = 0; hb <= nP; hb++) { var bx = sx + hb * hseg; line(ops, bx, hy - tick, bx, hy + tick, sigCol); }
                var vy0 = hy + mm(4) * vs;
                var vLen = Math.min(contVLenNat * vs, (y1 - pad) - vy0);
                var vx = x0 + innerW / 2;
                if (vLen > mm(8)) {
                    var vseg = vLen / nP;
                    for (var vi = 0; vi < nP; vi++) line(ops, vx, vy0 + vi * vseg, vx, vy0 + (vi + 1) * vseg, pal[vi]);
                    for (var vb = 0; vb <= nP; vb++) { var by = vy0 + vb * vseg; line(ops, vx - tick, by, vx + tick, by, sigCol); }
                    cy = vy0 + vLen + gap;
                } else { cy = vy0 + gap; }

            } else if (sec === 'vern') {
                // Vernier Y-offset gauge: ref pen (first color) ticks every 1.0mm on the
                // left of each spine; each other pen's ticks every 0.9mm on the right.
                // 0.9 pitch makes the reading equal the Y TRIM to enter directly: a pen
                // drawing HIGH on the page aligns above center at a NEGATIVE label
                // (tick / 10 = trim in mm, e.g. -5 -> enter -0.5, moves the pen down).
                // Pitches are TRUE mm (measurement) — small paper gets fewer ticks, not
                // smaller pitch.
                var alloc = mm(38) * vs;
                var NV = Math.max(5, Math.min(15, Math.floor((alloc / mm(1.0) - 3) / 2)));
                var tickL = mm(3.5) * vs, tickS = mm(2.2) * vs;
                var vcy = cy + NV * mm(1.0) + mm(1) * vs;   // gauge centerline
                var nCmp = nP - 1;
                var colW = availW / nCmp;
                for (var vk = 1; vk < nP; vk++) {
                    var spx = sx + (vk - 0.5) * colW;
                    for (var vn = -NV; vn <= NV; vn++) {
                        var refLen = (vn === 0) ? tickL * 1.5 : (vn % 5 === 0 ? tickL : tickS);
                        line(ops, spx - refLen, vcy + mm(vn), spx, vcy + mm(vn), pal[0]);
                        var tstLen = (vn === 0) ? tickL * 1.5 : (vn % 5 === 0 ? tickL : tickS);
                        line(ops, spx, vcy + mm(vn * 0.9), spx + tstLen, vcy + mm(vn * 0.9), pal[vk]);
                        if (vn % 5 === 0 && vn !== 0) {
                            var vlbl = String(vn);
                            numOps(ops, vlbl, spx + tickL * 1.7, vcy + mm(vn * 0.9) - labH / 2, labH * 0.9, sigCol);
                        }
                    }
                }
                cy = vcy + NV * mm(1.0) + mm(2) * vs + gap;

            } else if (sec === 'pen') {
                var pHi = Math.max(PARAMS.penMax, PARAMS.penMin), pLo = Math.min(PARAMS.penMax, PARAMS.penMin);
                var spac = ramp(pHi, pLo, 6), nG = spac.length;
                var slot = Math.min(availW / nG, mm(18));
                var rowH = penRowNat * vs, lineH = rowH * 0.82;
                for (var gi = 0; gi < nG; gi++) {
                    var s = mm(spac[gi]);
                    var slotX = sx + gi * slot;
                    var n = 8, span = (n - 1) * s, lx0 = slotX + (slot - span) / 2;
                    for (var pc = 0; pc < nP; pc++) {
                        var ry = cy + pc * rowH;
                        for (var li = 0; li < n; li++) line(ops, lx0 + li * s, ry, lx0 + li * s, ry + lineH, pal[pc]);
                    }
                    var lbl = fmt(spac[gi]);
                    numOps(ops, lbl, slotX + slot / 2 - numW(lbl, labH) / 2, cy + nP * rowH + mm(1) * vs, labH, sigCol);
                }
                cy += nP * rowH + labH + mm(2) * vs + gap;

            } else if (sec === 'fill') {
                var fLo = Math.min(PARAMS.fillMax, PARAMS.fillMin), fHi = Math.max(PARAMS.fillMax, PARAMS.fillMin);
                var fs = ramp(fLo, fHi, 6);
                var fslot = fslotNat;
                var sqW = Math.min(mm(11) * vs, fslot);
                var fcellH = sqW + mm(1.5) * vs;
                for (var fj = 0; fj < 6; fj++) {
                    var cellX = sx + fj * (fslot + fillGap);
                    var fx = cellX + (fslot - sqW) / 2;
                    for (var fp = 0; fp < nP; fp++) {
                        var fy = cy + fp * fcellH;
                        rectOps(ops, fx, fy, sqW, sqW, pal[fp]);
                        hatchRectOps(ops, fx, fy, sqW, sqW, mm(fs[fj]), 45, pal[fp]);
                    }
                    var flbl = fmt(fs[fj]);
                    numOps(ops, flbl, cellX + fslot / 2 - numW(flbl, labH) / 2, cy + nP * fcellH + mm(1) * vs, labH, sigCol);
                }
                cy += nP * fcellH + labH + mm(2) * vs + gap;

            } else if (sec === 'mix') {
                var csq = Math.min(csqNat * vs, (availW - (nP - 1) * mixGap) / nP);
                var msp = mm(PARAMS.mixSpacing);
                for (var mi = 0; mi < nP; mi++) {
                    for (var mj = 0; mj < nP; mj++) {
                        var mx = sx + mj * (csq + mixGap), my = cy + mi * (csq + mixGap);
                        rectOps(ops, mx, my, csq, csq, sigCol);
                        hatchRectOps(ops, mx, my, csq, csq, msp, 45, pal[mi]);
                        if (mj !== mi) hatchRectOps(ops, mx, my, csq, csq, msp, -45, pal[mj]);
                    }
                }
                cy += nP * (csq + mixGap) + gap;

            } else if (sec === 'rul') {
                var tickMaj = mm(3.5) * vs, tickMid = mm(2.2) * vs, tickMin = mm(1.1) * vs;
                var ry2 = cy + mm(1) * vs;
                line(ops, sx, ry2, sx + availW, ry2, sigCol);
                var totMm = Math.floor(availW / mm(1));
                for (var t2 = 0; t2 <= totMm; t2++) {
                    var tx = sx + mm(t2);
                    var th = (t2 % 10 === 0) ? tickMaj : (t2 % 5 === 0 ? tickMid : tickMin);
                    line(ops, tx, ry2, tx, ry2 + th, sigCol);
                    if (t2 % 10 === 0 && t2 > 0) { var nlbl = String(t2 / 10); numOps(ops, nlbl, tx - numW(nlbl, labH) / 2, ry2 + tickMaj + mm(0.6) * vs, labH, sigCol); }
                }
                var hPart = mm(1) * vs + tickMaj + labH + mm(1.5) * vs;
                var vy = cy + hPart;
                var vLen = Math.min(vRulNat * vs, (y1 - pad) - vy);
                if (vLen > mm(8)) {
                    line(ops, sx, vy, sx, vy + vLen, sigCol);
                    var vMm = Math.floor(vLen / mm(1));
                    for (var t3 = 0; t3 <= vMm; t3++) {
                        var vty = vy + mm(t3);
                        var tw = (t3 % 10 === 0) ? tickMaj : (t3 % 5 === 0 ? tickMid : tickMin);
                        line(ops, sx, vty, sx + tw, vty, sigCol);
                        if (t3 % 10 === 0 && t3 > 0) numOps(ops, String(t3 / 10), sx + tickMaj + mm(0.6) * vs, vty - labH / 2, labH, sigCol);
                    }
                    cy = vy + vLen + gap;
                } else {
                    cy = vy + gap;
                }

            } else if (sec === 'geo') {
                var side = Math.min(geoNat * vs, availW, (y1 - pad) - cy);
                if (side > mm(10)) {
                    var gx = x0 + innerW / 2 - side / 2, gy = cy;
                    rectOps(ops, gx, gy, side, side, sigCol);
                    line(ops, gx, gy, gx + side, gy + side, sigCol);
                    line(ops, gx + side, gy, gx, gy + side, sigCol);
                    ringOps(ops, gx + side / 2, gy + side / 2, side / 2, sigCol, 72);
                    cy += side + gap;
                }
            }
        }

        return { ops: ops, dims: dims };
    }

    var api = {
        stylePresets: [
            { label: 'Full card', values: { secMargin: 'on', secRegistration: 'on', secContinuity: 'on', secVernier: 'on', secPenWidth: 'on', secFill: 'on', secColorMix: 'on', secRulers: 'on', secGeometry: 'on' } },
            { label: 'Alignment only', values: { secMargin: 'on', secRegistration: 'on', secContinuity: 'on', secVernier: 'on', secPenWidth: 'off', secFill: 'off', secColorMix: 'off', secRulers: 'off', secGeometry: 'off' } },
            { label: 'Pen + fill', values: { secMargin: 'on', secRegistration: 'off', secContinuity: 'off', secVernier: 'off', secPenWidth: 'on', secFill: 'on', secColorMix: 'off', secRulers: 'off', secGeometry: 'off' } },
            { label: 'Scale + geometry', values: { secMargin: 'on', secRegistration: 'off', secContinuity: 'off', secVernier: 'off', secPenWidth: 'off', secFill: 'off', secColorMix: 'off', secRulers: 'on', secGeometry: 'on' } }
        ],
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'palette', label: 'Pens (colors)', type: 'colorPalette', maxSelect: 6, group: 'color',
              tip: 'Each color = one pen/slot. Per-pen sections draw once per color. The darkest color is used for the frame, rulers, labels, and signature.',
              value: ['#000000', '#00ffff', '#ff00ff', '#ffff00'],
              options: [
                { value: '#000000', label: 'Black' },
                { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' },
                { value: '#ffff00', label: 'Yellow' },
                { value: '#ff3333', label: 'Red' },
                { value: '#33cc66', label: 'Green' },
                { value: '#3366ff', label: 'Blue' },
                { value: '#ff8800', label: 'Orange' },
                { value: 'custom', label: 'Custom' }
              ] },
            { id: 'secMargin', label: 'Margin frame', type: 'select', value: 'on', group: 'general',
              tip: 'Rectangle (in the signature color) marking the art safe-area, with corner ticks — the bounding margin your art should stay inside.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'secRegistration', label: 'Registration', type: 'select', value: 'on', group: 'general',
              tip: 'Concentric crosshair targets drawn once per pen at the same points. Aligned pens overlay as concentric rings; offsets are measurable. Tests pen-to-pen alignment.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'regScale', label: 'Registration size', type: 'range', min: 0.5, max: 2.5, step: 0.1, value: 1.0, group: 'general',
              tip: 'Scale of the registration crosshair targets — bigger is easier to read (capped so 3 still fit across).' },
            { id: 'secContinuity', label: 'Continuity lines', type: 'select', value: 'on', group: 'general',
              tip: 'Verticality/horizontality: one horizontal and one vertical line, each split into a segment per pen drawn end-to-end. Aligned pens = dead-straight; a pen offset shows as a step. Cleaner than the concentric targets.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'secVernier', label: 'Y-offset vernier', type: 'select', value: 'on', group: 'general',
              tip: 'Vernier gauge for measuring per-pen Y trim to 0.1mm. The FIRST palette color is the reference: ticks 1.0mm apart (left of spine); every other pen draws ticks 0.9mm apart (right). Find the tick pair that lines up: its number ÷ 10 IS the Y trim to enter for that pen type. A pen drawing high on the page aligns above center at a negative number (e.g. −5 → trim −0.5 moves it down). Needs 2+ pens.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'secPenWidth', label: 'Pen-width ladder', type: 'select', value: 'on', group: 'general',
              tip: 'Per pen: groups of 8 parallel lines at shrinking spacing (labeled mm). Find where lines merge into solid = the pen’s effective width.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'penMax', label: 'Ladder coarsest (mm)', type: 'range', min: 0.3, max: 3.0, step: 0.1, value: 1.0, group: 'general',
              tip: 'Pen-width ladder: widest line spacing (first group).' },
            { id: 'penMin', label: 'Ladder finest (mm)', type: 'range', min: 0.1, max: 1.5, step: 0.05, value: 0.2, group: 'general',
              tip: 'Pen-width ladder: tightest line spacing (last group).' },
            { id: 'secFill', label: 'Fill swatches', type: 'select', value: 'on', group: 'general',
              tip: 'Per pen: hatch-filled squares at increasing spacing (labeled mm). Find the spacing where coverage first goes solid.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'fillMin', label: 'Fill finest (mm)', type: 'range', min: 0.1, max: 1.5, step: 0.05, value: 0.2, group: 'general',
              tip: 'Fill swatches: tightest hatch spacing (first swatch).' },
            { id: 'fillMax', label: 'Fill coarsest (mm)', type: 'range', min: 0.3, max: 3.0, step: 0.1, value: 1.0, group: 'general',
              tip: 'Fill swatches: widest hatch spacing (last swatch).' },
            { id: 'secColorMix', label: 'Color-mix grid', type: 'select', value: 'off', group: 'general',
              tip: 'Every pen overlaid with every other (45° / −45° hatch) to preview overprints / color mixing.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'mixSpacing', label: 'Mix hatch (mm)', type: 'range', min: 0.2, max: 2.0, step: 0.1, value: 0.5, group: 'general',
              tip: 'Color-mix grid: hatch spacing used for each overlay.' },
            { id: 'secRulers', label: 'Scale rulers', type: 'select', value: 'on', group: 'general',
              tip: 'Horizontal + vertical rulers with true-mm ticks (numbered every cm). Verify dimensional accuracy and catch axis distortion.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'secGeometry', label: 'Geometry test', type: 'select', value: 'off', group: 'general',
              tip: 'Square + diagonals + inscribed circle: check squareness, backlash, and circle roundness.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
            { id: 'penWidth', label: 'Pen width (mm)', type: 'range', min: 0.1, max: 2.0, step: 0.05, value: 0.4, group: 'advanced',
              tip: 'Rendered stroke width (mm) for the preview and SVG export. Does not change the tested spacings.' }
        ]),
        regenerate: function () { resizeIfNeeded(); p.redraw(); },
        redraw: function () { try { p.redraw(); } catch (e) {} },
        randomize: function () { p.redraw(); },
        reseed: function () { p.redraw(); },
        getSignatureSeed: function () { return 424242; },
        saveSVG: function () {
            var built = buildOps();
            var dims = built.dims;
            var strokeW = Math.max(0.5, paper.mmToPixels(PARAMS.penWidth));
            var _slug = (window.makeSketchApp && window.makeSketchApp.getSeedSlug) ? window.makeSketchApp.getSeedSlug() : '';
            var ts = _slug || 'calibration';
            var filename = '90percentart-calibration-' + ts + '.svg';
            var parts = [];
            parts.push('<?xml version="1.0" encoding="UTF-8"?>');
            parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + dims.width + '" height="' + dims.height + '" viewBox="0 0 ' + dims.width + ' ' + dims.height + '">');
            parts.push('<rect x="0" y="0" width="' + dims.width + '" height="' + dims.height + '" fill="#ffffff"/>');
            parts.push('<rect x="1" y="1" width="' + (dims.width - 2) + '" height="' + (dims.height - 2) + '" fill="none" stroke="#b4b4b4" stroke-width="2"/>');
            parts.push('<g style="mix-blend-mode:multiply">');
            for (var i = 0; i < built.ops.length; i++) {
                var o = built.ops[i];
                parts.push('<line x1="' + o.x1.toFixed(2) + '" y1="' + o.y1.toFixed(2) + '" x2="' + o.x2.toFixed(2) + '" y2="' + o.y2.toFixed(2) +
                           '" stroke="' + o.color + '" stroke-width="' + strokeW.toFixed(2) + '" stroke-linecap="round"/>');
            }
            parts.push('</g>');
            if (window._signatureConfig && window._signatureConfig.enabled &&
                !window._signatureConfig.suppressExport &&
                window.Signature && typeof window.Signature.buildSignatureSVG === 'function') {
                var mgnPx = paper.getMarginPixels(PARAMS.margin);
                var pal = (PARAMS.palette && PARAMS.palette.length) ? PARAMS.palette : ['#000000'];
                var sigCol = window.Signature.pickSignatureColor ? window.Signature.pickSignatureColor(pal) : '#000000';
                var sigG = window.Signature.buildSignatureSVG(window._signatureConfig, dims.width, dims.height, mgnPx,
                    function (mm) { return paper.mmToPixels(mm); }, 'Calibration', 424242, sigCol);
                if (sigG) parts.push(sigG);
            }
            parts.push('</svg>');
            downloadSvgString(parts.join('\n'), filename);
        },
        setParam: function (name, val) {
            var pdef = api.params.find(function (x) { return x.id === name; });
            if (pdef) pdef.value = val;
            if (name === 'paperSize') { PARAMS.paperSize = val; resizeIfNeeded(); }
            else if (name === 'margin') PARAMS.margin = Number(val);
            else if (name === 'palette') PARAMS.palette = Array.isArray(val) && val.length ? val : PARAMS.palette;
            else if (name === 'penWidth' || name === 'penMax' || name === 'penMin' ||
                     name === 'fillMax' || name === 'fillMin' || name === 'mixSpacing' || name === 'regScale') PARAMS[name] = Number(val);
            else if (PARAMS.hasOwnProperty(name)) PARAMS[name] = val;
        }
    };

    function resizeIfNeeded() { paper.resizeCanvasToPaper(p, PARAMS.paperSize); }

    p.registerSketchAPI = function (register) { if (typeof register === 'function') register(api); };

    p.setup = function () {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;margin:0 auto 8px;color:#667085;font-size:13px;line-height:1.35;text-align:center;';
            helpEl.textContent = 'Calibration card — hover a control for what it does. Auto-fits any paper; measured spacings (pen-width, fill, rulers) stay at true mm.';
            container.appendChild(helpEl);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        if (helpEl) helpEl.style.width = p.width + 'px';
        p.pixelDensity(1);
        p.noLoop();
    };

    p.draw = function () {
        p.background(255);
        paper.drawPaperBorder(p);
        var built = buildOps();
        var sw = Math.max(0.75, paper.mmToPixels(PARAMS.penWidth));
        p.strokeCap(p.ROUND);
        for (var i = 0; i < built.ops.length; i++) {
            var o = built.ops[i];
            p.stroke(o.color);
            p.strokeWeight(sw);
            p.line(o.x1, o.y1, o.x2, o.y2);
        }
        // Redraw on top: 0" margin or full-bleed content can paint
        // edge-to-edge and cover the border drawn at the top of this
        // function -- keep it visible as the top layer.
        paper.drawPaperBorder(p);
    };

    function downloadSvgString(str, filename) {
        try {
            var blob = new Blob([str], { type: 'image/svg+xml' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) { console.error('SVG download failed', e); }
    }
};
