import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

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
  const _ReportBundle(this.inspection, this.units, this.evidence);
  final Inspection inspection;
  final List<InspectionUnit> units;
  final List<InspectionEvidence> evidence;
}

class _InspectionReportScreenState
    extends ConsumerState<InspectionReportScreen> {
  late Future<_ReportBundle> _future;
  final _signatureKey = GlobalKey();
  final _points = <Offset?>[];
  final _signer = TextEditingController();
  final _technicalConclusion = TextEditingController();
  final _recommendationConditions = TextEditingController();
  TechnicalVerdict _technicalVerdict = TechnicalVerdict.notAssessed;
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
    super.dispose();
  }

  Future<_ReportBundle> _load() async {
    final repository = ref.read(inspectionRepositoryProvider);
    final results = await Future.wait([
      repository.inspection(widget.inspectionId),
      repository.inspectedUnits(widget.inspectionId),
      repository.evidence(widget.inspectionId),
    ]);
    final inspection = results[0] as Inspection;
    if (mounted && _technicalConclusion.text.isEmpty) {
      _technicalVerdict = inspection.technicalVerdict;
      _technicalConclusion.text = inspection.technicalConclusion;
      _recommendationConditions.text = inspection.recommendationNotes;
    }
    return _ReportBundle(
      inspection,
      results[1] as List<InspectionUnit>,
      results[2] as List<InspectionEvidence>,
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

  Future<void> _finalize(Inspection inspection) async {
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
      await ref
          .read(inspectionRepositoryProvider)
          .finalize(
            inspectionId: widget.inspectionId,
            version: inspection.version,
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
    setState(() => _previewing = true);
    try {
      final updated = await ref
          .read(inspectionRepositoryProvider)
          .saveVisit(
            inspectionId: inspection.id,
            version: inspection.version,
            technicalConclusion: _technicalConclusion.text.trim(),
            technicalVerdict: _technicalVerdict,
            recommendationConditions: _recommendationConditions.text.trim(),
          );
      if (!mounted) return;
      await Printing.layoutPdf(
        name: 'borrador-informe-bank73.pdf',
        onLayout: (_) async => Uint8List.fromList(
          await ref
              .read(inspectionRepositoryProvider)
              .reportPreviewBytes(updated.id),
        ),
      );
      if (mounted) _reload();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

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
          return PdfPreview(
            build: (_) async => Uint8List.fromList(
              await ref
                  .read(inspectionRepositoryProvider)
                  .reportBytes(widget.inspectionId),
            ),
            pdfFileName: '${bundle.inspection.reportNumber}.pdf',
            canChangeOrientation: false,
            canChangePageFormat: false,
          );
        }
        final unitAverage = bundle.units.isEmpty
            ? 0.0
            : bundle.units.fold<double>(
                    0,
                    (sum, unit) => sum + unit.progressPercent,
                  ) /
                  bundle.units.length;
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
            OutlinedButton.icon(
              onPressed: _previewing ? null : () => _preview(bundle.inspection),
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: Text(
                _previewing
                    ? 'Preparando informe…'
                    : 'Guardar conclusión y ver PDF completo',
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
