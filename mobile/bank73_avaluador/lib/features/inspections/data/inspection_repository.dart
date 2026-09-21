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

  Future<void> deleteDraft(Inspection inspection) async {
    await _api.delete(
      '/api/mobile/v1/inspections/${inspection.id}?version=${inspection.version}',
    );
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

  Future<Inspection> saveProjectProgress({
    required String inspectionId,
    required int version,
    required double projectProgressPercent,
    required List<InspectionCommonArea> commonAreas,
  }) async {
    final response = await _api.put(
      '/api/mobile/v1/inspections/$inspectionId/project-progress',
      body: {
        'version': version,
        'projectProgressPercent': projectProgressPercent,
        'commonAreas': commonAreas
            .map(
              (area) => {
                'key': area.key,
                'progressPercent': area.progressPercent,
                'observations': area.observations,
              },
            )
            .toList(),
      },
    );
    return Inspection.fromJson(
      Map<String, dynamic>.from(response['inspection'] as Map),
    );
  }

  Future<List<InspectionEvidence>> evidence(
    String inspectionId, {
    String? unitId,
    String? commonAreaKey,
  }) async {
    final query = <String, String>{
      if (unitId != null && unitId.isNotEmpty) 'unitId': unitId,
      if (commonAreaKey != null && commonAreaKey.isNotEmpty)
        'commonAreaKey': commonAreaKey,
    };
    final suffix = query.isEmpty ? '' : '?${Uri(queryParameters: query).query}';
    final response = await _api.get(
      '/api/mobile/v1/inspections/$inspectionId/evidence$suffix',
    );
    return (response['evidence'] as List? ?? const [])
        .map(
          (item) => InspectionEvidence.fromJson(
            Map<String, dynamic>.from(item as Map),
          ),
        )
        .toList();
  }

  Future<InspectionEvidence> uploadEvidence({
    required String inspectionId,
    required String filePath,
    String? unitId,
    String? commonAreaKey,
    String caption = '',
  }) async {
    final response = await _api.postMultipart(
      '/api/mobile/v1/inspections/$inspectionId/evidence',
      field: 'photo',
      filePath: filePath,
      fields: {
        if (unitId != null && unitId.isNotEmpty) 'unitId': unitId,
        if (commonAreaKey != null && commonAreaKey.isNotEmpty)
          'commonAreaKey': commonAreaKey,
        if (caption.isNotEmpty) 'caption': caption,
      },
    );
    return InspectionEvidence.fromJson(
      Map<String, dynamic>.from(response['evidence'] as Map),
    );
  }

  Future<List<int>> evidenceBytes(InspectionEvidence item) =>
      _api.getBytes(item.filePath);

  Future<void> deleteEvidence(String inspectionId, String evidenceId) async {
    await _api.delete(
      '/api/mobile/v1/inspections/$inspectionId/evidence/$evidenceId',
    );
  }

  Future<Inspection> finalize({
    required String inspectionId,
    required int version,
    required String signerName,
    required String signatureImage,
    TechnicalVerdict technicalVerdict = TechnicalVerdict.notAssessed,
    String recommendationNotes = '',
  }) async {
    final response = await _api.post(
      '/api/mobile/v1/inspections/$inspectionId/finalize',
      body: {
        'version': version,
        'signerName': signerName,
        'signatureImage': signatureImage,
        'technicalRecommendation': {
          'verdict': technicalVerdict.code,
          'notes': recommendationNotes,
        },
      },
    );
    return Inspection.fromJson(
      Map<String, dynamic>.from(response['inspection'] as Map),
    );
  }

  Future<List<int>> reportBytes(String inspectionId) =>
      _api.getBytes('/api/mobile/v1/inspections/$inspectionId/report.pdf');

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

  /// Finds the latest saved progress before the current inspection.
  Future<InspectionUnit?> previousInspectedUnit({
    required String projectId,
    required String currentInspectionId,
    required String unitId,
  }) async {
    final history = await inspections(projectId);
    final currentIndex = history.indexWhere(
      (item) => item.id == currentInspectionId,
    );
    final candidates = currentIndex < 0
        ? history.where((item) => item.id != currentInspectionId)
        : history.skip(currentIndex + 1);
    for (final inspection in candidates) {
      final previous = await inspectedUnit(inspection.id, unitId);
      if (previous != null) return previous;
    }
    return null;
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

  Future<List<BudgetLineFolder>> budgetLines(String inspectionId) async {
    final response = await _api.get(
      '/api/mobile/v1/inspections/$inspectionId/budget-lines',
    );
    return (response['folders'] as List? ?? const [])
        .map(
          (item) =>
              BudgetLineFolder.fromJson(Map<String, dynamic>.from(item as Map)),
        )
        .toList();
  }

  /// El avaluador solo envía avance físico y observaciones: el importe
  /// económico del período lo carga banca/finanzas por separado cuando
  /// exista, nunca desde la app móvil.
  Future<Inspection> saveBudgetLineProgress({
    required String inspectionId,
    required String budgetLineId,
    required int version,
    required double physicalProgressPercent,
    required String observations,
  }) async {
    final response = await _api.put(
      '/api/mobile/v1/inspections/$inspectionId/budget-lines/$budgetLineId',
      body: {
        'version': version,
        'physicalProgressPercent': physicalProgressPercent,
        'observations': observations,
      },
    );
    return Inspection.fromJson(
      Map<String, dynamic>.from(response['inspection'] as Map),
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
