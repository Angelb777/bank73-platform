import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../../core/models/models.dart';
import '../../../core/providers.dart';

final projectRepositoryProvider = Provider<ProjectRepository>(
  (ref) => ProjectRepository(ref.watch(apiTransportProvider)),
);

class ProjectRepository {
  ProjectRepository(this._api);
  final ApiTransport _api;

  Future<List<MobileProject>> projects() async {
    final response = await _api.get('/api/mobile/v1/projects');
    return (response['projects'] as List? ?? const [])
        .map(
          (item) =>
              MobileProject.fromJson(Map<String, dynamic>.from(item as Map)),
        )
        .toList();
  }

  Future<MobileProject> project(String projectId) async {
    final response = await _api.get('/api/mobile/v1/projects/$projectId');
    return MobileProject.fromJson(
      Map<String, dynamic>.from(response['project'] as Map),
    );
  }

  Future<List<MobileUnit>> units(String projectId) async {
    final response = await _api.get('/api/mobile/v1/projects/$projectId/units');
    return (response['units'] as List? ?? const [])
        .map(
          (item) => MobileUnit.fromJson(Map<String, dynamic>.from(item as Map)),
        )
        .toList();
  }

  Future<MobileUnit> unit(String projectId, String unitId) async {
    final response = await _api.get(
      '/api/mobile/v1/projects/$projectId/units/$unitId',
    );
    return MobileUnit.fromJson(
      Map<String, dynamic>.from(response['unit'] as Map),
    );
  }

  /// Torres/Etapas del proyecto, solo para agrupar la lista de unidades.
  Future<List<CommercialFolderSummary>> commercialFolders(
    String projectId,
  ) async {
    final response = await _api.get(
      '/api/mobile/v1/projects/$projectId/commercial-folders',
    );
    return (response['folders'] as List? ?? const [])
        .map(
          (item) => CommercialFolderSummary.fromJson(
            Map<String, dynamic>.from(item as Map),
          ),
        )
        .toList();
  }
}
