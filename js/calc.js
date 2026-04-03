$(function() {
    // ======== CURRENCY CALCULATOR ========
    var fxRates = { TWD: 1 };
    var activeCur = 'JPY';
    var calcExpr = '';
    var calcDisplay = '';
    var justEvaled = false;
    var calcInited = false;

    var ALL_CURRENCIES = ['TWD','JPY','USD','CNY','KRW'];
    var CURRENCY_META = {
        TWD: { flag: '🇹🇼', name: '新台幣',  decimals: 1,  fallback: 1     },
        JPY: { flag: '🇯🇵', name: '日圓',    decimals: 0,  fallback: 4.58  },
        USD: { flag: '🇺🇸', name: '美元',    decimals: 2,  fallback: 0.031 },
        CNY: { flag: '🇨🇳', name: '人民幣',  decimals: 2,  fallback: 0.22  },
        KRW: { flag: '🇰🇷', name: '韓元',    decimals: 0,  fallback: 41.5  }
    };

    function evalExpr(expr) {
        if (!expr) return 0;
        try {
            var safe = expr.replace(/[^0-9+\-*/.%]/g, '');
            safe = safe.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
            if (/[+\-*/]$/.test(safe)) safe = safe.slice(0, -1);
            var result = Function('"use strict"; return (' + safe + ')')();
            return isFinite(result) ? result : 0;
        } catch(e) { return 0; }
    }

    function calcConvert() {
        var inputVal = evalExpr(calcExpr);
        var twdVal = 0;
        if (activeCur === 'TWD') {
            twdVal = inputVal;
        } else {
            var rateToTWD = fxRates[activeCur];
            if (rateToTWD) twdVal = inputVal / rateToTWD;
        }
        renderResults(twdVal);
    }

    function renderResults(twdVal) {
        var html = '';
        var activeRate = fxRates[activeCur];
        ALL_CURRENCIES.forEach(function(cur) {
            if (cur === activeCur) return;
            var meta = CURRENCY_META[cur];
            var rate = fxRates[cur];
            var amtStr, rateStr;
            if (cur === 'TWD') {
                amtStr = twdVal > 0 ? twdVal.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—';
                rateStr = activeRate ? '1 ' + activeCur + ' = ' + (1/activeRate).toFixed(4) + ' TWD' : '—';
            } else {
                var converted = twdVal > 0 && rate ? twdVal * rate : null;
                amtStr = converted !== null
                    ? (meta.decimals === 0 ? Math.round(converted).toLocaleString() : converted.toFixed(meta.decimals))
                    : '—';
                rateStr = rate && activeRate
                    ? '1 ' + activeCur + ' = ' + (rate/activeRate).toFixed(rate >= 10 ? 2 : 4) + ' ' + cur
                    : '—';
            }
            html += '<div class="result-row">' +
                '<span class="result-flag">' + meta.flag + '</span>' +
                '<div class="result-info"><div class="result-code">' + cur + '</div><div class="result-rate">' + rateStr + '</div></div>' +
                '<div class="result-amount">' + amtStr + '</div></div>';
        });
        $('#resultsList').html(html);
    }

    async function fetchRates() {
        try {
            $('#statusDot').attr('class', 'status-dot loading');
            $('#statusText').text('更新中...');
            var res = await fetch('https://open.er-api.com/v6/latest/TWD');
            var data = await res.json();
            if (data.result === 'success') {
                ALL_CURRENCIES.forEach(function(c) {
                    if (data.rates[c]) fxRates[c] = data.rates[c];
                });
                fxRates['TWD'] = 1;
                var updated = new Date(data.time_last_update_utc);
                $('#statusDot').attr('class', 'status-dot ok');
                $('#statusText').text(updated.toLocaleDateString('zh-TW'));
                calcConvert();
            } else { throw new Error(); }
        } catch(e) {
            $('#statusDot').attr('class', 'status-dot error');
            $('#statusText').text('預設匯率');
            ALL_CURRENCIES.forEach(function(c) {
                if (!fxRates[c]) fxRates[c] = CURRENCY_META[c].fallback;
            });
            calcConvert();
        }
    }

    function setCurrency(cur) {
        activeCur = cur;
        var meta = CURRENCY_META[cur];
        $('#csb-flag').text(meta.flag);
        $('#csb-code').text(cur);
        $('#curModalList .cur-option').removeClass('selected');
        $('#curModalList .cur-option[data-cur="' + cur + '"]').addClass('selected');
        calcConvert();
    }

    async function detectLocation() {
        try {
            var res = await fetch('https://ipapi.co/json/');
            var data = await res.json();
            var cc = data.country_code;
            var cur = 'JPY', label = '📍 日本';
            if      (cc === 'JP') { cur = 'JPY'; label = '📍 日本'; }
            else if (cc === 'US') { cur = 'USD'; label = '📍 美國'; }
            else if (cc === 'TW') { cur = 'USD'; label = '📍 台灣'; }
            else if (cc === 'CN') { cur = 'CNY'; label = '📍 中國'; }
            else if (cc === 'KR') { cur = 'KRW'; label = '📍 韓國'; }
            else                  { cur = 'JPY'; label = '📍 ' + (data.country_name || cc); }
            $('#screenDetect').text(label);
            setCurrency(cur);
        } catch(e) {
            $('#screenDetect').text('📍 偵測失敗，預設日幣');
            setCurrency('JPY');
        }
    }

    function calcPressKey(key) {
        var ops = ['+', '-', '*', '/'];
        if (key === 'C') {
            calcExpr = ''; calcDisplay = ''; justEvaled = false;
        } else if (key === 'DEL') {
            if (justEvaled) { calcExpr = ''; calcDisplay = ''; justEvaled = false; }
            else { calcExpr = calcExpr.slice(0, -1); calcDisplay = calcExpr; }
        } else if (key === '=') {
            if (!calcExpr) return;
            try {
                var result = evalExpr(calcExpr);
                var rounded = parseFloat(result.toFixed(6));
                calcDisplay = String(rounded);
                calcExpr = String(rounded);
                justEvaled = true;
            } catch(e) { calcDisplay = 'ERR'; calcExpr = ''; }
        } else if (key === '%') {
            calcExpr += '%'; calcDisplay = calcExpr; justEvaled = false;
        } else {
            if (justEvaled && /[0-9.]/.test(key)) {
                calcExpr = key; calcDisplay = calcExpr; justEvaled = false;
            } else if (justEvaled && ops.indexOf(key) >= 0) {
                calcExpr += key; calcDisplay = calcExpr; justEvaled = false;
            } else {
                if (key === '.') {
                    var parts = calcExpr.split(/[+\-*/]/);
                    if (parts[parts.length - 1].indexOf('.') >= 0) { renderScreen(); return; }
                }
                if (ops.indexOf(key) >= 0 && ops.indexOf(calcExpr.slice(-1)) >= 0) {
                    calcExpr = calcExpr.slice(0, -1);
                }
                calcExpr += key; calcDisplay = calcExpr;
            }
        }
        renderScreen();
    }

    function renderScreen() {
        var $expr = $('#screenExpr');
        if (!calcDisplay) {
            $expr.addClass('is-placeholder').text('0');
        } else {
            $expr.removeClass('is-placeholder').text(calcDisplay);
        }
        calcConvert();
    }

    function buildModal() {
        var html = '';
        ALL_CURRENCIES.forEach(function(cur) {
            var meta = CURRENCY_META[cur];
            var sel = cur === activeCur ? ' selected' : '';
            html += '<div class="cur-option' + sel + '" data-cur="' + cur + '">' +
                '<span class="co-flag">' + meta.flag + '</span>' +
                '<div class="co-info"><div class="co-code">' + cur + '</div><div class="co-name">' + meta.name + '</div></div>' +
                (sel ? '<span class="co-check">✓</span>' : '') +
                '</div>';
        });
        $('#curModalList').html(html);
    }

    // ---- Event bindings ----
    $(document).on('click', '.np-btn', function() { calcPressKey($(this).data('key')); });

    $('#curSelectorBtn').on('click', function() {
        buildModal();
        $('#curModal').addClass('show');
    });
    $('#curModal').on('click', function(e) {
        if (e.target === this) $('#curModal').removeClass('show');
    });
    $(document).on('click', '.cur-option', function() {
        var cur = $(this).data('cur');
        setCurrency(cur);
        $('#curModal').removeClass('show');
    });

    $('#refreshRates').on('click', function() { fetchRates(); });

    // Lazy init when calc tab is opened (in index.html)
    $(document).on('click', '.nav-tab[data-page="calc"]', function() {
        if (!calcInited) {
            calcInited = true;
            detectLocation();
            fetchRates();
        }
    });

    // Auto init when loaded as standalone page (calc.html)
    if ($('#pageCalc').length === 0 && $('#screenExpr').length > 0) {
        calcInited = true;
        detectLocation();
        fetchRates();
    }
});
