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
        title: Text('Incidencia en $scopeLabel'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: type,
                decoration: const InputDecoration(labelText: 'Tipo'),
                items: const {
                  'change': 'Cambio de obra',
                  'delay': 'Retraso',
                  'defect': 'Defecto',
                  'quality': 'Calidad',
                  'environment': 'Medioambiente',
                  'risk': 'Riesgo',
                  'other': 'Otro',
                }.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
                onChanged: (value) => setDialogState(() => type = value ?? type),
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
                items: const {
                  'low': 'Baja',
                  'medium': 'Media',
                  'high': 'Alta',
                  'critical': 'Crítica',
                }.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
                onChanged: (value) => setDialogState(() => severity = value ?? severity),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: action,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(labelText: 'Acción o seguimiento requerido'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Guardar')),
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
