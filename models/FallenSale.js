'use strict';

const mongoose = require('mongoose');

const FallenSaleSchema = new mongoose.Schema({
  tenantKey: { type: String, required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null, index: true },
  sourceVentaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venta', default: null },

  unidadLabel: { type: String, trim: true, default: '' },
  manzana: { type: String, trim: true, default: '' },
  lote: { type: String, trim: true, default: '' },
  modelo: { type: String, trim: true, default: '' },

  clienteNombre: { type: String, trim: true, default: '' },
  cedula: { type: String, trim: true, default: '' },
  celular: { type: String, trim: true, default: '' },
  correo: { type: String, trim: true, lowercase: true, default: '' },
  cliente2Nombre: { type: String, trim: true, default: '' },
  cliente2Cedula: { type: String, trim: true, default: '' },

  fechaCaida: { type: Date, required: true, index: true },
  motivoCaida: { type: String, trim: true, default: 'Desistimiento del cliente' },
  observaciones: { type: String, trim: true, default: '' },
  precioVenta: { type: Number, min: 0, default: 0 },
  banco: { type: String, trim: true, default: '' },
  origen: { type: String, enum: ['automatico', 'manual'], required: true, default: 'manual' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deletedAt: { type: Date, default: null, index: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

FallenSaleSchema.index({ tenantKey: 1, projectId: 1, fechaCaida: -1 });
FallenSaleSchema.index({ tenantKey: 1, sourceVentaId: 1, fechaCaida: -1 });

module.exports = mongoose.model('FallenSale', FallenSaleSchema);
