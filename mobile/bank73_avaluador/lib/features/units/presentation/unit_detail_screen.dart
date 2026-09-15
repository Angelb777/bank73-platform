import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../portfolio/data/project_repository.dart';

class UnitDetailScreen extends ConsumerStatefulWidget {
  const UnitDetailScreen({
    super.key,
    required this.projectId,
    required this.unitId,
  });
  final String projectId;
  final String unitId;
  @override
  ConsumerState<UnitDetailScreen> createState() => _UnitDetailScreenState();
}

class _UnitDetailScreenState extends ConsumerState<UnitDetailScreen> {
  late Future<MobileUnit> _future;
  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<MobileUnit> _load() async {
    try {
      return await ref
          .read(projectRepositoryProvider)
          .unit(widget.projectId, widget.unitId);
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Detalle de unidad'),
    body: FutureBuilder<MobileUnit>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done)
          return const LoadingView();
        if (snapshot.hasError || !snapshot.hasData)
          return ErrorView(onRetry: () => setState(() => _future = _load()));
        final unit = snapshot.data!;
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(
                          Icons.home_work_outlined,
                          color: Bank73Colors.strongBlue,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            unit.code.isEmpty ? 'Unidad' : unit.code,
                            style: Theme.of(context).textTheme.headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    _Info('Manzana', unit.manzana),
                    _Info('Lote', unit.lote),
                    _Info('Modelo', unit.modelo),
                    _Info('Ubicación', unit.ubicacion),
                    _Info('Estado', unit.status),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Superficies',
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 14),
                    _Info(
                      'Superficie',
                      '${unit.surfaces.m2.toStringAsFixed(1)} m²',
                    ),
                    _Info(
                      'Área abierta',
                      '${unit.surfaces.openM2.toStringAsFixed(1)} m²',
                    ),
                    _Info(
                      'Área cerrada',
                      '${unit.surfaces.closedM2.toStringAsFixed(1)} m²',
                    ),
                    _Info(
                      'Construcción total',
                      '${unit.surfaces.totalConstructionM2.toStringAsFixed(1)} m²',
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    ),
  );
}

class _Info extends StatelessWidget {
  const _Info(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => value.isEmpty
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 125,
                child: Text(
                  label,
                  style: const TextStyle(color: Bank73Colors.muted),
                ),
              ),
              Expanded(
                child: Text(
                  value,
                  style: const TextStyle(fontWeight: FontWeight.w500),
                ),
              ),
            ],
          ),
        );
}
