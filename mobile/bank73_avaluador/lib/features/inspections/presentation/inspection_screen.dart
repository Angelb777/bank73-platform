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
          final key = (unit.folderId != null && foldersById.containsKey(unit.folderId))
              ? unit.folderId!
              : unassignedKey;
          unitsByFolder.putIfAbsent(key, () => []).add(unit);
        }
        final orderedFolderKeys = [
          ...bundle.folders.map((folder) => folder.id).where(unitsByFolder.containsKey),
          if (unitsByFolder.containsKey(unassignedKey)) unassignedKey,
        ];
        final hasNamedGroups = orderedFolderKeys.any((key) => key != unassignedKey);
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
            const SizedBox(height: 12),
            _InspectionStep(
              icon: bundle.inspection.isFinalized
                  ? Icons.verified_outlined
                  : Icons.draw_outlined,
              title: bundle.inspection.isFinalized
                  ? 'Ver informe firmado'
                  : 'Revisar, firmar y finalizar',
              subtitle: bundle.inspection.isFinalized
                  ? bundle.inspection.reportNumber
                  : 'Comprueba los datos y genera el informe definitivo.',
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
      },
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
