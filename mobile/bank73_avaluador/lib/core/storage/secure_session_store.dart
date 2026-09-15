import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionCredentials {
  const SessionCredentials({required this.token});
  final String token;
}

abstract interface class SessionStore {
  Future<void> save(SessionCredentials credentials);
  Future<SessionCredentials?> read();
  Future<void> clear();
}

class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage])
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
          );
  static const _tokenKey = 'bank73.jwt';
  final FlutterSecureStorage _storage;

  @override
  Future<void> save(SessionCredentials credentials) async {
    await _storage.write(key: _tokenKey, value: credentials.token);
  }

  @override
  Future<SessionCredentials?> read() async {
    final token = await _storage.read(key: _tokenKey);
    if (token == null || token.isEmpty) return null;
    return SessionCredentials(token: token);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: 'bank73.tenant');
  }
}
