window.makeSketchUtils = window.makeSketchUtils || (function() {
    var DPI = 72;
    var PAPER_SIZES = {
        '5x7': { w: 5, h: 7 },
        '9x12':   { w: 9,   h: 12 },
        '11x14': { w: 11, h: 14 },
        '11x17': { w: 11, h: 17 },
        '14x17': { w: 14, h: 17 }
    };

    // Paper is now a GLOBAL authorship setting owned by paperSettings.js
    // (window._paperSettings) rather than a per-sketch control. Returning []
    // removes the old per-sketch paper controls; the helpers below read the
    // global. The args are kept only as a backward-compat fallback for any
    // caller that still passes a size before the global is initialised.
    function buildPaperParams(defaultPaper, defaultMargin) {
        return [];
    }

    function getPaperPixels(paperSize) {
        var ps = window._paperSettings || {};
        var size = ps.paperSize || paperSize || '9x12';
        var dims;
        if (size === 'custom') {
            var w = parseFloat(ps.customWidth != null ? ps.customWidth : ((window.controls && window.controls.customWidth) || 8.5));
            var h = parseFloat(ps.customHeight != null ? ps.customHeight : ((window.controls && window.controls.customHeight) || 11));
            if (!(w >= 1)) w = 8.5;
            if (!(h >= 1)) h = 11;
            dims = { width: Math.round(w * DPI), height: Math.round(h * DPI) };
        } else {
            var sz = PAPER_SIZES[size] || PAPER_SIZES['9x12'];
            dims = { width: Math.round(sz.w * DPI), height: Math.round(sz.h * DPI) };
        }
        // Landscape: flip artboard X/Y (global toggle from the Make tab).
        if (window._pl0tLandscape) return { width: dims.height, height: dims.width };
        return dims;
    }

    function resizeCanvasToPaper(p, paperSize) {
        var dims = getPaperPixels(paperSize);
        if (p.width !== dims.width || p.height !== dims.height) {
            p.resizeCanvas(dims.width, dims.height);
        }
        return dims;
    }

    function createPaperCanvas(p, paperSize, renderer) {
        var dims = getPaperPixels(paperSize);
        if (typeof renderer !== 'undefined') {
            return p.createCanvas(dims.width, dims.height, renderer);
        }
        return p.createCanvas(dims.width, dims.height);
    }

    function getMarginPixels(marginInches) {
        var ps = window._paperSettings || {};
        var m = (ps.margin != null) ? ps.margin : marginInches;
        return Number(m) * DPI;
    }

    function mmToPixels(mm) {
        return (Number(mm) / 25.4) * DPI;
    }

    function drawPaperBorder(p) {
        p.push();
        p.noFill();
        p.stroke(180);
        p.strokeWeight(2);
        p.rect(1, 1, p.width - 2, p.height - 2);
        p.pop();
    }

    return {
        DPI: DPI,
        PAPER_SIZES: PAPER_SIZES,
        buildPaperParams: buildPaperParams,
        getPaperPixels: getPaperPixels,
        resizeCanvasToPaper: resizeCanvasToPaper,
        createPaperCanvas: createPaperCanvas,
        getMarginPixels: getMarginPixels,
        mmToPixels: mmToPixels,
        drawPaperBorder: drawPaperBorder
    };
})();
