import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../../../core/providers.dart';
import '../data/auth_repository.dart';

enum AuthStatus { checking, unauthenticated, authenticating, authenticated }

class AuthState {
  const AuthState(this.status, {this.user, this.message});
  final AuthStatus status;
  final AppUser? user;
  final String? message;
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    ref.watch(apiTransportProvider),
    ref.watch(secureSessionStoreProvider),
  ),
);

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>(
  (ref) {
    return AuthController(ref.watch(authRepositoryProvider))..initialize();
  },
);

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._repository)
    : super(const AuthState(AuthStatus.checking));
  final AuthRepository _repository;

  Future<void> initialize() async {
    if (!await _repository.hasSession()) {
      state = const AuthState(AuthStatus.unauthenticated);
      return;
    }
    try {
      await _accept(await _repository.me());
    } catch (_) {
      await _repository.logout();
      state = const AuthState(AuthStatus.unauthenticated);
    }
  }

  Future<void> login({
    required String email,
    required String password,
    required String tenantKey,
  }) async {
    state = const AuthState(AuthStatus.authenticating);
    try {
      await _accept(
        await _repository.login(
          email: email,
          password: password,
          tenantKey: tenantKey,
        ),
      );
    } catch (error) {
      state = AuthState(
        AuthStatus.unauthenticated,
        message: error.toString().replaceFirst('ApiException: ', ''),
      );
    }
  }

  Future<void> _accept(AppUser user) async {
    if (user.role != 'avaluador' || user.status != 'active') {
      await _repository.logout();
      state = const AuthState(
        AuthStatus.unauthenticated,
        message: 'Esta aplicacion esta disponible exclusivamente para avaluadores activos.',
      );
      return;
    }
    state = AuthState(AuthStatus.authenticated, user: user);
  }

  Future<void> logout() async {
    await _repository.logout();
    state = const AuthState(AuthStatus.unauthenticated);
  }
}
