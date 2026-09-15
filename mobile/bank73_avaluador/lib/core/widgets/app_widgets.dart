import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/app_theme.dart';
import '../../features/auth/application/auth_controller.dart';
import '../api/api_config.dart';

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
    titleSpacing: Navigator.canPop(context) ? 0 : 16,
    title: Row(
      children: [
        Image.asset(
          'assets/branding/bank73-symbol.png',
          width: 30,
          height: 30,
          fit: BoxFit.contain,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 18),
          ),
        ),
      ],
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

/// Displays the data URI used by existing projects or an HTTP cover path.
class ProjectCover extends StatelessWidget {
  const ProjectCover({
    super.key,
    required this.source,
    this.fit = BoxFit.cover,
    this.fallbackIcon = Icons.location_city_rounded,
  });

  final String? source;
  final BoxFit fit;
  final IconData fallbackIcon;

  Uint8List? _decodeDataUri(String value) {
    final separator = value.indexOf(',');
    if (!value.startsWith('data:image/') || separator < 0) return null;
    if (!value.substring(0, separator).endsWith(';base64')) return null;
    try {
      return base64Decode(value.substring(separator + 1));
    } on FormatException {
      return null;
    }
  }

  Widget _fallback() => ColoredBox(
    color: Bank73Colors.navy,
    child: Center(child: Icon(fallbackIcon, color: Colors.white54, size: 58)),
  );

  @override
  Widget build(BuildContext context) {
    final value = source?.trim() ?? '';
    if (value.isEmpty) return _fallback();
    final bytes = _decodeDataUri(value);
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: fit,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => _fallback(),
      );
    }
    final imageUrl = ApiConfig.assetUrl(value);
    if (imageUrl == null) return _fallback();
    return Image.network(
      imageUrl,
      fit: fit,
      gaplessPlayback: true,
      errorBuilder: (_, __, ___) => _fallback(),
    );
  }
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
