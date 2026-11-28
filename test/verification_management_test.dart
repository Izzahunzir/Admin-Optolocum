import 'package:admin_optolocum/features/admin/backend_endpoint.dart';

import 'dart:convert';

import 'package:admin_optolocum/features/admin/verification/verification_service.dart';
import 'package:admin_optolocum/features/admin/verification/verification_submission.dart';
import 'package:admin_optolocum/features/admin/verification/verification_management_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _aId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _bId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _cId = 'cccccccccccccccccccccccccccccccccccccccc';

Map<String, dynamic> _submission({
  String id = _aId,
  String accountType = 'locum',
  String name = 'Dr Sample',
  String state = 'submitted',
  String status = 'pending',
}) => {
  'uid': 'sample-user',
  'submissionId': id,
  'accountType': accountType,
  'submittedFields': accountType == 'locum'
      ? {
          'fullName': name,
          'email': 'sample@example.invalid',
          'nric': '990101010101',
          'phoneNumber': '0123456789',
          'gender': 'Female',
          'dateOfBirth': '1999-01-01',
          'highestEducation': 'Degree',
          'course': 'Optometry',
        }
      : {
          'practiceType': 'Retail Optical Store',
          'clinicName': name,
          'registrationNumber': 'SSM-123',
          'address': 'Jalan Test',
          'state': 'Johor',
          'contactNumber': '0123456789',
          'companyEmail': 'office@example.invalid',
        },
  'submittedAt': '2026-01-02T03:04:05.000Z',
  'state': state,
  'verificationStatus': status,
  'document': {
    'path': 'verification_documents/sample-user/$id/document',
    'name': 'certificate.pdf',
    'contentType': 'application/pdf',
    'size': 5,
    'sha256': 'c' * 64,
  },
};

