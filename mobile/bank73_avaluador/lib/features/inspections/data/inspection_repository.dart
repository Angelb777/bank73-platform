import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/models/models.dart';
import '../../../core/providers.dart';

final inspectionRepositoryProvider = Provider<InspectionRepository>(
  (ref) => InspectionRepository(ref.watch(apiTransportProvider)),
);

class InspectionRepository {
  InspectionRepository(this._api);
  final ApiTransport _api;

  Future<List<Inspection>> inspections(String projectId) async {
    final response = await _api.get(
      '/api/mobile/v1/projects/$projectId/inspections',
    );
    return (response['inspections'] as List? ?? const [])
        .map(
          (item) => Inspection.fromJson(Map<String, dynamic>.from(item as Map)),
        )
        .toList();
  }

  Future<Inspection> create(String projectId) async {
    final response = await _api.post(
      '/api/mobile/v1/projects/$projectId/inspections',
      body: const {},
    );
    return Inspection.fromJson(
      Map<String, dynamic>.from(response['inspection'] as Map),
    );
  }

  Future<Inspection> inspection(String inspectionId) async {
    final response = await _api.get('/api/mobile/v1/inspections/$inspectionId');
    return Inspection.fromJson(
      Map<String, dynamic>.from(response['inspection'] as Map),
    );
  }

  Future<Inspection> updateInspection(
    String inspectionId, {
    required int version,
    required DateTime inspectionDate,
    required String generalObservations,
  }) async {
    final response = await _api.patch(
      '/api/mobile/v1/inspections/$inspectionId',
      body: {
        'version': version,
        'inspectionDate': inspectionDate.toUtc().toIso8601String(),
        'generalObservations': generalObservations,
      },
    );
    return Inspection.fromJson(
      Map<String, dynamic>.from(response['inspection'] as Map),
    );
  }

  Future<List<InspectionUnit>> inspectedUnits(String inspectionId) async {
    final response = await _api.get(
      '/api/mobile/v1/inspections/$inspectionId/units',
    );
    return (response['units'] as List? ?? const [])
        .map(
          (item) =>
              InspectionUnit.fromJson(Map<String, dynamic>.from(item as Map)),
        )
        .toList();
  }

  Future<InspectionUnit?> inspectedUnit(
    String inspectionId,
    String unitId,
  ) async {
    try {
      final response = await _api.get(
        '/api/mobile/v1/inspections/$inspectionId/units/$unitId',
      );
      return InspectionUnit.fromJson(
        Map<String, dynamic>.from(response['inspectionUnit'] as Map),
      );
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<InspectionUnit> saveStructuredProgress({
    required String inspectionId,
    required String unitId,
    required int version,
    required Map<String, double> sectionProgress,
    required String observations,
  }) async {
    final response = await _api.put(
      '/api/mobile/v1/inspections/$inspectionId/units/$unitId',
      body: {
        'version': version,
        'observations': observations,
        'progressSections': sectionProgress.entries
            .map((entry) => {'key': entry.key, 'progressPercent': entry.value})
            .toList(),
      },
    );
    return InspectionUnit.fromJson(
      Map<String, dynamic>.from(response['inspectionUnit'] as Map),
    );
  }

  Future<InspectionUnit> saveLegacyProgress({
    required String inspectionId,
    required String unitId,
    required int version,
    required double progressPercent,
    required String observations,
  }) async {
    final response = await _api.put(
      '/api/mobile/v1/inspections/$inspectionId/units/$unitId',
      body: {
        'version': version,
        'observations': observations,
        'progressPercent': progressPercent,
      },
    );
    return InspectionUnit.fromJson(
      Map<String, dynamic>.from(response['inspectionUnit'] as Map),
    );
  }
}
