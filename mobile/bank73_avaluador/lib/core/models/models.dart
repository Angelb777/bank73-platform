double _number(dynamic value) =>
    value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
DateTime? _date(dynamic value) =>
    value == null ? null : DateTime.tryParse(value.toString());
Map<String, dynamic> _map(dynamic value) =>
    value is Map<String, dynamic> ? value : <String, dynamic>{};

class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    required this.status,
    required this.tenantKey,
  });
  final String id;
  final String name;
  final String email;
  final String role;
  final String status;
  final String tenantKey;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
    id: (json['userId'] ?? json['id'] ?? '').toString(),
    name: (json['name'] ?? '').toString(),
    email: (json['email'] ?? '').toString(),
    role: (json['role'] ?? '').toString(),
    status: (json['status'] ?? '').toString(),
    tenantKey: (json['tenantKey'] ?? '').toString(),
  );
}

class ProjectLocation {
  const ProjectLocation({
    required this.label,
    required this.address,
    required this.city,
    required this.province,
  });
  final String label;
  final String address;
  final String city;
  final String province;
  String get display => [
    label,
    address,
    city,
    province,
  ].where((part) => part.trim().isNotEmpty).toSet().join(' · ');

  factory ProjectLocation.fromJson(Map<String, dynamic> json) =>
      ProjectLocation(
        label: (json['label'] ?? '').toString(),
        address: (json['address'] ?? '').toString(),
        city: (json['city'] ?? '').toString(),
        province: (json['province'] ?? '').toString(),
      );
}

class MobileProject {
  const MobileProject({
    required this.id,
    required this.name,
    required this.location,
    required this.projectType,
    required this.status,
    this.coverSource,
    this.description = '',
  });
  final String id;
  final String name;
  final ProjectLocation location;
  final String projectType;
  final String status;
  final String? coverSource;
  final String description;

  factory MobileProject.fromJson(Map<String, dynamic> json) => MobileProject(
    id: (json['id'] ?? '').toString(),
    name: (json['name'] ?? '').toString(),
    location: ProjectLocation.fromJson(_map(json['location'])),
    projectType: (json['projectType'] ?? '').toString(),
    status: (json['status'] ?? '').toString(),
    coverSource: _map(json['coverImage'])['source']?.toString(),
    description: (json['description'] ?? '').toString(),
  );
}

class UnitSurfaces {
  const UnitSurfaces({
    required this.m2,
    required this.openM2,
    required this.closedM2,
    required this.totalConstructionM2,
  });
  final double m2;
  final double openM2;
  final double closedM2;
  final double totalConstructionM2;

  factory UnitSurfaces.fromJson(Map<String, dynamic> json) => UnitSurfaces(
    m2: _number(json['m2']),
    openM2: _number(json['openM2']),
    closedM2: _number(json['closedM2']),
    totalConstructionM2: _number(json['totalConstructionM2']),
  );
}

class MobileUnit {
  const MobileUnit({
    required this.id,
    required this.code,
    required this.manzana,
    required this.lote,
    required this.modelo,
    required this.ubicacion,
    required this.surfaces,
    required this.status,
  });
  final String id;
  final String code;
  final String manzana;
  final String lote;
  final String modelo;
  final String ubicacion;
  final UnitSurfaces surfaces;
  final String status;

  factory MobileUnit.fromJson(Map<String, dynamic> json) => MobileUnit(
    id: (json['id'] ?? '').toString(),
    code: (json['code'] ?? '').toString(),
    manzana: (json['manzana'] ?? '').toString(),
    lote: (json['lote'] ?? '').toString(),
    modelo: (json['modelo'] ?? '').toString(),
    ubicacion: (json['ubicacion'] ?? '').toString(),
    surfaces: UnitSurfaces.fromJson(_map(json['surfaces'])),
    status: (json['status'] ?? '').toString(),
  );

  bool matches(String query) {
    final needle = query.trim().toLowerCase();
    return needle.isEmpty ||
        [
          code,
          manzana,
          lote,
          modelo,
        ].any((value) => value.toLowerCase().contains(needle));
  }
}

