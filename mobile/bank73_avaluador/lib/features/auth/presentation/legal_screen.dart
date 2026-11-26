import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/app_theme.dart';
import '../application/auth_controller.dart';
import '../data/auth_repository.dart';

class LegalScreen extends ConsumerStatefulWidget {
  const LegalScreen({super.key});

  @override
  ConsumerState<LegalScreen> createState() => _LegalScreenState();
}

class _LegalScreenState extends ConsumerState<LegalScreen> {
  late Future<LegalStatus> _future;
  bool _terms = false;
  bool _privacy = false;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final authenticated = ref.read(authControllerProvider).user != null;
    final repository = ref.read(authRepositoryProvider);
    _future = authenticated
        ? repository.legalStatus(includeContent: true)
        : repository.publicLegalDocuments();
  }

  Future<void> _accept(LegalStatus status) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).acceptLegal();
      if (mounted) context.go('/portfolio');
    } catch (error) {
      if (mounted)
        setState(
          () => _error = error.toString().replaceFirst('ApiException: ', ''),
        );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final forced = auth.status == AuthStatus.legalAcceptanceRequired;
    return PopScope(
      canPop: !forced,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: !forced,
          title: const Text('Información legal'),
          actions: [
            if (forced)
              IconButton(
                tooltip: 'Cerrar sesión',
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).logout(),
                icon: const Icon(Icons.logout_rounded),
              ),
          ],
        ),
        body: FutureBuilder<LegalStatus>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError || snapshot.data == null) {
              return Center(
                child: Text(
                  snapshot.error?.toString() ??
                      'No se pudieron cargar los documentos.',
                ),
              );
            }
            final status = snapshot.data!;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                ...status.documents.map(
                  (document) => Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ExpansionTile(
                      title: Text(
                        document.title,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(18, 0, 18, 20),
                          child: SelectableText(document.content),
                        ),
                      ],
                    ),
                  ),
                ),
                if (forced && status.acceptanceEnabled) ...[
                  CheckboxListTile(
                    value: _terms,
                    onChanged: _saving
                        ? null
                        : (value) => setState(() => _terms = value == true),
                    title: const Text(
                      'He leído y acepto los Términos y condiciones, incluido el NDA.',
                    ),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                  CheckboxListTile(
                    value: _privacy,
                    onChanged: _saving
                        ? null
                        : (value) => setState(() => _privacy = value == true),
                    title: const Text(
                      'Confirmo que he leído la Política de privacidad.',
                    ),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                  if (_error != null)
                    Text(
                      _error!,
                      style: const TextStyle(color: Bank73Colors.danger),
                    ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: !_saving && _terms && _privacy
                        ? () => _accept(status)
                        : null,
                    child: Text(
                      _saving ? 'Registrando…' : 'Aceptar y continuar',
                    ),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}
