import 'package:bank73_avaluador/core/api/api_client.dart';
import 'package:bank73_avaluador/core/errors/api_exception.dart';
import 'package:bank73_avaluador/core/models/models.dart';
import 'package:bank73_avaluador/core/storage/secure_session_store.dart';
import 'package:bank73_avaluador/features/inspections/data/inspection_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class MemorySessionStore implements SessionStore {
  MemorySessionStore(this.credentials);
  SessionCredentials? credentials;

  @override
  Future<void> clear() async => credentials = null;

  @override
  Future<SessionCredentials?> read() async => credentials;

  @override
  Future<void> save(SessionCredentials credentials) async {
    this.credentials = credentials;
  }
}

class FakeTransport implements ApiTransport {
  Map<String, dynamic> response = {};
  String? method;
  String? path;
  Map<String, dynamic>? body;

  @override
  Future<Map<String, dynamic>> get(String path) async {
    method = 'GET';
    this.path = path;
    return response;
  }

  @override
  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    method = 'PATCH';
    this.path = path;
    this.body = body;
    return response;
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    String? tenantKey,
    bool authenticated = true,
  }) async {
    method = 'POST';
    this.path = path;
    this.body = body;
    return response;
  }

  @override
  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    method = 'PUT';
    this.path = path;
    this.body = body;
    return response;
  }
}

Map<String, dynamic> inspectionUnitJson({
  List<Map<String, dynamic>>? sections,
}) => {
  'id': 'iu-1',
  'inspectionId': 'inspection-1',
  'projectId': 'project-1',
  'unitId': 'unit-1',
  'progressPercent': 55,
  'observations': 'Avance observado',
  'version': 1,
  'updatedAt': '2026-09-15T10:00:00.000Z',
  'progressSections': sections,
};

void main() {
  test(
    'authenticated API requests include Bearer token and bank tenant',
    () async {
      final store = MemorySessionStore(
        const SessionCredentials(token: 'secret-token', tenantKey: 'bank-a'),
      );
      final client = MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer secret-token');
        expect(request.headers['x-tenant'], 'bank-a');
        return http.Response(
          '{"projects":[]}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final response = await ApiClient(
        store,
        client,
      ).get('/api/mobile/v1/projects');
      expect(response['projects'], isEmpty);
    },
  );

  test('mobile project and unit parse only their DTO fields', () {
    final project = MobileProject.fromJson({
      'id': 'p1',
      'name': 'Residencial Norte',
      'location': {'city': 'Panamá', 'province': 'Panamá'},
      'coverImage': {'source': '/uploads/cover.jpg'},
      'financialConditions': {'secret': true},
    });
    final unit = MobileUnit.fromJson({
      'id': 'u1',
      'code': 'M1-L2',
      'manzana': 'M1',
      'lote': 'L2',
      'modelo': 'Casa A',
      'surfaces': {'m2': 125.5},
      'clienteId': 'private',
    });

    expect(project.name, 'Residencial Norte');
    expect(project.coverSource, '/uploads/cover.jpg');
    expect(unit.surfaces.m2, 125.5);
    expect(unit.matches('casa'), isTrue);
    expect(unit.matches('otro'), isFalse);
  });

  test('inspection parses structured methodology and legacy null', () {
    final structured = Inspection.fromJson({
      'id': 'i1',
      'projectId': 'p1',
      'status': 'draft',
      'version': 2,
      'methodology': {
        'id': 't1',
        'name': 'Método banco',
        'version': 3,
        'sections': [
          {'key': 'estructura', 'name': 'Estructura', 'weight': 40, 'order': 1},
        ],
      },
    });
    final legacy = Inspection.fromJson({
      'id': 'i2',
      'projectId': 'p1',
      'status': 'draft',
    });

    expect(structured.methodology?.version, 3);
    expect(structured.methodology?.sections.single.weight, 40);
    expect(legacy.methodology, isNull);
  });

  test('structured save sends only keys, section progress, observations and version', () async {
    final transport = FakeTransport()
      ..response = {
        'inspectionUnit': inspectionUnitJson(
          sections: [
            {
              'key': 'estructura',
              'name': 'Estructura',
              'weight': 40,
              'order': 1,
              'progressPercent': 100,
            },
            {
              'key': 'acabados',
              'name': 'Acabados',
              'weight': 60,
              'order': 2,
              'progressPercent': 25,
            },
          ],
        ),
      };
    final saved = await InspectionRepository(transport).saveStructuredProgress(
      inspectionId: 'inspection-1',
      unitId: 'unit-1',
      version: 0,
      sectionProgress: {'estructura': 100, 'acabados': 25},
      observations: 'Avance observado',
    );

    expect(transport.method, 'PUT');
    expect(
      transport.path,
      '/api/mobile/v1/inspections/inspection-1/units/unit-1',
    );
    expect(transport.body?['version'], 0);
    expect(transport.body?.containsKey('progressPercent'), isFalse);
    final sentSections = transport.body?['progressSections'] as List;
    expect(sentSections, hasLength(2));
    expect(
      (sentSections.first as Map).keys,
      unorderedEquals(['key', 'progressPercent']),
    );
    expect(saved.progressPercent, 55);
  });

  test('legacy save preserves the previous API contract', () async {
    final transport = FakeTransport()
      ..response = {'inspectionUnit': inspectionUnitJson()};
    await InspectionRepository(transport).saveLegacyProgress(
      inspectionId: 'inspection-1',
      unitId: 'unit-1',
      version: 4,
      progressPercent: 42.5,
      observations: 'Legacy',
    );

    expect(transport.body, {
      'version': 4,
      'observations': 'Legacy',
      'progressPercent': 42.5,
    });
    expect(transport.body?.containsKey('progressSections'), isFalse);
  });

  test('version conflict is distinguished from other API failures', () {
    const conflict = ApiException(
      'version_conflict',
      statusCode: 409,
      code: 'version_conflict',
    );
    const missing = ApiException('No encontrado', statusCode: 404);
    expect(conflict.isVersionConflict, isTrue);
    expect(missing.isVersionConflict, isFalse);
    expect(missing.isForbiddenOrMissing, isTrue);
  });
}
