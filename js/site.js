/* Xingjian Bai — site.js
 * Minimal, framework-free.
 * Features:
 *  - theme (dark/light) toggle with localStorage + dark default
 *  - bibtex toggle for each paper
 *  - publications filter toggle (Selected / All)
 *  - news disclosure (latest four entries by default)
 *  - scroll-spy to highlight active nav link
 */
(function () {
    'use strict';

    // ---------- Theme ----------
    var root = document.documentElement;
    var themeBtn = document.querySelector('[data-theme-toggle]');

    function applyTheme(t) {
        if (t === 'dark' || t === 'light') {
            root.setAttribute('data-theme', t);
        } else {
            root.removeAttribute('data-theme');
        }
        if (themeBtn) {
            var isDark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
            themeBtn.textContent = isDark ? '☀' : '☾';
            themeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        }
    }
    applyTheme(localStorage.getItem('theme') || 'dark');

    if (themeBtn) {
        themeBtn.addEventListener('click', function () {
            var current = root.getAttribute('data-theme');
            var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            var next;
            if (!current) next = systemDark ? 'light' : 'dark';
            else if (current === 'dark') next = 'light';
            else next = 'dark';
            localStorage.setItem('theme', next);
            applyTheme(next);
        });
    }

    // ---------- Bibtex ----------
    document.querySelectorAll('[data-bibtex-toggle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-bibtex-toggle');
            var box = document.getElementById(id);
            if (!box) return;
            var isOpen = box.hasAttribute('open');
            if (isOpen) box.removeAttribute('open');
            else box.setAttribute('open', '');
            btn.setAttribute('aria-expanded', String(!isOpen));
        });
    });

    // ---------- Publications filter (Selected / All) ----------
    var pubToggle = document.querySelector('.pub-toggle');
    var pubList = document.querySelector('.pub-list[data-view]');
    if (pubToggle && pubList) {
        pubToggle.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-view]');
            if (!btn) return;
            var view = btn.getAttribute('data-view');
            pubList.setAttribute('data-view', view);
            pubToggle.querySelectorAll('button[data-view]').forEach(function (b) {
                var on = b === btn;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', String(on));
            });
        });
    }

    // ---------- Publication media ----------
    async function updateStars(badge) {
        try {
            var response = await fetch('https://api.github.com/repos/' + badge.dataset.repo + '/stargazers/count', {
                credentials: 'omit',
                signal: AbortSignal.timeout(4000)
            });
            if (!response.ok) return;
            var stats = await response.json();
            if (!Number.isSafeInteger(stats.count) || stats.count < 0) return;
            badge.querySelector('.repo-star-count').textContent = stats.count.toLocaleString('en-US');
            badge.title = 'Current GitHub stars';
            badge.hidden = false;
        } catch (error) {
            // Leave the existing snapshot, if any, when the public API is unavailable.
        }
    }

    if ('IntersectionObserver' in window) {
        var starsObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                starsObserver.unobserve(entry.target);
                updateStars(entry.target.querySelector('[data-repo]'));
            });
        });
        document.querySelectorAll('[data-repo]').forEach(function (badge) {
            starsObserver.observe(badge.closest('a'));
        });

        var teaser = document.querySelector('[data-preview-video]');
        if (teaser && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            var teaserObserver = new IntersectionObserver(function (entries) {
                if (!entries[0].isIntersecting) return;
                teaserObserver.disconnect();
                teaser.play().catch(function () {});
            }, { threshold: 0.25 });
            teaserObserver.observe(teaser);
        }
    }

    // ---------- News disclosure ----------
    var newsList = document.getElementById('news-list');
    var newsToggle = document.querySelector('.news-toggle');
    if (newsList && newsToggle) {
        // News is newest first. Keep four distinct objects in the collapsed view.
        // Reuse data-news-object when adding another update about the same work.
        var seenNewsObjects = new Set();
        var visibleNewsCount = 0;
        var olderNews = Array.from(newsList.children).filter(function (item) {
            var object = item.dataset.newsObject;
            var isOlderUpdate = object && seenNewsObjects.has(object);
            if (object) seenNewsObjects.add(object);
            if (isOlderUpdate || visibleNewsCount >= 4) return true;
            visibleNewsCount += 1;
            return false;
        });
        if (olderNews.length) {
            var newsLabel = newsToggle.querySelector('.news-toggle-label');
            newsToggle.querySelector('.news-count').textContent = olderNews.length;
            olderNews.forEach(function (item) { item.hidden = true; });
            newsToggle.parentElement.hidden = false;
            newsToggle.addEventListener('click', function () {
                var expanded = newsToggle.getAttribute('aria-expanded') !== 'true';
                olderNews.forEach(function (item) { item.hidden = !expanded; });
                newsToggle.setAttribute('aria-expanded', String(expanded));
                newsLabel.textContent = expanded ? 'Show less' : 'Show older news';
                // Keep the control in view when a long archive collapses on mobile.
                if (!expanded && newsToggle.getBoundingClientRect().top < 80) {
                    newsToggle.scrollIntoView({ block: 'center', behavior: 'instant' });
                }
            });
        }
    }

    // ---------- Scroll spy ----------
    var sections = Array.from(document.querySelectorAll('main section[id]'));
    var navLinks = Array.from(document.querySelectorAll('.nav a.navlink'));
    function setActive() {
        var y = window.scrollY + 90;
        var current = sections[0] && sections[0].id;
        sections.forEach(function (s) { if (s.offsetTop <= y) current = s.id; });
        navLinks.forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('href') === '#' + current);
        });
    }
    window.addEventListener('scroll', setActive, { passive: true });
    setActive();
})();
