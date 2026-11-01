import 'dart:async';
import 'dart:convert';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class AccountManagementException implements Exception {
  const AccountManagementException(this.code, this.message);
  final String code, message;
}

class AccountManagementApi {
  AccountManagementApi({
    this.client,
    this.tokenProvider,
    this.baseUrl = const String.fromEnvironment('ACCOUNT_API_BASE_URL'),
  }) : _mockTransport = null;

  /// In-memory testing only: this path never uses HTTP or Cloud Functions.
  @visibleForTesting
  AccountManagementApi.mock({
    required Future<Map<String, dynamic>> Function(Map<String, dynamic>, String)
    transport,
    required this.tokenProvider,
  }) : _mockTransport = transport,
       client = null,
       baseUrl = 'mock';

  final Future<Map<String, dynamic>> Function(Map<String, dynamic>, String)?
  _mockTransport;
  final http.Client? client;
  final Future<String?> Function()? tokenProvider;
  final String baseUrl;

  // Phase 1 cannot be enabled by dart-define or a server response.
  bool get accountChangesEnabled => _mockTransport != null;

  Future<Map<String, dynamic>> call(
    String uid,
    String kind,
    String action, {
    bool? disabled,
    bool? expectedDisabled,
    String? confirmUid,
  }) async {
    if (action != 'status' && _mockTransport == null) {
      throw const AccountManagementException(
        'failed-precondition',
        'Account changes are disabled in Phase 1 pending security and Firestore session-access verification.',
      );
    }
    final data = <String, dynamic>{'uid': uid, 'kind': kind, 'action': action};
    if (uid.isEmpty ||
        uid.length > 128 ||
        uid.contains('/') ||
        !['locum', 'practice_owner'].contains(kind) ||
        !['status', 'setDisabled', 'delete'].contains(action) ||
        (action == 'status' &&
            (disabled != null ||
                expectedDisabled != null ||
                confirmUid != null)) ||
        (action == 'setDisabled' &&
            (disabled == null ||
                expectedDisabled == null ||
                disabled == expectedDisabled ||
                confirmUid != null)) ||
        (action == 'delete' &&
            (confirmUid != uid ||
                disabled != null ||
                expectedDisabled != null))) {
      throw const AccountManagementException(
        'invalid-argument',
        'Invalid account request.',
      );
    }
    if (action == 'setDisabled') {
      data.addAll({'disabled': disabled, 'expectedDisabled': expectedDisabled});
    }
    if (action == 'delete') data['confirmUid'] = confirmUid;
    if (_mockTransport != null) {
      try {
        final token = await tokenProvider!();
        if (token == null || token.isEmpty) {
          throw const AccountManagementException(
            'unauthenticated',
            'Please sign in as an administrator.',
          );
        }
        final result = await _mockTransport(
          data,
          token,
        ).timeout(const Duration(seconds: 20));
        if (action == 'delete'
            ? result['deleted'] != true
            : result['disabled'] is! bool ||
                  (action == 'setDisabled' && result['disabled'] != disabled)) {
          throw const AccountManagementException(
            'internal',
            'Invalid response from the test backend.',
          );
        }
        return result;
      } on FirebaseAuthException {
        throw const AccountManagementException(
          'unauthenticated',
          'Please sign out and sign in again.',
        );
      } on TimeoutException {
        throw const AccountManagementException(
          'unavailable',
          'Account action timed out. Refresh status before retrying.',
        );
      }
    }
    if (baseUrl.isEmpty) {
      try {
        final result = await FirebaseFunctions.instanceFor(
          region: 'asia-southeast1',
        ).httpsCallable('manageAccount').call<dynamic>(data);
        return Map<String, dynamic>.from(result.data as Map);
      } on FirebaseFunctionsException catch (error) {
        throw AccountManagementException(
          error.code,
          error.message ?? 'Account status unavailable.',
        );
      }
    }
    final base = Uri.tryParse(baseUrl);
    if (base == null ||
        base.scheme != 'http' ||
        base.host != '127.0.0.1' ||
        base.port != 8787 ||
        base.userInfo.isNotEmpty ||
        (base.path.isNotEmpty && base.path != '/') ||
        base.hasQuery ||
        base.hasFragment) {
      throw const AccountManagementException(
        'invalid-argument',
        'The local API URL must be http://127.0.0.1:8787.',
      );
    }
    if (kIsWeb && Uri.base.origin != 'http://localhost:5173') {
      throw const AccountManagementException(
        'origin-not-allowed',
        'Open the dashboard at http://localhost:5173 to use the local status API.',
      );
    }
    final String? token;
    try {
      token =
          await (tokenProvider?.call() ??
              FirebaseAuth.instance.currentUser?.getIdToken() ??
              Future<String?>.value());
    } on FirebaseAuthException {
      throw const AccountManagementException(
        'unauthenticated',
        'Your administrator session is unavailable. Please sign out and sign in again.',
      );
    }
    if (token == null || token.isEmpty) {
      throw const AccountManagementException(
        'unauthenticated',
        'Please sign in as an administrator.',
      );
    }
    final requestClient = client ?? http.Client();
    try {
      final request = http.Request('POST', base.resolve('/api/accounts/manage'))
        ..followRedirects = false
        ..headers.addAll({
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        })
        ..body = jsonEncode(data);
      final response = await requestClient
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 20));
      final decoded = jsonDecode(response.body);
      if (decoded is! Map) throw const FormatException();
      if (response.statusCode != 200) {
        final error = decoded['error'];
        if (error is Map &&
            error['code'] is String &&
            error['message'] is String) {
          throw AccountManagementException(
            error['code'] as String,
            error['message'] as String,
          );
        }
        throw const FormatException();
      }
      final result = decoded['data'];
      if (result is! Map ||
          result['disabled'] is! bool ||
          result['mutationsEnabled'] != false) {
        throw const FormatException();
      }
      return Map<String, dynamic>.from(result);
    } on TimeoutException {
      throw const AccountManagementException(
        'unavailable',
        'Local server timed out. Check that it is running.',
      );
    } on http.ClientException {
      throw const AccountManagementException(
        'unavailable',
        'Cannot reach the local status API. Check the server, http://localhost:5173 origin, CORS and Chrome local-network permissions.',
      );
    } on FormatException {
      throw const AccountManagementException(
        'internal',
        'Invalid response from the local server.',
      );
    } finally {
      if (client == null) requestClient.close();
    }
  }
}
