import 'package:cloud_firestore/cloud_firestore.dart';

import '../widgets/account_record.dart';

/// Only the fields needed by the admin account table are retained.
class LocumProfile extends AccountRecord {
  LocumProfile(
    super.id,
    super.name,
    super.email,
    super.phone, {
    this.createdAt,
  });
  final DateTime? createdAt;

  factory LocumProfile.fromMap(String id, Map<String, dynamic> data) {
    String field(String key) {
      final value = data[key];
      return value is String && value.trim().isNotEmpty
          ? value.trim()
          : 'Not provided';
    }

    return LocumProfile(
      id,
      field('fullName'),
      field('email'),
      field('phoneNumber'),
      createdAt: data['createdAt'] is Timestamp
          ? (data['createdAt'] as Timestamp).toDate()
          : null,
    );
  }
}
