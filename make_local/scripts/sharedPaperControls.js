window.makeSketchUtils = window.makeSketchUtils || (function() {
    var DPI = 72;
    var PAPER_SIZES = {
        '5x7': { w: 5, h: 7 },
        '9x12':   { w: 9,   h: 12 },
        '11x14': { w: 11, h: 14 },
        '11x17': { w: 11, h: 17 },
        '14x17': { w: 14, h: 17 }
    };

    function buildPaperParams(defaultPaper, defaultMargin) {
        return [
            {
                id: 'paperSize',
                label: 'Paper size',
                type: 'select',
                showModeHidden: true,
                value: defaultPaper || '9x12',
                options: [
                    { value: '5x7', label: '5 x 7"' },
                    { value: '9x12',   label: '9 x 12"' },
                    { value: '11x14', label: '11 x 14"' },
                    { value: '11x17', label: '11 x 17"' },
                    { value: '14x17', label: '14 x 17"' },
                    { value: 'custom', label: 'Custom...' }
                ]
            },
            {
                id: 'customWidth',
                label: 'Width (inches)',
                type: 'number',
                showModeHidden: true,
                value: 8.5,
                min: 1,
                max: 48,
                step: 0.25,
                visibleWhen: { param: 'paperSize', values: ['custom'] }
            },
            {
                id: 'customHeight',
                label: 'Height (inches)',
                type: 'number',
                showModeHidden: true,
                value: 11,
                min: 1,
                max: 48,
                step: 0.25,
                visibleWhen: { param: 'paperSize', values: ['custom'] }
            },
            {
                id: 'margin',
                label: 'Margin',
                type: 'select',
                showModeHidden: true,
                value: String(defaultMargin || 1),
                options: [
                    { value: '0', label: '0 (none)' },
                    { value: '0.5', label: '1/2 inch' },
                    { value: '0.75', label: '3/4 inch' },
                    { value: '1', label: '1 inch' }
                ]
            }
        ];
    }

    function getPaperPixels(paperSize) {
        var dims;
        if (paperSize === 'custom') {
            var w = parseFloat((window.controls && window.controls.customWidth) || 8.5);
            var h = parseFloat((window.controls && window.controls.customHeight) || 11);
            if (!(w >= 1)) w = 8.5;
            if (!(h >= 1)) h = 11;
            dims = { width: Math.round(w * DPI), height: Math.round(h * DPI) };
        } else {
            var size = PAPER_SIZES[paperSize] || PAPER_SIZES['9x12'];
            dims = { width: Math.round(size.w * DPI), height: Math.round(size.h * DPI) };
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
        return Number(marginInches) * DPI;
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
