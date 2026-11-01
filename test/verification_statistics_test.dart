import 'package:admin_optolocum/features/admin/dashboard/verification_statistics.dart';
import 'package:admin_optolocum/features/admin/dashboard/account_verification_table.dart';
import 'package:admin_optolocum/features/admin/locums/locum_profile.dart';
import 'package:admin_optolocum/features/admin/practice_owners/practice_owner_profile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('models retain raw statuses without defaulting missing values', () {
    for (final raw in [
      null,
      '',
      ' ',
      4,
      false,
      'verified',
      'pending',
      'unverified',
      'unexpected',
      ' verified ',
    ]) {
      expect(
        LocumProfile.fromMap('id', {
          'verificationStatus': raw,
        }).verificationStatus,
        raw,
      );
      expect(
        PracticeOwnerProfile.fromMap('id', {
          'verificationStatus': raw,
        }).verificationStatus,
        raw,
      );
    }
    expect(LocumProfile.fromMap('id', {}).verificationStatus, isNull);
    expect(PracticeOwnerProfile.fromMap('id', {}).verificationStatus, isNull);
  });

  test('exact categories reconcile with total without coercing values', () {
    final stats = VerificationStatistics([
      'verified',
      'pending',
      'unverified',
      null,
      '',
      '  ',
      1,
      false,
      'rejected',
      'Verified',
      ' verified ',
    ]);
    expect(stats.verified, 1);
    expect(stats.pending, 1);
    expect(stats.unverified, 1);
    expect(stats.unknown, 5);
    expect(stats.other, 3);
    expect(stats.total, 11);
    expect(stats.verifiedFraction, closeTo(1 / 11, .00001));
  });

  test('percentage includes unknown and other profiles in denominator', () {
    expect(
      VerificationStatistics(['verified', 'verified', null, 'other'])
          .verifiedFraction,
      .5,
    );
    final empty = VerificationStatistics([]);
    expect(empty.total, 0);
    expect(empty.verifiedFraction, 0);
  });

  testWidgets(
    'comparison table aligns each category across both account types',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 260,
              child: AccountVerificationTable(
                locums: VerificationColumnData(
                  statuses: ['verified', 'pending'],
                ),
                owners: VerificationColumnData(
                  statuses: ['verified', 'verified', null, 'other'],
                ),
              ),
            ),
          ),
        ),
      );
      final table = tester.widget<Table>(find.byType(Table));
      expect(table.children.length, 7);
      expect(find.text('Locums'), findsOneWidget);
      expect(find.text('Practice Owners'), findsOneWidget);
      expect(find.text('Total profiles'), findsOneWidget);
      final verified = find.descendant(
        of: find.byType(Table),
        matching: find.text('Verified'),
      );
      expect(verified, findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'columns independently show loading, errors, cache, and confirmed zero',
    (tester) async {
      Future<void> render(
        VerificationColumnData left,
        VerificationColumnData right,
      ) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccountVerificationTable(locums: left, owners: right),
          ),
        ),
      );
      await render(
        VerificationColumnData(statuses: [], loading: true),
        VerificationColumnData(statuses: ['verified']),
      );
      expect(find.text('Loading…'), findsOneWidget);
      expect(find.text('—'), findsNWidgets(6));
      expect(find.text('1'), findsNWidgets(2));
      await render(
        VerificationColumnData(statuses: [], errorMessage: 'Access denied'),
        VerificationColumnData(statuses: []),
      );
      expect(find.textContaining('Access denied'), findsOneWidget);
      expect(find.text('0'), findsNWidgets(6));
      await render(
        VerificationColumnData(statuses: [], fromCache: true),
        VerificationColumnData(statuses: ['pending'], fromCache: true),
      );
      expect(find.text('Cached counts may be incomplete.'), findsOneWidget);
      expect(find.text('—'), findsNWidgets(6));
      expect(tester.takeException(), isNull);
    },
  );
}
