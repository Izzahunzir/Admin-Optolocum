import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'practice_owner_profile.dart';

class PracticeOwnerService extends ChangeNotifier {
  PracticeOwnerService({this.firestore});

  final FirebaseFirestore? firestore;
  List<PracticeOwnerProfile> accounts = [];
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subscription;
  bool loading = true;
  bool fromCache = false;
  String? errorMessage;
  bool _disposed = false;

  void _update(VoidCallback update) {
    if (_disposed) return;
    update();
    notifyListeners();
  }

  void reload() {
    _update(() {
      loading = true;
      errorMessage = null;
    });
    _subscription?.cancel();
    _subscription = (firestore ?? FirebaseFirestore.instance)
        .collection('practice_owner_profiles')
        .snapshots(includeMetadataChanges: true)
        .listen(
          (snapshot) {
            if (_disposed) return;
            final accounts =
                snapshot.docs
                    .map(
                      (doc) => PracticeOwnerProfile.fromMap(doc.id, doc.data()),
                    )
                    .toList()
                  ..sort((a, b) => a.id.compareTo(b.id));
            _update(() {
              this.accounts = accounts;
              loading = false;
              errorMessage = null;
              fromCache = snapshot.metadata.isFromCache;
            });
          },
          onError: (Object error) {
            if (_disposed) return;
            _update(() {
              loading = false;
              errorMessage = switch (error) {
                FirebaseException(code: 'permission-denied') =>
                  'You do not have permission to view practice owner accounts.',
                FirebaseException(code: 'unavailable') => 'Unable to connect to Firestore. Check your connection and retry.',
                _ =>
                  'Unable to load practice owner accounts. Please try again.',
              };
            });
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