void main() {
  testWidgets('reject confirmation invokes review API', (tester) async {
    tester.view.physicalSize = const Size(1600, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final item = _submission();
    Map<String, dynamic>? review;
    final service = VerificationService(
      callable: (name, data) async {
        if (name == 'listPendingVerificationSubmissions')
          return {
            'items': [item],
          };
        if (name == 'getVerificationSubmission')
          return {
            'submission': item,
            'history': [item],
            'historyHasMore': false,
          };
        if (name == 'reviewVerificationSubmission') {
          review = data;
          return data;
        }
        throw StateError('Unexpected callable');
      },
      tokenProvider: () async => 'test-token',
      backend: const BackendEndpoint(baseUrl: 'https://backend.example'),
      httpClient: MockClient(
        (_) async => http.Response.bytes(
          [37, 80, 68, 70, 45],
          200,
          headers: {'content-type': 'application/pdf'},
        ),
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: VerificationManagementPage(service: service),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('View Details'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Reject'));
    await tester.tap(find.text('Reject'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Synthetic reason');
    await tester.tap(find.text('Reject').last);
    await tester.pumpAndSettle();
    expect(review?['decision'], 'rejected');
    expect(review?['rejectionReason'], 'Synthetic reason');
  });
  testWidgets('unauthenticated review tells admin to sign in again', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1600, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final item = _submission();
    final service = VerificationService(
      callable: (name, data) async {
        if (name == 'listPendingVerificationSubmissions')
          return {
            'items': [item],
          };
        if (name == 'getVerificationSubmission')
          return {
            'submission': item,
            'history': [item],
            'historyHasMore': false,
          };
        if (name == 'reviewVerificationSubmission')
          throw const VerificationException(
            'unauthenticated',
            'Sign in again.',
          );
        throw StateError('Unexpected callable');
      },
      tokenProvider: () async => 'test-token',
      backend: const BackendEndpoint(baseUrl: 'https://backend.example'),
      httpClient: MockClient(
        (_) async => http.Response.bytes(
          [37, 80, 68, 70, 45],
          200,
          headers: {'content-type': 'application/pdf'},
        ),
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: VerificationManagementPage(service: service),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('View Details'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Reject'));
    await tester.tap(find.text('Reject'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Synthetic reason');
    await tester.tap(find.text('Reject').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Administrator sign-in required'), findsOneWidget);
    expect(find.textContaining('Your review was not saved'), findsOneWidget);
  });
  group('VerificationSubmission', () {
    test('maps queue entries whose backend omits redundant status fields', () {
      final raw = _submission()
        ..remove('state')
        ..remove('verificationStatus');
      final item = VerificationSubmission.tryParse(raw, queueItem: true)!;
      expect(item.isPending, isTrue);
      expect(item.applicantName, 'Dr Sample');
      expect(item.email, 'sample@example.invalid');
      expect(item.accountTypeLabel, 'Locum');
    });

    test(
      'uses actual Practice Owner submitted field names and safe fallbacks',
      () {
        final item = VerificationSubmission.tryParse(
          _submission(accountType: 'practice_owner', name: 'Vision Clinic'),
        )!;
        expect(item.applicantName, 'Vision Clinic');
        expect(item.email, 'office@example.invalid');
        expect(item.accountTypeLabel, 'Practice Owner');
        final malformed = VerificationSubmission.tryParse({
          ..._submission(),
          'submittedFields': {'fullName': 42},
          'document': null,
        })!;
        expect(malformed.applicantName, 'Locum');
        expect(malformed.document, isNull);
      },
    );
  });

  group('VerificationService', () {
    test(
      'parses pending queue response and sends account type filter',
      () async {
        Map<String, dynamic>? called;
        final service = VerificationService(
          callable: (name, data) async {
            expect(name, 'listPendingVerificationSubmissions');
            called = data;
            return {
              'items': [_submission()],
              'nextPageToken': 'cursor-1',
            };
          },
        );
        final page = await service.listPending(accountType: 'locum');
        expect(called?['accountType'], 'locum');
        expect(page.items.single.applicantName, 'Dr Sample');
        expect(page.items.single.isPending, isTrue);
        expect(page.nextPageToken, 'cursor-1');
      },
    );

    test(
      'keeps selected revision accessible and parses paginated history',
      () async {
        final selected = _submission(id: _bId);
        final older =
            _submission(id: _aId, state: 'submitted', status: 'rejected')
              ..['review'] = {
                'decision': 'rejected',
                'reviewedBy': 'admin-uid',
                'reviewedAt': '2026-01-03T03:04:05.000Z',
                'rejectionReason': 'Document is expired',
              };
        final service = VerificationService(
          callable: (name, data) async {
            expect(name, 'getVerificationSubmission');
            expect(data['submissionId'], _bId);
            expect(data['historyPageToken'], 'cursor-history');
            return {
              'submission': selected,
              'history': [older],
              'historyHasMore': true,
              'historyNextPageToken': 'cursor-next',
              'historyHasOmittedRecords': true,
              'historyOmittedCount': 1,
            };
          },
        );
        final (submission, history) = await service.getSubmission(
          uid: 'sample-user',
          submissionId: _bId,
          historyPageToken: 'cursor-history',
        );
        expect(submission.submissionId, _bId);
        expect(
          history.items.single.review?.rejectionReason,
          'Document is expired',
        );
        expect(history.hasMore, isTrue);
        expect(history.nextPageToken, 'cursor-next');
        expect(history.hasOmittedRecords, isTrue);
        expect(history.omittedCount, 1);
      },
    );

    test(
      'sends approval and rejection to review callable with exact contract',
      () async {
        final requests = <Map<String, dynamic>>[];
        final service = VerificationService(
          callable: (name, data) async {
            expect(name, 'reviewVerificationSubmission');
            requests.add(data);
            return <String, dynamic>{
              'uid': data['uid'],
              'submissionId': data['submissionId'],
              'decision': data['decision'],
            };
          },
        );
        await service.review(
          uid: 'sample-user',
          submissionId: _aId,
          decision: 'approved',
        );
        await service.review(
          uid: 'sample-user',
          submissionId: _bId,
          decision: 'rejected',
          rejectionReason: '  Expired certificate  ',
        );
        expect(requests.first['decision'], 'approved');
        expect(requests.last['decision'], 'rejected');
        expect(requests.last['rejectionReason'], '  Expired certificate  ');
        await expectLater(
          service.review(
            uid: 'sample-user',
            submissionId: _cId,
            decision: 'rejected',
            rejectionReason: '   ',
          ),
          throwsA(isA<VerificationException>()),
        );
      },
    );

    test(
      'private document request carries bearer token and exact identity',
      () async {
        http.Request? sent;
        final client = MockClient((request) async {
          sent = request;
          return http.Response.bytes(
            [37, 80, 68, 70, 45],
            200,
            headers: {'content-type': 'application/pdf'},
          );
        });
        final service = VerificationService(
          httpClient: client,
          tokenProvider: () async => 'fresh-id-token',
          backend: const BackendEndpoint(baseUrl: 'https://backend.example'),
        );
        final submission = VerificationSubmission.tryParse(_submission())!;
        final doc = await service.fetchDocument(submission);
        expect(sent!.url.queryParameters, {
          'uid': 'sample-user',
          'submissionId': _aId,
        });
        expect(sent!.headers['Authorization'], 'Bearer fresh-id-token');
        expect(doc.contentType, 'application/pdf');
        expect(utf8.decode(doc.bytes), '%PDF-');
      },
    );
  });

  testWidgets(
    'Verification section shows callable queue and submission detail',
    (tester) async {
      tester.view.physicalSize = const Size(1600, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final item = _submission();
      final service = VerificationService(
        callable: (name, data) async {
          if (name == 'listPendingVerificationSubmissions') {
            return {
              'items': [item],
              'nextPageToken': null,
            };
          }
          if (name == 'getVerificationSubmission') {
            return {
              'submission': item,
              'history': [item],
              'historyHasMore': false,
              'historyHasOmittedRecords': false,
              'historyOmittedCount': 0,
            };
          }
          throw StateError('Unexpected callable $name');
        },
        tokenProvider: () async => 'test-id-token',
        backend: const BackendEndpoint(baseUrl: 'https://backend.example'),
        httpClient: MockClient(
          (request) async => http.Response.bytes(
            [37, 80, 68, 70, 45],
            200,
            headers: {'content-type': 'application/pdf'},
          ),
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: VerificationManagementPage(service: service),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Dr Sample'), findsOneWidget);
      expect(find.text('Pending'), findsOneWidget);
      await tester.tap(find.text('View Details'));
      await tester.pumpAndSettle();
      expect(find.text('Applicant information'), findsOneWidget);
      expect(
        find.text(
          'MOC Registration Certificate and current APC (may be combined in one PDF)',
        ),
        findsOneWidget,
      );
      expect(find.text('990101010101'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
