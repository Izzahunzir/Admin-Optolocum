// SDK query interfaces are implemented only as test doubles; no SDK behavior is inherited.
// ignore_for_file: subtype_of_sealed_class

import 'dart:async';

import 'package:admin_optolocum/features/admin/dashboard/application_statistics_service.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

class _Firestore implements FirebaseFirestore {
  final events = StreamController<QuerySnapshot<Map<String, dynamic>>>();
  int listenerCount = 0;
  @override
  CollectionReference<Map<String, dynamic>> collection(String path) {
    expect(path, 'applications');
    return _Collection(this);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Collection implements CollectionReference<Map<String, dynamic>> {
  _Collection(this.firestore);
  @override
  final _Firestore firestore;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #where) {
      expect(invocation.positionalArguments, ['status']);
      expect(invocation.namedArguments[#isEqualTo], 'pending');
      return _Query(firestore);
    }
    return super.noSuchMethod(invocation);
  }
}

class _Query implements Query<Map<String, dynamic>> {
  _Query(this.firestore);
  @override
  final _Firestore firestore;
  @override
  Stream<QuerySnapshot<Map<String, dynamic>>> snapshots({
    bool includeMetadataChanges = false,
    ListenSource source = ListenSource.defaultSource,
  }) {
    expect(includeMetadataChanges, isTrue);
    firestore.listenerCount++;
    return firestore.events.stream;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Snapshot implements QuerySnapshot<Map<String, dynamic>> {
  _Snapshot(this.size, {bool cached = false}) : metadata = _Metadata(cached);
  @override
  final int size;
  @override
  final SnapshotMetadata metadata;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Metadata implements SnapshotMetadata {
  _Metadata(this.isFromCache);
  @override
  final bool isFromCache;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> flush() => Future<void>.delayed(Duration.zero);

void main() {
  test(
    'counts only the pending query and updates through one listener',
    () async {
      final firestore = _Firestore();
      final service = ApplicationStatisticsService(firestore: firestore);
      expect(service.countText, '—');
      service.reload();
      expect(service.loading, isTrue);
      expect(service.statusText, 'Loading…');
      firestore.events.add(_Snapshot(3));
      await flush();
      expect(service.pendingCount, 3);
      expect(service.countText, '3');
      expect(service.statusText, 'Firestore total');
      firestore.events.add(_Snapshot(1));
      await flush();
      expect(service.pendingCount, 1);
      expect(firestore.listenerCount, 1);
      firestore.events.add(_Snapshot(0));
      await flush();
      expect(service.countText, '0');
      service.dispose();
      await firestore.events.close();
    },
  );

  test('empty cache is unknown and cached counts are labelled', () async {
    final firestore = _Firestore();
    final service = ApplicationStatisticsService(firestore: firestore)
      ..reload();
    firestore.events.add(_Snapshot(0, cached: true));
    await flush();
    expect(service.pendingCount, isNull);
    expect(service.countText, '—');
    expect(service.statusText, contains('Cached'));
    firestore.events.add(_Snapshot(2, cached: true));
    await flush();
    expect(service.countText, '2');
    expect(service.statusText, contains('incomplete'));
    firestore.events.add(_Snapshot(2));
    await flush();
    expect(service.statusText, 'Firestore total');
    service.dispose();
    await firestore.events.close();
  });

  test(
    'permission errors hide stale counts and disposal cancels updates',
    () async {
      final firestore = _Firestore();
      final service = ApplicationStatisticsService(firestore: firestore)
        ..reload();
      firestore.events.add(_Snapshot(4));
      await flush();
      firestore.events.addError(
        FirebaseException(plugin: 'cloud_firestore', code: 'permission-denied'),
      );
      await flush();
      expect(service.countText, '—');
      expect(service.pendingCount, isNull);
      expect(service.statusText, 'Access denied');
      service.dispose();
      firestore.events.add(_Snapshot(9));
      await flush();
      expect(service.pendingCount, isNull);
      await firestore.events.close();
    },
  );
}
