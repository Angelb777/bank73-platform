import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../data/inspection_repository.dart';

class InspectionsScreen extends ConsumerStatefulWidget {
  const InspectionsScreen({super.key, required this.projectId});
  final String projectId;
  @override
  ConsumerState<InspectionsScreen> createState() => _InspectionsScreenState();
}

class _InspectionsScreenState extends ConsumerState<InspectionsScreen> {
  late Future<List<Inspection>> _future;
  bool _creating = false;
  final _deleting = <String>{};

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Inspection>> _load() async {
    try {
      return await ref
          .read(inspectionRepositoryProvider)
          .inspections(widget.projectId);
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  Future<void> _refresh() async => setState(() => _future = _load());

  Future<void> _create() async {
    setState(() => _creating = true);
    try {
      final inspection = await ref
          .read(inspectionRepositoryProvider)
          .create(widget.projectId);
      if (mounted)
        await context.push(
          '/projects/${widget.projectId}/inspections/${inspection.id}',
        );
      if (mounted) _refresh();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _deleteDraft(Inspection item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Eliminar borrador'),
        content: const Text(
          'Se eliminará esta visita de la lista, incluidos sus avances y fotografías. Esta acción no se puede deshacer desde la app.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deleting.add(item.id));
    try {
      await ref.read(inspectionRepositoryProvider).deleteDraft(item);
      if (mounted) await _refresh();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _deleting.remove(item.id));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Inspecciones'),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: _creating ? null : _create,
      icon: _creating
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.add),
      label: const Text('Nueva inspección'),
    ),
    body: FutureBuilder<List<Inspection>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done)
          return const LoadingView();
        if (snapshot.hasError) return ErrorView(onRetry: _refresh);
        final inspections = snapshot.data ?? const [];
        if (inspections.isEmpty)
          return const EmptyView(
            icon: Icons.fact_check_outlined,
            title: 'Sin inspecciones',
            message: 'Crea la primera inspección para comenzar la visita.',
          );
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
            itemCount: inspections.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final item = inspections[index];
              return Card(
                child: ListTile(
                  onTap: () => context.push(
                    '/projects/${widget.projectId}/inspections/${item.id}',
                  ),
                  contentPadding: const EdgeInsets.all(16),
                  leading: CircleAvatar(
                    backgroundColor: item.isFinalized
                        ? Bank73Colors.success.withValues(alpha: .14)
                        : Bank73Colors.background,
                    child: Icon(
                      item.isFinalized
                          ? Icons.verified_outlined
                          : Icons.edit_note_rounded,
                      color: item.isFinalized
                          ? Bank73Colors.success
                          : Bank73Colors.strongBlue,
                    ),
                  ),
                  title: Text(
                    item.inspectionDate == null
                        ? 'Inspección'
                        : DateFormat('dd/MM/yyyy')
                              .format(item.inspectionDate!.toLocal()),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      item.isFinalized
                          ? 'Informe ${item.reportNumber}'
                          : item.updatedAt == null
                          ? 'Borrador'
                          : 'Modificada ${DateFormat('dd/MM/yyyy HH:mm').format(item.updatedAt!.toLocal())}',
                    ),
                  ),
                  trailing: item.isFinalized
                      ? const StatusPill('Finalizado', success: true)
                      : IconButton(
                          tooltip: 'Eliminar borrador',
                          onPressed: _deleting.contains(item.id)
                              ? null
                              : () => _deleteDraft(item),
                          icon: _deleting.contains(item.id)
                              ? const SizedBox.square(
                                  dimension: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.delete_outline),
                        ),
                ),
              );
            },
          ),
        );
      },
    ),
  );
}
