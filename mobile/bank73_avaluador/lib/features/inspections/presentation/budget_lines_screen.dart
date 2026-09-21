import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../data/inspection_repository.dart';

/// Avance físico por partida de obra, agrupado por Torre/Etapa (reutiliza
/// las carpetas comerciales existentes). El importe económico del período
/// no se captura aquí: lo carga banca/finanzas cuando exista.
class BudgetLinesScreen extends ConsumerStatefulWidget {
  const BudgetLinesScreen({super.key, required this.inspectionId});

  final String inspectionId;

  @override
  ConsumerState<BudgetLinesScreen> createState() => _BudgetLinesScreenState();
}

class _Bundle {
  const _Bundle(this.inspection, this.folders);
  final Inspection inspection;
  final List<BudgetLineFolder> folders;
}

class _BudgetLinesScreenState extends ConsumerState<BudgetLinesScreen> {
  late Future<_Bundle> _future;
  final Map<String, double> _progress = {};
  final Map<String, TextEditingController> _observations = {};
  final Set<String> _saving = {};
  int _version = 0;
  bool _finalized = false;

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

  Future<_Bundle> _load() async {
    try {
      final repository = ref.read(inspectionRepositoryProvider);
      final results = await Future.wait([
        repository.inspection(widget.inspectionId),
        repository.budgetLines(widget.inspectionId),
      ]);
      final inspection = results[0] as Inspection;
      final folders = results[1] as List<BudgetLineFolder>;
      if (mounted) {
        _version = inspection.version;
        _finalized = inspection.isFinalized;
        for (final folder in folders) {
          for (final line in folder.lines) {
            _progress[line.id] =
                line.current?.physicalProgressPercent ??
                line.previous?.physicalProgressPercent ??
                0;
            final controller = _observations.putIfAbsent(
              line.id,
              TextEditingController.new,
            );
            controller.text = line.current?.observations ?? '';
          }
        }
      }
      return _Bundle(inspection, folders);
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  void _reload() => setState(() => _future = _load());

  Future<void> _showConflict() => showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('El avance ha cambiado'),
      content: const Text(
        'Existe una versión más reciente de esta inspección. La recargaremos antes de continuar.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Recargar'),
        ),
      ],
    ),
  );

  Future<void> _save(BudgetLineItem line) async {
    setState(() => _saving.add(line.id));
    try {
      final updated = await ref
          .read(inspectionRepositoryProvider)
          .saveBudgetLineProgress(
            inspectionId: widget.inspectionId,
            budgetLineId: line.id,
            version: _version,
            physicalProgressPercent: _progress[line.id] ?? 0,
            observations: _observations[line.id]?.text.trim() ?? '',
          );
      if (mounted) {
        setState(() => _version = updated.version);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Avance de "${line.name}" guardado.')),
        );
      }
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
      if (mounted) setState(() => _saving.remove(line.id));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Torres, etapas y partidas'),
    body: FutureBuilder<_Bundle>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const LoadingView();
        }
        if (snapshot.hasError || !snapshot.hasData) {
          return ErrorView(onRetry: _reload);
        }
        final bundle = snapshot.data!;
        if (bundle.folders.isEmpty) {
          return const EmptyView(
            icon: Icons.apartment_outlined,
            title: 'Sin partidas registradas',
            message:
                'Este proyecto todavía no tiene torres/etapas con partidas de obra configuradas.',
          );
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'El avance físico que registres aquí se compara automáticamente con la última inspección finalizada de este proyecto.',
              style: TextStyle(color: Bank73Colors.muted),
            ),
            const SizedBox(height: 14),
            ...bundle.folders.map(
              (folder) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Card(
                  child: ExpansionTile(
                    key: PageStorageKey('budget-folder-${folder.id}'),
                    initiallyExpanded: true,
                    maintainState: true,
                    title: Text(
                      folder.name,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      '${folder.lines.length} ${folder.lines.length == 1 ? 'partida' : 'partidas'}',
                    ),
                    childrenPadding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
                    children: folder.lines
                        .map(
                          (line) => _BudgetLineTile(
                            line: line,
                            value: _progress[line.id] ?? 0,
                            observations: _observations[line.id],
                            editable: !_finalized,
                            saving: _saving.contains(line.id),
                            onChanged: (value) =>
                                setState(() => _progress[line.id] = value),
                            onSave: () => _save(line),
                          ),
                        )
                        .toList(),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
        );
      },
    ),
  );
}

class _BudgetLineTile extends StatelessWidget {
  const _BudgetLineTile({
    required this.line,
    required this.value,
    required this.observations,
    required this.editable,
    required this.saving,
    required this.onChanged,
    required this.onSave,
  });

  final BudgetLineItem line;
  final double value;
  final TextEditingController? observations;
  final bool editable;
  final bool saving;
  final ValueChanged<double> onChanged;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                line.label,
                style: const TextStyle(fontWeight: FontWeight.w600),
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
        if (line.current == null && line.previous != null)
          Padding(
            padding: const EdgeInsets.only(top: 2, bottom: 4),
            child: Text(
              'Partimos del ${formatPercent(line.previous!.physicalProgressPercent)} registrado en la visita anterior.',
              style: const TextStyle(color: Bank73Colors.muted, fontSize: 12),
            ),
          ),
        Slider(
          value: value.clamp(0, 100),
          min: 0,
          max: 100,
          divisions: 100,
          label: formatPercent(value),
          onChanged: editable ? onChanged : null,
        ),
        TextField(
          controller: observations,
          readOnly: !editable,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Observaciones de esta partida',
            alignLabelWithHint: true,
          ),
        ),
        if (editable) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: OutlinedButton.icon(
              onPressed: saving ? null : onSave,
              icon: saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined, size: 18),
              label: Text(saving ? 'Guardando…' : 'Guardar partida'),
            ),
          ),
        ],
        const Divider(height: 24),
      ],
    ),
  );
}
