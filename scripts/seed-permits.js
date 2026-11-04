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
   *  PLANTILLA 1: RESIDENCIA UNIFAMILIAR (alineada con DIAGRAMA_DE_FLUJO.xlsx)
   * ========================================================= */
  const RU_items = [
    // ========= ANTEPROYECTO =========
    ...withType([
      {
        code: 'ru-anteproy-bomberos',
        title: 'Anteproyecto - Bomberos',
        institution: 'Benemérito Cuerpo de Bomberos',
        requirements: [
          'Memorial dirigido al Director General del Benemérito Cuerpo de Bomberos solicitando la revisión de los planos de anteproyecto, firmado y sellado por el idóneo.',
          'Factura de pago de revisión de anteproyecto.',
          'Plano de anteproyecto sellado y firmado por el arquitecto, en original y copia cuando corresponda.'
        ],
        observations: [
          'Si la residencia pertenece a la casa modelo de una urbanización, incorporar además el anteproyecto de la urbanización aprobado y una nota de la promotora indicando el valor del proyecto.'
        ],
        slaDays: 8
      },
      {
        code: 'ru-anteproy-municipio',
        title: 'Anteproyecto - Municipio',
        institution: 'Municipio',
        requirements: [
          'Solicitud de revisión de planos para anteproyecto firmada y sellada por el idóneo y el propietario.',
          'Paz y salvo municipal del idóneo (su firma debe estar registrada en el municipio) y del propietario.',
          'Original y copia del plano de anteproyecto aprobado previamente por Bomberos.',
          'Copia del plano de la finca.'
        ],
        observations: [
          'Si la casa pertenece a una urbanización nueva, presentar además el plano aprobado de la lotificación y la resolución del EIA.'
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
          'Solicitud de licencia de construcción en formato de Ingeniería Municipal firmada por el propietario e idóneo.',
          'Paz y salvo municipal del constructor y del propietario.',
          'Paz y salvo de la tasa de aseo de la finca o propiedad.',
          'Paz y salvo del seguro social del constructor.',
          'Certificación del Registro Público de la propiedad o de la sociedad, según corresponda.',
          'Plano aprobado.'
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
          'Copia del plano de la finca aprobado.',
          'Inspección e informe del funcionario de saneamiento ambiental para comprobar la prueba de percolación.'
        ],
        observations: [
          'Si corresponde a la casa modelo de una urbanización, presentar además el plano de lotificación aprobado.'
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
          'Memorial dirigido al Director General del Benemérito Cuerpo de Bomberos solicitando la revisión de los planos de construcción, firmado y sellado por el idóneo y el propietario.',
          'Factura de pago correspondiente.',
          'Planos de construcción completos, firmados por los idóneos.'
        ],
        observations: [
          'Adjuntar factura de pago del anteproyecto y memorial de revisión de Bomberos.'
        ],
        slaDays: 15
      },
      {
        code: 'ru-planos-fenosa',
        title: 'Aprobación de Planos de Construcción - Empresa Distribuidora',
        institution: 'Fenosa (Distribuidora)',
        dependencies: ['ru-anteproy-bomberos', 'ru-anteproy-municipio'],
        requirements: [
          'Nota de solicitud de revisión, firmada y sellada por idóneo y propietario.',
          'Original y copia del plano de electricidad.'
        ],
        observations: [
          'Si el plano no supera 10 kVA, no requiere el sello de la empresa distribuidora.'
        ],
        slaDays: 3
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
          'ru-planos-bomberos'
        ],
        requirements: [
          'Solicitud de revisión de planos de construcción (formato Ing. Municipal) firmada y sellada por idóneo y propietario.',
          'Paz y salvo municipal del idóneo y del propietario.',
          'Original y copia del plano de construcción aprobado previamente por MINSA, IDAAN, Cable & Wireless y Bomberos.'
        ],
        observations: [
          'Si pertenece a una urbanización, debe tener aprobado el plano de movimiento de tierra. La aprobación de la distribuidora eléctrica también será necesaria cuando el plano supere 10 kVA.'
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
          'Certificación del Registro Público de la propiedad o de la sociedad, según corresponda.',
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
          'Certificación de control de calidad de bloques de la UTP (fecha dentro de un mes antes o después del otorgamiento del permiso de construcción).',
          'Inspección por parte del funcionario del Municipio.'
        ],
        observations: [
          'Para urbanizaciones: presentar además el plano de segregación del lote aprobado.',
          'Presentar las cartas de aceptación del IDAAN y del MOP.',
          'Si es una empresa constructora, presentar certificación actualizada de la Junta Técnica.'
        ],
        slaDays: 7
      }
    ], 'Permiso de Ocupación')
  ];

  const tplRU = await PermitTemplate.findOneAndUpdate(
    { tenantKey, name: 'Residencia Unifamiliar' },
    { tenantKey, name: 'Residencia Unifamiliar', version: 3, projectTypes: ['Residencia Unifamiliar', 'Unifamiliar', 'Lotes unifamiliares'], items: RU_items },
    { upsert: true, new: true }
  );
  console.log('Plantilla RU creada/actualizada:', tplRU._id, 'Items:', tplRU.items.length);

  /* =========================================================
   *  PLANTILLA 2: URBANIZACIÓN (alineada con DIAGRAMA_DE_FLUJO.xlsx)
   *  El anteproyecto se gestiona como un único trámite ante la Ventanilla
   *  Única del MIVIOT; las revisiones por institución pertenecen a Construcción.
   * ========================================================= */
  const U_items = [
    // ========= INFORME DE SINAPROC =========
    ...withType([
      {
        code: 'ur-sinaproc-informe',
        title: 'Informe de SINAPROC',
        institution: 'SINAPROC',
        requirements: [
          'Formato oficial de Solicitud de Inspección de Proyectos de SINAPROC.',
          'Datos y localización regional exacta del proyecto para coordinar la inspección de campo.',
          'Comprobante de pago de la tarifa de inspección aplicable según la superficie y ubicación del proyecto.'
        ],
        observations: [
          'Se recomienda contar con certificación de SINAPROC antes de ingresar el anteproyecto para descartar riesgo de inundación o deslizamiento.',
          'El plazo de 30 días hábiles procede del cronograma recibido; SINAPROC no publica ese plazo como compromiso general en su página de inspecciones.'
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
          'Registro del promotor y presentación digital del Estudio de Impacto Ambiental mediante e-SEVIA 2.0.',
          'Estudio de Impacto Ambiental digital elaborado por consultores ambientales actualizados y habilitados.',
          'Documentos de identidad y representación legal del promotor, según se trate de persona natural o jurídica.',
          'Certificación registral de la finca o documento que acredite la tenencia o autorización de uso del predio.',
          'Comprobante de pago de la evaluación y paz y salvo vigente de MiAmbiente.',
          'Descripción del proyecto, área de influencia, impactos, medidas de mitigación y Plan de Manejo Ambiental.',
          'Viabilidades o autorizaciones sectoriales adicionales cuando el proyecto afecte áreas protegidas, recursos naturales u otras zonas sujetas a regulación especial.'
        ],
        observations: [
          'La categoría y la necesidad del EIA deben determinarse conforme al Decreto Ejecutivo 4 de 28 de mayo de 2026; no debe asumirse automáticamente que todo proyecto es categoría I.',
          'e-SEVIA 2.0 gestiona digitalmente la admisión, evaluación, análisis y decisión; se eliminó la exigencia general de ejemplares impresos del estudio una vez admitido.',
          'Los 30 días hábiles proceden del cronograma recibido para categoría I y se mantienen como estimación, no como plazo oficial garantizado.'
        ],
        slaDays: 30
      }
    ], 'Estudio de Impacto'),

    // ========= ANTEPROYECTO (VENTANILLA ÚNICA) =========
    ...withType([
      {
        code: 'ur-anteproy-miviot',
        title: 'Anteproyecto - MIVIOT (Ventanilla Única)',
        institution: 'MIVIOT (Ventanilla Única)',
        requirements: [
          'Solicitud formal en papel 8½" x 13" dirigida al Director(a) Nacional de Ventanilla Única del MIVIOT, sometiendo el proyecto a revisión de anteproyecto; con sello y firma del arquitecto(a) y del propietario(a) o representante legal.',
          'Formulario de Solicitud de Anteproyecto de Urbanización (cartón disponible en la Dirección Nacional de Ventanilla Única).',
          'Certificado original del Registro Público con los datos de la propiedad: finca, tomo o rollo, folio o documento, valor, colindantes, linderos, medidas, superficie, propietario o representante legal y gravámenes.',
          'Memoria explicativa del proyecto conforme al Reglamento Nacional de Urbanizaciones y la guía técnica de Ventanilla Única.',
          'Plano catastral del polígono a desarrollar, donde se aprecie su acceso legal y la servidumbre vial aprobada.',
          'Ocho copias de la lotificación propuesta y dos copias adicionales del diseño preliminar de las áreas de uso público para MIVIOT.',
          'Los planos deben reservar una franja libre de 10 cm para sellos y anotaciones institucionales.',
          'Entregar los documentos en fólderes largos identificados por institución, con los planos doblados dentro de cada fólder.',
          'Copia de la resolución del EIA aprobado, cuando aplique.'
        ],
        observations: [
          'Se recomienda contar previamente con la certificación de SINAPROC que descarte riesgo de inundación o deslizamiento.',
          'Se debe pagar al MOP la tasa de revisión de planos de anteproyecto.',
          'Si el proyecto se desarrolla por etapas, presentar el diseño de calles para toda la urbanización y el uso del suelo generalizado.',
          'Si el proyecto supera 10 ha, presentar el Esquema de Ordenamiento Territorial que corresponda.'
        ],
        slaDays: 20
      }
    ], 'Anteproyecto'),

    // ========= CONSTRUCCIÓN / URBANIZACIÓN =========
    ...withType([
      {
        code: 'ur-construccion-mop',
        title: 'Construcción - MOP',
        institution: 'Ministerio de Obras Públicas (MOP)',
        dependencies: ['ur-anteproy-miviot'],
        requirements: [
          'Memorial en papel 8½" x 13" dirigido a Ventanilla Única del MIVIOT para revisión de los planos de construcción.',
          'Copia del anteproyecto previamente aprobado.',
          'Juego completo de planos generales: lotificación, sistema pluvial, alineamiento de calles, terracería de lotes, topografía, perfiles de calles, detalles constructivos de pavimentos y sistema pluvial, cálculos hidráulicos y estudio de suelos.',
          'Plano topográfico que sobrepase al menos 20 m los límites de la propiedad e identifique las estructuras pluviales existentes.'
        ],
        observations: [
          'Si existen cauces naturales cercanos, presentar estudio hidrológico e hidráulico con cálculos para revisar niveles de terracería seguros contra inundaciones.',
          'Presentar la resolución del Estudio de Impacto Ambiental.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-construccion-minsa',
        title: 'Construcción - MINSA',
        institution: 'Ministerio de Salud (MINSA)',
        dependencies: ['ur-anteproy-miviot'],
        requirements: [
          'Memorial en papel 8½" x 13" dirigido a Ventanilla Única del MIVIOT para revisión de los planos de construcción.',
          'Copia del anteproyecto previamente aprobado.',
          'Hojas de los sistemas de acueducto, alcantarillado y tratamiento de aguas residuales, con sus memorias y cálculos de diseño. Las plantas de tratamiento deben incluir su Manual de Operación y Mantenimiento firmado por el profesional idóneo.',
          'Prueba de percolación y copia de la resolución del EIA.',
          'Cuando existan pozos, resultados de los análisis físico-químicos, bacteriológicos y de capacidad o rendimiento.'
        ],
        observations: [
          'Con planta de tratamiento, presentar el compromiso del promotor de operar y mantener el sistema hasta su traspaso y aceptación por el IDAAN.',
          'El plazo de 10 días hábiles corresponde a proyectos sin planta de tratamiento.'
        ],
        slaDays: 10
      },
      {
        code: 'ur-construccion-idaan',
        title: 'Construcción - IDAAN',
        institution: 'IDAAN',
        dependencies: ['ur-anteproy-miviot'],
        requirements: [
          'Memorial en papel 8½" x 13" dirigido a Ventanilla Única del MIVIOT para revisión de los planos de construcción.',
          'Hoja de Información Previa Básica para el Diseño de Sistemas de Acueductos y Alcantarillados Sanitarios, sellada y firmada por la Gerencia Regional, con su nota de recomendaciones.',
          'Juego completo de planos generales con cálculos hidráulicos y estructurales de los sistemas de acueducto y sanitario, y esquemas hidráulicos iniciales y finales.',
          'Cuando el IDAAN lo requiera, gráfica de presión original desde el punto más cercano de interconexión, firmada y sellada por el funcionario responsable.',
          'Copia del anteproyecto aprobado por el MIVIOT.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-construccion-miambiente',
        title: 'Construcción - Ministerio de Ambiente',
        institution: 'Ministerio de Ambiente',
        dependencies: ['ur-anteproy-miviot', 'ur-eia-miambiente'],
        requirements: [
          'Copia del anteproyecto aprobado por el MIVIOT.',
          'Para categoría I, copia de la nota que acoge el EIA con su hoja de formato de letrero; para categorías II y III, copia de la resolución de aprobación con su hoja de formato de letrero.',
          'Copia del Estudio de Impacto Ambiental para cotejo.',
          'Plano de lotificación.'
        ],
        observations: [
          'La información del plano debe coincidir con el EIA y su resolución.',
          'Si existen ríos, quebradas, lagos u otros afluentes, delimitar el área de protección conforme a la normativa aplicable.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-construccion-attt',
        title: 'Construcción - ATTT',
        institution: 'ATTT',
        dependencies: ['ur-anteproy-miviot'],
        requirements: [
          'Copia del anteproyecto aprobado.',
          'Plano de localización regional.',
          'Plano de alineamiento de calles.',
          'Planta de señalización vial.',
          'Hojas típicas de señalización vertical, horizontal, preventiva de obra y paradas de autobús.'
        ],
        observations: [
          'Si el proyecto genera un volumen de tránsito considerable o prevé conflictos con vías existentes, presentar un Estudio de Tránsito del área de influencia con la propuesta de solución física.'
        ],
        slaDays: 10
      },
      {
        code: 'ur-construccion-miviot',
        title: 'Construcción - MIVIOT',
        institution: 'MIVIOT',
        dependencies: [
          'ur-anteproy-miviot',
          'ur-construccion-mop',
          'ur-construccion-minsa',
          'ur-construccion-idaan',
          'ur-construccion-miambiente',
          'ur-construccion-attt'
        ],
        requirements: [
          'Copia del anteproyecto aprobado.',
          'Copia del plano de lotificación general aprobado por los demás funcionarios de Ventanilla Única.',
          'Copia del plano de áreas de uso público, con sus detalles constructivos y luminarias, aprobado previamente por el MOP.'
        ],
        slaDays: 10
      },
      {
        code: 'ur-construccion-distribuidora',
        title: 'Construcción - Empresa de Distribución Eléctrica',
        institution: 'Empresa de Distribución Eléctrica',
        requirements: [
          'Estimación de la carga del proyecto, indicando si es residencial, comercial o industrial y si el servicio será monofásico o trifásico.',
          'Cantidad de unidades de vivienda, locales comerciales o industriales.',
          'Ubicación de la planta de tratamiento, cuando aplique.',
          'Fecha probable en que se requerirá el suministro eléctrico.',
          'Plano de localización del proyecto.',
          'Fecha probable de entrega de planos para aprobación de la distribuidora.'
        ],
        observations: [
          'Para proyectos de interés social, informar a la distribuidora al menos tres meses antes de la fecha estimada de inicio del trámite de aprobación de planos.'
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
        dependencies: ['ur-construccion-mop'],
        requirements: [
          'Memorial de solicitud de movimiento de tierra dirigido al Municipio.',
          'Plano de la finca aprobado.',
          'Documento de propiedad.',
          'Original y copia del plano de movimiento de tierra con detalles y cálculos en m³ de corte y relleno.',
          'Original y copia del plano de urbanización aprobado por el MOP.',
          'Estudio de suelos.',
          'Cálculos estructurales.',
          'Resolución del EIA.',
          'Paz y salvo municipal.'
        ],
        observations: [
          'El inspector municipal coordina una inspección para verificar el área a trabajar y calcular los impuestos según el volumen de corte y relleno.'
        ],
        slaDays: 7
      },
      {
        code: 'ur-segregacion-miviot',
        title: 'Segregación (VoBo) - MIVIOT',
        institution: 'MIVIOT',
        requirements: [
          'Dos copias del plano que muestre los lotes a segregar, selladas por el arquitecto responsable de la urbanización y por el ingeniero civil o agrimensor que realizó la mensura.',
          'El plano debe venir refrendado con la firma y cédula del propietario o representante legal.'
        ],
        observations: [
          'El MIVI entrega al interesado copia refrendada para presentarla en Catastro y MEF, junto al plano.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-segregacion-anati',
        title: 'Segregación (VoBo) - ANATI',
        institution: 'ANATI',
        dependencies: ['ur-segregacion-miviot'],
        requirements: [
          'Plano original en material estable y de buena calidad según Reglamento de Planos con fines Catastrales (Res. 209 del 06/04/2005 del MEF), firmado por profesional idóneo.',
          'Fotocopia del plano con la debida aprobación del MIVIOT.',
          'Copia del plano de referencia cuando corresponda a Reforma Agraria, Archivos Nacionales o planos sin aprobar, salvo las excepciones aplicables.'
        ],
        slaDays: 15
      },
      {
        code: 'ur-inscripcion-miviot',
        title: 'Inscripción de Lotes - MIVIOT',
        institution: 'MIVIOT',
        dependencies: ['ur-segregacion-anati'],
        requirements: [
          'Nota explicativa dirigida al Director Nacional de Ventanilla Única solicitando aprobación de lotes para inscripción (incluyendo números de lotes).',
          'Cuatro copias del plano catastral aprobadas por la Dirección General de Catastro y Bienes Patrimoniales del MEF.',
          'Carta de aceptación final favorable del MOP.',
          'Carta de aceptación final favorable del IDAAN.',
          'Copia del VoBo (visto bueno) para catastro.',
          'Una vez aprobado el plano, llevar una copia a notaría para la confección de la minuta.',
          'Registrar la minuta para que los lotes queden inscritos a nombre de sus adquirientes.'
        ],
        observations: [
          'Inspección del MIVI para verificar habilitación de áreas recreativas conforme al Reglamento Nacional de Urbanizaciones.',
          'La inscripción de lotes se protocoliza mediante Escritura Pública (se consigna finca/tomo/folio).'
        ],
        slaDays: 20
      },
      {
        code: 'ur-inscripcion-registro',
        title: 'Inscripción de Lotes - Registro Público',
        institution: 'Registro Público',
        dependencies: ['ur-inscripcion-miviot'],
        requirements: [
          'Plano aprobado por la Dirección de Catastro y Bienes Patrimoniales del MEF y por el MIVIOT, con sello de inscripción.',
          'Paz y salvo de inmueble y del IDAAN de la finca que se segrega.'
        ],
        slaDays: 20
      },
      {
        code: 'ur-traspaso-calle',
        title: 'Traspaso de Calle, Uso Público y Servidumbre a la Nación',
        institution: 'Ministerio de Economía y Finanzas (MEF)',
        requirements: [
          'Memorial 8½" x 13" dirigido al MEF solicitando traspaso de áreas (calles, servidumbres, uso público).',
          'Poder autenticado al abogado (artículo 1199 Código Fiscal para persona jurídica).',
          'Acta de la Junta Directiva autorizando el traspaso (para persona jurídica).',
          'Nota descriptiva de áreas a traspasar.',
          'Certificado del Registro Público donde conste el propietario de la finca y que esté libre de gravámenes, cuando corresponda.',
          'Nota de aceptación de las calles por parte del MOP (con cumplimiento de tres años de garantía).',
          'Nota de certificación de IDAAN aceptando poner en servicio el sistema de acueductos y alcantarillado.',
          'Dos copias del plano de las áreas a traspasar aprobado por Catastro y MIVIOT.',
          'Paz y salvo del inmueble, de IDAAN y personal.'
        ],
        observations: [
          'Si la finca está hipotecada, presentar oficio del banco autorizando el traspaso del área a la Nación.',
          'Plazo referencial en Excel: 3 meses (trámite externo a varias entidades).'
        ],
        slaDays: 90
      },
      {
        code: 'ur-interes-social-miviot',
        title: 'Si el proyecto es de Interés Social',
        institution: 'MIVIOT',
        requirements: [
          'Declaración jurada sobre el valor de venta de las viviendas, aceptando cumplir las especificaciones técnicas del Decreto 393 de 16 de diciembre de 2014 y demás normas vigentes.',
          'Plano de anteproyecto aprobado por Ventanilla Única del MIVIOT.',
          'Nota solicitando a la Dirección de Promoción de la Vivienda Privada (datos catastrales, ubicación, número total de soluciones habitacionales).',
          'Dos copias del plano arquitectónico de vivienda cumpliendo las especificaciones técnicas del Decreto 393, ubicación en lote tipo y sistema de tratamiento de aguas residuales.'
        ],
        slaDays: 20
      }
    ], 'Gestión Catastral y Dominio')
  ];

  const tplURB = await PermitTemplate.findOneAndUpdate(
    { tenantKey, name: 'Urbanización' },
    { tenantKey, name: 'Urbanización', version: 4, projectTypes: ['Urbanización', 'Residencial horizontal'], items: U_items },
    { upsert: true, new: true }
  );
  console.log('Plantilla URB creada/actualizada:', tplURB._id, 'Items:', tplURB.items.length);

  /* =========================================================
   *  REQUISITOS COMUNES DE PROPIEDAD HORIZONTAL
   *  Ley 284 de 2022 y catálogo Gesproban.
   * ========================================================= */
  const PH_REGIME_REQUIREMENTS = [
    'Poder notariado dirigido al Ministro(a) de Vivienda y Ordenamiento Territorial, cuando el propietario no presente personalmente la solicitud.',
    'Solicitud formal de incorporación al Régimen de Propiedad Horizontal dirigida al Ministro(a) de Vivienda y Ordenamiento Territorial.',
    'Certificación del Registro Público de la finca, expedida dentro de los tres meses anteriores, con propietarios, linderos, medidas, superficie, valor del terreno y mejoras, y gravámenes inscritos.',
    'Certificación del Registro Público de la sociedad propietaria, expedida dentro de los tres meses anteriores, cuando corresponda.',
    'Certificación del valor catastral del terreno emitida por la Dirección de Catastro y Bienes Patrimoniales.',
    'Permiso de construcción y verificación técnica municipal del valor de la obra, en original para cotejo o copia notariada.',
    'Carta de autorización del acreedor hipotecario o certificación de que el proyecto se ejecuta con fondos propios.',
    'Reglamento de copropiedad refrendado por abogado en su última página.',
    'Copia de los planos de construcción aprobados por el municipio correspondiente: localización regional y general, plantas, elevaciones y, en urbanizaciones, lotificaciones.',
    'Permiso de ocupación cuando la obra se encuentre terminada al 100%.',
    'Cheques certificados o de gerencia por la tasa de tramitación equivalente a 0.2% del valor de construcción declarado para el impuesto municipal, cuando MIVIOT notifique la admisión.'
  ];

  const PH_REGIME_OBSERVATIONS = [
    'La incorporación se tramita ante la Dirección de Propiedad Horizontal del MIVIOT conforme a la Ley 284 de 2022.',
    'El régimen se constituye en tres fases: resolución de MIVIOT, protocolización notarial e inscripción de la escritura en el Registro Público.',
    'Puede iniciarse con el edificio o conjunto en construcción; el permiso de ocupación solo se exige si la obra está terminada al 100%.',
    'Las certificaciones del Registro Público indicadas por MIVIOT tienen una vigencia de tres meses.',
    'Los proyectos calificados de interés social por MIVIOT están exentos de la tasa de incorporación.',
    'El plazo de 45 días hábiles procede del cronograma recibido; MIVIOT no lo publica como plazo general garantizado.',
    'Los documentos quedan sujetos a revisión y posibles observaciones antes de la admisión formal del trámite.'
  ];

  const PH_EIA_REQUIREMENTS = [
    'Registro del promotor y presentación digital del Estudio de Impacto Ambiental mediante e-SEVIA 2.0.',
    'Estudio de Impacto Ambiental digital elaborado por consultores ambientales actualizados y habilitados.',
    'Documentos de identidad y representación legal del promotor, según se trate de persona natural o jurídica.',
    'Comprobante de pago por la evaluación, según la categoría del estudio.',
    'Paz y salvo vigente del Ministerio de Ambiente.',
    'Certificación registral de la finca o documento de ANATI que acredite la tenencia o autorización de uso del predio.',
    'Descripción del proyecto, área de influencia, impactos, medidas de mitigación y Plan de Manejo Ambiental.',
    'Viabilidad de la Dirección de Áreas Protegidas y Biodiversidad cuando el proyecto se ubique en un área protegida.',
    'Certificación de conducencia de la autoridad competente para proyectos de generación de energías renovables, cuando corresponda.',
    'Plan de reforestación para proyectos de reforestación, cuando corresponda.'
  ];

  /* =========================================================
   *  PLANTILLA 3: PH VERTICAL (DISTRITO DE PANAMÁ)
   * ========================================================= */
  const PHV_items = [
    ...withType([
      {
        code: 'phv-uso-suelo-dpu',
        title: 'Certificación de Uso de Suelo - DPU',
        institution: 'Municipio de Panamá (DPU)',
        requirements: [
          'Solicitud formal en hoja 8½ x 11 dirigida al Director de Planificación Urbana y Ordenamiento Territorial, indicando motivo, dirección completa, nombre, firma, teléfono y correo del interesado.',
          'Ubicación gráfica precisa mediante Documento Gráfico de Zonificación, vista satelital o localización regional; opcionalmente plano catastral o coordenadas geográficas/UTM WGS-84.',
          'Copia de la solicitud para el recibo correspondiente.',
          'Comprobante de pago de B/.30.00 por lote o finca emitido por Tesorería Municipal.'
        ],
        observations: [
          'Si la norma no permite la densidad o altura prevista, deberá tramitarse el cambio de código de zona.',
          'El Estado está exento del pago de la certificación.',
          'El trámite también puede gestionarse digitalmente mediante Alcaldía Digital.',
          'Esta plantilla corresponde al Distrito de Panamá; otros municipios pueden exigir una ruta distinta.',
          'Los siete días hábiles proceden de la información recibida; la DPU no publica ese plazo como compromiso general.'
        ],
        slaDays: 7
      }
    ], 'Certificación de Uso de Suelo'),

    ...withType([
      {
        code: 'phv-sinaproc-informe',
        title: 'Informe de Riesgo - SINAPROC',
        institution: 'SINAPROC',
        requirements: [
          'Formato oficial de Solicitud de Inspección de Proyectos de SINAPROC.',
          'Datos y localización regional exacta del proyecto para coordinar la inspección de campo.',
          'Comprobante de pago de la tarifa de inspección aplicable según la superficie y ubicación del proyecto.'
        ],
        observations: [
          'Trámite recomendado para descartar riesgos de inundación o deslizamiento antes del anteproyecto.',
          'El plazo de 10 días hábiles es estimado en el cronograma recibido; SINAPROC no lo publica como compromiso general.'
        ],
        slaDays: 10
      }
    ], 'Informe SINAPROC'),

    ...withType([
      {
        code: 'phv-eia-miambiente',
        title: 'Estudio de Impacto Ambiental - MiAmbiente',
        institution: 'Ministerio de Ambiente',
        requirements: [...PH_EIA_REQUIREMENTS],
        observations: [
          'La categoría y la necesidad del EIA deben determinarse conforme al Decreto Ejecutivo 4 de 28 de mayo de 2026; no debe asumirse automáticamente que el proyecto es categoría I.',
          'e-SEVIA 2.0 gestiona digitalmente la admisión, evaluación, análisis y decisión.',
          'La resolución ambiental vigente es requisito para registrar los planos de construcción.',
          'Los 30 días hábiles proceden del cronograma recibido para categoría I y se mantienen como estimación, no como plazo oficial garantizado.'
        ],
        slaDays: 30
      }
    ], 'Estudio de Impacto Ambiental'),

    ...withType([
      {
        code: 'phv-anteproyecto-bomberos',
        title: 'Anteproyecto - Bomberos',
        institution: 'DINASEPI - Benemérito Cuerpo de Bomberos',
        dependencies: ['phv-uso-suelo-dpu'],
        requirements: [
          'Formulario único de solicitud para revisión de anteproyecto.',
          'Plano de anteproyecto firmado y sellado por el arquitecto idóneo.',
          'Comprobante de pago de la tasa de revisión de Bomberos.'
        ],
        observations: [
          'La resolución de Bomberos forma parte de los documentos exigidos para el registro del anteproyecto municipal.',
          'Los requisitos detallados y el plazo de 10 días proceden de la información recibida; deben confirmarse con DINASEPI para el proyecto concreto.'
        ],
        slaDays: 10
      },
      {
        code: 'phv-anteproyecto-doyc',
        title: 'Anteproyecto - DOYC',
        institution: 'Municipio de Panamá (DOYC)',
        dependencies: ['phv-uso-suelo-dpu', 'phv-anteproyecto-bomberos'],
        requirements: [
          'Formulario de Registro en Línea de Anteproyecto debidamente completado por el arquitecto idóneo en Alcaldía Digital.',
          'Memorial firmado por el arquitecto y el propietario.',
          'Anteproyecto en un único archivo PDF de hasta 20 MB, con los contenidos urbanísticos y arquitectónicos exigidos por la DOYC.',
          'Certificado vigente de propiedad emitido por el Registro Público.',
          'Resolución de anteproyecto emitida por el Benemérito Cuerpo de Bomberos.'
        ],
        observations: [
          'El anteproyecto aceptado permite promover la preventa, pero no autoriza el inicio de la obra.',
          'El arquitecto y el propietario deben estar previamente inscritos como contribuyentes en el Municipio de Panamá.',
          'La tasa publicada es B/.50.00 por trámite más B/.5.00 por cada hoja ingresada.',
          'La vigencia publicada es de tres años, prorrogable una sola vez por un año.',
          'El plazo de 15 días hábiles procede del cronograma recibido; la DOYC no lo publica como plazo integral garantizado.'
        ],
        slaDays: 15
      }
    ], 'Anteproyecto'),

    ...withType([
      {
        code: 'phv-planos-ventanilla-doyc',
        title: 'Planos de Construcción - Ventanilla Única DOYC',
        institution: 'Ventanilla Única DOYC',
        dependencies: ['phv-anteproyecto-doyc', 'phv-eia-miambiente'],
        requirements: [
          'Anteproyecto aprobado por DOYC y Bomberos.',
          'Resolución vigente del Estudio de Impacto Ambiental.',
          'Memorias técnicas firmadas de estructura, estudio de suelos, plomería, electricidad, sistema contra incendios y elevadores.',
          'Aprobaciones o certificaciones de servidumbres de MOP, IDAAN y empresa distribuidora eléctrica.',
          'Planos originales con dimensiones mínimas de 610 mm x 914 mm, acompañados por las memorias de las disciplinas aplicables.',
          'Documentos y memorias técnicas grabados individualmente en PDF, con un máximo de 20 MB por archivo, entregados en medio digital según las instrucciones de la DOYC.'
        ],
        observations: [
          'Participan DOYC, Bomberos, MINSA, MOP, IDAAN, ATTT, Accesibilidad, AAUD, MiAmbiente y la distribuidora eléctrica.',
          'Una vez revisados por Ventanilla Única y refrendados por la DOYC, los planos registrados tienen cinco años de vigencia.',
          'Los plazos informados —Bomberos 15 días, MINSA 3, IDAAN 3, distribuidora 3 y revisión municipal 5— proceden del cronograma recibido y no constituyen un plazo integral garantizado.',
          'Las tasas informadas son B/.5.00 por hoja, MINSA B/.10.00 y MOP B/.10.00 cuando aplique.'
        ],
        slaDays: 20
      }
    ], 'Planos de Construcción'),

    ...withType([
      {
        code: 'phv-movimiento-tierra',
        title: 'Movimiento de Tierra - Municipio',
        institution: 'Municipio de Panamá',
        dependencies: ['phv-planos-ventanilla-doyc'],
        requirements: [
          'Memorial de solicitud de movimiento de tierra.',
          'Plano y documento registral de la finca.',
          'Plano de movimiento de tierra con cálculos de corte y relleno.',
          'Estudio de suelos y cálculos estructurales aplicables.',
          'Resolución del Estudio de Impacto Ambiental.',
          'Paz y salvo municipal.'
        ],
        observations: [
          'Trámite condicional: debe marcarse como No aplica cuando el proyecto no requiera movimiento de tierra independiente.'
        ],
        slaDays: 7
      }
    ], 'Movimiento de Tierra'),

    ...withType([
      {
        code: 'phv-construccion-doyc',
        title: 'Permiso de Construcción - DOYC',
        institution: 'Municipio de Panamá (DOYC)',
        dependencies: ['phv-planos-ventanilla-doyc'],
        requirements: [
          'Formulario digital de solicitud y nota en tamaño legal dirigida al Director de la DOYC.',
          'Plano completo registrado en la DOYC, escaneado; si no existe copia digital, tres juegos en papel bond.',
          'Comprobante de MITRADEL cuando la obra supere B/.1,000,000.01.',
          'Contrato refrendado por la Contraloría para obras del Estado, cuando corresponda.',
          'Contrato de arrendamiento, cuando corresponda.',
          'Planos de construcción previamente aprobados por MIVIOT para urbanizaciones o lotificaciones, cuando corresponda.',
          'Permiso expedido por DINASEPI del Benemérito Cuerpo de Bomberos.',
          'Permiso expedido por MINSA para la Región Metropolitana.',
          'Resolución vigente de la JTIA para empresas constructoras.',
          'Certificado de paz y salvo de bienes inmuebles de la finca emitido por la DGI.',
          'Paz y salvo municipal vigente del constructor o empresa constructora.'
        ],
        observations: [
          'La solicitud se gestiona mediante Alcaldía Digital y el permiso se remite por correo electrónico con firma digital.',
          'El plazo operativo se separa en avalúo municipal y emisión después del pago de la tasa de construcción.',
          'La vigencia informada por la DOYC es de cinco años.'
        ],
        slaDays: 15
      }
    ], 'Permiso de Construcción'),

    ...withType([
      {
        code: 'phv-regimen-miviot',
        title: 'Incorporación al Régimen de Propiedad Horizontal - MIVIOT',
        institution: 'MIVIOT - Dirección de Propiedad Horizontal',
        dependencies: ['phv-construccion-doyc'],
        requirements: [...PH_REGIME_REQUIREMENTS],
        observations: [...PH_REGIME_OBSERVATIONS],
        slaDays: 45
      }
    ], 'Régimen de Propiedad Horizontal'),

    ...withType([
      {
        code: 'phv-ocupacion-bomberos',
        title: 'Permiso de Ocupación - Bomberos',
        institution: 'DINASEPI - Benemérito Cuerpo de Bomberos',
        dependencies: ['phv-construccion-doyc'],
        requirements: [
          'Solicitud de inspección final y certificado de ocupación.',
          'Planos registrados y permiso de construcción.',
          'Sistemas de seguridad, electricidad, plomería y protección contra incendios listos para inspección.'
        ],
        observations: [
          'La certificación de Bomberos es previa al permiso de ocupación municipal.',
          'Los requisitos detallados y el plazo de 10 días proceden de la información recibida; deben confirmarse con DINASEPI para el proyecto concreto.'
        ],
        slaDays: 10
      },
      {
        code: 'phv-ocupacion-doyc',
        title: 'Permiso de Ocupación - DOYC',
        institution: 'Municipio de Panamá (DOYC)',
        dependencies: ['phv-ocupacion-bomberos'],
        requirements: [
          'Nota en PDF, en hoja legal, suscrita por el profesional idóneo o empresa constructora y el propietario, dirigida al Director de la DOYC.',
          'Código de registro del Permiso de Construcción vinculado en Alcaldía Digital.',
          'Permiso de Ocupación expedido por DINASEPI del Benemérito Cuerpo de Bomberos.',
          'Certificado vigente del Registro Público de la propiedad y copia de la cédula del propietario.',
          'Certificado de existencia de la sociedad propietaria y cédula del representante legal, cuando corresponda.',
          'Paz y salvo municipal vigente del profesional idóneo o empresa constructora.',
          'Certificación de la UTP cuando el edificio supere 15 pisos.'
        ],
        observations: [
          'La DOYC coordina la inspección en un máximo de tres días hábiles y emite el permiso en un máximo de tres días hábiles desde el pago de la tasa.',
          'Las objeciones se notifican en un máximo de dos días hábiles; corregidas, la reinspección puede tomar hasta cinco días hábiles.',
          'El plazo indicado suma únicamente los dos hitos reglados y no incluye el tiempo de inspección, subsanación, avalúo o pago.'
        ],
        slaDays: 6
      }
    ], 'Permiso de Ocupación'),

    ...withType([
      {
        code: 'phv-plano-finca-anati',
        title: 'Plano de Finca en PH - ANATI',
        institution: 'ANATI',
        dependencies: ['phv-regimen-miviot'],
        requirements: [
          'Visto bueno del MIVIOT.',
          'Plano original con los sellos del MIVIOT.',
          'Copia del plano original sellado por el MIVIOT.',
          'Archivo digital en AutoCAD con coordenadas WGS-84.',
          'Fotocopias de las cédulas del adquiriente y del propietario.',
          'Ruego notariado cuando alguna persona firme mediante huella.',
          'Copia del plano de referencia de la finca o fincas madres.',
          'Plano resultante de la finca sometida al Régimen de Propiedad Horizontal.',
          'Resolución del MIVIOT y plano de desafectación parcial, cuando corresponda.'
        ],
        observations: [
          'ANATI puede exigir vistos buenos adicionales cuando el plano colinde con zonas hídricas, forestales, manglares, cota 100, líneas de transmisión, canalizaciones o zanjas, o no cumpla la superficie de la zonificación.',
          'El plazo de siete días hábiles procede del cronograma recibido; ANATI no lo publica como plazo general garantizado.'
        ],
        slaDays: 7
      }
    ], 'Plano de Finca en PH'),

    ...withType([
      {
        code: 'phv-inscripcion-notaria',
        title: 'Protocolización de la PH - Notaría',
        institution: 'Notaría',
        dependencies: ['phv-regimen-miviot', 'phv-plano-finca-anati'],
        requirements: [
          'Resolución del MIVIOT que aprueba la incorporación al régimen.',
          'Reglamento de copropiedad y planos aprobados.',
          'Descripción y destino del proyecto y de cada unidad inmobiliaria.'
        ],
        observations: ['El plazo de cinco días hábiles es estimado en el cronograma recibido.'],
        slaDays: 5
      },
      {
        code: 'phv-inscripcion-registro',
        title: 'Inscripción de la PH y Unidades - Registro Público',
        institution: 'Registro Público',
        dependencies: ['phv-inscripcion-notaria'],
        requirements: [
          'Escritura pública de constitución del régimen con la resolución del MIVIOT, el reglamento y los planos.',
          'Solicitud de inscripción para la apertura de un folio por cada unidad inmobiliaria.'
        ],
        observations: [
          'Después de constituirse la PH se inscriben las escrituras de compraventa de las unidades.',
          'El plazo de diez días hábiles es estimado en el cronograma recibido.'
        ],
        slaDays: 10
      }
    ], 'Inscripción de PH')
  ];

  const tplPHV = await PermitTemplate.findOneAndUpdate(
    { tenantKey, name: { $in: ['PH Vertical', 'PH Vertical - Distrito de Panamá'] } },
    {
      tenantKey,
      name: 'PH Vertical',
      version: 2,
      projectTypes: ['Residencial vertical PH', 'PH vertical'],
      items: PHV_items
    },
    { upsert: true, new: true }
  );
  console.log('Plantilla PH vertical creada/actualizada:', tplPHV._id, 'Items:', tplPHV.items.length);

  /* =========================================================
   *  PLANTILLA 4: PH HORIZONTAL
   *  Urbanización + permisos de viviendas + incorporación PH.
   * ========================================================= */
  const phhRuCode = code => `phh-vivienda-${String(code || '').replace(/^ru-/, '')}`;
  const PHH_urbanItems = U_items.map(item => {
    const dependencies = [...(item.dependencies || [])];
    if (item.code === 'ur-anteproy-miviot') {
      dependencies.push('phh-revision-previa-miviot');
    }
    return {
      ...item,
      requirements: [...(item.requirements || [])],
      observations: [...(item.observations || [])],
      dependencies: [...new Set(dependencies)]
    };
  });
  const PHH_viviendaItems = RU_items.map(item => {
    const dependencies = (item.dependencies || []).map(phhRuCode);
    if (['ru-anteproy-bomberos', 'ru-anteproy-municipio'].includes(item.code)) {
      dependencies.push('ur-construccion-miviot');
    }
    return {
      ...item,
      code: phhRuCode(item.code),
      title: `${item.title} (viviendas PH)`,
      requirements: [...(item.requirements || [])],
      observations: [
        ...(item.observations || []),
        'Bloque condicional: aplica cuando el promotor construye las viviendas. Si el PH se incorpora como urbanización de lotes servidos y cada adquiriente construirá posteriormente, marcar este trámite como No aplica.'
      ],
      dependencies: [...new Set(dependencies)]
    };
  });

  const PHH_items = [
    ...withType([
      {
        code: 'phh-uso-suelo-municipio',
        title: 'Uso de Suelo y Código de Zona - Municipio',
        institution: 'Municipio (DPU)',
        requirements: [
          'Nota firmada por el propietario y el profesional idóneo con los datos registrales, superficie y ubicación de la finca.',
          'Localización regional obtenida del documento gráfico de zonificación, plano catastral o coordenadas georreferenciadas.',
          'Comprobante de pago de la tasa municipal aplicable.'
        ],
        observations: [
          'Si el uso o código vigente no permite el proyecto, deberá tramitarse el cambio de zonificación o la excepción correspondiente.',
          'Los proyectos de más de 10 ha, o de menor superficie con alta intensidad de uso, deben contar con resolución y planos del Esquema de Ordenamiento Territorial aprobados.'
        ],
        slaDays: 7
      }
    ], 'Certificación de Uso de Suelo'),
    ...withType([
      {
        code: 'phh-revision-previa-miviot',
        title: 'Calificación Previa para PH Horizontal - Ventanilla Única',
        institution: 'MIVIOT - Dirección Nacional de Ventanilla Única',
        dependencies: ['phh-uso-suelo-municipio'],
        requirements: [
          'Solicitud formal dirigida al Director(a) Nacional de Ventanilla Única, firmada por el propietario actual y el profesional idóneo responsable de la tramitación.',
          'Certificación de uso de suelo o código de zona emitida por la autoridad competente.',
          'Certificado del Registro Público de la finca, expedido dentro de los tres meses anteriores, con folio real, ubicación, superficie, medidas, colindantes, propietario, gravámenes y número de lote.',
          'Certificado del Registro Público de la persona jurídica propietaria, expedido dentro de los tres meses anteriores, cuando corresponda.',
          'Poder notariado cuando un abogado firme la solicitud en representación del propietario.',
          'Autorización notariada cuando otra persona natural o jurídica firme en representación del propietario.',
          'Copia de la cédula o pasaporte del propietario o representante legal.',
          'Dos copias del plano de urbanización, parcelación o lotificación, firmadas y selladas por el profesional y el representante legal, con nota al pie indicando que el proyecto pretende incorporarse al Régimen de Propiedad Horizontal.'
        ],
        observations: [
          'Es un requisito específico del PH horizontal establecido por la Resolución 709-2022; no forma parte de una urbanización ordinaria.',
          'Debe completarse antes de presentar los planos de construcción al municipio correspondiente.',
          'Puede presentarse presencialmente o en formato digital PDF.'
        ],
        slaDays: 0
      }
    ], 'Calificación PH Horizontal'),
    ...PHH_urbanItems,
    ...PHH_viviendaItems,
    ...withType([
      {
        code: 'phh-regimen-miviot',
        title: 'Incorporación al Régimen de Propiedad Horizontal - MIVIOT',
        institution: 'MIVIOT - Dirección de Propiedad Horizontal',
        dependencies: ['ur-construccion-miviot'],
        requirements: [...PH_REGIME_REQUIREMENTS],
        observations: [
          ...PH_REGIME_OBSERVATIONS,
          'En PH horizontal, los planos deben identificar los lotes o unidades privadas, las áreas comunes y sus porcentajes de participación.',
          'Para lotes servidos cuyas mejoras serán construidas posteriormente por cada adquiriente, la tasa se paga en dos fases: el promotor sobre el valor de la infraestructura y cada adquiriente sobre sus mejoras antes de declararlas en el Registro Público.',
          'La construcción de todas las viviendas no es requisito previo para incorporar una urbanización de lotes servidos al régimen.'
        ],
        slaDays: 45
      }
    ], 'Régimen de Propiedad Horizontal'),
    ...withType([
      {
        code: 'phh-plano-finca-anati',
        title: 'Plano de Finca en PH Horizontal - ANATI',
        institution: 'ANATI',
        dependencies: ['phh-regimen-miviot', 'ur-segregacion-anati'],
        requirements: [
          'Visto bueno del MIVIOT.',
          'Plano original con los sellos del MIVIOT y una copia del plano sellado.',
          'Archivo digital en AutoCAD con coordenadas WGS-84.',
          'Fotocopias de las cédulas del adquiriente y del propietario.',
          'Ruego notariado cuando alguna persona firme mediante huella.',
          'Copia del plano de referencia de la finca o fincas madres.',
          'Plano resultante de la finca sometida al Régimen de Propiedad Horizontal.',
          'Resolución y plano de desafectación parcial del MIVIOT, cuando corresponda.'
        ],
        observations: [
          'ANATI puede exigir vistos buenos adicionales por colindancias o afectaciones hídricas, forestales, eléctricas, viales o sanitarias.',
          'El plazo de siete días hábiles procede del cronograma recibido; ANATI no lo publica como plazo general garantizado.'
        ],
        slaDays: 7
      },
      {
        code: 'phh-inscripcion-notaria',
        title: 'Protocolización del PH Horizontal - Notaría',
        institution: 'Notaría',
        dependencies: ['phh-regimen-miviot', 'phh-plano-finca-anati'],
        requirements: [
          'Resolución del MIVIOT que aprueba la incorporación.',
          'Reglamento de copropiedad y planos aprobados.',
          'Descripción de las unidades privadas, áreas comunes y destino del proyecto.'
        ],
        observations: ['El plazo de cinco días hábiles es estimado.'],
        slaDays: 5
      },
      {
        code: 'phh-inscripcion-registro',
        title: 'Inscripción del PH Horizontal - Registro Público',
        institution: 'Registro Público',
        dependencies: ['phh-inscripcion-notaria'],
        requirements: [
          'Escritura pública de constitución con la resolución del MIVIOT, el reglamento y los planos.',
          'Inscripción de las fincas o folios correspondientes a cada unidad inmobiliaria.'
        ],
        observations: ['El plazo de diez días hábiles es estimado.'],
        slaDays: 10
      }
    ], 'Inscripción de PH')
  ];

  const tplPHH = await PermitTemplate.findOneAndUpdate(
    { tenantKey, name: 'PH Horizontal' },
    {
      tenantKey,
      name: 'PH Horizontal',
      version: 2,
      projectTypes: ['Lotes, adosados y dúplex PH', 'PH horizontal'],
      items: PHH_items
    },
    { upsert: true, new: true }
  );
  console.log('Plantilla PH horizontal creada/actualizada:', tplPHH._id, 'Items:', tplPHH.items.length);

  /* =========================================================
   *  PLANTILLA 5: PROYECTO COMERCIAL (DISTRITO DE PANAMÁ)
   *  Ruta base de edificación con bloques condicionales según
   *  escala, ubicación y actividad comercial a desarrollar.
   * ========================================================= */
  const COM_items = [
    ...withType([
      {
        code: 'com-uso-suelo-dpu',
        title: 'Certificación de Uso de Suelo - DPU',
        institution: 'Municipio de Panamá (DPU)',
        requirements: [
          'Solicitud formal en hoja 8½ x 11 dirigida al Director de Planificación Urbana y Ordenamiento Territorial, indicando motivo, dirección completa, nombre, firma, teléfono y correo del interesado.',
          'Ubicación gráfica precisa mediante Documento Gráfico de Zonificación, vista satelital o localización regional; opcionalmente plano catastral o coordenadas geográficas/UTM WGS-84.',
          'Copia de la solicitud para el recibo correspondiente.',
          'Comprobante de pago de B/.30.00 por lote o finca emitido por Tesorería Municipal.'
        ],
        observations: [
          'La certificación debe confirmar que la actividad comercial proyectada es compatible con el código de zona.',
          'Si el uso no está permitido, debe tramitarse la modificación, adición o autorización urbanística que corresponda.',
          'El trámite puede gestionarse mediante Alcaldía Digital.',
          'Los siete días hábiles proceden de la información recibida y se mantienen como estimación.'
        ],
        slaDays: 7
      }
    ], 'Certificación de Uso de Suelo'),

    ...withType([
      {
        code: 'com-sinaproc-informe',
        title: 'Inspección o Informe de Riesgo - SINAPROC',
        institution: 'SINAPROC',
        dependencies: ['com-uso-suelo-dpu'],
        requirements: [
          'Formato oficial de Solicitud de Inspección de Proyectos de SINAPROC.',
          'Datos y localización regional exacta del proyecto para coordinar la inspección de campo.',
          'Comprobante de pago de la tarifa aplicable a proyectos urbanísticos y comerciales, según superficie y ubicación.'
        ],
        observations: [
          'Bloque condicional: confirmar su exigencia según la ubicación, escala y exposición a amenazas del proyecto.',
          'El plazo de 10 días hábiles es una estimación del cronograma recibido; SINAPROC no lo publica como compromiso general.'
        ],
        slaDays: 10
      }
    ], 'Informe SINAPROC'),

    ...withType([
      {
        code: 'com-eia-miambiente',
        title: 'Estudio de Impacto Ambiental - MiAmbiente',
        institution: 'Ministerio de Ambiente',
        dependencies: ['com-uso-suelo-dpu'],
        requirements: [...PH_EIA_REQUIREMENTS],
        observations: [
          'Bloque condicional: la necesidad y categoría del EIA dependen de la actividad, magnitud, ubicación e impactos previstos.',
          'La categorización debe realizarse conforme al Decreto Ejecutivo 4 de 28 de mayo de 2026 y tramitarse mediante e-SEVIA 2.0.',
          'Los 30 días hábiles se conservan únicamente como estimación recibida para categoría I, no como plazo garantizado.'
        ],
        slaDays: 30
      }
    ], 'Estudio de Impacto Ambiental'),

    ...withType([
      {
        code: 'com-anteproyecto-bomberos',
        title: 'Anteproyecto - Bomberos',
        institution: 'DINASEPI - Benemérito Cuerpo de Bomberos',
        dependencies: ['com-uso-suelo-dpu'],
        requirements: [
          'Solicitud de revisión del anteproyecto mediante el formulario o canal vigente de DINASEPI.',
          'Plano de anteproyecto firmado y sellado por el arquitecto idóneo.',
          'Comprobante de pago de la tasa de revisión aplicable.'
        ],
        observations: [
          'La resolución de Bomberos es requisito documental para el registro del anteproyecto ante la DOYC.',
          'Confirmar con DINASEPI los requisitos particulares derivados del uso y carga de ocupación del establecimiento.',
          'El plazo de 10 días hábiles es estimado.'
        ],
        slaDays: 10
      },
      {
        code: 'com-anteproyecto-doyc',
        title: 'Anteproyecto Comercial - DOYC',
        institution: 'Municipio de Panamá (DOYC)',
        dependencies: ['com-uso-suelo-dpu', 'com-anteproyecto-bomberos'],
        requirements: [
          'Formulario de Registro en Línea de Anteproyecto completado por el arquitecto idóneo mediante Alcaldía Digital.',
          'Memorial dirigido al Director de la DOYC, firmado y sellado por el arquitecto y el propietario.',
          'Anteproyecto en un único archivo PDF de hasta 20 MB.',
          'Certificado vigente de propiedad emitido por el Registro Público.',
          'Resolución de anteproyecto emitida por el Benemérito Cuerpo de Bomberos.',
          'Cuadro de áreas que identifique los usos comerciales, depósitos, oficinas, estacionamientos y demás componentes del proyecto.'
        ],
        observations: [
          'El arquitecto y el propietario deben estar inscritos previamente como contribuyentes en el Municipio de Panamá.',
          'El anteproyecto aceptado permite promoción y contratación, pero no autoriza el inicio de la obra.',
          'La tasa publicada es B/.50.00 por trámite más B/.5.00 por cada hoja ingresada.',
          'El plazo de 15 días hábiles se mantiene como estimación.'
        ],
        slaDays: 15
      }
    ], 'Anteproyecto'),

    ...withType([
      {
        code: 'com-movilidad-attt',
        title: 'Estudio de Movilidad o Impacto Vial - ATTT',
        institution: 'ATTT / autoridad vial competente',
        dependencies: ['com-anteproyecto-doyc'],
        requirements: [
          'Solicitud de evaluación dirigida a la autoridad vial competente.',
          'Memoria del proyecto con superficie, usos, capacidad, horarios y demanda prevista.',
          'Estudio preparado por profesional idóneo con accesos, estacionamientos, carga y descarga, generación de viajes y condiciones de circulación.',
          'Planos de accesos, señalización, circulación interna y conexión con la red vial.',
          'Medidas de mitigación y demás documentos solicitados por ATTT, MOP o el Municipio según la vía afectada.'
        ],
        observations: [
          'Bloque condicional: confirmar con la DOYC y la autoridad vial si aplica por escala, intensidad de uso, estacionamientos o afectación de la red vial.',
          'No se asigna un plazo porque no se localizó un compromiso general oficial aplicable a todos los proyectos comerciales.'
        ],
        slaDays: 0
      }
    ], 'Estudio de Movilidad'),

    ...withType([
      {
        code: 'com-planos-ventanilla-doyc',
        title: 'Planos de Construcción - Ventanilla Única DOYC',
        institution: 'Ventanilla Única DOYC',
        dependencies: ['com-anteproyecto-doyc', 'com-eia-miambiente', 'com-movilidad-attt'],
        requirements: [
          'Anteproyecto aceptado por la DOYC y resolución de Bomberos.',
          'Resolución ambiental vigente, cuando el proyecto requiera EIA.',
          'Estudio o aprobación vial, cuando corresponda.',
          'Planos originales y memorias técnicas de arquitectura, estructura, electricidad, plomería, mecánica, seguridad contra incendios, elevadores y demás disciplinas aplicables.',
          'Documentos y memorias grabados individualmente en PDF, con un máximo de 20 MB por archivo, según las instrucciones de la DOYC.',
          'Aprobaciones de las entidades que correspondan dentro de Ventanilla Única: DOYC, DINASEPI, MINSA, MOP, IDAAN, ATTT, Accesibilidad, AAUD, MiAmbiente y distribuidora eléctrica.'
        ],
        observations: [
          'Marcar el EIA y el estudio vial como No aplica cuando la autoridad confirme que no son exigibles; así no bloquearán esta etapa.',
          'Los planos registrados tienen cinco años de vigencia.',
          'El plazo de 20 días hábiles se conserva como estimación operativa, no como compromiso integral de Ventanilla Única.'
        ],
        slaDays: 20
      }
    ], 'Planos de Construcción'),

    ...withType([
      {
        code: 'com-movimiento-tierra',
        title: 'Movimiento de Tierra o Terracería - DOYC',
        institution: 'Municipio de Panamá (DOYC)',
        dependencies: ['com-planos-ventanilla-doyc'],
        requirements: [
          'Solicitud y formulario del permiso de movimiento de tierra.',
          'Plano registrado de movimiento de tierra o terracería.',
          'Estudio de suelos y cálculos de corte, relleno, estabilidad y drenaje aplicables.',
          'Resolución ambiental y autorizaciones sectoriales exigibles.',
          'Paz y salvo municipal y comprobantes de pago correspondientes.'
        ],
        observations: [
          'Bloque condicional: marcar como No aplica cuando el proyecto no requiera movimiento de tierra independiente.',
          'El plazo de siete días hábiles es estimado.'
        ],
        slaDays: 7
      }
    ], 'Movimiento de Tierra'),

    ...withType([
      {
        code: 'com-construccion-doyc',
        title: 'Permiso de Construcción - DOYC',
        institution: 'Municipio de Panamá (DOYC)',
        dependencies: ['com-planos-ventanilla-doyc', 'com-movimiento-tierra'],
        requirements: [
          'Formulario digital y solicitud en tamaño legal dirigida al Director de la DOYC.',
          'Plano completo registrado en la DOYC, escaneado.',
          'Comprobante de MITRADEL cuando la obra supere B/.1,000,000.01.',
          'Contrato refrendado por la Contraloría para obras del Estado y contrato de arrendamiento, cuando corresponda.',
          'Permisos expedidos por DINASEPI y MINSA cuando sean exigibles.',
          'Resolución vigente de la JTIA para la empresa constructora.',
          'Paz y salvo de bienes inmuebles de la finca emitido por la DGI.',
          'Paz y salvo municipal vigente del constructor o empresa constructora.'
        ],
        observations: [
          'Marcar Movimiento de Tierra como No aplica cuando no sea necesario.',
          'La DOYC informa hasta 10 días hábiles para el avalúo y hasta cinco días desde el pago para expedir el permiso.'
        ],
        slaDays: 15
      }
    ], 'Permiso de Construcción'),

    ...withType([
      {
        code: 'com-ocupacion-bomberos',
        title: 'Permiso de Ocupación - Bomberos',
        institution: 'DINASEPI - Benemérito Cuerpo de Bomberos',
        dependencies: ['com-construccion-doyc'],
        requirements: [
          'Solicitud de inspección final y certificación de ocupación.',
          'Planos registrados y permiso de construcción.',
          'Sistemas de seguridad humana, electricidad, plomería y protección contra incendios listos para inspección.',
          'Pruebas y certificaciones técnicas requeridas según la actividad y carga de ocupación.'
        ],
        observations: [
          'La certificación de DINASEPI es previa al permiso de ocupación municipal.',
          'Los requisitos particulares y el plazo de 10 días deben confirmarse con DINASEPI.'
        ],
        slaDays: 10
      },
      {
        code: 'com-ocupacion-doyc',
        title: 'Permiso de Ocupación - DOYC',
        institution: 'Municipio de Panamá (DOYC)',
        dependencies: ['com-ocupacion-bomberos'],
        requirements: [
          'Nota en PDF, en hoja legal, suscrita por el profesional idóneo o empresa constructora y el propietario.',
          'Código de registro del Permiso de Construcción vinculado en Alcaldía Digital.',
          'Permiso de Ocupación expedido por DINASEPI.',
          'Certificado vigente del Registro Público de la propiedad y copia de la cédula del propietario.',
          'Certificado de existencia de la sociedad y cédula del representante legal, cuando corresponda.',
          'Paz y salvo municipal vigente del profesional idóneo o empresa constructora.',
          'Certificación de la UTP cuando el edificio supere 15 pisos.'
        ],
        observations: [
          'La DOYC coordina la inspección en un máximo de tres días hábiles y emite el permiso en un máximo de tres días hábiles desde el pago.',
          'El plazo indicado no incluye subsanaciones, reinspección, avalúo o tiempo de pago.'
        ],
        slaDays: 6
      }
    ], 'Permiso de Ocupación'),

    ...withType([
      {
        code: 'com-sanitario-minsa',
        title: 'Permiso Sanitario de Operación - MINSA',
        institution: 'MINSA / Centro de Salud competente',
        dependencies: ['com-ocupacion-doyc'],
        requirements: [
          'Solicitud ante el Centro de Salud o la unidad regional competente para la ubicación del establecimiento.',
          'Certificación notariada del Registro Público de la empresa.',
          'Planos de ubicación o construcción aprobados por MINSA.',
          'Resolución ambiental cuando aplique.',
          'Descripción de equipos, utensilios y procesos o flujograma de la actividad.',
          'Informe satisfactorio de inspección sanitaria.',
          'Manual de buenas prácticas, limpieza o saneamiento aplicable a la actividad.',
          'Carnés de salud y de manipulación de alimentos del personal, cuando corresponda.'
        ],
        observations: [
          'Bloque condicional: aplica a establecimientos de interés sanitario; los requisitos adicionales varían para alimentos, clínicas, farmacias, hospedaje, industria y otras actividades reguladas.',
          'El permiso publicado tiene vigencia de un año.',
          'Para preparación y expendio de alimentos se publica un tiempo aproximado de 30 días, sujeto a inspección.'
        ],
        slaDays: 30
      },
      {
        code: 'com-aviso-operacion-mici',
        title: 'Aviso de Operación - Panamá Emprende',
        institution: 'MICI - Panamá Emprende',
        dependencies: ['com-ocupacion-doyc', 'com-sanitario-minsa'],
        requirements: [
          'Registro del titular o representante en el sistema Panamá Emprende.',
          'Datos de la persona natural o jurídica, representante legal y establecimiento.',
          'Descripción y selección de las actividades comerciales o industriales a desarrollar.',
          'Declaración jurada de cumplimiento de las normas aplicables.',
          'Pago de la tasa que determine el sistema según el titular y las actividades.'
        ],
        observations: [
          'Para la mayoría de las actividades, el Aviso de Operación es el único trámite general de apertura comercial.',
          'Las actividades reguladas —por ejemplo salud, banca, seguros, armas, seguridad, transporte o expendio de alcohol— requieren previamente las licencias sectoriales correspondientes.',
          'Marcar el permiso sanitario como No aplica cuando la actividad no sea de interés sanitario o la autoridad confirme que no es exigible.'
        ],
        slaDays: 0
      }
    ], 'Permisos de Operación')
  ];

  const tplCOM = await PermitTemplate.findOneAndUpdate(
    { tenantKey, name: { $in: ['Proyecto Comercial', 'Proyecto Comercial - Distrito de Panamá'] } },
    {
      tenantKey,
      name: 'Proyecto Comercial',
      version: 1,
      projectTypes: ['Comercial', 'Proyecto comercial'],
      items: COM_items
    },
    { upsert: true, new: true }
  );
  console.log('Plantilla Comercial creada/actualizada:', tplCOM._id, 'Items:', tplCOM.items.length);

  console.log('✅ Seed de plantillas completado.');
  process.exit(0);
})();
