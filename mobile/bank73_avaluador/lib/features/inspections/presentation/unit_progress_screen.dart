import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../portfolio/data/project_repository.dart';
import '../data/inspection_repository.dart';
import 'evidence_section.dart';
import 'incident_editor.dart';

class UnitProgressScreen extends ConsumerStatefulWidget {
  const UnitProgressScreen({
    super.key,
    required this.projectId,
    required this.inspectionId,
    required this.unitId,
  });
  final String projectId;
  final String inspectionId;
  final String unitId;
  @override
  ConsumerState<UnitProgressScreen> createState() => _UnitProgressScreenState();
}

class _ProgressBundle {
  const _ProgressBundle(
    this.inspection,
    this.project,
    this.unit,
    this.saved,
    this.previous,
  );
  final Inspection inspection;
  final MobileProject project;
  final MobileUnit unit;
  final InspectionUnit? saved;
  final InspectionUnit? previous;
}

class _EditableActivity {
  _EditableActivity({
    required this.key,
    required this.name,
    required this.progress,
    this.applicable = true,
  });
  final String key;
  String name;
  double progress;
  bool applicable;
}

const _horizontalActivities = <String>[
  'Movimiento de tierra y cimentación',
  'Estructura',
  'Mampostería y divisiones',
  'Cubierta e impermeabilización',
  'Repellos y paredes',
  'Fontanería e instalaciones sanitarias',
  'Instalaciones eléctricas',
  'Pisos y revestimientos',
  'Carpintería',
  'Aluminio y vidrios',
  'Cielos y gypsum',
  'Pintura',
  'Puertas y ventanas',
  'Cocina y mobiliario fijo',
  'Aparatos sanitarios',
  'Obras exteriores y conexiones',
  'Terminaciones y limpieza',
];

const _verticalActivities = <String>[
  'Mampostería y divisiones',
  'Instalaciones sanitarias',
  'Instalaciones eléctricas',
  'Climatización y ventilación',
  'Sistema contra incendios',
  'Repellos y paredes',
  'Cielos y gypsum',
  'Pisos y revestimientos',
  'Carpintería',
  'Aluminio y vidrios',
  'Puertas',
  'Cocina y armarios',
  'Aparatos sanitarios',
  'Pintura',
  'Terminaciones y limpieza',
];

