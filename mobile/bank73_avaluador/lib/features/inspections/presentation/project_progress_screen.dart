import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../data/inspection_repository.dart';
import 'evidence_section.dart';

class ProjectProgressScreen extends ConsumerStatefulWidget {
  const ProjectProgressScreen({super.key, required this.inspectionId});

  final String inspectionId;

  @override
  ConsumerState<ProjectProgressScreen> createState() =>
      _ProjectProgressScreenState();
}

class _ProjectProgressScreenState extends ConsumerState<ProjectProgressScreen> {
  late Future<Inspection> _future;
  final Map<String, double> _progress = {};
  final Map<String, TextEditingController> _observations = {};
  Inspection? _inspection;
  double _projectProgress = 0;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    for (final controller in _observations.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<Inspection> _load() async {
    try {
      final inspection = await ref
          .read(inspectionRepositoryProvider)
          .inspection(widget.inspectionId);
      if (mounted) {
        _inspection = inspection;
        _projectProgress = inspection.projectProgressPercent;
        for (final area in inspection.commonAreas) {
          _progress[area.key] = area.progressPercent;
          final controller = _observations.putIfAbsent(
            area.key,
            TextEditingController.new,
          );
          controller.text = area.observations;
        }
      }
      return inspection;
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  void _reload() => setState(() => _future = _load());

  double _weighted(List<InspectionCommonArea> areas) => areas.isEmpty
      ? 0
      : (areas.fold<double>(
                  0,
                  (sum, area) => sum + area.weight * (_progress[area.key] ?? 0),
                ) /
                100)
            .clamp(0, 100);

  Future<void> _save(Inspection inspection) async {
    setState(() => _saving = true);
    try {
      final areas = inspection.commonAreas
          .map(
            (area) => InspectionCommonArea(
              key: area.key,
              name: area.name,
              weight: area.weight,
              progressPercent: _progress[area.key] ?? 0,
              observations: _observations[area.key]?.text.trim() ?? '',
            ),
          )
          .toList();
      final updated = await ref
          .read(inspectionRepositoryProvider)
          .saveProjectProgress(
            inspectionId: widget.inspectionId,
            version: _inspection?.version ?? inspection.version,
            projectProgressPercent: _projectProgress,
            commonAreas: areas,
          );
      _inspection = updated;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Avance general guardado.')),
        );
      }
    } on ApiException catch (error) {
      if (error.isVersionConflict) _reload();
      if (mounted) await presentApiError(context, ref, error);
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Avance general'),
    body: FutureBuilder<Inspection>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const LoadingView();
        }
        if (snapshot.hasError || !snapshot.hasData) {
          return ErrorView(onRetry: _reload);
        }
        final inspection = snapshot.data!;
        final editable = !inspection.isFinalized;
        final weighted = _weighted(inspection.commonAreas);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Bank73Colors.navy,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                children: [
                  const Text(
                    'AVANCE GENERAL DE LA OBRA',
                    style: TextStyle(
                      color: Colors.white70,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    formatPercent(_projectProgress),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 34,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Slider(
                    value: _projectProgress.clamp(0, 100),
                    min: 0,
                    max: 100,
                    divisions: 100,
                    onChanged: editable
                        ? (value) => setState(() => _projectProgress = value)
                        : null,
                  ),
                  Text(
                    'Referencia ponderada de zonas: ${formatPercent(weighted)}',
                    style: const TextStyle(color: Colors.white70),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Este porcentaje representa la obra completa y es independiente del avance de cada unidad comercial.',
              style: TextStyle(color: Bank73Colors.muted),
            ),
            const SizedBox(height: 18),
            ...inspection.commonAreas.map(
              (area) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Card(
                  child: ExpansionTile(
                    initiallyExpanded: true,
                    title: Text(
                      area.name,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      '${area.previousProgressKnown ? '${formatPercent(area.previousProgressPercent ?? 0)} anterior · ' : 'Sin referencia anterior · '}${formatPercent(_progress[area.key] ?? 0)} actual · peso ${formatPercent(area.weight)}',
                    ),
                    childrenPadding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
                    children: [
                      Slider(
                        value: (_progress[area.key] ?? 0).clamp(0, 100),
                        min: 0,
                        max: 100,
                        divisions: 100,
                        onChanged: editable
                            ? (value) =>
                                  setState(() => _progress[area.key] = value)
                            : null,
                      ),
                      TextField(
                        controller: _observations[area.key],
                        readOnly: !editable,
                        minLines: 2,
                        maxLines: 5,
                        decoration: const InputDecoration(
                          labelText: 'Observaciones de esta zona',
                          alignLabelWithHint: true,
                        ),
                      ),
                      const SizedBox(height: 12),
                      EvidenceSection(
                        key: ValueKey(area.key),
                        inspectionId: widget.inspectionId,
                        commonAreaKey: area.key,
                        editable: editable,
                        embedded: true,
                        title: 'Fotografías',
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (editable)
              FilledButton.icon(
                onPressed: _saving ? null : () => _save(inspection),
                icon: const Icon(Icons.save_outlined),
                label: Text(_saving ? 'Guardando…' : 'Guardar avance general'),
              ),
            const SizedBox(height: 24),
          ],
        );
      },
    ),
  );
}
