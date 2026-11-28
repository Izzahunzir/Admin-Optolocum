import 'dart:async';
import 'dart:convert';

import '../backend_endpoint.dart';

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
    this.baseUrl = const String.fromEnvironment('ADMIN_BACKEND_URL'),
    this.demoMutations = const bool.fromEnvironment('FYP_DEMO_MUTATIONS'),
    this.demoProject = const String.fromEnvironment('FYP_DEMO_PROJECT'),
  }) : _mockTransport = null;

  /// In-memory testing only: this path never uses HTTP or Cloud Functions.
  @visibleForTesting
  AccountManagementApi.mock({
    required Future<Map<String, dynamic>> Function(Map<String, dynamic>, String)
    transport,
    required this.tokenProvider,
  }) : _mockTransport = transport,
       client = null,
       demoMutations = false,
       demoProject = '',
       baseUrl = 'mock';

  final Future<Map<String, dynamic>> Function(Map<String, dynamic>, String)?
  _mockTransport;
  final http.Client? client;
  final Future<String?> Function()? tokenProvider;
  final String baseUrl;
  final bool demoMutations;
  final String demoProject;
  final Set<(String, String)> _approvedTargets = {};

  bool get deletionEnabled => _mockTransport != null;

  // Both the explicit build gate and per-target backend approval are required.
  bool get accountChangesEnabled =>
      _mockTransport != null ||
      (demoMutations &&
          demoProject == 'optolocum-f314e' &&
          (baseUrl.startsWith('https://') ||
              (const bool.fromEnvironment('FYP_USE_FIREBASE_EMULATORS') &&
                  baseUrl == 'http://127.0.0.1:8787')));
  bool canManage(String uid, String kind) =>
      _mockTransport != null ||
      (accountChangesEnabled && _approvedTargets.contains((uid, kind)));

  Future<Map<String, dynamic>> call(
    String uid,
    String kind,
    String action, {
    bool? disabled,
    bool? expectedDisabled,
    String? confirmUid,
  }) async {
    if (action == 'delete' && !deletionEnabled) {
      throw const AccountManagementException(
        'permission-denied',
        'Delete is blocked during the supervised Disable/Enable-only demo.',
      );
    }
    if (action != 'status' && !canManage(uid, kind)) {
      throw const AccountManagementException(
        'failed-precondition',
        'Account changes are off or this account is not approved for the supervised demo.',
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
    final Uri endpoint;
    try {
      endpoint = BackendEndpoint(
        baseUrl: baseUrl,
        localDemo: const bool.fromEnvironment('FYP_USE_FIREBASE_EMULATORS'),
      ).uri('/api/accounts/manage');
    } on StateError {
      throw const AccountManagementException(
        'failed-precondition',
        'The HTTPS account backend is not configured.',
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
      final request = http.Request('POST', endpoint)
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
          result['mutationsEnabled'] is! bool ||
          (action == 'delete'
              ? result['deleted'] != true
              : result['disabled'] is! bool) ||
          (action == 'setDisabled' && result['disabled'] != disabled)) {
        throw const FormatException();
      }
      if (action != 'status' && result['mutationsEnabled'] != true) {
        throw const AccountManagementException(
          'failed-precondition',
          'Account changes are unavailable. Refresh status before retrying.',
        );
      }
      if (accountChangesEnabled &&
          result['mutationsEnabled'] == true &&
          action != 'delete') {
        _approvedTargets.add((uid, kind));
      } else {
        _approvedTargets.remove((uid, kind));
      }
      return Map<String, dynamic>.from(result);
    } on TimeoutException {
      _approvedTargets.remove((uid, kind));
      throw const AccountManagementException(
        'unavailable',
        'Account service timed out. Refresh status before retrying.',
      );
    } on http.ClientException {
      _approvedTargets.remove((uid, kind));
      throw const AccountManagementException(
        'unavailable',
        'The account service could not be reached.',
      );
    } on FormatException {
      _approvedTargets.remove((uid, kind));
      throw const AccountManagementException(
        'internal',
        'Invalid response from the account service.',
      );
    } on AccountManagementException {
      _approvedTargets.remove((uid, kind));
      rethrow;
    } finally {
      if (client == null) requestClient.close();
    }
  }
}
