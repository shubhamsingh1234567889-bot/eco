'use strict';

/**
 * Demo data: 5 personal users and 3 business users with ~3 weeks of activity.
 * Used by `npm run seed` and, on startup, whenever the database is empty
 * (free hosting often wipes the database file on restart).
 */

const { calcEmission } = require('./emissions');
const { toDateStr, addDays } = require('./algorithms');

const PERSONAL = [
  { name: 'Aarav', car: 18, bus: 6, beef: 0.5, veg: 1.6, kwh: 7 },
  { name: 'Meera', car: 4, bus: 3, beef: 0.1, veg: 2.2, kwh: 5 },
  { name: 'Kabir', car: 30, bus: 0, beef: 1, veg: 1, kwh: 11 },
  { name: 'Ananya', car: 0, bus: 10, beef: 0, veg: 2.5, kwh: 4 },
  { name: 'Rohan', car: 22, bus: 2, beef: 0.7, veg: 1.2, kwh: 9 },
];

// per-day averages for a small business
const BUSINESS = [
  { name: 'Sharma Textiles', sector: 'textiles', tariff: 8.5, kwh: 420, diesel: 90, petrol: 0, lpg: 6, waste: 25, flightEvery: 0 },
  { name: 'Bharat Cement Works', sector: 'cement', tariff: 7.5, kwh: 900, diesel: 220, petrol: 0, lpg: 0, waste: 40, flightEvery: 7 },
  { name: 'GreenCrate Logistics', sector: 'other', tariff: 9, kwh: 150, diesel: 600, petrol: 100, lpg: 0, waste: 12, flightEvery: 0 },
];

const jitter = (v) => Math.max(0, Math.round(v * (0.7 + Math.random() * 0.6) * 10) / 10);

function seedDemo(db, today = toDateStr(new Date())) {
  const insertUser = db.prepare('INSERT INTO users (name, account_type, sector, tariff) VALUES (?, ?, ?, ?)');
  const insertAct = db.prepare(
    'INSERT INTO activities (user_id, category, type, quantity, emission, date) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const add = (userId, date, rows) => {
    for (const [category, type, quantity] of rows) {
      if (quantity > 0) insertAct.run(userId, category, type, quantity, calcEmission(category, type, quantity), date);
    }
  };

  const run = db.transaction(() => {
    for (const p of PERSONAL) {
      const id = insertUser.run(p.name, 'personal', null, 8).lastInsertRowid;
      for (let i = 20; i >= 0; i--) {
        const improve = 1 - (20 - i) * 0.01; // gentle improvement so the trend tells a story
        add(id, addDays(today, -i), [
          ['transport', 'car_petrol', jitter(p.car * improve)],
          ['transport', 'bus', jitter(p.bus)],
          ['food', 'beef_meal', Math.random() < p.beef ? 1 : 0],
          ['food', 'vegetarian_meal', Math.round(p.veg)],
          ['energy', 'electricity_kwh', jitter(p.kwh)],
        ]);
      }
    }
    for (const b of BUSINESS) {
      const id = insertUser.run(b.name, 'business', b.sector, b.tariff).lastInsertRowid;
      for (let i = 20; i >= 0; i--) {
        add(id, addDays(today, -i), [
          ['energy', 'electricity_kwh', jitter(b.kwh)],
          ['transport', 'car_diesel', jitter(b.diesel)],
          ['transport', 'car_petrol', jitter(b.petrol)],
          ['energy', 'lpg_kg', jitter(b.lpg)],
          ['waste', 'general_waste_kg', jitter(b.waste)],
          ['transport', 'flight_short', b.flightEvery && i % b.flightEvery === 0 ? 300 : 0],
        ]);
      }
    }
  });
  run();
  return PERSONAL.length + BUSINESS.length;
}

/** Seeds only when there are no users. Returns the number of users added (0 if skipped). */
function seedIfEmpty(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  return n === 0 ? seedDemo(db) : 0;
}

module.exports = { seedDemo, seedIfEmpty };
