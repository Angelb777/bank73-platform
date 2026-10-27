const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public/js/project.js'), 'utf8');
const start = source.indexOf('function commercialStageStates');
const end = source.indexOf('function renderCommercialProcessFicha', start);
const context = {};
vm.runInNewContext(`${source.slice(start, end)}; this.commercialStageStates = commercialStageStates;`, context);

test('una unidad sin datos no completa Reserva ni ninguna etapa posterior', () => {
  const states = context.commercialStageStates([
    ['', '', '', '', ''],
    ['', '', '', false, false, '', false, '', '', 0, 0, 0, '', ''],
    ['', '', ''],
    ['', '', '', '', ''],
    ['', '', '', ''],
    ['', '']
  ]);

  assert.equal(states.filter(state => state.complete).length, 0);
  assert.equal(states[0].filled, 0);
  assert.equal(states[0].label, 'En curso');
  assert.equal(states[1].filled, 0);
  assert.equal(states[1].label, 'Pendiente');
});

test('ceros formateados no cuentan como información del proceso', () => {
  const states = context.commercialStageStates([
    ['', '', '', '', ''],
    ['', '', '', false, false, '', false, '', '', '0', '0.00', '0,00', '', ''],
    ['', '', ''], ['', '', '', '', ''], ['', '', '', ''], ['', '']
  ]);

  assert.equal(states[1].filled, 0);
  assert.equal(states.some(state => state.complete), false);
});

test('los valores comerciales reales siguen contando para el avance', () => {
  const states = context.commercialStageStates([
    ['2026-10-27', '', '', '', ''],
    ['CPP-101', '', '', false, false, '', false, '', '', 120000, 0, 0, '', ''],
    ['', '', ''], ['', '', '', '', ''], ['', '', '', ''], ['', '']
  ]);

  assert.equal(states[0].filled, 1);
  assert.equal(states[1].filled, 2);
});
