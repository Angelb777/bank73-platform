'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'project.html'), 'utf8');
const unified = fs.readFileSync(path.join(root, 'public', 'js', 'project-unified.js'), 'utf8');
const unifiedCss = fs.readFileSync(path.join(root, 'public', 'css', 'project-unified.css'), 'utf8');
const project = fs.readFileSync(path.join(root, 'public', 'js', 'project.js'), 'utf8');
const stagesService = fs.readFileSync(path.join(root, 'services', 'projectStages.js'), 'utf8');

test('carga la capa unificada antes del controlador historico', () => {
  const unifiedIndex = html.indexOf('/js/project-unified.js');
  const projectIndex = html.indexOf('/js/project.js');
  assert.ok(unifiedIndex > 0);
  assert.ok(projectIndex > unifiedIndex);
});

test('reutiliza los paneles existentes en vez de duplicar sus formularios', () => {
  assert.match(unified, /document\.getElementById\(`tab-\$\{key\}`\)/);
  assert.match(unified, /appendChild\(timelinePane\)/);
  assert.match(unified, /appendChild\(commercialPane\)/);
  assert.doesNotMatch(unified, /id="btnCrearLote"/);
});

test('expone una ficha de etapa conectada a la fase mediante stageId', () => {
  assert.match(project, /String\(item\.stageId \|\| ''\) === stageId/);
  assert.match(project, /mountStageSection: mountUnifiedStageSection/);
  assert.match(unified, /mountStageSection\?\.\(tab, stageId, content\)/);
  assert.doesNotMatch(unified, /data-stage-finance/);
});

test('mantiene el visor 3D fuera de la capa de reorganizacion', () => {
  assert.doesNotMatch(unified, /project3dPanel/);
  assert.match(html, /id="project3dPanel"/);
});

test('el appbar centra el proyecto, aporta iconos y elimina el menu redundante', () => {
  assert.match(unified, /topbar\.appendChild\(projectName\)/);
  assert.match(unified, /addExistingButtonIcon\(cover, ICONS\.cover\)/);
  assert.match(unified, /addExistingButtonIcon\(dossier, ICONS\.dossier\)/);
  assert.doesNotMatch(unified, /unifiedMoreBtn/);
  assert.match(unifiedCss, /left:50%;top:50%/);
});

test('todas las areas abren su bloque dentro del mismo resumen global', () => {
  for (const id of ['summaryCommercialBlock', 'summaryLegalBlock', 'summaryTechnicalBlock', 'summaryFinancialBlock']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(unified, new RegExp(`'${id}'`));
  }
  assert.match(unified, /await openPanel\('resumen', 'Resumen global'\)/);
  assert.match(unified, /pane\.querySelectorAll\('canvas'\)[\s\S]*?\.resize\(\)/);
  assert.match(unified, /stableSummarySectionTop\(target, body\)/);
  assert.match(unified, /summarySectionScrollTop\(target, body\)/);
  assert.doesNotMatch(unified, /behavior:\s*'smooth'/);
});

test('el resumen reutiliza el avance global del cronograma y mantiene las minigraficas compactas', () => {
  assert.match(project, /globalProgress: globalProgress\(\)/);
  assert.match(unified, /const globalProgress = Number\(snapshot\.globalProgress \|\| 0\)/);
  assert.doesNotMatch(unified, /progressValues\.reduce/);
  assert.match(unified, /class="unified-area-chart"[^>]*>.*<em>\$\{pct\}%<\/em>/s);
  assert.match(unifiedCss, /\.unified-headline-kpis>span\{[^}]*text-align:center/);
  assert.match(unified, /id="unifiedTimelineAlertKpi"[^>]*><small>Avisos activos<\/small>/);
  assert.doesNotMatch(unified, /id="unifiedHeadlineKpis"[\s\S]*?<small>Avisos activos<\/small>[\s\S]*?<\/button>/);
  assert.match(unifiedCss, /\.unified-timeline-kpi\{[^}]*text-align:center/);
});

