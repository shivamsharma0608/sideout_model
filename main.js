/* ═══════════════════════════════════════════════════════════════
   main.js — UCSD WVB Side-Out Analytics — Interactive Enhancements
   ═══════════════════════════════════════════════════════════════ */

   (() => {
    'use strict';
  
    /* ══════════════════════════════════════════════════════
       1. TOAST NOTIFICATION SYSTEM
       ══════════════════════════════════════════════════════ */
    const toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
    let toastTimer = null;
  
    function showToast(msg, duration = 2200) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
    }
  
  
    /* ══════════════════════════════════════════════════════
       2. ANIMATED SCORE COUNTER
          Uses MutationObserver to intercept text changes
          on the main xSO% display and animate the number.
       ══════════════════════════════════════════════════════ */
    const pctEl = document.getElementById('scorePct');
    let animFrame = null;
    let displayVal = 0;
  
    function animateTo(target, color) {
      if (animFrame) cancelAnimationFrame(animFrame);
      const start = displayVal;
      const duration = 380;
      const t0 = performance.now();
  
      function step(now) {
        const p = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
        const val = start + (target - start) * ease;
        // Temporarily disconnect so we don't re-trigger the observer
        observer.disconnect();
        pctEl.textContent = val.toFixed(1) + '%';
        pctEl.style.color = color;
        observer.observe(pctEl, obsConfig);
        if (p < 1) {
          animFrame = requestAnimationFrame(step);
        } else {
          displayVal = target;
        }
      }
      animFrame = requestAnimationFrame(step);
    }
  
    const obsConfig = { childList: true, subtree: true, characterData: true };
    const observer = new MutationObserver(() => {
      const text = pctEl.textContent.trim();
      const match = text.match(/[\d.]+/);
      if (!match) { displayVal = 0; return; }
  
      const target = parseFloat(match[0]);
      const color = pctEl.style.color;
  
      if (Math.abs(target - displayVal) < 0.05) return; // no meaningful change
  
      // Celebrate great combos
      const scoreBar = document.getElementById('scoreBar');
      if (target >= 70) {
        scoreBar.classList.add('score-celebrate');
        setTimeout(() => scoreBar.classList.remove('score-celebrate'), 700);
        if (target >= 75) showToast(`🔥 ${target.toFixed(1)}% — Elite combo!`);
      }
  
      animateTo(target, color);
    });
    observer.observe(pctEl, obsConfig);
  
  
    /* ══════════════════════════════════════════════════════
       3. PLAYER SEARCH FILTER
          Injects a search box above each builder column.
          Filters visible .pcard elements in real-time.
       ══════════════════════════════════════════════════════ */
    const searchableColumns = [
      { listId: 'passerList',   label: 'Search passers…'  },
      { listId: 'setterList',   label: 'Search setters…'  },
      { listId: 'hitterList',   label: 'Search hitters…'  },
    ];
  
    const searchInputs = {};
  
    searchableColumns.forEach(({ listId, label }) => {
      const listEl = document.getElementById(listId);
      if (!listEl) return;
  
      const wrap = document.createElement('div');
      wrap.className = 'search-wrap';
      wrap.innerHTML = `<span class="search-icon">🔍</span>
        <input class="col-search" type="text" placeholder="${label}" autocomplete="off">`;
      listEl.parentNode.insertBefore(wrap, listEl);
  
      const input = wrap.querySelector('input');
      searchInputs[listId] = input;
  
      input.addEventListener('input', () => {
        const q = input.value.toLowerCase().trim();
        listEl.querySelectorAll('.pcard').forEach(card => {
          const name = (card.getAttribute('data-name') || '').toLowerCase();
          card.style.display = (!q || name.includes(q)) ? '' : 'none';
        });
      });
    });
  
    // Re-filter after any list rebuild (passers rebuild when rotation changes, etc.)
    const listIds = searchableColumns.map(c => c.listId);
    listIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(() => {
        const input = searchInputs[id];
        if (!input || !input.value) return;
        const q = input.value.toLowerCase();
        el.querySelectorAll('.pcard').forEach(card => {
          const name = (card.getAttribute('data-name') || '').toLowerCase();
          card.style.display = (!q || name.includes(q)) ? '' : 'none';
        });
      }).observe(el, { childList: true });
    });
  
  
    /* ══════════════════════════════════════════════════════
       4. KEYBOARD SHORTCUTS
       ══════════════════════════════════════════════════════ */
    document.addEventListener('keydown', (e) => {
      // Don't fire when typing in an input/select
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  
      // ESC — clear all selections
      if (e.key === 'Escape') {
        clearAll();
        showToast('✕ Lineup cleared');
        return;
      }
  
      // 1–6 — select rotation
      if (e.key >= '1' && e.key <= '6') {
        const rot = parseInt(e.key);
        selectRotation(rot);
        showToast(`🔄 Rotation ${rot} selected`);
        return;
      }
  
      // Cmd/Ctrl + F — focus first search box
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        const firstSearch = document.querySelector('.col-search');
        if (firstSearch) { firstSearch.focus(); firstSearch.select(); }
        return;
      }
  
      // B — trigger best combo finder
      if (e.key === 'b' || e.key === 'B') {
        findBestCombo();
        return;
      }
    });
  
  
    /* ══════════════════════════════════════════════════════
       5. BEST COMBO FINDER
          Scans all passer → setter → hitter combos and
          selects the one with the highest xSO%.
          Respects the current rotation filter if set.
       ══════════════════════════════════════════════════════ */
    function findBestCombo() {
      // PSH (passer-setter-hitter) data is in the global scope
      let best = null;
  
      // If a rotation is already selected, filter PSR (passer-setter given rotation)
      if (typeof selRotation !== 'undefined' && selRotation !== null) {
        // Try passer+setter combos for this rotation
        const rotRows = (typeof PASSER_SETTER_ROTATION !== 'undefined' ? PASSER_SETTER_ROTATION : [])
          .filter(r => String(r.r) === String(selRotation))
          .sort((a, b) => b.xso - a.xso);
        if (rotRows.length) {
          const top = rotRows[0];
          selectPasser(top.passer);
          selectSetter(top.setter);
          showToast(`⚡ Best in R${selRotation}: ${top.passer.split(' ')[0]} → ${top.setter.split(' ')[0]} (${top.xso.toFixed(1)}%)`);
          return;
        }
      }
  
      // Otherwise find overall best passer+setter+hitter trio from PSH
      const pshData = typeof PSH !== 'undefined' ? PSH : [];
      if (pshData.length) {
        best = [...pshData].sort((a, b) => b.xso - a.xso)[0];
        selectPasser(best.passer);
        selectSetter(best.setter);
        setTimeout(() => selectHitter(best.hitter), 60); // slight delay so hitter list rebuilds
        showToast(`⚡ Best: ${best.passer.split(' ')[0]} → ${best.setter.split(' ')[0]} → ${best.hitter.split(' ')[0]} (${best.xso.toFixed(1)}%)`);
        return;
      }
  
      // Fallback: best passer-setter pair
      const psData = typeof PASSER_SETTER !== 'undefined' ? PASSER_SETTER : [];
      if (psData.length) {
        best = [...psData].sort((a, b) => b.xso - a.xso)[0];
        selectPasser(best.passer);
        selectSetter(best.setter);
        showToast(`⚡ Best pair: ${best.passer.split(' ')[0]} → ${best.setter.split(' ')[0]} (${best.xso.toFixed(1)}%)`);
      }
    }
  
    const bestBtn = document.getElementById('bestLineupBtn');
    if (bestBtn) bestBtn.addEventListener('click', findBestCombo);
  
  
    /* ══════════════════════════════════════════════════════
       6. SORTABLE LEADERBOARD HEADERS
          Click any column header in the Passers leaderboard
          to re-sort by that column (asc/desc toggle).
       ══════════════════════════════════════════════════════ */
    let lbSortCol = 'xso';
    let lbSortDir = -1; // -1 = desc, 1 = asc
  
    // We observe the leaderboard table for DOM changes (renderLb rebuilds it)
    const lbTable = document.getElementById('lbTable');
    if (lbTable) {
      new MutationObserver(() => attachLbSortHandlers()).observe(lbTable, { childList: true });
    }
  
    function attachLbSortHandlers() {
      const thead = lbTable?.querySelector('thead');
      if (!thead) return;
      thead.querySelectorAll('th').forEach((th, i) => {
        if (th.dataset.sortBound) return;
        th.dataset.sortBound = '1';
        th.addEventListener('click', () => sortLb(i, th));
      });
    }
  
    const LB_COL_KEYS = [null, 'name', 'receptions', null, 'xso', 'diff'];
  
    function sortLb(colIdx, thEl) {
      const key = LB_COL_KEYS[colIdx];
      if (!key) return;
  
      if (lbSortCol === key) {
        lbSortDir *= -1;
      } else {
        lbSortCol = key;
        lbSortDir = -1;
      }
  
      // Update header classes
      lbTable.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      thEl.classList.add(lbSortDir === -1 ? 'sort-desc' : 'sort-asc');
  
      const tbody = lbTable.querySelector('tbody');
      if (!tbody) return;
      const rows = [...tbody.querySelectorAll('tr')];
  
      rows.sort((a, b) => {
        const aVal = getCellVal(a, colIdx, key);
        const bVal = getCellVal(b, colIdx, key);
        if (typeof aVal === 'string') return lbSortDir * aVal.localeCompare(bVal);
        return lbSortDir * (bVal - aVal);
      });
  
      // Re-assign rank numbers in column 0
      rows.forEach((row, i) => {
        const rankCell = row.querySelector('td:first-child');
        if (rankCell) {
          rankCell.textContent = i + 1;
          rankCell.className = 'td-rank' + (i < 3 ? ' gold' : '');
        }
        tbody.appendChild(row);
      });
    }
  
    function getCellVal(row, colIdx, key) {
      const cells = row.querySelectorAll('td');
      if (!cells[colIdx]) return 0;
      const text = cells[colIdx].textContent.replace(/[^0-9.+-]/g, '').trim();
      if (key === 'name') return cells[colIdx].textContent.trim();
      return parseFloat(text) || 0;
    }
  
  
    /* ══════════════════════════════════════════════════════
       7. PLAYER CARD HOVER DETAIL PREVIEW
          On hover, show a small tooltip with the player's
          top stat so coaches get instant context.
       ══════════════════════════════════════════════════════ */
    const tip = document.createElement('div');
    tip.style.cssText = [
      'position:fixed','z-index:500','pointer-events:none','opacity:0',
      'transition:opacity .15s','background:var(--text)','color:#fff',
      'border-radius:8px','padding:.5rem .85rem','font-size:.75rem',
      'font-family:DM Sans,sans-serif','white-space:nowrap',
      'box-shadow:0 4px 16px rgba(0,0,0,.2)','line-height:1.5'
    ].join(';');
    document.body.appendChild(tip);
  
    function showTip(e, html) {
      tip.innerHTML = html;
      tip.style.opacity = '1';
      moveTip(e);
    }
    function moveTip(e) {
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 12);
      const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 12);
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    }
    function hideTip() { tip.style.opacity = '0'; }
  
    // Attach tooltip listeners to player cards via event delegation
    document.addEventListener('mouseover', (e) => {
      const card = e.target.closest('.pcard');
      if (!card) return;
      const name = card.getAttribute('data-name');
      if (!name || name.startsWith('Rotation')) return;
      const player = (typeof PLAYERS !== 'undefined' ? PLAYERS : []).find(p => p.name === name);
      if (!player) return;
  
      const topRot = [...player.by_rotation].sort((a, b) => b.pct - a.pct)[0];
      const topPQ  = Object.entries(player.by_pq || {})
        .filter(([, v]) => v.n >= 10)
        .sort(([, a], [, b]) => b.pct - a.pct)[0];
  
      let html = `<strong>${name}</strong><br>`;
      html += `Overall: <b>${player.xso.toFixed(1)}%</b> · ${player.receptions} recs`;
      if (topRot) html += `<br>Best rot: Rotation ${topRot.r} (${topRot.pct.toFixed(1)}%)`;
      if (topPQ)  html += `<br>Best pass: ${topPQ[0]} (${topPQ[1].pct.toFixed(1)}%)`;
  
      showTip(e, html);
    });
    document.addEventListener('mousemove', (e) => {
      if (e.target.closest('.pcard')) moveTip(e);
    });
    document.addEventListener('mouseout', (e) => {
      if (!e.target.closest('.pcard')) return;
      if (!e.relatedTarget?.closest('.pcard')) hideTip();
    });
  
  
    /* ══════════════════════════════════════════════════════
       8. TAB SWITCH — scroll to top & clear search
       ══════════════════════════════════════════════════════ */
    const origShowTab = window.showTab;
    // showTab is a regular function declaration so we can wrap it:
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Clear search inputs when leaving the builder tab
        Object.values(searchInputs).forEach(input => {
          input.value = '';
          const ev = new Event('input');
          input.dispatchEvent(ev);
        });
      });
    });
  
  
    /* ══════════════════════════════════════════════════════
       9. COPY LINEUP TO CLIPBOARD
          Double-click the score percentage to copy the
          current lineup summary as plain text.
       ══════════════════════════════════════════════════════ */
    pctEl.style.cursor = 'pointer';
    pctEl.title = 'Double-click to copy lineup';
  
    pctEl.addEventListener('dblclick', () => {
      const pct  = pctEl.textContent;
      const meta = document.getElementById('scoreMeta')?.textContent || '';
      const text = `UCSD WVB Side-Out: ${pct} — ${meta}`;
      navigator.clipboard?.writeText(text).then(() => {
        showToast('📋 Lineup copied to clipboard!');
      });
    });
  
  
    /* ══════════════════════════════════════════════════════
       10. SESSION PERSISTENCE
           Remember the last selected passer, setter, hitter
           and rotation so the page restores on refresh.
       ══════════════════════════════════════════════════════ */
    const STORAGE_KEY = 'ucsdwvb_lineup';
  
    function saveSelection() {
      try {
        const state = {
          rotation: typeof selRotation !== 'undefined' ? selRotation : null,
          passer:   typeof selPasser   !== 'undefined' ? selPasser   : null,
          setter:   typeof selSetter   !== 'undefined' ? selSetter   : null,
          hitter:   typeof selHitter   !== 'undefined' ? selHitter   : null,
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (_) {}
    }
  
    function restoreSelection() {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const { rotation, passer, setter, hitter } = JSON.parse(raw);
        if (rotation) selectRotation(rotation);
        if (passer)   selectPasser(passer);
        if (setter)   selectSetter(setter);
        if (hitter)   setTimeout(() => selectHitter(hitter), 80);
      } catch (_) {}
    }
  
    // Watch for any selection change by observing the score bar update
    const scoreBar = document.getElementById('scoreBar');
    if (scoreBar) {
      new MutationObserver(saveSelection).observe(scoreBar, { subtree: true, childList: true, characterData: true });
    }
  
    // Restore after a brief delay so all lists are built
    setTimeout(restoreSelection, 120);
  
  
    /* ══════════════════════════════════════════════════════
       INIT LOG
       ══════════════════════════════════════════════════════ */
    console.log('%cUCSD WVB Analytics loaded ✓', 'color:#00629B;font-weight:bold;font-size:14px');
    console.log('Shortcuts: ESC=clear  1-6=rotation  B=best combo  Ctrl/Cmd+F=search');
  
  })();