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
    this.pack,
  );
  final Inspection inspection;
  final MobileProject project;
  final List<MobileUnit> units;
  final List<InspectionUnit> saved;
  final List<CommercialFolderSummary> folders;
  final InspectionPack? pack;
}

class _InspectionScreenState extends ConsumerState<InspectionScreen> {
  late Future<_InspectionBundle> _future;
  final _observations = TextEditingController();
  DateTime? _date;
  Inspection? _inspection;
  bool _saving = false;
  String _query = '';
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
      InspectionPack? pack;
      try {
        pack = await ref
            .read(inspectionRepositoryProvider)
            .inspectionPack(widget.inspectionId);
      } catch (_) {
        // The visit remains usable with the compact inspection payload when
        // connected to an older compatible backend.
      }
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
        pack,
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

  Future<void> _editFront(Inspection inspection, int index) async {
    final original = inspection.workFronts[index];
    var progress = original.currentProgressPercent;
    var status = original.status == 'not_visited'
        ? 'in_progress'
        : original.status;
    final notes = TextEditingController(text: original.observations);
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(original.name),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${original.previousProgressKnown ? '${formatPercent(original.previousProgressPercent)} anterior' : 'Sin referencia anterior'}  →  ${formatPercent(progress)} actual',
                ),
                Slider(
                  value: progress.clamp(0, 100),
                  max: 100,
                  divisions: 100,
                  label: '${progress.round()} %',
                  onChanged: (value) => setDialogState(() => progress = value),
                ),
                DropdownButtonFormField<String>(
                  initialValue: status,
                  decoration: const InputDecoration(labelText: 'Estado'),
                  items:
                      const {
                            'in_progress': 'En progreso',
                            'no_change': 'Sin cambios',
                            'paused': 'Detenido',
                            'completed': 'Completado',
                            'not_applicable': 'No aplica',
                          }.entries
                          .map(
                            (entry) => DropdownMenuItem(
                              value: entry.key,
                              child: Text(entry.value),
                            ),
                          )
                          .toList(),
                  onChanged: (value) => setDialogState(() {
                    status = value ?? status;
                    if (status == 'no_change' &&
                        original.previousProgressKnown) {
                      progress = original.previousProgressPercent;
                    }
                  }),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: notes,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Observación del frente',
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
    final observation = notes.text.trim();
    _disposeAfterDialog([notes]);
    if (saved != true) return;
    final fronts = [...inspection.workFronts];
    fronts[index] = original.copyWith(
      status: status,
      currentProgressPercent: progress,
      observations: observation,
      visitedAt: DateTime.now(),
    );
    await _saveVisit(workFronts: fronts);
  }

  Future<void> _markNoChange(Inspection inspection, int index) async {
    if (!inspection.workFronts[index].previousProgressKnown) return;
    final fronts = [...inspection.workFronts];
    fronts[index] = fronts[index].copyWith(
      status: 'no_change',
      currentProgressPercent: fronts[index].previousProgressPercent,
      visitedAt: DateTime.now(),
    );
    await _saveVisit(workFronts: fronts);
  }

