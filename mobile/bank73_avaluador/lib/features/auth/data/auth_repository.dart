import '../../../core/api/api_client.dart';
import '../../../core/api/api_config.dart';
import '../../../core/models/models.dart';
import '../../../core/storage/secure_session_store.dart';

class LegalDocumentItem {
  const LegalDocumentItem({
    required this.type,
    required this.title,
    required this.content,
  });
  final String type;
  final String title;
  final String content;

  factory LegalDocumentItem.fromJson(Map<String, dynamic> json) =>
      LegalDocumentItem(
        type: (json['type'] ?? '').toString(),
        title: (json['title'] ?? '').toString(),
        content: (json['content'] ?? '').toString(),
      );
}

class LegalStatus {
  const LegalStatus({
    required this.version,
    required this.status,
    required this.required,
    required this.acceptanceEnabled,
    required this.documents,
  });
  final String version;
  final String status;
  final bool required;
  final bool acceptanceEnabled;
  final List<LegalDocumentItem> documents;

  factory LegalStatus.fromJson(Map<String, dynamic> json) => LegalStatus(
    version: (json['version'] ?? '').toString(),
    status: (json['status'] ?? 'draft').toString(),
    required: json['required'] == true,
    acceptanceEnabled: json['acceptanceEnabled'] == true,
    documents: (json['documents'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(LegalDocumentItem.fromJson)
        .toList(growable: false),
  );
}

class AuthRepository {
  AuthRepository(this._api, this._store);
  final ApiTransport _api;
  final SessionStore _store;

  Future<AppUser> login({
    required String email,
    required String password,
  }) async {
    final response = await _api.post(
      '/api/auth/mobile-login',
      authenticated: false,
      body: {'email': email.trim().toLowerCase(), 'password': password},
    );
    final token = (response['token'] ?? '').toString();
    if (token.isEmpty)
      throw const FormatException('El login no devolvio un token.');
    await _store.save(SessionCredentials(token: token));
    try {
      return await me();
    } catch (_) {
      await _store.clear();
      rethrow;
    }
  }

  Future<String> registerAvaluator({
    required String name,
    required String email,
    required String password,
  }) async {
    final legal = await publicLegalDocuments();
    if (!legal.acceptanceEnabled || legal.version.isEmpty) {
      throw const FormatException(
        'No se pudo cargar la versión legal vigente.',
      );
    }
    final response = await _api.post(
      '/api/auth/register',
      authenticated: false,
      body: {
        'tenantKey': ApiConfig.registrationTenantKey,
        'name': name.trim(),
        'email': email.trim().toLowerCase(),
        'password': password,
        'roleRequested': 'avaluador',
        'legalVersion': legal.version,
        'termsAccepted': true,
        'ndaAccepted': true,
        'privacyAcknowledged': true,
        'legalChannel': 'mobile',
      },
    );
    return (response['message'] ??
            'Registro recibido. Tu cuenta está pendiente de aprobación por Bank73.')
        .toString();
  }

  Future<AppUser> me() async =>
      AppUser.fromJson(await _api.get('/api/auth/me'));
  Future<LegalStatus> legalStatus({bool includeContent = false}) async {
    final status = await _api.get('/api/legal/status');
    if (!includeContent) return LegalStatus.fromJson(status);
    final documents = await _api.get(
      '/api/legal/documents?content=1',
      authenticated: false,
    );
    return LegalStatus.fromJson({
      ...status,
      'documents': documents['documents'],
    });
  }

  Future<LegalStatus> publicLegalDocuments() async => LegalStatus.fromJson(
    await _api.get('/api/legal/documents?content=1', authenticated: false),
  );

  Future<void> acceptLegal(String version) async {
    await _api.post(
      '/api/legal/accept',
      body: {
        'version': version,
        'termsAccepted': true,
        'ndaAccepted': true,
        'privacyAcknowledged': true,
        'channel': 'mobile',
      },
    );
  }

  Future<bool> hasSession() async => await _store.read() != null;
  Future<void> logout() => _store.clear();
}
