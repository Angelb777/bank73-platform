import 'dart:io';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:bank73_avaluador/core/api/api_client.dart';
import 'package:bank73_avaluador/core/providers.dart';
import 'package:bank73_avaluador/core/storage/secure_session_store.dart';
import 'package:bank73_avaluador/features/inspections/presentation/inspection_report_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'mobile_contract_test.dart' show FakeTransport, MemorySessionStore;

class ReportTransport extends FakeTransport {
  @override
  Future<Map<String, dynamic>> get(String path) async {
    if (path.endsWith('/inspection-pack')) {
      return {
        'inspectionPack': {
          'project': {'id': 'project', 'name': 'Proyecto'},
          'metrics': <String, dynamic>{},
          'activeFronts': <dynamic>[],
          'current': {
            'visit': <String, dynamic>{},
          },
        },
      };
    }
    return {
      'inspection': {'id': 'visit', 'status': 'draft'},
      'units': <dynamic>[],
      'evidence': <dynamic>[],
    };
  }
}

void main() {
  test('camera and gallery JPEG/PNG uploads send image MIME and normalized filenames', () async {
    final directory = await Directory.systemTemp.createTemp(
      'inspection-photos-',
    );
    addTearDown(() => directory.delete(recursive: true));
    final store = MemorySessionStore(const SessionCredentials(token: 'token'));
    for (final sample in [
      ('jpeg', <int>[255, 216, 255, 0], 'evidencia.jpg'),
      ('png', <int>[137, 80, 78, 71, 13, 10, 26, 10, 0], 'evidencia.png'),
    ]) {
      final file = File('${directory.path}/gallery.tmp');
      await file.writeAsBytes(sample.$2);
      final client = ApiClient(
        store,
        MockClient((request) async {
          expect(
            latin1.decode(request.bodyBytes),
            contains('content-type: image/${sample.$1}'),
          );
          expect(
            latin1.decode(request.bodyBytes),
            contains('filename="${sample.$3}"'),
          );
          expect(request.headers['Authorization'], 'Bearer token');
          return http.Response('{}', 201);
        }),
      );
      await client.postMultipart(
        '/photos',
        field: 'photo',
        filePath: file.path,
      );
    }
  });

  testWidgets(
    'signature begins immediately, stays inside the box and does not scroll the report',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiTransportProvider.overrideWithValue(ReportTransport()),
            secureSessionStoreProvider.overrideWithValue(
              MemorySessionStore(null),
            ),
          ],
          child: const MaterialApp(
            home: InspectionReportScreen(inspectionId: 'visit'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final signature = find.byWidgetPredicate(
        (widget) =>
            widget is RawGestureDetector &&
            widget.gestures.containsKey(EagerGestureRecognizer),
      );
      await tester.scrollUntilVisible(
        signature,
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      final rect = tester.getRect(signature);
      final scroll = tester
          .state<ScrollableState>(find.byType(Scrollable).first)
          .position;
      final initialOffset = scroll.pixels;
      final gesture = await tester.startGesture(rect.center);
      await gesture.moveBy(const Offset(20, 15));
      await tester.pump();
      await gesture.moveTo(Offset(rect.right + 40, rect.center.dy));
      await gesture.up();
      await tester.pumpAndSettle();
      expect(scroll.pixels, initialOffset);
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find
            .ancestor(of: signature, matching: find.byType(RepaintBoundary))
            .first,
      );
      final image = (await tester.runAsync(() => boundary.toImage()))!;
      final bytes = await tester.runAsync(
        () => image.toByteData(format: ui.ImageByteFormat.rawRgba),
      );
      expect(
        bytes!.buffer.asUint8List().where((byte) => byte < 100).length,
        greaterThan(20),
      );
      image.dispose();
      await tester.tap(find.text('Limpiar'));
      await tester.pumpAndSettle();
      final cleanImage = (await tester.runAsync(() => boundary.toImage()))!;
      final clean = await tester.runAsync(
        () => cleanImage.toByteData(format: ui.ImageByteFormat.rawRgba),
      );
      expect(clean!.buffer.asUint8List().every((byte) => byte == 255), isTrue);
      cleanImage.dispose();
    },
  );
}
