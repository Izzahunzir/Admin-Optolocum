
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'verification_submission.dart';

const _localApiBaseUrl = 'http://127.0.0.1:8787';

const _verificationQueuePath = '/api/verification/queue';
const _verificationDetailsPath = '/api/verification/details';
const _verificationReviewPath = '/api/verification/review';
const _verificationDocumentPath = '/api/verification/document';

class VerificationException implements Exception {
  const VerificationException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => message;
}

class VerificationQueuePage {
  const VerificationQueuePage({
    required this.items,
    this.nextPageToken,
  });

  final List<VerificationSubmission> items;
  final String? nextPageToken;
}

class PrivateVerificationDocument {
  const PrivateVerificationDocument({
    required this.bytes,
    required this.contentType,
    required this.name,
  });

  final Uint8List bytes;
  final String contentType;
  final String name;
}

typedef VerificationCallable = Future<dynamic> Function(
  String name,
  Map<String, dynamic> data,
);

class VerificationService {
  VerificationService({
    this.callable,
    this.httpClient,
    this.tokenProvider,
    this.documentBaseUrl = '',
  });

  final VerificationCallable? callable;
  final http.Client? httpClient;
  final Future<String?> Function()? tokenProvider;
  final String documentBaseUrl;

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  Future<String> _requireToken() async {
    final String? token;

    try {
      if (tokenProvider != null) {
        token = await tokenProvider!.call();
      } else {
        token = await FirebaseAuth.instance.currentUser?.getIdToken();
      }
    } on FirebaseAuthException {
      throw const VerificationException(
        'unauthenticated',
        'Your administrator session expired. Sign in again.',
      );
    }

    if (token == null || token.isEmpty) {
      throw const VerificationException(
        'unauthenticated',
        'Please sign in as an administrator.',
      );
    }

    return token;
  }

  // ---------------------------------------------------------------------------
  // Local API URL
  // ---------------------------------------------------------------------------

  Uri _apiUri(String path) {
    final base = Uri.tryParse(_localApiBaseUrl);

    if (base == null ||
        base.scheme != 'http' ||
        base.host != '127.0.0.1' ||
        base.port != 8787 ||
        base.path.isNotEmpty ||
        base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment) {
      throw const VerificationException(
        'failed-precondition',
        'The local verification API URL is invalid.',
      );
    }

    return base.replace(path: path);
  }

  // ---------------------------------------------------------------------------
  // Authenticated POST requests
  // ---------------------------------------------------------------------------

