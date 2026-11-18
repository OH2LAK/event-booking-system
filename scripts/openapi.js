'use strict';
// Prints the OpenAPI description of the public API: npm run openapi  (writes docs/openapi.json)
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://your-event.example.com';
console.log(JSON.stringify(require('../src/openapi').build(), null, 2));
