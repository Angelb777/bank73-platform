import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/api/api_config.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../portfolio/data/project_repository.dart';

class ProjectScreen extends ConsumerStatefulWidget {
  const ProjectScreen({super.key, required this.projectId});
  final String projectId;
  @override
  ConsumerState<ProjectScreen> createState() => _ProjectScreenState();
}

class _ProjectScreenState extends ConsumerState<ProjectScreen> {
  late Future<MobileProject> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<MobileProject> _load() async {
    try {
      return await ref
          .read(projectRepositoryProvider)
          .project(widget.projectId);
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
      rethrow;
    }
  }

  void _retry() => setState(() => _future = _load());

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Proyecto'),
    body: FutureBuilder<MobileProject>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done)
          return const LoadingView();
        if (snapshot.hasError || !snapshot.hasData)
          return ErrorView(onRetry: _retry);
        final project = snapshot.data!;
        final imageUrl = ApiConfig.assetUrl(project.coverSource);
        return ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            SizedBox(
              height: 220,
              child: imageUrl == null
                  ? const ColoredBox(
                      color: Bank73Colors.navy,
                      child: Icon(
                        Icons.apartment_rounded,
                        size: 70,
                        color: Colors.white54,
                      ),
                    )
                  : Image.network(
                      imageUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) =>
                          const ColoredBox(color: Bank73Colors.navy),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    project.name,
                    style: Theme.of(context).textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  if (project.location.display.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.place_outlined,
                          size: 20,
                          color: Bank73Colors.muted,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            project.location.display,
                            style: const TextStyle(color: Bank73Colors.muted),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    children: [
                      if (project.projectType.isNotEmpty)
                        StatusPill(project.projectType),
                      if (project.status.isNotEmpty)
                        StatusPill(project.status, success: true),
                    ],
                  ),
                  if (project.description.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    Text(
                      'Descripción',
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    Text(project.description),
                  ],
                  const SizedBox(height: 26),
                  _ActionCard(
                    icon: Icons.home_work_outlined,
                    title: 'Unidades',
                    subtitle: 'Consulta las unidades comerciales del proyecto.',
                    onTap: () =>
                        context.push('/projects/${widget.projectId}/units'),
                  ),
                  const SizedBox(height: 12),
                  _ActionCard(
                    icon: Icons.fact_check_outlined,
                    title: 'Inspecciones',
                    subtitle: 'Crea o continúa tus borradores de inspección.',
                    onTap: () => context.push(
                      '/projects/${widget.projectId}/inspections',
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    ),
  );
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.all(16),
      leading: CircleAvatar(
        backgroundColor: Bank73Colors.blue.withValues(alpha: .14),
        child: Icon(icon, color: Bank73Colors.strongBlue),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 5),
        child: Text(subtitle),
      ),
      trailing: const Icon(Icons.chevron_right),
    ),
  );
}
