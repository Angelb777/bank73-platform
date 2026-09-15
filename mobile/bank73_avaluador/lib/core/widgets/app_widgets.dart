import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/app_theme.dart';
import '../../features/auth/application/auth_controller.dart';

class Bank73AppBar extends ConsumerWidget implements PreferredSizeWidget {
  const Bank73AppBar({
    super.key,
    required this.title,
    this.actions = const [],
    this.showLogout = false,
  });
  final String title;
  final List<Widget> actions;
  final bool showLogout;

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context, WidgetRef ref) => AppBar(
    title: Text(
      title,
      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 18),
    ),
    actions: [
      ...actions,
      if (showLogout)
        IconButton(
          tooltip: 'Cerrar sesion',
          onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          icon: const Icon(Icons.logout_rounded),
        ),
    ],
  );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) =>
      const Center(child: CircularProgressIndicator());
}

class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 52, color: Bank73Colors.muted),
          const SizedBox(height: 16),
          Text(
            title,
            style: Theme.of(context).textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: const TextStyle(color: Bank73Colors.muted),
            textAlign: TextAlign.center,
          ),
          if (action != null) ...[const SizedBox(height: 20), action!],
        ],
      ),
    ),
  );
}

class ErrorView extends StatelessWidget {
  const ErrorView({
    super.key,
    required this.onRetry,
    this.message = 'No pudimos cargar la informacion.',
  });
  final VoidCallback onRetry;
  final String message;

  @override
  Widget build(BuildContext context) => EmptyView(
    icon: Icons.cloud_off_rounded,
    title: 'Algo ha fallado',
    message: message,
    action: FilledButton.tonalIcon(
      onPressed: onRetry,
      icon: const Icon(Icons.refresh),
      label: const Text('Reintentar'),
    ),
  );
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.label, {super.key, this.success = false});
  final String label;
  final bool success;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: (success ? Bank73Colors.success : Bank73Colors.blue).withValues(
        alpha: .12,
      ),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      child: Text(
        label,
        style: TextStyle(
          color: success ? const Color(0xFF047857) : const Color(0xFF1D4ED8),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}

String formatPercent(double value) => value == value.roundToDouble()
    ? '${value.toInt()} %'
    : '${value.toStringAsFixed(1)} %';
