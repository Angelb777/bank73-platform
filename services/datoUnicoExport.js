'use strict';

const DATO_UNICO_HEADERS = [
  'ETAPA', 'TORRE', 'NIVEL', 'UNIDAD', 'CLIENTE', 'ESTATUS', 'PRECIO DE VENTA',
  'MONTO CPP', 'PORCENTAJE DE FINANCIAMIENTO2', 'BANCO DEL CLIENTE',
  'AREA TERRENO M2', 'NUMERO DE FINCA', 'CODIGO DE UBICACIÓN', 'CALLE',
  'MODELO VIVIENDA', 'AREA ABIERTA VIVIENDA', 'AREA CERRADA VIVIENDA',
  'AREA TOTAL CONSTRUCCIÓN', 'RECÁMARAS', 'BAÑOS', 'PRIMER NOMBRE',
  'SEGUNDO NOMBRE', 'APELLIDO PATERNO', 'APELLIDO MATERNO', 'APELLIDO DE CASADA',
  'CEDULA', 'SEXO', 'ESTADO CIVIL', 'DIRECCIÓN', 'TELÉFONO', 'EMAIL', 'PERFIL',
  'TIPO DE EMPRESA', 'PROFESIÓN', 'INGRESO MENSUAL', 'ANTIGÜEDAD LABORAL',
  'CLIENTE 2 PRIMER NOMBRE', 'CLIENTE 2 SEGUNDO NOMBRE', 'CLIENTE 2 APELLIDO PATERNO',
  'CLIENTE 2 APELLIDO MATERNO', 'CLIENTE 2 APELLIDO DE CASADA', 'CLIENTE 2 CEDULA',
  'CLIENTE 2 SEXO', 'CLIENTE 2 ESTADO CIVIL', 'CLIENTE 2 DIRECCION',
  'CLIENTE 2 TELEFONO', 'CLIENTE 2 EMAIL', 'CLIENTE 2 PERFIL', 'TIPO DE EMPRESA2',
  'CLIENTE 2 PROFESION', 'CLIENTE 2 INGRESO MENSUAL', 'CLIENTE 2 ANTIGÜEDAD LABORAL',
  'REFERENCIA 1 - NOMBRE', 'REFERENCIA 1- RELACIÓN', 'REFERENCIA 1 - TELÉFONO',
  'REFERENCIA 2 - NOMBRE', 'REFERENCIA 2 - RELACIÓN', 'REFERENCIA 2 - TELÉFONO',
  'CAPTACIÓN DE CLIENTE', 'FECHA RESERVA', 'FECHA PROFORMA',
  'FECHA PROBABLE DE ENTREGA', 'CESIÓN A FAVOR DE', 'ESTATUS CPP', 'NUMERO CPP',
  'FECHA DE CPP', 'VENCIMIENTO CPP', 'APERTURA CUENTA BANCO', 'PÓLIZAS',
  'POLIZA DE VIDA', 'POLIZA DE INCENDIO', 'FECHA DE CONTRATO', 'MONTO CONTRATO', 'VALOR MEJORAS',
  'VALOR TERRENO', 'MINUTA LIBERACIÓN', 'MINUTA SEGREGACIÓN',
  ' RESOLUCION PERMISO CONSTRUCCION ', 'FECHA PERMISO CONSTRUCCIÓN',
  'FECHA VENCIMIENTO PERMISO CONSTRUCCION', 'PORCENTAJE AVANCE DE OBRA',
  'ESTATUS CONSTRUCCIÓN', 'RESOLUCION PERMISO OCUPACION', 'FECHA PERMISO OCUPACION',
  'CONSTRUCTOR', 'SOLICITUD AVALUO', 'FECHA AVALUO', 'EMPRESA AVALUADORA',
  'MINUTA PRÉSTAMO', 'PROTOCOLO FIRMA CLIENTE',
  'PROTOCOLO FIRMA PROMOTOR', 'FIRMA PROTOCOLO BANCO INTERINO',
  'FIRMA PROTOCOLO BANCO CLIENTE', 'FECHA PAGO IMPUESTO', 'FECHA DE ESCRITURA', 'INGRESO REGISTRO',
  'FECHA DE INSCRIPCION', 'FECHA DESEMBOLSO', 'FECHA DE ENTREGA DE VIVIENDA',
  'COMENTARIOS'
];

