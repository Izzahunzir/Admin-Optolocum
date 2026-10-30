import 'package:admin_optolocum/features/admin/job_postings/job_posting.dart';
import 'package:admin_optolocum/features/admin/job_postings/job_posting_service.dart';
import 'package:admin_optolocum/features/admin/job_postings/job_postings_page.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> fields({String unit = 'per_hour', num pay = 50}) => {
  'placeName': 'Test Optics',
  'role': 'Optician',
  'location': 'Shah Alam',
  'jobDate': Timestamp.fromDate(DateTime(2026, 11, 7)),
  'createdAt': Timestamp.fromDate(DateTime(2026, 10, 31)),
  'startTime': '09:05',
  'endTime': '18:30',
  'payRate': pay,
  'payRateUnit': unit,
  'contactNumber': '000-0000',
  'status': 'available',
};

void main() {
  test('maps document fields and formats dates and 24-hour times', () {
    final job = JobPosting.fromMap('firestore-id', fields());
    expect(job.id, 'firestore-id');
    expect(job.practice, 'Test Optics');
    expect(job.role, 'Optician');
    expect(job.location, 'Shah Alam');
    expect(job.contactNumber, '000-0000');
    expect(job.date, '7 Nov 2026');
    expect(job.timeRange, '9:05 AM – 6:30 PM');
    expect(JobPosting.formatTime('00:00'), '12:00 AM');
    expect(JobPosting.formatTime('12:00'), '12:00 PM');
    expect(JobPosting.formatTime('24:01'), 'Not provided');
    expect(JobPosting.formatTime('abc'), 'Not provided');
  });

  test('formats RM rates for all supported units without inventing units', () {
    expect(JobPosting.fromMap('id', fields()).rate, 'RM 50/hr');
    expect(
      JobPosting.fromMap('id', fields(unit: 'per_day', pay: 350)).rate,
      'RM 350/day',
    );
    expect(
      JobPosting.fromMap('id', fields(unit: 'per_shift', pay: 125.5)).rate,
      'RM 125.50/shift',
    );
    expect(
      JobPosting.fromMap('id', fields(unit: 'other')).rate,
      'RM 50 (other)',
    );
    expect(JobPosting.fromMap('id', fields(pay: 0)).rate, 'RM 0/hr');
  });

  test('missing and malformed fields have safe placeholders', () {
    final job = JobPosting.fromMap('id', {
      'placeName': 3,
      'jobDate': 'wrong',
      'payRate': double.nan,
    });
    expect(job.practice, 'Not provided');
    expect(job.date, 'Not provided');
    expect(job.rate, 'Not provided');
    expect(job.createdAt, isNull);
    expect(job.isAvailable, isFalse);
    expect(JobPosting.fromMap('id', fields(pay: -1)).rate, 'Not provided');
  });

  test(
    'search covers displayed role, rate, date, location, contact and ID',
    () {
      final job = JobPosting.fromMap('firestore-id', fields());
      for (final query in [
        'optician',
        'shah alam',
        '7 nov 2026',
        'rm 50/hr',
        '000-0000',
        'firestore-id',
        '9:05 am',
      ]) {
        expect(job.search.contains(query), isTrue);
      }
      expect(job.search.contains('optometrist'), isFalse);
    },
  );

  test('active count includes only the actual available status', () {
    final service = JobPostingService();
    service.jobs = [
      JobPosting.fromMap('one', fields()),
      JobPosting.fromMap('two', {...fields(), 'status': 'other'}),
      JobPosting.fromMap('three', {}),
    ];
    expect(service.availableCount, 1);
    service.dispose();
  });

  testWidgets(
    'job page handles data states and keeps nine columns with Delete disabled',
    (tester) async {
      final service = JobPostingService();
      Future<void> render({String query = ''}) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: JobPostingsPage(service: service, query: query),
            ),
          ),
        ),
      );
      await render();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      service.loading = false;
      service.errorMessage = 'Unable to load job postings';
      await render();
      expect(find.text('Retry'), findsOneWidget);
      service.errorMessage = null;
      await render();
      expect(find.text('No job postings available.'), findsOneWidget);
      service.fromCache = true;
      service.jobs = [JobPosting.fromMap('id', fields())];
      await render();
      expect(find.textContaining('Showing cached data'), findsOneWidget);
      expect(
        tester.widget<DataTable>(find.byType(DataTable)).columns.length,
        9,
      );
      expect(find.text('Optician'), findsOneWidget);
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNull,
      );
      await render(query: 'unknown');
      expect(find.text('No matching records.'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      service.dispose();
    },
  );
}
