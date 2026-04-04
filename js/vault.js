$(function () {
    var _db = null;
    var _storage = null;
    var folders = [];
    var files = [];
    var activeFolderId = 'all';
    var selectedFile = null;
    var selectedFolder = null;
    var pendingUploadFile = null;

    // ======== FIREBASE BRIDGE ========
    window.__vaultInit = function (db, storage) {
        _db = db;
        _storage = storage;
        loadAll();
    };
    if (window.__vaultInitData) {
        window.__vaultInit.apply(null, window.__vaultInitData);
        delete window.__vaultInitData;
    }

    // ======== LOAD ========
    async function loadAll() {
        try {
            var results = await Promise.all([_db.getFolders(), _db.getFiles()]);
            folders = results[0];
            files   = results[1];
        } catch (e) {
            console.warn('Load failed:', e);
        }
        $('#loadingState').hide();
        renderFolders();
        renderFiles();
    }

    // ======== RENDER FOLDERS ========
    function renderFolders() {
        var allCount = files.length;
        var html = '<div class="vf-chip ' + (activeFolderId === 'all' ? 'active' : '') + '" data-id="all">' +
                   '全部 <span class="vf-chip-count">' + allCount + '</span></div>';

        folders.forEach(function (f) {
            var count = files.filter(function (file) { return file.folderId === f.id; }).length;
            html += '<div class="vf-chip ' + (activeFolderId === f.id ? 'active' : '') + '" data-id="' + f.id + '">' +
                    (f.icon || '📁') + ' ' + escHtml(f.name) +
                    ' <span class="vf-chip-count">' + count + '</span></div>';
        });
        $('#foldersScroll').html(html);
        syncFolderOptions();
    }

    // ======== RENDER FILES ========
    function renderFiles() {
        var list = activeFolderId === 'all'
            ? files
            : files.filter(function (f) { return f.folderId === activeFolderId; });

        if (list.length === 0) {
            $('#filesGrid').html('');
            $('#emptyState').show();
            return;
        }
        $('#emptyState').hide();

        var html = '';
        list.forEach(function (f) {
            var isImg = f.mimeType && f.mimeType.startsWith('image/');
            var isPDF = f.mimeType === 'application/pdf';
            var thumb = isImg
                ? '<img class="vfile-thumb-img" src="' + f.downloadUrl + '" alt="" loading="lazy">'
                : '<div class="vfile-thumb-icon">' + (isPDF ? '📄' : '📎') + '</div>';

            var dateStr = f.createdAt ? fmtDate(f.createdAt) : '';
            var fTag = '';
            if (activeFolderId === 'all' && f.folderId) {
                var fd = folders.find(function (x) { return x.id === f.folderId; });
                if (fd) fTag = '<div class="vfile-folder">' + (fd.icon || '📁') + ' ' + escHtml(fd.name) + '</div>';
            }

            html += '<div class="vfile-card" data-id="' + f.id + '">' +
                    '<div class="vfile-thumb">' + thumb + '</div>' +
                    '<div class="vfile-info">' +
                    '<div class="vfile-name">' + escHtml(f.name) + '</div>' +
                    fTag +
                    '<div class="vfile-date">' + dateStr + '</div>' +
                    '</div>' +
                    '<button class="vfile-more-btn" data-id="' + f.id + '" aria-label="更多">⋮</button>' +
                    '</div>';
        });
        $('#filesGrid').html(html);
    }

    // ======== FOLDER CHIP CLICK ========
    $(document).on('click', '.vf-chip', function () {
        activeFolderId = String($(this).data('id'));
        renderFolders();
        renderFiles();
    });

    // ======== FOLDER LONG-PRESS ========
    var _lpTimer = null;
    $(document).on('touchstart mousedown', '.vf-chip:not([data-id="all"])', function (e) {
        var $chip = $(this);
        _lpTimer = setTimeout(function () {
            var id = String($chip.data('id'));
            selectedFolder = folders.find(function (f) { return f.id === id; });
            if (selectedFolder) openActionSheet('folderActionSheet');
        }, 500);
    });
    $(document).on('touchend touchmove mouseup mouseleave', '.vf-chip', function () {
        clearTimeout(_lpTimer);
    });

    // ======== FILE CARD CLICK (preview) ========
    $(document).on('click', '.vfile-card', function (e) {
        if ($(e.target).closest('.vfile-more-btn').length) return;
        var id = $(this).data('id');
        var file = files.find(function (f) { return f.id === id; });
        if (!file) return;
        if (file.mimeType && file.mimeType.startsWith('image/')) {
            openPreview(file);
        } else {
            window.open(file.downloadUrl, '_blank');
        }
    });

    // ======== FILE ⋮ BUTTON ========
    $(document).on('click', '.vfile-more-btn', function (e) {
        e.stopPropagation();
        var id = $(this).data('id');
        selectedFile = files.find(function (f) { return f.id === id; });
        if (selectedFile) openActionSheet('fileActionSheet');
    });

    // ======== ADD FOLDER ========
    $('#addFolderBtn').on('click', function () {
        selectedFolder = null;
        $('#folderModalTitle').text('新增資料夾');
        $('#folderNameInput').val('');
        $('.emoji-btn').removeClass('selected');
        $('.emoji-btn').first().addClass('selected');
        openModal('folderModal');
    });

    // ======== FOLDER CONFIRM ========
    $('#folderConfirmBtn').on('click', async function () {
        var name = $('#folderNameInput').val().trim();
        if (!name) { $('#folderNameInput').focus(); return; }
        var icon = $('.emoji-btn.selected').data('emoji') || '📁';

        var $btn = $(this).prop('disabled', true).text('儲存中...');
        try {
            if (selectedFolder) {
                await _db.updateFolder(selectedFolder.id, { name: name, icon: icon });
                var idx = folders.findIndex(function (f) { return f.id === selectedFolder.id; });
                if (idx >= 0) { folders[idx].name = name; folders[idx].icon = icon; }
            } else {
                var newId = await _db.addFolder({ name: name, icon: icon, order: folders.length, createdAt: Date.now() });
                folders.push({ id: newId, name: name, icon: icon, order: folders.length });
            }
            renderFolders(); renderFiles();
            closeModal('folderModal');
        } catch (e) { console.warn(e); alert('儲存失敗，請重試'); }
        $btn.prop('disabled', false).text('確認');
    });

    // ======== FOLDER ACTION SHEET ========
    $('#folderSheetEdit').on('click', function () {
        closeActionSheet();
        setTimeout(function () {
            if (!selectedFolder) return;
            $('#folderModalTitle').text('編輯資料夾');
            $('#folderNameInput').val(selectedFolder.name);
            $('.emoji-btn').removeClass('selected');
            var $match = $('.emoji-btn[data-emoji="' + selectedFolder.icon + '"]');
            ($match.length ? $match : $('.emoji-btn').first()).addClass('selected');
            openModal('folderModal');
        }, 320);
    });

    $('#folderSheetDelete').on('click', function () {
        closeActionSheet();
        setTimeout(async function () {
            if (!selectedFolder) return;
            if (!confirm('刪除「' + selectedFolder.name + '」？\n資料夾內的文件將移至未分類。')) return;
            try {
                // Un-assign files first
                var affected = files.filter(function (f) { return f.folderId === selectedFolder.id; });
                await Promise.all(affected.map(function (f) { return _db.updateFile(f.id, { folderId: '' }); }));
                affected.forEach(function (f) { f.folderId = ''; });
                await _db.deleteFolder(selectedFolder.id);
                folders = folders.filter(function (f) { return f.id !== selectedFolder.id; });
                if (activeFolderId === selectedFolder.id) activeFolderId = 'all';
                renderFolders(); renderFiles();
            } catch (e) { alert('刪除失敗'); }
        }, 320);
    });

    // ======== UPLOAD FAB ========
    $('#uploadFab').on('click', function () { $('#fileInput').trigger('click'); });

    $('#fileInput').on('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        pendingUploadFile = file;
        var baseName = file.name.replace(/\.[^.]+$/, '');
        $('#uploadFileName').val(baseName);
        $('#uploadFolderSelect').val(activeFolderId !== 'all' ? activeFolderId : '');
        $('#uploadProgress').hide();
        $('#uploadConfirmBtn').prop('disabled', false).text('上傳');
        openModal('uploadModal');
        $(this).val('');
    });

    function syncFolderOptions() {
        var current = $('#uploadFolderSelect').val();
        var html = '<option value="">— 不分類 —</option>';
        folders.forEach(function (f) {
            html += '<option value="' + f.id + '">' + (f.icon || '📁') + ' ' + escHtml(f.name) + '</option>';
        });
        $('#uploadFolderSelect').html(html).val(current);

        var mc = $('#moveFolderSelect').val();
        var mhtml = '<option value="">— 不分類 —</option>';
        folders.forEach(function (f) {
            mhtml += '<option value="' + f.id + '">' + (f.icon || '📁') + ' ' + escHtml(f.name) + '</option>';
        });
        $('#moveFolderSelect').html(mhtml).val(mc);
    }

    // ======== UPLOAD CONFIRM ========
    $('#uploadConfirmBtn').on('click', async function () {
        if (!pendingUploadFile || !_storage) return;
        var name     = $('#uploadFileName').val().trim() || pendingUploadFile.name;
        var folderId = $('#uploadFolderSelect').val();

        var $btn = $(this).prop('disabled', true).text('上傳中...');
        $('#uploadProgress').show();

        try {
            var result = await _storage.uploadFile(pendingUploadFile, name);
            var meta = {
                name: name, folderId: folderId,
                storagePath: result.path, downloadUrl: result.url,
                mimeType: pendingUploadFile.type,
                size: pendingUploadFile.size,
                createdAt: Date.now()
            };
            var newId = await _db.addFile(meta);
            files.unshift(Object.assign({ id: newId }, meta));
            renderFolders(); renderFiles();
            closeModal('uploadModal');
            pendingUploadFile = null;
        } catch (e) {
            console.warn('Upload failed:', e);
            alert('上傳失敗：' + (e.message || '請確認 Firebase Storage 已啟用'));
        }
        $('#uploadProgress').hide();
        $btn.prop('disabled', false).text('上傳');
    });

    // ======== FILE ACTION SHEET ========
    $('#sheetRename').on('click', function () {
        closeActionSheet();
        setTimeout(function () {
            if (!selectedFile) return;
            var newName = prompt('重新命名', selectedFile.name);
            if (!newName || !newName.trim()) return;
            newName = newName.trim();
            _db.updateFile(selectedFile.id, { name: newName })
                .then(function () {
                    var idx = files.findIndex(function (f) { return f.id === selectedFile.id; });
                    if (idx >= 0) files[idx].name = newName;
                    renderFiles();
                })
                .catch(function () { alert('重新命名失敗'); });
        }, 320);
    });

    $('#sheetMove').on('click', function () {
        closeActionSheet();
        setTimeout(function () {
            if (!selectedFile) return;
            $('#moveFolderSelect').val(selectedFile.folderId || '');
            openModal('moveModal');
        }, 320);
    });

    $('#moveConfirmBtn').on('click', async function () {
        if (!selectedFile) return;
        var folderId = $('#moveFolderSelect').val();
        var $btn = $(this).prop('disabled', true).text('移動中...');
        try {
            await _db.updateFile(selectedFile.id, { folderId: folderId });
            var idx = files.findIndex(function (f) { return f.id === selectedFile.id; });
            if (idx >= 0) files[idx].folderId = folderId;
            renderFolders(); renderFiles();
            closeModal('moveModal');
        } catch (e) { alert('移動失敗'); }
        $btn.prop('disabled', false).text('確認');
    });

    $('#sheetDelete').on('click', function () {
        closeActionSheet();
        setTimeout(async function () {
            if (!selectedFile) return;
            if (!confirm('確定刪除「' + selectedFile.name + '」？\n此操作無法復原。')) return;
            try {
                if (selectedFile.storagePath) await _storage.deleteFile(selectedFile.storagePath);
                await _db.deleteFile(selectedFile.id);
                files = files.filter(function (f) { return f.id !== selectedFile.id; });
                renderFolders(); renderFiles();
            } catch (e) { alert('刪除失敗'); }
        }, 320);
    });

    // ======== PREVIEW ========
    function openPreview(file) {
        $('#previewImg').attr('src', file.downloadUrl);
        $('#previewFileName').text(file.name);
        $('#previewOpen').off('click').on('click', function () { window.open(file.downloadUrl, '_blank'); });
        openModal('previewModal');
    }
    $('#previewClose').on('click', function () { closeModal('previewModal'); });

    // ======== EMOJI PICKER ========
    $(document).on('click', '.emoji-btn', function () {
        $('.emoji-btn').removeClass('selected');
        $(this).addClass('selected');
    });

    // ======== MODAL HELPERS ========
    function openModal(id) {
        closeAllSheets();
        $('#' + id).addClass('open');
        $('#modalOverlay').addClass('visible');
    }
    function closeModal(id) {
        $('#' + id).removeClass('open');
        if (!$('.vault-modal.open').length) $('#modalOverlay').removeClass('visible');
    }
    function openActionSheet(id) {
        $('#' + id).addClass('open');
        $('#sheetOverlay').addClass('visible');
    }
    function closeActionSheet() {
        $('.vault-action-sheet').removeClass('open');
        $('#sheetOverlay').removeClass('visible');
    }
    function closeAllSheets() {
        closeActionSheet();
    }

    // Close modal via ✕ button
    $(document).on('click', '.modal-close-btn', function () {
        var id = $(this).closest('.vault-modal').attr('id');
        closeModal(id);
    });

    // Overlay taps close everything
    $('#modalOverlay').on('click', function () {
        $('.vault-modal').removeClass('open');
        $(this).removeClass('visible');
    });
    $('#sheetOverlay').on('click', function () {
        closeActionSheet();
    });

    // ======== UTILS ========
    function fmtDate(ts) {
        var d = new Date(ts);
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
               String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    function escHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
});
