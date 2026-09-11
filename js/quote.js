/**
 * PlainTabQuote - 每日一言（hitokoto）。
 * 按天缓存于 ptab_ui.quote，点击可换一句，悬停可复制；失败静默。
 */
(function () {
    'use strict';

    var D = window.WallpaperData;
    var ENDPOINTS = [
        'https://v1.hitokoto.cn/?encode=json&max_length=36',
        'https://international.v1.hitokoto.cn/?encode=json&max_length=36'
    ];

    var el = null;
    var textEl = null;
    var fromEl = null;
    var copyEl = null;
    var fetching = false;

    function text(key, fallback) {
        if (window.t) {
            var value = window.t(key);
            if (value && value !== key) return value;
        }
        return fallback || key;
    }

    function todayKey() {
        return new Date().toDateString();
    }

    function quoteFrom(data) {
        var who = typeof data.from_who === 'string' ? data.from_who.trim() : '';
        var work = typeof data.from === 'string' ? data.from.trim() : '';
        if (who && work) return who + ' ·《' + work + '》';
        if (work) return '《' + work + '》';
        return who;
    }

    function fetchOne(url) {
        var WF = window.WallpaperFetch;
        var signal = WF && WF.timeoutSignal ? WF.timeoutSignal(8000) : undefined;
        return fetch(url, { mode: 'cors', signal: signal }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (data) {
            var quoteText = data && typeof data.hitokoto === 'string' ? data.hitokoto.trim() : '';
            if (!quoteText) throw new Error('empty quote');
            return { text: quoteText, from: quoteFrom(data || {}) };
        });
    }

    function fetchQuote() {
        return Promise.any(ENDPOINTS.map(fetchOne));
    }

    function saveQuote(quoteText, from) {
        var ui = D.loadUI();
        ui.quote.text = quoteText;
        ui.quote.from = from;
        ui.quote.date = todayKey();
        D.saveUI(ui);
    }

    function updateTitle() {
        if (el) el.title = text('quoteRefreshTitle', 'Next quote');
        if (copyEl) {
            var label = text('quoteCopyTitle', 'Copy this quote');
            copyEl.title = label;
            copyEl.setAttribute('aria-label', label);
        }
    }

    function toast(key, fallback, variant) {
        var Notice = window.PlainTabNotice;
        if (!Notice || !Notice.toast) return;
        Notice.toast({ message: text(key, fallback), variant: variant });
    }

    function selectQuoteText() {
        var selection = window.getSelection && window.getSelection();
        if (!selection || !textEl) return;
        var range = document.createRange();
        range.selectNodeContents(textEl);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function copyFallback(value) {
        var area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '0';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        var copied = false;
        try {
            copied = typeof document.execCommand === 'function' && document.execCommand('copy');
        } catch (e) {
            copied = false;
        }
        document.body.removeChild(area);
        if (copyEl && document.activeElement === document.body) copyEl.focus({ preventScroll: true });
        return copied ? Promise.resolve() : Promise.reject(new Error('copy rejected'));
    }

    function writeClipboard(value) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(value).catch(function () {
                return copyFallback(value);
            });
        }
        return copyFallback(value);
    }

    function quoteShareText() {
        var value = textEl && textEl.textContent ? textEl.textContent.trim() : '';
        var from = fromEl && fromEl.textContent ? fromEl.textContent.trim() : '';
        if (!value) return '';
        return from ? value + ' —— ' + from : value;
    }

    function hasQuoteSelection() {
        var selection = window.getSelection && window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
        return !!(el && el.contains(selection.getRangeAt(0).commonAncestorContainer));
    }

    function copyQuote(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        var value = quoteShareText();
        if (!value) return;
        // 必须在本次用户激活内发起写入，延后到 rAF / setTimeout 会丢失激活态
        writeClipboard(value).then(function () {
            toast('quoteCopied', 'Copied', 'success');
        }).catch(function () {
            selectQuoteText();
            toast('quoteCopyFailed', 'Copy failed — select the text to copy', 'error');
        });
    }

    function show() {
        el.hidden = false;
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                el.classList.add('visible');
            });
        });
    }

    function hide() {
        if (!el) return;
        el.classList.remove('visible');
        setTimeout(function () {
            if (!el.classList.contains('visible')) el.hidden = true;
        }, 450);
    }

    function render(quoteText, from) {
        textEl.textContent = quoteText;
        fromEl.textContent = from || '';
        updateTitle();
        show();
    }

    function loadNewQuote(useOldFallback) {
        if (fetching) return;
        fetching = true;
        el.classList.add('loading');
        fetchQuote().then(function (quote) {
            saveQuote(quote.text, quote.from);
            render(quote.text, quote.from);
        }).catch(function () {
            if (useOldFallback) {
                var ui = D.loadUI();
                if (ui.quote.text) render(ui.quote.text, ui.quote.from);
            }
        }).then(function () {
            fetching = false;
            el.classList.remove('loading');
        });
    }

    function ensureDom() {
        if (el) return;
        el = document.getElementById('quoteLine');
        textEl = document.getElementById('quoteText');
        fromEl = document.getElementById('quoteFrom');
        copyEl = document.getElementById('quoteCopy');
        el.addEventListener('click', function (e) {
            e.stopPropagation();
            if (e.target && e.target.closest && e.target.closest('.quote-copy')) return;
            // 拖选文字后在原元素上松手同样会触发 click，此时不应换句
            if (hasQuoteSelection()) return;
            loadNewQuote(false);
        });
        if (copyEl) copyEl.addEventListener('click', copyQuote);
        var prevLangChange = window.onLangChange;
        window.onLangChange = function (lang) {
            updateTitle();
            if (typeof prevLangChange === 'function') prevLangChange(lang);
        };
    }

    function boot() {
        if (!D || !document.getElementById('quoteLine')) return;
        ensureDom();
        var ui = D.loadUI();
        if (!ui.quote.enabled) return;
        if (ui.quote.date === todayKey() && ui.quote.text) {
            render(ui.quote.text, ui.quote.from);
            return;
        }
        loadNewQuote(true);
    }

    function setEnabled(value) {
        if (!D) return;
        value = !!value;
        var ui = D.loadUI();
        if (!ui.quote.enabled && !value) return;
        if (ui.quote.enabled !== value) {
            ui.quote.enabled = value;
            D.saveUI(ui);
        }
        if (!value) {
            hide();
            return;
        }
        ensureDom();
        var cached = ui.quote.date === todayKey() && ui.quote.text;
        if (cached) render(ui.quote.text, ui.quote.from);
        else if (!el.classList.contains('visible')) loadNewQuote(true);
    }

    function refresh() {
        if (!el || !D || !D.loadUI().quote.enabled) return;
        loadNewQuote(false);
    }

    window.PlainTabQuote = {
        boot: boot,
        setEnabled: setEnabled,
        refresh: refresh
    };
})();
