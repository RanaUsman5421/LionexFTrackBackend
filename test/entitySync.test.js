const test = require('node:test');
const assert = require('node:assert/strict');

const { activityId } = require('../src/services/entitySyncService');

test('activity sync ids are stable when list order changes', () => {
  const activity = { title: 'Field Day Started', timestampMs: 1700000000000 };
  assert.equal(
    activityId(activity, 0),
    activityId(activity, 99)
  );
});

test('server-provided activity ids remain authoritative', () => {
  assert.equal(activityId({ id: 'activity-admin-1', timestampMs: 1 }), 'activity-admin-1');
});
