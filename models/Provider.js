const mongoose = require('mongoose');

const PROVIDER_STAGE_SERVICES = {
  'Antes de comprar el suelo': ['Urbanista', 'Arquitecto', 'Estudio de viabilidad', 'Tasador', 'Abogado urbanístico'],
  'Desarrollo del proyecto': ['Arquitecto', 'Ingeniero', 'Topógrafo', 'Geotécnico', 'Licencias', 'Consultores'],
  Financiación: ['Bancos', 'Fideicomisos', 'Avales', 'Seguros', 'Due diligence'],
  Construcción: ['Constructora', 'Dirección facultativa', 'Project Manager', 'Seguridad y salud', 'Laboratorio de materiales', 'Organismo de control'],
  Seguimiento: ['Banco', 'Promotor', 'Avaluador', 'Inspector', 'Fotografías', 'Informes', 'Desembolsos'],
  Comercialización: ['CRM', 'Comercializadora', 'Tour 3D', 'Marketing', 'Hipotecas para compradores'],
  Entrega: ['Notaría', 'Escrituración', 'Registro', 'Postventa']
};

const PROVIDER_STAGES = Object.keys(PROVIDER_STAGE_SERVICES);
const PROVIDER_SERVICES = Array.from(new Set(Object.values(PROVIDER_STAGE_SERVICES).flat()));

const providerSchema = new mongoose.Schema({
  commercialName: { type: String, required: true, trim: true, maxlength: 160 },
  logoUrl: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, maxlength: 700, default: '' },
  country: { type: String, trim: true, maxlength: 100, default: '' },
  city: { type: String, trim: true, maxlength: 100, default: '' },
  stage: { type: String, required: true, enum: PROVIDER_STAGES, index: true },
  serviceType: { type: String, required: true, enum: PROVIDER_SERVICES, index: true },
  specialty: { type: String, trim: true, maxlength: 220, default: '' },
  exclusiveCondition: { type: String, trim: true, maxlength: 220, default: '' },
  phone: { type: String, trim: true, maxlength: 80, default: '' },
  email: { type: String, trim: true, lowercase: true, maxlength: 180, default: '' },
  website: { type: String, trim: true, maxlength: 240, default: '' },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

providerSchema.pre('validate', function (next) {
  if (this.stage && this.serviceType) {
    const allowed = PROVIDER_STAGE_SERVICES[this.stage] || [];
    if (!allowed.includes(this.serviceType)) {
      this.invalidate('serviceType', 'El tipo de servicio no corresponde a la etapa seleccionada.');
    }
  }
  next();
});

providerSchema.index({ stage: 1, serviceType: 1, isActive: 1, commercialName: 1 });

module.exports = mongoose.model('Provider', providerSchema);
module.exports.PROVIDER_STAGE_SERVICES = PROVIDER_STAGE_SERVICES;
module.exports.PROVIDER_STAGES = PROVIDER_STAGES;
module.exports.PROVIDER_SERVICES = PROVIDER_SERVICES;
