import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../app/theme/app_theme.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/models/models.dart';
import '../data/inspection_repository.dart';

class EvidenceSection extends ConsumerStatefulWidget {
  const EvidenceSection({
    super.key,
    required this.inspectionId,
    this.unitId,
    this.commonAreaKey,
    this.workFrontKey,
    this.incidentId,
    this.category = 'general',
    this.editable = true,
    this.embedded = false,
    this.title = 'Evidencia fotográfica',
  });

  final String inspectionId;
  final String? unitId;
  final String? commonAreaKey;
  final String? workFrontKey;
  final String? incidentId;
  final String category;
  final bool editable;
  final bool embedded;
  final String title;

  @override
  ConsumerState<EvidenceSection> createState() => _EvidenceSectionState();
}

class _EvidenceSectionState extends ConsumerState<EvidenceSection> {
  late Future<List<InspectionEvidence>> _future;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<InspectionEvidence>> _load() => ref
      .read(inspectionRepositoryProvider)
      .evidence(
        widget.inspectionId,
        unitId: widget.unitId,
        commonAreaKey: widget.commonAreaKey,
        workFrontKey: widget.workFrontKey,
        incidentId: widget.incidentId,
      );

  void _reload() => setState(() => _future = _load());

  Future<void> _pick(ImageSource source) async {
    final image = await ImagePicker().pickImage(
      source: source,
      imageQuality: 82,
      maxWidth: 2000,
    );
    if (image == null || !mounted) return;
    final caption = await _caption();
    if (caption == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      await ref
          .read(inspectionRepositoryProvider)
          .uploadEvidence(
            inspectionId: widget.inspectionId,
            filePath: image.path,
            unitId: widget.unitId,
            commonAreaKey: widget.commonAreaKey,
            workFrontKey: widget.workFrontKey,
            incidentId: widget.incidentId,
            category: widget.category,
            caption: caption,
          );
      if (mounted) {
        _reload();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Fotografía guardada.'),
            action: SnackBarAction(
              label: 'Otra foto',
              onPressed: () => _pick(ImageSource.camera),
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<String?> _caption() async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Descripción de la foto'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 250,
          decoration: const InputDecoration(
            hintText: 'Ej. Acabados de fachada norte',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Subir'),
          ),
        ],
      ),
    );
    Future<void>.delayed(kThemeAnimationDuration, controller.dispose);
    return result;
  }

  void _showSource() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Tomar fotografía'),
              onTap: () {
                Navigator.pop(sheetContext);
                _pick(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Elegir de la galería'),
              onTap: () {
                Navigator.pop(sheetContext);
                _pick(ImageSource.gallery);
              },
            ),
          ],
        ),
      ),
    ),
  );

  Future<void> _delete(InspectionEvidence item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Eliminar fotografía'),
        content: const Text('Esta evidencia se eliminará del borrador.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref
          .read(inspectionRepositoryProvider)
          .deleteEvidence(widget.inspectionId, item.id);
      if (mounted) _reload();
    } catch (error) {
      if (mounted) await presentApiError(context, ref, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.title,
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
              if (widget.editable)
                IconButton.filledTonal(
                  tooltip: 'Añadir fotografía',
                  onPressed: _uploading ? null : _showSource,
                  icon: _uploading
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.add_a_photo_outlined),
                ),
            ],
          ),
          const SizedBox(height: 10),
          FutureBuilder<List<InspectionEvidence>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LinearProgressIndicator();
              }
              if (snapshot.hasError) {
                return TextButton.icon(
                  onPressed: _reload,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Reintentar fotografías'),
                );
              }
              final items = snapshot.data ?? const [];
              if (items.isEmpty) {
                return const Text(
                  'Todavía no hay fotografías.',
                  style: TextStyle(color: Bank73Colors.muted),
                );
              }
              return GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                ),
                itemCount: items.length,
                itemBuilder: (context, index) => _EvidenceTile(
                  item: items[index],
                  bytes: ref
                      .read(inspectionRepositoryProvider)
                      .evidenceBytes(items[index]),
                  onDelete: widget.editable
                      ? () => _delete(items[index])
                      : null,
                ),
              );
            },
          ),
        ],
      ),
    );
    return widget.embedded ? content : Card(child: content);
  }
}

class _EvidenceTile extends StatelessWidget {
  const _EvidenceTile({
    required this.item,
    required this.bytes,
    required this.onDelete,
  });
  final InspectionEvidence item;
  final Future<List<int>> bytes;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) => FutureBuilder<List<int>>(
    future: bytes,
    builder: (context, snapshot) {
      final data = snapshot.hasData ? Uint8List.fromList(snapshot.data!) : null;
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(
              color: Bank73Colors.background,
              child: data == null
                  ? const Center(child: CircularProgressIndicator())
                  : Image.memory(data, fit: BoxFit.cover),
            ),
            if (onDelete != null)
              Positioned(
                right: 4,
                top: 4,
                child: IconButton.filled(
                  visualDensity: VisualDensity.compact,
                  onPressed: onDelete,
                  icon: const Icon(Icons.delete_outline, size: 18),
                ),
              ),
          ],
        ),
      );
    },
  );
}
