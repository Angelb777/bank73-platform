const mongoose = require('mongoose');

const templateSectionSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 64,
    match: /^[a-z0-9][a-z0-9_-]*$/
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 180
  },
  weight: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  order: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isInteger
  }
}, { _id: false });

const avaluationTemplateSchema = new mongoose.Schema({
  bankTenantKey: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 180
  },
  version: {
    type: Number,
    required: true,
    min: 1,
    validate: Number.isInteger
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'retired'],
    default: 'draft',
    required: true,
    index: true
  },
  sections: {
    type: [templateSectionSchema],
    required: true,
    validate: {
      validator(sections) {
        if (!Array.isArray(sections) || !sections.length) return false;
        const keys = sections.map(section => String(section.key || '').trim().toLowerCase());
        if (new Set(keys).size !== keys.length) return false;
        const orders = sections.map(section => section.order);
        if (new Set(orders).size !== orders.length) return false;
        const total = sections.reduce((sum, section) => sum + Number(section.weight || 0), 0);
        return Math.abs(total - 100) < 0.000001;
      },
      message: 'Las secciones deben tener keys y orders unicos y sus pesos deben sumar 100.'
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true, versionKey: false });

avaluationTemplateSchema.index(
  { bankTenantKey: 1, version: 1 },
  { unique: true }
);
avaluationTemplateSchema.index(
  { bankTenantKey: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('AvaluationTemplate', avaluationTemplateSchema);
