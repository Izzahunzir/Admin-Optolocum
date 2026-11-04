import 'package:admin_optolocum/features/admin/account_management/account_management_api.dart';
import 'package:admin_optolocum/features/admin/account_management/managed_account_table.dart';
import 'package:admin_optolocum/features/admin/widgets/account_record.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'mock transport validates mutation payloads, tokens and responses',
    () async {
      final requests = <Map<String, dynamic>>[];
      final api = AccountManagementApi.mock(
        tokenProvider: () async => 'synthetic-token',
        transport: (data, token) async {
          expect(token, 'synthetic-token');
          requests.add(data);
          return data['action'] == 'delete'
              ? {'deleted': true}
              : {'disabled': data['disabled']};
        },
      );
      for (final kind in ['locum', 'practice_owner']) {
        for (final disabled in [true, false]) {
          await api.call(
            'target',
            kind,
            'setDisabled',
            disabled: disabled,
            expectedDisabled: !disabled,
          );
          expect(requests.last, {
            'uid': 'target',
            'kind': kind,
            'action': 'setDisabled',
            'disabled': disabled,
            'expectedDisabled': !disabled,
          });
        }
        await api.call('target', kind, 'delete', confirmUid: 'target');
        expect(requests.last['confirmUid'], 'target');
      }
      final count = requests.length;
      await expectLater(
        api.call('target', 'locum', 'delete', confirmUid: 'wrong'),
        throwsA(isA<AccountManagementException>()),
      );
      await expectLater(
        api.call('target', 'locum', 'setDisabled'),
        throwsA(isA<AccountManagementException>()),
      );
      expect(requests.length, count);
      final missingToken = AccountManagementApi.mock(
        tokenProvider: () async => null,
        transport: (_, _) async => throw StateError('must not dispatch'),
      );
      await expectLater(
        missingToken.call('target', 'locum', 'delete', confirmUid: 'target'),
        throwsA(
          isA<AccountManagementException>().having(
            (e) => e.code,
            'code',
            'unauthenticated',
          ),
        ),
      );
      final malformed = AccountManagementApi.mock(
        tokenProvider: () async => 'synthetic',
        transport: (_, _) async => {'deleted': false},
      );
      await expectLater(
        malformed.call('target', 'locum', 'delete', confirmUid: 'target'),
        throwsA(
          isA<AccountManagementException>().having(
            (e) => e.code,
            'code',
            'internal',
          ),
        ),
      );
    },
  );

  for (final kind in ['locum', 'practice_owner']) {
    testWidgets(
      '$kind dialogs cancel, disable and enable with no Delete control',
      (tester) async {
        tester.view.physicalSize = const Size(1600, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var disabled = false;
        final mutations = <Map<String, dynamic>>[];
        final api = AccountManagementApi.mock(
          tokenProvider: () async => 'synthetic',
          transport: (data, _) async {
            if (data['action'] == 'status') return {'disabled': disabled};
            mutations.add(data);
            if (data['action'] == 'delete') return {'deleted': true};
            expect(data['expectedDisabled'], disabled);
            disabled = data['disabled'] as bool;
            return {'disabled': disabled};
          },
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: ManagedAccountTable(
                  accounts: [
                    AccountRecord(
                      'target',
                      'Test user',
                      'test@example.com',
                      '012',
                    ),
                  ],
                  kind: kind,
                  api: api,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(OutlinedButton, 'Disable'));
        await tester.pumpAndSettle();
        expect(find.textContaining('UID: target'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(mutations, isEmpty);
        for (final label in ['Disable', 'Enable', 'Disable']) {
          await tester.tap(find.widgetWithText(OutlinedButton, label));
          await tester.pumpAndSettle();
          await tester.tap(find.widgetWithText(TextButton, label));
          await tester.pumpAndSettle();
        }
        expect(mutations.length, 3);
        expect(find.text('Delete'), findsNothing);
        expect(
          mutations.every((data) => data['action'] == 'setDisabled'),
          true,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'uncertain mutation disables controls until status refresh and retry',
    (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var attempts = 0;
      final api = AccountManagementApi.mock(
        tokenProvider: () async => 'synthetic',
        transport: (data, _) async {
          if (data['action'] == 'status') return {'disabled': false};
          attempts++;
          if (attempts == 1) {
            throw const AccountManagementException(
              'internal',
              'Change may be incomplete. Refresh status.',
            );
          }
          return {'disabled': true};
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ManagedAccountTable(
              accounts: [
                AccountRecord('target', 'Test', 'test@example.com', '012'),
              ],
              kind: 'locum',
              api: api,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Disable'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Disable'));
      await tester.pumpAndSettle();
      expect(attempts, 1);
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Disable'),
            )
            .onPressed,
        isNull,
      );
      expect(find.textContaining('Change may be incomplete'), findsWidgets);
      await tester.tap(find.text('Refresh account status'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Disable'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Disable'));
      await tester.pumpAndSettle();
      expect(attempts, 2);
      expect(find.text('Disabled'), findsOneWidget);
    },
  );
}