  Future<dynamic> _call(
    String path,
    Map<String, dynamic> data, {
    required String callableName,
  }) async {
    // Preserve callable injection for existing unit tests.
    if (callable != null) {
      return await callable!(callableName, data);
    }

    final token = await _requireToken();
    final client = httpClient ?? http.Client();

    try {
      final response = await client
          .post(
            _apiUri(path),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode(data),
          )
          .timeout(const Duration(seconds: 45));

      if (response.statusCode != 200) {
        throw _httpError(
          response.statusCode,
          response.bodyBytes,
        );
      }

      final decoded = jsonDecode(
        utf8.decode(response.bodyBytes),
      );

      if (decoded is! Map || !decoded.containsKey('data')) {
        throw const VerificationException(
          'internal',
          'The verification service returned an unexpected response.',
        );
      }

      return decoded['data'];
    } on TimeoutException {
      throw const VerificationException(
        'deadline-exceeded',
        'The verification service took too long. Please retry.',
      );
    } on http.ClientException {
      throw const VerificationException(
        'unavailable',
        'The local verification API could not be reached. Check that the local server is running.',
      );
    } on FormatException {
      throw const VerificationException(
        'internal',
        'The verification service returned an invalid response.',
      );
    } finally {
      if (httpClient == null) {
        client.close();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Verification queue
  // ---------------------------------------------------------------------------

  Future<VerificationQueuePage> listPending({
    String? accountType,
    String? pageToken,
    int pageSize = 25,
  }) async {
    final raw = await _call(
      _verificationQueuePath,
      {
        'accountType': ?accountType,
        'pageToken': ?pageToken,
        'pageSize': pageSize,
      },
      callableName: 'listPendingVerificationSubmissions',
    );

    if (raw is! Map || raw['items'] is! List) {
      throw const VerificationException(
        'internal',
        'The verification queue returned an unexpected response.',
      );
    }

    final items = (raw['items'] as List)
        .map(
          (value) => VerificationSubmission.tryParse(
            value,
            queueItem: true,
          ),
        )
        .whereType<VerificationSubmission>()
        .where((item) => item.isPending)
        .toList(growable: false);

    return VerificationQueuePage(
      items: items,
      nextPageToken: raw['nextPageToken'] is String
          ? raw['nextPageToken'] as String
          : null,
    );
  }

  // ---------------------------------------------------------------------------
  // Submission details and history
  // ---------------------------------------------------------------------------

  Future<(VerificationSubmission, VerificationHistoryPage)>
      getSubmission({
    required String uid,
    required String submissionId,
    String? historyPageToken,
    int historyPageSize = 25,
  }) async {
    final raw = await _call(
      _verificationDetailsPath,
      {
        'uid': uid,
        'submissionId': submissionId,
        'historyPageSize': historyPageSize,
        'historyPageToken': ?historyPageToken,
      },
      callableName: 'getVerificationSubmission',
    );

    if (raw is! Map) {
      throw const VerificationException(
        'internal',
        'The submission details returned an unexpected response.',
      );
    }

    final selected = VerificationSubmission.tryParse(
      raw['submission'],
    );

    if (selected == null) {
      throw const VerificationException(
        'failed-precondition',
        'Submission details are missing or malformed.',
      );
    }

    final rawHistory = raw['history'];

    final parsed = rawHistory is List
        ? rawHistory
            .map(VerificationSubmission.tryParse)
            .whereType<VerificationSubmission>()
            .toList(growable: false)
        : const <VerificationSubmission>[];

    final omitted = raw['historyOmittedCount'] is num
        ? (raw['historyOmittedCount'] as num).toInt()
        : 0;

    return (
      selected,
      VerificationHistoryPage(
        items: parsed,
        hasMore: raw['historyHasMore'] == true,
        nextPageToken: raw['historyNextPageToken'] is String
            ? raw['historyNextPageToken'] as String
            : null,
        hasOmittedRecords:
            raw['historyHasOmittedRecords'] == true || omitted > 0,
        omittedCount: omitted,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Approve or reject a verification submission
  // ---------------------------------------------------------------------------

  Future<void> review({
    required String uid,
    required String submissionId,
    required String decision,
    String? rejectionReason,
  }) async {
    if (!['approved', 'rejected'].contains(decision) ||
        (decision == 'rejected' &&
            (rejectionReason == null ||
                rejectionReason.trim().isEmpty))) {
      throw const VerificationException(
        'invalid-argument',
        'Choose a valid decision and provide a rejection reason when rejecting.',
      );
    }

    await _call(
      _verificationReviewPath,
      {
        'uid': uid,
        'submissionId': submissionId,
        'decision': decision,
        'rejectionReason': ?rejectionReason,
      },
      callableName: 'reviewVerificationSubmission',
    );
  }

  // ---------------------------------------------------------------------------
  // Load private verification documents
  // ---------------------------------------------------------------------------

  Future<PrivateVerificationDocument> fetchDocument(
    VerificationSubmission submission,
  ) async {
    final metadata = submission.document;

    if (metadata == null ||
        ![
          'application/pdf',
          'image/png',
          'image/jpeg',
        ].contains(metadata.contentType)) {
      throw const VerificationException(
        'failed-precondition',
        'This submission has no supported verification document.',
      );
    }

    final token = await _requireToken();

    final uri = _documentUri(
      submission.uid,
      submission.submissionId,
    );

    final client = httpClient ?? http.Client();

    try {
      final request = http.Request('GET', uri)
        ..followRedirects = false
        ..headers['Authorization'] = 'Bearer $token';

      final response = await client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 45));

      if (response.statusCode != 200) {
        throw _httpError(
          response.statusCode,
          response.bodyBytes,
        );
      }

      final returnedType =
          response.headers['content-type']?.split(';').first;

      if (returnedType != metadata.contentType ||
          response.bodyBytes.isEmpty) {
        throw const VerificationException(
          'failed-precondition',
          'The private document response did not match the submission.',
        );
      }

      return PrivateVerificationDocument(
        bytes: response.bodyBytes,
        contentType: returnedType!,
        name: metadata.name,
      );
    } on TimeoutException {
      throw const VerificationException(
        'deadline-exceeded',
        'Document loading timed out. Please retry.',
      );
    } on http.ClientException {
      throw const VerificationException(
        'unavailable',
        'The private document endpoint could not be reached.',
      );
    } finally {
      if (httpClient == null) {
        client.close();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private document URL
  // ---------------------------------------------------------------------------

  Uri _documentUri(String uid, String submissionId) {
    final configured = documentBaseUrl.trim();

    final base = configured.isEmpty
        ? _defaultDocumentEndpoint()
        : Uri.tryParse(configured);

    if (base == null ||
        base.scheme != 'http' ||
        base.host != '127.0.0.1' ||
        base.port != 8787 ||
        base.path != _verificationDocumentPath ||
        base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment) {
      throw const VerificationException(
        'failed-precondition',
        'The local private document endpoint is not configured correctly.',
      );
    }

    return base.replace(
      queryParameters: {
        'uid': uid,
        'submissionId': submissionId,
      },
    );
  }

  Uri _defaultDocumentEndpoint() {
    return Uri.parse(
      '$_localApiBaseUrl$_verificationDocumentPath',
    );
  }

  // ---------------------------------------------------------------------------
  // HTTP error handling
  // ---------------------------------------------------------------------------

  VerificationException _httpError(
    int status,
    List<int> body,
  ) {
    try {
      final decoded = jsonDecode(utf8.decode(body));

      if (decoded is Map && decoded['error'] is Map) {
        final error = decoded['error'] as Map;
        final code = error['code'];
        final message = error['message'];

        if (code is String && message is String) {
          return VerificationException(code, message);
        }
      }
    } catch (_) {
      // Keep the endpoint error generic if the response is malformed.
    }

    return VerificationException(
      'http-$status',
      status == 403
          ? 'Access to this private document was denied. Check your admin session and dashboard origin.'
          : 'The private document could not be loaded (HTTP $status).',
    );
  }
}