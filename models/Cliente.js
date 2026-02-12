const mongoose = require('mongoose');

const ClienteSchema = new mongoose.Schema({
  nombre:   { type: String, required: true },
  cedula:   { type: String },
  empresa:  { type: String },
  telefono: { type: String },
  email:    { type: String },
  direccion:{ type: String }
}, { timestamps: true });

module.exports = mongoose.model('Cliente', ClienteSchema);
