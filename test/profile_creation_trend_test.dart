import 'package:admin_optolocum/features/admin/dashboard/profile_creation_trend.dart';
import 'package:admin_optolocum/features/admin/dashboard/profile_registration_trend.dart';
import 'package:admin_optolocum/features/admin/locums/locum_profile.dart';
import 'package:admin_optolocum/features/admin/practice_owners/practice_owner_profile.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('latest six calendar months combine profiles once per collection', () {
    final trend = ProfileCreationTrend.calculate(
      now: DateTime.utc(2026, 10, 31),
      locums: [
        ('a', DateTime.utc(2026, 5, 1)),
        ('a', DateTime.utc(2026, 5, 1)),
        ('b', DateTime.utc(2026, 10, 2)),
        ('old', DateTime.utc(2026, 4, 1)),
      ],
      owners: [
        ('a', DateTime.utc(2026, 5, 20)),
        ('c', DateTime.utc(2026, 7, 15)),
      ],
    );
    expect(trend.months.map((d) => d.month), [5, 6, 7, 8, 9, 10]);
    expect(trend.counts, [2, 0, 1, 0, 0, 1]);
  });

  test('Malaysia timezone consistently handles year and month boundaries', () {
    final trend = ProfileCreationTrend.calculate(
      now: DateTime.utc(2025, 12, 31, 16),
      locums: [
        ('new', DateTime.utc(2025, 12, 31, 16)),
        ('old', DateTime.utc(2025, 12, 31, 15, 59)),
      ],
      owners: [],
    );
    expect(trend.months.first, DateTime.utc(2025, 8));
    expect(trend.months.last, DateTime.utc(2026, 1));
    expect(trend.counts, [0, 0, 0, 0, 1, 1]);
  });

  test('empty data preserves all six zero months', () {
    final trend = ProfileCreationTrend.calculate(
      now: DateTime.utc(2026, 1, 15),
      locums: [],
      owners: [],
    );
    expect(trend.counts, [0, 0, 0, 0, 0, 0]);
    expect(trend.unknownDates, 0);
  });

  test(
    'models accept only Timestamp creation dates and never use updatedAt',
    () {
      final created = Timestamp.fromDate(DateTime.utc(2026, 10, 1));
      expect(
        LocumProfile.fromMap('id', {'createdAt': created}).createdAt,
        created.toDate(),
      );
      expect(
        PracticeOwnerProfile.fromMap('id', {'createdAt': created}).createdAt,
        created.toDate(),
      );
      for (final value in [null, '2026-10-01', 123, DateTime.utc(2026)]) {
        final data = {'createdAt': value, 'updatedAt': created};
        expect(LocumProfile.fromMap('id', data).createdAt, isNull);
        expect(PracticeOwnerProfile.fromMap('id', data).createdAt, isNull);
      }
      expect(LocumProfile.fromMap('id', {}).createdAt, isNull);
      final trend = ProfileCreationTrend.calculate(
        now: DateTime.utc(2026, 10, 10),
        locums: [('id', null)],
        owners: [('id', null)],
      );
      expect(trend.unknownDates, 2);
      expect(trend.counts, everyElement(0));
    },
  );

  testWidgets(
    'chart labels cached and unknown data and hides counts on loading/errors',
    (tester) async {
      Future<void> render({
        bool loading = false,
        bool cached = false,
        String? error,
      }) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProfileRegistrationTrend(
              locums: [('id', null)],
              owners: [('owner', DateTime.utc(2026, 10, 1))],
              now: DateTime.utc(2026, 10, 20),
              loading: loading,
              fromCache: cached,
              errorMessage: error,
            ),
          ),
        ),
      );
      await render(loading: true);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Oct'), findsNothing);
      await render(error: 'Access denied');
      expect(find.textContaining('Profile trend unavailable'), findsOneWidget);
      expect(find.text('Oct'), findsNothing);
      await render(cached: true);
      expect(find.text('Cached data · May be incomplete'), findsOneWidget);
      expect(
        find.text('1 profiles excluded: creation date unknown.'),
        findsOneWidget,
      );
      expect(find.text('1'), findsOneWidget);
      expect(find.text('Oct'), findsOneWidget);
      await render();
      expect(find.text('Firestore profile creation counts'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
