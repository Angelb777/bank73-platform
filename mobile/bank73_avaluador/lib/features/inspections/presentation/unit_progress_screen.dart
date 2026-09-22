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
  const _ProgressBundle(this.inspection, this.unit, this.saved, this.previous);
  final Inspection inspection;
  final MobileUnit unit;
  final InspectionUnit? saved;
  final InspectionUnit? previous;
}

class _UnitProgressScreenState extends ConsumerState<UnitProgressScreen> {
  late Future<_ProgressBundle> _future;
  final _observations = TextEditingController();
  final Map<String, double> _sections = {};
  double _legacyProgress = 0;
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
        results[1] as MobileUnit,
        results[2] as InspectionUnit?,
        results[3] as InspectionUnit?,
      );
      if (mounted) {
        _saved = bundle.saved;
        _dirty = false;
        _observations.text = bundle.saved?.observations ?? '';
        final startingPoint = bundle.saved ?? bundle.previous;
        _legacyProgress = startingPoint?.progressPercent ?? 0;
        _sections.clear();
        for (final section
            in bundle.inspection.methodology?.sections ??
                const <MethodologySection>[]) {
          _sections[section.key] =
              startingPoint?.progressSections
                  ?.where((item) => item.key == section.key)
                  .firstOrNull
                  ?.progressPercent ??
              0;
        }
      }
      return bundle;
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  void _reload() => setState(() => _future = _loadAndApply());

  double _estimate(InspectionMethodology methodology) {
    final weighted =
        methodology.sections.fold<double>(
          0,
          (sum, section) =>
              sum + section.weight * (_sections[section.key] ?? 0),
        ) /
        100;
    return weighted.clamp(0, 100);
  }

  Future<void> _save(_ProgressBundle bundle) async {
    setState(() => _saving = true);
    try {
      final repository = ref.read(inspectionRepositoryProvider);
      final saved = bundle.inspection.methodology == null
          ? await repository.saveLegacyProgress(
              inspectionId: widget.inspectionId,
              unitId: widget.unitId,
              version: _saved?.version ?? 0,
              progressPercent: _legacyProgress,
              observations: _observations.text.trim(),
            )
          : await repository.saveStructuredProgress(
              inspectionId: widget.inspectionId,
              unitId: widget.unitId,
              version: _saved?.version ?? 0,
              sectionProgress: Map.unmodifiable(_sections),
              observations: _observations.text.trim(),
            );
      setState(() {
        _saved = saved;
        _dirty = false;
        _legacyProgress = saved.progressPercent;
        for (final section
            in saved.progressSections ?? const <InspectionProgressSection>[]) {
          _sections[section.key] = section.progressPercent;
        }
      });
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Avance guardado en el borrador.')),
        );
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
      await ref.read(inspectionRepositoryProvider).saveVisit(
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
        final methodology = bundle.inspection.methodology;
        final estimate = methodology == null
            ? _legacyProgress
            : _estimate(methodology);
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
                      methodology == null ? 'Avance general' : methodology.name,
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    if (methodology != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4, bottom: 12),
                        child: Text(
                          'Metodología versión ${methodology.version}',
                          style: const TextStyle(color: Bank73Colors.muted),
                        ),
                      ),
                    if (methodology == null)
                      _ProgressSlider(
                        name: 'Avance observado',
                        value: _legacyProgress,
                        onChanged: bundle.inspection.isFinalized
                            ? null
                            : (value) => setState(() {
                                _legacyProgress = value;
                                _dirty = true;
                              }),
                      )
                    else
                      ...methodology.sections.map(
                        (section) => _ProgressSlider(
                          name: section.name,
                          secondary: 'Peso ${formatPercent(section.weight)}',
                          value: _sections[section.key] ?? 0,
                          onChanged: bundle.inspection.isFinalized
                              ? null
                              : (value) => setState(() {
                                  _sections[section.key] = value;
                                  _dirty = true;
                                }),
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

class _ProgressSlider extends StatelessWidget {
  const _ProgressSlider({
    required this.name,
    required this.value,
    required this.onChanged,
    this.secondary,
  });
  final String name;
  final String? secondary;
  final double value;
  final ValueChanged<double>? onChanged;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  if (secondary != null)
                    Text(
                      secondary!,
                      style: const TextStyle(
                        color: Bank73Colors.muted,
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),
            Text(
              formatPercent(value),
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: Bank73Colors.strongBlue,
              ),
            ),
          ],
        ),
        Slider(
          value: value.clamp(0, 100),
          min: 0,
          max: 100,
          divisions: 100,
          label: formatPercent(value),
          onChanged: onChanged,
        ),
      ],
    ),
  );
}
