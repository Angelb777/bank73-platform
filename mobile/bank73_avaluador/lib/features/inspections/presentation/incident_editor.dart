import 'package:flutter/material.dart';

import '../../../core/models/models.dart';

Future<InspectionIncident?> showContextIncidentEditor(
  BuildContext context, {
  required String scopeType,
  required String scopeId,
  required String scopeLabel,
  String workFrontKey = '',
}) async {
  var type = 'other';
  var severity = 'medium';
  final title = TextEditingController();
  final description = TextEditingController();
  final action = TextEditingController();
  final accepted = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
        contentPadding: const EdgeInsets.fromLTRB(24, 12, 24, 8),
        actionsPadding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
        constraints: const BoxConstraints(maxWidth: 720),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        title: Row(
          children: [
            const CircleAvatar(child: Icon(Icons.report_problem_outlined)),
            const SizedBox(width: 12),
            Expanded(child: Text('Incidencia en $scopeLabel')),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Quedará vinculada directamente a $scopeLabel.',
                style: TextStyle(color: Theme.of(context).colorScheme.outline),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: type,
                decoration: const InputDecoration(labelText: 'Tipo'),
                items:
                    const {
                          'change': 'Cambio de obra',
                          'delay': 'Retraso',
                          'defect': 'Defecto',
                          'quality': 'Calidad',
                          'environment': 'Medioambiente',
                          'risk': 'Riesgo',
                          'other': 'Otro',
                        }.entries
                        .map(
                          (entry) => DropdownMenuItem(
                            value: entry.key,
                            child: Text(entry.value),
                          ),
                        )
                        .toList(),
                onChanged: (value) =>
                    setDialogState(() => type = value ?? type),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: title,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'Título'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: description,
                minLines: 2,
                maxLines: 5,
                decoration: const InputDecoration(labelText: 'Qué se observó'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: severity,
                decoration: const InputDecoration(labelText: 'Severidad'),
                items:
                    const {
                          'low': 'Baja',
                          'medium': 'Media',
                          'high': 'Alta',
                          'critical': 'Crítica',
                        }.entries
                        .map(
                          (entry) => DropdownMenuItem(
                            value: entry.key,
                            child: Text(entry.value),
                          ),
                        )
                        .toList(),
                onChanged: (value) =>
                    setDialogState(() => severity = value ?? severity),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: action,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Acción o seguimiento requerido',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancelar'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.pop(dialogContext, true),
            icon: const Icon(Icons.check_rounded),
            label: const Text('Guardar incidencia'),
          ),
        ],
      ),
    ),
  );
  final result = accepted == true && title.text.trim().isNotEmpty
      ? InspectionIncident(
          type: type,
          severity: severity,
          status: 'open',
          title: title.text.trim(),
          description: description.text.trim(),
          location: scopeLabel,
          scopeType: scopeType,
          scopeId: scopeId,
          workFrontKey: workFrontKey,
          actionRequired: action.text.trim(),
          observedAt: DateTime.now(),
        )
      : null;
  title.dispose();
  description.dispose();
  action.dispose();
  return result;
}
