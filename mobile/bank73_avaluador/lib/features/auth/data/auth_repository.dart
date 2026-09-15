import '../../../core/api/api_client.dart';
import '../../../core/models/models.dart';
import '../../../core/storage/secure_session_store.dart';

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

  Future<AppUser> me() async =>
      AppUser.fromJson(await _api.get('/api/auth/me'));
  Future<bool> hasSession() async => await _store.read() != null;
  Future<void> logout() => _store.clear();
}
