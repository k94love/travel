$(function () {

    /* =====================================================
       API Keys (injected by Firebase module in HTML)
    ===================================================== */
    var GEMINI_KEY = null;
    var MAPS_KEY   = null;

    window.__setGeminiKey = function (key) {
        GEMINI_KEY = key;
        updateSearchBtn();
    };
    window.__setMapsKey = function (key) {
        MAPS_KEY = key;
    };

    // Handle case where module script ran before jQuery ready
    if (window.__pendingGeminiKey) { GEMINI_KEY = window.__pendingGeminiKey; delete window.__pendingGeminiKey; }
    if (window.__pendingMapsKey)   { MAPS_KEY   = window.__pendingMapsKey;   delete window.__pendingMapsKey; }

    /* =====================================================
       State
    ===================================================== */
    var currentLat    = null;
    var currentLng    = null;
    var currentFilter = 'all';    // all | food | spot | cafe | shop
    var currentRadius = 500;      // metres
    var GEMINI_MODEL  = 'gemini-2.5-flash';

    /* =====================================================
       Filter buttons
    ===================================================== */
    $(document).on('click', '.nb-filter-btn', function () {
        currentFilter = $(this).data('type');
        $('.nb-filter-btn').removeClass('active');
        $(this).addClass('active');
    });

    /* =====================================================
       Radius buttons
    ===================================================== */
    $(document).on('click', '.nb-radius-btn', function () {
        currentRadius = parseInt($(this).data('radius'), 10);
        $('.nb-radius-btn').removeClass('active');
        $(this).addClass('active');
    });

    /* =====================================================
       GPS
    ===================================================== */
    $('#gpsBtn').on('click', function () {
        if (!navigator.geolocation) {
            showLocError('您的裝置不支援定位功能');
            return;
        }
        setLocState('loading');
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                currentLat = pos.coords.latitude;
                currentLng = pos.coords.longitude;
                setLocState('ok');
                reverseGeocode(currentLat, currentLng);
                updateSearchBtn();
            },
            function (err) {
                var msg = '無法取得位置';
                if (err.code === 1) msg = '請允許位置存取權限';
                if (err.code === 2) msg = '定位失敗，請確認 GPS 已開啟';
                if (err.code === 3) msg = '定位超時，請重試';
                showLocError(msg);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    });

    function setLocState(state) {
        var dot = $('#locationCard .nb-loc-dot');
        dot.removeClass('ok loading error').addClass(state);
        if (state === 'loading') {
            $('#gpsBtnText').text('定位中...');
            $('#gpsBtnIcon').text('⏳');
            $('#gpsBtn').prop('disabled', true);
            $('#locText').text('取得位置中...');
        } else if (state === 'ok') {
            $('#gpsBtnText').text('重新定位');
            $('#gpsBtnIcon').text('✓');
            $('#gpsBtn').prop('disabled', false);
        }
    }

    function showLocError(msg) {
        setLocState('error');
        $('#locText').text(msg);
        $('#gpsBtnText').text('重試');
        $('#gpsBtnIcon').text('📡');
        $('#gpsBtn').prop('disabled', false);
        updateSearchBtn();
    }

    /* =====================================================
       Reverse geocode (no Maps key needed — use nominatim)
    ===================================================== */
    function reverseGeocode(lat, lng) {
        var url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' +
                  lat + '&lon=' + lng + '&accept-language=zh-TW';
        fetch(url, { headers: { 'Accept-Language': 'zh-TW' } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var addr = d.display_name || ('緯度 ' + lat.toFixed(4) + '，經度 ' + lng.toFixed(4));
                $('#locText').text(addr);
            })
            .catch(function () {
                $('#locText').text('緯度 ' + lat.toFixed(4) + '，經度 ' + lng.toFixed(4));
            });
    }

    /* =====================================================
       Update search button state
    ===================================================== */
    function updateSearchBtn() {
        var ready = currentLat !== null && currentLng !== null && GEMINI_KEY;
        $('#searchBtn').prop('disabled', !ready);
        if (!ready && currentLat !== null && !GEMINI_KEY) {
            $('#searchBtnText').text('等待 API 金鑰...');
        } else if (ready) {
            $('#searchBtnText').text('搜尋附近推薦');
        }
    }

    /* =====================================================
       Main Search
    ===================================================== */
    $('#searchBtn').on('click', async function () {
        if (!currentLat || !currentLng || !GEMINI_KEY) return;

        showMask('正在搜尋附近地點...');
        $('#searchBtn').prop('disabled', true);
        $('#resultArea').hide();
        $('#loadingArea').show();

        try {
            var places = [];

            // ── Step 1: Try Google Maps Places API (New) if key available ──
            if (MAPS_KEY) {
                setMaskSub('透過 Google Maps 抓取附近資訊...');
                try {
                    places = await fetchNearbyPlaces(currentLat, currentLng, currentRadius, currentFilter);
                } catch (e) {
                    console.warn('Places API failed, falling back to AI:', e);
                }
            }

            // ── Step 2: Gemini AI recommendation ──
            setMaskSub('AI 分析推薦中...');
            var aiResult = await callGemini(currentLat, currentLng, currentRadius, currentFilter, places);
            renderResults(aiResult, places);

            // Save token usage
            if (aiResult._usage && typeof window.__saveTokenUsage === 'function') {
                window.__saveTokenUsage(aiResult._usage, GEMINI_MODEL).catch(function () {});
            }

        } catch (err) {
            renderError(err.message || '搜尋失敗，請重試');
        } finally {
            hideMask();
            $('#loadingArea').hide();
            $('#searchBtn').prop('disabled', false);
            updateSearchBtn();
        }
    });

    /* =====================================================
       Google Maps Places API (New)
    ===================================================== */
    var TYPE_MAP = {
        all:  ['restaurant', 'tourist_attraction', 'cafe', 'shopping_mall', 'food'],
        food: ['restaurant', 'food', 'meal_takeaway', 'bakery'],
        spot: ['tourist_attraction', 'amusement_park', 'museum', 'park', 'shrine', 'temple'],
        cafe: ['cafe', 'bakery'],
        shop: ['shopping_mall', 'store', 'department_store', 'clothing_store']
    };

    async function fetchNearbyPlaces(lat, lng, radius, filter) {
        var types = TYPE_MAP[filter] || TYPE_MAP['all'];
        var body = {
            includedTypes: types,
            maxResultCount: 10,
            locationRestriction: {
                circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: radius
                }
            },
            rankPreference: 'POPULARITY',
            languageCode: 'zh-TW'
        };

        var fields = [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.rating',
            'places.userRatingCount',
            'places.reviews',
            'places.types',
            'places.googleMapsUri',
            'places.priceLevel',
            'places.editorialSummary',
            'places.primaryType'
        ].join(',');

        var res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': MAPS_KEY,
                'X-Goog-FieldMask': fields
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) throw new Error('Places API error ' + res.status);
        var data = await res.json();
        return (data.places || []).map(normalisePlaceV1);
    }

    function normalisePlaceV1(p) {
        var reviews = (p.reviews || []).slice(0, 3).map(function (r) {
            return {
                author: (r.authorAttribution && r.authorAttribution.displayName) || '匿名用戶',
                rating: r.rating || 0,
                text:   (r.text && r.text.text) || '',
                time:   r.relativePublishTimeDescription || ''
            };
        });
        return {
            name:       (p.displayName && p.displayName.text) || '',
            address:    p.formattedAddress || '',
            rating:     p.rating || null,
            ratingCount: p.userRatingCount || 0,
            mapsUrl:    p.googleMapsUri || '',
            reviews:    reviews,
            types:      p.types || [],
            primaryType: p.primaryType || '',
            priceLevel: p.priceLevel || null,
            summary:    (p.editorialSummary && p.editorialSummary.text) || '',
            source:     'gmap'
        };
    }

    /* =====================================================
       Gemini AI Call
    ===================================================== */
    function buildPrompt(lat, lng, radius, filter, gmapPlaces) {
        var filterLabel = { all: '美食與景點', food: '美食餐廳', spot: '景點', cafe: '咖啡廳', shop: '購物' }[filter] || '美食與景點';

        var gmapContext = '';
        if (gmapPlaces && gmapPlaces.length > 0) {
            gmapContext = '\n\n以下是從 Google Maps 抓取到的附近地點資料，請根據這些資料提供推薦：\n';
            gmapPlaces.forEach(function (p, i) {
                gmapContext += '\n[' + (i + 1) + '] ' + p.name;
                if (p.rating)   gmapContext += '（評分 ' + p.rating + '/5，' + p.ratingCount + ' 則評價）';
                if (p.address)  gmapContext += '\n    地址：' + p.address;
                if (p.summary)  gmapContext += '\n    簡介：' + p.summary;
            });
        } else {
            gmapContext = '\n\n（未取得 Google Maps 資料，請根據您對此區域的知識提供推薦，並給出您認為合理的評分估計）';
        }

        return [
            '你是一位熟悉日本旅遊的在地嚮導。',
            '使用者目前位於座標：緯度 ' + lat.toFixed(6) + '，經度 ' + lng.toFixed(6) + '，搜尋範圍 ' + radius + ' 公尺內。',
            '請推薦最值得前往的「' + filterLabel + '」，提供 5 至 8 個地點。',
            gmapContext,
            '',
            '請依照以下格式輸出，每個地點用 === 分隔：',
            '',
            '名稱：[地點名稱（中文或原文均可）]',
            '類型：[美食/咖啡廳/景點/購物/其他]',
            '評分：[X.X（若有 Google Maps 資料請使用實際評分；否則填入您的估計，範圍 3.5~5.0）]',
            '評價數：[數字（若有實際資料請填入，否則填 0）]',
            '距離：[約 XXX 公尺（根據座標估算）]',
            '推薦理由：[2~3 句話說明為何推薦，包含特色或必試項目]',
            '地址：[地址（若知道）]',
            '地圖連結：[Google Maps 搜尋連結，格式：https://www.google.com/maps/search/?api=1&query=地點名稱+地址]',
            '',
            '注意：',
            '- 只輸出格式內容，不要有任何前言或後記',
            '- 若使用 Google Maps 資料，評分必須使用實際資料',
            '- 地圖連結必須是可正常開啟的 Google Maps 搜尋連結',
            '- 請用繁體中文回覆'
        ].join('\n');
    }

    async function callGemini(lat, lng, radius, filter, gmapPlaces) {
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                  GEMINI_MODEL + ':generateContent?key=' + GEMINI_KEY;
        var prompt = buildPrompt(lat, lng, radius, filter, gmapPlaces);

        var res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
            })
        });

        var data = await res.json();
        if (!res.ok) throw new Error(data.error && data.error.message ? data.error.message : 'Gemini API 錯誤');

        var text = data.candidates &&
                   data.candidates[0] &&
                   data.candidates[0].content &&
                   data.candidates[0].content.parts &&
                   data.candidates[0].content.parts[0].text;

        if (!text) throw new Error('AI 回傳格式異常');

        var parsed = parseAiPlaces(text.trim());
        parsed._usage = data.usageMetadata || null;
        return parsed;
    }

    /* =====================================================
       Parse AI response
    ===================================================== */
    function parseAiPlaces(text) {
        var blocks = text.split(/\n===+\n?/).map(function (b) { return b.trim(); }).filter(Boolean);
        var places = [];
        blocks.forEach(function (block) {
            var p = {};
            block.split('\n').forEach(function (line) {
                var m;
                if ((m = line.match(/^名稱：(.+)/)))      p.name      = m[1].trim();
                if ((m = line.match(/^類型：(.+)/)))      p.typeLabel = m[1].trim();
                if ((m = line.match(/^評分：(.+)/)))      p.rating    = parseFloat(m[1]) || null;
                if ((m = line.match(/^評價數：(.+)/)))    p.ratingCount = parseInt(m[1], 10) || 0;
                if ((m = line.match(/^距離：(.+)/)))      p.distance  = m[1].trim();
                if ((m = line.match(/^推薦理由：(.+)/)))  p.desc      = m[1].trim();
                if ((m = line.match(/^地址：(.+)/)))      p.address   = m[1].trim();
                if ((m = line.match(/^地圖連結：(.+)/)))  p.mapsUrl   = m[1].trim();
            });
            if (p.name) places.push(p);
        });
        return places;
    }

    /* =====================================================
       Render
    ===================================================== */
    function renderResults(aiPlaces, gmapPlaces) {
        // Merge GMAP reviews into AI places by name matching
        if (gmapPlaces && gmapPlaces.length > 0) {
            aiPlaces.forEach(function (ap) {
                if (!ap.name) return;
                var match = gmapPlaces.find(function (gp) {
                    return gp.name && normaliseStr(gp.name).includes(normaliseStr(ap.name).slice(0, 4));
                });
                if (match) {
                    if (!ap.rating && match.rating) ap.rating = match.rating;
                    if (!ap.mapsUrl && match.mapsUrl) ap.mapsUrl = match.mapsUrl;
                    if (!ap.address && match.address) ap.address = match.address;
                    ap.gmapReviews = match.reviews;
                    ap.ratingCount = match.ratingCount || ap.ratingCount;
                    ap.ratingSource = 'Google Maps';
                }
            });
        }

        var places = aiPlaces.filter(function (p) { return p.name; });
        if (places.length === 0) { renderError('未找到附近推薦，請調整篩選條件後重試'); return; }

        var html = '';
        places.forEach(function (p, i) {
            html += buildCard(p, i + 1);
        });

        $('#resultList').html(html);
        $('#resultCount').text(places.length + ' 個地點');
        $('#resultArea').show();
        $('html, body').animate({ scrollTop: $('#resultArea').offset().top - 20 }, 400);
    }

    function buildCard(p, rank) {
        var rankClass = rank <= 3 ? 'r' + rank : 'rn';
        var rankText  = rank <= 3 ? rank : rank;

        var typeCls = 'default';
        var tl = (p.typeLabel || '').toLowerCase();
        if (tl.includes('美食') || tl.includes('餐')) typeCls = 'food';
        else if (tl.includes('景') || tl.includes('公園') || tl.includes('神')) typeCls = 'spot';
        else if (tl.includes('咖啡')) typeCls = 'cafe';
        else if (tl.includes('購物') || tl.includes('商')) typeCls = 'shop';

        var html = '<div class="nb-card" data-rank="' + rank + '">';

        // Top section
        html += '<div class="nb-card-top">';

        // Row 1: rank + name + type badge
        html += '<div class="nb-card-row1">';
        html += '<span class="nb-rank ' + rankClass + '">' + rankText + '</span>';
        html += '<div class="nb-card-name">' + escHtml(p.name) + '</div>';
        html += '<span class="nb-card-type-badge ' + typeCls + '">' + escHtml(p.typeLabel || '推薦') + '</span>';
        html += '</div>';

        // Rating row
        html += '<div class="nb-rating-row">';
        if (p.rating) {
            html += renderStars(p.rating);
            html += '<span class="nb-rating-num">' + p.rating.toFixed(1) + '</span>';
            if (p.ratingCount > 0) {
                html += '<span class="nb-rating-count">(' + formatCount(p.ratingCount) + ' 則評價)</span>';
            }
            if (p.ratingSource) {
                html += '<span class="nb-rating-source">● Google Maps</span>';
            } else {
                html += '<span class="nb-rating-source">AI 估計</span>';
            }
        } else {
            html += '<span class="nb-rating-count">暫無評分資料</span>';
        }
        html += '</div>';

        // Distance
        if (p.distance) {
            html += '<div style="font-size:0.72em;color:var(--text-light);margin-bottom:8px;">📏 ' + escHtml(p.distance) + '</div>';
        }

        // AI desc
        if (p.desc) {
            html += '<div class="nb-card-desc">' + escHtml(p.desc) + '</div>';
        }

        // Address
        if (p.address && p.address !== '（若知道）') {
            html += '<div class="nb-card-addr"><span class="nb-card-addr-icon">📍</span><span>' + escHtml(p.address) + '</span></div>';
        }

        html += '</div>'; // end nb-card-top

        // Actions
        html += '<div class="nb-card-actions">';
        var mapsUrl = buildMapsUrl(p);
        html += '<a class="nb-action-btn maps" href="' + escHtml(mapsUrl) + '" target="_blank" rel="noopener">🗺️ 開啟地圖</a>';

        if (p.gmapReviews && p.gmapReviews.length > 0) {
            html += '<button class="nb-action-btn reviews" data-rank="' + rank + '">💬 看評價 (' + p.gmapReviews.length + ')</button>';
        } else {
            html += '<button class="nb-action-btn reviews" data-rank="' + rank + '">💬 AI 評價摘要</button>';
        }
        html += '</div>';

        // Reviews section (hidden by default)
        html += '<div class="nb-reviews" id="reviews-' + rank + '">';
        if (p.gmapReviews && p.gmapReviews.length > 0) {
            html += '<div class="nb-reviews-title">Google Maps 評價（前 ' + p.gmapReviews.length + ' 則）</div>';
            p.gmapReviews.forEach(function (r) {
                html += buildReviewItem(r);
            });
        } else {
            // Will load AI-generated review summary on demand
            html += '<div class="nb-reviews-title">評價摘要</div>';
            html += '<div class="nb-review-loading" id="review-loading-' + rank + '">載入中...</div>';
        }
        html += '</div>';

        html += '</div>'; // end nb-card
        return html;
    }

    function buildReviewItem(r) {
        var html = '<div class="nb-review-item">';
        html += '<div class="nb-review-top">';
        html += '<span class="nb-review-author">' + escHtml(r.author) + '</span>';
        html += '<span class="nb-review-stars">' + renderMiniStars(r.rating) + '</span>';
        if (r.time) html += '<span class="nb-review-time">' + escHtml(r.time) + '</span>';
        html += '</div>';
        if (r.text) html += '<div class="nb-review-text">' + escHtml(r.text) + '</div>';
        html += '</div>';
        return html;
    }

    /* =====================================================
       Toggle reviews
    ===================================================== */
    $(document).on('click', '.nb-action-btn.reviews', async function () {
        var rank = $(this).data('rank');
        var $section = $('#reviews-' + rank);

        $section.toggleClass('open');
        if (!$section.hasClass('open')) return;

        // If it has a loading placeholder → fetch AI summary
        var $loading = $('#review-loading-' + rank);
        if ($loading.length === 0) return;

        // Get place name from card
        var $card = $(this).closest('.nb-card');
        var placeName = $card.find('.nb-card-name').text();

        try {
            var summary = await fetchAiReviewSummary(placeName);
            $loading.replaceWith('<div class="nb-review-text" style="padding:4px 0;">' + escHtml(summary) + '</div>');
        } catch (e) {
            $loading.replaceWith('<div class="nb-no-reviews">無法取得評價摘要</div>');
        }
    });

    async function fetchAiReviewSummary(placeName) {
        if (!GEMINI_KEY) throw new Error('no key');
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=' + GEMINI_KEY;
        var res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: '請用繁體中文，3句話內幫我摘要「' + placeName + '」這個日本地點的旅客評價口碑重點，包含評價優缺點。只輸出摘要內容，不要有前言。'
                    }]
                }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 256 }
            })
        });
        var data = await res.json();
        if (!res.ok) throw new Error('AI error');
        return data.candidates[0].content.parts[0].text.trim();
    }

    /* =====================================================
       Helpers
    ===================================================== */
    function renderStars(rating) {
        var full  = Math.floor(rating);
        var half  = (rating - full) >= 0.3 ? 1 : 0;
        var empty = 5 - full - half;
        var html  = '<span class="nb-stars">';
        for (var i = 0; i < full;  i++) html += '<span class="nb-star">★</span>';
        if (half)                        html += '<span class="nb-star" style="opacity:0.55">★</span>';
        for (var j = 0; j < empty; j++) html += '<span class="nb-star" style="opacity:0.2">★</span>';
        html += '</span>';
        return html;
    }

    function renderMiniStars(rating) {
        var html = '';
        for (var i = 1; i <= 5; i++) {
            html += '<span class="nb-review-star" style="color:' + (i <= rating ? '#f57c00' : '#ddd') + '">★</span>';
        }
        return html;
    }

    function buildMapsUrl(p) {
        if (p.mapsUrl && p.mapsUrl.startsWith('https://')) return p.mapsUrl;
        var q = encodeURIComponent((p.name || '') + (p.address ? ' ' + p.address : ''));
        return 'https://www.google.com/maps/search/?api=1&query=' + q;
    }

    function formatCount(n) {
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return n.toString();
    }

    function normaliseStr(s) {
        return (s || '').toLowerCase().replace(/\s/g, '');
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderError(msg) {
        $('#resultList').html('<div class="nb-error">' + escHtml(msg) + '</div>');
        $('#resultCount').text('');
        $('#resultArea').show();
    }

    /* =====================================================
       Mask helpers
    ===================================================== */
    function showMask(sub) {
        $('#maskSubText').text(sub || '');
        $('#searchingMask').addClass('active');
    }
    function hideMask() {
        $('#searchingMask').removeClass('active');
    }
    function setMaskSub(text) {
        $('#maskSubText').text(text);
    }

    /* =====================================================
       Init
    ===================================================== */
    updateSearchBtn();
});
