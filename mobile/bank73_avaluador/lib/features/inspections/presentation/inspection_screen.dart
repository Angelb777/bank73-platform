import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../portfolio/data/project_repository.dart';
import '../../units/presentation/units_screen.dart';
import '../data/inspection_repository.dart';
import 'evidence_section.dart';

class InspectionScreen extends ConsumerStatefulWidget {
  const InspectionScreen({
    super.key,
    required this.projectId,
    required this.inspectionId,
  });
  final String projectId;
  final String inspectionId;
  @override
  ConsumerState<InspectionScreen> createState() => _InspectionScreenState();
}

class _InspectionBundle {
  const _InspectionBundle(
    this.inspection,
    this.project,
    this.units,
    this.saved,
    this.folders,
  );
  final Inspection inspection;
  final MobileProject project;
  final List<MobileUnit> units;
  final List<InspectionUnit> saved;
  final List<CommercialFolderSummary> folders;
}

class _InspectionScreenState extends ConsumerState<InspectionScreen> {
  late Future<_InspectionBundle> _future;
  final _observations = TextEditingController();
  DateTime? _date;
  Inspection? _inspection;
  bool _saving = false;
  String _query = '';
  String _incidentFilter = 'all';
  int _area = 0;

  void _disposeAfterDialog(List<TextEditingController> controllers) {
    Future<void>.delayed(kThemeAnimationDuration, () {
      for (final controller in controllers) {
        controller.dispose();
      }
    });
  }

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _observations.dispose();
    super.dispose();
  }

  Future<_InspectionBundle> _load() async {
    try {
      final inspection = await ref
          .read(inspectionRepositoryProvider)
          .inspection(widget.inspectionId);
      final results = await Future.wait([
        ref.read(projectRepositoryProvider).project(widget.projectId),
        ref.read(projectRepositoryProvider).units(widget.projectId),
        ref
            .read(inspectionRepositoryProvider)
            .inspectedUnits(widget.inspectionId),
        ref.read(projectRepositoryProvider).commercialFolders(widget.projectId),
      ]);
      if (mounted) {
        _inspection = inspection;
        _date = inspection.inspectionDate?.toLocal() ?? DateTime.now();
        _observations.text = inspection.generalObservations;
      }
      return _InspectionBundle(
        inspection,
        results[0] as MobileProject,
        results[1] as List<MobileUnit>,
        results[2] as List<InspectionUnit>,
        results[3] as List<CommercialFolderSummary>,
      );
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  void _reload() {
    final future = _load();
    setState(() {
      _future = future;
    });
  }

  Future<void> _pickDate() async {
    final selected = await showDatePicker(
      context: context,
      initialDate: _date ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (selected != null) setState(() => _date = selected);
  }

  Future<void> _saveGeneral() async {
    final current = _inspection;
    if (current == null || _date == null) return;
    setState(() => _saving = true);
    try {
      final updated = await ref
          .read(inspectionRepositoryProvider)
          .updateInspection(
            widget.inspectionId,
            version: current.version,
            inspectionDate: _date!,
            generalObservations: _observations.text.trim(),
          );
      _inspection = updated;
      if (mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Borrador actualizado.')));
    } on ApiException catch (error) {
      if (error.isVersionConflict) {
        if (mounted) await _showConflict();
        _reload();
      } else if (mounted) {
        await presentApiError(context, ref, error);
      }
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _showConflict() => showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('El borrador ha cambiado'),
      content: const Text(
        'Existe una versión más reciente. La volveremos a cargar para evitar sobrescribirla.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Recargar'),
        ),
      ],
    ),
  );

  Future<void> _saveVisit({
    List<InspectionWorkFront>? workFronts,
    List<InspectionIncident>? incidents,
    String? qualityObservations,
    String? environmentalObservations,
    InspectionQuickAssessment? qualityAssessment,
    InspectionQuickAssessment? environmentalAssessment,
    InspectionScheduleAssessment? scheduleAssessment,
  }) async {
    final current = _inspection;
    if (current == null) return;
    setState(() => _saving = true);
    try {
      _inspection = await ref
          .read(inspectionRepositoryProvider)
          .saveVisit(
            inspectionId: current.id,
            version: current.version,
            workFronts: workFronts,
            incidents: incidents,
            qualityObservations: qualityObservations,
            environmentalObservations: environmentalObservations,
            qualityAssessment: qualityAssessment,
            environmentalAssessment: environmentalAssessment,
            scheduleAssessment: scheduleAssessment,
          );
      _reload();
    } on ApiException catch (error) {
      if (error.isVersionConflict) {
        await _showConflict();
        _reload();
      } else if (mounted) {
        await presentApiError(context, ref, error);
      }
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _editIncident(
    Inspection inspection, {
    int? index,
    String initialScopeType = 'project',
    String initialScopeId = '',
    String initialWorkFrontKey = '',
  }) async {
    final existing = index == null ? null : inspection.incidents[index];
    var type = existing?.type ?? 'other';
    var severity = existing?.severity ?? 'medium';
    var status = existing?.status ?? 'open';
    var frontKey = existing?.workFrontKey ?? initialWorkFrontKey;
    var scopeType = existing?.scopeType ?? initialScopeType;
    var scopeId = existing?.scopeId ?? initialScopeId;
    final scopeLocked = initialScopeType != 'project';
    var impactSchedule = existing?.impactSchedule ?? false;
    var impactCost = existing?.impactCost ?? false;
    var impactQuality = existing?.impactQuality ?? false;
    final title = TextEditingController(text: existing?.title ?? '');
    final description = TextEditingController(
      text: existing?.description ?? '',
    );
    final location = TextEditingController(text: existing?.location ?? '');
    final action = TextEditingController(text: existing?.actionRequired ?? '');
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          insetPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 20,
          ),
          contentPadding: const EdgeInsets.fromLTRB(24, 12, 24, 8),
          actionsPadding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
          constraints: const BoxConstraints(maxWidth: 720),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(28),
          ),
          title: Row(
            children: [
              const CircleAvatar(child: Icon(Icons.report_problem_outlined)),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  index == null ? 'Nueva incidencia' : 'Editar incidencia',
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Describe lo observado y dónde requiere seguimiento.',
                  style: TextStyle(color: Bank73Colors.muted),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  initialValue: type,
                  decoration: const InputDecoration(labelText: 'Tipo'),
                  items:
                      const {
                            'change': 'Cambio de obra',
                            'delay': 'Retraso',
                            'defect': 'Defecto',
                            'quality': 'Calidad',
                            'environment': 'Medioambiente',
                            'risk': 'Riesgo',
                            'other': 'Otro',
                          }.entries
                          .map(
                            (e) => DropdownMenuItem(
                              value: e.key,
                              child: Text(e.value),
                            ),
                          )
                          .toList(),
                  onChanged: (value) =>
                      setDialogState(() => type = value ?? type),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: title,
                  autofocus: true,
                  decoration: const InputDecoration(labelText: 'Título'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: description,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Qué se observó',
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: location,
                  decoration: const InputDecoration(labelText: 'Ubicación'),
                ),
                const SizedBox(height: 10),
                if (!scopeLocked)
                  DropdownButtonFormField<String?>(
                    initialValue: frontKey.isEmpty ? null : frontKey,
                    decoration: const InputDecoration(
                      labelText: 'Agrupación relacionada',
                    ),
                    items: inspection.workFronts
                        .where((front) => front.sourceType == 'folder')
                        .map(
                          (front) => DropdownMenuItem<String?>(
                            value: front.key,
                            child: Text(front.name),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => setDialogState(() {
                      frontKey = value ?? '';
                      scopeType = frontKey.isEmpty ? 'project' : 'folder';
                      scopeId = frontKey.replaceFirst('folder:', '');
                    }),
                  ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: severity,
                        decoration: const InputDecoration(
                          labelText: 'Severidad',
                        ),
                        items:
                            const {
                                  'low': 'Baja',
                                  'medium': 'Media',
                                  'high': 'Alta',
                                  'critical': 'Crítica',
                                }.entries
                                .map(
                                  (e) => DropdownMenuItem(
                                    value: e.key,
                                    child: Text(e.value),
                                  ),
                                )
                                .toList(),
                        onChanged: (value) =>
                            setDialogState(() => severity = value ?? severity),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: status,
                        decoration: const InputDecoration(labelText: 'Estado'),
                        items:
                            const {
                                  'open': 'Abierta',
                                  'monitoring': 'Seguimiento',
                                  'resolved': 'Resuelta',
                                }.entries
                                .map(
                                  (e) => DropdownMenuItem(
                                    value: e.key,
                                    child: Text(e.value),
                                  ),
                                )
                                .toList(),
                        onChanged: (value) =>
                            setDialogState(() => status = value ?? status),
                      ),
                    ),
                  ],
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: impactSchedule,
                  title: const Text('Impacta plazo'),
                  onChanged: (value) =>
                      setDialogState(() => impactSchedule = value ?? false),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: impactCost,
                  title: const Text('Impacta coste'),
                  onChanged: (value) =>
                      setDialogState(() => impactCost = value ?? false),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: impactQuality,
                  title: const Text('Impacta calidad'),
                  onChanged: (value) =>
                      setDialogState(() => impactQuality = value ?? false),
                ),
                TextField(
                  controller: action,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Acción o seguimiento requerido',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.pop(dialogContext, true),
              icon: const Icon(Icons.check_rounded),
              label: const Text('Guardar incidencia'),
            ),
          ],
        ),
      ),
    );
    final item = InspectionIncident(
      id: existing?.id ?? '',
      type: type,
      severity: severity,
      status: status,
      title: title.text.trim(),
      description: description.text.trim(),
      location: location.text.trim(),
      scopeType: scopeType,
      scopeId: scopeId,
      workFrontKey: frontKey,
      impactSchedule: impactSchedule,
      impactCost: impactCost,
      impactQuality: impactQuality,
      actionRequired: action.text.trim(),
      carriedFromIncidentId: existing?.carriedFromIncidentId,
      observedAt: existing?.observedAt ?? DateTime.now(),
    );
    _disposeAfterDialog([title, description, location, action]);
    if (accepted != true || item.title.isEmpty) return;
    final incidents = [...inspection.incidents];
    if (index == null) {
      incidents.add(item);
    } else {
      incidents[index] = item;
    }
    await _saveVisit(incidents: incidents);
  }

  Future<void> _editQualityEnvironment(Inspection inspection) async {
    final quality = TextEditingController(text: inspection.qualityObservations);
    final environment = TextEditingController(
      text: inspection.environmentalObservations,
    );
    var qualityStatus = inspection.qualityAssessment?.status ?? 'not_assessed';
    var environmentStatus =
        inspection.environmentalAssessment?.status ?? 'not_assessed';
    final qualityChecks = <String>{...?inspection.qualityAssessment?.checks};
    final environmentChecks = <String>{
      ...?inspection.environmentalAssessment?.checks,
    };
    const statuses = {
      'conforming': 'Conforme',
      'observations_required': 'Con observaciones',
      'non_conforming': 'No conforme',
      'not_assessed': 'Sin evaluar',
    };
    const qualityOptions = {
      'structure': 'Estructura',
      'materials': 'Materiales',
      'workmanship': 'Ejecución',
      'finishes': 'Acabados',
    };
    const environmentOptions = {
      'waste': 'Residuos',
      'dust': 'Polvo',
      'drainage': 'Drenaje',
      'erosion': 'Erosión',
    };
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Calidad y medioambiente'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Calidad',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: statuses.entries
                      .map(
                        (entry) => ChoiceChip(
                          label: Text(entry.value),
                          selected: qualityStatus == entry.key,
                          onSelected: (_) =>
                              setDialogState(() => qualityStatus = entry.key),
                        ),
                      )
                      .toList(),
                ),
                Wrap(
                  spacing: 6,
                  children: qualityOptions.entries
                      .map(
                        (entry) => FilterChip(
                          label: Text(entry.value),
                          selected: qualityChecks.contains(entry.key),
                          onSelected: (selected) => setDialogState(
                            () => selected
                                ? qualityChecks.add(entry.key)
                                : qualityChecks.remove(entry.key),
                          ),
                        ),
                      )
                      .toList(),
                ),
                TextField(
                  controller: quality,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Observación breve de calidad',
                    hintText: 'Solo excepciones o aspectos relevantes',
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Medioambiente',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: statuses.entries
                      .map(
                        (entry) => ChoiceChip(
                          label: Text(entry.value),
                          selected: environmentStatus == entry.key,
                          onSelected: (_) => setDialogState(
                            () => environmentStatus = entry.key,
                          ),
                        ),
                      )
                      .toList(),
                ),
                Wrap(
                  spacing: 6,
                  children: environmentOptions.entries
                      .map(
                        (entry) => FilterChip(
                          label: Text(entry.value),
                          selected: environmentChecks.contains(entry.key),
                          onSelected: (selected) => setDialogState(
                            () => selected
                                ? environmentChecks.add(entry.key)
                                : environmentChecks.remove(entry.key),
                          ),
                        ),
                      )
                      .toList(),
                ),
                TextField(
                  controller: environment,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Observación ambiental breve',
                    hintText: 'Solo excepciones o aspectos relevantes',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Guardar'),
            ),
          ],
        ),
      ),
    );
    final qualityText = quality.text.trim();
    final environmentText = environment.text.trim();
    _disposeAfterDialog([quality, environment]);
    if (accepted == true)
      await _saveVisit(
        qualityObservations: qualityText,
        environmentalObservations: environmentText,
        qualityAssessment: InspectionQuickAssessment(
          status: qualityStatus,
          checks: qualityChecks.toList(),
          observations: qualityText,
        ),
        environmentalAssessment: InspectionQuickAssessment(
          status: environmentStatus,
          checks: environmentChecks.toList(),
          observations: environmentText,
        ),
      );
  }

  Widget _incidentsView(_InspectionBundle bundle) {
    final inspection = _inspection ?? bundle.inspection;
    final visibleIncidents = inspection.incidents
        .where(
          (item) =>
              _incidentFilter == 'all' || item.scopeType == _incidentFilter,
        )
        .toList();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Incidencias de la visita',
                style: Theme.of(context).textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            if (!inspection.isFinalized)
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 180),
                child: FilledButton.icon(
                  onPressed: _saving ? null : () => _editIncident(inspection),
                  icon: const Icon(Icons.add),
                  label: const Text('Añadir'),
                ),
              ),
          ],
        ),
        const SizedBox(height: 6),
        const Text(
          'Registra solo excepciones: cambios, retrasos, defectos, riesgos o hallazgos relevantes.',
          style: TextStyle(color: Bank73Colors.muted),
        ),
        const SizedBox(height: 14),
        DropdownButtonFormField<String>(
          initialValue: _incidentFilter,
          decoration: const InputDecoration(labelText: 'Filtrar incidencias'),
          items:
              const {
                    'all': 'Todas',
                    'project': 'Globales del proyecto',
                    'folder': 'Etapa / Torre / Bloque',
                    'unit': 'Unidades',
                    'common_area': 'Zonas comunes',
                  }.entries
                  .map(
                    (entry) => DropdownMenuItem(
                      value: entry.key,
                      child: Text(entry.value),
                    ),
                  )
                  .toList(),
          onChanged: (value) =>
              setState(() => _incidentFilter = value ?? 'all'),
        ),
        const SizedBox(height: 14),
        if (visibleIncidents.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: Text('No hay incidencias registradas.'),
            ),
          ),
        ...visibleIncidents.map((item) {
          final originalIndex = inspection.incidents.indexOf(item);
          return Card(
            child: ExpansionTile(
              leading: Icon(
                item.severity == 'critical' || item.severity == 'high'
                    ? Icons.warning_amber_rounded
                    : Icons.info_outline,
                color: item.status == 'resolved' ? Colors.green : null,
              ),
              title: Text(item.title),
              subtitle: Text(
                '${item.type} · ${item.severity} · ${item.status}',
              ),
              trailing: inspection.isFinalized
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () =>
                          _editIncident(inspection, index: originalIndex),
                    ),
              childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              children: [
                if (item.description.isNotEmpty)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(item.description),
                  ),
                if (item.actionRequired.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text('Seguimiento: ${item.actionRequired}'),
                    ),
                  ),
                if (item.scopeType == 'project')
                  EvidenceSection(
                    inspectionId: inspection.id,
                    incidentId: item.id.isEmpty ? null : item.id,
                    category: 'incident',
                    editable: !inspection.isFinalized,
                    embedded: true,
                    title: 'Fotografías de la incidencia',
                  ),
              ],
            ),
          );
        }),
        const SizedBox(height: 10),
        _InspectionStep(
          icon: Icons.fact_check_outlined,
          title: 'Calidad y medioambiente',
          subtitle:
              inspection.qualityAssessment == null &&
                  inspection.environmentalAssessment == null
              ? 'Evaluar con controles rápidos'
              : 'Calidad: ${_assessmentLabel(inspection.qualityAssessment?.status)} · Ambiente: ${_assessmentLabel(inspection.environmentalAssessment?.status)}',
          onTap: inspection.isFinalized
              ? () {}
              : () => _editQualityEnvironment(inspection),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  String _assessmentLabel(String? status) =>
      const {
        'conforming': 'conforme',
        'observations_required': 'con observaciones',
        'non_conforming': 'no conforme',
        'not_assessed': 'sin evaluar',
      }[status] ??
      'sin evaluar';

  List<Widget> _physicalRouteWidgets({
    required _InspectionBundle bundle,
    required List<CommercialFolderSummary> routeFolders,
    required Inspection inspection,
    required List<MobileUnit> visibleUnits,
    required Map<String, double> progressByUnit,
    required Map<String, List<MobileUnit>> visibleUnitsByFolder,
    required Map<String, List<MobileUnit>> allUnitsByFolder,
    required List<String> orderedFolderKeys,
    required bool hasPhysicalGrouping,
  }) {
    final foldersById = {for (final folder in routeFolders) folder.id: folder};
    final header = Row(
      children: [
        Expanded(
          child: Text(
            'Recorrido de inspección',
            style: Theme.of(context).textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
        Text(
          '${bundle.saved.length}/${bundle.units.length} unidades revisadas',
          style: const TextStyle(color: Bank73Colors.muted),
        ),
      ],
    );
    final search = TextField(
      key: PageStorageKey('visit-units-search-${widget.inspectionId}'),
      onChanged: (value) => setState(() => _query = value),
      decoration: const InputDecoration(
        hintText: 'Buscar unidad dentro del recorrido',
        prefixIcon: Icon(Icons.search_rounded),
      ),
    );
    if (!hasPhysicalGrouping) {
      return [
        header,
        const SizedBox(height: 8),
        search,
        const SizedBox(height: 10),
        ...visibleUnits.map(
          (unit) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: UnitTile(
              unit: unit,
              progress: progressByUnit[unit.id],
              onTap: () async {
                await context.push(
                  '/projects/${widget.projectId}/inspections/${widget.inspectionId}/units/${unit.id}',
                );
                if (mounted) _reload();
              },
            ),
          ),
        ),
      ];
    }
    return [
      header,
      const SizedBox(height: 8),
      search,
      const SizedBox(height: 10),
      ...orderedFolderKeys.map((folderKey) {
        final folder = foldersById[folderKey];
        if (folder == null) return const SizedBox.shrink();
        final groupUnits =
            visibleUnitsByFolder[folderKey] ?? const <MobileUnit>[];
        final allGroupUnits =
            allUnitsByFolder[folderKey] ?? const <MobileUnit>[];
        final automaticProgress = allGroupUnits.isEmpty
            ? 0.0
            : allGroupUnits.fold<double>(
                    0,
                    (sum, unit) => sum + (progressByUnit[unit.id] ?? 0),
                  ) /
                  allGroupUnits.length;
        final frontIndex = inspection.workFronts.indexWhere(
          (front) =>
              front.sourceType == 'folder' && front.sourceId == folderKey,
        );
        final front = frontIndex < 0 ? null : inspection.workFronts[frontIndex];
        final frontKey = front?.key ?? 'folder:$folderKey';
        return Card(
          child: ExpansionTile(
            key: PageStorageKey('inspection-group-${inspection.id}-$folderKey'),
            initiallyExpanded: false,
            maintainState: true,
            title: Text(folder.name),
            subtitle: Text(
              '${allGroupUnits.length} unidades · ${formatPercent(automaticProgress)} de avance medio',
            ),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              if (front != null && front.observations.isNotEmpty)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(front.observations),
                ),
              if (!inspection.isFinalized)
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton.tonalIcon(
                    onPressed: _saving
                        ? null
                        : () => _editIncident(
                            inspection,
                            initialScopeType: 'folder',
                            initialScopeId: folderKey,
                            initialWorkFrontKey: frontKey,
                          ),
                    icon: const Icon(Icons.report_problem_outlined),
                    label: const Text('Añadir incidencia'),
                  ),
                ),
              ...inspection.incidents
                  .where(
                    (item) =>
                        item.scopeType == 'folder' && item.scopeId == folderKey,
                  )
                  .map(
                    (item) => EvidenceSection(
                      inspectionId: inspection.id,
                      incidentId: item.id.isEmpty ? null : item.id,
                      workFrontKey: frontKey,
                      category: 'incident',
                      editable: !inspection.isFinalized,
                      embedded: true,
                      title: 'Incidencia: ${item.title}',
                    ),
                  ),
              EvidenceSection(
                inspectionId: inspection.id,
                workFrontKey: frontKey,
                category: 'progress',
                editable: !inspection.isFinalized,
                embedded: true,
                title: 'Fotografías de la agrupación',
              ),
              const Divider(height: 28),
              ...groupUnits.map(
                (unit) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: UnitTile(
                    unit: unit,
                    progress: progressByUnit[unit.id],
                    onTap: () async {
                      await context.push(
                        '/projects/${widget.projectId}/inspections/${widget.inspectionId}/units/${unit.id}',
                      );
                      if (mounted) _reload();
                    },
                  ),
                ),
              ),
            ],
          ),
        );
      }),
    ];
  }

  Widget _reviewView(_InspectionBundle bundle) {
    final inspection = _inspection ?? bundle.inspection;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: Bank73Colors.blue.withValues(alpha: .1),
                  child: Icon(
                    inspection.isFinalized
                        ? Icons.verified_outlined
                        : Icons.description_outlined,
                    color: Bank73Colors.blue,
                    size: 30,
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  'Informe de la inspección',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Text(
                  inspection.isFinalized
                      ? 'Informe firmado y disponible para consulta.'
                      : 'Listo para revisar y firmar.',
                  style: const TextStyle(color: Bank73Colors.muted),
                ),
                const SizedBox(height: 22),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () async {
                      await context.push(
                        '/projects/${widget.projectId}/inspections/${widget.inspectionId}/report',
                      );
                      if (mounted) _reload();
                    },
                    icon: Icon(
                      inspection.isFinalized
                          ? Icons.visibility_outlined
                          : Icons.draw_outlined,
                    ),
                    label: Text(
                      inspection.isFinalized
                          ? 'Ver informe firmado'
                          : 'Abrir informe y firmar',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Inspección'),
    body: FutureBuilder<_InspectionBundle>(
      future: _future,
      builder: (context, snapshot) {
        // Keep the existing list mounted while refreshing after a unit visit,
        // preserving its scroll position and expansion state.
        if (snapshot.connectionState != ConnectionState.done &&
            !snapshot.hasData)
          return const LoadingView();
        if (snapshot.hasError || !snapshot.hasData)
          return ErrorView(onRetry: _reload);
        final bundle = snapshot.data!;
        final progressByUnit = {
          for (final item in bundle.saved) item.unitId: item.progressPercent,
        };
        final visibleUnits = bundle.units
            .where((unit) => unit.matches(_query))
            .toList();
        // Agrupa visualmente por Torre/Etapa (carpeta comercial existente).
        // No cambia qué unidades hay ni cómo se guarda su avance: solo el
        // orden en que se muestran.
        final rawUnassignedFolder = bundle.folders
            .where((folder) => folder.isUnassigned)
            .firstOrNull;
        final configuredUnassignedName = bundle.project.commercialUnassignedName
            .trim();
        final configuredUnassignedFolder = rawUnassignedFolder == null
            ? null
            : CommercialFolderSummary(
                id: rawUnassignedFolder.id,
                name: configuredUnassignedName.isNotEmpty
                    ? configuredUnassignedName
                    : rawUnassignedFolder.name,
                color: bundle.project.commercialUnassignedColor.isNotEmpty
                    ? bundle.project.commercialUnassignedColor
                    : rawUnassignedFolder.color,
                order: rawUnassignedFolder.order,
                isUnassigned: true,
                unitCount: rawUnassignedFolder.unitCount,
              );
        final needsUnassignedGroup = bundle.units.any(
          (unit) =>
              unit.folderId == null ||
              !bundle.folders.any((folder) => folder.id == unit.folderId),
        );
        final fallbackUnassignedFolder =
            needsUnassignedGroup && configuredUnassignedFolder == null
            ? CommercialFolderSummary(
                id: 'unassigned',
                name: configuredUnassignedName.isNotEmpty
                    ? configuredUnassignedName
                    : 'Unidades sin agrupación',
                color: bundle.project.commercialUnassignedColor,
                order: -1,
                isUnassigned: true,
              )
            : null;
        final routeFolders = [
          ?configuredUnassignedFolder,
          ?fallbackUnassignedFolder,
          ...bundle.folders.where((folder) => !folder.isUnassigned),
        ];
        final foldersById = {
          for (final folder in routeFolders) folder.id: folder,
        };
        final unassignedFolder =
            configuredUnassignedFolder ?? fallbackUnassignedFolder;
        final unassignedKey = unassignedFolder?.id ?? '';
        final allUnitsByFolder = <String, List<MobileUnit>>{};
        for (final unit in bundle.units) {
          final key =
              (unit.folderId != null && foldersById.containsKey(unit.folderId))
              ? unit.folderId!
              : unassignedKey;
          allUnitsByFolder.putIfAbsent(key, () => []).add(unit);
        }
        final visibleUnitsByFolder = <String, List<MobileUnit>>{};
        for (final unit in visibleUnits) {
          final key =
              (unit.folderId != null && foldersById.containsKey(unit.folderId))
              ? unit.folderId!
              : unassignedKey;
          visibleUnitsByFolder.putIfAbsent(key, () => []).add(unit);
        }
        final orderedFolderKeys = [
          ...routeFolders
              .map((folder) => folder.id)
              .where(allUnitsByFolder.containsKey),
        ];
        final hasPhysicalGrouping =
            routeFolders.any((folder) => !folder.isUnassigned) ||
            (unassignedFolder != null &&
                unassignedFolder.name.trim().toLowerCase() != 'sin carpeta');
        if (_area == 1) return _incidentsView(bundle);
        if (_area == 2) return _reviewView(bundle);
        final currentInspection = _inspection ?? bundle.inspection;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      bundle.project.name,
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    if (bundle.project.location.display.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        bundle.project.location.display,
                        style: const TextStyle(color: Bank73Colors.muted),
                      ),
                    ],
                    const Divider(height: 28),
                    Row(
                      children: [
                        StatusPill(
                          bundle.inspection.isFinalized
                              ? 'Informe finalizado'
                              : 'Borrador',
                          success: bundle.inspection.isFinalized,
                        ),
                        const Spacer(),
                        Text(
                          'v${_inspection?.version ?? bundle.inspection.version}',
                          style: const TextStyle(color: Bank73Colors.muted),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Datos generales',
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 14),
                    InkWell(
                      onTap: bundle.inspection.isFinalized ? null : _pickDate,
                      borderRadius: BorderRadius.circular(14),
                      child: InputDecorator(
                        decoration: const InputDecoration(
                          labelText: 'Fecha de inspección',
                          prefixIcon: Icon(Icons.calendar_today_outlined),
                        ),
                        child: Text(DateFormat('dd/MM/yyyy').format(_date!)),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _observations,
                      readOnly: bundle.inspection.isFinalized,
                      minLines: 3,
                      maxLines: 6,
                      decoration: const InputDecoration(
                        labelText: 'Observaciones generales',
                        alignLabelWithHint: true,
                      ),
                    ),
                    if (!bundle.inspection.isFinalized) ...[
                      const SizedBox(height: 16),
                      FilledButton.icon(
                        onPressed: _saving ? null : _saveGeneral,
                        icon: const Icon(Icons.save_outlined),
                        label: Text(
                          _saving ? 'Guardando…' : 'Guardar borrador',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            if (bundle.units.isNotEmpty) ...[
              const SizedBox(height: 14),
              ..._physicalRouteWidgets(
                bundle: bundle,
                routeFolders: routeFolders,
                inspection: currentInspection,
                visibleUnits: visibleUnits,
                progressByUnit: progressByUnit,
                visibleUnitsByFolder: visibleUnitsByFolder,
                allUnitsByFolder: allUnitsByFolder,
                orderedFolderKeys: orderedFolderKeys,
                hasPhysicalGrouping: hasPhysicalGrouping,
              ),
            ],
            const SizedBox(height: 14),
            _InspectionStep(
              icon: Icons.construction_outlined,
              title: 'Avance general y zonas comunes',
              subtitle:
                  '${formatPercent(bundle.inspection.projectProgressPercent)} de avance general · independiente de las unidades',
              onTap: () async {
                await context.push(
                  '/projects/${widget.projectId}/inspections/${widget.inspectionId}/project-progress',
                );
                if (mounted) _reload();
              },
            ),
            if (bundle.inspection.methodology != null) ...[
              const SizedBox(height: 14),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Metodología',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${bundle.inspection.methodology!.name} · versión ${bundle.inspection.methodology!.version}',
                        style: const TextStyle(color: Bank73Colors.muted),
                      ),
                      const SizedBox(height: 12),
                      ...bundle.inspection.methodology!.sections.map(
                        (section) => Padding(
                          padding: const EdgeInsets.only(bottom: 7),
                          child: Row(
                            children: [
                              Expanded(child: Text(section.name)),
                              Text(
                                '${formatPercent(section.weight)} peso',
                                style: const TextStyle(
                                  color: Bank73Colors.muted,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 24),
          ],
        );
      },
    ),
    bottomNavigationBar: NavigationBar(
      selectedIndex: _area,
      onDestinationSelected: (value) => setState(() => _area = value),
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.route_outlined),
          selectedIcon: Icon(Icons.route),
          label: 'Recorrido',
        ),
        NavigationDestination(
          icon: Icon(Icons.report_problem_outlined),
          selectedIcon: Icon(Icons.report_problem),
          label: 'Incidencias',
        ),
        NavigationDestination(
          icon: Icon(Icons.fact_check_outlined),
          selectedIcon: Icon(Icons.fact_check),
          label: 'Revisión',
        ),
      ],
    ),
  );
}

class _InspectionStep extends StatelessWidget {
  const _InspectionStep({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    color: Colors.white,
    child: ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.all(16),
      leading: CircleAvatar(
        backgroundColor: Bank73Colors.blue.withValues(alpha: .14),
        child: Icon(icon, color: Bank73Colors.strongBlue),
      ),
      title: Text(
        title,
        style: TextStyle(fontWeight: FontWeight.w600, color: Bank73Colors.ink),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 5),
        child: Text(subtitle, style: TextStyle(color: Bank73Colors.muted)),
      ),
      trailing: const Icon(Icons.chevron_right),
    ),
  );
}