class _UnitProgressScreenState extends ConsumerState<UnitProgressScreen> {
  late Future<_ProgressBundle> _future;
  final _observations = TextEditingController();
  final List<_EditableActivity> _activities = [];
  InspectionUnit? _saved;
  bool _saving = false;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _future = _loadAndApply();
  }

  @override
  void dispose() {
    _observations.dispose();
    super.dispose();
  }

  Future<_ProgressBundle> _loadAndApply() async {
    try {
      final repository = ref.read(inspectionRepositoryProvider);
      final results = await Future.wait([
        repository.inspection(widget.inspectionId),
        ref.read(projectRepositoryProvider).project(widget.projectId),
        ref
            .read(projectRepositoryProvider)
            .unit(widget.projectId, widget.unitId),
        repository.inspectedUnit(widget.inspectionId, widget.unitId),
        repository.previousInspectedUnit(
          projectId: widget.projectId,
          currentInspectionId: widget.inspectionId,
          unitId: widget.unitId,
        ),
      ]);
      final bundle = _ProgressBundle(
        results[0] as Inspection,
        results[1] as MobileProject,
        results[2] as MobileUnit,
        results[3] as InspectionUnit?,
        results[4] as InspectionUnit?,
      );
      if (mounted) {
        _saved = bundle.saved;
        _dirty = false;
        _observations.text = bundle.saved?.observations ?? '';
        final startingActivities =
            bundle.saved?.activities ?? bundle.previous?.activities;
        _activities
          ..clear()
          ..addAll(
            startingActivities != null && startingActivities.isNotEmpty
                ? startingActivities.map(
                    (item) => _EditableActivity(
                      key: item.key,
                      name: item.name,
                      progress: item.progressPercent,
                      applicable: item.applicable,
                    ),
                  )
                : _defaultActivities(
                    bundle.project.projectType,
                    bundle.saved?.progressPercent ??
                        bundle.previous?.progressPercent ??
                        0,
                  ),
          );
      }
      return bundle;
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  void _reload() => setState(() => _future = _loadAndApply());

  List<_EditableActivity> _defaultActivities(
    String projectType,
    double initialProgress,
  ) {
    final normalized = projectType.toLowerCase();
    final source =
        normalized.contains('vertical') ||
            normalized.contains('torre') ||
            normalized.contains('apartamento')
        ? _verticalActivities
        : _horizontalActivities;
    return source
        .asMap()
        .entries
        .map(
          (entry) => _EditableActivity(
            key: 'activity_${entry.key + 1}',
            name: entry.value,
            progress: initialProgress,
          ),
        )
        .toList();
  }

  double get _estimate {
    final applicable = _activities.where((item) => item.applicable).toList();
    if (applicable.isEmpty) return 0;
    return applicable.fold<double>(0, (sum, item) => sum + item.progress) /
        applicable.length;
  }

  double? _previousProgress(_ProgressBundle bundle, String key) => bundle
      .previous
      ?.activities
      ?.where((item) => item.key == key)
      .firstOrNull
      ?.progressPercent;

  Future<void> _save(_ProgressBundle bundle) async {
    if (!_activities.any((item) => item.applicable)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Deja al menos una actividad aplicable.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final repository = ref.read(inspectionRepositoryProvider);
      final saved = await repository.saveActivityProgress(
        inspectionId: widget.inspectionId,
        unitId: widget.unitId,
        version: _saved?.version ?? 0,
        activities: _activities
            .asMap()
            .entries
            .map(
              (entry) => InspectionUnitActivity(
                key: entry.value.key,
                name: entry.value.name,
                order: entry.key,
                progressPercent: entry.value.progress,
                applicable: entry.value.applicable,
              ),
            )
            .toList(),
        observations: _observations.text.trim(),
      );
      setState(() {
        _saved = saved;
        _dirty = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Avance guardado en el borrador.')),
        );
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (error) {
      if (error.isVersionConflict) {
        if (mounted) {
          await showDialog<void>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('El avance ha cambiado'),
              content: const Text(
                'Existe una versión más reciente. La recargaremos antes de continuar.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('Recargar'),
                ),
              ],
            ),
          );
          _reload();
        }
      } else if (mounted) {
        await presentApiError(context, ref, error);
      }
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _addActivity() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Añadir actividad'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 160,
          decoration: const InputDecoration(
            labelText: 'Nombre de la actividad',
          ),
          onSubmitted: (value) {
            if (value.trim().isNotEmpty)
              Navigator.pop(dialogContext, value.trim());
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                Navigator.pop(dialogContext, controller.text.trim());
              }
            },
            child: const Text('Añadir'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || !mounted) return;
    setState(() {
      _activities.add(
        _EditableActivity(
          key: 'custom_${DateTime.now().microsecondsSinceEpoch}',
          name: name,
          progress: 0,
        ),
      );
      _dirty = true;
    });
  }

  Future<void> _renameActivity(_EditableActivity activity) async {
    final controller = TextEditingController(text: activity.name);
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Editar actividad'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 160,
          decoration: const InputDecoration(labelText: 'Nombre'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty || !mounted) return;
    setState(() {
      activity.name = name;
      _dirty = true;
    });
  }

  Future<void> _addIncident(_ProgressBundle bundle) async {
    final label = bundle.unit.code.isNotEmpty
        ? bundle.unit.code
        : 'Unidad ${bundle.unit.lote}';
    final incident = await showContextIncidentEditor(
      context,
      scopeType: 'unit',
      scopeId: widget.unitId,
      scopeLabel: label,
    );
    if (incident == null) return;
    setState(() => _saving = true);
    try {
      await ref
          .read(inspectionRepositoryProvider)
          .saveVisit(
            inspectionId: widget.inspectionId,
            version: bundle.inspection.version,
            incidents: [...bundle.inspection.incidents, incident],
          );
      _reload();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Avance de unidad'),
    body: FutureBuilder<_ProgressBundle>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done)
          return const LoadingView();
        if (snapshot.hasError || !snapshot.hasData)
          return ErrorView(onRetry: _reload);
        final bundle = snapshot.data!;
        final estimate = _estimate;
        final total = !_dirty && _saved != null
            ? _saved!.progressPercent
            : estimate;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: [
                    const CircleAvatar(
                      backgroundColor: Bank73Colors.background,
                      child: Icon(
                        Icons.home_work_outlined,
                        color: Bank73Colors.strongBlue,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            bundle.unit.code.isEmpty
                                ? 'Unidad ${bundle.unit.lote}'
                                : bundle.unit.code,
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                          Text(
                            [
                              bundle.unit.manzana,
                              bundle.unit.lote,
                              bundle.unit.modelo,
                            ].where((value) => value.isNotEmpty).join(' · '),
                            style: const TextStyle(color: Bank73Colors.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Bank73Colors.navy,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                children: [
                  const Text(
                    'AVANCE TOTAL',
                    style: TextStyle(
                      color: Colors.white70,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    formatPercent(total),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 34,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (_dirty || _saved == null)
                    const Text(
                      'Estimación hasta guardar',
                      style: TextStyle(color: Colors.white54, fontSize: 12),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (bundle.saved == null && bundle.previous != null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.history_rounded,
                        color: Bank73Colors.strongBlue,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Partimos del ${formatPercent(bundle.previous!.progressPercent)} registrado en la visita anterior. Ajusta únicamente el avance observado hoy.',
                        ),
                      ),
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
                      'Actividades de construcción',
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const Padding(
                      padding: EdgeInsets.only(top: 4, bottom: 12),
                      child: Text(
                        'El avance total es la media de las actividades aplicables.',
                        style: TextStyle(color: Bank73Colors.muted),
                      ),
                    ),
                    ..._activities.map((activity) {
                      final previous = _previousProgress(bundle, activity.key);
                      return _ActivityEditor(
                        name: activity.name,
                        value: activity.progress,
                        applicable: activity.applicable,
                        previous: previous,
                        editable: !bundle.inspection.isFinalized,
                        onChanged: (value) => setState(() {
                          activity.progress = value;
                          _dirty = true;
                        }),
                        onApplicabilityChanged: (value) => setState(() {
                          activity.applicable = value;
                          _dirty = true;
                        }),
                        onRename: () => _renameActivity(activity),
                        onRemove: () => setState(() {
                          _activities.remove(activity);
                          _dirty = true;
                        }),
                      );
                    }),
                    if (!bundle.inspection.isFinalized)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton.icon(
                          onPressed: _addActivity,
                          icon: const Icon(Icons.add),
                          label: const Text('Añadir actividad'),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _observations,
              readOnly: bundle.inspection.isFinalized,
              minLines: 4,
              maxLines: 8,
              decoration: const InputDecoration(
                labelText: 'Observaciones de la unidad',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 14),
            EvidenceSection(
              inspectionId: widget.inspectionId,
              unitId: widget.unitId,
              editable: !bundle.inspection.isFinalized,
            ),
            const SizedBox(height: 14),
            ...bundle.inspection.incidents
                .where(
                  (item) =>
                      item.scopeType == 'unit' && item.scopeId == widget.unitId,
                )
                .map(
                  (item) => Card(
                    child: ExpansionTile(
                      title: Text(item.title),
                      subtitle: Text('${item.severity} · ${item.status}'),
                      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                      children: [
                        if (item.description.isNotEmpty) Text(item.description),
                        EvidenceSection(
                          inspectionId: widget.inspectionId,
                          incidentId: item.id.isEmpty ? null : item.id,
                          unitId: widget.unitId,
                          category: 'incident',
                          editable: !bundle.inspection.isFinalized,
                          embedded: true,
                          title: 'Fotografías de la incidencia',
                        ),
                      ],
                    ),
                  ),
                ),
            if (!bundle.inspection.isFinalized) ...[
              const SizedBox(height: 18),
              OutlinedButton.icon(
                onPressed: _saving ? null : () => _addIncident(bundle),
                icon: const Icon(Icons.report_problem_outlined),
                label: const Text('Añadir incidencia de esta unidad'),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _saving ? null : () => _save(bundle),
                icon: const Icon(Icons.save_outlined),
                label: Text(_saving ? 'Guardando…' : 'Guardar avance'),
              ),
            ],
            const SizedBox(height: 20),
          ],
        );
      },
    ),
  );
}

class _ActivityEditor extends StatelessWidget {
  const _ActivityEditor({
    required this.name,
    required this.value,
    required this.applicable,
    required this.previous,
    required this.editable,
    required this.onChanged,
    required this.onApplicabilityChanged,
    required this.onRename,
    required this.onRemove,
  });
  final String name;
  final double value;
  final bool applicable;
  final double? previous;
  final bool editable;
  final ValueChanged<double> onChanged;
  final ValueChanged<bool> onApplicabilityChanged;
  final VoidCallback onRename;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 18),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                name,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            if (editable) ...[
              IconButton(
                tooltip: 'Editar nombre',
                visualDensity: VisualDensity.compact,
                onPressed: onRename,
                icon: const Icon(Icons.edit_outlined, size: 20),
              ),
              IconButton(
                tooltip: 'Quitar actividad',
                visualDensity: VisualDensity.compact,
                onPressed: onRemove,
                icon: const Icon(Icons.delete_outline, size: 20),
              ),
            ],
            Text(
              applicable ? formatPercent(value) : 'N/A',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: Bank73Colors.strongBlue,
              ),
            ),
          ],
        ),
        if (previous != null)
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Cuenta anterior ${formatPercent(previous!)} · Periodo ${formatPercent(value - previous!)}',
              style: const TextStyle(color: Bank73Colors.muted, fontSize: 12),
            ),
          ),
        if (applicable)
          Slider(
            value: value.clamp(0, 100),
            min: 0,
            max: 100,
            divisions: 100,
            label: formatPercent(value),
            onChanged: editable ? onChanged : null,
          ),
        if (editable)
          Row(
            children: [
              Checkbox(
                value: !applicable,
                onChanged: (value) => onApplicabilityChanged(value != true),
              ),
              const Text('No aplica en esta unidad'),
            ],
          ),
      ],
    ),
  );
}
