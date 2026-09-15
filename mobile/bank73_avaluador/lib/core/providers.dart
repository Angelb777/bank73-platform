import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/api_client.dart';
import 'storage/secure_session_store.dart';

final secureSessionStoreProvider = Provider<SessionStore>(
  (ref) => SecureSessionStore(),
);
final apiTransportProvider = Provider<ApiTransport>(
  (ref) => ApiClient(ref.watch(secureSessionStoreProvider)),
);
