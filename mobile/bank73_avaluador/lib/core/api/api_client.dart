import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../errors/api_exception.dart';
import '../storage/secure_session_store.dart';
import 'api_config.dart';

abstract interface class ApiTransport {
  Future<Map<String, dynamic>> get(String path);
  Future<List<int>> getBytes(String path);
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
  });
  Future<Map<String, dynamic>> patch(String path, {Map<String, dynamic>? body});
  Future<Map<String, dynamic>> put(String path, {Map<String, dynamic>? body});
  Future<Map<String, dynamic>> delete(String path);
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required String field,
    required String filePath,
    Map<String, String> fields = const {},
  });
}

class ApiClient implements ApiTransport {
  ApiClient(this._sessionStore, [http.Client? client])
    : _client = client ?? http.Client();
  final SessionStore _sessionStore;
  final http.Client _client;

  @override
  Future<Map<String, dynamic>> get(String path) => _request('GET', path);

  @override
  Future<List<int>> getBytes(String path) async {
    final credentials = await _sessionStore.read();
    if (credentials == null) {
      throw const ApiException('La sesion ha caducado.', statusCode: 401);
    }
    try {
      final response = await _client
          .get(
            ApiConfig.uri(path),
            headers: {'Authorization': 'Bearer ${credentials.token}'},
          )
          .timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(
          'No se pudo descargar el archivo.',
          statusCode: response.statusCode,
        );
      }
      return response.bodyBytes;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException('La descarga esta tardando demasiado.');
    } on SocketException {
      throw const ApiException('No hay conexion con Bank73.');
    } on http.ClientException {
      throw const ApiException('No se pudo conectar con Bank73.');
    }
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
  }) => _request('POST', path, body: body, authenticated: authenticated);

  @override
  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? body,
  }) => _request('PATCH', path, body: body);

  @override
  Future<Map<String, dynamic>> put(String path, {Map<String, dynamic>? body}) =>
      _request('PUT', path, body: body);

  @override
  Future<Map<String, dynamic>> delete(String path) => _request('DELETE', path);

  @override
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required String field,
    required String filePath,
    Map<String, String> fields = const {},
  }) async {
    final credentials = await _sessionStore.read();
    if (credentials == null) {
      throw const ApiException('La sesion ha caducado.', statusCode: 401);
    }
    try {
      final bytes = await File(filePath).readAsBytes();
      final isPng =
          bytes.length >= 8 &&
          bytes[0] == 137 &&
          bytes[1] == 80 &&
          bytes[2] == 78 &&
          bytes[3] == 71 &&
          bytes[4] == 13 &&
          bytes[5] == 10 &&
          bytes[6] == 26 &&
          bytes[7] == 10;
      final isJpeg =
          bytes.length >= 3 &&
          bytes[0] == 255 &&
          bytes[1] == 216 &&
          bytes[2] == 255;
      if (!isPng && !isJpeg) {
        throw const ApiException('Selecciona una fotografía JPEG o PNG.');
      }
      final request = http.MultipartRequest('POST', ApiConfig.uri(path))
        ..headers['Accept'] = 'application/json'
        ..headers['Authorization'] = 'Bearer ${credentials.token}'
        ..fields.addAll(fields)
        ..files.add(
          http.MultipartFile.fromBytes(
            field,
            bytes,
            filename: isPng ? 'evidencia.png' : 'evidencia.jpg',
            contentType: MediaType('image', isPng ? 'png' : 'jpeg'),
          ),
        );
      final streamed = await _client
          .send(request)
          .timeout(const Duration(seconds: 45));
      final response = await http.Response.fromStream(streamed);
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      final payload = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{'data': decoded};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(
          (payload['error'] ?? 'No se pudo subir la fotografia.').toString(),
          statusCode: response.statusCode,
          code: payload['error']?.toString(),
        );
      }
      return payload;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException('La subida esta tardando demasiado.');
    } on SocketException {
      throw const ApiException('No hay conexion con Bank73.');
    } on FormatException {
      throw const ApiException('Bank73 devolvio una respuesta no valida.');
    } on http.ClientException {
      throw const ApiException('No se pudo conectar con Bank73.');
    }
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
  }) async {
    final credentials = await _sessionStore.read();
    final headers = <String, String>{'Accept': 'application/json'};
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