const DATO_UNICO_DATE_HEADERS = new Set([
  'FECHA RESERVA', 'FECHA PROFORMA', 'FECHA PROBABLE DE ENTREGA', 'FECHA DE CPP',
  'VENCIMIENTO CPP', 'FECHA DE CONTRATO', 'FECHA PERMISO CONSTRUCCIÓN',
  'FECHA VENCIMIENTO PERMISO CONSTRUCCION', 'FECHA PERMISO OCUPACION',
  'SOLICITUD AVALUO', 'FECHA AVALUO', 'PROTOCOLO FIRMA CLIENTE',
  'PROTOCOLO FIRMA PROMOTOR', 'FIRMA PROTOCOLO BANCO INTERINO',
  'FIRMA PROTOCOLO BANCO CLIENTE', 'FECHA DE ESCRITURA',
  'FECHA PAGO IMPUESTO', 'INGRESO REGISTRO', 'FECHA DE INSCRIPCION',
  'FECHA DESEMBOLSO', 'FECHA DE ENTREGA DE VIVIENDA'
]);

const DATO_UNICO_MONEY_HEADERS = new Set([
  'PRECIO DE VENTA', 'MONTO CPP', 'INGRESO MENSUAL', 'CLIENTE 2 INGRESO MENSUAL',
  'MONTO CONTRATO', 'VALOR MEJORAS', 'VALOR TERRENO'
]);

const DATO_UNICO_GROUPS = [
  { title: 'DATOS BÁSICOS', from: 1, to: 10 },
  { title: 'DATOS DE LA UNIDAD', from: 11, to: 20 },
  { title: 'DATOS DEL CLIENTE 1', from: 21, to: 36 },
  { title: 'DATOS DEL CLIENTE 2 (SI APLICA)', from: 37, to: 52 },
  { title: 'REFERENCIAS PERSONALES', from: 53, to: 59 },
  { title: 'RESERVA', from: 60, to: 64 },
  { title: 'CARTA PROMESA DE PAGO Y CONTRATO', from: 65, to: 77 },
  { title: 'CONSTRUCCIÓN', from: 78, to: 85 },
  { title: 'AVALÚO', from: 86, to: 88 },
  { title: 'PROTOCOLO / ESCRITURAS', from: 89, to: 93 },
  { title: 'CIERRE NOTARIAL / REGISTRO PÚBLICO', from: 94, to: 97 },
  { title: 'DESEMBOLSO Y ENTREGA', from: 98, to: 99 }
];

function text(value) {
  if (value == null) return '';
  return String(value).replace(/\r?\n/g, ' ').trim();
}

function number(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function yesNo(value) {
  return value ? 'SI' : 'NO';
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = number(value);
    if (parsed != null && parsed !== 0) return parsed;
  }
  return number(values[0]);
}

function statusLabel(value) {
  return ({
    disponible: 'DISPONIBLE',
    inventario: 'INVENTARIO',
    reservado: 'RESERVADO',
    con_cpp: 'CON CPP',
    tramite_legal_activado: 'TRÁMITE LEGAL ACTIVADO',
    escriturado_traspasado: 'ESCRITURADO / TRASPASADO',
    vivienda_entregada: 'VIVIENDA ENTREGADA',
    cancelado: 'CANCELADO'
  })[value] || text(value);
}

function captureChannel(venta) {
  const values = [];
  if (venta.captadoAtencionOficina) values.push('Atención en oficina');
  if (venta.captadoMailInternet) values.push('Mail / Internet');
  if (venta.captadoEnProyecto) values.push('En proyecto');
  if (venta.captadoMercadeoProspecto) values.push('Mercadeo / Prospecto');
  return values.join(' / ');
}

