import 'package:cloud_firestore/cloud_firestore.dart';

import '../widgets/account_record.dart';

/// Only public account-table fields are retained from the profile document.
class PracticeOwnerProfile extends AccountRecord {
  PracticeOwnerProfile(
    super.id,
    super.name,
    super.email,
    super.phone,
    this.role, {
    this.createdAt,
  });
  final String role;
  final DateTime? createdAt;

  factory PracticeOwnerProfile.fromMap(String id, Map<String, dynamic> data) {
    String field(String key) {
      final value = data[key];
      return value is String && value.trim().isNotEmpty
          ? value.trim()
          : 'Not provided';
    }

    return PracticeOwnerProfile(
      id,
      field('fullName'),
      field('email'),
      field('phoneNumber'),
      field('role'),
      createdAt: data['createdAt'] is Timestamp
          ? (data['createdAt'] as Timestamp).toDate()
          : null,
    );
  }
}
