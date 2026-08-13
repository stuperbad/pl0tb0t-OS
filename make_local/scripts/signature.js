/* signature.js — pl0tb0t-OS signature band system
 * Renders a one-line attribution strip in the bottom margin of every SVG export.
 *
 * Left:  SketchName | seed-name | 1 of 1?   [optional custom message]
 * Right: 90percent art logo (outline + inward-offset fill passes)
 *
 * Config object (window._signatureConfig):
 *   enabled        : bool
 *   showPreview    : bool   – draw band on canvas in Make tab
 *   showLogo       : bool
 *   font           : 'ef' | 'hershey'
 *   customMsg      : string
 *   heightMm       : number  (text height in mm, default 2.0)
 *
 * Public API (window.Signature):
 *   buildSignatureSVG(cfg, paperW, paperH, marginPx, mmToPixels) → SVG <g> string
 *   drawSignaturePreview(ctx, cfg, paperW, paperH, marginPx, mmToPixels)
 */
(function() {
    'use strict';

    // ── seed-name word lists ──────────────────────────────────────────────────
    var ADJ = ['amber','azure','bold','brass','bright','calm','cobalt','cool',
               'coral','crisp','deep','deft','dense','dusky','early','elder',
               'faint','fast','fluid','gold','grand','jade','keen','late','lean',
               'light','mute','noble','odd','pale','prime','quick','raw','rich',
               'ruby','sage','sharp','silent','slate','slow','solar','spare',
               'stark','still','storm','swift','teal','thin','vast','warm'];
    var NOUN = ['arc','bay','bloom','bolt','brook','chord','cloud','coil','crest',
                'curve','dash','delta','drift','dune','edge','field','flame',
                'flash','fold','form','gate','grain','grove','haze','hill','ink',
                'isle','knot','lake','lane','leaf','line','loop','mesh','mist',
                'moon','moss','node','oak','peak','pine','pool','pulse','ridge',
                'ring','rock','rune','sand','shore','slab','slope','smoke','snow',
                'span','star','stem','stone','surf','tide','trace','trail','vale',
                'veil','vein','wave','wind','wood','yard'];

    function seedToName(seed) {
        seed = Math.abs(seed >>> 0);
        return ADJ[seed % ADJ.length] + ' ' + NOUN[Math.floor(seed / ADJ.length) % NOUN.length];
    }

    // ── logo paths (300×300 viewBox → normalised 0-1) ────────────────────────
    // Three subpaths: two rings (the 9 and 0 of 90%) + one diagonal slash.
    // Each stored as a closed polygon (sampled from the Bézier) for fill-offset.
    var LOGO_D = [
        // Path 1 – smaller ring (the "9")
        'M0.6041,0.5151C0.6107,0.5033,0.619,0.4947,0.6293,0.4887C0.6529,0.4762,0.6787,0.4739,0.7048,0.4874C0.7241,0.4965,0.7374,0.511,0.7444,0.5297C0.7516,0.5483,0.7495,0.5662,0.7393,0.5843C0.7296,0.6021,0.7145,0.6135,0.6941,0.6179C0.6724,0.6236,0.6512,0.6212,0.6307,0.6095C0.6099,0.5977,0.5976,0.5806,0.5918,0.5589C0.5929,0.5552,0.5935,0.5514,0.5935,0.5477Z',
        // Path 1 outer ring contour
        'M0.601,0.6181C0.6233,0.6306,0.6455,0.6336,0.6698,0.6269C0.6984,0.619,0.7193,0.5988,0.7315,0.5657C0.7447,0.5323,0.7431,0.5006,0.7268,0.4721C0.7104,0.4442,0.7027,0.4171,0.7097,0.3909C0.7097,0.3891,0.7109,0.3873,0.7083,0.3857C0.6935,0.3771,0.6841,0.3776,0.6841,0.3781L0.6508,0.4584C0.6365,0.4584,0.6241,0.4566,0.6124,0.4579C0.5929,0.4476,0.5804,0.4396,0.5729,0.4319C0.5635,0.4225,0.5583,0.4097,0.5626,0.3968C0.5769,0.4001,0.5875,0.4013,0.5957,0.4003C0.6039,0.4001,0.6088,0.3977,0.6094,0.3918L0.5646,0.3776C0.5507,0.3778,0.5447,0.3767,0.5447,0.3756L0.548,0.4226C0.548,0.4247,0.5494,0.4265,0.5516,0.4268C0.5534,0.4245,0.5553,0.4243,0.5566,0.426C0.5614,0.4326,0.5677,0.4416,0.5748,0.4513C0.5538,0.4563,0.5345,0.4638,0.5196,0.4754C0.4892,0.4995,0.4762,0.5368,0.4884,0.5766C0.5003,0.616,0.5556,0.5935,0.601,0.6181Z',
        // Path 2 – larger ring (the "0")
        'M0.6041,0.515C0.6107,0.5034,0.619,0.4948,0.6293,0.4888Z',
        // Path 2 outer
        'M0.6001,0.6181C0.6668,0.6549,0.7366,0.6633,0.8031,0.645C0.8781,0.6237,0.9362,0.578,0.9695,0.5007C1.0039,0.4221,0.9912,0.3504,0.9485,0.3054C0.9044,0.2595,0.8437,0.2488,0.7705,0.2822C0.7705,0.2822,0.6985,0.3127,0.6985,0.3127C0.7077,0.2822,0.7118,0.2586,0.7095,0.2447C0.6968,0.1979,0.6579,0.1696,0.6079,0.1791C0.5892,0.1896,0.5783,0.2027,0.5783,0.2171L0.6001,0.6181Z',
        // Path 3 – diagonal slash
        'M0.4651,0.7013L0.2619,0.066C0.2508,0.0317,0.2774,0.0,0.3143,0.0L0.3404,0.0C0.3773,0.0,0.4112,0.0317,0.4223,0.0660L0.6256,0.7013C0.6367,0.7357,0.6101,0.7013,0.5732,0.7013L0.5471,0.7013C0.5102,0.7013,0.4762,0.7357,0.4651,0.7013Z'
    ];

    // Simplified logo for preview (just the raw paths from logo.svg, normalised to 300x300)
    var LOGO_PATHS_NORM = [
        // Path 1 (ring 1) — from logo.svg, viewBox 0 0 300 300, normalised /300
        'M0.6041,0.5150C0.6016,0.5497,0.6129,0.5720,0.6112,0.5390C0.6138,0.4882,0.6339,0.4536,0.6626,0.4356C0.6927,0.4170,0.7239,0.4125,0.7532,0.4284C0.7852,0.4468,0.8029,0.4882,0.8034,0.5288C0.8041,0.5628,0.6934,0.6119,0.6416,0.6166C0.5954,0.6059,0.5845,0.5714,0.6041,0.5150Z',
        // Path 2 (ring 2)
        'M0.6013,0.6181C0.6229,0.6347,0.6485,0.6497,0.6993,0.6481C0.7662,0.6441,0.8028,0.6155,0.8618,0.5674C0.9208,0.5196,0.9302,0.4496,0.9090,0.4050C0.8765,0.3333,0.7709,0.3044,0.7093,0.3430C0.6769,0.3600,0.6685,0.3863,0.6685,0.4073L0.5648,0.3776C0.5648,0.3776,0.5447,0.3756,0.5516,0.4268C0.5749,0.4513,0.5748,0.4513,0.5748,0.4513C0.5538,0.4563,0.5196,0.4754,0.5196,0.4754C0.4892,0.4995,0.4762,0.5368,0.4884,0.5766C0.5003,0.6160,0.5556,0.5935,0.6013,0.6181Z',
        // Path 3 (slash)
        'M0.4651,0.7013L0.2619,0.0660C0.2508,0.0317,0.2774,0.0,0.3143,0.0L0.3404,0.0C0.3773,0.0,0.4112,0.0317,0.4223,0.0660L0.6256,0.7013C0.6367,0.7357,0.6101,0.7013,0.5732,0.7013L0.5471,0.7013C0.5102,0.7013,0.4762,0.7357,0.4651,0.7013Z'
    ];

    // Actual logo paths from Google Drive logo.svg (300×300 viewBox), normalised to 0–1
    var LOGO_SVG_PATHS = [
        'M0.6041,0.5150C0.6016,0.5497,0.6129,0.5720,0.6307,0.5693C0.6527,0.5658,0.6729,0.5560,0.6879,0.5407C0.7025,0.5257,0.7082,0.5075,0.7028,0.4898C0.6976,0.4724,0.6847,0.4571,0.6671,0.4468C0.6497,0.4367,0.6296,0.4321,0.6094,0.4344C0.5895,0.4367,0.5775,0.4466,0.5761,0.4597C0.5747,0.4729,0.5796,0.4856,0.5910,0.4960C0.6024,0.5065,0.6041,0.5150,0.6041,0.5150Z M0.6012,0.6181C0.6229,0.6347,0.6485,0.6497,0.6993,0.6481C0.7274,0.6470,0.7586,0.6369,0.7836,0.6211C0.8087,0.6053,0.8275,0.5844,0.8371,0.5601C0.8471,0.5349,0.8462,0.5086,0.8345,0.4838C0.8229,0.4590,0.8022,0.4378,0.7756,0.4224C0.7489,0.4070,0.7181,0.3979,0.7028,0.3977C0.6749,0.4077,0.6510,0.4199,0.6330,0.4344C0.5748,0.4513,0.5748,0.4513,0.5748,0.4513C0.5538,0.4563,0.5196,0.4754,0.5196,0.4754C0.4892,0.4995,0.4762,0.5368,0.4884,0.5766C0.5003,0.6160,0.5556,0.5935,0.6012,0.6181Z',
        'M0.4651,0.7013L0.2619,0.0660C0.2508,0.0317,0.2774,0.0,0.3143,0.0L0.3404,0.0C0.3773,0.0,0.4112,0.0317,0.4223,0.0660L0.6256,0.7013C0.6367,0.7357,0.6101,0.7013,0.5732,0.7013L0.5471,0.7013C0.5102,0.7013,0.4762,0.7357,0.4651,0.7013Z'
    ];

    // Real paths from logo.svg, scaled to 0-1 from the 300x300 viewBox
    var REAL_LOGO = [
        // path 1 — outer ring of small circle
        'M0.6041,0.5150C0.6016,0.6195,0.6060,0.5733,0.6045,0.5130C0.6025,0.5108,0.607,0.515,0.6041,0.5150Z',
        // path 2 — larger ring
        'M0.6011,0.6181C0.6686,0.6549,0.7366,0.6633,0.8031,0.645C0.8781,0.6237,0.9362,0.578,0.9695,0.5007C1.0039,0.4221,0.9912,0.3504,0.9485,0.3054C0.9044,0.2595,0.8437,0.2488,0.7705,0.2822L0.7093,0.3430C0.7093,0.3430,0.6530,0.3776,0.6094,0.3776C0.5538,0.4563,0.5196,0.4754,0.4884,0.5766C0.5003,0.616,0.5556,0.5935,0.6011,0.6181Z',
        // path 3 — slash bar
        'M0.4650,0.7013L0.2620,0.0660C0.2508,0.0318,0.2775,0.0,0.3143,0.0L0.3404,0.0C0.3773,0.0,0.4112,0.0317,0.4224,0.066L0.6256,0.7013C0.6367,0.7357,0.6101,0.7013,0.5732,0.7013L0.5471,0.7013C0.5102,0.7013,0.4762,0.7357,0.4650,0.7013Z'
    ];

    // Verbatim paths from logo.svg, normalised: divide coords by 300
    function _rawLogoPath(d) {
        return d.replace(/-?[\d]+(?:\.\d+)?/g, function(n) {
            return (parseFloat(n) / 300).toFixed(4);
        });
    }
    var _logoRaw = [
        'M181.2381,154.5124c1.9847,-3.5642,4.9162,-5.8998,8.7912,-7.0028c3.9718,-1.1305,7.7167,-0.6952,11.234,1.3028c3.5654,1.9854,5.9069,4.9411,7.0235,8.864c1.1169,3.9239,0.6829,7.6696,-1.3028,11.234c-1.9376,3.5518,-4.8683,5.8862,-8.7922,7.0031c-3.9718,1.1305,-7.7404,0.703,-11.3048,-1.2827c-3.5173,-1.9981,-5.8484,-5.0084,-6.9926,-9.028C178.8048,161.7746,179.2527,158.0778,181.2381,154.5124z M180.336,185.4188c6.686,3.6837,13.6662,4.4902,20.9398,2.4199c7.465,-2.1248,13.0835,-6.4657,16.8557,-13.0228c3.8681,-6.5833,4.7734,-13.4892,2.7167,-20.715c-2.0295,-7.13,-6.4045,-12.505,-13.126,-16.1279c-6.7348,-3.6698,-13.7629,-4.4627,-21.0843,-2.3787c-7.0812,2.0156,-12.5972,6.3532,-16.5471,13.0125c-3.8539,6.6331,-4.8006,13.3935,-2.8392,20.2843C169.3354,176.2126,173.6969,181.7218,180.336,185.4188z',
        'M131.8403,113.5078c-3.9981,-6.5461,-9.6627,-10.741,-16.9969,-12.5853c-7.1411,-1.7958,-14.087,-0.7979,-20.8377,2.9938c-6.6545,3.817,-10.8613,9.2231,-12.6204,16.2185c-1.8322,7.2859,-0.8043,14.2147,3.0844,20.7836c3.9357,6.5817,9.5712,10.7948,16.9063,12.6395c4.9531,1.2456,9.7132,1.2328,14.2832,-0.0268c0.5719,-0.1576,1.0966,0.3757,0.952,0.951l-4.5482,18.0861c-0.4568,1.8164,0.6454,3.6592,2.4619,4.116l6.0156,1.5128c1.8164,0.4568,3.6592,-0.6454,4.116,-2.4619l9.9405,-39.5285c0.0333,-0.1326,0.0556,-0.2654,0.0677,-0.3974c0.008,-0.0871,0.0219,-0.1723,0.0479,-0.2558c0.1544,-0.4971,0.3002,-1.0003,0.4297,-1.5152C136.9503,126.8489,135.8494,120.0064,131.8403,113.5078z M104.6869,141.6162c-4.0058,-1.0074,-7.0556,-3.2621,-9.1494,-6.7641c-2.095,-3.5013,-2.6326,-7.28,-1.6133,-11.3331c0.9572,-3.8063,3.1838,-6.7581,6.6789,-8.8524c3.303,-1.9792,7.3011,-2.6002,11.044,-1.6958c4.0325,0.9744,7.1112,3.2372,9.2338,6.7846c2.2936,3.8363,2.7431,7.9167,1.3445,12.2403c-0.9804,3.0309,-2.9835,5.6752,-5.6291,7.4495C112.8615,141.9499,108.8917,142.6736,104.6869,141.6162z',
        'M139.5409,210.3898l-7.8587,-1.9763c-1.3075,-0.3288,-2.1009,-1.6553,-1.772,-2.9627l31.0328,-123.4022c0.3288,-1.3075,1.6553,-2.1009,2.9628,-1.7721l7.8587,1.9763c1.3075,0.3288,2.1009,1.6553,1.772,2.9628l-31.0328,123.4022C142.1748,209.9252,140.8484,210.7186,139.5409,210.3898z'
    ];

    // ── polygon offset (inward) for logo fill ─────────────────────────────────
    function _polyArea(pts) {
        var a = 0, n = pts.length;
        for (var i = 0, j = n-1; i < n; j = i++) a += pts[j][0]*pts[i][1] - pts[i][0]*pts[j][1];
        return a / 2;
    }

    function _polyOffset(pts, d) {
        var n = pts.length;
        if (n < 3) return [];
        // ensure consistent winding (CCW positive)
        if (_polyArea(pts) < 0) pts = pts.slice().reverse();
        var out = [];
        // Miter limit: at a sharp/near-antiparallel corner the averaged-normal
        // miter join distance explodes (dividing by a near-zero ml2), spiking that
        // vertex far outside the intended offset -- a classic offset-polygon
        // failure mode, especially likely here since the logo is tiny (a few mm)
        // so a pen-width-sized offset step is a LARGE fraction of its own radius.
        // Cap the displacement to a small multiple of |d| (falls back to a plain
        // perpendicular offset for that vertex instead of a wild miter spike).
        var maxDisp = Math.abs(d) * 3;
        for (var i = 0; i < n; i++) {
            var p = pts[(i+n-1)%n], c = pts[i], q = pts[(i+1)%n];
            var dx1=c[0]-p[0], dy1=c[1]-p[1], l1=Math.hypot(dx1,dy1)||1e-9;
            var dx2=q[0]-c[0], dy2=q[1]-c[1], l2=Math.hypot(dx2,dy2)||1e-9;
            var nx1=-dy1/l1, ny1=dx1/l1, nx2=-dy2/l2, ny2=dx2/l2;
            var mx=nx1+nx2, my=ny1+ny2, ml2=mx*mx+my*my;
            var sc = ml2>0.001 ? d*2/ml2 : d;
            var vx = mx*sc, vy = my*sc, vlen = Math.hypot(vx, vy);
            if (vlen > maxDisp) { var k = maxDisp / vlen; vx *= k; vy *= k; }
            out.push([c[0]+vx, c[1]+vy]);
        }
        return out;
    }

    // Offset by the full requested distance, but internally via several small
    // sub-steps rather than one big jump. The miter clamp alone isn't enough
    // when the requested step is a large fraction of the shape's own size (true
    // here: the logo is only a few mm, so an ~80%-pen-width step can be most of
    // its radius in one go) -- a single big _polyOffset call still degrades the
    // polygon (self-crossing loops) even with clamped displacement, because
    // EVERY vertex moves a large distance at once. Sub-stepping keeps each
    // individual move small relative to the CURRENT shape size, which is what
    // actually keeps the miter-join math well-behaved.
    function _polyOffsetSafe(pts, totalD) {
        if (!_isValidPoly(pts)) return pts;
        var b = _bbox(pts), minDim = Math.min(b[2]-b[0], b[3]-b[1]);
        var maxSub = Math.max(0.05, minDim * 0.12);
        var remaining = totalD, sign = totalD < 0 ? -1 : 1, guard = 0;
        while (Math.abs(remaining) > 1e-6 && guard < 30) {
            var step = Math.abs(remaining) > maxSub ? sign * maxSub : remaining;
            var next = _polyOffset(pts, step);
            if (!_isValidPoly(next) || _offsetPassBlewUp(pts, next, step)) break;
            pts = next;
            remaining -= step;
            guard++;
        }
        return pts;
    }

    function _isValidPoly(pts, minArea) {
        return pts.length >= 3 && Math.abs(_polyArea(pts)) > (minArea || 0.5);
    }

    function _bbox(pts) {
        var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
        for (var i=0;i<pts.length;i++) { var p=pts[i]; if(p[0]<x0)x0=p[0]; if(p[0]>x1)x1=p[0]; if(p[1]<y0)y0=p[1]; if(p[1]>y1)y1=p[1]; }
        return [x0,y0,x1,y1];
    }
    // Each offset pass should move the boundary by roughly |stepPx| per side
    // (bbox width/height changes by ~2*stepPx, shrinking for an inward offset,
    // growing for the hole's outward one). If a pass moves it far more than
    // that -- even with the miter clamp -- a join still spiked; treat that pass
    // as a failure and stop rather than draw the resulting mess.
    function _offsetPassBlewUp(before, after, stepPx) {
        var b0 = _bbox(before), b1 = _bbox(after);
        var dw = (b1[2]-b1[0]) - (b0[2]-b0[0]), dh = (b1[3]-b1[1]) - (b0[3]-b0[1]);
        var expected = Math.abs(stepPx) * 2, limit = Math.max(expected * 4, 2);
        if (Math.abs(dw) > limit || Math.abs(dh) > limit) return true;
        // A thin, elongated solid shape (the signature's diagonal slash, at
        // typical logo-size/pen-width ratios where the pen-width-derived step
        // is several times the shape's own cross-width) can self-intersect
        // into a LARGER polygon that still passes the magnitude-only check
        // above -- verified live: bbox grew past its own original size and
        // area went briefly negative (flipped winding), yet kept getting
        // accepted for the full 60-pass budget, drawing wildly oscillating
        // ink instead of cleanly stopping. An inward offset (stepPx > 0)
        // must never GROW the bbox; an outward one (stepPx < 0, a ring's
        // hole growing) must never SHRINK it -- either direction is a sign
        // this pass degenerated, not a valid offset.
        if (stepPx > 0 && (dw > 0.5 || dh > 0.5)) return true;
        if (stepPx < 0 && (dw < -0.5 || dh < -0.5)) return true;
        return false;
    }

    // Split a multi-subpath "d" string ("M...Z M...Z") into one d-string per
    // subpath. The logo's two rings are each a single compound path (outer
    // boundary + inner hole, Illustrator "compound shape" convention); the
    // slash is a single solid subpath. M only ever starts a new subpath, so
    // splitting on lookahead-M is safe for this data.
    function _splitSubpaths(d) {
        var parts = d.match(/M[^M]*/g) || [d];
        return parts.map(function(s) { return s.trim(); }).filter(Boolean);
    }

    // Sample a subpath "d" string into a closed point polygon using the
    // browser's own SVG path engine (handles cubic beziers, arcs, everything —
    // far more robust than a hand-rolled bezier flattener). Points are in the
    // path's native coordinate space (no transform applied).
    function _samplePathD(d, numPoints) {
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg  = document.createElementNS(svgNS, 'svg');
        var path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
        svg.style.cssText = 'position:absolute;left:-99999px;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(svg);
        var pts = [];
        try {
            var len = path.getTotalLength();
            if (len > 0) {
                for (var k = 0; k < numPoints; k++) {
                    var pt = path.getPointAtLength(len * k / numPoints);
                    pts.push([pt.x, pt.y]);
                }
            }
        } catch (e) { /* malformed d — return whatever we sampled */ }
        document.body.removeChild(svg);
        return pts;
    }

    // Offset-fill for one logo path (outline strokes at successively inset
    // passes, like Illustrator's "Offset Path" applied repeatedly). Handles
    // BOTH solid shapes (the slash — one subpath, offset inward until it
    // degenerates) AND compound shapes with a hole (each ring — outer
    // boundary offset INWARD while the inner hole boundary offsets OUTWARD,
    // in lockstep, so the interior of the hole is always left untouched/white;
    // stops once the annular gap between them closes).
    function _pathOffsetFillStrokes(d, stepPx, maxPasses) {
        maxPasses = maxPasses || 60;
        var subpaths = _splitSubpaths(d).map(function(sd) { return _samplePathD(sd, 72); })
            .filter(function(pts) { return pts.length >= 3; });
        var lines = [];
        if (subpaths.length === 1) {
            // solid shape
            var poly = subpaths[0], passes = 0;
            while (_isValidPoly(poly) && passes < maxPasses) {
                lines.push(poly.slice());
                var nextPoly = _polyOffsetSafe(poly, stepPx);
                if (nextPoly === poly) break;   // sub-stepper made no progress -- shape closed up
                poly = nextPoly;
                passes++;
            }
        } else if (subpaths.length >= 2) {
            // compound shape: larger-area subpath is the outer boundary,
            // the rest are holes (offset outward = negative step, since
            // _polyOffset always normalises winding before offsetting).
            subpaths.sort(function(a, b) { return Math.abs(_polyArea(b)) - Math.abs(_polyArea(a)); });
            var outer = subpaths[0], hole = subpaths[1];
            var p2 = 0;
            while (p2 < maxPasses) {
                var outerArea = Math.abs(_polyArea(outer));
                var holeArea  = Math.abs(_polyArea(hole));
                if (!_isValidPoly(outer) || !_isValidPoly(hole) || outerArea <= holeArea) break;
                lines.push(outer.slice());
                lines.push(hole.slice());
                var nextOuter = _polyOffsetSafe(outer, stepPx);
                var nextHole  = _polyOffsetSafe(hole, -stepPx);
                if (nextOuter === outer && nextHole === hole) break;   // no progress -- stop
                outer = nextOuter;
                hole  = nextHole;
                p2++;
            }
        }
        return lines;
    }

    // ── EF Script / Hershey text renderer ────────────────────────────────────
    function _renderTextSVG(text, font, x, y, height, color, penWidthPx, sepScale, sepPad) {
        // font: window._efScriptFont  OR  null (fall back to simple hershey-ish strokes)
        // x,y: top-left of text baseline area; height: cap height in px
        if (!text) return '';
        var parts = [];
        var cx = x;
        var sw = penWidthPx !== undefined ? Math.max(0.3, penWidthPx) : Math.max(0.5, height * 0.06);
        var stroke = color || '#000';

        if (font && font.chars) {
            var sepH   = height * (sepScale || 1.0);
            var centY  = y + height / 2;   // shared vertical centre for all chars
            parts.push('<g fill="none" stroke="' + stroke + '" stroke-width="' + sw.toFixed(2) +
                       '" stroke-linecap="round" stroke-linejoin="round">');
            for (var i = 0; i < text.length; i++) {
                var ch = text[i];
                var h  = (ch === '|') ? sepH : height;
                var glyph = font.chars[ch] || font.chars[' '];
                if (!glyph) { cx += h * 0.35; continue; }
                var pad = (ch === '|') ? (height * (sepPad || 0)) : 0;
                cx += pad;  // pre-pad
                if (glyph.d) {
                    var charY = centY - h / 2;
                    parts.push('<g transform="translate(' + cx.toFixed(2) + ',' + charY.toFixed(2) +
                               ') scale(' + h.toFixed(3) + ')" stroke-width="' + (h > 0 ? (sw / h) : sw).toFixed(5) + '">');
                    parts.push('<path d="' + glyph.d.replace(/Z/gi, "") + '"/>');
                    parts.push('</g>');
                }
                cx += (glyph.adv || 0.5) * h + pad;  // advance + post-pad
            }
            parts.push('</g>');
        } else {
            // Minimal Hershey simplex — just use a simple line box for now
            parts.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) +
                       '" width="' + (cx + height * text.length * 0.55 - x).toFixed(2) +
                       '" height="' + height.toFixed(2) +
                       '" fill="none" stroke="' + stroke + '" stroke-width="' + sw.toFixed(2) + '"/>');
        }
        return parts.join('');
    }

    // Measure text width in px using loaded font
    function _measureText(text, font, height) {
        if (!font || !font.chars) return text.length * height * 0.55;
        var w = 0;
        for (var i = 0; i < text.length; i++) {
            var g = font.chars[text[i]] || font.chars[' '];
            w += g ? (g.adv || 0.5) * height : 0.5 * height;
        }
        return w;
    }

    // ── handwritten signature (alternative right-side mark) ──────────────────
    // Extracted from Evan's traced signature (Google Drive "Signature.svg",
    // pl0tb0t/Settings Tools and Documentation) -- 7 disconnected stroke paths
    // (pen-lifts in the cursive trace), each with its own transform, stripped
    // of the ~960KB of embedded ICC color-profile + no-op clip-rect bloat the
    // original Inkscape export carried. See assets/signature_handwritten.svg
    // for a small, editable reference copy of just these paths.
    var SIG_PATHS = [
        { d: 'm 0,0 c -3.771,-1.334 -7.517,-2.744 -11.322,-3.97 -2.032,-0.655 -4.128,-1.257 -6.338,-0.872 -0.449,0.078 -0.852,0.114 -1.252,0.411 -0.834,0.619 -1.71,0.469 -2.615,0.031 -0.982,-0.476 -2.006,-0.871 -3.033,-1.245 -0.574,-0.209 -1.191,-0.261 -1.795,-0.011 -0.034,0.282 0.439,0.36 0.23,0.78 -0.366,0.375 -0.847,0.159 -1.328,0.05 -2.524,-0.575 -4.919,-1.531 -7.298,-2.516 -0.265,-0.109 -0.437,-0.244 -0.703,-0.108', transform: 'matrix(1.3333333,0,0,-1.3333333,228.55191,102.80278)' },
        { d: 'm 0,0 c -5.777,0.002 -5.203,-1.725 -6.729,-1.669 -0.772,0.118 -0.351,1.61 -1.215,1.656 -0.302,0.002 -2.288,-2.946 -2.489,-3.113 -1.283,-0.489 -0.955,1.217 -1.599,1.401 -0.926,0.265 -3.653,-2.376 -1.762,-2.41 0.347,-0.006 2.397,1.259 1.762,1.681 -0.295,0.195 -0.32,0.795 -1.826,0.392 -1.801,-0.48 -3.362,-3.252 -4.848,-3.123 -0.3,0.027 -0.718,0.171 -1.19,0.724', transform: 'matrix(1.3333333,0,0,-1.3333333,197.32337,100.69464)' },
        { d: 'm 0,0 c -4.1,-1.49 -7.896,-3.606 -11.728,-5.652 -2.195,-1.172 -3.085,-0.426 -5.292,-1.577', transform: 'matrix(1.3333333,0,0,-1.3333333,182.56751,107.03318)' },
        { d: 'M 0,0 C 0.726,0.787 1.74,1.116 2.621,1.655', transform: 'matrix(1.3333333,0,0,-1.3333333,176.68137,115.67904)' },
        { d: 'M 0,0 C 1.058,0.965 2.115,1.932 3.173,2.896 3.662,3.343 4.009,3.858 4.027,4.695 3.045,4.761 2.102,5.059 1.104,4.966', transform: 'matrix(1.3333333,0,0,-1.3333333,180.36044,113.28704)' },
        { d: 'M 0,0 C -1.629,-1.947 -4.759,-4.045 -6.578,-5.776', transform: 'matrix(1.3333333,0,0,-1.3333333,165.27777,111.81571)' },
        { d: 'm 0,0 c -4.422,0.045 -8.768,-0.637 -13.105,-1.382 -5.239,-0.9 -22.046,-5.024 -25.113,-5.911 -3.902,-1.129 -14.871,-4.063 -15.291,-4.206 -2.596,-0.881 -13.586,-3.802 -15.191,-4.231 -1.088,-0.291 -2.208,-0.364 -3.312,-0.547 -0.28,-0.046 -0.531,0.003 -0.738,0.384 2.345,1.713 8.025,4.215 8.025,4.215 0,0 -1.562,0.224 -3.362,-0.077 -0.628,-0.104 -3.373,-0.523 -3.373,-0.523 0,0 3.514,1.448 4.418,1.784 3.752,1.394 7.483,2.832 11.033,4.7', transform: 'matrix(1.3333333,0,0,-1.3333333,249.88911,92.134778)' }
    ];

    // Bounding box of the combined, transform-applied strokes -- computed once
    // via the browser's own SVG engine (same trick _samplePathD uses below)
    // rather than hand-measuring, so positioning stays correct if the paths
    // are ever retraced/edited without needing a magic-number update (unlike
    // the logo's hardcoded "213" right-edge below, inherited from its own
    // pre-existing convention).
    var _sigBBoxCache = null;
    function _sigBBox() {
        if (_sigBBoxCache) return _sigBBoxCache;
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(svgNS, 'svg');
        svg.style.cssText = 'position:absolute;left:-99999px;width:1px;height:1px;overflow:hidden;';
        var g = document.createElementNS(svgNS, 'g');
        SIG_PATHS.forEach(function(p) {
            var el = document.createElementNS(svgNS, 'path');
            el.setAttribute('d', p.d);
            el.setAttribute('transform', p.transform);
            g.appendChild(el);
        });
        svg.appendChild(g);
        document.body.appendChild(svg);
        var bb;
        try { bb = g.getBBox(); } catch (e) { bb = { x: 0, y: 0, width: 100, height: 30 }; }
        document.body.removeChild(svg);
        _sigBBoxCache = bb;
        return bb;
    }

    // x,y: top-left of the rendered mark; size: rendered height px (mirrors
    // _renderLogoSVG's (x,y,size) contract so buildSignatureSVG can treat
    // either mark type identically).
    function _renderHandwrittenSigSVG(x, y, size, penWidthPx, color) {
        var bb = _sigBBox();
        var sc = bb.height > 0 ? size / bb.height : 0;
        var col = color || '#000';
        var sw  = Math.max(0.5, penWidthPx || 1).toFixed(2);
        var tx  = x - bb.x * sc, ty = y - bb.y * sc;
        var parts = ['<g transform="translate(' + tx.toFixed(2) + ',' + ty.toFixed(2) +
                     ') scale(' + sc.toFixed(5) + ')" fill="none" stroke="' + col +
                     '" stroke-width="' + (sc > 0 ? (parseFloat(sw) / sc).toFixed(3) : sw) +
                     '" stroke-linecap="round" stroke-linejoin="round">'];
        SIG_PATHS.forEach(function(p) {
            parts.push('<path d="' + p.d + '" transform="' + p.transform + '"/>');
        });
        parts.push('</g>');
        return parts.join('');
    }

    // Canvas-preview equivalent of _renderHandwrittenSigSVG. SVG matrix(a,b,c,d,e,f)
    // and canvas ctx.transform(a,b,c,d,e,f) use the identical 6-value convention,
    // so each path's transform string can be applied directly.
    function _drawHandwrittenSigPreview(ctx, x, y, size, color) {
        var bb = _sigBBox();
        var sc = bb.height > 0 ? size / bb.height : 0;
        var tx = x - bb.x * sc, ty = y - bb.y * sc;
        ctx.save();
        ctx.strokeStyle = color || '#000';
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
        ctx.translate(tx, ty);
        ctx.scale(sc, sc);
        ctx.lineWidth = sc > 0 ? 1.4 / sc : 1.4;
        SIG_PATHS.forEach(function(p) {
            var m = p.transform.match(/matrix\(([^)]*)\)/);
            if (!m) return;
            var v = m[1].split(',').map(parseFloat);
            ctx.save();
            ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
            ctx.stroke(new Path2D(p.d));
            ctx.restore();
        });
        ctx.restore();
    }

    // ── logo SVG rendering ────────────────────────────────────────────────────
    function _renderLogoSVG(x, y, size, penWidthPx, color, offsetPct) {
        // x,y: top-left; size: logo height px (logo is square-ish)
        var sc = size / 300;
        var col = color || '#000';
        var sw  = Math.max(0.5, penWidthPx || 1).toFixed(2);
        var parts = ['<g transform="translate(' + x.toFixed(2) + ',' + y.toFixed(2) +
                     ') scale(' + sc.toFixed(5) + ')" fill="none" stroke="' + col +
                     '" stroke-width="' + (parseFloat(sw)/sc).toFixed(2) +
                     '" stroke-linecap="round" stroke-linejoin="round">'];

        // Outline strokes (3 paths from logo.svg, in 300×300 space)
        var outlinePaths = [
            'M181.2381,154.5124c1.9847,-3.5642,4.9162,-5.8998,8.7912,-7.0028c3.9718,-1.1305,7.7167,-0.6952,11.234,1.3028c3.5654,1.9854,5.9069,4.9411,7.0235,8.864c1.1169,3.9239,0.6829,7.6696,-1.3028,11.234c-1.9376,3.5518,-4.8683,5.8862,-8.7922,7.0031c-3.9718,1.1305,-7.7404,0.703,-11.3048,-1.2827c-3.5173,-1.9981,-5.8484,-5.0084,-6.9926,-9.028C178.8048,161.7746,179.2527,158.0778,181.2381,154.5124zM180.336,185.4188c6.686,3.6837,13.6662,4.4902,20.9398,2.4199c7.465,-2.1248,13.0835,-6.4657,16.8557,-13.0228c3.8681,-6.5833,4.7734,-13.4892,2.7167,-20.715c-2.0295,-7.13,-6.4045,-12.505,-13.126,-16.1279c-6.7348,-3.6698,-13.7629,-4.4627,-21.0843,-2.3787c-7.0812,2.0156,-12.5972,6.3532,-16.5471,13.0125c-3.8539,6.6331,-4.8006,13.3935,-2.8392,20.2843C169.3354,176.2126,173.6969,181.7218,180.336,185.4188z',
            'M131.8403,113.5078c-3.9981,-6.5461,-9.6627,-10.741,-16.9969,-12.5853c-7.1411,-1.7958,-14.087,-0.7979,-20.8377,2.9938c-6.6545,3.817,-10.8613,9.2231,-12.6204,16.2185c-1.8322,7.2859,-0.8043,14.2147,3.0844,20.7836c3.9357,6.5817,9.5712,10.7948,16.9063,12.6395c4.9531,1.2456,9.7132,1.2328,14.2832,-0.0268c0.5719,-0.1576,1.0966,0.3757,0.952,0.951l-4.5482,18.0861c-0.4568,1.8164,0.6454,3.6592,2.4619,4.116l6.0156,1.5128c1.8164,0.4568,3.6592,-0.6454,4.116,-2.4619l9.9405,-39.5285c0.0333,-0.1326,0.0556,-0.2654,0.0677,-0.3974c0.008,-0.0871,0.0219,-0.1723,0.0479,-0.2558c0.1544,-0.4971,0.3002,-1.0003,0.4297,-1.5152C136.9503,126.8489,135.8494,120.0064,131.8403,113.5078zM104.6869,141.6162c-4.0058,-1.0074,-7.0556,-3.2621,-9.1494,-6.7641c-2.095,-3.5013,-2.6326,-7.28,-1.6133,-11.3331c0.9572,-3.8063,3.1838,-6.7581,6.6789,-8.8524c3.303,-1.9792,7.3011,-2.6002,11.044,-1.6958c4.0325,0.9744,7.1112,3.2372,9.2338,6.7846c2.2936,3.8363,2.7431,7.9167,1.3445,12.2403c-0.9804,3.0309,-2.9835,5.6752,-5.6291,7.4495C112.8615,141.9499,108.8917,142.6736,104.6869,141.6162z',
            'M139.5409,210.3898l-7.8587,-1.9763c-1.3075,-0.3288,-2.1009,-1.6553,-1.772,-2.9627l31.0328,-123.4022c0.3288,-1.3075,1.6553,-2.1009,2.9628,-1.7721l7.8587,1.9763c1.3075,0.3288,2.1009,1.6553,1.772,2.9628l-31.0328,123.4022C142.1748,209.9252,140.8484,210.7186,139.5409,210.3898z'
        ];
        for (var i = 0; i < outlinePaths.length; i++) {
            parts.push('<path d="' + outlinePaths[i] + '"/>');
        }

        // Offset fill — Illustrator-style: each path (ring = compound outer+hole,
        // slash = solid) gets successive inset outline passes at offsetPct of the
        // pen width, like "Offset Path" applied repeatedly. Rings keep their hole
        // white: the outer boundary shrinks in while the inner hole boundary
        // grows out, in lockstep, until the annular gap between them closes.
        var swCoord = parseFloat(sw) / sc;
        var stepPx  = Math.max(0.15, swCoord * ((offsetPct != null ? offsetPct : 80) / 100));
        for (var oi = 0; oi < outlinePaths.length; oi++) {
            var fillLines = _pathOffsetFillStrokes(outlinePaths[oi], stepPx);
            for (var fi = 0; fi < fillLines.length; fi++) {
                var poly = fillLines[fi], pd = '';
                for (var vi = 0; vi < poly.length; vi++) {
                    pd += (vi === 0 ? 'M' : 'L') + poly[vi][0].toFixed(1) + ',' + poly[vi][1].toFixed(1) + ' ';
                }
                pd += 'Z';
                parts.push('<path d="' + pd + '"/>');
            }
        }

        parts.push('</g>');
        return parts.join('');
    }

    // ── main public API ───────────────────────────────────────────────────────
    function buildSignatureSVG(cfg, svgW, svgH, marginPx, mmToPixels, sketchName, seed, sigColor) {
        if (!cfg || !cfg.enabled) return '';
        var _sigCol = sigColor || '#000000';
        var font = (cfg.font !== 'hershey' && window._efScriptFont) ? window._efScriptFont : null;
        var heightPx = mmToPixels((cfg.heightMm || 2.0) * (cfg.scale || 1.0));
        var padH     = heightPx * 0.25;   // vertical padding above/below text in band

        // Position: centred vertically in bottom margin, with optional offsets
        var hPad       = mmToPixels(cfg.hPadMm || 0);
        var fmm        = mmToPixels(cfg.fromMarginMm !== undefined ? cfg.fromMarginMm : 2.0);
        fmm = Math.max(0, fmm);
        var bandY      = svgH - marginPx + fmm;
        var textY  = bandY;
        var textX  = marginPx + hPad;

        // Build left text string
        var name     = seedToName(seed || 0);
        var _ed = (cfg && cfg._editionOverride != null) ? cfg._editionOverride : null;
        var _edText = _ed ? (_ed + ' of ' + _ed) : '1 of 1?';
        var _leftParts = [sketchName || 'pl0tb0t'];
        if (cfg.showSeedName !== false) _leftParts.push(name);
        _leftParts.push(_edText);
        var leftText = _leftParts.join('|');
        if (cfg.customMsg) leftText += '|' + cfg.customMsg;

        // Right-side mark (logo or handwritten signature)
        var markType = cfg.markType || 'logo';
        var logoH    = heightPx * 1.1 * (cfg.logoScale || 1.0);
        var logoX;
        if (markType === 'handwritten') {
            // _renderHandwrittenSigSVG treats its x-arg as the LEFT edge of the
            // bbox (it internally re-anchors via `x - bb.x*sc`, unlike the logo's
            // raw origin-translate below), so justifying the right edge only
            // needs the content WIDTH, not bb.x -- don't add bb.x here.
            var _bb = _sigBBox();
            var _sc = _bb.height > 0 ? logoH / _bb.height : 0;
            logoX = svgW - marginPx - hPad - _bb.width * _sc;
        } else {
            // 213 = rightmost x of logo content in 300-unit space (ring 1 right edge)
            logoX = svgW - marginPx - hPad - 213 * (logoH / 300);
        }
        var logoY    = bandY + (heightPx - logoH) / 2;
        var penPx    = mmToPixels ? mmToPixels(cfg.penWidthMm || 0.4) : 1.5;

        var parts = ['<g id="signature">'];

        // Left text
        parts.push(_renderTextSVG(leftText, font, textX, textY, heightPx, _sigCol, penPx, cfg.sepScale || 1.0, cfg.sepPad !== undefined ? cfg.sepPad : 1.3));

        // Right mark
        if (cfg.showLogo !== false) {
            if (markType === 'handwritten') {
                parts.push(_renderHandwrittenSigSVG(logoX, logoY, logoH, penPx, _sigCol));
            } else {
                parts.push(_renderLogoSVG(logoX, logoY, logoH, penPx, _sigCol, cfg.logoOffsetPct));
            }
        }

        parts.push('</g>');
        return parts.join('\n');
    }

    function drawSignaturePreview(ctx, cfg, svgW, svgH, marginPx, mmToPixels, sketchName, seed, sigColor) {
        if (!cfg || !cfg.enabled || !cfg.showPreview) return;
        var _col = sigColor || '#000000';
        var heightPx = mmToPixels((cfg.heightMm || 2.0) * (cfg.scale || 1.0));
        var hPad       = mmToPixels(cfg.hPadMm || 0);
        var fmm        = mmToPixels(cfg.fromMarginMm !== undefined ? cfg.fromMarginMm : 2.0);
        fmm = Math.max(0, fmm);
        var bandY      = svgH - marginPx + fmm;
        var font     = (cfg.font !== 'hershey' && window._efScriptFont) ? window._efScriptFont : null;

        var name     = seedToName(seed || 0);
        var _ed = (cfg && cfg._editionOverride != null) ? cfg._editionOverride : null;
        var _edText = _ed ? (_ed + ' of ' + _ed) : '1 of 1?';
        var _leftParts = [sketchName || 'pl0tb0t'];
        if (cfg.showSeedName !== false) _leftParts.push(name);
        _leftParts.push(_edText);
        var leftText = _leftParts.join('|');
        if (cfg.customMsg) leftText += '|' + cfg.customMsg;

        var swPx = mmToPixels ? mmToPixels(cfg.penWidthMm || 0.4) : 1.0;

        ctx.save();
        ctx.fillStyle   = _col;
        ctx.strokeStyle = _col;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';

        if (font && font.chars) {
            // Draw EF Script paths via canvas
            var cx    = marginPx + hPad;
            var sepH  = heightPx * (cfg.sepScale || 1.0);
            var centY = bandY + heightPx / 2;   // shared centre line
            for (var i = 0; i < leftText.length; i++) {
                var ch    = leftText[i];
                var h     = (ch === '|') ? sepH : heightPx;
                var glyph = font.chars[ch] || font.chars[' '];
                if (!glyph) { cx += h * 0.35; continue; }
                var pad = (ch === '|') ? heightPx * (cfg.sepPad !== undefined ? cfg.sepPad : 1.3) : 0;
                cx += pad;  // pre-pad: gap between previous text and |
                if (glyph.d) {
                    ctx.save();
                    ctx.translate(cx, centY - h / 2);
                    ctx.scale(h, h);
                    ctx.lineWidth = swPx / h;  // set AFTER scale — canvas units
                    var p2d = new Path2D(glyph.d.replace(/Z/gi, ""));
                    ctx.stroke(p2d);
                    ctx.restore();
                }
                cx += (glyph.adv || 0.5) * h + pad;  // advance + post-pad
            }
        } else {
            // Fallback: thin text
            ctx.font      = 'italic ' + (heightPx * 0.85).toFixed(0) + 'px monospace';
            ctx.fillText(leftText, marginPx, bandY + heightPx * 0.85);
        }

        // Right mark preview
        if (cfg.showLogo !== false && (cfg.markType || 'logo') === 'handwritten') {
            var _hH = heightPx * 1.1 * (cfg.logoScale || 1.0);
            var _hbb = _sigBBox();
            var _hsc = _hbb.height > 0 ? _hH / _hbb.height : 0;
            var _hX  = svgW - marginPx - hPad - _hbb.width * _hsc;
            _drawHandwrittenSigPreview(ctx, _hX, bandY + (heightPx - _hH) / 2, _hH, _col);
        } else if (cfg.showLogo !== false) {
            var logoH = heightPx * 1.1 * (cfg.logoScale || 1.0);
            var logoX = svgW - marginPx - hPad - 213 * (logoH / 300);
            var sc    = logoH / 300;
            ctx.save();
            ctx.strokeStyle = _col;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.translate(logoX, bandY + (heightPx - logoH) / 2);
            ctx.scale(sc, sc);
            // lineWidth must be set AFTER scale — canvas units * sc = screen pixels
            ctx.lineWidth = 1.5 / sc;
            var outlines = [
                'M181.2,154.5c2,-3.6,4.9,-6,8.8,-7c4,-1.1,7.7,-0.7,11.2,1.3c3.6,2,5.9,4.9,7,8.9c1.1,3.9,0.7,7.7,-1.3,11.2c-1.9,3.6,-4.9,5.9,-8.8,7c-4,1.1,-7.7,0.7,-11.3,-1.3c-3.5,-2,-5.8,-5,-7,-9C178.8,161.8,179.3,158.1,181.2,154.5zM180.3,185.4c6.7,3.7,13.7,4.5,20.9,2.4c7.5,-2.1,13.1,-6.5,16.9,-13c3.9,-6.6,4.8,-13.5,2.7,-20.7c-2,-7.1,-6.4,-12.5,-13.1,-16.1c-6.7,-3.7,-13.8,-4.5,-21.1,-2.4c-7.1,2,-12.6,6.4,-16.5,13c-3.9,6.6,-4.8,13.4,-2.8,20.3C169.3,176.2,173.7,181.7,180.3,185.4z',
                'M131.8,113.5c-4,-6.5,-9.7,-10.7,-17,-12.6c-7.1,-1.8,-14.1,-0.8,-20.8,3c-6.7,3.8,-10.9,9.2,-12.6,16.2c-1.8,7.3,-0.8,14.2,3.1,20.8c3.9,6.6,9.6,10.8,16.9,12.6c4.9,1.2,9.7,1.2,14.3,0c0.6,-0.2,1.1,0.4,1,1l-4.5,18.1c-0.5,1.8,0.6,3.7,2.5,4.1l6,1.5c1.8,0.5,3.7,-0.6,4.1,-2.5l9.9,-39.5c0,0,0.1,-0.3,0.1,-0.4c0,-0.1,0,-0.2,0,-0.3c0.2,-0.5,0.3,-1,0.4,-1.5C136.9,126.8,135.8,120,131.8,113.5zM104.7,141.6c-4,-1,-7.1,-3.3,-9.1,-6.8c-2.1,-3.5,-2.6,-7.3,-1.6,-11.3c1,-3.8,3.2,-6.8,6.7,-8.9c3.3,-2,7.3,-2.6,11,-1.7c4,1,7.1,3.2,9.2,6.8c2.3,3.8,2.7,7.9,1.3,12.2c-1,3,-3,5.7,-5.6,7.4C112.9,141.9,108.9,142.7,104.7,141.6z',
                'M139.5,210.4l-7.9,-2c-1.3,-0.3,-2.1,-1.7,-1.8,-3l31,-123.4c0.3,-1.3,1.7,-2.1,3,-1.8l7.9,2c1.3,0.3,2.1,1.7,1.8,3l-31,123.4C142.2,209.9,140.8,210.7,139.5,210.4z'
            ];
            // Fill (solid preview) then stroke outlines
            ctx.fillStyle = _col;
            ctx.globalAlpha = 0.88;
            outlines.forEach(function(d) { ctx.fill(new Path2D(d), 'evenodd'); });
            ctx.globalAlpha = 1.0;
            outlines.forEach(function(d) { ctx.stroke(new Path2D(d)); });
            ctx.restore();
        }

        ctx.restore();
    }

    function pickSignatureColor(palette) {
        // Black if the palette contains it; otherwise the darkest color present.
        if (!palette || !palette.length) return '#000000';
        var cols = [];
        for (var i = 0; i < palette.length; i++) {
            var c = (typeof palette[i] === 'string') ? palette[i] : (palette[i] && palette[i].color);
            if (c) cols.push(String(c));
        }
        if (!cols.length) return '#000000';
        for (var k = 0; k < cols.length; k++) { if (cols[k].toLowerCase() === '#000000') return '#000000'; }
        function _lum(hex) {
            var h = String(hex).replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
            var r = parseInt(h.substr(0,2),16)||0, g = parseInt(h.substr(2,2),16)||0, b = parseInt(h.substr(4,2),16)||0;
            return 0.299*r + 0.587*g + 0.114*b;
        }
        var best = cols[0], bl = _lum(cols[0]);
        for (var j = 1; j < cols.length; j++) { var l = _lum(cols[j]); if (l < bl) { bl = l; best = cols[j]; } }
        return best;
    }

    window.Signature = {
        seedToName: seedToName,
        buildSignatureSVG: buildSignatureSVG,
        pickSignatureColor: pickSignatureColor,
        drawSignaturePreview: drawSignaturePreview
    };

    window._signatureConfig = window._signatureConfig || {
        enabled: false,
        showPreview: true,
        suppressExport: false,
        showLogo: true,
        markType: 'logo',   // 'logo' | 'handwritten'
        font: 'ef',
        customMsg: '',
        heightMm: 2.0,
        scale: 2.0,
        yOffsetMm: 0.0,
        hPadMm: 0.0
    };
})();
