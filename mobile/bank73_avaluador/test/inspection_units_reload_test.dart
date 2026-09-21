import 'package:bank73_avaluador/core/providers.dart';
import 'package:bank73_avaluador/features/inspections/presentation/inspection_screen.dart';
import 'package:bank73_avaluador/features/units/presentation/units_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'mobile_contract_test.dart' show FakeTransport;

class VisitTransport extends FakeTransport {
  bool saved = false;
  int loads = 0;

  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (path == '/api/mobile/v1/inspections/visit') {
      loads++;
      return {
        'inspection': {'id': 'visit', 'status': 'draft'},
      };
    }
    if (path == '/api/mobile/v1/projects/project') {
      return {
        'project': {'id': 'project', 'name': 'Proyecto'},
      };
    }
    if (path == '/api/mobile/v1/projects/project/units') {
      return {
        'units': List.generate(
          52,
          (index) => {'id': 'u$index', 'code': 'Unidad $index'},
        ),
      };
    }
    if (path == '/api/mobile/v1/projects/project/commercial-folders') {
      return {'folders': []};
    }
    if (path == '/api/mobile/v1/inspections/visit/units') {
      return {
        'units': [
          if (saved) {'unitId': 'u0', 'progressPercent': 60},
        ],
      };
    }
    throw StateError('Unexpected request: $path');
  }
}

void main() {
  testWidgets(
    'returning from a saved unit restores the expanded list and updated progress',
    (tester) async {
      final transport = VisitTransport();
      final router = GoRouter(
        initialLocation: '/projects/project/inspections/visit',
        routes: [
          GoRoute(
            path: '/projects/:projectId/inspections/:inspectionId',
            builder: (_, _) => const InspectionScreen(
              projectId: 'project',
              inspectionId: 'visit',
            ),
            routes: [
              GoRoute(
                path: 'units/:unitId',
                builder: (context, _) => Scaffold(
                  body: Center(
                    child: FilledButton(
                      onPressed: () {
                        transport.saved = true;
                        context.pop();
                      },
                      child: const Text('Guardar y volver'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiTransportProvider.overrideWithValue(transport)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      final scrollable = find.byType(Scrollable).first;
      final title = find.text('Unidades de la visita');
      await tester.scrollUntilVisible(title, 250, scrollable: scrollable);
      await tester.tap(title);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final unit = find.text('Unidad 0');
      await tester.scrollUntilVisible(unit, 200, scrollable: scrollable);
      await tester.ensureVisible(unit);
      await tester.pumpAndSettle();
      await tester.tap(unit);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Guardar y volver'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(transport.loads, 2);
      expect(find.byType(ErrorWidget), findsNothing);
      expect(find.byType(UnitTile), findsNWidgets(52));
      expect(find.text('1/52 unidades revisadas'), findsOneWidget);
      expect(tester.widget<UnitTile>(find.byType(UnitTile).first).progress, 60);
      await tester.ensureVisible(title);
      await tester.pumpAndSettle();
      await tester.tap(title);
      await tester.pumpAndSettle();
      expect(find.text('Unidad 0'), findsNothing);
      await tester.tap(title);
      await tester.pumpAndSettle();
      expect(find.byType(UnitTile), findsNWidgets(52));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('units are grouped under their commercial folder (Torre/Etapa)', (
    tester,
  ) async {
    final transport = _GroupedVisitTransport();
    final router = GoRouter(
      initialLocation: '/projects/project/inspections/visit',
      routes: [
        GoRoute(
          path: '/projects/:projectId/inspections/:inspectionId',
          builder: (_, _) => const InspectionScreen(
            projectId: 'project',
            inspectionId: 'visit',
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiTransportProvider.overrideWithValue(transport)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    final scrollable = find.byType(Scrollable).first;
    final title = find.text('Unidades de la visita');
    await tester.scrollUntilVisible(title, 250, scrollable: scrollable);
    await tester.tap(title);
    await tester.pumpAndSettle();

    expect(find.text('Torre 1'), findsOneWidget);
    expect(find.text('Torre 2'), findsOneWidget);
    expect(find.text('Sin torre/etapa asignada'), findsOneWidget);
    expect(find.byType(UnitTile), findsNWidgets(3));
  });
}

class _GroupedVisitTransport extends FakeTransport {
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (path == '/api/mobile/v1/inspections/visit') {
      return {
        'inspection': {'id': 'visit', 'status': 'draft'},
      };
    }
    if (path == '/api/mobile/v1/projects/project') {
      return {
        'project': {'id': 'project', 'name': 'Proyecto'},
      };
    }
    if (path == '/api/mobile/v1/projects/project/units') {
      return {
        'units': [
          {'id': 'u1', 'code': 'A1', 'folderId': 'f1'},
          {'id': 'u2', 'code': 'A2', 'folderId': 'f2'},
          {'id': 'u3', 'code': 'A3'},
        ],
      };
    }
    if (path == '/api/mobile/v1/projects/project/commercial-folders') {
      return {
        'folders': [
          {'id': 'f1', 'name': 'Torre 1', 'order': 0},
          {'id': 'f2', 'name': 'Torre 2', 'order': 1},
        ],
      };
    }
    if (path == '/api/mobile/v1/inspections/visit/units') {
      return {'units': []};
    }
    throw StateError('Unexpected request: $path');
  }
}
