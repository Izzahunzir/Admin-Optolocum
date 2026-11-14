import 'dart:convert';

import 'package:admin_optolocum/features/admin/account_management/account_management_api.dart';
import 'package:admin_optolocum/features/admin/account_management/managed_account_table.dart';
import 'package:admin_optolocum/features/admin/widgets/account_record.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  for (final kind in ['locum', 'practice_owner']) {
    testWidgets(
      '$kind supervised controls permit toggles with no Delete control',
      (tester) async {
        tester.view.physicalSize = const Size(1800, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var disabled = false;
        var mutations = 0;
        final client = MockClient((request) async {
          final data = jsonDecode(request.body) as Map;
          expect(data['kind'], kind);
          expect(data['action'], isNot('delete'));
          if (data['action'] == 'setDisabled') {
            expect(data['expectedDisabled'], disabled);
            disabled = data['disabled'] as bool;
            mutations++;
          }
          return http.Response(
            jsonEncode({
              'data': {'disabled': disabled, 'mutationsEnabled': true},
            }),
            200,
          );
        });
        addTearDown(client.close);
        final api = AccountManagementApi(
          client: client,
          tokenProvider: () async => 'synthetic',
          baseUrl: 'http://127.0.0.1:8787',
          demoMutations: true,
          demoProject: 'optolocum-f314e',
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ManagedAccountTable(
                accounts: [
                  AccountRecord(
                    'synthetic',
                    'Test',
                    'test@example.invalid',
                    '000',
                  ),
                ],
                kind: kind,
                api: api,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Delete'), findsNothing);
        await tester.tap(find.widgetWithText(OutlinedButton, 'Disable'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(mutations, 0);
        for (final label in ['Disable', 'Enable']) {
          await tester.tap(find.widgetWithText(OutlinedButton, label));
          await tester.pumpAndSettle();
          await tester.tap(find.widgetWithText(TextButton, label));
          await tester.pumpAndSettle();
          expect(find.text('Delete'), findsNothing);
        }
        expect(mutations, 2);
        expect(disabled, false);
      },
    );
  }
  test('demo needs exact project, explicit UI gate and local URL', () {
    for (final api in [
      AccountManagementApi(),
      AccountManagementApi(
        demoMutations: true,
        demoProject: 'wrong',
        baseUrl: 'http://127.0.0.1:8787',
      ),
      AccountManagementApi(
        demoMutations: true,
        demoProject: 'optolocum-f314e',
        baseUrl: 'https://example.invalid',
      ),
    ]) {
      expect(api.accountChangesEnabled, false);
      expect(api.canManage('synthetic', 'locum'), false);
    }
  });

  test(
    'HTTP demo scopes approval by role, supports both roles and blocks Delete',
    () async {
      var disabled = false;
      final actions = <String>[];
      final client = MockClient((request) async {
        final data = jsonDecode(request.body) as Map;
        expect(request.followRedirects, false);
        expect(request.headers['Authorization'], 'Bearer synthetic');
        final action = data['action'] as String;
        actions.add(action);
        if (action == 'setDisabled') disabled = data['disabled'] as bool;
        return http.Response(
          jsonEncode({
            'data': {
              if (action == 'delete') 'deleted': true else 'disabled': disabled,
              'mutationsEnabled': data['uid'] == 'approved',
            },
          }),
          200,
        );
      });
      final api = AccountManagementApi(
        client: client,
        tokenProvider: () async => 'synthetic',
        baseUrl: 'http://127.0.0.1:8787',
        demoMutations: true,
        demoProject: 'optolocum-f314e',
      );
      expect(api.accountChangesEnabled, true);
      await expectLater(
        api.call('approved', 'locum', 'delete', confirmUid: 'approved'),
        throwsA(isA<AccountManagementException>()),
      );
      expect(actions, isEmpty);
      await api.call('other', 'locum', 'status');
      expect(api.canManage('other', 'locum'), false);
      await api.call('approved', 'locum', 'status');
      expect(api.canManage('approved', 'locum'), true);
      expect(api.canManage('approved', 'practice_owner'), false);
      await expectLater(
        api.call(
          'approved',
          'practice_owner',
          'setDisabled',
          disabled: true,
          expectedDisabled: false,
        ),
        throwsA(isA<AccountManagementException>()),
      );
      for (final kind in ['locum', 'practice_owner']) {
        await api.call('approved', kind, 'status');
        expect(api.canManage('approved', kind), true);
        await api.call(
          'approved',
          kind,
          'setDisabled',
          disabled: true,
          expectedDisabled: false,
        );
        expect(disabled, true);
        await api.call(
          'approved',
          kind,
          'setDisabled',
          disabled: false,
          expectedDisabled: true,
        );
        expect(disabled, false);
      }
      final count = actions.length;
      expect(api.deletionEnabled, false);
      await expectLater(
        api.call('approved', 'locum', 'delete', confirmUid: 'approved'),
        throwsA(isA<AccountManagementException>()),
      );
      expect(actions.length, count);
      client.close();
    },
  );

  test('backend approval cannot turn on default UI and errors clear demo capability', () async {
    var fail = false;
    final client = MockClient(
      (_) async => fail
          ? http.Response(
              jsonEncode({
                'error': {
                  'code': 'internal',
                  'message':
                      'Profile cleanup failed; manual recovery required.',
                },
              }),
              409,
            )
          : http.Response(
              jsonEncode({
                'data': {'disabled': true, 'mutationsEnabled': true},
              }),
              200,
            ),
    );
    final defaultApi = AccountManagementApi(
      client: client,
      tokenProvider: () async => 'synthetic',
      baseUrl: 'http://127.0.0.1:8787',
    );
    await defaultApi.call('approved', 'locum', 'status');
    expect(defaultApi.canManage('approved', 'locum'), false);
    final demo = AccountManagementApi(
      client: client,
      tokenProvider: () async => 'synthetic',
      baseUrl: 'http://127.0.0.1:8787',
      demoMutations: true,
      demoProject: 'optolocum-f314e',
    );
    await demo.call('approved', 'locum', 'status');
    fail = true;
    await expectLater(
      demo.call(
        'approved',
        'locum',
        'setDisabled',
        disabled: false,
        expectedDisabled: true,
      ),
      throwsA(
        isA<AccountManagementException>().having(
          (e) => e.message,
          'partial failure',
          contains('manual recovery'),
        ),
      ),
    );
    expect(demo.canManage('approved', 'locum'), false);
    client.close();
  });
}
