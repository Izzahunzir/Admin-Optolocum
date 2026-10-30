import 'package:admin_optolocum/features/admin/locums/locum_profile.dart';
import 'package:admin_optolocum/features/admin/practice_owners/practice_owner_accounts_page.dart';
import 'package:admin_optolocum/features/admin/practice_owners/practice_owner_service.dart';
import 'package:admin_optolocum/features/admin/practice_owners/practice_owner_profile.dart';
import 'package:admin_optolocum/features/admin/widgets/account_table.dart';
import 'package:admin_optolocum/features/admin/widgets/paginated_records.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'locum mapping preserves visible fields and tolerates missing values',
    () {
      final profile = LocumProfile.fromMap('locum-id', {
        'fullName': '  Test Locum  ',
        'email': 'locum@example.com',
        'phoneNumber': '0123456789',
        'nric': 'sensitive value',
      });
      expect(profile.id, 'locum-id');
      expect(profile.name, 'Test Locum');
      expect(profile.email, 'locum@example.com');
      expect(profile.phone, '0123456789');
      final missing = LocumProfile.fromMap('missing', {
        'fullName': 123,
        'email': ' ',
      });
      expect([
        missing.name,
        missing.email,
        missing.phone,
      ], everyElement('Not provided'));
    },
  );

  testWidgets('real locum rows keep their actions disabled', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: AccountTable(
              accounts: [LocumProfile('id', 'Locum', 'email', 'phone')],
              readOnly: true,
            ),
          ),
        ),
      ),
    );
    expect(find.text('Role'), findsNothing);
    expect(find.text('Password'), findsNothing);
    for (final button in tester.widgetList<OutlinedButton>(
      find.byType(OutlinedButton),
    )) {
      expect(button.onPressed, isNull);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'pagination retains six rows, resets search, and clamps live removals',
    (tester) async {
      Future<void> render(List<String> records, String query) =>
          tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: PaginatedRecords<String>(
                  records: records,
                  query: query,
                  matches: (r, q) => r.contains(q),
                  tableBuilder: (rows) =>
                      Column(children: rows.map((r) => Text(r)).toList()),
                ),
              ),
            ),
          );
      final records = List.generate(12, (i) => 'record-${i + 1}');
      await render(records, '');
      expect(find.text('record-6'), findsOneWidget);
      expect(find.text('record-7'), findsNothing);
      await tester.tap(find.text('Next'));
      await tester.pump();
      expect(find.text('record-7'), findsOneWidget);
      await render(records.take(3).toList(), '');
      expect(find.text('record-1'), findsOneWidget);
      await render(records, '');
      await tester.tap(find.text('Next'));
      await tester.pump();
      await render(records, 'record-2');
      expect(find.text('record-2'), findsOneWidget);
      expect(find.text('1 records'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  test('practice owner mapping tolerates missing fields', () {
    final owner = PracticeOwnerProfile.fromMap('uid', {
      'fullName': ' Owner ',
      'email': 'test@example.com',
      'phoneNumber': '123',
      'role': 'Manager',
      'verificationStatus': 'unverified',
    });
    expect(owner.id, 'uid');
    expect(owner.name, 'Owner');
    expect(owner.email, 'test@example.com');
    expect(owner.phone, '123');
    expect(owner.role, 'Manager');
    final missing = PracticeOwnerProfile.fromMap('uid', {'role': 123});
    expect([
      missing.name,
      missing.email,
      missing.phone,
      missing.role,
    ], everyElement('Not provided'));
  });

  testWidgets(
    'practice owners show loading, errors, empty records and read-only rows',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = PracticeOwnerService();
      Future<void> render() => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: PracticeOwnerAccountsPage(service: service, query: ''),
            ),
          ),
        ),
      );
      await render();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      service.loading = false;
      service.errorMessage = 'Permission denied';
      await render();
      expect(find.text('Permission denied'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      service.errorMessage = null;
      await render();
      expect(
        find.text('No practice owner profiles available.'),
        findsOneWidget,
      );
      service.accounts = [
        PracticeOwnerProfile(
          'uid',
          'Owner',
          'test@example.com',
          '123',
          'Manager',
        ),
      ];
      await render();
      expect(find.text('uid'), findsOneWidget);
      expect(find.text('Manager'), findsOneWidget);
      for (final button in tester.widgetList<OutlinedButton>(
        find.byType(OutlinedButton),
      )) {
        expect(button.onPressed, isNull);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      service.dispose();
    },
  );
}
