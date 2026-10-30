import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'job_posting.dart';

class JobPostingService extends ChangeNotifier {
  JobPostingService({this.firestore});

  final FirebaseFirestore? firestore;
  List<JobPosting> jobs = [];
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subscription;
  bool loading = true;
  bool fromCache = false;
  String? errorMessage;
  bool _disposed = false;

  int get availableCount => jobs.where((job) => job.isAvailable).length;

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
        .collection('job_postings')
        .snapshots(includeMetadataChanges: true)
        .listen(
          (snapshot) {
            if (_disposed) return;
            final jobs =
                snapshot.docs
                    .map((doc) => JobPosting.fromMap(doc.id, doc.data()))
                    .toList()
                  ..sort((a, b) {
                    final order =
                        (b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0))
                            .compareTo(
                              a.createdAt ??
                                  DateTime.fromMillisecondsSinceEpoch(0),
                            );
                    return order == 0 ? a.id.compareTo(b.id) : order;
                  });
            _update(() {
              this.jobs = jobs;
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
                  'You do not have permission to view job postings.',
                FirebaseException(code: 'unavailable') => 'Unable to connect to Firestore. Check your connection and retry.',
                _ => 'Unable to load job postings. Please try again.',
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
