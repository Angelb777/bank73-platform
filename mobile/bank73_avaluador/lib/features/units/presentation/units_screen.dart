import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../portfolio/data/project_repository.dart';

class UnitsScreen extends ConsumerStatefulWidget {
  const UnitsScreen({super.key, required this.projectId});
  final String projectId;
  @override
  ConsumerState<UnitsScreen> createState() => _UnitsScreenState();
}

class _UnitsScreenState extends ConsumerState<UnitsScreen> {
  late Future<List<MobileUnit>> _future;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<MobileUnit>> _load() async {
    try {
      return await ref.read(projectRepositoryProvider).units(widget.projectId);
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  Future<void> _refresh() async => setState(() => _future = _load());

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Unidades'),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: TextField(
            onChanged: (value) => setState(() => _query = value),
            decoration: const InputDecoration(
              hintText: 'Buscar código, manzana, lote o modelo',
              prefixIcon: Icon(Icons.search),
            ),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<MobileUnit>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done)
                return const LoadingView();
              if (snapshot.hasError) return ErrorView(onRetry: _refresh);
              final units = (snapshot.data ?? const [])
                  .where((unit) => unit.matches(_query))
                  .toList();
              if (units.isEmpty)
                return EmptyView(
                  icon: Icons.other_houses_outlined,
                  title: _query.isEmpty ? 'Sin unidades' : 'Sin resultados',
                  message: _query.isEmpty
                      ? 'El proyecto todavía no tiene unidades disponibles.'
                      : 'Prueba con otro término de búsqueda.',
                );
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  itemCount: units.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) => UnitTile(
                    unit: units[index],
                    onTap: () => context.push(
                      '/projects/${widget.projectId}/units/${units[index].id}',
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    ),
  );
}

class UnitTile extends StatelessWidget {
  const UnitTile({
    super.key,
    required this.unit,
    required this.onTap,
    this.progress,
  });
  final MobileUnit unit;
  final VoidCallback onTap;
  final double? progress;

  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      leading: CircleAvatar(
        backgroundColor: progress == null
            ? Bank73Colors.background
            : Bank73Colors.success.withValues(alpha: .14),
        child: Icon(
          progress == null ? Icons.home_outlined : Icons.check_circle_outline,
          color: progress == null ? Bank73Colors.muted : Bank73Colors.success,
        ),
      ),
      title: Text(
        unit.code.isEmpty ? 'Unidad ${unit.lote}' : unit.code,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        [
          if (unit.manzana.isNotEmpty) 'Mz. ${unit.manzana}',
          if (unit.lote.isNotEmpty) 'Lote ${unit.lote}',
          if (unit.modelo.isNotEmpty) unit.modelo,
        ].join(' · '),
      ),
      trailing: progress == null
          ? const Icon(Icons.chevron_right)
          : Text(
              formatPercent(progress!),
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: Bank73Colors.success,
              ),
            ),
    ),
  );
}
