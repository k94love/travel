$(function() {
    // ======== STATE ========
    var currentDay = 1;
    var totalDays = 8;
    var currentPage = 'itinerary';
    var allPageIds = ['pageChecklist'];
    for (var i = 1; i <= totalDays; i++) allPageIds.push('day' + i);

    // ======== PAGE SWITCHING ========
    function showPage(id) {
        allPageIds.forEach(function(p) {
            var el = document.getElementById(p);
            if (el) el.style.display = (p === id) ? 'block' : 'none';
        });
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function goToDay(day, skipUI) {
        if (day < 1) day = 1;
        if (day > totalDays) day = totalDays;
        currentDay = day;
        currentPage = 'itinerary';
        showPage('day' + day);
        if (!skipUI) updateUI();
    }

    function updateUI() {
        $('.nav-tab').removeClass('active');
        $('.nav-tab[data-page="' + currentPage + '"]').addClass('active');
        $('#dayStripWrap').toggle(currentPage === 'itinerary');
        updateDayStrip();
    }

    // ======== DAY STRIP PILL ========
    function updateDayStrip() {
        $('.day-chip').removeClass('active');
        var $active = $('.day-chip[data-day="' + currentDay + '"]').addClass('active');
        if ($active.length) {
            var pill = document.getElementById('dayPill');
            var chipEl = $active[0];
            pill.style.left  = chipEl.offsetLeft + 'px';
            pill.style.width = chipEl.offsetWidth + 'px';
        }
    }

    // ======== DRAGGABLE DAY STRIP ========
    var stripDragging = false;
    var stripEl = document.getElementById('dayStrip');

    function dayFromPoint(clientX) {
        var rect = stripEl.getBoundingClientRect();
        var x = clientX - rect.left;
        var chips = stripEl.querySelectorAll('.day-chip');
        for (var i = chips.length - 1; i >= 0; i--) {
            if (x >= chips[i].offsetLeft) return parseInt(chips[i].dataset.day);
        }
        return 1;
    }

    stripEl.addEventListener('touchstart', function(e) {
        stripDragging = true;
        var day = dayFromPoint(e.touches[0].clientX);
        if (day !== currentDay) { currentDay = day; showPage('day' + day); updateUI(); }
    }, { passive: true });

    stripEl.addEventListener('touchmove', function(e) {
        if (!stripDragging) return;
        var day = dayFromPoint(e.touches[0].clientX);
        if (day !== currentDay) { currentDay = day; showPage('day' + day); updateUI(); }
    }, { passive: true });

    stripEl.addEventListener('touchend', function() { stripDragging = false; });

    var mouseDown = false;
    stripEl.addEventListener('mousedown', function(e) {
        mouseDown = true;
        var day = dayFromPoint(e.clientX);
        if (day !== currentDay) { currentDay = day; showPage('day' + day); updateUI(); }
    });
    document.addEventListener('mousemove', function(e) {
        if (!mouseDown) return;
        var day = dayFromPoint(e.clientX);
        if (day !== currentDay) { currentDay = day; showPage('day' + day); updateUI(); }
    });
    document.addEventListener('mouseup', function() { mouseDown = false; });

    // ======== NAV TABS ========
    $(document).on('click', '.nav-tab', function() {
        var page = $(this).data('page');
        currentPage = page;
        if (page === 'checklist') { showPage('pageChecklist'); }
        else                       { showPage('day' + currentDay); }
        updateUI();
    });

    // ======== SWIPE ON CONTENT ========
    var touchStartX = 0, touchStartY = 0, contentSwiping = false;
    document.addEventListener('touchstart', function(e) {
        if ($(e.target).closest('.bottom-nav, .day-strip').length) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        contentSwiping = true;
    }, { passive: true });
    document.addEventListener('touchend', function(e) {
        if (!contentSwiping) return;
        contentSwiping = false;
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        if (currentPage === 'itinerary' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            goToDay(dx < 0 ? currentDay + 1 : currentDay - 1);
        }
    }, { passive: true });

    // ======== NOTES TOGGLE ========
    $(document).on('click', '.note-toggle', function() {
        var target = $(this).data('target');
        $(this).toggleClass('open');
        $('#' + target).slideToggle(250);
    });

    // ======== SCROLL TO TOP ========
    var $scrollBtn = $('#scrollTopBtn');
    $(window).on('scroll', function() {
        $scrollBtn.css('display', $(this).scrollTop() > 300 ? 'flex' : 'none');
    });
    $scrollBtn.on('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });

    // ======== CHECKLIST ========
    var _dbSave = null, _dbLoad = null;

    window.__checklistInit = function(saveFn, loadFn) {
        _dbSave = saveFn;
        _dbLoad = loadFn;
        loadChecklist();
    };
    if (window.__checklistInitData) {
        window.__checklistInit.apply(null, window.__checklistInitData);
        delete window.__checklistInitData;
    }

    async function loadChecklist() {
        var checked = {};
        if (_dbLoad) {
            try { checked = await _dbLoad(); } catch(e) { console.warn('Checklist load failed:', e); }
        }
        $('#checklistArea input[type="checkbox"]').each(function() {
            if (checked[$(this).data('id')]) {
                $(this).prop('checked', true);
                $(this).closest('.check-item').addClass('checked');
            }
        });
        updateProgress(); updateGroupCounts();
    }

    async function saveChecklist() {
        var checked = {};
        $('#checklistArea input[type="checkbox"]').each(function() {
            if ($(this).prop('checked')) checked[$(this).data('id')] = true;
        });
        if (_dbSave) {
            try { await _dbSave(checked); } catch(e) { console.warn('Checklist save failed:', e); }
        }
    }

    function updateProgress() {
        var total = $('#checklistArea input[type="checkbox"]').length;
        var done  = $('#checklistArea input[type="checkbox"]:checked').length;
        var pct   = total > 0 ? Math.round(done / total * 100) : 0;
        $('#progressFill').css('width', pct + '%');
        $('#progressNum').text(done); $('#progressTotal').text(total);
    }
    function updateGroupCounts() {
        $('.checklist-group').each(function() {
            var total = $(this).find('input[type="checkbox"]').length;
            var done  = $(this).find('input[type="checkbox"]:checked').length;
            $(this).find('.group-count').text(done + '/' + total);
        });
    }
    $(document).on('change', '#checklistArea input[type="checkbox"]', function() {
        $(this).closest('.check-item').toggleClass('checked', $(this).prop('checked'));
        saveChecklist(); updateProgress(); updateGroupCounts();
    });

    // ======== INIT ========
    updateUI();
    setTimeout(updateDayStrip, 50);
});

// PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function() {});
}
