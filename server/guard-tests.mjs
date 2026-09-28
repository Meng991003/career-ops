// server/guard-tests.mjs
import { isAllowedRequest } from './lib/guard.mjs';

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { console.log(`PASS ${m}`); passed++; } else { console.error(`FAIL ${m}`); failed++; } };
const req = (method, headers) => ({ method, headers, socket: { localPort: 3700 } });

ok(isAllowedRequest(req('GET', { host: '127.0.0.1:3700' })), 'same-host GET allowed');
ok(isAllowedRequest(req('GET', { host: 'localhost:3700' })), 'localhost GET allowed');
ok(!isAllowedRequest(req('GET', { host: 'evil.example:3700' })), 'foreign Host rejected (DNS rebinding)');
ok(isAllowedRequest(req('POST', { host: '127.0.0.1:3700', origin: 'http://127.0.0.1:3700' })), 'same-origin POST allowed');
ok(isAllowedRequest(req('PATCH', { host: '127.0.0.1:3700', origin: 'http://localhost:3700' })), 'localhost-origin PATCH allowed');
ok(!isAllowedRequest(req('POST', { host: '127.0.0.1:3700', origin: 'https://evil.example' })), 'cross-origin POST rejected');
ok(!isAllowedRequest(req('POST', { host: '127.0.0.1:3700' })), 'POST without Origin rejected');
ok(!isAllowedRequest(req('POST', { host: '127.0.0.1:3700', origin: 'null' })), 'opaque "null" Origin rejected');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
