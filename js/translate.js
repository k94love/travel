$(function() {
    var API_KEY = null;

    var MODELS = {
        'gemini-3.1-flash-lite-preview': 'Flash Lite（快）',
        'gemini-2.5-flash':              'Flash 2.5（強）'
    };
    var currentModel = 'gemini-3.1-flash-lite-preview';

    function buildApiUrl(key, model) {
        return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key;
    }

    // Bridge: called by Firebase module once key is loaded from Firestore
    window.__setGeminiKey = function(key) {
        API_KEY = key;
        // Enable translate button if image is already selected
        if (currentBase64) $('#translateBtn').prop('disabled', false);
    };

    var PROMPT = [
        '請分析這張日文菜單圖片，逐一翻譯每道菜色成繁體中文。',
        '請依照以下格式，每道菜佔一個區塊，區塊之間用 --- 分隔：',
        '',
        '日文：[原文名稱]',
        '中文：[繁體中文翻譯]',
        '價格：[價格數字含日圓符號，若無則不輸出此行]',
        '說明：[25字以內的口語簡介，若無法推測則不輸出此行]',
        '',
        '若圖片非菜單或無法辨識，請回覆「無法辨識菜單，請重新拍攝清晰的菜單照片」。',
        '請直接輸出翻譯結果，不要加任何前言說明。'
    ].join('\n');

    var currentBase64 = null;
    var currentMime = 'image/jpeg';

    // ---- DB bridge (injected by Firebase module script) ----
    var _dbSave = null, _dbLoad = null, _dbDelete = null;

    window.__historyInit = function(saveFn, loadFn, deleteFn) {
        _dbSave = saveFn;
        _dbLoad = loadFn;
        _dbDelete = deleteFn;
        loadHistory();
    };
    // Handle case where module script ran before jQuery ready
    if (window.__historyInitData) {
        window.__historyInit.apply(null, window.__historyInitData);
        delete window.__historyInitData;
    }

    // ---- Model selector ----
    $(document).on('click', '.tr-model-btn', function() {
        var model = $(this).data('model');
        if (!MODELS[model]) return;
        currentModel = model;
        $('.tr-model-btn').removeClass('active');
        $(this).addClass('active');
    });

    // ---- File input ----
    $('#menuFileInput').on('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        currentMime = file.type || 'image/jpeg';
        var reader = new FileReader();
        reader.onload = function(ev) {
            var dataUrl = ev.target.result;
            currentBase64 = dataUrl.split(',')[1];
            $('#previewImg').attr('src', dataUrl).show();
            $('#uploadZone').addClass('has-image');
            $('#translateBtn').prop('disabled', !API_KEY); // 等 key 載入後才開放
            $('#resultArea').hide();
        };
        reader.readAsDataURL(file);
    });

    $('#uploadZone').on('click', function(e) {
        if ($(e.target).is('#menuFileInput, #clearBtn')) return;
        $('#menuFileInput').trigger('click');
    });

    $('#clearBtn').on('click', function(e) {
        e.stopPropagation();
        currentBase64 = null;
        $('#previewImg').hide().attr('src', '');
        $('#uploadZone').removeClass('has-image');
        $('#translateBtn').prop('disabled', true);
        $('#resultArea').hide();
        $('#menuFileInput').val('');
    });

    // ---- Mask helpers ----
    function showMask() {
        $('#translatingMask').addClass('active');
        window.addEventListener('beforeunload', onBeforeUnload);
    }
    function hideMask() {
        $('#translatingMask').removeClass('active');
        window.removeEventListener('beforeunload', onBeforeUnload);
    }
    function onBeforeUnload(e) {
        e.preventDefault();
        e.returnValue = '';
    }

    // ---- Translate ----
    $('#translateBtn').on('click', async function() {
        if (!currentBase64 || !API_KEY) return;
        $('#translateBtn').prop('disabled', true).text('翻譯中...');
        $('#resultArea').hide();
        $('#loadingArea').show();
        showMask();

        var apiUrl = buildApiUrl(API_KEY, currentModel);

        try {
            var res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: PROMPT },
                            { inline_data: { mime_type: currentMime, data: currentBase64 } }
                        ]
                    }],
                    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
                })
            });

            var data = await res.json();
            if (!res.ok) throw new Error(data.error && data.error.message ? data.error.message : 'API 錯誤');

            var text = data.candidates &&
                       data.candidates[0] &&
                       data.candidates[0].content &&
                       data.candidates[0].content.parts &&
                       data.candidates[0].content.parts[0].text;

            if (!text) throw new Error('回傳格式異常');
            renderResults(text.trim());

            // Save token usage
            if (data.usageMetadata && typeof window.__saveTokenUsage === 'function') {
                window.__saveTokenUsage(data.usageMetadata, currentModel).catch(function() {});
            }

        } catch(err) {
            renderError(err.message || '翻譯失敗，請重試');
        } finally {
            hideMask();
            $('#loadingArea').hide();
            $('#translateBtn').prop('disabled', false).text('翻譯菜單');
        }
    });

    // ---- Parse ----
    function parseItems(text) {
        var blocks = text.split(/\n---+\n?/).map(function(b) { return b.trim(); }).filter(Boolean);
        var items = [];
        blocks.forEach(function(block) {
            var lines = block.split('\n');
            var item = {};
            lines.forEach(function(line) {
                var m;
                if ((m = line.match(/^日文：(.+)/)))  item.jp    = m[1].trim();
                if ((m = line.match(/^中文：(.+)/)))  item.zh    = m[1].trim();
                if ((m = line.match(/^價格：(.+)/)))  item.price = m[1].trim();
                if ((m = line.match(/^說明：(.+)/)))  item.desc  = m[1].trim();
            });
            if (item.zh || item.jp) items.push(item);
            else if (block) items.push({ zh: block });
        });
        return items;
    }

    function renderCard(item) {
        var html = '<div class="tr-card">';
        if (item.zh)    html += '<div class="tr-zh">'    + escHtml(item.zh)    + '</div>';
        if (item.jp)    html += '<div class="tr-jp">'    + escHtml(item.jp)    + '</div>';
        if (item.price) html += '<div class="tr-price">' + escHtml(item.price) + '</div>';
        if (item.desc)  html += '<div class="tr-desc">'  + escHtml(item.desc)  + '</div>';
        html += '</div>';
        return html;
    }

    // ---- Render results ----
    function renderResults(text) {
        if (text.startsWith('無法辨識')) { renderError(text); return; }
        var items = parseItems(text);
        var html = items.map(renderCard).join('');
        $('#resultList').html(html);
        $('#resultCount').text(items.length + ' 道菜');
        $('#resultArea').show();
        // Save to Firestore
        saveToHistory(items);
    }

    function renderError(msg) {
        $('#resultList').html('<div class="tr-error">' + escHtml(msg) + '</div>');
        $('#resultArea').show();
    }

    // ---- History: Save ----
    async function saveToHistory(items) {
        if (!_dbSave) return;
        var thumb = null;
        if (currentBase64) {
            try { thumb = await generateThumbnail(currentBase64, currentMime); } catch(e) {}
        }
        try {
            await _dbSave({ items: items, thumb: thumb, count: items.length, ts: Date.now() });
            loadHistory();
        } catch(e) { console.warn('History save failed:', e); }
    }

    // ---- History: Load & Render ----
    async function loadHistory() {
        if (!_dbLoad) return;
        try {
            var records = await _dbLoad();
            renderHistory(records);
        } catch(e) { console.warn('History load failed:', e); }
    }

    function renderHistory(records) {
        if (!records || records.length === 0) {
            $('#historySection').hide();
            return;
        }
        $('#historyCount').text(records.length);
        var html = '';
        records.forEach(function(rec) {
            var d = rec.ts ? new Date(rec.ts) : null;
            var dateStr = d ? (
                (d.getMonth()+1) + '/' + d.getDate() + ' ' +
                String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0')
            ) : '—';

            html += '<div class="hi-card">';
            // Card top (always visible - clickable)
            html += '<div class="hi-card-top" data-id="' + rec.id + '">';
            if (rec.thumb) {
                html += '<img class="hi-thumb" src="data:image/jpeg;base64,' + rec.thumb + '" alt="">';
            } else {
                html += '<div class="hi-thumb hi-thumb-empty">🍜</div>';
            }
            html += '<div class="hi-meta">';
            html += '<div class="hi-date">' + escHtml(dateStr) + '</div>';
            html += '<div class="hi-item-count">' + (rec.count || 0) + ' 道菜</div>';
            html += '</div>';
            html += '<div class="hi-expand-icon">▼</div>';
            html += '<button class="hi-delete-btn" data-id="' + rec.id + '">✕</button>';
            html += '</div>';
            // Expandable items
            html += '<div class="hi-items">';
            if (rec.items && rec.items.length) {
                rec.items.forEach(function(item) { html += renderCard(item); });
            }
            html += '</div>';
            html += '</div>';
        });
        $('#historyList').html(html);
        $('#historySection').show();
    }

    // Toggle expand
    $(document).on('click', '.hi-card-top', function(e) {
        if ($(e.target).closest('.hi-delete-btn').length) return;
        var $card = $(this).closest('.hi-card');
        var $items = $card.find('.hi-items');
        var $icon = $(this).find('.hi-expand-icon');
        $items.slideToggle(200);
        $icon.toggleClass('open');
    });

    // Delete
    $(document).on('click', '.hi-delete-btn', async function(e) {
        e.stopPropagation();
        if (!_dbDelete) return;
        var id = $(this).data('id');
        var $card = $(this).closest('.hi-card');
        $card.fadeOut(200, function() {
            $card.remove();
            var remaining = $('#historyList .hi-card').length;
            if (remaining === 0) {
                $('#historySection').hide();
            } else {
                $('#historyCount').text(remaining);
            }
        });
        try { await _dbDelete(id); } catch(e) { console.warn('Delete failed:', e); }
    });

    // ---- Thumbnail ----
    function generateThumbnail(base64, mime) {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() {
                var MAX_W = 120, MAX_H = 90;
                var ratio = Math.min(MAX_W / img.width, MAX_H / img.height);
                var canvas = document.createElement('canvas');
                canvas.width  = Math.round(img.width  * ratio);
                canvas.height = Math.round(img.height * ratio);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.5).split(',')[1]);
            };
            img.onerror = reject;
            img.src = 'data:' + mime + ';base64,' + base64;
        });
    }

    function escHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
});
