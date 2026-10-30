import 'dart:async';

import 'package:admin_optolocum/features/admin/reports_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('date filters select their expected boundaries', () {
    final now = DateTime(2026, 10, 30);
    expect(ReportPeriod.week.start(now), DateTime(2026, 10, 23));
    expect(ReportPeriod.month.start(now), DateTime(2026, 9, 30));
    expect(ReportPeriod.quarter.start(now), DateTime(2026, 7, 30));
    expect(ReportPeriod.all.start(now), isNull);
  });

  testWidgets('reports handle loading and empty data', (tester) async {
    final completer = Completer<ReportsData>();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ReportsPage(loadData: () => completer.future),
          ),
        ),
      ),
    );
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    completer.complete(
      ReportsData(
        locums: [],
        owners: [],
        jobs: [],
        asOf: DateTime(2026, 10, 30),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No records'), findsOneWidget);
    expect(find.text('No registrations in this date range.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reports show retry after a load failure', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ReportsPage(
              loadData: () async => throw StateError('offline'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Reports unavailable'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('changing date range recalculates summary totals', (
    tester,
  ) async {
    final now = DateTime(2026, 10, 30);
    final data = ReportsData(
      locums: [now, now.subtract(const Duration(days: 60))],
      owners: [],
      jobs: [],
      asOf: now,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ReportsPage(loadData: () async => data),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('1'), findsOneWidget);
    await tester.tap(find.byType(DropdownMenu<ReportPeriod>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All Time').last);
    await tester.pumpAndSettle();
    expect(find.text('2'), findsOneWidget);
    expect(find.text('1'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
