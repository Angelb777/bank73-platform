import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionCredentials {
  const SessionCredentials({required this.token, required this.tenantKey});
  final String token;
  final String tenantKey;
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
  static const _tenantKey = 'bank73.tenant';
  final FlutterSecureStorage _storage;

  @override
  Future<void> save(SessionCredentials credentials) async {
    await _storage.write(key: _tokenKey, value: credentials.token);
    await _storage.write(key: _tenantKey, value: credentials.tenantKey);
  }

  @override
  Future<SessionCredentials?> read() async {
    final token = await _storage.read(key: _tokenKey);
    final tenantKey = await _storage.read(key: _tenantKey);
    if (token == null ||
        token.isEmpty ||
        tenantKey == null ||
        tenantKey.isEmpty)
      return null;
    return SessionCredentials(token: token, tenantKey: tenantKey);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _tenantKey);
  }
}