  Future<void> _editIncident(Inspection inspection, [int? index]) async {
    final existing = index == null ? null : inspection.incidents[index];
    var type = existing?.type ?? 'other';
    var severity = existing?.severity ?? 'medium';
    var status = existing?.status ?? 'open';
    var frontKey = existing?.workFrontKey ?? '';
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
          title: Text(index == null ? 'Nueva incidencia' : 'Editar incidencia'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
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
                DropdownButtonFormField<String?>(
                  initialValue: frontKey.isEmpty ? null : frontKey,
                  decoration: const InputDecoration(
                    labelText: 'Frente relacionado',
                  ),
                  items: inspection.workFronts
                      .map(
                        (front) => DropdownMenuItem<String?>(
                          value: front.key,
                          child: Text(front.name),
                        ),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setDialogState(() => frontKey = value ?? ''),
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
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Guardar'),
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

  Future<void> _editSchedule(Inspection inspection) async {
    final original = inspection.scheduleAssessment;
    var status = original?.status ?? 'not_assessed';
    final planned = TextEditingController(
      text: original?.plannedProgressPercent?.toStringAsFixed(1) ?? '',
    );
    final notes = TextEditingController(text: original?.notes ?? '');
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Avance respecto al programa'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: status,
                  decoration: const InputDecoration(labelText: 'Situación'),
                  items:
                      const {
                            'on_track': 'En plazo',
                            'at_risk': 'En riesgo',
                            'delayed': 'Retrasado',
                            'not_assessed': 'Sin evaluar',
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
                const SizedBox(height: 12),
                TextField(
                  controller: planned,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Avance previsto a la fecha (%)',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: notes,
                  minLines: 3,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: 'Explicación o previsión',
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
    final plannedValue = double.tryParse(planned.text.replaceAll(',', '.'));
    final noteText = notes.text.trim();
    _disposeAfterDialog([planned, notes]);
    if (accepted == true)
      await _saveVisit(
        scheduleAssessment: InspectionScheduleAssessment(
          status: status,
          plannedProgressPercent: plannedValue,
          forecastCompletionDate: original?.forecastCompletionDate,
          notes: noteText,
        ),
      );
  }

  Widget _incidentsView(_InspectionBundle bundle) {
    final inspection = _inspection ?? bundle.inspection;
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
        if (inspection.incidents.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: Text('No hay incidencias registradas.'),
            ),
          ),
        ...inspection.incidents.asMap().entries.map((entry) {
          final item = entry.value;
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
                      onPressed: () => _editIncident(inspection, entry.key),
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
                EvidenceSection(
                  inspectionId: inspection.id,
                  incidentId: item.id.isEmpty ? null : item.id,
                  workFrontKey: item.workFrontKey,
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

  String _scheduleLabel(String? status) =>
      const {
        'on_track': 'en plazo',
        'at_risk': 'en riesgo',
        'delayed': 'retrasado',
        'not_assessed': 'sin evaluar',
      }[status] ??
      'sin evaluar';

  Widget _reviewView(_InspectionBundle bundle) {
    final inspection = _inspection ?? bundle.inspection;
    final previous = bundle.pack?.previousPhysicalProgressPercent ?? 0;
    final period = inspection.projectProgressPercent - previous;
    final visited = inspection.workFronts
        .where((front) => front.status != 'not_visited')
        .length;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Revisión de la visita',
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _VisitMetric('Anterior', formatPercent(previous))),
            const SizedBox(width: 8),
            Expanded(
              child: _VisitMetric(
                'Periodo',
                '${period >= 0 ? '+' : ''}${period.toStringAsFixed(1)} pts',
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _VisitMetric(
                'Acumulado',
                formatPercent(inspection.projectProgressPercent),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Comprobación rápida',
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 10),
                Text(
                  '$visited/${inspection.workFronts.length} frentes revisados',
                ),
                Text(
                  '${inspection.incidents.where((item) => item.status != 'resolved').length} incidencias abiertas o en seguimiento',
                ),
                Text(
                  'Programa: ${_scheduleLabel(inspection.scheduleAssessment?.status)}',
                ),
                if (inspection.scheduleAssessment?.plannedProgressPercent !=
                    null)
                  Text(
                    'Previsto ${formatPercent(inspection.scheduleAssessment!.plannedProgressPercent!)} · real ${formatPercent(inspection.projectProgressPercent)} · desviación ${(inspection.projectProgressPercent - inspection.scheduleAssessment!.plannedProgressPercent!) >= 0 ? '+' : ''}${(inspection.projectProgressPercent - inspection.scheduleAssessment!.plannedProgressPercent!).toStringAsFixed(1)} pts',
                  ),
                if ((inspection.scheduleAssessment?.notes ?? '').isNotEmpty)
                  Text(inspection.scheduleAssessment!.notes),
              ],
            ),
          ),
        ),
        if (!inspection.isFinalized) ...[
          const SizedBox(height: 12),
          _InspectionStep(
            icon: Icons.calendar_month_outlined,
            title: 'Comparar con el programa',
            subtitle:
                inspection.scheduleAssessment?.plannedProgressPercent == null
                ? 'Indicar avance previsto y situación del plazo'
                : '${formatPercent(inspection.scheduleAssessment!.plannedProgressPercent!)} previsto · ${formatPercent(inspection.projectProgressPercent)} real · ${_scheduleLabel(inspection.scheduleAssessment!.status)}',
            onTap: () => _editSchedule(inspection),
          ),
        ],
        const SizedBox(height: 12),
        EvidenceSection(
          inspectionId: inspection.id,
          editable: !inspection.isFinalized,
          title: 'Fotografías generales',
        ),
        const SizedBox(height: 12),
        _InspectionStep(
          icon: inspection.isFinalized
              ? Icons.verified_outlined
              : Icons.description_outlined,
          title: inspection.isFinalized
              ? 'Ver informe firmado'
              : 'Ver informe, concluir y firmar',
          subtitle: inspection.isFinalized
              ? inspection.reportNumber
              : 'Previsualiza el PDF completo antes de cerrar la inspección.',
          emphasized: true,
          onTap: () async {
            await context.push(
              '/projects/${widget.projectId}/inspections/${widget.inspectionId}/report',
            );
            if (mounted) _reload();
          },
        ),
        const SizedBox(height: 24),
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
        final completion = bundle.units.isEmpty
            ? 0.0
            : (bundle.saved.length / bundle.units.length).clamp(0.0, 1.0);

        // Agrupa visualmente por Torre/Etapa (carpeta comercial existente).
        // No cambia qué unidades hay ni cómo se guarda su avance: solo el
        // orden en que se muestran.
        final foldersById = {
          for (final folder in bundle.folders) folder.id: folder,
        };
        const unassignedKey = '';
        final unitsByFolder = <String, List<MobileUnit>>{};
        for (final unit in visibleUnits) {
          final key =
              (unit.folderId != null && foldersById.containsKey(unit.folderId))
              ? unit.folderId!
              : unassignedKey;
          unitsByFolder.putIfAbsent(key, () => []).add(unit);
        }
        final orderedFolderKeys = [
          ...bundle.folders
              .map((folder) => folder.id)
              .where(unitsByFolder.containsKey),
          if (unitsByFolder.containsKey(unassignedKey)) unassignedKey,
        ];
        final hasNamedGroups = orderedFolderKeys.any(
          (key) => key != unassignedKey,
        );
        if (_area == 1) return _incidentsView(bundle);
        if (_area == 2) return _reviewView(bundle);
        final currentInspection = _inspection ?? bundle.inspection;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (bundle.pack != null) ...[
              Card(
                color: Bank73Colors.blue.withValues(alpha: .06),
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Contexto preparado por Bank73',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Inspección ${bundle.pack!.sequence} · ${bundle.pack!.hasPreviousInspection ? 'comparada con la última inspección certificada' : 'primera inspección certificable'}',
                        style: const TextStyle(color: Bank73Colors.muted),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: _VisitMetric(
                              'Anterior',
                              formatPercent(
                                bundle.pack!.previousPhysicalProgressPercent,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: _VisitMetric(
                              'Gestión',
                              formatPercent(
                                bundle.pack!.administrativeProgressPercent,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: _VisitMetric(
                              'Financiero',
                              formatPercent(
                                bundle.pack!.financialProgressPercent,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (bundle.pack!.activeFronts.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Text(
                          '${bundle.pack!.activeFronts.length} frente(s) activos según el programa.',
                          style: const TextStyle(color: Bank73Colors.muted),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
            ],
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
            if (currentInspection.workFronts.isNotEmpty) ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Frentes de obra',
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    '${currentInspection.workFronts.where((front) => front.status != 'not_visited').length}/${currentInspection.workFronts.length}',
                    style: const TextStyle(color: Bank73Colors.muted),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ...currentInspection.workFronts.asMap().entries.map((entry) {
                final front = entry.value;
                return Card(
                  child: ExpansionTile(
                    leading: CircleAvatar(
                      child: Text('${front.currentProgressPercent.round()}'),
                    ),
                    title: Text(front.name),
                    subtitle: Text(
                      '${front.previousProgressKnown ? '${formatPercent(front.previousProgressPercent)} anterior' : 'Sin referencia anterior'} · ${formatPercent(front.currentProgressPercent)} actual${front.plannedProgressPercent == null ? '' : ' · ${formatPercent(front.plannedProgressPercent!)} previsto'}',
                    ),
                    trailing: StatusPill(
                      front.status == 'not_visited'
                          ? 'Pendiente'
                          : front.status == 'no_change'
                          ? 'Sin cambios'
                          : 'Revisado',
                      success: front.status != 'not_visited',
                    ),
                    childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    children: [
                      if (front.observations.isNotEmpty)
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text(front.observations),
                        ),
                      if (!currentInspection.isFinalized)
                        Wrap(
                          spacing: 8,
                          children: [
                            OutlinedButton.icon(
                              onPressed: _saving || !front.previousProgressKnown
                                  ? null
                                  : () => _markNoChange(
                                      currentInspection,
                                      entry.key,
                                    ),
                              icon: const Icon(Icons.horizontal_rule),
                              label: const Text('Sin cambios'),
                            ),
                            FilledButton.tonalIcon(
                              onPressed: _saving
                                  ? null
                                  : () => _editFront(
                                      currentInspection,
                                      entry.key,
                                    ),
                              icon: const Icon(Icons.trending_up),
                              label: const Text('Registrar avance'),
                            ),
                          ],
                        ),
                      EvidenceSection(
                        inspectionId: currentInspection.id,
                        workFrontKey: front.key,
                        category: 'progress',
                        editable: !currentInspection.isFinalized,
                        embedded: true,
                        title: 'Fotos del frente',
                      ),
                    ],
                  ),
                );
              }),
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
            const SizedBox(height: 22),
            Card(
              child: ExpansionTile(
                key: PageStorageKey('visit-units-${widget.inspectionId}'),
                initiallyExpanded: false,
                maintainState: true,
                tilePadding: const EdgeInsets.all(18),
                childrenPadding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
                title: Text(
                  'Unidades de la visita',
                  style: Theme.of(context).textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(
                  '${bundle.saved.length}/${bundle.units.length} unidades revisadas',
                  style: const TextStyle(color: Bank73Colors.muted),
                ),
                children: [
                  const SizedBox(height: 5),
                  const Text(
                    'Registra únicamente las unidades revisadas hoy. Las demás quedarán pendientes, no incompletas.',
                    style: TextStyle(color: Bank73Colors.muted),
                  ),
                  const SizedBox(height: 12),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: completion,
                      minHeight: 7,
                      backgroundColor: Bank73Colors.border,
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    // Keep the search scroll offset separate from the tile's
                    // persisted expanded/collapsed boolean in PageStorage.
                    key: PageStorageKey(
                      'visit-units-search-${widget.inspectionId}',
                    ),
                    onChanged: (value) => setState(() => _query = value),
                    decoration: const InputDecoration(
                      hintText: 'Buscar código, manzana, lote o modelo',
                      prefixIcon: Icon(Icons.search_rounded),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (bundle.units.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Text(
                          'Este proyecto no tiene unidades disponibles.',
                        ),
                      ),
                    )
                  else if (visibleUnits.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(20),
                        child: Text(
                          'No hay unidades que coincidan con la búsqueda.',
                        ),
                      ),
                    )
                  else if (!hasNamedGroups)
                    ...visibleUnits.map(
                      (unit) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
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
                    )
                  else
                    ...orderedFolderKeys.expand(
                      (folderKey) => [
                        Padding(
                          padding: const EdgeInsets.only(top: 8, bottom: 6),
                          child: Text(
                            folderKey == unassignedKey
                                ? 'Sin torre/etapa asignada'
                                : foldersById[folderKey]!.name,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              color: Bank73Colors.strongBlue,
                            ),
                          ),
                        ),
                        ...unitsByFolder[folderKey]!.map(
                          (unit) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
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
                ],
              ),
            ),
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

class _VisitMetric extends StatelessWidget {
  const _VisitMetric(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: Bank73Colors.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: Bank73Colors.muted, fontSize: 12),
        ),
        const SizedBox(height: 3),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
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
    this.emphasized = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool emphasized;

  @override
  Widget build(BuildContext context) => Card(
    color: emphasized ? Bank73Colors.navy : Colors.white,
    child: ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.all(16),
      leading: CircleAvatar(
        backgroundColor: emphasized
            ? Colors.white.withValues(alpha: .12)
            : Bank73Colors.blue.withValues(alpha: .14),
        child: Icon(
          icon,
          color: emphasized ? Colors.white : Bank73Colors.strongBlue,
        ),
      ),
      title: Text(
        title,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: emphasized ? Colors.white : Bank73Colors.ink,
        ),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 5),
        child: Text(
          subtitle,
          style: TextStyle(
            color: emphasized ? Colors.white70 : Bank73Colors.muted,
          ),
        ),
      ),
      trailing: Icon(
        Icons.chevron_right,
        color: emphasized ? Colors.white : null,
      ),
    ),
  );
}
