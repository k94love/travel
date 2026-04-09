$(function() {
    var MODEL_LIMITS = {
        'gemini-3.1-flash-lite-preview': { name: 'Flash Lite 3.1', rpm: 15, tpm: 250000, rpd: 500 },
        'gemini-2.5-flash':              { name: 'Flash 2.5',      rpm: 5,  tpm: 250000, rpd: 20  }
    };

    var currentModel = 'gemini-3.1-flash-lite-preview';
    var allRecords   = [];
    var loadFnRef    = null;

    // ---- Bridge ----
    window.__usageInit = function(loadFn) {
        loadFnRef = loadFn;
        loadUsage();
    };
    if (window.__usageInitData) {
        window.__usageInit(window.__usageInitData);
        delete window.__usageInitData;
    }

    // ---- Model tab switch ----
    $(document).on('click', '.us-model-btn', function() {
        var model = $(this).data('model');
        if (!MODEL_LIMITS[model]) return;
        currentModel = model;
        $('.us-model-btn').removeClass('active');
        $(this).addClass('active');
        renderAll();
    });

    // ---- Refresh ----
    $('#refreshBtn').on('click', function() {
        $(this).css('transform', 'rotate(180deg)');
        var self = this;
        loadUsage().then(function() {
            setTimeout(function() { $(self).css('transform', ''); }, 300);
        });
    });

    // ---- Load ----
    async function loadUsage() {
        if (!loadFnRef) return;
        $('#loadingState').show();
        try {
            allRecords = await loadFnRef();
            renderAll();
        } catch(e) {
            console.warn('Failed to load usage:', e);
        } finally {
            $('#loadingState').hide();
        }
    }

    // ---- Render all ----
    function renderAll() {
        var limits      = MODEL_LIMITS[currentModel];
        var now         = Date.now();
        var todayStart  = new Date(); todayStart.setHours(0, 0, 0, 0);
        var minuteAgo   = now - 60000;

        var modelRecs   = allRecords.filter(function(r) { return r.model === currentModel; });
        var todayRecs   = modelRecs.filter(function(r)  { return r.ts >= todayStart.getTime(); });
        var minuteRecs  = modelRecs.filter(function(r)  { return r.ts >= minuteAgo; });

        var todayRPD    = todayRecs.length;
        var minuteRPM   = minuteRecs.length;
        var todayTokens = todayRecs.reduce(function(s, r) { return s + (r.totalTokens || 0); }, 0);
        var todayIn     = todayRecs.reduce(function(s, r) { return s + (r.inputTokens  || 0); }, 0);
        var todayOut    = todayRecs.reduce(function(s, r) { return s + (r.outputTokens || 0); }, 0);

        renderGauge('rpd', todayRPD,   limits.rpd, '今日請求 (RPD)');
        renderGauge('rpm', minuteRPM,  limits.rpm, '近1分鐘 (RPM)');
        renderTokenBox(todayTokens, todayIn, todayOut);
        renderLimitChips(limits);
        renderChart(modelRecs, limits);
        renderRecent(modelRecs);
    }

    // ---- Gauge ----
    function renderGauge(id, value, limit, label) {
        var pct   = limit > 0 ? Math.min(100, (value / limit) * 100) : 0;
        var color = statusColor(pct);
        var cls   = statusClass(pct);
        var txt   = statusText(pct);

        $('#' + id + 'Label').text(label);
        $('#' + id + 'Bar').css({ width: Math.max(pct, pct > 0 ? 3 : 0) + '%', background: color });
        $('#' + id + 'Nums').html(value + ' <span class="us-gauge-limit">/ ' + limit + '</span>');
        $('#' + id + 'Status').text(txt).attr('class', 'us-status ' + cls);
    }

    // ---- Token summary ----
    function renderTokenBox(total, inputTok, outputTok) {
        $('#todayTokens').text(total.toLocaleString());
        $('#todayTokenSub').text('↑ ' + inputTok.toLocaleString() + '  ↓ ' + outputTok.toLocaleString());
    }

    // ---- Limit chips ----
    function renderLimitChips(limits) {
        $('#limitChips').html(
            '<span class="us-limit-chip">RPD <strong>' + limits.rpd + '</strong></span>' +
            '<span class="us-limit-chip">RPM <strong>' + limits.rpm + '</strong></span>' +
            '<span class="us-limit-chip">TPM <strong>' + (limits.tpm / 1000).toFixed(0) + 'K</strong></span>'
        );
    }

    // ---- 7-day Bar Chart ----
    function renderChart(modelRecs, limits) {
        var days = [];
        for (var i = 6; i >= 0; i--) {
            var d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            var dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
            var ts0 = d.getTime(), ts1 = dEnd.getTime();
            var dayRecs = modelRecs.filter(function(r) { return r.ts >= ts0 && r.ts <= ts1; });
            days.push({
                label:  (d.getMonth() + 1) + '/' + d.getDate(),
                count:  dayRecs.length,
                tokens: dayRecs.reduce(function(s, r) { return s + (r.totalTokens || 0); }, 0)
            });
        }

        var maxCount = Math.max(1, Math.max.apply(null, days.map(function(d) { return d.count; })));

        var html = '';
        days.forEach(function(day) {
            var rpdPct    = limits.rpd > 0 ? (day.count / limits.rpd) * 100 : 0;
            var heightPct = (day.count / maxCount) * 100;
            var color     = statusColor(rpdPct);

            html += '<div class="us-chart-col">';
            html +=   '<div class="us-bar-wrap">';
            if (day.count > 0) {
                html += '<div class="us-bar" style="height:' + heightPct + '%;background:' + color + '">';
                if (heightPct > 20) {
                    html += '<span class="us-bar-val">' + day.count + '</span>';
                }
                html += '</div>';
            }
            html +=   '</div>';
            html +=   '<div class="us-bar-label">' + day.label + '</div>';
            html += '</div>';
        });

        $('#chartArea').html(html);

        // Legend: today's pct
        var todayPct = limits.rpd > 0 ? Math.round((days[6].count / limits.rpd) * 100) : 0;
        $('#chartSub').text('今日已用 ' + todayPct + '% 每日上限');
    }

    // ---- Recent calls ----
    function renderRecent(modelRecs) {
        var sorted = modelRecs.slice().sort(function(a, b) { return b.ts - a.ts; });
        if (!sorted.length) {
            $('#recentList').html('<div class="us-empty">尚無翻譯記錄</div>');
            return;
        }
        var html = '';
        sorted.slice(0, 15).forEach(function(rec) {
            var d = new Date(rec.ts);
            var timeStr = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                          pad(d.getHours()) + ':' + pad(d.getMinutes());
            html += '<div class="us-recent-item">';
            html +=   '<div class="us-recent-time">' + timeStr + '</div>';
            html +=   '<div class="us-recent-tokens">';
            html +=     '<span class="us-tok-in">↑' + (rec.inputTokens  || 0).toLocaleString() + '</span>';
            html +=     '<span class="us-tok-out">↓' + (rec.outputTokens || 0).toLocaleString() + '</span>';
            html +=     '<span class="us-tok-total">' + (rec.totalTokens || 0).toLocaleString() + ' tok</span>';
            html +=   '</div>';
            html += '</div>';
        });
        $('#recentList').html(html);
    }

    // ---- Helpers ----
    function statusColor(pct) {
        return pct >= 90 ? '#e53935' : pct >= 70 ? '#fb8c00' : '#FF6B6B';
    }
    function statusClass(pct) {
        return 'us-status-' + (pct >= 90 ? 'red' : pct >= 70 ? 'orange' : 'green');
    }
    function statusText(pct) {
        return pct >= 90 ? '⚠️ 接近上限' : pct >= 70 ? '⚡ 注意用量' : '✅ 正常';
    }
    function pad(n) { return String(n).padStart(2, '0'); }
});
