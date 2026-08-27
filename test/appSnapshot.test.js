const test = require('node:test');
const assert = require('node:assert/strict');

const AppSnapshot = require('../src/models/AppSnapshot');
const { deleteLead } = require('../src/services/appDataService');

test('legacy Android activity entries without ids pass snapshot validation', async () => {
  const snapshot = new AppSnapshot({
    employeeId: 'EMP-TEST',
    activityLog: [{
      title: 'Field Day Started',
      timestampMs: 1700000000000,
    }],
  });

  await snapshot.validate();
  assert.match(snapshot.activityLog[0].id, /^activity-/);
});

test('lead deletion repairs missing activity ids before saving a legacy snapshot', async () => {
  const snapshot = new AppSnapshot({
    employeeId: 'EMP-DELETE',
    leads: [{ id: 'LEAD-1', brand: 'Urban Cary' }],
    activityLog: [{ id: 'temporary', title: 'Field Day Started', timestampMs: 1700000000000 }],
  });
  snapshot.activityLog[0].id = undefined;
  snapshot.save = async () => snapshot.validate();

  const originalFindOne = AppSnapshot.findOne;
  AppSnapshot.findOne = () => ({ select: async () => snapshot });

  try {
    const deleted = await deleteLead('EMP-DELETE', 'LEAD-1');

    assert.equal(deleted.id, 'LEAD-1');
    assert.equal(snapshot.leads.length, 0);
    assert.equal(snapshot.activityLog[0].id, 'activity-1700000000000-0');
  } finally {
    AppSnapshot.findOne = originalFindOne;
  }
});
