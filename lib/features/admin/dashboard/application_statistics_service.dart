import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

/// Read-only statistics for the dashboard's pending application card.
class ApplicationStatisticsService extends ChangeNotifier {
  ApplicationStatisticsService({this.firestore});

  final FirebaseFirestore? firestore;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subscription;
  int? pendingCount;
  bool loading = true;
  bool fromCache = false;
  String? errorMessage;
  bool _disposed = false;
  int _generation = 0;

  String get countText =>
      loading || errorMessage != null || pendingCount == null
      ? '—'
      : '$pendingCount';

  String get statusText {
    if (loading) return 'Loading…';
    if (errorMessage != null) return errorMessage!;
    return fromCache ? 'Cached · May be incomplete' : 'Firestore total';
  }

  void reload() {
    final generation = ++_generation;
    _subscription?.cancel();
    loading = true;
    pendingCount = null;
    errorMessage = null;
    fromCache = false;
    notifyListeners();
    _subscription = (firestore ?? FirebaseFirestore.instance)
        .collection('applications')
        .where('status', isEqualTo: 'pending')
        .snapshots(includeMetadataChanges: true)
        .listen(
          (snapshot) {
            if (_disposed || generation != _generation) return;
            fromCache = snapshot.metadata.isFromCache;
            // An empty local cache does not establish that the server has no records.
            pendingCount = fromCache && snapshot.size == 0
                ? null
                : snapshot.size;
            loading = false;
            errorMessage = null;
            notifyListeners();
          },
          onError: (Object error) {
            if (_disposed || generation != _generation) return;
            loading = false;
            pendingCount = null;
            errorMessage = switch (error) {
              FirebaseException(code: 'permission-denied') => 'Access denied',
              FirebaseException(code: 'unavailable') =>
                'Connection unavailable',
              _ => 'Count unavailable',
            };
            notifyListeners();
          },
        );
  }

  @override
  void dispose() {
    _disposed = true;
    _subscription?.cancel();
    super.dispose();
  }
}
