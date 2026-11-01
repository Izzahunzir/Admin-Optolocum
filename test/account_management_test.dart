import 'dart:convert';

import 'package:admin_optolocum/features/admin/account_management/account_management_api.dart';
import 'package:admin_optolocum/features/admin/account_management/managed_account_table.dart';
import 'package:admin_optolocum/features/admin/widgets/account_record.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Api extends AccountManagementApi {
  _Api(this.disabled) : super(baseUrl: 'http://127.0.0.1:8787');
  final bool disabled;
  int mutations = 0;
  int reads = 0;
  AccountManagementException? error;
  @override
  Future<Map<String, dynamic>> call(
    String uid,
    String kind,
    String action, {
    bool? disabled,
    bool? expectedDisabled,
    String? confirmUid,
  }) async {
    if (action != 'status') mutations++;
    if (action == 'status') reads++;
    if (error != null) throw error!;
    // A response cannot activate Phase 1 controls, even if it claims otherwise.
    return {'disabled': this.disabled, 'mutationsEnabled': true};
  }
}

void main() {
  test('HTTP status attaches a token and uses only the configured loopback endpoint', () async {
    final client = MockClient((request) async {
      expect(
        request.url.toString(),
        'http://127.0.0.1:8787/api/accounts/manage',
      );
      expect(request.headers['Authorization'], 'Bearer test-token');
      expect(request.followRedirects, false);
      expect(jsonDecode(request.body), {
        'uid': 'target',
        'kind': 'locum',
        'action': 'status',
      });
      return http.Response(
        jsonEncode({
          'data': {'disabled': true, 'mutationsEnabled': false},
        }),
        200,
      );
    });
    final api = AccountManagementApi(
      client: client,
      baseUrl: 'http://127.0.0.1:8787',
      tokenProvider: () async => 'test-token',
    );
    expect((await api.call('target', 'locum', 'status'))['disabled'], true);
    client.close();
  });

  test(
    'all transports reject mutations before authentication or network access',
    () async {
      for (final url in ['', 'http://127.0.0.1:8787']) {
        final api = AccountManagementApi(
          baseUrl: url,
          tokenProvider: () async => throw StateError('must not be called'),
        );
        expect(api.accountChangesEnabled, false);
        for (final action in ['setDisabled', 'delete']) {
          await expectLater(
            api.call('uid', 'locum', action),
            throwsA(
              isA<AccountManagementException>().having(
                (e) => e.code,
                'code',
                'failed-precondition',
              ),
            ),
          );
        }
      }
    },
  );

  test('invalid URLs cannot receive a Firebase ID token', () async {
    final api = AccountManagementApi(
      baseUrl: 'https://example.com',
      tokenProvider: () async =>
          throw StateError('token must not be requested'),
    );
    await expectLater(
      api.call('uid', 'locum', 'status'),
      throwsA(
        isA<AccountManagementException>().having(
          (e) => e.code,
          'code',
          'invalid-argument',
        ),
      ),
    );
  });

  test('safe HTTP errors are retained for display', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'error': {
            'code': 'permission-denied',
            'message': 'Administrator access required.',
          },
        }),
        403,
      ),
    );
    final api = AccountManagementApi(
      client: client,
      baseUrl: 'http://127.0.0.1:8787',
      tokenProvider: () async => 'token',
    );
    await expectLater(
      api.call('uid', 'locum', 'status'),
      throwsA(
        isA<AccountManagementException>().having(
          (e) => e.message,
          'message',
          'Administrator access required.',
        ),
      ),
    );
    client.close();
  });

  testWidgets(
    'Disable, Enable and Delete remain unavailable despite successful status reads',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final disabled in [false, true]) {
        final api = _Api(disabled);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: ManagedAccountTable(
                  key: ValueKey(disabled),
                  accounts: [
                    AccountRecord(
                      'uid-123',
                      'Test user',
                      'test@example.com',
                      '012',
                    ),
                  ],
                  kind: 'locum',
                  api: api,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('disabled in Phase 1'), findsOneWidget);
        expect(
          find.text('Status source: localhost (read-only)'),
          findsOneWidget,
        );
        expect(find.text(disabled ? 'Disabled' : 'Enabled'), findsOneWidget);
        expect(
          find.text('Status read succeeded for 1 of 1 displayed accounts.'),
          findsOneWidget,
        );
        await tester.tap(find.text('Refresh account status'));
        await tester.pumpAndSettle();
        expect(api.reads, 2);
        expect(
          find.widgetWithText(OutlinedButton, disabled ? 'Enable' : 'Disable'),
          findsOneWidget,
        );
        expect(find.widgetWithText(OutlinedButton, 'Delete'), findsOneWidget);
        for (final button in tester.widgetList<OutlinedButton>(
          find.byType(OutlinedButton),
        )) {
          expect(button.onPressed, isNull);
        }
        expect(api.mutations, 0);
        expect(find.byType(AlertDialog), findsNothing);
        expect(tester.takeException(), isNull);
      }
    },
  );

  test(
    'missing or invalid administrator sessions show unauthenticated',
    () async {
      for (final provider in <Future<String?> Function()>[
        () async => null,
        () async => throw FirebaseAuthException(code: 'user-disabled'),
      ]) {
        final api = AccountManagementApi(
          baseUrl: 'http://127.0.0.1:8787',
          tokenProvider: provider,
        );
        await expectLater(
          api.call('uid', 'locum', 'status'),
          throwsA(
            isA<AccountManagementException>().having(
              (e) => e.code,
              'code',
              'unauthenticated',
            ),
          ),
        );
      }
    },
  );

  test(
    'network and browser-blocked requests show safe CORS and origin guidance',
    () async {
      final client = MockClient(
        (_) async => throw http.ClientException('PRIVATE INTERNAL DETAILS'),
      );
      final api = AccountManagementApi(
        client: client,
        baseUrl: 'http://127.0.0.1:8787',
        tokenProvider: () async => 'synthetic-token',
      );
      await expectLater(
        api.call('uid', 'locum', 'status'),
        throwsA(
          isA<AccountManagementException>()
              .having((e) => e.message, 'message', contains('CORS'))
              .having(
                (e) => e.message,
                'safe message',
                isNot(contains('PRIVATE')),
              ),
        ),
      );
      client.close();
    },
  );

  testWidgets(
    'read-only status error is visible and the refresh diagnostic recovers',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _Api(false)
        ..error = const AccountManagementException(
          'permission-denied',
          'Administrator access required.',
        );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ManagedAccountTable(
                accounts: [
                  AccountRecord('uid', 'Test', 'test@example.com', '012'),
                ],
                kind: 'locum',
                api: api,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Unavailable'), findsOneWidget);
      expect(find.textContaining('permission-denied:'), findsOneWidget);
      api.error = null;
      await tester.tap(find.text('Refresh account status'));
      await tester.pumpAndSettle();
      expect(find.text('Enabled'), findsOneWidget);
      expect(
        find.text('Status read succeeded for 1 of 1 displayed accounts.'),
        findsOneWidget,
      );
      expect(api.mutations, 0);
      expect(tester.takeException(), isNull);
    },
  );
}
