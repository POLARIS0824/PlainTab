/**
 * PlainTabQuote - 每日一言（hitokoto）。
 * 按天缓存于 ptab_ui.quote，点击可换一句；失败静默。
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
        el.addEventListener('click', function (e) {
            e.stopPropagation();
            loadNewQuote(false);
        });
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
