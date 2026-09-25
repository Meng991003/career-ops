// server/http-tests.mjs
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Readable } from 'stream';
const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const pass = m => { console.log(`PASS ${m}`); passed++; };
const fail = m => { console.error(`FAIL ${m}`); failed++; };
const ok = (c, m) => c ? pass(m) : fail(m);

const { readRawBody } = await import(join(HERE, 'lib/http.mjs'));

function mkReq(chunks) { const r = Readable.from(chunks); r.destroy = () => r.emit('close'); return r; }

const buf = await readRawBody(mkReq([Buffer.from('hello '), Buffer.from('world')]));
ok(Buffer.isBuffer(buf), 'returns a Buffer');
ok(buf.toString() === 'hello world', 'concatenates chunks in order');

const empty = await readRawBody(mkReq([]));
ok(empty.length === 0, 'empty body → empty Buffer');

let threw = false;
try { await readRawBody(mkReq([Buffer.alloc(9_000_000)])); } catch { threw = true; }
ok(threw, 'oversize (>8MB) rejects');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