class MethodologySection {
  const MethodologySection({
    required this.key,
    required this.name,
    required this.weight,
    required this.order,
  });
  final String key;
  final String name;
  final double weight;
  final int order;

  factory MethodologySection.fromJson(Map<String, dynamic> json) =>
      MethodologySection(
        key: (json['key'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        weight: _number(json['weight']),
        order: (json['order'] as num?)?.toInt() ?? 0,
      );
}

class InspectionMethodology {
  const InspectionMethodology({
    required this.id,
    required this.name,
    required this.version,
    required this.sections,
  });
  final String id;
  final String name;
  final int version;
  final List<MethodologySection> sections;

  factory InspectionMethodology.fromJson(Map<String, dynamic> json) =>
      InspectionMethodology(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        version: (json['version'] as num?)?.toInt() ?? 0,
        sections: (json['sections'] as List? ?? const [])
            .map((item) => MethodologySection.fromJson(_map(item)))
            .toList(),
      );
}

class Inspection {
  const Inspection({
    required this.id,
    required this.projectId,
    required this.status,
    required this.inspectionDate,
    required this.startedAt,
    required this.generalObservations,
    required this.version,
    required this.updatedAt,
    this.methodology,
  });
  final String id;
  final String projectId;
  final String status;
  final DateTime? inspectionDate;
  final DateTime? startedAt;
  final String generalObservations;
  final int version;
  final DateTime? updatedAt;
  final InspectionMethodology? methodology;

  factory Inspection.fromJson(Map<String, dynamic> json) => Inspection(
    id: (json['id'] ?? '').toString(),
    projectId: (json['projectId'] ?? '').toString(),
    status: (json['status'] ?? '').toString(),
    inspectionDate: _date(json['inspectionDate']),
    startedAt: _date(json['startedAt']),
    generalObservations: (json['generalObservations'] ?? '').toString(),
    version: (json['version'] as num?)?.toInt() ?? 0,
    updatedAt: _date(json['updatedAt']),
    methodology: json['methodology'] == null
        ? null
        : InspectionMethodology.fromJson(_map(json['methodology'])),
  );
}

class InspectionProgressSection {
  const InspectionProgressSection({
    required this.key,
    required this.name,
    required this.weight,
    required this.order,
    required this.progressPercent,
  });
  final String key;
  final String name;
  final double weight;
  final int order;
  final double progressPercent;

  factory InspectionProgressSection.fromJson(Map<String, dynamic> json) =>
      InspectionProgressSection(
        key: (json['key'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        weight: _number(json['weight']),
        order: (json['order'] as num?)?.toInt() ?? 0,
        progressPercent: _number(json['progressPercent']),
      );
}

class InspectionUnit {
  const InspectionUnit({
    required this.id,
    required this.inspectionId,
    required this.projectId,
    required this.unitId,
    required this.progressPercent,
    required this.observations,
    required this.version,
    required this.updatedAt,
    required this.progressSections,
  });
  final String id;
  final String inspectionId;
  final String projectId;
  final String unitId;
  final double progressPercent;
  final String observations;
  final int version;
  final DateTime? updatedAt;
  final List<InspectionProgressSection>? progressSections;

  factory InspectionUnit.fromJson(Map<String, dynamic> json) => InspectionUnit(
    id: (json['id'] ?? '').toString(),
    inspectionId: (json['inspectionId'] ?? '').toString(),
    projectId: (json['projectId'] ?? '').toString(),
    unitId: (json['unitId'] ?? '').toString(),
    progressPercent: _number(json['progressPercent']),
    observations: (json['observations'] ?? '').toString(),
    version: (json['version'] as num?)?.toInt() ?? 0,
    updatedAt: _date(json['updatedAt']),
    progressSections: json['progressSections'] == null
        ? null
        : (json['progressSections'] as List)
              .map((item) => InspectionProgressSection.fromJson(_map(item)))
              .toList(),
  );
}
