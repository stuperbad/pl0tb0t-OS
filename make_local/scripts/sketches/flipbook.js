// Flipbook — turn a video (or an image sequence) into a plottable sheet of
// flipbook cells.
//
// Pipeline: load video -> sample N frames evenly across its duration ->
// trace each frame to polylines -> lay the traced frames out as a grid of
// cells on the page, with optional cut marks -> plot, guillotine, staple.
//
// Frame count is the whole ballgame here. Traditional animation runs on
// "twos" at 24fps (12 distinct drawings/sec) and hand flipbooks read fine at
// 10-15fps, so 12fps is the default: it's the standard economical rate and it
// means ~8 seconds of video fits in 100 drawings. The 30-160 range comes from
// the physical book -- fewer than ~30 doesn't read as motion, more than ~160
// gets too thick to thumb comfortably on normal cardstock.
//
// Tracing is deliberately NOT the DBV3-grade machinery in imageTrace: this
// runs the tracer 100+ times, so it uses fast raster methods (marching-squares
// isolines, scanline hatching) that cost milliseconds per frame rather than
// seconds. Everything is bounded and yields to the browser between frames.
window.sketches = window.sketches || {};
window.sketches['flipbook'] = function (p) {
    var paper = window.makeSketchUtils;
    var DPI = 72;   // sharedPaperControls' unit: 1 inch = 72 canvas px

    var PARAMS = {
        paperSize: '9x12',
        margin: 0.5,

        cellWidthIn: 2.5,
        cellHeightIn: 4.0,
        gutterMm: 3,
        fitMode: 'cover',

        targetFrames: 100,
        outputFps: 12,
        startSec: 0,
        endSec: 0,           // 0 = to the end of the clip

        traceStyle: 'contour',
        threshold: 50,
        levels: 2,
        hatchSpacing: 3,
        minSegment: 2,
        invert: 'off',

        cutMarks: 'corners',
        cellNumbers: 'on',

        page: 1,
        previewFps: 12,
        inkColor: '#000000'
    };

    // ---- state -----------------------------------------------------------
    var videoEl = null, fileInput = null, helpEl = null, progressEl = null;
    var videoReady = false, videoDuration = 0, videoW = 0, videoH = 0;
    var stillImages = [];            // image-sequence mode
    var frames = [];                 // [{ polylines: [[{x,y}..]..] }] in CELL px
    var busy = false, previewing = false, previewIdx = 0, previewTimer = null;
    var sourceLabel = '';

    function cellPx() {
        return {
            w: Math.max(20, PARAMS.cellWidthIn * DPI),
            h: Math.max(20, PARAMS.cellHeightIn * DPI)
        };
    }
    function gridInfo() {
        var dims = paper.getPaperPixels(PARAMS.paperSize);
        var mgn = paper.getMarginPixels(PARAMS.margin);
        var gut = paper.mmToPixels(Math.max(0, PARAMS.gutterMm));
        var c = cellPx();
        var availW = dims.width - 2 * mgn, availH = dims.height - 2 * mgn;
        var cols = Math.max(1, Math.floor((availW + gut) / (c.w + gut)));
        var rows = Math.max(1, Math.floor((availH + gut) / (c.h + gut)));
        var perPage = cols * rows;
        var total = frames.length || estimateFrameCount();
        var pages = Math.max(1, Math.ceil(total / Math.max(1, perPage)));
        return { dims: dims, mgn: mgn, gut: gut, cell: c, cols: cols, rows: rows, perPage: perPage, pages: pages };
    }
    function clipDuration() {
        if (stillImages.length) return stillImages.length / Math.max(1, PARAMS.outputFps);
        if (!videoReady) return 0;
        var s = Math.max(0, PARAMS.startSec);
        var e = (PARAMS.endSec > 0) ? Math.min(PARAMS.endSec, videoDuration) : videoDuration;
        return Math.max(0, e - s);
    }
    function estimateFrameCount() {
        if (stillImages.length) return Math.min(stillImages.length, PARAMS.targetFrames);
        var d = clipDuration();
        if (!d) return 0;
        return Math.max(1, Math.min(PARAMS.targetFrames, Math.round(d * Math.max(1, PARAMS.outputFps))));
    }

    // ---- helpers ---------------------------------------------------------
    function setHelp(t, isErr) {
        if (!helpEl) return;
        helpEl.textContent = t;
        helpEl.style.color = isErr ? '#c0392b' : '';
    }
    function updateHelp() {
        if (busy) return;
        if (!videoReady && !stillImages.length) {
            setHelp('Load a video (or a set of images) to build a flipbook.');
            return;
        }
        var g = gridInfo();
        var n = frames.length || estimateFrameCount();
        var secs = (n / Math.max(1, PARAMS.outputFps));
        var t = sourceLabel + ' — ' + n + ' frames @ ' + PARAMS.outputFps + 'fps (' + secs.toFixed(1) + 's of flip)';
        t += '  |  ' + g.cols + '×' + g.rows + ' = ' + g.perPage + ' cells/page, ' + g.pages + ' page' + (g.pages > 1 ? 's' : '');
        if (!frames.length) t += '  |  hit Generate';
        else if (n < 30) t += '  |  under ~30 reads as a slideshow, not motion';
        else if (n > 160) t += '  |  over ~160 gets thick to thumb';
        setHelp(t);
    }
    function reportProgress(cur, total) {
        if (helpEl) helpEl.textContent = 'Tracing frame ' + cur + '/' + total + '…';
        if (progressEl) { progressEl.style.display = ''; progressEl.max = total; progressEl.value = cur; }
    }
    function hideProgress() { if (progressEl) progressEl.style.display = 'none'; }
    function yieldFrame() { return new Promise(function (r) { setTimeout(r, 0); }); }

    // ---- source loading --------------------------------------------------
    // What this browser engine can actually decode. The desktop app runs
    // QtWebEngine, which ships WITHOUT the proprietary H.264 decoder --
    // canPlayType('video/mp4; codecs="avc1..."') returns '' there, while VP8,
    // VP9 and Theora all report 'probably'. That matters a lot in practice
    // because virtually every phone and camera records H.264 .mp4, so the
    // failure is common and the raw <video> error event says nothing useful.
    function codecSupport(file) {
        var t = document.createElement('video');
        var name = (file.name || '').toLowerCase();
        var probes = [];
        if (/\.mp4$|\.m4v$|\.mov$/.test(name) || /mp4|quicktime/.test(file.type || '')) {
            probes = ['video/mp4; codecs="avc1.42E01E"', 'video/mp4'];
        } else if (/\.webm$/.test(name) || /webm/.test(file.type || '')) {
            probes = ['video/webm; codecs="vp9"', 'video/webm; codecs="vp8"', 'video/webm'];
        } else if (/\.ogv$|\.ogg$/.test(name) || /ogg/.test(file.type || '')) {
            probes = ['video/ogg; codecs="theora"', 'video/ogg'];
        } else if (file.type) {
            probes = [file.type];
        }
        for (var i = 0; i < probes.length; i++) {
            if (t.canPlayType(probes[i])) return true;
        }
        return probes.length === 0;   // unknown container: let the element try
    }
    function unsupportedMessage(file) {
        var isMp4 = /\.mp4$|\.m4v$|\.mov$/i.test(file.name || '');
        if (isMp4) {
            return 'This build can\'t decode H.264 (.mp4) — QtWebEngine ships without that decoder. '
                 + 'Use a WebM (VP8/VP9) file here, or open the online studio in Chrome, which does play .mp4. '
                 + 'ffmpeg: ffmpeg -i in.mp4 -c:v libvpx -b:v 0 -crf 30 -an out.webm';
        }
        return 'This build can\'t decode ' + (file.name || 'that file') + '. WebM (VP8/VP9) and Ogg/Theora both work.';
    }

    function loadVideoFile(file) {
        stillImages = [];
        frames = [];
        stopPreview();
        if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.preload = 'auto';
            videoEl.controls = true;
            videoEl.style.cssText = 'width:100%;max-height:220px;background:#000;border-radius:6px;display:block;margin:0 auto 8px;';
        }
        if (!codecSupport(file)) { setHelp(unsupportedMessage(file), true); return; }
        videoReady = false;
        setHelp('Reading ' + file.name + '…');
        var url = URL.createObjectURL(file);
        videoEl.src = url;
        // Mount the player NOW, not on metadata -- it used to appear only after
        // a successful decode, so a failed load left no visible player at all
        // and no way to tell whether anything had been picked up.
        mountVideoPreview();
        videoEl.onloadedmetadata = function () {
            videoDuration = videoEl.duration || 0;
            videoW = videoEl.videoWidth || 0;
            videoH = videoEl.videoHeight || 0;
            videoReady = !!(videoW && videoH);
            sourceLabel = file.name + ' (' + videoW + '×' + videoH + ', ' + videoDuration.toFixed(1) + 's)';
            if (PARAMS.endSec === 0 || PARAMS.endSec > videoDuration) PARAMS.endSec = 0;
            mountVideoPreview();
            updateHelp();
            p.redraw();
        };
        videoEl.onerror = function () {
            setHelp(unsupportedMessage(file), true);
            if (videoEl && videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
        };
    }
    function loadImageFiles(fileList) {
        var files = Array.prototype.slice.call(fileList).filter(function (f) { return /^image\//.test(f.type); });
        if (!files.length) return;
        files.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
        videoReady = false; frames = []; stopPreview();
        if (videoEl && videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
        stillImages = [];
        var loaded = 0;
        files.forEach(function (f, i) {
            var img = new Image();
            img.onload = function () {
                stillImages[i] = img;
                if (++loaded === files.length) {
                    sourceLabel = files.length + ' images';
                    updateHelp(); p.redraw();
                }
            };
            img.src = URL.createObjectURL(f);
        });
        setHelp('Reading ' + files.length + ' images…');
    }
    function mountVideoPreview() {
        var container = document.getElementById('make-sketch');
        if (!container || !videoEl) return;
        if (videoEl.parentNode !== container) container.insertBefore(videoEl, container.firstChild);
        videoEl.controls = true;
    }

    // ---- frame grab ------------------------------------------------------
    function seekTo(t) {
        return new Promise(function (resolve) {
            var done = false;
            function onSeeked() { if (done) return; done = true; videoEl.removeEventListener('seeked', onSeeked); resolve(); }
            videoEl.addEventListener('seeked', onSeeked);
            // Some containers never fire 'seeked' on an exact boundary; don't hang.
            setTimeout(function () { onSeeked(); }, 400);
            try { videoEl.currentTime = t; } catch (e) { onSeeked(); }
        });
    }
    // Draw the source into a cell-sized buffer, cover (crop) or contain (letterbox).
    function drawSourceToBuffer(src, sw, sh, ctx, cw, ch) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);
        if (!sw || !sh) return;
        var scale = (PARAMS.fitMode === 'contain')
            ? Math.min(cw / sw, ch / sh)
            : Math.max(cw / sw, ch / sh);
        var dw = sw * scale, dh = sh * scale;
        ctx.drawImage(src, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }

    // ---- tracing ---------------------------------------------------------
    function luminanceOf(data, n, invert) {
        var lum = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
            var v = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            lum[i] = invert ? v : 1 - v;   // stored as INK: 1 = dark
        }
        return lum;
    }
    function sobelField(lum, w, h) {
        var out = new Float32Array(w * h);
        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var i = y * w + x;
                var gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1]
                       + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
                var gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1]
                       + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
                out[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 4);
            }
        }
        return out;
    }
    // Marching squares isoline at `level`, emitting joined polylines. This is
    // the workhorse: one pass over the grid, O(w*h), no iteration.
    function marchingSquares(field, w, h, level) {
        var segs = [];
        function interp(x1, y1, v1, x2, y2, v2) {
            var t = (level - v1) / ((v2 - v1) || 1e-6);
            t = Math.max(0, Math.min(1, t));
            return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
        }
        for (var y = 0; y < h - 1; y++) {
            for (var x = 0; x < w - 1; x++) {
                var i = y * w + x;
                var tl = field[i], tr = field[i + 1], br = field[i + w + 1], bl = field[i + w];
                var code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
                if (code === 0 || code === 15) continue;
                var T = interp(x, y, tl, x + 1, y, tr);
                var R = interp(x + 1, y, tr, x + 1, y + 1, br);
                var B = interp(x, y + 1, bl, x + 1, y + 1, br);
                var L = interp(x, y, tl, x, y + 1, bl);
                switch (code) {
                    case 1: case 14: segs.push([L, B]); break;
                    case 2: case 13: segs.push([B, R]); break;
                    case 3: case 12: segs.push([L, R]); break;
                    case 4: case 11: segs.push([T, R]); break;
                    case 6: case 9:  segs.push([T, B]); break;
                    case 7: case 8:  segs.push([L, T]); break;
                    case 5:  segs.push([L, T]); segs.push([B, R]); break;
                    case 10: segs.push([T, R]); segs.push([L, B]); break;
                }
            }
        }
        return joinSegments(segs);
    }
    // Weld segments into polylines by snapping endpoints to a hash grid --
    // fewer pen lifts, which matters a lot at 100 frames per sheet.
    function joinSegments(segs) {
        var Q = 100, map = {}, used = new Uint8Array(segs.length);
        function key(pt) { return Math.round(pt.x * Q) + ',' + Math.round(pt.y * Q); }
        for (var i = 0; i < segs.length; i++) {
            var a = key(segs[i][0]), b = key(segs[i][1]);
            (map[a] || (map[a] = [])).push(i);
            (map[b] || (map[b] = [])).push(i);
        }
        function takeFrom(k, skip) {
            var list = map[k]; if (!list) return -1;
            for (var j = 0; j < list.length; j++) {
                var idx = list[j];
                if (idx !== skip && !used[idx]) return idx;
            }
            return -1;
        }
        var out = [];
        for (var s = 0; s < segs.length; s++) {
            if (used[s]) continue;
            used[s] = 1;
            var poly = [segs[s][0], segs[s][1]];
            // extend forward
            for (var guard = 0; guard < 20000; guard++) {
                var nxt = takeFrom(key(poly[poly.length - 1]), -1);
                if (nxt < 0) break;
                used[nxt] = 1;
                var seg = segs[nxt];
                poly.push(key(seg[0]) === key(poly[poly.length - 1]) ? seg[1] : seg[0]);
            }
            // extend backward
            for (var guard2 = 0; guard2 < 20000; guard2++) {
                var prv = takeFrom(key(poly[0]), -1);
                if (prv < 0) break;
                used[prv] = 1;
                var seg2 = segs[prv];
                poly.unshift(key(seg2[0]) === key(poly[0]) ? seg2[1] : seg2[0]);
            }
            if (poly.length >= 2) out.push(poly);
        }
        return out;
    }
    function hatchTrace(lum, w, h, level, spacing) {
        var out = [], step = Math.max(1, Math.round(spacing));
        for (var y = 0; y < h; y += step) {
            var run = null;
            for (var x = 0; x < w; x++) {
                var on = lum[y * w + x] > level;
                if (on && !run) run = { x: x };
                else if (!on && run) {
                    if (x - run.x >= PARAMS.minSegment) out.push([{ x: run.x, y: y }, { x: x, y: y }]);
                    run = null;
                }
            }
            if (run && w - run.x >= PARAMS.minSegment) out.push([{ x: run.x, y: y }, { x: w - 1, y: y }]);
        }
        return out;
    }
    function traceBuffer(ctx, cw, ch) {
        var img = ctx.getImageData(0, 0, cw, ch);
        var lum = luminanceOf(img.data, cw * ch, PARAMS.invert === 'on');
        var lvl = Math.max(0.01, Math.min(0.99, PARAMS.threshold / 100));
        var polys = [];
        if (PARAMS.traceStyle === 'hatch') {
            polys = hatchTrace(lum, cw, ch, lvl, PARAMS.hatchSpacing);
        } else if (PARAMS.traceStyle === 'edges') {
            polys = marchingSquares(sobelField(lum, cw, ch), cw, ch, Math.max(0.04, lvl * 0.5));
        } else {
            var n = Math.max(1, Math.min(4, Math.round(PARAMS.levels)));
            for (var k = 0; k < n; k++) {
                // spread levels around the threshold for tonal separation
                var l = lvl + (k - (n - 1) / 2) * (0.5 / n);
                if (l <= 0.02 || l >= 0.98) continue;
                polys = polys.concat(marchingSquares(lum, cw, ch, l));
            }
        }
        // drop specks
        return polys.filter(function (pl) {
            if (pl.length < 2) return false;
            var len = 0;
            for (var i = 1; i < pl.length; i++) len += Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y);
            return len >= PARAMS.minSegment;
        });
    }

    // ---- generate --------------------------------------------------------
    async function generate() {
        if (busy) return;
        if (!videoReady && !stillImages.length) { setHelp('Load a video or images first.', true); return; }
        busy = true; stopPreview(); frames = [];
        var c = cellPx();
        var cw = Math.max(24, Math.round(c.w)), ch = Math.max(24, Math.round(c.h));
        var buf = document.createElement('canvas');
        buf.width = cw; buf.height = ch;
        var ctx = buf.getContext('2d', { willReadFrequently: true });
        var n = estimateFrameCount();
        try {
            if (stillImages.length) {
                for (var i = 0; i < n; i++) {
                    var src = stillImages[Math.floor(i * stillImages.length / n)];
                    drawSourceToBuffer(src, src.naturalWidth, src.naturalHeight, ctx, cw, ch);
                    frames.push({ polylines: traceBuffer(ctx, cw, ch) });
                    if (i % 3 === 0) { reportProgress(i + 1, n); await yieldFrame(); }
                }
            } else {
                var s = Math.max(0, PARAMS.startSec);
                var e = (PARAMS.endSec > 0) ? Math.min(PARAMS.endSec, videoDuration) : videoDuration;
                var span = Math.max(0.001, e - s);
                videoEl.pause();
                for (var f = 0; f < n; f++) {
                    var t = s + (span * (n === 1 ? 0 : f / (n - 1)));
                    await seekTo(Math.min(t, Math.max(0, videoDuration - 0.02)));
                    drawSourceToBuffer(videoEl, videoW, videoH, ctx, cw, ch);
                    frames.push({ polylines: traceBuffer(ctx, cw, ch) });
                    reportProgress(f + 1, n);
                    await yieldFrame();
                }
            }
            PARAMS.page = 1;
        } catch (err) {
            console.error('flipbook generate failed', err);
            setHelp('Frame extraction failed: ' + err.message, true);
        } finally {
            busy = false; hideProgress(); updateHelp(); p.redraw();
        }
    }

    // ---- preview ---------------------------------------------------------
    function stopPreview() {
        previewing = false;
        if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
    }
    function togglePreview() {
        if (previewing) { stopPreview(); p.redraw(); return; }
        if (!frames.length) { setHelp('Generate first, then preview the flip.', true); return; }
        previewing = true; previewIdx = 0;
        previewTimer = setInterval(function () {
            previewIdx = (previewIdx + 1) % frames.length;
            p.redraw();
        }, 1000 / Math.max(1, PARAMS.previewFps));
        p.redraw();
    }

    // ---- layout / drawing ------------------------------------------------
    function cellRect(g, slot) {
        var col = slot % g.cols, row = Math.floor(slot / g.cols);
        return {
            x: g.mgn + col * (g.cell.w + g.gut),
            y: g.mgn + row * (g.cell.h + g.gut),
            w: g.cell.w, h: g.cell.h
        };
    }
    function framesOnPage(g, page) {
        var start = (page - 1) * g.perPage;
        return frames.slice(start, start + g.perPage).map(function (fr, i) { return { fr: fr, slot: i, index: start + i }; });
    }

    p.setup = function () {
        var container = document.getElementById('make-sketch');
        if (container) {
            container.style.flexDirection = 'column';
            container.style.alignItems = 'center';
            helpEl = document.createElement('div');
            helpEl.style.cssText = 'width:100%;margin:0 auto 6px;color:#667085;font-size:12px;line-height:1.35;text-align:center;';
            container.appendChild(helpEl);
            progressEl = document.createElement('progress');
            progressEl.style.cssText = 'width:100%;height:8px;display:none;margin:0 auto 8px;';
            container.appendChild(progressEl);
        }
        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'video/*,image/*';
            fileInput.multiple = true;
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', function (e) {
                var fl = e.target.files;
                if (!fl || !fl.length) return;
                if (/^video\//.test(fl[0].type)) loadVideoFile(fl[0]);
                else loadImageFiles(fl);
                e.target.value = '';
            });
            document.body.appendChild(fileInput);
        }
        var canvas = paper.createPaperCanvas(p, PARAMS.paperSize);
        canvas.parent(container || document.getElementById('make-sketch'));
        p.pixelDensity(1);
        p.noLoop();
        updateHelp();
    };

    p.draw = function () {
        p.background(255);
        var g = gridInfo();
        p.push();
        p.stroke(0); p.noFill(); p.strokeWeight(1);
        p.rect(1, 1, g.dims.width - 2, g.dims.height - 2);
        p.pop();

        if (previewing && frames.length) {
            // Flip preview: one cell, centred, playing back.
            var fr = frames[previewIdx % frames.length];
            var cx = (g.dims.width - g.cell.w) / 2, cy = (g.dims.height - g.cell.h) / 2;
            p.push();
            p.stroke(200); p.noFill(); p.rect(cx, cy, g.cell.w, g.cell.h);
            p.stroke(PARAMS.inkColor); p.strokeWeight(1);
            drawPolys(fr.polylines, cx, cy);
            p.pop();
            p.push();
            p.noStroke(); p.fill(120); p.textAlign(p.CENTER); p.textSize(11);
            p.text('frame ' + (previewIdx + 1) + ' / ' + frames.length + '  @' + PARAMS.previewFps + 'fps',
                   g.dims.width / 2, cy + g.cell.h + 16);
            p.pop();
            return;
        }

        var page = Math.max(1, Math.min(g.pages, Math.round(PARAMS.page)));
        var list = framesOnPage(g, page);
        for (var i = 0; i < list.length; i++) {
            var r = cellRect(g, list[i].slot);
            drawCutMarks(r);
            p.push();
            p.stroke(PARAMS.inkColor); p.strokeWeight(1); p.noFill();
            drawPolys(list[i].fr.polylines, r.x, r.y);
            p.pop();
            if (PARAMS.cellNumbers === 'on') {
                p.push();
                p.noStroke(); p.fill(PARAMS.inkColor); p.textSize(7);
                p.text(String(list[i].index + 1), r.x + 3, r.y + r.h - 3);
                p.pop();
            }
        }
        if (!frames.length) {
            p.push();
            p.noStroke(); p.fill(170); p.textAlign(p.CENTER); p.textSize(13);
            p.text('Load a video, set your cell size, then Generate',
                   g.dims.width / 2, g.dims.height / 2);
            p.pop();
        }
    };
    function drawPolys(polys, ox, oy) {
        for (var i = 0; i < polys.length; i++) {
            var pl = polys[i];
            p.beginShape();
            for (var j = 0; j < pl.length; j++) p.vertex(ox + pl[j].x, oy + pl[j].y);
            p.endShape();
        }
    }
    function drawCutMarks(r) {
        if (PARAMS.cutMarks === 'none') return;
        p.push();
        p.stroke(0); p.strokeWeight(0.5); p.noFill();
        if (PARAMS.cutMarks === 'rect') {
            p.rect(r.x, r.y, r.w, r.h);
        } else {
            var t = Math.min(8, r.w * 0.12, r.h * 0.12);
            [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]
                .forEach(function (c) {
                    p.line(c[0], c[1], c[0] + t * c[2], c[1]);
                    p.line(c[0], c[1], c[0], c[1] + t * c[3]);
                });
        }
        p.pop();
    }

    // ---- SVG -------------------------------------------------------------
    function pageSvg(page) {
        var g = gridInfo();
        var parts = [];
        parts.push('<?xml version="1.0" encoding="UTF-8"?>');
        parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + g.dims.width + '" height="' + g.dims.height +
                   '" viewBox="0 0 ' + g.dims.width + ' ' + g.dims.height + '">');
        parts.push('<rect x="0" y="0" width="' + g.dims.width + '" height="' + g.dims.height + '" fill="#ffffff"/>');
        var list = framesOnPage(g, page);
        list.forEach(function (item) {
            var r = cellRect(g, item.slot);
            if (PARAMS.cutMarks === 'rect') {
                parts.push('<rect x="' + f2(r.x) + '" y="' + f2(r.y) + '" width="' + f2(r.w) + '" height="' + f2(r.h) +
                           '" fill="none" stroke="#000000" stroke-width="0.5"/>');
            } else if (PARAMS.cutMarks === 'corners') {
                var t = Math.min(8, r.w * 0.12, r.h * 0.12);
                [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]
                    .forEach(function (c) {
                        parts.push(lineTag(c[0], c[1], c[0] + t * c[2], c[1]));
                        parts.push(lineTag(c[0], c[1], c[0], c[1] + t * c[3]));
                    });
            }
            var d = [];
            item.fr.polylines.forEach(function (pl) {
                var s = 'M' + f2(r.x + pl[0].x) + ' ' + f2(r.y + pl[0].y);
                for (var j = 1; j < pl.length; j++) s += ' L' + f2(r.x + pl[j].x) + ' ' + f2(r.y + pl[j].y);
                d.push(s);
            });
            if (d.length) {
                parts.push('<path d="' + d.join(' ') + '" fill="none" stroke="' + PARAMS.inkColor +
                           '" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>');
            }
        });
        parts.push('</svg>');
        return parts.join('\n');
    }
    function f2(n) { return Math.round(n * 100) / 100; }
    function lineTag(x1, y1, x2, y2) {
        return '<line x1="' + f2(x1) + '" y1="' + f2(y1) + '" x2="' + f2(x2) + '" y2="' + f2(y2) +
               '" stroke="#000000" stroke-width="0.5"/>';
    }
    function downloadSvgString(str, filename) {
        var blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    // Pages are POSTed in order 1..N so the first drawings of the animation
    // are the first thing the plotter picks up.
    async function queueAllPages() {
        if (!frames.length) { setHelp('Generate first.', true); return; }
        var g = gridInfo();
        var base = window.QUEUE_URL || 'http://localhost:5001';
        var headers = { 'Content-Type': 'application/json', 'X-API-Key': window.QUEUE_API_KEY || '' };
        for (var pg = 1; pg <= g.pages; pg++) {
            setHelp('Queueing page ' + pg + '/' + g.pages + '…');
            try {
                var res = await fetch(base + '/jobs', {
                    method: 'POST', headers: headers,
                    body: JSON.stringify({
                        svg: pageSvg(pg),
                        sketch_name: 'flipbook',
                        paper_size: PARAMS.paperSize,
                        recipe: { sketch: 'flipbook', params: api.getParamsSnapshot ? api.getParamsSnapshot() : [] }
                    })
                });
                if (!res.ok) throw new Error('server ' + res.status);
            } catch (e) {
                setHelp('Queue failed on page ' + pg + ': ' + e.message, true);
                return;
            }
        }
        setHelp('✓ Queued ' + g.pages + ' page' + (g.pages > 1 ? 's' : '') + ' in order.');
    }

    // ---- params ----------------------------------------------------------
    var api = {
        params: paper.buildPaperParams(PARAMS.paperSize, PARAMS.margin).concat([
            { id: 'loadSource', label: 'Source', type: 'action', buttonLabel: '⬆ Load video / images', group: 'general',
              tip: 'Pick a video file, or select several images at once for an image sequence. Frames are sampled evenly across the clip.' },
            { id: 'generate', label: 'Generate', type: 'action', buttonLabel: '⟳ Generate frames', group: 'general',
              tip: 'Extract and trace every frame. Progress shows above the page; the tab stays responsive throughout.' },
            { id: 'previewFlip', label: 'Preview traced flip', type: 'action', buttonLabel: '▶ Play / pause TRACED flip', group: 'general',
              tip: 'Plays the TRACED frames back in one cell at Preview FPS, so you can judge the motion before committing paper to it. This is not the source clip -- the loaded video appears above the page with its own scrubber and play button.' },
            { id: 'queuePages', label: 'Queue', type: 'action', buttonLabel: '→ Queue all pages', group: 'general',
              tip: 'Adds every page to the plot queue in order, so page 1 (the start of the animation) is plotted first.' },

            { id: 'targetFrames', label: 'Frames', type: 'range', min: 12, max: 200, step: 1, value: 100, group: 'general',
              tip: 'How many drawings the book gets. Under ~30 reads as a slideshow rather than motion; over ~160 gets too thick to thumb on normal cardstock. 100 is a good first book.' },
            { id: 'outputFps', label: 'Flip FPS', type: 'range', min: 6, max: 24, step: 1, value: 12, group: 'general',
              tip: 'Playback rate the book is designed for. 12 is the classic animation-on-twos rate and the usual flipbook sweet spot: readable motion for half the drawings of 24. Together with Frames this sets how many seconds of video you capture.' },
            { id: 'startSec', label: 'Start (s)', type: 'number', value: 0, group: 'general',
              tip: 'Trim in-point in the source video.' },
            { id: 'endSec', label: 'End (s)', type: 'number', value: 0, group: 'general',
              tip: 'Trim out-point. 0 = run to the end of the clip.' },

            { id: 'cellWidthIn', label: 'Cell width (in)', type: 'range', min: 1, max: 6, step: 0.25, value: 2.5, group: 'general',
              tip: 'Width of one flipbook page. 2.5 x 4in is a good starting size -- thumb-friendly and it tiles a 9x12 sheet efficiently.' },
            { id: 'cellHeightIn', label: 'Cell height (in)', type: 'range', min: 1, max: 8, step: 0.25, value: 4, group: 'general',
              tip: 'Height of one flipbook page. The bound edge runs along one short side.' },
            { id: 'gutterMm', label: 'Gutter (mm)', type: 'range', min: 0, max: 15, step: 0.5, value: 3, group: 'general',
              tip: 'Gap between cells, i.e. how much room the guillotine gets.' },
            { id: 'fitMode', label: 'Frame fit', type: 'select', value: 'cover', group: 'general',
              tip: 'Cover crops the video to fill the cell (usual choice -- flipbook cells are tall, video is wide). Contain letterboxes the whole frame in.',
              options: [{ value: 'cover', label: 'Cover (crop)' }, { value: 'contain', label: 'Contain (letterbox)' }] },

            { id: 'traceStyle', label: 'Trace style', type: 'select', value: 'contour', group: 'general',
              tip: 'Fast tracers only -- this runs 100+ times, so the heavy samplers in Image Trace are not an option here. Contour = tonal isolines (best all-rounder). Edges = outline only. Hatch = scanlines, densest and quickest to read as shading.',
              options: [{ value: 'contour', label: 'Contour (isolines)' }, { value: 'edges', label: 'Edges (outline)' }, { value: 'hatch', label: 'Hatch (scanlines)' }] },
            { id: 'threshold', label: 'Threshold', type: 'range', min: 5, max: 95, step: 1, value: 50, group: 'general',
              tip: 'Ink/paper cut point. Lower catches more of the image.' },
            { id: 'levels', label: 'Tone levels', type: 'range', min: 1, max: 4, step: 1, value: 2, group: 'general',
              visibleWhen: { param: 'traceStyle', values: ['contour'] },
              tip: 'How many isolines to draw around the threshold. More = more tonal depth and more pen time.' },
            { id: 'hatchSpacing', label: 'Hatch spacing', type: 'range', min: 1, max: 10, step: 1, value: 3, group: 'general',
              visibleWhen: { param: 'traceStyle', values: ['hatch'] },
              tip: 'Scanline pitch in cell pixels.' },
            { id: 'minSegment', label: 'Min detail', type: 'range', min: 0, max: 12, step: 1, value: 2, group: 'general',
              tip: 'Drops marks shorter than this. Raise it to clear speckle -- worth doing, because speckle costs pen-up time on every one of your frames.' },
            { id: 'invert', label: 'Invert', type: 'select', value: 'off', group: 'general',
              tip: 'Trace the light areas instead of the dark ones.',
              options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },

            { id: 'cutMarks', label: 'Cut marks', type: 'select', value: 'corners', group: 'general',
              tip: 'Corners = short crop ticks at each cell corner (least ink, still guides a blade). Rect = full outline around each cell. None = nothing.',
              options: [{ value: 'corners', label: 'Corner ticks' }, { value: 'rect', label: 'Full rectangle' }, { value: 'none', label: 'None' }] },
            { id: 'cellNumbers', label: 'Frame numbers', type: 'select', value: 'on', group: 'general',
              tip: 'Prints the frame index in each cell. Strongly recommended -- once the sheet is cut apart, unnumbered cells are painful to re-order.',
              options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },

            { id: 'page', label: 'Page', type: 'range', min: 1, max: 20, step: 1, value: 1, group: 'general',
              tip: 'Which sheet to show on canvas. Queue all pages sends every one.' },
            { id: 'previewFps', label: 'Preview FPS', type: 'range', min: 2, max: 30, step: 1, value: 12, group: 'general',
              tip: 'Playback speed of the on-canvas flip preview. Independent of Flip FPS so you can check the motion fast or slow.' },
            { id: 'inkColor', label: 'Ink', type: 'colorPalette', maxSelect: 1, value: ['#000000'], group: 'color',
              options: [
                { value: '#000000', label: 'Black' }, { value: '#00ffff', label: 'Cyan' },
                { value: '#ff00ff', label: 'Magenta' }, { value: '#3366ff', label: 'Blue' },
                { value: '#ff3333', label: 'Red' }, { value: 'custom', label: 'Custom' }
              ],
              tip: 'Single pen. Multi-pen flipbooks are a later problem -- registration across 100 cut cells is unforgiving.' }
        ]),

        regenerate: function () { paper.resizeCanvasToPaper(p, PARAMS.paperSize); p.redraw(); },
        getPlotColors: function () { return [PARAMS.inkColor]; },
        getSignatureSeed: function () { return 20260825; },
        getParamsSnapshot: function () {
            return Object.keys(PARAMS).map(function (k) { return { id: k, value: PARAMS[k] }; });
        },
        saveSVG: function () {
            if (!frames.length) { setHelp('Nothing generated yet.', true); return; }
            var g = gridInfo();
            var page = Math.max(1, Math.min(g.pages, Math.round(PARAMS.page)));
            downloadSvgString(pageSvg(page), '90percentart-flipbook-p' + page + '.svg');
        },
        setParam: function (name, val) {
            if (name === 'loadSource') { if (fileInput) fileInput.click(); return; }
            if (name === 'generate') { generate(); return; }
            if (name === 'previewFlip') { togglePreview(); return; }
            if (name === 'queuePages') { queueAllPages(); return; }
            if (name === 'inkColor') {
                var v = Array.isArray(val) ? val[0] : val;
                PARAMS.inkColor = v || '#000000';
            } else if (['margin', 'cellWidthIn', 'cellHeightIn', 'gutterMm', 'targetFrames', 'outputFps',
                        'startSec', 'endSec', 'threshold', 'levels', 'hatchSpacing', 'minSegment',
                        'page', 'previewFps'].indexOf(name) >= 0) {
                PARAMS[name] = Number(val);
            } else if (PARAMS.hasOwnProperty(name)) {
                PARAMS[name] = val;
            }
            if (name === 'previewFps' && previewing) { stopPreview(); togglePreview(); }
            if (name === 'paperSize') paper.resizeCanvasToPaper(p, PARAMS.paperSize);
            updateHelp();
        }
    };
    p.registerSketchAPI = function (register) { if (typeof register === 'function') register(api); };
};
