'use strict';

const { createApp } = require('./src/app');
const { openDb } = require('./src/db');
const { seedIfEmpty } = require('./src/seed');

const PORT = process.env.PORT || 3000;

const db = openDb();

// Free hosts (e.g. Render) can wipe the database file on restart. Re-create the
// demo users when it is empty so the site never starts blank.
// Turn this off with AUTO_SEED=false.
if (process.env.AUTO_SEED !== 'false') {
  const added = seedIfEmpty(db);
  if (added) console.log(`Database was empty: added ${added} demo users.`);
}

createApp(db).listen(PORT, () => {
  console.log(`EcoTrack running at http://localhost:${PORT}`);
});
