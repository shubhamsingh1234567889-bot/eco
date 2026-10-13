'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'ecotrack.userId';
  const CAT_COLORS = { transport: '#2f7fd1', food: '#e0892b', energy: '#d6b21f', waste: '#8a6bbf' };

  let factors = {};
  let userId = null;
  let trendChart = null;
  let catChart = null;

  /* ---------------- helpers ---------------- */

  const localToday = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  const fmt = (n, d = 1) => (n == null ? '–' : Number(n).toFixed(d));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function fillSelect(select, items, keepValue) {
    const prev = select.value;
    select.replaceChildren();
    for (const it of items) {
      const o = el('option', null, it.label);
      o.value = it.key;
      select.appendChild(o);
    }
    if (keepValue && items.some((i) => i.key === prev)) select.value = prev;
  }

  const itemOf = (cat, key) => factors[cat].items.find((i) => i.key === key);

  /* ---------------- onboarding ---------------- */

  function showWelcome() {
    $('welcome').hidden = false;
    $('app').hidden = true;
    $('switchUser').hidden = true;
    $('userName').textContent = '';
  }

  async function showApp() {
    $('welcome').hidden = true;
    $('app').hidden = false;
    $('switchUser').hidden = false;
    await refresh();
  }

  $('welcomeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('welcomeError').textContent = '';
    try {
      const user = await api('/api/users', { method: 'POST', body: { name: $('nameInput').value } });
      userId = user.id;
      localStorage.setItem(STORAGE_KEY, String(user.id));
      await showApp();
    } catch (err) {
      $('welcomeError').textContent = err.message;
    }
  });

  $('switchUser').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    userId = null;
    $('nameInput').value = '';
    showWelcome();
  });

  /* ---------------- log form ---------------- */

  function setupCategoryControls() {
    const cats = Object.entries(factors).map(([key, v]) => ({ key, label: v.label }));
    fillSelect($('category'), cats);
    fillSelect($('simCategory'), cats);
    onCategoryChange();
    onSimCategoryChange();
  }

  function onCategoryChange() {
    const cat = $('category').value;
    fillSelect($('type'), factors[cat].items);
    updatePreview();
  }

  function updatePreview() {
    const cat = $('category').value;
    const item = itemOf(cat, $('type').value);
    if (!item) return;
    $('qtyLabel').textContent = `Quantity (${item.unit})`;
    const qty = Number($('quantity').value);
    const kg = Number.isFinite(qty) ? item.factor * qty : 0;
    $('preview').textContent = `≈ ${kg.toFixed(2)} kg CO₂e`;
  }

  $('category').addEventListener('change', onCategoryChange);
  $('type').addEventListener('change', updatePreview);
  $('quantity').addEventListener('input', updatePreview);

  $('logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('logError').textContent = '';
    try {
      await api('/api/activities', {
        method: 'POST',
        body: {
          userId,
          category: $('category').value,
          type: $('type').value,
          quantity: Number($('quantity').value),
          date: $('date').value,
        },
      });
      await refresh();
    } catch (err) {
      $('logError').textContent = err.message;
    }
  });

  /* ---------------- simulator ---------------- */

  function onSimCategoryChange() {
    const cat = $('simCategory').value;
    const items = factors[cat].items;
    fillSelect($('simFrom'), items);
    fillSelect($('simTo'), items);
    if (items.length > 1) $('simTo').selectedIndex = items.length - 1;
    $('simQtyLabel').textContent = `Amount (${items[0].unit})`;
    $('simResult').textContent = '';
  }
  $('simCategory').addEventListener('change', onSimCategoryChange);

  $('simForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/simulate', {
        method: 'POST',
        body: {
          category: $('simCategory').value,
          fromType: $('simFrom').value,
          toType: $('simTo').value,
          quantity: Number($('simQty').value),
        },
      });
      const from = itemOf($('simCategory').value, $('simFrom').value).label;
      const to = itemOf($('simCategory').value, $('simTo').value).label;
      $('simResult').textContent =
        r.savingKg >= 0
          ? `Switching from ${from} to ${to} saves ${r.savingKg} kg CO₂e, roughly what ${r.treeYearsEquivalent} trees absorb in a year.`
          : `That swap would add ${Math.abs(r.savingKg)} kg CO₂e. Try the other way round.`;
    } catch (err) {
      $('simResult').textContent = err.message;
    }
  });

  /* ---------------- goal ---------------- */

  $('goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/users/${userId}/goal`, { method: 'PUT', body: { dailyGoal: Number($('goalInput').value) } });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  /* ---------------- rendering ---------------- */

  function renderStats(d) {
    $('userName').textContent = d.user.name;
    $('statToday').textContent = fmt(d.todayTotal);
    $('statAvg').textContent = fmt(d.avgDaily7);
    $('statGoal').textContent = `kg CO₂e / day (goal ${d.user.dailyGoal})`;
    $('statScore').textContent = d.score == null ? '–' : d.score;
    $('statScoreLabel').textContent = d.scoreLabel;
    $('statStreak').textContent = d.streak;
    $('goalInput').value = d.user.dailyGoal;
  }

  function renderTrend(d) {
    const labels = d.daily.map((x) => x.date.slice(5));
    const actual = d.daily.map((x) => (x.logged ? x.total : null));
    const pred = d.forecast ? d.forecast.predictions : [];
    const allLabels = labels.concat(pred.map((p) => p.date.slice(5)));
    const lastIdx = d.daily.length - 1;

    const forecastData = new Array(allLabels.length).fill(null);
    if (pred.length) {
      forecastData[lastIdx] = d.daily[lastIdx].logged ? d.daily[lastIdx].total : pred[0].total;
      pred.forEach((p, i) => (forecastData[lastIdx + 1 + i] = p.total));
    }
    const goalLine = new Array(allLabels.length).fill(d.user.dailyGoal);

    const text = cssVar('--muted');
    const grid = cssVar('--line');
    const green = cssVar('--green');

    const data = {
      labels: allLabels,
      datasets: [
        { label: 'Logged', data: actual, borderColor: green, backgroundColor: green, tension: 0.3, spanGaps: true, pointRadius: 3 },
        { label: 'Forecast', data: forecastData, borderColor: green, borderDash: [6, 6], pointRadius: 0, tension: 0.2 },
        { label: 'Goal', data: goalLine, borderColor: cssVar('--warn'), borderWidth: 1, pointRadius: 0 },
      ],
    };

    if (trendChart) trendChart.destroy();
    trendChart = new Chart($('trendChart'), {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: text, boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: text, maxTicksLimit: 8 }, grid: { color: grid } },
          y: { beginAtZero: true, title: { display: true, text: 'kg CO₂e', color: text }, ticks: { color: text }, grid: { color: grid } },
        },
      },
    });

    $('forecastNote').textContent = d.forecast
      ? `Trend is ${d.forecast.direction}. At this pace you would emit about ${fmt(d.forecast.projectedMonthKg, 0)} kg CO₂e over a month.`
      : 'Log at least 3 days to see your forecast.';
  }

  function renderCategories(d) {
    const entries = Object.entries(d.categories).filter(([, v]) => v > 0);
    $('catEmpty').hidden = entries.length > 0;
    $('catChart').parentElement.hidden = entries.length === 0;
    if (catChart) catChart.destroy();
    if (!entries.length) return;
    catChart = new Chart($('catChart'), {
      type: 'doughnut',
      data: {
        labels: entries.map(([k]) => factors[k].label),
        datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k]) => CAT_COLORS[k]), borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: { legend: { position: 'right', labels: { color: cssVar('--muted'), boxWidth: 12 } } },
      },
    });
  }

  function renderTips(d) {
    const ul = $('tips');
    ul.replaceChildren();
    for (const t of d.tips) {
      const li = el('li', 'tip');
      li.appendChild(el('strong', null, t.title));
      li.appendChild(el('p', null, t.detail));
      if (t.weeklySavingKg > 0) li.appendChild(el('span', 'saving', `Saves ≈ ${t.weeklySavingKg} kg CO₂e / week`));
      ul.appendChild(li);
    }
  }

  function renderBoard(rows) {
    const ol = $('board');
    ol.replaceChildren();
    if (!rows.length) {
      ol.appendChild(el('li', 'empty', 'No one yet.'));
      return;
    }
    rows.forEach((r, i) => {
      const li = el('li', r.id === userId ? 'me' : '');
      li.appendChild(el('span', 'rank', String(i + 1)));
      li.appendChild(el('span', 'name', r.name));
      li.appendChild(el('span', 'pts', r.score == null ? '–' : `${r.score} pts`));
      ol.appendChild(li);
    });
  }

  function renderRecent(rows) {
    const ul = $('recent');
    ul.replaceChildren();
    if (!rows.length) {
      ul.appendChild(el('li', 'empty', 'Nothing logged yet. Add your first activity above.'));
      return;
    }
    for (const a of rows) {
      const item = itemOf(a.category, a.type);
      const li = el('li');
      li.appendChild(el('span', 'date', a.date));
      li.appendChild(el('span', 'desc', `${item ? item.label : a.type}: ${a.quantity} ${item ? item.unit : ''}`));
      li.appendChild(el('span', 'kg', `${a.emission.toFixed(2)} kg`));
      const del = el('button', 'del', '✕');
      del.type = 'button';
      del.title = 'Delete';
      del.setAttribute('aria-label', 'Delete activity');
      del.addEventListener('click', async () => {
        await api(`/api/activities/${a.id}?userId=${userId}`, { method: 'DELETE' });
        await refresh();
      });
      li.appendChild(del);
      ul.appendChild(li);
    }
  }

  async function refresh() {
    const today = localToday();
    const [dash, board, recent] = await Promise.all([
      api(`/api/dashboard?userId=${userId}&today=${today}`),
      api(`/api/leaderboard?today=${today}`),
      api(`/api/activities?userId=${userId}&limit=15`),
    ]);
    renderStats(dash);
    renderTrend(dash);
    renderCategories(dash);
    renderTips(dash);
    renderBoard(board);
    renderRecent(recent);
  }

  /* ---------------- boot ---------------- */

  async function init() {
    $('date').value = localToday();
    $('date').max = localToday();
    factors = await api('/api/factors');
    setupCategoryControls();

    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      try {
        await api(`/api/users/${saved}`);
        userId = saved;
        await showApp();
        return;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    showWelcome();
  }

  init().catch((err) => {
    document.querySelector('.container').textContent = `Could not start EcoTrack: ${err.message}`;
  });
})();
