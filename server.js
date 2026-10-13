'use strict';

const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3000;

createApp().listen(PORT, () => {
  console.log(`EcoTrack running at http://localhost:${PORT}`);
});
