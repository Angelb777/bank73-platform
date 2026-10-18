'use strict';

require('dotenv').config();

const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const Project = require('../models/Project');
const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const ProjectFinance = require('../models/ProjectFinance');

function money(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '')
    .replace(/B\/\.|\$|\s/g, '')
    .replace(/,/g, '')
    .replace(/^-$/, '0');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function normalizeUnit(value) {
  return String(value ?? '').toUpperCase().match(/L-?\d{3}/)?.[0]?.replace(/^L(\d)/, 'L-$1') || '';
}

function workbookSummary(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const balances = XLSX.utils.sheet_to_json(workbook.Sheets['ABONOS EL PALMAR'], { header: 1, defval: null });
  const commercial = XLSX.utils.sheet_to_json(workbook.Sheets.Hoja1, { header: 1, defval: null });
  const balanceRows = balances.slice(2).filter(row => normalizeUnit(row[0]));
  const commercialRows = commercial.slice(1).filter(row => normalizeUnit(row[0]));
  const balanceUnits = balanceRows.map(row => normalizeUnit(row[0]));
  const duplicateBalanceUnits = [...new Set(balanceUnits.filter((unit, index) => balanceUnits.indexOf(unit) !== index))];
  const statusCounts = {};
  commercialRows.forEach(row => {
    const status = String(row[3] || 'SIN ESTADO').trim().toUpperCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  return {
    file: path.basename(workbookPath),
    sheets: workbook.SheetNames,
    balances: {
      rows: balanceRows.length,
      units: [...new Set(balanceUnits)].length,
      duplicateUnits: duplicateBalanceUnits,
      salePrice: balanceRows.reduce((sum, row) => sum + money(row[2]), 0),
      collected: balanceRows.reduce((sum, row) => sum + money(row[3]), 0),
      priceBalance: balanceRows.reduce((sum, row) => sum + money(row[4]), 0),
      totalReceivable: balanceRows.reduce((sum, row) => sum + money(row[10]), 0)
    },
    commercial: {
      rows: commercialRows.length,
      units: [...new Set(commercialRows.map(row => normalizeUnit(row[0])))].length,
      statuses: statusCounts,
      unitsWithPaymentTerms: commercialRows.filter(row => String(row[8] || '').trim().toUpperCase() === 'SI').length
    }
  };
}

async function databaseSummary() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no está configurado');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const projects = await Project.find({ name: { $regex: '(PALM|PALMAR)', $options: 'i' } }).lean();
  const result = [];
  for (const project of projects) {
    const [units, ventas, finance] = await Promise.all([
      Unit.find({ projectId: project._id, deletedAt: null }).lean(),
      Venta.find({ projectId: project._id, deletedAt: null }).lean(),
      ProjectFinance.findOne({ project: project._id }).lean()
    ]);
    const states = {};
    units.forEach(unit => { states[unit.estado] = (states[unit.estado] || 0) + 1; });
    const ventasByUnit = new Map(ventas.map(venta => [String(venta.unitId), venta]));
    const unitRows = units
      .map(unit => {
        const venta = ventasByUnit.get(String(unit._id));
        return {
          unitId: String(unit._id),
          level: unit.manzana,
          unit: unit.lote,
          model: unit.modelo,
          area: Number(unit.areaTotalConstruccion || unit.m2 || 0),
          listPrice: Number(unit.precioLista || 0),
          salePrice: Number(venta?.precioVenta || venta?.valor || 0),
          collected: Number(venta?.abonoCliente || venta?.abonoInicial || 0),
          status: unit.estado,
          constructionStatus: venta?.estatusConstruccion || '',
          constructionPhase: venta?.faseConstruccion || '',
          underConstruction: !!venta?.enConstruccion,
          deliveredAt: venta?.fechaEntregaVivienda || null
        };
      })
      .sort((a, b) => String(a.level).localeCompare(String(b.level)) || String(a.unit).localeCompare(String(b.unit)));
    result.push({
      id: String(project._id),
      name: project.name,
      tenantKey: project.tenantKey,
      status: project.status,
      publishStatus: project.publishStatus,
      projectKpis: {
        unitsTotal: project.unitsTotal,
        unitsSold: project.unitsSold,
        budgetApproved: project.budgetApproved,
        budgetSpent: project.budgetSpent,
        loanApproved: project.loanApproved,
        loanDisbursed: project.loanDisbursed
      },
      units: units.length,
      unitStates: states,
      levels: [...new Set(units.map(unit => unit.manzana))].sort(),
      listPrice: units.reduce((sum, unit) => sum + Number(unit.precioLista || 0), 0),
      ventas: ventas.length,
      ventasPrice: ventas.reduce((sum, venta) => sum + Number(venta.precioVenta || venta.valor || 0), 0),
      ventasCollected: ventas.reduce((sum, venta) => sum + Number(venta.abonoCliente || venta.abonoInicial || 0), 0),
      finance: finance ? {
        phases: finance.phases?.length || 0,
        loanLines: finance.loanLines?.length || 0,
        unitAmortizations: finance.unitAmortizations?.length || 0
      } : null,
      unitRows
    });
  }
  return result;
}

async function main() {
  const workbookPath = process.argv[2];
  if (!workbookPath) throw new Error('Uso: node scripts/audit-el-palmar.js <archivo.xlsx>');
  const workbook = workbookSummary(workbookPath);
  const database = await databaseSummary();
  console.log(JSON.stringify({ workbook, database }, null, 2));
}

main()
  .catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
