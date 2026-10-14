'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openDb } = require('../src/db');
const { seedIfEmpty } = require('../src/seed');
const { createApp } = require('../src/app');

test('seedIfEmpty adds 8 demo users once and never touches an existing database', () => {
  const db = openDb(':memory:');
  assert.equal(seedIfEmpty(db), 8);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 8);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE account_type = 'business'").get().n, 3);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n > 300);

  // second call does nothing, so real user data is never duplicated or overwritten
  assert.equal(seedIfEmpty(db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 8);
});

test('seeded business users get a business plan and the leaderboard works', async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db);
  const server = createApp(db).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const biz = db.prepare("SELECT id FROM users WHERE name = 'Bharat Cement Works'").get();
    const dash = await (await fetch(`${base}/api/dashboard?userId=${biz.id}`)).json();
    assert.equal(dash.business.sector.key, 'cement');
    assert.equal(dash.business.hasData, true);
    assert.ok(dash.business.actions.length >= 4);

    const board = await (await fetch(`${base}/api/leaderboard`)).json();
    assert.ok(board.length >= 5);
  } finally {
    server.close();
  }
});
