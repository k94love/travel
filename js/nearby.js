$(function () {

    /* =====================================================
       API Keys (injected by Firebase module in HTML)
    ===================================================== */
    var MAPS_KEY = null;

    window.__setMapsKey = function (key) {
        MAPS_KEY = key;
        updateSearchBtn();
    };
    if (window.__pendingMapsKey) {
        MAPS_KEY = window.__pendingMapsKey;
        delete window.__pendingMapsKey;
    }

    /* =====================================================
       State
    ===================================================== */
    var currentLat    = null;
    var currentLng    = null;
    var currentFilter = 'all';
    var currentRadius = 500;

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
       Reverse geocode via Nominatim (free, no key needed)
    ===================================================== */
    function reverseGeocode(lat, lng) {
        fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng, {
            headers: { 'Accept-Language': 'zh-TW' }
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            $('#locText').text(d.display_name || (lat.toFixed(5) + ', ' + lng.toFixed(5)));
        })
        .catch(function () {
            $('#locText').text(lat.toFixed(5) + ', ' + lng.toFixed(5));
        });
    }

    /* =====================================================
       Search button state
    ===================================================== */
    function updateSearchBtn() {
        var ready = currentLat !== null && currentLng !== null && MAPS_KEY;
        $('#searchBtn').prop('disabled', !ready);
        if (!MAPS_KEY) {
            $('#searchBtnText').text('等待 Maps API 金鑰...');
        } else if (!ready) {
            $('#searchBtnText').text('請先取得位置');
        } else {
            $('#searchBtnText').text('搜尋附近推薦');
        }
    }

    /* =====================================================
       Main Search
    ===================================================== */
    $('#searchBtn').on('click', async function () {
        if (!currentLat || !currentLng || !MAPS_KEY) return;

        showMask('透過 Google Maps 搜尋附近地點...');
        $('#searchBtn').prop('disabled', true);
        $('#resultArea').hide();
        $('#loadingArea').show();

        try {
            var places = await fetchNearbyPlaces(currentLat, currentLng, currentRadius, currentFilter);
            renderResults(places);
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
       Google Maps Places API (New) — Nearby Search
    ===================================================== */
    var TYPE_MAP = {
        all:  ['restaurant', 'tourist_attraction', 'cafe', 'shopping_mall', 'bar', 'bakery'],
        food: ['restaurant', 'meal_takeaway', 'meal_delivery', 'bakery', 'bar'],
        spot: ['tourist_attraction', 'amusement_park', 'museum', 'park', 'shrine', 'temple', 'art_gallery'],
        cafe: ['cafe', 'bakery'],
        shop: ['shopping_mall', 'department_store', 'clothing_store', 'convenience_store', 'store']
    };

    async function fetchNearbyPlaces(lat, lng, radius, filter) {
        var types  = TYPE_MAP[filter] || TYPE_MAP['all'];
        var fields = [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.rating',
            'places.userRatingCount',
            'places.reviews',
            'places.types',
            'places.primaryType',
            'places.googleMapsUri',
            'places.priceLevel',
            'places.editorialSummary',
            'places.regularOpeningHours',
            'places.photos'
        ].join(',');

        var res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': MAPS_KEY,
                'X-Goog-FieldMask': fields
            },
            body: JSON.stringify({
                includedTypes: types,
                maxResultCount: 20,
                locationRestriction: {
                    circle: {
                        center: { latitude: lat, longitude: lng },
                        radius: radius
                    }
                },
                rankPreference: 'POPULARITY',
                languageCode: 'zh-TW'
            })
        });

        var data = await res.json();
        if (!res.ok) {
            var errMsg = (data.error && data.error.message) ? data.error.message : 'Places API 錯誤 ' + res.status;
            throw new Error(errMsg);
        }

        var places = (data.places || []);
        if (places.length === 0) throw new Error('附近沒有找到符合條件的地點，請擴大搜尋範圍或更換類別');
        return places.map(normalisePlaceV1);
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

        // Opening hours: today's status
        var openNow = null;
        if (p.regularOpeningHours) {
            openNow = p.regularOpeningHours.openNow;
        }

        return {
            name:        (p.displayName && p.displayName.text) || '未知地點',
            address:     p.formattedAddress || '',
            rating:      p.rating || null,
            ratingCount: p.userRatingCount || 0,
            mapsUrl:     p.googleMapsUri || '',
            reviews:     reviews,
            primaryType: p.primaryType || '',
            priceLevel:  p.priceLevel || null,
            summary:     (p.editorialSummary && p.editorialSummary.text) || '',
            openNow:     openNow
        };
    }

    /* =====================================================
       Render
    ===================================================== */
    function renderResults(places) {
        if (!places || places.length === 0) {
            renderError('附近沒有找到符合條件的地點');
            return;
        }

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

        // Type label & colour from primaryType
        var typeCls   = 'default';
        var typeLabel = '推薦';
        var pt = (p.primaryType || '').toLowerCase();
        if (/restaurant|meal|food|bar|bakery/.test(pt))          { typeCls = 'food'; typeLabel = '美食'; }
        else if (/cafe/.test(pt))                                  { typeCls = 'cafe'; typeLabel = '咖啡廳'; }
        else if (/tourist|museum|park|shrine|temple|art/.test(pt)){ typeCls = 'spot'; typeLabel = '景點'; }
        else if (/shop|store|mall|department/.test(pt))            { typeCls = 'shop'; typeLabel = '購物'; }

        var html = '<div class="nb-card">';

        /* ── Card top ── */
        html += '<div class="nb-card-top">';

        // Row 1: rank + name + badge
        html += '<div class="nb-card-row1">';
        html += '<span class="nb-rank ' + rankClass + '">' + rank + '</span>';
        html += '<div class="nb-card-name">' + escHtml(p.name) + '</div>';
        html += '<span class="nb-card-type-badge ' + typeCls + '">' + typeLabel + '</span>';
        html += '</div>';

        // Rating
        html += '<div class="nb-rating-row">';
        if (p.rating) {
            html += renderStars(p.rating);
            html += '<span class="nb-rating-num">' + p.rating.toFixed(1) + '</span>';
            if (p.ratingCount > 0) {
                html += '<span class="nb-rating-count">(' + formatCount(p.ratingCount) + ' 則評價)</span>';
            }
            html += '<span class="nb-rating-source">● Google Maps</span>';
        } else {
            html += '<span class="nb-rating-count">暫無評分</span>';
        }
        html += '</div>';

        // Open now badge + price level
        var extraRow = '';
        if (p.openNow !== null) {
            extraRow += p.openNow
                ? '<span class="nb-open-badge open">營業中</span>'
                : '<span class="nb-open-badge closed">已打烊</span>';
        }
        if (p.priceLevel) {
            var priceSymbols = { PRICE_LEVEL_FREE: '免費', PRICE_LEVEL_INEXPENSIVE: '¥', PRICE_LEVEL_MODERATE: '¥¥', PRICE_LEVEL_EXPENSIVE: '¥¥¥', PRICE_LEVEL_VERY_EXPENSIVE: '¥¥¥¥' };
            extraRow += '<span class="nb-price">' + (priceSymbols[p.priceLevel] || '') + '</span>';
        }
        if (extraRow) html += '<div class="nb-extra-row">' + extraRow + '</div>';

        // Editorial summary
        if (p.summary) {
            html += '<div class="nb-card-desc nb-summary">' + escHtml(p.summary) + '</div>';
        }

        // Address
        if (p.address) {
            html += '<div class="nb-card-addr"><span class="nb-card-addr-icon">📍</span><span>' + escHtml(p.address) + '</span></div>';
        }

        html += '</div>'; // end nb-card-top

        /* ── Actions ── */
        html += '<div class="nb-card-actions">';
        html += '<a class="nb-action-btn maps" href="' + escHtml(p.mapsUrl || buildSearchUrl(p)) + '" target="_blank" rel="noopener">🗺️ 開啟地圖</a>';
        if (p.reviews && p.reviews.length > 0) {
            html += '<button class="nb-action-btn reviews nb-reviews-toggle" data-rank="' + rank + '">💬 評價 (' + p.reviews.length + ')</button>';
        }
        html += '</div>';

        /* ── Reviews (hidden) ── */
        if (p.reviews && p.reviews.length > 0) {
            html += '<div class="nb-reviews" id="reviews-' + rank + '">';
            html += '<div class="nb-reviews-title">Google Maps 評價（前 ' + p.reviews.length + ' 則）</div>';
            p.reviews.forEach(function (r) {
                html += buildReviewItem(r);
            });
            html += '</div>';
        }

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
    $(document).on('click', '.nb-reviews-toggle', function () {
        var rank     = $(this).data('rank');
        var $section = $('#reviews-' + rank);
        $section.toggleClass('open');
        $(this).text($section.hasClass('open') ? '💬 收起評價' : '💬 評價 (' + $section.find('.nb-review-item').length + ')');
    });

    /* =====================================================
       Helpers
    ===================================================== */
    function renderStars(rating) {
        var full  = Math.floor(rating);
        var half  = (rating - full) >= 0.3 ? 1 : 0;
        var empty = 5 - full - half;
        var html  = '<span class="nb-stars">';
        for (var i = 0; i < full;  i++) html += '<span class="nb-star" style="color:#f57c00">★</span>';
        if (half)                        html += '<span class="nb-star" style="color:#f57c00;opacity:0.5">★</span>';
        for (var j = 0; j < empty; j++) html += '<span class="nb-star" style="color:#ddd">★</span>';
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

    function buildSearchUrl(p) {
        return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + ' ' + p.address);
    }

    function formatCount(n) {
        if (n >= 10000) return Math.floor(n / 1000) + 'k';
        if (n >= 1000)  return (n / 1000).toFixed(1) + 'k';
        return n.toString();
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
       Mask
    ===================================================== */
    function showMask(sub) {
        $('#maskSubText').text(sub || '');
        $('#searchingMask').addClass('active');
    }
    function hideMask() {
        $('#searchingMask').removeClass('active');
    }

    /* =====================================================
       Init
    ===================================================== */
    updateSearchBtn();
});