test('el cronograma tiene superficies y texto especificos para modo oscuro', () => {
  assert.match(unifiedCss, /body:not\(\.light-theme\).*#tab-proyecto/);
  assert.match(unifiedCss, /\.cl-card\{background:#111c31!important/);
  assert.match(unifiedCss, /\.role-row\{background:#15223a!important/);
});

test('la primera etapa sustituye la pseudo carpeta historica', () => {
  assert.match(stagesService, /name: 'Etapa 1'/);
  assert.match(stagesService, /folderId: firstStage\._id/);
  assert.match(project, /unassigned\.length \|\| !foldersCache\.length/);
  assert.match(project, /\? 'Etapa 1' : name/);
});

test('la ficha de etapa monta los gestores existentes sin duplicar formularios', () => {
  assert.match(project, /mountUnifiedStageSection/);
  assert.match(project, /openFinancePhaseLines\(phase, 'real', 'overview', \{ embedded: true \}\)/);
  assert.match(project, /openFinanceRequirements\(phase, 'real'\)/);
  assert.match(project, /document\.getElementById\('tab-tecnico'\)/);
  assert.match(unified, /mountStageSection/);
  assert.match(unified, /data-stage-fullscreen/);
  assert.match(project, /surface\.className = 'unified-stage-finance-surface'/);
  assert.doesNotMatch(project, /host\.replaceChildren\(portal\)/);
  assert.match(project, /openFinancePhaseLines\(phase, 'real', 'overview', \{ embedded: true \}\)/);
  assert.match(project, /openFinanceRequirements\(phase, 'real', \{ embedded: true \}\)/);
  assert.match(project, /embedded \? document\.getElementById\('financePhaseLinesModal'\) : mountFinancePhaseModal\(\)/);
  assert.match(project, /modal\?\.querySelector\('\.requirements-modal'\)/);
  assert.match(project, /host\.replaceChildren\(panel\)/);
  assert.doesNotMatch(project, /host\.replaceChildren\(modal\)/);
  assert.match(unifiedCss, /is-integrated-requirements>\.requirements-modal\{/);
});

test('un clic de etapa abre una sola ficha integral', () => {
  assert.match(unified, /openingStageId === requestedStageId/);
  assert.match(unified, /event\.stopPropagation\(\)/);
  assert.match(html, /project-unified\.css\?v=23/);
  assert.match(html, /project-unified\.js\?v=23/);
  assert.match(html, /project\.js\?v=fallen-sales-phase-v2/);
});

test('etapas y unidades alterna entre comercial finanzas y tecnica sin duplicar unidades', () => {
  assert.match(unified, /id="unifiedUnitsModeSwitch"/);
  assert.match(unified, /\['commercial', 'Comercial'\][\s\S]*\['finance', 'Finanzas'\][\s\S]*\['technical', 'Técnico'\]/);
  assert.match(unified, /technicalHost\.appendChild\(technicalUnits\)/);
  assert.match(unified, /financeHost\.appendChild\(financePane\)/);
  assert.match(unified, /prepareUnitsMode\?\.\('technical'\)/);
  assert.match(project, /prepareUnitsMode: prepareUnifiedUnitsMode/);
  assert.match(project, /role === 'commercial' \|\| role === 'tecnico'/);
  assert.match(project, /openUnit: abrirFichaUnidad/);
  assert.match(unifiedCss, /unified-technical-units-host \.construction-completed/);
});

test('los niveles global y de etapa mantienen el orden comercial finanzas tecnico', () => {
  assert.match(unified, /\['commercial', 'Comercial'\][\s\S]*\['finance', 'Finanzas'\][\s\S]*\['technical', 'Técnico'\]/);
  assert.match(unified, /tabs\.push\(\['commercial', 'Comercial'\]\)[\s\S]*tabs\.push\(\['finance', 'Finanzas'\]\)[\s\S]*tabs\.push\(\['technical', 'Técnico'\]\)/);
  assert.match(unified, /financeHost\.appendChild\(financePane\)/);
  assert.match(project, /if \(mode === 'finance'\) \{[\s\S]*await loadFinance\(\{ force: false \}\)/);
});

test('la pestaña comercial de etapa es informativa y usa los datos comerciales canonicos', () => {
  assert.match(project, /const salesMap = commercialData\.sales instanceof Map/);
  assert.match(project, /commercial: \{[\s\S]*salesValue:[\s\S]*cppValue:[\s\S]*units:/);
  assert.match(unified, /tab === 'commercial'/);
  assert.match(unified, /Detalle comercial/);
  assert.doesNotMatch(unified, /data-stage-commercial-save/);
});

test('el resumen comercial de etapa conserva solo los dos importes y filtra por estado', () => {
  const commercialBlock = unified.slice(unified.indexOf("if (tab === 'commercial')"), unified.indexOf("if (tab === 'finance')"));
  assert.match(commercialBlock, /Valor comercial/);
  assert.match(commercialBlock, /Financiación CPP/);
  assert.doesNotMatch(commercialBlock, /metric\('Unidades'/);
  assert.doesNotMatch(commercialBlock, /metric\('Disponibles'/);
  assert.match(commercialBlock, /data-stage-commercial-filter/);
  assert.match(commercialBlock, /data-commercial-status/);
  assert.match(unified, /stageModal\.addEventListener\('change'/);
});

test('cada modo global oculta el contenido de los otros modos', () => {
  assert.match(unified, /toggleAttribute\('hidden', next !== 'commercial'\)/);
  assert.match(unified, /commercialPane\.dataset\.unifiedMode = next/);
  assert.match(unifiedCss, /data-unified-mode="finance"/);
});

test('el snapshot unificado resuelve localmente las etiquetas comerciales', () => {
  assert.match(project, /const commercialStatusLabel = value =>/);
  assert.match(project, /status: commercialStatusLabel\(unit\.estado\)/);
  assert.doesNotMatch(project, /status: estadoLabel\(unit\.estado\)/);
});

test('el tercer bloque global se presenta como Proyecto', () => {
  assert.match(unified, /<h2>Proyecto<\/h2>/);
  assert.match(unified, /aria-label="Vista global del proyecto"/);
});

test('tecnico agrupa sus acciones y muestra zonas comunes desplegables', () => {
  assert.match(html, /class="technical-action-group"/);
  assert.match(html, /id="technicalCommonAreasSection"/);
  assert.match(html, /id="technicalCommonAreasOverallBar"/);
  assert.match(html, /id="technicalProjectOverallBar"/);
  assert.match(html, /id="technicalUnitsAverageBar"/);
  assert.match(project, /renderTechnicalCommonAreas/);
  assert.match(project, /function technicalUnitsAverageProgress\(\)/);
  assert.match(project, /const global = Math\.round\(\(common \+ units\.value\) \/ 2\)/);
  assert.match(project, /technical-common-areas/);
  assert.match(unifiedCss, /\.technical-common-area>summary/);
  assert.match(unifiedCss, /\.technical-common-activity/);
});

test('la ficha técnica de unidad integra el avance y las actividades de Flutter', () => {
  assert.match(project, /class="technical-unit-progress-panel"/);
  assert.match(project, /technical-unit-progress\/\$\{encodeURIComponent\(unitId\)\}/);
  assert.match(project, /data-technical-unit-activity-range/);
  assert.match(project, /initTechnicalUnitProgress\(viewFicha, unitId\)/);
  assert.match(project, /technicalConstructionStatusFromProgress/);
  assert.match(project, /technicalConstructionStatusTarget/);
  assert.match(project, /statusSelect\?\.addEventListener\('change'/);
  assert.match(unifiedCss, /\.technical-unit-progress-toggle/);
  assert.match(unifiedCss, /\.technical-unit-progress-activity/);
});

test('el rol tecnico entra directamente en su vista y la ficha de etapa no repite las unidades', () => {
  assert.match(unified, /snapshot\.role === 'tecnico' \? 'technical'/);
  assert.match(unified, /document\.getElementById\('technicalUnitsSection'\)/);
  assert.match(unified, /commercialPane\.appendChild\(technicalHost\)/);
  assert.match(project, /window\.abrirFichaUnidad\?\.\(unitId, \{ mode:'technical' \}\)/);
});

test('solo tecnico y comercial pierden el resumen y los demas roles conservan la vista integral', () => {
  assert.match(project, /const canViewAllProjectAreas = !\['commercial', 'tecnico'\]\.includes\(role\)/);
  assert.match(project, /summary: canViewSummary/);
  assert.match(project, /FULL_ACCESS_ROLES = \['admin','bank','promoter','gerencia','socios','financiero','contable','legal','avaluador'\]/);
});

test('los editores integrales comparten permisos y banco solo edita imagenes del proyecto', () => {
  assert.match(project, /FULL_EDIT_ROLES = \['admin','promoter','gerencia','socios','financiero','contable','legal'\]/);
  assert.match(project, /PROJECT_MEDIA_EDIT_ROLES = \[\.\.\.FULL_EDIT_ROLES, 'bank'\]/);
  assert.match(project, /projectSettings: FULL_EDIT_ROLES\.includes\(role\)/);
});

test('las tarjetas reservan espacio para avisos y el vacio es legible en modo claro', () => {
  assert.match(unifiedCss, /\.unit-card:has\(\.unit-card-expiry-alerts\)/);
  assert.match(unifiedCss, /body\.light-theme .*commercial-folder-body>\.empty/);
});

test('el cronograma comienza completamente contraido', () => {
  assert.match(project, /collapsed: new Set\(PHASES\.map\(phase => phase\.key\)\)/);
  assert.doesNotMatch(project, /firstWithItems/);
  assert.match(unified, /active: false/);
});

test('la ficha cancela montajes tardios al cambiar de pestaña', () => {
  assert.match(unified, /stageTabRequest/);
  assert.match(unified, /stageTabTransition = stageTabTransition\.catch/);
  assert.match(unified, /pendingStageTab === tab/);
  assert.match(unified, /requestId !== stageTabRequest/);
  assert.match(unified, /unmountStageSection\?\.\(mount\)/);
});

test('finanzas, requisitos y técnico quedan vinculados a la etapa seleccionada', () => {
  assert.match(project, /String\(item\.stageId \|\| ''\) === normalizedStageId/);
  assert.match(project, /technicalWorkspace\.stageFilter = normalizedStageId/);
  assert.match(project, /String\(unit\.folderId \|\| ''\) === String\(technicalWorkspace\.stageFilter\)/);
  assert.match(project, /\['finance', 'requirements'\]\.includes\(type\) && !FINANCE/);
});

test('roles y semáforo usan una fila compacta y controles por icono', () => {
  assert.match(unifiedCss, /roles-panel\{order:1;position:static;display:grid!important;grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(unifiedCss, /#rolesList\{grid-column:2/);
  assert.match(html, /timeline-icon-button" id="configProyectoBtn"/);
  assert.match(html, /id="togglePendientesBtn"[^>]+aria-label="Mostrar solo pendientes"/);
});

test('la cabecera y las tres pestañas de etapa no se comprimen', () => {
  assert.match(unifiedCss, /aside>nav\{flex:0 0 auto;min-height:64px/);
  assert.match(unifiedCss, /aside>nav\{[^}]*justify-content:center/);
  assert.match(unifiedCss, /aside>nav button\{flex:0 0 auto;min-height:42px/);
  assert.match(unifiedCss, /\.unified-stage-content\{flex:1 1 auto;min-height:0/);
});

test('la ficha muestra carga inmediata y ocupa el viewport al ampliar', () => {
  assert.match(unified, /class="unified-stage-busy" role="status"/);
  assert.match(unified, /technical: 'Cargando Técnico…'/);
  assert.match(unified, /100 \/ pageZoom/);
  assert.match(unifiedCss, /\.unified-stage-drawer\.is-fullscreen\{[^}]*width:var\(--unified-fullscreen-width/);
  assert.match(unifiedCss, /\.unified-stage-drawer\.is-fullscreen aside\{[^}]*width:100%!important[^}]*height:100%!important[^}]*max-width:none!important/);
  assert.match(project, /technicalWorkspace\.loaded && !force/);
});

test('la etapa clicable sustituye la etiqueta secundaria por una pill principal', () => {
  assert.match(unifiedCss, /commercial-folder\[data-folder-id\] \.folder-title\{[^}]*border-radius:999px[^}]*cursor:pointer/);
  assert.doesNotMatch(unifiedCss, /folder-title::after\{content:"Ficha integral"/);
});

test('ventas caídas es el primer bloque de detalle en Comercial y no abre otro popup', () => {
  const folderIndex = html.indexOf('id="btnCrearCarpetaComercial"');
  const fallenSectionIndex = unified.indexOf('class="unified-stage-fallen-sales-section"');
  const commercialDetailIndex = unified.indexOf('aria-label="Unidades comerciales de la etapa"');
  assert.ok(folderIndex >= 0);
  assert.ok(fallenSectionIndex >= 0 && commercialDetailIndex > fallenSectionIndex);
  assert.doesNotMatch(html, /id="btnVentasCaidasComercial"/);
  assert.match(unified, /data-stage-fallen-sales-host/);
  assert.match(unified, /mountStageFallenSales/);
  assert.doesNotMatch(unified, /openStageFallenSales/);
  assert.doesNotMatch(project, /class="commercial-folders-toolbar"/);
  assert.match(unifiedCss, /unified-stage-fallen-sales-section/);
});

test('el fondo unificado no cambia de tono al superar el alto inicial', () => {
  assert.match(unifiedCss, /body\.project-unified-ready\{min-height:100%;background:#0f1422!important;background-image:none!important/);
});

test('cada requisito permite adjuntar sin desplegar su detalle', () => {
  const controlsIndex = project.indexOf('class="requirement-card-controls"');
  const bodyIndex = project.indexOf('data-requirement-card-body', controlsIndex);
  const uploadIndex = project.indexOf('requirement-quick-upload', controlsIndex);
  assert.ok(controlsIndex >= 0 && uploadIndex > controlsIndex && uploadIndex < bodyIndex);
  assert.match(project, /data-requirement-upload-label>Adjuntar archivo/);
  assert.match(project, /uploadLabel\.textContent = 'Adjuntado'/);
});

test('las imágenes seguras inexistentes no se solicitan repetidamente', () => {
  assert.match(project, /const failedSecureImageUrls = new Set\(\)/);
  assert.match(project, /img\.dataset\.secureLoaded = 'error'/);
  assert.doesNotMatch(project, /console\.error\('\[secure image\]'/);
});

test('el arranque unificado comparte fuentes y aplaza los paneles secundarios', () => {
  assert.match(project, /function getProjectChecklists\(/);
  assert.match(project, /function getProjectDocuments\(/);
  assert.match(project, /function getProjectCommercialFolders\(/);
  assert.match(project, /getProjectUnitsAll\(\{ force: refreshCanonicalData \}\)/);

  const init = project.slice(project.indexOf('// ====== Init ======'));
  const blockingInit = init.slice(0, init.indexOf('finishInitialProjectLoad();'));
  const fullRoleInit = blockingInit.slice(blockingInit.indexOf('// Roles full'));
  assert.match(fullRoleInit, /await Promise\.all\(\[\s*loadSummary\(\),\s*loadUnits\(\)\s*\]\)/);
  assert.doesNotMatch(fullRoleInit, /loadProyectoData\(\)[\s\S]*?\]\)/);
  assert.doesNotMatch(fullRoleInit, /loadFinance\(/);
  assert.match(project, /if \(key === 'finanzas' && !FINANCE\) await loadFinance\(\{ force: false \}\)/);
  assert.match(init, /scheduleInitialOperationalDataLoad\(deferredInitialOperationalLoad\)/);
  assert.doesNotMatch(blockingInit, /await loadChatMessages\(/);
  assert.doesNotMatch(blockingInit, /await refreshCommercialDossier\(/);
  assert.match(init, /refreshChatUnreadStatus\(\)\.catch/);
});

test('la ficha integral cierra una sola ventana y reutiliza sus fuentes internas', () => {
  assert.match(unified, /stageModal\.hidden = true;[\s\S]*await cleanupStageMount\(\)/);
  assert.match(project, /await closeEmbeddedFinancePhase\(handle\)/);
  assert.doesNotMatch(project, /handle\.surface\?\.remove\(\);\s*await closeFinancePhaseModal\(\)/);
  assert.match(project, /const projectDocuments = await getProjectDocuments\(\)/);
  assert.match(project, /FINANCE_AVALUATION_CONTEXT = await getProjectAvaluationContext\(\)/);
  assert.match(project, /const hadPendingChanges = !!flushAutosave\?\.hasPendingChanges/);
});
