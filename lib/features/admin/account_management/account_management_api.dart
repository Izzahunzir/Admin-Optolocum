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
  });
  final http.Client? client;
  final Future<String?> Function()? tokenProvider;
  final String baseUrl;

  // Phase 1 cannot be enabled by dart-define or a server response.
  bool get accountChangesEnabled => false;

  Future<Map<String, dynamic>> call(
    String uid,
    String kind,
    String action, {
    bool? disabled,
    bool? expectedDisabled,
    String? confirmUid,
  }) async {
    if (action != 'status') {
      throw const AccountManagementException(
        'failed-precondition',
        'Account changes are disabled in Phase 1 pending security and Firestore session-access verification.',
      );
    }
    final data = <String, dynamic>{'uid': uid, 'kind': kind, 'action': action};
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
