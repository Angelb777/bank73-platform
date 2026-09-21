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

/// Contexto preparado por backend para el briefing y el futuro informe.
/// Conserva solo el resumen que la UI necesita ahora; el payload completo
/// permanece disponible en [raw] para incorporar Recorrido/Incidencias sin
/// volver a definir calculos financieros en Flutter.
class InspectionPack {
  const InspectionPack({
    required this.project,
    required this.sequence,
    required this.previousPhysicalProgressPercent,
    required this.administrativeProgressPercent,
    required this.financialProgressPercent,
    required this.activeFronts,
    required this.hasPreviousInspection,
    required this.raw,
  });

  final MobileProject project;
  final int sequence;
  final double previousPhysicalProgressPercent;
  final double administrativeProgressPercent;
  final double financialProgressPercent;
  final List<Map<String, dynamic>> activeFronts;
  final bool hasPreviousInspection;
  final Map<String, dynamic> raw;

  factory InspectionPack.fromJson(Map<String, dynamic> json) {
    final metrics = _map(json['metrics']);
    final physical = _map(metrics['physicalProgress']);
    final administrative = _map(metrics['administrativeProgress']);
    final financial = _map(metrics['financialProgress']);
    final projectJson = _map(json['project']);
    return InspectionPack(
      project: MobileProject.fromJson({
        'id': projectJson['id'],
        'name': projectJson['name'],
        'location': projectJson['location'],
        'projectType': projectJson['type'],
        'status': projectJson['status'],
        'description': projectJson['description'],
      }),
      sequence: (json['sequence'] as num?)?.toInt() ?? 1,
      previousPhysicalProgressPercent: _number(physical['previousPercent']),
      administrativeProgressPercent: _number(administrative['percent']),
      financialProgressPercent: _number(financial['percent']),
      activeFronts: (json['activeFronts'] as List? ?? const [])
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList(),
      hasPreviousInspection: json['previousInspection'] != null,
      raw: json,
    );
  }
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
    this.folderId,
  });
  final String id;
  final String code;
  final String manzana;
  final String lote;
  final String modelo;
  final String ubicacion;
  final UnitSurfaces surfaces;
  final String status;
  final String? folderId;

  factory MobileUnit.fromJson(Map<String, dynamic> json) => MobileUnit(
    id: (json['id'] ?? '').toString(),
    code: (json['code'] ?? '').toString(),
    manzana: (json['manzana'] ?? '').toString(),
    lote: (json['lote'] ?? '').toString(),
    modelo: (json['modelo'] ?? '').toString(),
    ubicacion: (json['ubicacion'] ?? '').toString(),
    surfaces: UnitSurfaces.fromJson(_map(json['surfaces'])),
    status: (json['status'] ?? '').toString(),
    folderId: json['folderId']?.toString(),
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

/// Torre/Etapa: reutiliza tal cual las carpetas comerciales existentes
/// (CommercialFolder), solo para agrupar/ordenar unidades en la app.
class CommercialFolderSummary {
  const CommercialFolderSummary({
    required this.id,
    required this.name,
    required this.color,
    required this.order,
  });
  final String id;
  final String name;
  final String color;
  final int order;

  factory CommercialFolderSummary.fromJson(Map<String, dynamic> json) =>
      CommercialFolderSummary(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        color: (json['color'] ?? '').toString(),
        order: (json['order'] as num?)?.toInt() ?? 0,
      );
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
    this.previousProgressPercent,
    this.previousProgressKnown = false,
  });
  final String key;
  final String name;
  final double weight;
  final double progressPercent;
  final String observations;
  final double? previousProgressPercent;
  final bool previousProgressKnown;

  factory InspectionCommonArea.fromJson(Map<String, dynamic> json) =>
      InspectionCommonArea(
        key: (json['key'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        weight: _number(json['weight']),
        progressPercent: _number(json['progressPercent']),
        observations: (json['observations'] ?? '').toString(),
        previousProgressPercent: json['previousProgressPercent'] == null
            ? null
            : _number(json['previousProgressPercent']),
        previousProgressKnown: json['previousProgressKnown'] == true,
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

class InspectionWorkFront {
  const InspectionWorkFront({
    required this.key,
    required this.sourceType,
    required this.sourceId,
    required this.name,
    required this.status,
    required this.previousProgressPercent,
    required this.currentProgressPercent,
    required this.observations,
    this.plannedProgressPercent,
    this.visitedAt,
    this.previousProgressKnown = false,
  });
  final String key;
  final String sourceType;
  final String sourceId;
  final String name;
  final String status;
  final double previousProgressPercent;
  final double? plannedProgressPercent;
  final double currentProgressPercent;
  final String observations;
  final DateTime? visitedAt;
  final bool previousProgressKnown;
  double? get periodIncrementPercent => previousProgressKnown
      ? currentProgressPercent - previousProgressPercent
      : null;

  factory InspectionWorkFront.fromJson(Map<String, dynamic> json) =>
      InspectionWorkFront(
        key: (json['key'] ?? '').toString(),
        sourceType: (json['sourceType'] ?? 'custom').toString(),
        sourceId: (json['sourceId'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        status: (json['status'] ?? 'not_visited').toString(),
        previousProgressPercent: _number(json['previousProgressPercent']),
        plannedProgressPercent: json['plannedProgressPercent'] == null
            ? null
            : _number(json['plannedProgressPercent']),
        currentProgressPercent: _number(json['currentProgressPercent']),
        observations: (json['observations'] ?? '').toString(),
        visitedAt: _date(json['visitedAt']),
        previousProgressKnown: json['previousProgressKnown'] == true,
      );

  Map<String, dynamic> toJson() => {
    'key': key,
    'sourceType': sourceType,
    'sourceId': sourceId,
    'name': name,
    'status': status,
    'previousProgressPercent': previousProgressPercent,
    'previousProgressKnown': previousProgressKnown,
    'plannedProgressPercent': plannedProgressPercent,
    'currentProgressPercent': currentProgressPercent,
    'observations': observations,
    'visitedAt': visitedAt?.toUtc().toIso8601String(),
  };

  InspectionWorkFront copyWith({
    String? status,
    double? currentProgressPercent,
    String? observations,
    DateTime? visitedAt,
  }) => InspectionWorkFront(
    key: key,
    sourceType: sourceType,
    sourceId: sourceId,
    name: name,
    status: status ?? this.status,
    previousProgressPercent: previousProgressPercent,
    plannedProgressPercent: plannedProgressPercent,
    currentProgressPercent:
        currentProgressPercent ?? this.currentProgressPercent,
    observations: observations ?? this.observations,
    visitedAt: visitedAt ?? this.visitedAt,
    previousProgressKnown: previousProgressKnown,
  );
}

class InspectionQuickAssessment {
  const InspectionQuickAssessment({
    this.status = 'not_assessed',
    this.checks = const [],
    this.observations = '',
  });
  final String status;
  final List<String> checks;
  final String observations;

  factory InspectionQuickAssessment.fromJson(Map<String, dynamic> json) =>
      InspectionQuickAssessment(
        status: (json['status'] ?? 'not_assessed').toString(),
        checks: (json['checks'] as List? ?? const [])
            .map((value) => value.toString())
            .toList(),
        observations: (json['observations'] ?? '').toString(),
      );

  Map<String, dynamic> toJson() => {
    'status': status,
    'checks': checks,
    'observations': observations,
  };
}

class InspectionIncident {
  const InspectionIncident({
    this.id = '',
    required this.type,
    required this.severity,
    required this.status,
    required this.title,
    this.description = '',
    this.location = '',
    this.workFrontKey = '',
    this.impactSchedule = false,
    this.impactCost = false,
    this.impactQuality = false,
    this.actionRequired = '',
    this.carriedFromIncidentId,
    this.observedAt,
  });
  final String id;
  final String type;
  final String severity;
  final String status;
  final String title;
  final String description;
  final String location;
  final String workFrontKey;
  final bool impactSchedule;
  final bool impactCost;
  final bool impactQuality;
  final String actionRequired;
  final String? carriedFromIncidentId;
  final DateTime? observedAt;

  factory InspectionIncident.fromJson(Map<String, dynamic> json) =>
      InspectionIncident(
        id: (json['id'] ?? '').toString(),
        type: (json['type'] ?? 'other').toString(),
        severity: (json['severity'] ?? 'medium').toString(),
        status: (json['status'] ?? 'open').toString(),
        title: (json['title'] ?? '').toString(),
        description: (json['description'] ?? '').toString(),
        location: (json['location'] ?? '').toString(),
        workFrontKey: (json['workFrontKey'] ?? '').toString(),
        impactSchedule: json['impactSchedule'] == true,
        impactCost: json['impactCost'] == true,
        impactQuality: json['impactQuality'] == true,
        actionRequired: (json['actionRequired'] ?? '').toString(),
        carriedFromIncidentId: json['carriedFromIncidentId']?.toString(),
        observedAt: _date(json['observedAt']),
      );

  Map<String, dynamic> toJson() => {
    if (id.isNotEmpty) 'id': id,
    'type': type,
    'severity': severity,
    'status': status,
    'title': title,
    'description': description,
    'location': location,
    'workFrontKey': workFrontKey,
    'impactSchedule': impactSchedule,
    'impactCost': impactCost,
    'impactQuality': impactQuality,
    'actionRequired': actionRequired,
    'carriedFromIncidentId': carriedFromIncidentId,
    'observedAt': observedAt?.toUtc().toIso8601String(),
  };
}

class InspectionScheduleAssessment {
  const InspectionScheduleAssessment({
    this.status = 'not_assessed',
    this.plannedProgressPercent,
    this.forecastCompletionDate,
    this.notes = '',
  });
  final String status;
  final double? plannedProgressPercent;
  final DateTime? forecastCompletionDate;
  final String notes;

  factory InspectionScheduleAssessment.fromJson(Map<String, dynamic> json) =>
      InspectionScheduleAssessment(
        status: (json['status'] ?? 'not_assessed').toString(),
        plannedProgressPercent: json['plannedProgressPercent'] == null
            ? null
            : _number(json['plannedProgressPercent']),
        forecastCompletionDate: _date(json['forecastCompletionDate']),
        notes: (json['notes'] ?? '').toString(),
      );

  Map<String, dynamic> toJson() => {
    'status': status,
    'plannedProgressPercent': plannedProgressPercent,
    'forecastCompletionDate': forecastCompletionDate?.toUtc().toIso8601String(),
    'notes': notes,
  };
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
    this.technicalConclusion = '',
    this.workFronts = const [],
    this.incidents = const [],
    this.qualityObservations = '',
    this.environmentalObservations = '',
    this.qualityAssessment,
    this.environmentalAssessment,
    this.scheduleAssessment,
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
  final String technicalConclusion;
  final List<InspectionWorkFront> workFronts;
  final List<InspectionIncident> incidents;
  final String qualityObservations;
  final String environmentalObservations;
  final InspectionQuickAssessment? qualityAssessment;
  final InspectionQuickAssessment? environmentalAssessment;
  final InspectionScheduleAssessment? scheduleAssessment;

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
    recommendationNotes:
        (_map(json['technicalRecommendation'])['conditions'] ??
                _map(json['technicalRecommendation'])['notes'] ??
                '')
            .toString(),
    technicalConclusion: (json['technicalConclusion'] ?? '').toString(),
    workFronts: (json['workFronts'] as List? ?? const [])
        .map((item) => InspectionWorkFront.fromJson(_map(item)))
        .toList(),
    incidents: (json['incidents'] as List? ?? const [])
        .map((item) => InspectionIncident.fromJson(_map(item)))
        .toList(),
    qualityObservations: (json['qualityObservations'] ?? '').toString(),
    environmentalObservations: (json['environmentalObservations'] ?? '')
        .toString(),
    qualityAssessment: json['qualityAssessment'] == null
        ? null
        : InspectionQuickAssessment.fromJson(_map(json['qualityAssessment'])),
    environmentalAssessment: json['environmentalAssessment'] == null
        ? null
        : InspectionQuickAssessment.fromJson(
            _map(json['environmentalAssessment']),
          ),
    scheduleAssessment: json['scheduleAssessment'] == null
        ? null
        : InspectionScheduleAssessment.fromJson(
            _map(json['scheduleAssessment']),
          ),
    methodology: json['methodology'] == null
        ? null
        : InspectionMethodology.fromJson(_map(json['methodology'])),
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
    this.workFrontKey = '',
    this.incidentId,
    this.category = 'general',
  });
  final String id;
  final String inspectionId;
  final String projectId;
  final String? unitId;
  final String commonAreaKey;
  final String caption;
  final String filePath;
  final DateTime? createdAt;
  final String workFrontKey;
  final String? incidentId;
  final String category;

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
        workFrontKey: (json['workFrontKey'] ?? '').toString(),
        incidentId: json['incidentId']?.toString(),
        category: (json['category'] ?? 'general').toString(),
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
