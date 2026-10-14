'use strict';

const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const { CATEGORIES, calcEmission, publicFactors, round } = require('./emissions');
const alg = require('./algorithms');
const biz = require('./business');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function createApp(db = openDb()) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const q = {
    createUser: db.prepare('INSERT INTO users (name, account_type, sector, tariff) VALUES (?, ?, ?, ?)'),
    getUser: db.prepare(
      `SELECT id, name, daily_goal AS dailyGoal, account_type AS accountType, sector, tariff
         FROM users WHERE id = ?`
    ),
    setGoal: db.prepare('UPDATE users SET daily_goal = ? WHERE id = ?'),
    setProfile: db.prepare('UPDATE users SET account_type = ?, sector = ?, tariff = ? WHERE id = ?'),
    allUsers: db.prepare('SELECT id, name, daily_goal AS dailyGoal FROM users'),
    insertActivity: db.prepare(
      'INSERT INTO activities (user_id, category, type, quantity, emission, date) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    deleteActivity: db.prepare('DELETE FROM activities WHERE id = ? AND user_id = ?'),
    activitiesSince: db.prepare(
      `SELECT id, category, type, quantity, emission, date
         FROM activities WHERE user_id = ? AND date >= ? AND date <= ?
         ORDER BY date DESC, id DESC`
    ),
    recent: db.prepare(
      `SELECT id, category, type, quantity, emission, date
         FROM activities WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?`
    ),
  };

  const resolveToday = (req) =>
    typeof req.query.today === 'string' && DATE_RE.test(req.query.today)
      ? req.query.today
      : alg.toDateStr(new Date());

  function requireUser(req, res) {
    const id = Number(req.query.userId ?? req.body?.userId ?? req.params.id);
    const user = Number.isInteger(id) ? q.getUser.get(id) : null;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return null;
    }
    return user;
  }

  /** Validates the personal/business profile fields. Returns { error } or the clean values. */
  function parseProfile(body = {}) {
    const accountType = body.accountType ?? 'personal';
    if (!['personal', 'business'].includes(accountType)) {
      return { error: 'Account type must be personal or business' };
    }
    let sector = null;
    let tariff = biz.DEFAULT_TARIFF;
    if (accountType === 'business') {
      sector = body.sector ?? 'other';
      if (!biz.sectorByKey(sector)) return { error: 'Unknown sector' };
      if (body.tariff !== undefined && body.tariff !== null && body.tariff !== '') {
        tariff = Number(body.tariff);
        if (!Number.isFinite(tariff) || tariff < 1 || tariff > 50) {
          return { error: 'Electricity tariff must be between Rs 1 and Rs 50 per kWh' };
        }
      }
    }
    return { accountType, sector, tariff };
  }

  /* ---------- reference data ---------- */

  app.get('/api/factors', (_req, res) => res.json(publicFactors()));

  app.get('/api/carbon-market', (_req, res) =>
    res.json({
      market: biz.INDIA_MARKET,
      sectors: biz.SECTORS,
      priceScenarios: biz.PRICE_SCENARIOS,
      defaultCreditPrice: biz.DEFAULT_CREDIT_PRICE,
      defaultTariff: biz.DEFAULT_TARIFF,
    })
  );

  /* ---------- users ---------- */

  app.post('/api/users', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2 || name.length > 30) {
      return res.status(400).json({ error: 'Name must be 2-30 characters' });
    }
    const profile = parseProfile(req.body);
    if (profile.error) return res.status(400).json({ error: profile.error });
    const info = q.createUser.run(name, profile.accountType, profile.sector, profile.tariff);
    res.status(201).json(q.getUser.get(info.lastInsertRowid));
  });

  app.put('/api/users/:id/profile', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const profile = parseProfile(req.body);
    if (profile.error) return res.status(400).json({ error: profile.error });
    q.setProfile.run(profile.accountType, profile.sector, profile.tariff, user.id);
    res.json(q.getUser.get(user.id));
  });

  app.get('/api/users/:id', (req, res) => {
    const user = requireUser(req, res);
    if (user) res.json(user);
  });

  app.put('/api/users/:id/goal', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const goal = Number(req.body?.dailyGoal);
    if (!Number.isFinite(goal) || goal < 1 || goal > 100) {
      return res.status(400).json({ error: 'Daily goal must be between 1 and 100 kg CO2e' });
    }
    q.setGoal.run(goal, user.id);
    res.json(q.getUser.get(user.id));
  });

  /* ---------- activities ---------- */

  app.post('/api/activities', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const { category, type } = req.body ?? {};
    const quantity = Number(req.body?.quantity);
    const date = req.body?.date;

    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
    }
    const emission = calcEmission(category, type, quantity);
    if (emission === null) return res.status(400).json({ error: 'Unknown activity type' });

    const info = q.insertActivity.run(user.id, category, type, quantity, emission, date);
    res.status(201).json({ id: info.lastInsertRowid, category, type, quantity, emission, date });
  });

  app.get('/api/activities', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    res.json(q.recent.all(user.id, limit));
  });

  app.delete('/api/activities/:id', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const info = q.deleteActivity.run(Number(req.params.id), user.id);
    if (!info.changes) return res.status(404).json({ error: 'Activity not found' });
    res.status(204).end();
  });

  /* ---------- dashboard ---------- */

  function buildStats(user, today) {
    const since14 = alg.addDays(today, -13);
    const acts14 = q.activitiesSince.all(user.id, since14, today);
    const since7 = alg.addDays(today, -6);
    const acts7 = acts14.filter((a) => a.date >= since7);

    const daily14 = alg.dailyTotals(acts14, today, 14);
    const daily7 = daily14.slice(-7);
    const avg7 = alg.averageDaily(daily7);
    const score = alg.ecoScore(avg7, user.dailyGoal);

    return { acts14, acts7, daily14, daily7, avg7, score };
  }

  app.get('/api/dashboard', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const today = resolveToday(req);
    const s = buildStats(user, today);

    const allActs = q.activitiesSince.all(user.id, '0000-01-01', today);
    const todayTotal = s.daily14[s.daily14.length - 1].total;

    let business = null;
    if (user.accountType === 'business') {
      const requested = Number(req.query.creditPrice);
      const creditPrice =
        Number.isFinite(requested) && requested >= 100 && requested <= 20000 ? requested : biz.DEFAULT_CREDIT_PRICE;
      const acts30 = q.activitiesSince.all(user.id, alg.addDays(today, -29), today);
      const sector = biz.sectorByKey(user.sector) || biz.sectorByKey('other');
      business = {
        sector,
        ...biz.businessPlan(acts30, { windowDays: 30, tariff: user.tariff, creditPrice }),
      };
    }

    res.json({
      user,
      business,
      today,
      todayTotal,
      avgDaily7: s.avg7,
      weekTotal: round(s.daily7.reduce((a, d) => a + d.total, 0)),
      score: s.score,
      scoreLabel: alg.scoreLabel(s.score),
      streak: alg.greenStreak(allActs, today, user.dailyGoal),
      categories: alg.categoryBreakdown(s.acts7),
      daily: s.daily14,
      forecast: alg.forecast(s.daily14, 7),
      tips: alg.generateTips(s.acts7),
    });
  });

  /* ---------- what-if simulator ---------- */

  app.post('/api/simulate', (req, res) => {
    const { category, fromType, toType } = req.body ?? {};
    const quantity = Number(req.body?.quantity);
    const result = alg.simulateSwap(category, fromType, toType, quantity);
    if (!result) return res.status(400).json({ error: 'Invalid simulation input' });
    res.json(result);
  });

  /* ---------- leaderboard ---------- */

  app.get('/api/leaderboard', (req, res) => {
    const today = resolveToday(req);
    const since7 = alg.addDays(today, -6);
    const rows = q.allUsers.all().map((u) => {
      const acts = q.activitiesSince.all(u.id, since7, today);
      const daily = alg.dailyTotals(acts, today, 7);
      const avg = alg.averageDaily(daily);
      return {
        id: u.id,
        name: u.name,
        avgDaily: avg,
        score: alg.ecoScore(avg, u.dailyGoal),
        loggedDays: daily.filter((d) => d.logged).length,
      };
    });
    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.loggedDays - a.loggedDays);
    res.json(rows.slice(0, 10));
  });

  /* ---------- error handling ---------- */

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
