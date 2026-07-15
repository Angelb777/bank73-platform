const test = require('node:test');
const assert = require('node:assert/strict');
const AppSetting = require('../models/AppSetting');
const { MODULES, moduleEnabled, setModuleEnabled } = require('../services/moduleSettings');

test('funding is disabled by default while the existing providers default is preserved', async () => {
  const originalFindOne = AppSetting.findOne;
  AppSetting.findOne = () => ({ lean: async () => null });
  try {
    assert.equal(MODULES.funding.key, 'fundingModule');
    assert.equal(await moduleEnabled('funding'), false);
    assert.equal(await moduleEnabled('providers'), true);
  } finally {
    AppSetting.findOne = originalFindOne;
  }
});

test('module settings read persisted booleans and update the same AppSetting collection', async () => {
  const originalFindOne = AppSetting.findOne;
  const originalFindOneAndUpdate = AppSetting.findOneAndUpdate;
  let updateCall;
  try {
    AppSetting.findOne = () => ({ lean: async () => ({ value: { enabled: true } }) });
    assert.equal(await moduleEnabled('funding'), true);

    AppSetting.findOneAndUpdate = async (...args) => {
      updateCall = args;
      return { _id: 'setting-id', value: { enabled: false } };
    };
    await setModuleEnabled('funding', false);
    assert.deepEqual(updateCall, [
      { key: 'fundingModule' },
      { $set: { value: { enabled: false } } },
      { upsert: true, new: true }
    ]);
  } finally {
    AppSetting.findOne = originalFindOne;
    AppSetting.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
