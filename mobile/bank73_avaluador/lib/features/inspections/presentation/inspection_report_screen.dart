import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../auth/application/auth_controller.dart';
import '../data/inspection_repository.dart';

class InspectionReportScreen extends ConsumerStatefulWidget {
  const InspectionReportScreen({super.key, required this.inspectionId});

  final String inspectionId;

  @override
  ConsumerState<InspectionReportScreen> createState() =>
      _InspectionReportScreenState();
}

class _ReportBundle {
  const _ReportBundle(this.inspection, this.units, this.evidence, this.pack);
  final Inspection inspection;
  final List<InspectionUnit> units;
  final List<InspectionEvidence> evidence;
  final InspectionPack pack;
}

class _InspectionReportScreenState
    extends ConsumerState<InspectionReportScreen> {
  late Future<_ReportBundle> _future;
  final _signatureKey = GlobalKey();
  final _points = <Offset?>[];
  final _signer = TextEditingController();
  final _technicalConclusion = TextEditingController();
  final _recommendationConditions = TextEditingController();
  final _projectDescription = TextEditingController();
  final _plansObservations = TextEditingController();
  final _workChangesDescription = TextEditingController();
  final _workChangesBudgetImpact = TextEditingController();
  final _workChangesScheduleImpact = TextEditingController();
  final _workChangesObservations = TextEditingController();
  final _budgetAdjustmentsExplanation = TextEditingController();
  final _contractsObservations = TextEditingController();
  final _qualityObservations = TextEditingController();
  final _environmentalObservations = TextEditingController();
  TechnicalVerdict _technicalVerdict = TechnicalVerdict.notAssessed;
  String _plansStatus = 'not_verifiable';
  bool? _hasWorkChanges;
  bool? _hasBudgetAdjustments;
  String _qualityStatus = 'not_assessed';
  String _environmentalStatus = 'not_assessed';
  bool _formInitialized = false;
  bool _finalizing = false;
  bool _previewing = false;
  int? _signaturePointer;

  void _endSignature(int pointer) {
    if (_signaturePointer != pointer) return;
    setState(() {
      _points.add(null);
      _signaturePointer = null;
    });
  }

  @override
  void initState() {
    super.initState();
    _signer.text = ref.read(authControllerProvider).user?.name ?? '';
    _future = _load();
  }

  @override
  void dispose() {
    _signer.dispose();
    _technicalConclusion.dispose();
    _recommendationConditions.dispose();
    _projectDescription.dispose();
    _plansObservations.dispose();
    _workChangesDescription.dispose();
    _workChangesBudgetImpact.dispose();
    _workChangesScheduleImpact.dispose();
    _workChangesObservations.dispose();
    _budgetAdjustmentsExplanation.dispose();
    _contractsObservations.dispose();
    _qualityObservations.dispose();
    _environmentalObservations.dispose();
    super.dispose();
  }

  Future<_ReportBundle> _load() async {
    final repository = ref.read(inspectionRepositoryProvider);
    final results = await Future.wait([
      repository.inspection(widget.inspectionId),
      repository.inspectedUnits(widget.inspectionId),
      repository.evidence(widget.inspectionId),
      repository.inspectionPack(widget.inspectionId),
    ]);
    final inspection = results[0] as Inspection;
    final pack = results[3] as InspectionPack;
    if (mounted && !_formInitialized) {
      _formInitialized = true;
      _technicalVerdict = inspection.technicalVerdict;
      _technicalConclusion.text = inspection.technicalConclusion;
      _recommendationConditions.text = inspection.recommendationNotes;
      final details = inspection.reportDetails;
      final current = Map<String, dynamic>.from(
        pack.raw['current'] as Map? ?? const {},
      );
      final visit = Map<String, dynamic>.from(
        current['visit'] as Map? ?? const {},
      );
      final suggestedDetails = Map<String, dynamic>.from(
        visit['reportDetails'] as Map? ?? const {},
      );
      _projectDescription.text =
          details?.projectDescription ??
          suggestedDetails['projectDescription']?.toString() ??
          pack.project.description;
      _plansStatus = details?.plansStatus ?? 'not_verifiable';
      _plansObservations.text = details?.plansObservations ?? '';
      _hasWorkChanges = details?.hasWorkChanges;
      _workChangesDescription.text = details?.workChangesDescription ?? '';
      _workChangesBudgetImpact.text = details?.workChangesBudgetImpact ?? '';
      _workChangesScheduleImpact.text =
          details?.workChangesScheduleImpact ?? '';
      _workChangesObservations.text = details?.workChangesObservations ?? '';
      _hasBudgetAdjustments = details?.hasBudgetAdjustments;
      _budgetAdjustmentsExplanation.text =
          details?.budgetAdjustmentsExplanation ?? '';
      _contractsObservations.text = details?.contractsObservations ?? '';
      final storedQualityStatus =
          inspection.qualityAssessment?.status ?? 'not_assessed';
      // Older inspections could store "non_conforming". The new quick review
      // intentionally has three choices, so preserve its meaning as an item
      // that requires observations instead of feeding an invalid dropdown value.
      _qualityStatus = storedQualityStatus == 'non_conforming'
          ? 'observations_required'
          : storedQualityStatus;
      _qualityObservations.text =
          inspection.qualityAssessment?.observations ??
          inspection.qualityObservations;
      _environmentalStatus =
          inspection.environmentalAssessment?.status ?? 'not_assessed';
      _environmentalObservations.text =
          inspection.environmentalAssessment?.observations ??
          inspection.environmentalObservations;
    }
    return _ReportBundle(
      inspection,
      results[1] as List<InspectionUnit>,
      results[2] as List<InspectionEvidence>,
      pack,
    );
  }

  void _reload() => setState(() => _future = _load());

  Future<String?> _signatureData() async {
    if (_points.whereType<Offset>().length < 2) return null;
    final boundary =
        _signatureKey.currentContext?.findRenderObject()
            as RenderRepaintBoundary?;
    final image = await boundary?.toImage(pixelRatio: 2.5);
    final bytes = await image?.toByteData(format: ui.ImageByteFormat.png);
    if (bytes == null) return null;
    return 'data:image/png;base64,${base64Encode(bytes.buffer.asUint8List())}';
  }

  InspectionReportDetails _reportDetails() => InspectionReportDetails(
    projectDescription: _projectDescription.text.trim(),
    plansStatus: _plansStatus,
    plansObservations: _plansObservations.text.trim(),
    hasWorkChanges: _hasWorkChanges,
    workChangesDescription: _workChangesDescription.text.trim(),
    workChangesBudgetImpact: _workChangesBudgetImpact.text.trim(),
    workChangesScheduleImpact: _workChangesScheduleImpact.text.trim(),
    workChangesObservations: _workChangesObservations.text.trim(),
    hasBudgetAdjustments: _hasBudgetAdjustments,
    budgetAdjustmentsExplanation: _budgetAdjustmentsExplanation.text.trim(),
    contractsObservations: _contractsObservations.text.trim(),
  );

  bool _validateAdditionalDetails() {
    if (_hasWorkChanges == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Indica si se han realizado cambios en la obra.'),
        ),
      );
      return false;
    }
    if (_hasWorkChanges == true &&
        _workChangesDescription.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Describe los cambios realizados.')),
      );
      return false;
    }
    if (_hasBudgetAdjustments == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Indica si hubo ajustes en el presupuesto.'),
        ),
      );
      return false;
    }
    if (_hasBudgetAdjustments == true &&
        _budgetAdjustmentsExplanation.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Explica el ajuste del presupuesto.')),
      );
      return false;
    }
    return true;
  }

  Future<Inspection> _saveReportInputs(Inspection inspection) => ref
      .read(inspectionRepositoryProvider)
      .saveVisit(
        inspectionId: inspection.id,
        version: inspection.version,
        reportDetails: _reportDetails(),
        qualityAssessment: InspectionQuickAssessment(
          status: _qualityStatus,
          checks: inspection.qualityAssessment?.checks ?? const [],
          observations: _qualityObservations.text.trim(),
        ),
        environmentalAssessment: InspectionQuickAssessment(
          status: _environmentalStatus,
          checks: inspection.environmentalAssessment?.checks ?? const [],
          observations: _environmentalObservations.text.trim(),
        ),
        technicalConclusion: _technicalConclusion.text.trim(),
        technicalVerdict: _technicalVerdict,
        recommendationConditions: _recommendationConditions.text.trim(),
      );

  Future<void> _shareWord(Inspection inspection) async {
    if (!inspection.isFinalized && !_validateAdditionalDetails()) return;
    setState(() => _previewing = true);
    try {
      final effective = inspection.isFinalized
          ? inspection
          : await _saveReportInputs(inspection);
      final repository = ref.read(inspectionRepositoryProvider);
      final bytes = inspection.isFinalized
          ? await repository.reportWordBytes(effective.id)
          : await repository.reportWordPreviewBytes(effective.id);
      final directory = await getTemporaryDirectory();
      final filename = inspection.isFinalized
          ? '${inspection.reportNumber}.docx'
          : 'borrador-informe-bank73.docx';
      final file = File('${directory.path}${Platform.pathSeparator}$filename');
      await file.writeAsBytes(bytes, flush: true);
      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile(
              file.path,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ),
          ],
          subject: 'Informe de inspección',
        ),
      );
      if (mounted && !inspection.isFinalized) _reload();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  Future<void> _shareFinalPdf(Inspection inspection) async {
    setState(() => _previewing = true);
    try {
      await Printing.sharePdf(
        bytes: Uint8List.fromList(
          await ref
              .read(inspectionRepositoryProvider)
              .reportBytes(inspection.id),
        ),
        filename: '${inspection.reportNumber}.pdf',
      );
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  Future<void> _finalize(Inspection inspection) async {
    if (!_validateAdditionalDetails()) return;
    if (_signer.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Indica el nombre del firmante.')),
      );
      return;
    }
    if (_technicalConclusion.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Escribe la conclusión técnica de la visita.'),
        ),
      );
      return;
    }
    if (_technicalVerdict == TechnicalVerdict.conditional &&
        _recommendationConditions.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Indica las condiciones de la recomendación.'),
        ),
      );
      return;
    }
    final signature = await _signatureData();
    if (!mounted) return;
    if (signature == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Firma el informe antes de finalizar.')),
      );
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Finalizar y firmar'),
        content: const Text(
          'El informe quedará cerrado y ya no se podrán modificar avances, observaciones ni fotografías.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Revisar de nuevo'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Finalizar informe'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _finalizing = true);
    try {
      final updated = await _saveReportInputs(inspection);
      await ref
          .read(inspectionRepositoryProvider)
          .finalize(
            inspectionId: widget.inspectionId,
            version: updated.version,
            signerName: _signer.text.trim(),
            signatureImage: signature,
            technicalVerdict: _technicalVerdict,
            technicalConclusion: _technicalConclusion.text.trim(),
            recommendationConditions: _recommendationConditions.text.trim(),
          );
      if (mounted) _reload();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _finalizing = false);
    }
  }

  Future<void> _preview(Inspection inspection) async {
    if (!_validateAdditionalDetails()) return;
    setState(() => _previewing = true);
    try {
      final updated = await _saveReportInputs(inspection);
      if (!mounted) return;
      await Printing.sharePdf(
        bytes: Uint8List.fromList(
          await ref
              .read(inspectionRepositoryProvider)
              .reportPreviewBytes(updated.id),
        ),
        filename: 'borrador-informe-bank73.pdf',
      );
      if (mounted) _reload();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  Widget _reportSection({
    required IconData icon,
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) => Card(
    child: ExpansionTile(
      leading: Icon(icon, color: Bank73Colors.strongBlue),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle),
      childrenPadding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
      children: children,
    ),
  );

  Widget _yesNoChoice({
    required String label,
    required bool? value,
    required ValueChanged<bool?> onChanged,
  }) => DropdownButtonFormField<String>(
    initialValue: value == null ? 'unknown' : (value ? 'yes' : 'no'),
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: const [
      DropdownMenuItem(value: 'unknown', child: Text('No verificable')),
      DropdownMenuItem(value: 'yes', child: Text('Sí')),
      DropdownMenuItem(value: 'no', child: Text('No')),
    ],
    onChanged: _finalizing
        ? null
        : (choice) => onChanged(choice == 'unknown' ? null : choice == 'yes'),
  );

  Widget _assessmentChoice({
    required String label,
    required String value,
    required bool environmental,
    required ValueChanged<String?> onChanged,
  }) => DropdownButtonFormField<String>(
    initialValue: value,
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: [
      DropdownMenuItem(
        value: 'conforming',
        child: Text(environmental ? 'Cumple' : 'Conforme'),
      ),
      DropdownMenuItem(
        value: environmental ? 'non_conforming' : 'observations_required',
        child: Text(environmental ? 'No cumple' : 'Con observaciones'),
      ),
      const DropdownMenuItem(
        value: 'not_assessed',
        child: Text('No verificable'),
      ),
    ],
    onChanged: _finalizing ? null : onChanged,
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: const Bank73AppBar(title: 'Informe de inspección'),
    body: FutureBuilder<_ReportBundle>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const LoadingView();
        }
        if (snapshot.hasError || !snapshot.hasData) {
          return ErrorView(onRetry: _reload);
        }
        final bundle = snapshot.data!;
        if (bundle.inspection.isFinalized) {
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _previewing
                            ? null
                            : () => _shareFinalPdf(bundle.inspection),
                        icon: const Icon(Icons.picture_as_pdf_outlined),
                        label: const Text('Descargar PDF'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _previewing
                            ? null
                            : () => _shareWord(bundle.inspection),
                        icon: const Icon(Icons.description_outlined),
                        label: const Text('Descargar Word'),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: PdfPreview(
                  build: (_) async => Uint8List.fromList(
                    await ref
                        .read(inspectionRepositoryProvider)
                        .reportBytes(widget.inspectionId),
                  ),
                  pdfFileName: '${bundle.inspection.reportNumber}.pdf',
                  canChangeOrientation: false,
                  canChangePageFormat: false,
                ),
              ),
            ],
          );
        }
        final unitAverage = bundle.units.isEmpty
            ? 0.0
            : bundle.units.fold<double>(
                    0,
                    (sum, unit) => sum + unit.progressPercent,
                  ) /
                  bundle.units.length;
        final compliance = Map<String, dynamic>.from(
          bundle.pack.raw['compliance'] as Map? ?? const {},
        );
        List<Map<String, dynamic>> contextItems(String key) =>
            (compliance[key] as List? ?? const [])
                .whereType<Map>()
                .map((item) => Map<String, dynamic>.from(item))
                .toList();
        final financingConditions = contextItems('financingConditions');
        final planRequirements = contextItems('planRequirements');
        final environmentalRequirements = contextItems(
          'environmentalRequirements',
        );
        final constructionContracts = contextItems('constructionContracts');
        final policies = contextItems('policies');
        final bonds = contextItems('bonds');
        final programSummary = Map<String, dynamic>.from(
          bundle.pack.raw['programSummary'] as Map? ?? const {},
        );
        String contextLine(Map<String, dynamic> item, List<String> keys) => keys
            .map((key) => item[key]?.toString().trim() ?? '')
            .where((value) => value.isNotEmpty)
            .join(' · ');
        return ListView(
          physics: _signaturePointer == null
              ? null
              : const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            const StatusPill('Vista previa · borrador'),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _Metric(
                    label: 'Avance general',
                    value: formatPercent(
                      bundle.inspection.projectProgressPercent,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _Metric(
                    label: 'Promedio unidades',
                    value: formatPercent(unitAverage),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _Metric(
                    label: 'Unidades revisadas',
                    value: '${bundle.units.length}',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _Metric(
                    label: 'Fotografías',
                    value: '${bundle.evidence.length}',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _reportSection(
              icon: Icons.account_balance_outlined,
              title: 'Información precargada de Bank73',
              subtitle: 'Financiación, programa, contratos, pólizas y fianzas',
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '${financingConditions.length} condiciones de financiamiento · '
                    '${constructionContracts.length} contrato(s) de obra · '
                    '${policies.length} póliza(s) · ${bonds.length} fianza(s)',
                    style: const TextStyle(color: Bank73Colors.muted),
                  ),
                ),
                if (financingConditions.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Condiciones de financiamiento',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  ...financingConditions
                      .take(6)
                      .map(
                        (item) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.checklist_rounded),
                          title: Text((item['title'] ?? '').toString()),
                          subtitle: Text(
                            [item['phaseName'], item['status']]
                                .where(
                                  (value) =>
                                      value != null && '$value'.isNotEmpty,
                                )
                                .join(' · '),
                          ),
                        ),
                      ),
                ],
                if (programSummary.isNotEmpty) ...[
                  const Divider(height: 24),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Programa: ${contextLine(programSummary, ['startDate', 'endDate'])}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  if (programSummary['durationMonths'] != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Duración estimada: ${programSummary['durationMonths']} meses',
                        style: const TextStyle(color: Bank73Colors.muted),
                      ),
                    ),
                ],
                if (planRequirements.isNotEmpty) ...[
                  const Divider(height: 24),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Planos conocidos por Bank73',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  ...planRequirements.map(
                    (item) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.architecture_outlined),
                      title: Text((item['title'] ?? '').toString()),
                      subtitle: Text(
                        contextLine(item, [
                          'phaseName',
                          'status',
                          'information',
                        ]),
                      ),
                    ),
                  ),
                ],
                if (constructionContracts.isNotEmpty) ...[
                  const Divider(height: 24),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Contratos de obra / construcción',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  ...constructionContracts.map(
                    (item) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.handshake_outlined),
                      title: Text((item['title'] ?? '').toString()),
                      subtitle: Text(
                        contextLine(item, [
                          'phaseName',
                          'status',
                          'information',
                        ]),
                      ),
                    ),
                  ),
                ],
                if (policies.isNotEmpty) ...[
                  const Divider(height: 24),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Pólizas y seguros',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  ...policies.map(
                    (item) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.policy_outlined),
                      title: Text(contextLine(item, ['type', 'policyNumber'])),
                      subtitle: Text(
                        contextLine(item, ['insurer', 'bank', 'expiryDate']),
                      ),
                    ),
                  ),
                ],
                if (bonds.isNotEmpty) ...[
                  const Divider(height: 24),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Fianzas',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  ...bonds.map(
                    (item) => ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.verified_user_outlined),
                      title: Text((item['title'] ?? '').toString()),
                      subtitle: Text(
                        contextLine(item, ['phaseName', 'status']),
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
            _reportSection(
              icon: Icons.apartment_outlined,
              title: 'Descripción general de la obra',
              subtitle: 'Precargada y editable solo para este informe',
              children: [
                TextField(
                  controller: _projectDescription,
                  readOnly: _finalizing,
                  minLines: 4,
                  maxLines: 10,
                  maxLength: 10000,
                  decoration: const InputDecoration(
                    labelText: 'Descripción certificada de la obra',
                    alignLabelWithHint: true,
                  ),
                ),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'No modifica la descripción del proyecto en Bank73.',
                    style: TextStyle(color: Bank73Colors.muted, fontSize: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _reportSection(
              icon: Icons.architecture_outlined,
              title: 'Planos aprobados',
              subtitle: planRequirements.isEmpty
                  ? 'Sin requisitos de planos identificados en Bank73'
                  : '${planRequirements.length} referencia(s) disponible(s)',
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _plansStatus,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: '¿El proyecto cuenta con los planos aprobados correspondientes?',
                  ),
                  items: const [
                    DropdownMenuItem(value: 'yes', child: Text('Sí')),
                    DropdownMenuItem(value: 'no', child: Text('No')),
                    DropdownMenuItem(
                      value: 'not_verifiable',
                      child: Text('No verificable'),
                    ),
                  ],
                  onChanged: _finalizing
                      ? null
                      : (value) => setState(
                          () => _plansStatus = value ?? 'not_verifiable',
                        ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _plansObservations,
                  readOnly: _finalizing,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Observaciones sobre planos (opcional)',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _reportSection(
              icon: Icons.change_circle_outlined,
              title: 'Cambios en la obra',
              subtitle: 'Comparación con planos, alcance o proyecto aprobado',
              children: [
                _yesNoChoice(
                  label: '¿Se han realizado cambios?',
                  value: _hasWorkChanges,
                  onChanged: (value) => setState(() => _hasWorkChanges = value),
                ),
                if (_hasWorkChanges == true) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _workChangesDescription,
                    minLines: 2,
                    maxLines: 6,
                    decoration: const InputDecoration(
                      labelText: 'Descripción del cambio',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _workChangesBudgetImpact,
                    minLines: 1,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      labelText: 'Posible impacto en presupuesto',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _workChangesScheduleImpact,
                    minLines: 1,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      labelText: 'Posible impacto en plazo',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _workChangesObservations,
                    minLines: 2,
                    maxLines: 5,
                    decoration: const InputDecoration(
                      labelText: 'Observaciones adicionales',
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
            _reportSection(
              icon: Icons.price_change_outlined,
              title: 'Ajustes en el presupuesto',
              subtitle: 'Sin volver a introducir presupuesto ni usos/fuentes',
              children: [
                _yesNoChoice(
                  label: '¿El promotor ha realizado ajustes desde la última inspección?',
                  value: _hasBudgetAdjustments,
                  onChanged: (value) =>
                      setState(() => _hasBudgetAdjustments = value),
                ),
                if (_hasBudgetAdjustments == true) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _budgetAdjustmentsExplanation,
                    minLines: 2,
                    maxLines: 6,
                    decoration: const InputDecoration(
                      labelText: 'Explicación del ajuste',
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
            _reportSection(
              icon: Icons.handshake_outlined,
              title: 'Contratos de obra',
              subtitle: constructionContracts.isEmpty
                  ? 'Sin contratos de construcción identificados'
                  : '${constructionContracts.length} requisito(s) identificado(s)',
              children: [
                TextField(
                  controller: _contractsObservations,
                  minLines: 2,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: 'Observaciones sobre contratos',
                    hintText: 'Ej.: el promotor construye directamente o existe una particularidad contractual.',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _reportSection(
              icon: Icons.verified_outlined,
              title: 'Control de calidad',
              subtitle: 'Valoración rápida y observaciones',
              children: [
                _assessmentChoice(
                  label: 'Valoración de calidad',
                  value: _qualityStatus,
                  environmental: false,
                  onChanged: (value) =>
                      setState(() => _qualityStatus = value ?? 'not_assessed'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _qualityObservations,
                  minLines: 2,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: 'Observaciones de calidad',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _reportSection(
              icon: Icons.eco_outlined,
              title: 'Mitigación de riesgo ambiental',
              subtitle: environmentalRequirements.isEmpty
                  ? 'Valoración ambiental de la visita'
                  : '${environmentalRequirements.length} requisito(s) ambiental(es) en Bank73',
              children: [
                _assessmentChoice(
                  label: 'Cumplimiento ambiental',
                  value: _environmentalStatus,
                  environmental: true,
                  onChanged: (value) => setState(
                    () => _environmentalStatus = value ?? 'not_assessed',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _environmentalObservations,
                  minLines: 2,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: 'Observación ambiental',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Zonas comunes e infraestructura',
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 12),
                    ...bundle.inspection.commonAreas.map(
                      (area) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            Expanded(child: Text(area.name)),
                            Text(
                              formatPercent(area.progressPercent),
                              style: const TextStyle(
                                color: Bank73Colors.strongBlue,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Conclusión técnica',
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _technicalConclusion,
                      readOnly: _finalizing,
                      minLines: 3,
                      maxLines: 7,
                      maxLength: 10000,
                      decoration: const InputDecoration(
                        labelText: 'Resultado técnico de la visita',
                        hintText: 'Resume avance, estado de la obra y hallazgos principales.',
                        alignLabelWithHint: true,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Recomendación técnica del avaluador',
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Tu recomendación orienta al banco. La decisión y autorización del desembolso corresponden al banco.',
                      style: TextStyle(color: Bank73Colors.muted),
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<TechnicalVerdict>(
                      initialValue: _technicalVerdict,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Recomendación de desembolso',
                      ),
                      items: TechnicalVerdict.values
                          .map(
                            (verdict) => DropdownMenuItem(
                              value: verdict,
                              child: Text(verdict.label),
                            ),
                          )
                          .toList(),
                      onChanged: _finalizing
                          ? null
                          : (value) => setState(
                              () => _technicalVerdict =
                                  value ?? TechnicalVerdict.notAssessed,
                            ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _recommendationConditions,
                      readOnly: _finalizing,
                      minLines: 3,
                      maxLines: 6,
                      maxLength: 5000,
                      decoration: InputDecoration(
                        labelText:
                            _technicalVerdict == TechnicalVerdict.notAssessed
                            ? 'Comentario de la recomendación (opcional)'
                            : _technicalVerdict == TechnicalVerdict.conditional
                            ? 'Condiciones de la recomendación'
                            : 'Justificación de la recomendación (opcional)',
                        alignLabelWithHint: true,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _previewing
                        ? null
                        : () => _preview(bundle.inspection),
                    icon: const Icon(Icons.picture_as_pdf_outlined),
                    label: const Text('Descargar PDF'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _previewing
                        ? null
                        : () => _shareWord(bundle.inspection),
                    icon: const Icon(Icons.description_outlined),
                    label: const Text('Descargar Word'),
                  ),
                ),
              ],
            ),
            if (_previewing) ...[
              const SizedBox(height: 8),
              const LinearProgressIndicator(),
            ],
            const SizedBox(height: 14),
            Card(
              color: Bank73Colors.blue.withValues(alpha: .06),
              child: const Padding(
                padding: EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Certificación',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    SizedBox(height: 8),
                    Text(
                      'Certificamos que este informe es el producto de la inspección de la obra en la fecha indicada, y su elaboración ha sido de manera objetiva de acuerdo al avance de la obra y a la documentación suministrada por el Promotor y verificada por nosotros. Asimismo, certificamos que nuestra escogencia como inspectores y la aceptación de nuestros honorarios no han influido de ninguna manera en la elaboración de este informe, y por lo tanto todos los datos suministrados son correctos y veraces según nuestro más leal saber y entender.',
                      style: TextStyle(height: 1.45),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _signer,
              decoration: const InputDecoration(
                labelText: 'Nombre del avaluador firmante',
                prefixIcon: Icon(Icons.badge_outlined),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Firma',
                            style: TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                        TextButton(
                          onPressed: () => setState(_points.clear),
                          child: const Text('Limpiar'),
                        ),
                      ],
                    ),
                    Container(
                      decoration: BoxDecoration(
                        border: Border.all(color: Bank73Colors.border),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: RepaintBoundary(
                          key: _signatureKey,
                          child: RawGestureDetector(
                            gestures: {
                              EagerGestureRecognizer:
                                  GestureRecognizerFactoryWithHandlers<
                                    EagerGestureRecognizer
                                  >(
                                    EagerGestureRecognizer.new,
                                    (recognizer) {},
                                  ),
                            },
                            child: Listener(
                              behavior: HitTestBehavior.opaque,
                              onPointerDown: (event) => setState(() {
                                _signaturePointer ??= event.pointer;
                                if (_signaturePointer == event.pointer) {
                                  _points.add(null);
                                  _points.add(event.localPosition);
                                }
                              }),
                              onPointerMove: (event) {
                                if (_signaturePointer != event.pointer) return;
                                final box =
                                    _signatureKey.currentContext
                                            ?.findRenderObject()
                                        as RenderBox?;
                                if (box == null) return;
                                final inside = (Offset.zero & box.size)
                                    .contains(event.localPosition);
                                setState(
                                  () => _points.add(
                                    inside ? event.localPosition : null,
                                  ),
                                );
                              },
                              onPointerUp: (event) =>
                                  _endSignature(event.pointer),
                              onPointerCancel: (event) =>
                                  _endSignature(event.pointer),
                              child: CustomPaint(
                                foregroundPainter: _SignaturePainter(_points),
                                child: const ColoredBox(
                                  color: Colors.white,
                                  child: SizedBox(
                                    height: 180,
                                    width: double.infinity,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _finalizing
                  ? null
                  : () => _finalize(bundle.inspection),
              icon: const Icon(Icons.verified_outlined),
              label: Text(
                _finalizing ? 'Finalizando…' : 'Firmar y finalizar informe',
              ),
            ),
            const SizedBox(height: 28),
          ],
        );
      },
    ),
  );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: Bank73Colors.muted)),
          const SizedBox(height: 4),
          Text(
            value,
            style: Theme.of(context).textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    ),
  );
}

class _SignaturePainter extends CustomPainter {
  const _SignaturePainter(this.points);
  final List<Offset?> points;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.clipRect(Offset.zero & size);
    final paint = Paint()
      ..color = Bank73Colors.ink
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 2.4;
    for (var index = 0; index < points.length - 1; index++) {
      final current = points[index];
      final next = points[index + 1];
      if (current != null && next != null)
        canvas.drawLine(current, next, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _SignaturePainter oldDelegate) => true;
}
