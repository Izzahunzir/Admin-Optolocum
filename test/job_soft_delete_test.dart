import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:admin_optolocum/features/admin/job_postings/job_management_api.dart';
import 'package:admin_optolocum/features/admin/job_postings/managed_job_table.dart';
import 'package:admin_optolocum/features/admin/job_postings/job_posting.dart';

void main() {
  test(
    'job UI gate is independent and cannot issue requests by default',
    () async {
      final api = JobManagementApi(
        tokenProvider: () async => throw StateError('must not request token'),
      );
      expect(api.configured, false);
      await expectLater(api.call('job'), throwsStateError);
    },
  );
  test(
    'job approval, payload and failures are scoped to the selected posting',
    () async {
      var fail = false;
      final client = MockClient((request) async {
        expect(request.followRedirects, false);
        expect(request.headers['Authorization'], 'Bearer synthetic');
        final data = jsonDecode(request.body) as Map;
        if (fail) return http.Response('{}', 503);
        return http.Response(
          jsonEncode({
            'data': {
              'status': data['action'] == 'softDelete'
                  ? 'deleted'
                  : 'available',
              'mutationsEnabled':
                  data['jobId'] == 'approved' && data['action'] == 'status',
            },
          }),
          200,
        );
      });
      final api = JobManagementApi(
        client: client,
        tokenProvider: () async => 'synthetic',
        enabled: true,
        project: 'optolocum-f314e',
        baseUrl: 'http://127.0.0.1:8787',
      );
      await expectLater(
        api.call('approved', expectedStatus: 'available'),
        throwsStateError,
      );
      await api.call('other');
      expect(api.canDelete('other'), false);
      await api.call('approved');
      expect(api.canDelete('approved'), true);
      await api.call('approved', expectedStatus: 'available');
      expect(api.canDelete('approved'), false);
      await api.call('approved');
      fail = true;
      await expectLater(
        api.call('approved', expectedStatus: 'available'),
        throwsStateError,
      );
      expect(api.canDelete('approved'), false);
      client.close();
    },
  );
  testWidgets(
    'nine columns, confirmation cancellation, soft delete and history label',
    (tester) async {
      tester.view.physicalSize = const Size(1900, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var status = 'available', mutations = 0;
      final client = MockClient((request) async {
        final data = jsonDecode(request.body) as Map;
        if (data['action'] == 'softDelete') {
          expect(data['expectedStatus'], 'available');
          status = 'deleted';
          mutations++;
        }
        return http.Response(
          jsonEncode({
            'data': {'status': status, 'mutationsEnabled': status != 'deleted'},
          }),
          200,
        );
      });
      addTearDown(client.close);
      final api = JobManagementApi(
        client: client,
        tokenProvider: () async => 'synthetic',
        enabled: true,
        project: 'optolocum-f314e',
        baseUrl: 'http://127.0.0.1:8787',
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ManagedJobTable(
              jobs: [
                JobPosting.fromMap('job', {
                  'status': 'available',
                  'placeName': 'Test',
                  'role': 'Optometrist',
                }),
              ],
              api: api,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<DataTable>(find.byType(DataTable)).columns.length,
        9,
      );
      await tester.tap(find.widgetWithText(OutlinedButton, 'Delete'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(mutations, 0);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Delete'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(mutations, 1);
      expect(find.text('Deleted'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Delete'), findsNothing);
    },
  );
}
