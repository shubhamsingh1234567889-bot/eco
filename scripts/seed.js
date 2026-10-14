'use strict';

/**
 * Fills the database with demo users and ~3 weeks of activity.
 *   npm run seed
 * (The server also does this automatically when the database is empty.)
 */

const { openDb } = require('../src/db');
const { seedDemo } = require('../src/seed');

const count = seedDemo(openDb());
console.log(`Seeded ${count} demo users (5 personal, 3 business) with 21 days of activity.`);