function buildDatoUnicoExportRow(unit, venta = {}) {
  const client = unit.clienteId || {};
  const price = number(venta.precioVenta);
  const cpp = firstNumber(venta.montoFinanciamientoCPP, venta.valor);
  const storedPercentage = number(venta.porcentajeFinanciamiento);
  const percentage = storedPercentage || (price && cpp ? Number(((cpp / price) * 100).toFixed(2)) : null);
  const openArea = firstNumber(unit.areaAbierta, venta.areaAbierta);
  const closedArea = firstNumber(unit.areaCerrada, venta.areaCerrada);
  const totalArea = firstNumber(
    unit.areaTotalConstruccion,
    venta.areaTotalConstruccion,
    Number(openArea || 0) + Number(closedArea || 0)
  );
  const lifePolicyDelivered = venta.polizaVidaEntregada === undefined
    ? Boolean(venta.polizas)
    : Boolean(venta.polizaVidaEntregada);
  const firePolicyDelivered = venta.polizaIncendioEntregada === undefined
    ? Boolean(venta.polizas)
    : Boolean(venta.polizaIncendioEntregada);
  const allPoliciesDelivered = lifePolicyDelivered && firePolicyDelivered;

  return {
    'ETAPA': text(unit.etapa),
    'TORRE': text(unit.torre || unit.viewer3D?.tower),
    'NIVEL': text(unit.nivel),
    'UNIDAD': text(unit.lote || venta.lote || unit.code),
    'CLIENTE': text(client.nombre || venta.clienteNombre),
    'ESTATUS': statusLabel(unit.estado || unit.status),
    'PRECIO DE VENTA': price,
    'MONTO CPP': cpp,
    'PORCENTAJE DE FINANCIAMIENTO2': percentage,
    'BANCO DEL CLIENTE': text(venta.banco),
    'AREA TERRENO M2': firstNumber(unit.m2, venta.metrajeLote),
    'NUMERO DE FINCA': text(unit.numeroFinca || venta.numeroFinca),
    'CODIGO DE UBICACIÓN': text(unit.codigoUbicacion || venta.codigoUbicacion),
    'CALLE': text(unit.calle || venta.calle),
    'MODELO VIVIENDA': text(unit.modelo),
    'AREA ABIERTA VIVIENDA': openArea,
    'AREA CERRADA VIVIENDA': closedArea,
    'AREA TOTAL CONSTRUCCIÓN': totalArea,
    'RECÁMARAS': firstNumber(unit.recamaras, venta.recamaras),
    'BAÑOS': firstNumber(unit.banos, venta.banos),
    'PRIMER NOMBRE': text(venta.primerNombre),
    'SEGUNDO NOMBRE': text(venta.segundoNombre),
    'APELLIDO PATERNO': text(venta.primerApellido),
    'APELLIDO MATERNO': text(venta.segundoApellido),
    'APELLIDO DE CASADA': text(venta.apellidoCasada),
    'CEDULA': text(venta.cedula || client.cedula),
    'SEXO': text(venta.sexo),
    'ESTADO CIVIL': text(venta.estadoCivil),
    'DIRECCIÓN': text(venta.direccion || client.direccion),
    'TELÉFONO': text(venta.celular || venta.telefonoResidencial || client.telefono),
    'EMAIL': text(venta.correo || client.email),
    'PERFIL': text(venta.perfilCliente),
    'TIPO DE EMPRESA': text(venta.tipoEmpresa),
    'PROFESIÓN': text(venta.profesion),
    'INGRESO MENSUAL': number(venta.ingresoMensual),
    'ANTIGÜEDAD LABORAL': text(venta.antiguedadLaboral),
    'CLIENTE 2 PRIMER NOMBRE': text(venta.cliente2PrimerNombre),
    'CLIENTE 2 SEGUNDO NOMBRE': text(venta.cliente2SegundoNombre),
    'CLIENTE 2 APELLIDO PATERNO': text(venta.cliente2PrimerApellido),
    'CLIENTE 2 APELLIDO MATERNO': text(venta.cliente2SegundoApellido),
    'CLIENTE 2 APELLIDO DE CASADA': text(venta.cliente2ApellidoCasada),
    'CLIENTE 2 CEDULA': text(venta.cliente2Cedula),
    'CLIENTE 2 SEXO': text(venta.cliente2Sexo),
    'CLIENTE 2 ESTADO CIVIL': text(venta.cliente2EstadoCivil),
    'CLIENTE 2 DIRECCION': text(venta.cliente2Direccion),
    'CLIENTE 2 TELEFONO': text(venta.cliente2Celular || venta.cliente2TelefonoResidencial),
    'CLIENTE 2 EMAIL': text(venta.cliente2Correo),
    'CLIENTE 2 PERFIL': text(venta.cliente2PerfilCliente),
    'TIPO DE EMPRESA2': text(venta.cliente2TipoEmpresa),
    'CLIENTE 2 PROFESION': text(venta.cliente2Profesion),
    'CLIENTE 2 INGRESO MENSUAL': number(venta.cliente2IngresoMensual),
    'CLIENTE 2 ANTIGÜEDAD LABORAL': text(venta.cliente2AntiguedadLaboral),
    'REFERENCIA 1 - NOMBRE': text(venta.referencia1Nombre),
    'REFERENCIA 1- RELACIÓN': text(venta.referencia1Relacion),
    'REFERENCIA 1 - TELÉFONO': text(venta.referencia1Telefono),
    'REFERENCIA 2 - NOMBRE': text(venta.referencia2Nombre),
    'REFERENCIA 2 - RELACIÓN': text(venta.referencia2Relacion),
    'REFERENCIA 2 - TELÉFONO': text(venta.referencia2Telefono),
    'CAPTACIÓN DE CLIENTE': captureChannel(venta),
    'FECHA RESERVA': date(venta.fechaReserva),
    'FECHA PROFORMA': date(venta.fechaProforma),
    'FECHA PROBABLE DE ENTREGA': date(venta.fechaProbableEntrega),
    'CESIÓN A FAVOR DE': text(venta.cesionAFavorDe),
    'ESTATUS CPP': text(venta.estatusCPP),
    'NUMERO CPP': text(venta.numCPP),
    'FECHA DE CPP': date(venta.fechaValorCPP || venta.recibidoCPP),
    'VENCIMIENTO CPP': date(venta.fechaVencimientoCPP),
    'APERTURA CUENTA BANCO': yesNo(venta.aperturaCtaBanco),
    'PÓLIZAS': yesNo(allPoliciesDelivered),
    'POLIZA DE VIDA': text(venta.tipoPolizaVida || venta.polizaVida || venta.tipoPoliza),
    'POLIZA DE INCENDIO': text(venta.tipoPolizaIncendio || venta.tipoPoliza),
    'FECHA DE CONTRATO': date(venta.fechaContratoCliente),
    'MONTO CONTRATO': firstNumber(venta.montoContrato, price),
    'VALOR MEJORAS': firstNumber(unit.valorMejoras, venta.valorMejoras),
    'VALOR TERRENO': firstNumber(unit.valorTerreno, venta.valorTerreno),
    'MINUTA LIBERACIÓN': text(venta.mLiberacion),
    'MINUTA SEGREGACIÓN': text(venta.mSegregacion),
    ' RESOLUCION PERMISO CONSTRUCCION ': text(venta.permisoConstruccionNum),
    'FECHA PERMISO CONSTRUCCIÓN': date(venta.fechaPermisoConstruccion),
    'FECHA VENCIMIENTO PERMISO CONSTRUCCION': date(venta.permisoConstruccionVencimiento),
    'PORCENTAJE AVANCE DE OBRA': number(venta.avanceConstruccionPct),
    'ESTATUS CONSTRUCCIÓN': text(venta.estatusConstruccion || venta.faseConstruccion),
    'RESOLUCION PERMISO OCUPACION': text(venta.permisoOcupacionNum),
    'FECHA PERMISO OCUPACION': date(venta.fechaEmisionPermisoOcupacion),
    'CONSTRUCTOR': text(venta.constructora),
    'SOLICITUD AVALUO': date(venta.solicitudAvaluo),
    'FECHA AVALUO': date(venta.fechaAvaluo),
    'EMPRESA AVALUADORA': text(venta.empresaAvaluadora),
    'MINUTA PRÉSTAMO': text(venta.mPrestamo),
    'PROTOCOLO FIRMA CLIENTE': date(venta.fechaProtocoloFirmaCliente),
    'PROTOCOLO FIRMA PROMOTOR': date(venta.fechaProtocoloFirmaPromotora),
    'FIRMA PROTOCOLO BANCO INTERINO': date(venta.fechaProtocoloFirmaBancoInterino),
    'FIRMA PROTOCOLO BANCO CLIENTE': date(venta.fechaProtocoloFirmaBancoCliente),
    'FECHA PAGO IMPUESTO': date(venta.fechaPagoImpuesto),
    'FECHA DE ESCRITURA': date(venta.fechaCierreEscritura || venta.fechaFirma),
    'INGRESO REGISTRO': date(venta.fechaIngresoRP) || (venta.ingresoRP ? 'SI' : ''),
    'FECHA DE INSCRIPCION': date(venta.fechaInscripcion),
    'FECHA DESEMBOLSO': date(venta.fechaDesembolso),
    'FECHA DE ENTREGA DE VIVIENDA': date(venta.fechaEntregaVivienda),
    'COMENTARIOS': text(venta.comentario)
  };
}

module.exports = {
  DATO_UNICO_HEADERS,
  DATO_UNICO_DATE_HEADERS,
  DATO_UNICO_MONEY_HEADERS,
  DATO_UNICO_GROUPS,
  buildDatoUnicoExportRow
};
