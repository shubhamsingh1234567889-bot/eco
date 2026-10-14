'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

async function withServer(fn) {
  const app = createApp(openDb(':memory:'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

test('full flow: create user, log activities, read dashboard, delete', async () => {
  await withServer(async (call) => {
    const bad = await call('/api/users', 'POST', { name: 'x' });
    assert.equal(bad.status, 400);

    const user = (await call('/api/users', 'POST', { name: 'Asha' })).body;
    assert.equal(user.name, 'Asha');
    assert.equal(user.dailyGoal, 8);

    const today = '2026-10-13';
    const logged = await call('/api/activities', 'POST', {
      userId: user.id, category: 'transport', type: 'car_petrol', quantity: 10, date: today,
    });
    assert.equal(logged.status, 201);
    assert.equal(logged.body.emission, 1.92);

    await call('/api/activities', 'POST', {
      userId: user.id, category: 'food', type: 'beef_meal', quantity: 1, date: today,
    });

    const dash = (await call(`/api/dashboard?userId=${user.id}&today=${today}`)).body;
    assert.equal(dash.todayTotal, 7.92);
    assert.equal(dash.categories.transport, 1.92);
    assert.equal(dash.categories.food, 6);
    assert.ok(dash.score > 0);
    assert.ok(dash.tips.length >= 1);

    const board = (await call(`/api/leaderboard?today=${today}`)).body;
    assert.equal(board[0].name, 'Asha');

    const del = await call(`/api/activities/${logged.body.id}?userId=${user.id}`, 'DELETE');
    assert.equal(del.status, 204);
    const again = await call(`/api/activities/${logged.body.id}?userId=${user.id}`, 'DELETE');
    assert.equal(again.status, 404);
  });
});

test('validation rejects bad input', async () => {
  await withServer(async (call) => {
    const user = (await call('/api/users', 'POST', { name: 'Ravi' })).body;
    const base = { userId: user.id, category: 'transport', type: 'bus', quantity: 5, date: '2026-10-13' };

    assert.equal((await call('/api/activities', 'POST', { ...base, category: 'magic' })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, type: 'jetpack' })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, quantity: -3 })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, date: 'yesterday' })).status, 400);
    assert.equal((await call('/api/activities', 'POST', { ...base, userId: 999 })).status, 404);
    assert.equal((await call(`/api/users/${user.id}/goal`, 'PUT', { dailyGoal: 0 })).status, 400);

    const goal = await call(`/api/users/${user.id}/goal`, 'PUT', { dailyGoal: 6 });
    assert.equal(goal.body.dailyGoal, 6);
  });
});

test('business profile, India market info and savings plan', async () => {
  await withServer(async (call) => {
    const market = (await call('/api/carbon-market')).body;
    assert.equal(market.sectors.length, 10);
    assert.ok(market.market.blocks.length >= 5);
    assert.ok(market.market.sources.every((s) => s.url.startsWith('https://')));

    // personal accounts get no business section
    const me = (await call('/api/users', 'POST', { name: 'Personal' })).body;
    assert.equal(me.accountType, 'personal');
    const today = '2026-10-13';
    const dashPersonal = (await call(`/api/dashboard?userId=${me.id}&today=${today}`)).body;
    assert.equal(dashPersonal.business, null);

    // invalid profile values are rejected
    assert.equal((await call('/api/users', 'POST', { name: 'Bad Co', accountType: 'company' })).status, 400);
    assert.equal((await call('/api/users', 'POST', { name: 'Bad Co', accountType: 'business', sector: 'mining' })).status, 400);
    assert.equal((await call('/api/users', 'POST', { name: 'Bad Co', accountType: 'business', tariff: 0 })).status, 400);

    // business account
    const biz = (await call('/api/users', 'POST', {
      name: 'Shree Textiles', accountType: 'business', sector: 'textiles', tariff: 9,
    })).body;
    assert.equal(biz.accountType, 'business');
    assert.equal(biz.sector, 'textiles');
    assert.equal(biz.tariff, 9);

    const empty = (await call(`/api/dashboard?userId=${biz.id}&today=${today}`)).body;
    assert.equal(empty.business.hasData, false);
    assert.equal(empty.business.sector.route, 'obligated');

    await call('/api/activities', 'POST', {
      userId: biz.id, category: 'energy', type: 'electricity_kwh', quantity: 1000, date: today,
    });
    await call('/api/activities', 'POST', {
      userId: biz.id, category: 'transport', type: 'car_diesel', quantity: 300, date: today,
    });

    const dash = (await call(`/api/dashboard?userId=${biz.id}&today=${today}`)).body;
    assert.equal(dash.business.tariff, 9);
    assert.ok(dash.business.actions.length >= 3);
    assert.ok(dash.business.totals.costSavingINR > 0);
    const defaultCredit = dash.business.totals.creditValueINR;

    // a higher credit price raises credit value; junk prices fall back to the default
    const pricey = (await call(`/api/dashboard?userId=${biz.id}&today=${today}&creditPrice=3900`)).body;
    assert.ok(pricey.business.totals.creditValueINR > defaultCredit * 3);
    const junk = (await call(`/api/dashboard?userId=${biz.id}&today=${today}&creditPrice=abc`)).body;
    assert.equal(junk.business.totals.creditValueINR, defaultCredit);

    // switch a personal account to business, then back
    const upd = await call(`/api/users/${me.id}/profile`, 'PUT', { accountType: 'business', sector: 'other', tariff: 7.5 });
    assert.equal(upd.body.accountType, 'business');
    const back = await call(`/api/users/${me.id}/profile`, 'PUT', { accountType: 'personal' });
    assert.equal(back.body.accountType, 'personal');
    assert.equal(back.body.sector, null);
    assert.equal((await call(`/api/users/${me.id}/profile`, 'PUT', { accountType: 'business', sector: 'nope' })).status, 400);
  });
});

test('simulate endpoint', async () => {
  await withServer(async (call) => {
    const ok = await call('/api/simulate', 'POST', {
      category: 'food', fromType: 'beef_meal', toType: 'vegan_meal', quantity: 2,
    });
    assert.equal(ok.body.savingKg, 10.8);
    const bad = await call('/api/simulate', 'POST', { category: 'food', fromType: 'x', toType: 'y', quantity: 2 });
    assert.equal(bad.status, 400);
  });
});
