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
    this.promoterProgressPercent = 0,
  });
  final String id;
  final String name;
  final ProjectLocation location;
  final String projectType;
  final String status;
  final String? coverSource;
  final String description;
  final double promoterProgressPercent;

  factory MobileProject.fromJson(Map<String, dynamic> json) => MobileProject(
    id: (json['id'] ?? '').toString(),
    name: (json['name'] ?? '').toString(),
    location: ProjectLocation.fromJson(_map(json['location'])),
    projectType: (json['projectType'] ?? '').toString(),
    status: (json['status'] ?? '').toString(),
    coverSource: _map(json['coverImage'])['source']?.toString(),
    description: (json['description'] ?? '').toString(),
    promoterProgressPercent: _number(json['promoterProgressPercent'])
        .clamp(0, 100),
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

class InspectionCommonArea {
  const InspectionCommonArea({
    required this.key,
    required this.name,
    required this.weight,
    required this.progressPercent,
    required this.observations,
  });
  final String key;
  final String name;
  final double weight;
  final double progressPercent;
  final String observations;

  factory InspectionCommonArea.fromJson(Map<String, dynamic> json) =>
      InspectionCommonArea(
        key: (json['key'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        weight: _number(json['weight']),
        progressPercent: _number(json['progressPercent']),
        observations: (json['observations'] ?? '').toString(),
      );
}

enum TechnicalVerdict {
  favorable('favorable', 'Favorable al desembolso'),
  conditional('conditional', 'Favorable con condiciones'),
  unfavorable('unfavorable', 'Desfavorable al desembolso'),
  notAssessed('not_assessed', 'Sin pronunciamiento');

  const TechnicalVerdict(this.code, this.label);
  final String code;
  final String label;
  static TechnicalVerdict fromCode(dynamic value) => values.firstWhere(
    (entry) => entry.code == value,
    orElse: () => notAssessed,
  );
}

/// Avance físico por partida ya guardado en esta inspección (resumen ligero;
/// el detalle enriquecido con lo anterior/previo vive en BudgetLineItem).
class BudgetLineProgressEntry {
  const BudgetLineProgressEntry({
    required this.budgetLineId,
    required this.physicalProgressPercent,
  });
  final String budgetLineId;
  final double physicalProgressPercent;

  factory BudgetLineProgressEntry.fromJson(Map<String, dynamic> json) =>
      BudgetLineProgressEntry(
        budgetLineId: (json['budgetLineId'] ?? '').toString(),
        physicalProgressPercent: _number(json['physicalProgressPercent']),
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
    required this.projectProgressPercent,
    required this.commonAreas,
    required this.version,
    required this.updatedAt,
    required this.finalizedAt,
    required this.reportNumber,
    required this.signerName,
    this.methodology,
    this.technicalVerdict = TechnicalVerdict.notAssessed,
    this.recommendationNotes = '',
    this.budgetLineProgress = const [],
  });
  final String id;
  final String projectId;
  final String status;
  final DateTime? inspectionDate;
  final DateTime? startedAt;
  final String generalObservations;
  final double projectProgressPercent;
  final List<InspectionCommonArea> commonAreas;
  final int version;
  final DateTime? updatedAt;
  final DateTime? finalizedAt;
  final String reportNumber;
  final String signerName;
  final InspectionMethodology? methodology;
  final TechnicalVerdict technicalVerdict;
  final String recommendationNotes;
  final List<BudgetLineProgressEntry> budgetLineProgress;

  factory Inspection.fromJson(Map<String, dynamic> json) => Inspection(
    id: (json['id'] ?? '').toString(),
    projectId: (json['projectId'] ?? '').toString(),
    status: (json['status'] ?? '').toString(),
    inspectionDate: _date(json['inspectionDate']),
    startedAt: _date(json['startedAt']),
    generalObservations: (json['generalObservations'] ?? '').toString(),
    projectProgressPercent: _number(json['projectProgressPercent']),
    commonAreas: (json['commonAreas'] as List? ?? const [])
        .map((item) => InspectionCommonArea.fromJson(_map(item)))
        .toList(),
    version: (json['version'] as num?)?.toInt() ?? 0,
    updatedAt: _date(json['updatedAt']),
    finalizedAt: _date(json['finalizedAt']),
    reportNumber: (json['reportNumber'] ?? '').toString(),
    signerName: (_map(json['signature'])['signerName'] ?? '').toString(),
    technicalVerdict: TechnicalVerdict.fromCode(
      _map(json['technicalRecommendation'])['verdict'],
    ),
    recommendationNotes: (_map(json['technicalRecommendation'])['notes'] ?? '')
        .toString(),
    methodology: json['methodology'] == null
        ? null
        : InspectionMethodology.fromJson(_map(json['methodology'])),
    budgetLineProgress: (json['budgetLineProgress'] as List? ?? const [])
        .map((item) => BudgetLineProgressEntry.fromJson(_map(item)))
        .toList(),
  );

  bool get isFinalized => status == 'finalized';
}

class InspectionEvidence {
  const InspectionEvidence({
    required this.id,
    required this.inspectionId,
    required this.projectId,
    required this.unitId,
    required this.commonAreaKey,
    required this.caption,
    required this.filePath,
    required this.createdAt,
  });
  final String id;
  final String inspectionId;
  final String projectId;
  final String? unitId;
  final String commonAreaKey;
  final String caption;
  final String filePath;
  final DateTime? createdAt;

  factory InspectionEvidence.fromJson(Map<String, dynamic> json) =>
      InspectionEvidence(
        id: (json['id'] ?? '').toString(),
        inspectionId: (json['inspectionId'] ?? '').toString(),
        projectId: (json['projectId'] ?? '').toString(),
        unitId: json['unitId']?.toString(),
        commonAreaKey: (json['commonAreaKey'] ?? '').toString(),
        caption: (json['caption'] ?? '').toString(),
        filePath: (json['filePath'] ?? '').toString(),
        createdAt: _date(json['createdAt']),
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

/// Avance físico ya guardado en esta inspección para una partida (torre/etapa).
class BudgetLineCurrentProgress {
  const BudgetLineCurrentProgress({
    required this.physicalProgressPercent,
    required this.observations,
    required this.updatedAt,
  });
  final double physicalProgressPercent;
  final String observations;
  final DateTime? updatedAt;

  factory BudgetLineCurrentProgress.fromJson(Map<String, dynamic> json) =>
      BudgetLineCurrentProgress(
        physicalProgressPercent: _number(json['physicalProgressPercent']),
        observations: (json['observations'] ?? '').toString(),
        updatedAt: _date(json['updatedAt']),
      );
}

/// Avance físico registrado en la última inspección finalizada del mismo
/// proyecto y banco, usado como punto de partida (no editable).
class BudgetLinePreviousProgress {
  const BudgetLinePreviousProgress({
    required this.physicalProgressPercent,
    required this.inspectionDate,
  });
  final double physicalProgressPercent;
  final DateTime? inspectionDate;

  factory BudgetLinePreviousProgress.fromJson(Map<String, dynamic> json) =>
      BudgetLinePreviousProgress(
        physicalProgressPercent: _number(json['physicalProgressPercent']),
        inspectionDate: _date(json['inspectionDate']),
      );
}

/// Una partida de obra del catálogo (ProjectBudgetLine), dato maestro que
/// mantiene banca/promotor. El avaluador solo reporta avance sobre ella.
class BudgetLineItem {
  const BudgetLineItem({
    required this.id,
    required this.code,
    required this.name,
    required this.category,
    required this.order,
    this.current,
    this.previous,
  });
  final String id;
  final String code;
  final String name;
  final String category;
  final int order;
  final BudgetLineCurrentProgress? current;
  final BudgetLinePreviousProgress? previous;

  factory BudgetLineItem.fromJson(Map<String, dynamic> json) => BudgetLineItem(
    id: (json['id'] ?? '').toString(),
    code: (json['code'] ?? '').toString(),
    name: (json['name'] ?? '').toString(),
    category: (json['category'] ?? '').toString(),
    order: (json['order'] as num?)?.toInt() ?? 0,
    current: json['current'] == null
        ? null
        : BudgetLineCurrentProgress.fromJson(_map(json['current'])),
    previous: json['previous'] == null
        ? null
        : BudgetLinePreviousProgress.fromJson(_map(json['previous'])),
  );

  String get label => code.isEmpty ? name : '$code · $name';
}

/// Una Torre/Etapa: reutiliza directamente CommercialFolder del módulo
/// comercial, no una entidad nueva.
class BudgetLineFolder {
  const BudgetLineFolder({
    required this.id,
    required this.name,
    required this.color,
    required this.order,
    required this.lines,
  });
  final String id;
  final String name;
  final String color;
  final int order;
  final List<BudgetLineItem> lines;

  factory BudgetLineFolder.fromJson(Map<String, dynamic> json) =>
      BudgetLineFolder(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        color: (json['color'] ?? '').toString(),
        order: (json['order'] as num?)?.toInt() ?? 0,
        lines: (json['lines'] as List? ?? const [])
            .map((item) => BudgetLineItem.fromJson(_map(item)))
            .toList(),
      );
}
