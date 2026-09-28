const test = require('node:test');
const assert = require('node:assert/strict');
const isp = require('../src/pika-isp');
test('PikaISP plans and fictional game are configured', () => { assert.equal(isp.PLANS.fishnet.price, 150); assert.equal(isp.PLANS.gigabit.downloadMbps, 1000); assert.equal(isp.GAMES.fish_simulator.size, 5 * isp.GB); });
test('PikaPC state is virtual and starts with 128 GB', async () => { await isp._resetForTests(); const s = await isp.status('test-user'); assert.equal(s.pc.capacity, 128 * isp.GB); assert.equal(s.pc.used, 0); });
test('Fish Simulator requires installation and does not alter Fish economy', async () => { await isp._resetForTests(); assert.equal((await isp.fish('test-user')).error, 'install'); });
