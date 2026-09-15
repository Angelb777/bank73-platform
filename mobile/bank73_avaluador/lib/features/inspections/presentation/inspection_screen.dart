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
  );
  final Inspection inspection;
  final MobileProject project;
  final List<MobileUnit> units;
  final List<InspectionUnit> saved;
}

class _InspectionScreenState extends ConsumerState<InspectionScreen> {
  late Future<_InspectionBundle> _future;
  final _observations = TextEditingController();
  DateTime? _date;
  Inspection? _inspection;
  bool _saving = false;

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
      );
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  void _reload() => setState(() => _future = _load());

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

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Inspección'),
    body: FutureBuilder<_InspectionBundle>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done)
          return const LoadingView();
        if (snapshot.hasError || !snapshot.hasData)
          return ErrorView(onRetry: _reload);
        final bundle = snapshot.data!;
        final progressByUnit = {
          for (final item in bundle.saved) item.unitId: item.progressPercent,
        };
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
                        const StatusPill('Borrador'),
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
                      onTap: _pickDate,
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
                      minLines: 3,
                      maxLines: 6,
                      decoration: const InputDecoration(
                        labelText: 'Observaciones generales',
                        alignLabelWithHint: true,
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: _saving ? null : _saveGeneral,
                      icon: const Icon(Icons.save_outlined),
                      label: Text(_saving ? 'Guardando…' : 'Guardar borrador'),
                    ),
                  ],
                ),
              ),
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
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Unidades',
                    style: Theme.of(context).textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                Text(
                  '${bundle.saved.length}/${bundle.units.length}',
                  style: const TextStyle(color: Bank73Colors.muted),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (bundle.units.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('Este proyecto no tiene unidades disponibles.'),
                ),
              )
            else
              ...bundle.units.map(
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
        );
      },
    ),
  );
}
