const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_ID, formatStaffList } = require('../src/staff-list-core');

test('staff list dynamically renders mentions and plural count', () => {
  assert.equal(ROLE_ID, '1551168459159896166');
  assert.equal(formatStaffList([{ id: '100' }, { id: '200' }, { id: '300' }]), '🐧 PikaStudio Staff\n\nThese are the currently verified PikaStudio staff members.\n\n<@100>\n<@200>\n<@300>\n\n3 verified staff members');
});

test('staff list uses singular wording for one member', () => {
  assert.match(formatStaffList([{ id: '100' }]), /1 verified staff member$/);
});

test('staff list handles zero members with the requested empty message', () => {
  assert.equal(formatStaffList([]), '🐧 PikaStudio Staff\n\nThese are the currently verified PikaStudio staff members.\n\nNo verified staff members currently.\n\n0 verified staff members');
});
