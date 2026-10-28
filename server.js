'use strict';

require('dotenv').config();

const { createApp } = require('./src/app');

// Catalyst AppSail injects X_ZOHO_CATALYST_LISTEN_PORT; PORT is used elsewhere (Render, local).
const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 3000;

createApp().listen(PORT, '0.0.0.0', () => {
  console.log(`EcoTrack running on port ${PORT}`);
});
