#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const PermitTemplate = require('../models/PermitTemplate');

function withType(items, type) {
  return items.map(i => ({ ...i, type }));
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[Mongo] conectado');

  // ⚠️ cambia según tu tenant real
  const tenantKey = 'bancodemo';

  /* =========================================================
   *  PLANTILLA 1: RESIDENCIA UNIFAMILIAR (alineada con Excel)
   * ========================================================= */
  const RU_items = [
    // ========= ANTEPROYECTO =========
    ...withType([
      {
        code: 'ru-anteproy-bomberos',
        title: 'Anteproyecto - Bomberos',
        institution: 'Benemérito Cuerpo de Bomberos',
        requirements: [
          'Memorial dirigido al Director General solicitando revisión de planos de anteproyecto (firmada y sellada por idóneo).',
          'Factura de pago de revisión de anteproyecto.',
          'Plano de anteproyecto (original/copia) para revisión o revalidación.'
        ],
        observations: [
          'Si la residencia pertenece a un modelo de urbanización, anexar nota de la promotora indicando el valor del proyecto.'
        ],
        slaDays: 8
      },
      {
        code: 'ru-anteproy-municipio',
        title: 'Anteproyecto - Municipio',
        institution: 'Municipio',
        requirements: [
          'Solicitud de revisión de planos para anteproyecto firmada y sellada por el idóneo y el propietario.',
          'Paz y salvo municipal del idóneo y del propietario (la finca debe estar registrada en el municipio).',
          'Original y copia del plano de anteproyecto (aprobado previamente por Bomberos).',
          'Copia del plano de la finca.'
        ],
        observations: [
          'Para lotes en urbanización nueva: anexar plano de lotificación aprobado y resolución del EIA.'
        ],
        slaDays: 7
      }
    ], 'Anteproyecto'),

    // ========= PERMISO PROVISIONAL =========
    ...withType([
      {
        code: 'ru-prov-municipio',
        title: 'Permiso Provisional - Municipio',
        institution: 'Municipio',
        dependencies: ['ru-anteproy-bomberos', 'ru-anteproy-municipio'],
        requirements: [
          'Solicitud de licencia de construcción (formato Ing. Municipal) firmada por el propietario e idóneo.',
          'Paz y salvo municipal del constructor y propietario.',
          'Pago y sello de tasa de aseo de la finca o propiedad.',
          'Certificación de registro público de la sociedad (si aplica).'
        ],
        observations: [
          'Se coordina inspección con funcionario de Ing. Municipal y el profesional responsable; marcar línea de propiedad y línea de construcción en campo.'
        ],
        slaDays: 4
      }
    ], 'Permiso Provisional'),

    // ========= APROBACIONES DE PLANOS DE CONSTRUCCIÓN (técnicas) =========
    ...withType([
      {
        code: 'ru-planos-minsa',
        title: 'Aprobación de Planos de Construcción - MINSA',
        institution: 'Ministerio de Salud (MINSA)',
        dependencies: ['ru-anteproy-bomberos', 'ru-anteproy-municipio'],
        requirements: [
          'Plano completo de construcción con sello y firma de los idóneos.',
          'Prueba de percolación del terreno.',
          'Copia del plano de finca aprobado.',
          'Inspección de campo por parte de funcionario de saneamiento ambiental.'
        ],
        slaDays: 3
      },
      {
        code: 'ru-planos-idaan',
        title: 'Aprobación de Planos de Construcción - IDAAN',
        institution: 'IDAAN',
        dependencies: ['ru-anteproy-bomberos', 'ru-anteproy-municipio'],
        requirements: [
          'Plano original completo de construcción con firma y sello de idóneos.'
        ],
        slaDays: 3
      },
      {
        code: 'ru-planos-cw',
        title: 'Aprobación de Planos de Construcción - Cable & Wireless',
        institution: 'Cable & Wireless',
        dependencies: ['ru-anteproy-bomberos', 'ru-anteproy-municipio'],
        requirements: [
          'Plano original de la parte eléctrica indicando el esquema de telefonía, sellado por idóneo.'
        ],
        slaDays: 3
      },
      {
        code: 'ru-planos-bomberos',
        title: 'Aprobación de Planos de Construcción - Bomberos',
        institution: 'Benemérito Cuerpo de Bomberos',
        dependencies: ['ru-anteproy-bomberos'],
        requirements: [
          'Memorial solicitando revisión de planos de construcción (firmada y sellada por idóneo).',
          'Factura de pago correspondiente.',
          'Planos de construcción completos, firmados por los idóneos.'
        ],
        observations: [
          'Adjuntar factura de pago del anteproyecto y memorial de revisión de Bomberos.',
          'Si el plano no pasa de 10 kVA no necesita (según criterio local).'
        ],
        slaDays: 15
      },
      {
        code: 'ru-planos-fenosa',
        title: 'Aprobación de Planos de Construcción - Empresa Distribuidora',
        institution: 'Fenosa (Distribuidora)',
        dependencies: ['ru-anteproy-bomberos', 'ru-anteproy-municipio'],
        requirements: [
          'Nota de solicitud de revisión, firmada y sellada por idóneo y propietario.'
        ],
        slaDays: 5
      }
    ], 'Aprobaciones de Planos'),

    // ========= REVISIÓN DE PLANOS (MUNICIPIO) =========
    ...withType([
      {
        code: 'ru-revision-planos-municipio',
        title: 'Revisión de Planos de Construcción - Municipio',
        institution: 'Municipio',
        dependencies: [
          'ru-planos-minsa',
          'ru-planos-idaan',
          'ru-planos-cw',
          'ru-planos-bomberos',
          'ru-planos-fenosa'
        ],
        requirements: [
          'Solicitud de revisión de planos de construcción (formato Ing. Municipal) firmada y sellada por idóneo y propietario.',
          'Paz y salvo municipal del idóneo y del propietario.',
          'Original y copia del plano de construcción con aprobaciones técnicas previas.'
        ],
        observations: [
          'Si pertenece a una urbanización, anexar plano de movimiento de tierra aprobado.'
        ],
        slaDays: 5
      }
    ], 'Revisión de Planos'),

    // ========= PERMISO DE CONSTRUCCIÓN =========
    ...withType([
      {
        code: 'ru-construccion-municipio',
        title: 'Permiso de Construcción - Municipio',
        institution: 'Municipio',
        dependencies: [
          'ru-prov-municipio',
          'ru-revision-planos-municipio'
        ],
        requirements: [
          'Solicitud de licencia de construcción (formato Ing. Municipal) firmada y sellada.',
          'Paz y salvo municipal del dueño y contratista.',
          'Pago y sello de tasa de aseo de la finca (SACH).',
          'Paz y salvo de seguro social del constructor.',
          'Certificación del registro público de la sociedad.',
          'Planos aprobados (civiles/eléctricos/sanitarios).',
          'Permiso de salud (MINSA) para inicio de obra.',
          'Permiso de seguridad (Bomberos).',
          'Si es empresa constructora: autenticación del registro e inscripción en Junta Técnica de Ingeniería y Arquitectura.'
        ],
        observations: [
          'Se coordina inspección con funcionario municipal y profesional responsable; marcar línea de propiedad y de construcción en campo.'
        ],
        slaDays: 7
      }
    ], 'Permiso de Construcción'),

    // ========= PERMISO DE OCUPACIÓN =========
    ...withType([
      {
        code: 'ru-ocupacion-municipio',
        title: 'Permiso de Ocupación - Municipio',
        institution: 'Municipio',
        dependencies: ['ru-construccion-municipio'],
        requirements: [
          'Nota dirigida a la Ing. Municipal describiendo la obra (ubicación, número de finca/rollo/tomo/folio), firmada por propietario y sellada por idóneo.',
          'Copia del permiso de construcción.',
          'Copia de certificación de aprobación de Bomberos.',
          'Certificación de control de calidad de bloques de la UTP (fecha dentro de 1 mes desde la aprobación del permiso de construcción).'
        ],
        observations: [
          'Para urbanizaciones: anexar plano de segregación del lote aprobado y carta de aceptación del MOP.',
          'Si es una empresa constructora, presentar certificación actualizada de la constructora.'
        ],
        slaDays: 7
      }
    ], 'Permiso de Ocupación')
  ];

  const tplRU = await PermitTemplate.findOneAndUpdate(
    { tenantKey, name: 'Residencia Unifamiliar' },
    { tenantKey, name: 'Residencia Unifamiliar', version: 1, items: RU_items },
    { upsert: true, new: true }
  );
  console.log('Plantilla RU creada/actualizada:', tplRU._id, 'Items:', tplRU.items.length);

  /* =========================================================
   *  PLANTILLA 2: URBANIZACIÓN
   *  (bloque original completo sin recortes)
   * ========================================================= */
  const U_items = [
    // ========= INFORME DE SINAPROC =========
    ...withType([
      {
        code: 'ur-sinaproc-informe',
        title: 'Informe de SINAPROC',
        institution: 'SINAPROC',
        requirements: [
          'Nota de solicitud de inspección, firmada y sellada por el idóneo responsable y el propietario.',
          'Anexar localización regional exacta del proyecto.',
          'Cancelar la tasa establecida y programar inspección a campo.'
        ],
        observations: [
          'Se recomienda contar con certificación de SINAPROC antes de ingresar el anteproyecto para descartar riesgo de inundación o deslizamiento.'
        ],
        slaDays: 30
      }
    ], 'Informe SINAPROC'),

    // ========= ESTUDIO DE IMPACTO =========
    ...withType([
      {
        code: 'ur-eia-miambiente',
        title: 'Estudio de Impacto Ambiental (EIA)',
        institution: 'Ministerio de Ambiente',
        requirements: [
          'Memorial dirigido al Ministerio de Ambiente solicitando la aprobación del EIA.',
          'Original y copia del documento del EIA legalizado por ingeniero ambiental responsable.',
          'Pago de la evaluación (según categoría).',
          'Declaración jurada del promotor, confirmando veracidad y ajuste a normativa vigente.',
          'Mapa de ubicación del proyecto y memoria descriptiva.',
          'Descripción del proyecto (componentes, obras, fases, operación y mantenimiento).',
          'Identificación de impactos y medidas de manejo/seguimiento (Plan de Manejo).'
        ],
        observations: [
          'Aplica a proyectos según lista taxativa del Art. 14 del Decreto Ejecutivo 59 de 16/03/2000 (proyectos sin impactos ambientales significativos o que no conllevan riesgos), o de acuerdo con la categoría que corresponda.'
        ],
        slaDays: 30
      }
    ], 'Estudio de Impacto'),

    // ========= ANTEPROYECTO (URBANIZACIÓN) =========
    ...withType([
      {
        code: 'ur-anteproy-miviot',
        title: 'Anteproyecto - MIVIOT',
        institution: 'MIVIOT (Ventanilla Única)',
        requirements: [
          'Solicitud formal (papel 8½" x 13") dirigida a la Dirección Nacional de Ventanilla Única del MIVIOT, para revisión de planos de urbanización.',
          'Formulario de Solicitud de Anteproyecto de Urbanización (cartón), disponible en Ventanilla Única.',
          'Certificado del Registro Público (existencia de la propiedad: número de finca, tomo/folio/documento).',
          'Plano catastral y linderos (medidas, superficies, propietarios colindantes).',
          'Plano Catastral del polígono a segregar (si aplica) y acceso legal a servidumbre/vía aprobada.',
          'Cotejo de copias: 1 para la Dirección Nacional, 1 para cada institución, 1 para Regional, 1 para Municipio (según requisitos locales).',
          'Copia de Resolución del EIA aprobado (si aplica).'
        ],
        observations: [
          'Se debe pagar al MOP por revisión de planos de anteproyecto.',
          'Si el proyecto se desarrolla por etapas, el urbanizador debe presentar diseño de calles para toda la urbanización (uso generalizado, Art. 10).',
          'Si supera 10 ha, presentar Esquema de Ordenamiento o lo que defina la normativa.'
        ],
        slaDays: 20
      },
      {
        code: 'ur-anteproy-mop',
        title: 'Anteproyecto - MOP',
        institution: 'Ministerio de Obras Públicas (MOP)',
        requirements: [
          'Memorial en papel 8½" x 13" dirigido a Ventanilla Única del MIVIOT para revisión de los planos de construcción.',
          'Copia del anteproyecto previamente aprobado.',
          'Juego completo de planos generales: planta de lotificación, drenaje pluvial, alineamiento de calles, terrazas de lotes, topografía, perfiles de calles, detalles constructivos y cálculos hidráulicos del sistema pluvial; estudio de suelos.'
        ],
        observations: [
          'Si hay cauces naturales cercanos: anexar estudio hidrológico e hidráulico del área con cálculos (seguridad de terracerías frente a inundaciones).'
        ],
        slaDays: 15
      },
      {
        code: 'ur-anteproy-minsa',
        title: 'Anteproyecto - MINSA',
        institution: 'Ministerio de Salud (MINSA)',
        requirements: [
          'Memorial 8½" x 13" dirigido a Ventanilla Única del MIVIOT para revisión de planos.',
          'Copia del anteproyecto aprobado.',
          'Hojas de sistemas de tratamiento de aguas residuales y memorias con Manual de Operación y Mantenimiento, firmadas por profesional idóneo.',
          'Prueba de percolación y copia de resultados de análisis fisicoquímicos y bacteriológicos.',
          'En caso de planta de tratamiento: compromiso de operación y mantenimiento y aceptación de IDAAN.'
        ],
        observations: [
          'Si no hay PTAR, los tiempos pueden variar según alcance (en Excel figura 10 días sin PTAR como referencia).'
        ],
        slaDays: 10
      },
      {
        code: 'ur-anteproy-idaan',
        title: 'Anteproyecto - IDAAN',
        institution: 'IDAAN',
        requirements: [
          'Formulario “Información Previa Básica” o Solicitud de Sistemas de Acueductos y Alcantarillados Sanitarios, sellado y firmado por Gerencia Regional.',
          'Juego completo de planos de sistemas de acueducto y alcantarillado con cálculos hidráulicos y memorias.',
          'Gráfica de presión con punto de interconexión (si aplica).'
        ],
        slaDays: 15
      },
      {
        code: 'ur-anteproy-miambiente',
        title: 'Anteproyecto - Ministerio de Ambiente',
        institution: 'Ministerio de Ambiente',
        requirements: [
          'Copia del anteproyecto aprobado por MIVIOT.',
          'Copia de Resolución de aprobación del Estudio de Impacto Ambiental.',
          'Plano de letrero (categoría y formato según normativa).'
        ],
        observations: [
          'Para categorías II y III, seguir los formatos y requisitos adicionales establecidos por MiAmbiente.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-anteproy-attt',
        title: 'Anteproyecto - ATTT',
        institution: 'ATTT',
        requirements: [
          'Copia del plano del anteproyecto aprobado.',
          'Plano de lotificación aprobado.',
          'Plano de alineamiento de calles.',
          'Plano de señalización vial.'
        ],
        observations: [
          'Si el proyecto genera tráfico considerable o afecta intersecciones: presentar estudio de tránsito con propuesta de solución física (Ley 34 / Ley Forestal y demás).'
        ],
        slaDays: 10
      }
    ], 'Anteproyecto'),

    // ========= CONSTRUCCIÓN / URBANIZACIÓN =========
    ...withType([
      {
        code: 'ur-construccion-mop',
        title: 'Urbanización - MOP',
        institution: 'MOP',
        dependencies: ['ur-anteproy-mop', 'ur-anteproy-miviot'],
        requirements: [
          'Planos de diseño final de vialidad y drenaje pluvial con cálculos y detalles constructivos.',
          'Estudio de suelos y secciones típicas de pavimentos.',
          'Topografía y perfiles definitivos.'
        ],
        observations: [
          'Mantener coherencia con el anteproyecto aprobado por MIVIOT; anexar ajustes si hubiere.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-construccion-minsa',
        title: 'Urbanización - MINSA',
        institution: 'MINSA',
        dependencies: ['ur-anteproy-minsa'],
        requirements: [
          'Planos y memorias del sistema sanitario definitivo, firmados por idóneo.',
          'Ensayos/resultado de calidad de aguas y suelos (si aplica).',
          'Compromiso de operación y mantenimiento del sistema de tratamiento (si aplica).'
        ],
        slaDays: 10
      },
      {
        code: 'ur-construccion-idaan',
        title: 'Urbanización - IDAAN',
        institution: 'IDAAN',
        dependencies: ['ur-anteproy-idaan'],
        requirements: [
          'Planos finales de acueducto y alcantarillado con memorias y cálculos.',
          'Conexiones, diámetros, pendientes y obras especiales.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-construccion-miambiente',
        title: 'Urbanización - Ministerio de Ambiente',
        institution: 'Ministerio de Ambiente',
        dependencies: ['ur-anteproy-miambiente', 'ur-eia-miambiente'],
        requirements: [
          'Cumplimiento de la Resolución del EIA (medidas de manejo).',
          'Plano de letrero y reportes de cumplimiento ambiental.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-construccion-attt',
        title: 'Urbanización - ATTT',
        institution: 'ATTT',
        dependencies: ['ur-anteproy-attt'],
        requirements: [
          'Planos de señalización y seguridad vial definitivos.',
          'Planos de alineamientos y lotificación definitiva.'
        ],
        observations: [
          'Si hubo estudio de tránsito en anteproyecto, anexar la versión de diseño con medidas ejecutables.'
        ],
        slaDays: 10
      },
      {
        code: 'ur-construccion-miviot',
        title: 'Urbanización - MIVIOT',
        institution: 'MIVIOT',
        dependencies: ['ur-anteproy-miviot'],
        requirements: [
          'Plano del anteproyecto aprobado.',
          'Plano de lotificación general aprobado por las funciones de Ventanilla Única.',
          'Plano de áreas de uso público con cálculos y luminarias (aprobado por MOP).'
        ],
        slaDays: 10
      },
      {
        code: 'ur-construccion-distribuidora',
        title: 'Urbanización - Empresa de Distribución Eléctrica',
        institution: 'Empresa de Distribución Eléctrica',
        requirements: [
          'Promotor informa por escrito la demanda/carga del proyecto con 3 meses de anticipación.',
          'Cantidad de viviendas, locales comerciales/industriales, y tráfico asociado.',
          'Ubicación de planta de tratamiento (si aplica).',
          'Fecha probable de requerir suministro eléctrico.',
          'Fecha probable de entrega de planos aprobados por la distribuidora.'
        ],
        slaDays: 7
      }
    ], 'Construcción'),

    // ========= MOVIMIENTO, SEGREGACIÓN, INSCRIPCIÓN, TRASPASO, INTERÉS SOCIAL =========
    ...withType([
      {
        code: 'ur-movimiento-tierra',
        title: 'Movimiento de Tierra',
        institution: 'Municipio',
        requirements: [
          'Memorial solicitando movimiento de tierra, dirigido al Municipio.',
          'Plano de la finca aprobada.',
          'Original y copia de plano de movimiento de tierra con detalles (cortes/rellenos en m³).',
          'Copia del plano de urbanización aprobado por MOP.',
          'Estudio de suelos y cálculos estructurales preliminares.'
        ],
        observations: [
          'Inspección municipal para verificar área a trabajar y cálculo de impuestos por corte/relleno.'
        ],
        slaDays: 7
      },
      {
        code: 'ur-segregacion-miviot',
        title: 'Segregación - MIVIOT',
        institution: 'MIVIOT',
        requirements: [
          'Dos copias del plano que muestre lotes a segregar, selladas y refrendadas por arquitecto/ingeniero responsable.',
          'Plano debe venir refrendado con firma del propietario o representante legal.'
        ],
        observations: [
          'El MIVI entrega al interesado copia refrendada para presentarla en Catastro y MEF, junto al plano.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-segregacion-anati',
        title: 'Segregación - ANATI',
        institution: 'ANATI',
        requirements: [
          'Plano original en material estable y de buena calidad según Reglamento de Planos con fines Catastrales (Res. 209 del 06/04/2005 del MEF), firmado por profesional idóneo.',
          'Fotocopia del plano con la debida aprobación del MIVIOT.',
          'Copia del plano de referencia (zona, distrito, corregimiento).'
        ],
        slaDays: 15
      },
      {
        code: 'ur-inscripcion-miviot',
        title: 'Inscripción - MIVIOT',
        institution: 'MIVIOT',
        requirements: [
          'Nota explicativa dirigida al Director Nacional de Ventanilla Única solicitando aprobación de lotes para inscripción (incluyendo números de lotes).',
          'Cuatro copias del plano catastral aprobadas por la Dirección General de Catastro y Bienes Patrimoniales del MEF.',
          'Carta de aceptación final favorable del MOP.',
          'Carta de aceptación final favorable del IDAAN.',
          'Copia de VoBo (visto bueno) para catastro.',
          'Copia de la escritura notariada de protocolización (una vez aprobado).'
        ],
        observations: [
          'Inspección del MIVI para verificar habilitación de áreas recreativas conforme al Reglamento Nacional de Urbanizaciones.',
          'La inscripción de lotes se protocoliza mediante Escritura Pública (se consigna finca/tomo/folio).'
        ],
        slaDays: 20
      },
      {
        code: 'ur-inscripcion-registro',
        title: 'Inscripción - Registro Público',
        institution: 'Registro Público',
        requirements: [
          'Plano aprobado por la Dirección de Catastro del MEF y por el MIVIOT (sello de revisión).',
          'Documentación legal para inscripción de los lotes segregados.'
        ],
        slaDays: 20
      },
      {
        code: 'ur-traspaso-calle',
        title: 'Traspaso de Calle / Uso Público / Servidumbre',
        institution: 'Ministerio de Economía y Finanzas (MEF)',
        requirements: [
          'Memorial 8½" x 13" dirigido al MEF solicitando traspaso de áreas (calles, servidumbres, uso público).',
          'Poder autenticado al abogado (artículo 1199 Código Fiscal para persona jurídica).',
          'Acta de la Junta Directiva autorizando el traspaso (para persona jurídica).',
          'Nota descriptiva de áreas a traspasar.',
          'Certificado del registro público donde conste el propietario (o existencia de la persona jurídica).',
          'Nota de aceptación de las calles por parte del MOP (con cumplimiento de garantías).'
        ],
        observations: [
          'Si la finca tiene hipoteca: presentar oficio del banco con autorización para traspaso a la Nación del área pública.',
          'Plazo referencial en Excel: 3 meses (trámite externo a varias entidades).'
        ],
        slaDays: 90
      },
      {
        code: 'ur-interes-social-miviot',
        title: 'Si el proyecto es de Interés Social',
        institution: 'MIVIOT',
        requirements: [
          'Declaración jurada del promotor indicando valor y número de viviendas y cumplimiento de especificaciones técnicas (Decreto 363 de 16/12/2014 y normas vigentes).',
          'Plano de anteproyecto aprobado por Ventanilla Única del MIVIOT.',
          'Nota solicitando a la Dirección de Promoción de la Vivienda Privada (datos catastrales, ubicación, número total de soluciones habitacionales).',
          'Dos copias del plano arquitectónico de vivienda cumpliendo especificaciones técnicas (Decreto 363), ubicación en lote tipo y sistema de tratamiento de aguas residuales.'
        ],
        slaDays: 20
      }
    ], 'Gestión Catastral y Dominio')
  ];

  const tplURB = await PermitTemplate.findOneAndUpdate(
    { tenantKey, name: 'Urbanización' },
    { tenantKey, name: 'Urbanización', version: 1, items: U_items },
    { upsert: true, new: true }
  );
  console.log('Plantilla URB creada/actualizada:', tplURB._id, 'Items:', tplURB.items.length);

  console.log('✅ Seed de plantillas completado.');
  process.exit(0);
})();
