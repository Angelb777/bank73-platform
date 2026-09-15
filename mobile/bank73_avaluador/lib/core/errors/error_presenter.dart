import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/application/auth_controller.dart';
import 'api_exception.dart';

Future<void> presentApiError(
  BuildContext context,
  WidgetRef ref,
  Object error,
) async {
  if (error is ApiException && error.isUnauthorized) {
    await ref.read(authControllerProvider.notifier).logout();
    return;
  }
  if (error is ApiException && error.isForbiddenOrMissing) {
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Recurso no disponible'),
        content: Text(error.message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Entendido'),
          ),
        ],
      ),
    );
    if (context.mounted) context.go('/portfolio');
    return;
  }
  if (context.mounted) {
    final message = error is ApiException
        ? error.message
        : 'No se pudo completar la operacion.';
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}
