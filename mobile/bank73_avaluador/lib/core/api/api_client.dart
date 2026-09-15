import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../errors/api_exception.dart';
import '../storage/secure_session_store.dart';
import 'api_config.dart';

abstract interface class ApiTransport {
  Future<Map<String, dynamic>> get(String path);
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    String? tenantKey,
    bool authenticated = true,
  });
  Future<Map<String, dynamic>> patch(String path, {Map<String, dynamic>? body});
  Future<Map<String, dynamic>> put(String path, {Map<String, dynamic>? body});
}

class ApiClient implements ApiTransport {
  ApiClient(this._sessionStore, [http.Client? client])
    : _client = client ?? http.Client();
  final SessionStore _sessionStore;
  final http.Client _client;

  @override
  Future<Map<String, dynamic>> get(String path) => _request('GET', path);

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    String? tenantKey,
    bool authenticated = true,
  }) => _request(
    'POST',
    path,
    body: body,
    explicitTenant: tenantKey,
    authenticated: authenticated,
  );

  @override
  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? body,
  }) => _request('PATCH', path, body: body);

  @override
  Future<Map<String, dynamic>> put(String path, {Map<String, dynamic>? body}) =>
      _request('PUT', path, body: body);

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? explicitTenant,
    bool authenticated = true,
  }) async {
    final credentials = await _sessionStore.read();
    final tenantKey = explicitTenant ?? credentials?.tenantKey;
    final headers = <String, String>{'Accept': 'application/json'};
    if (tenantKey != null && tenantKey.isNotEmpty)
      headers['x-tenant'] = tenantKey;
    if (authenticated) {
      if (credentials == null)
        throw const ApiException('La sesion ha caducado.', statusCode: 401);
      headers['Authorization'] = 'Bearer ${credentials.token}';
    }
    if (body != null) headers['Content-Type'] = 'application/json';

    try {
      final request = http.Request(method, ApiConfig.uri(path))
        ..headers.addAll(headers);
      if (body != null) request.body = jsonEncode(body);
      final streamed = await _client
          .send(request)
          .timeout(const Duration(seconds: 20));
      final response = await http.Response.fromStream(streamed);
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      final payload = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{'data': decoded};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(
          (payload['error'] ??
                  payload['message'] ??
                  'No se pudo completar la solicitud.')
              .toString(),
          statusCode: response.statusCode,
          code: payload['error']?.toString(),
        );
      }
      return payload;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException(
        'El servidor esta tardando demasiado en responder.',
      );
    } on SocketException {
      throw const ApiException('No hay conexion con Bank73.');
    } on FormatException {
      throw const ApiException('Bank73 devolvio una respuesta no valida.');
    } on http.ClientException {
      throw const ApiException('No se pudo conectar con Bank73.');
    }
  }
}
