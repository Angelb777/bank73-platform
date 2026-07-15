const AppSetting = require('../models/AppSetting');

const MODULES = Object.freeze({
  providers: { key: 'providersModule', defaultEnabled: true },
  funding: { key: 'fundingModule', defaultEnabled: false }
});

function moduleDefinition(name) {
  const definition = MODULES[name];
  if (!definition) throw new Error(`Módulo desconocido: ${name}`);
  return definition;
}

async function moduleEnabled(name) {
  const definition = moduleDefinition(name);
  const setting = await AppSetting.findOne({ key: definition.key }).lean();
  return typeof setting?.value?.enabled === 'boolean'
    ? setting.value.enabled
    : definition.defaultEnabled;
}

async function setModuleEnabled(name, enabled) {
  const definition = moduleDefinition(name);
  return AppSetting.findOneAndUpdate(
    { key: definition.key },
    { $set: { value: { enabled: enabled === true } } },
    { upsert: true, new: true }
  );
}

module.exports = { MODULES, moduleEnabled, setModuleEnabled };
