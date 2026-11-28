import 'dart:convert';

import '../backend_endpoint.dart';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class JobManagementApi {
  JobManagementApi({
    this.client,
    this.tokenProvider,
    this.enabled = const bool.fromEnvironment('FYP_JOB_SOFT_DELETE'),
    this.project = const String.fromEnvironment('FYP_DEMO_PROJECT'),
    this.baseUrl = const String.fromEnvironment('ADMIN_BACKEND_URL'),
  });
  final http.Client? client;
  final Future<String?> Function()? tokenProvider;
  final bool enabled;
  final String project, baseUrl;
  bool get configured =>
      enabled &&
      project == 'optolocum-f314e' &&
      (baseUrl.startsWith('https://') ||
          (const bool.fromEnvironment('FYP_USE_FIREBASE_EMULATORS') &&
              baseUrl == 'http://127.0.0.1:8787'));
  final Set<String> _approved = {};
  bool canChangeStatus(String id) => configured && _approved.contains(id);
  Future<Map<String, dynamic>> call(
    String id, {
    String action = 'status',
    String? expectedStatus,
  }) async {
    if (!['status', 'softDelete', 'restore'].contains(action) ||
        (action == 'status' && expectedStatus != null) ||
        (action != 'status' && expectedStatus == null) ||
        (action == 'restore' && expectedStatus != 'deleted')) {
      throw StateError('Invalid job status action.');
    }
    if (!configured || (action != 'status' && !canChangeStatus(id))) {
      throw StateError('Job status changes are off or not approved.');
    }
    if (!RegExp(r'^[a-zA-Z0-9_-]{1,128}$').hasMatch(id)) {
      throw StateError('Invalid job ID.');
    }
    final transport = client ?? http.Client();
    try {
      final token =
          await (tokenProvider?.call() ??
              FirebaseAuth.instance.currentUser?.getIdToken() ??
              Future<String?>.value());
      if (token == null || token.isEmpty) {
        throw StateError('Please sign in as an administrator.');
      }
      final request =
          http.Request(
              'POST',
              BackendEndpoint(
                baseUrl: baseUrl,
                localDemo: const bool.fromEnvironment(
                  'FYP_USE_FIREBASE_EMULATORS',
                ),
              ).uri('/api/jobs/soft-delete'),
            )
            ..followRedirects = false
            ..headers.addAll({
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            })
            ..body = jsonEncode({
              'jobId': id,
              'action': action,
              'expectedStatus': ?expectedStatus,
            });
      final response = await transport
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 20));
      final decoded = jsonDecode(response.body);
      if (response.statusCode != 200) {
        throw StateError(
          decoded is Map && decoded['error'] is Map
              ? decoded['error']['message'].toString()
              : 'Job action could not be confirmed. Refresh before retrying.',
        );
      }
      final data = decoded['data'];
      if (data is! Map ||
          data['status'] is! String ||
          data['mutationsEnabled'] is! bool ||
          (action == 'softDelete' && data['status'] != 'deleted') ||
          (action == 'restore' && data['status'] == 'deleted')) {
        throw StateError('Invalid job response.');
      }
      if (action != 'status' && data['mutationsEnabled'] != true) {
        throw StateError(
          'Job changes are unavailable. Refresh before retrying.',
        );
      }
      if (data['mutationsEnabled'] == true) {
        _approved.add(id);
      } else {
        _approved.remove(id);
      }
      return Map<String, dynamic>.from(data);
    } catch (_) {
      _approved.remove(id);
      rethrow;
    } finally {
      if (client == null) transport.close();
    }
  }
}
