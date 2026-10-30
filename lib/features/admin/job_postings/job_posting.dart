import 'package:cloud_firestore/cloud_firestore.dart';

/// Read-only projection of fields used by the admin job views.
class JobPosting {
  const JobPosting({
    required this.id,
    required this.practice,
    required this.role,
    required this.location,
    required this.jobDate,
    required this.startTime,
    required this.endTime,
    required this.payRate,
    required this.payRateUnit,
    required this.contactNumber,
    required this.status,
    required this.createdAt,
  });

  final String id,
      practice,
      role,
      location,
      startTime,
      endTime,
      payRateUnit,
      contactNumber,
      status;
  final DateTime? jobDate, createdAt;
  final double? payRate;

  factory JobPosting.fromMap(String id, Map<String, dynamic> data) {
    String field(String key) {
      final value = data[key];
      return value is String && value.trim().isNotEmpty
          ? value.trim()
          : 'Not provided';
    }

    DateTime? timestamp(String key) =>
        data[key] is Timestamp ? (data[key] as Timestamp).toDate() : null;
    final rate = data['payRate'];
    return JobPosting(
      id: id,
      practice: field('placeName'),
      role: field('role'),
      location: field('location'),
      jobDate: timestamp('jobDate'),
      startTime: field('startTime'),
      endTime: field('endTime'),
      payRate: rate is num && rate.isFinite && rate >= 0
          ? rate.toDouble()
          : null,
      payRateUnit: field('payRateUnit'),
      contactNumber: field('contactNumber'),
      status: field('status'),
      createdAt: timestamp('createdAt'),
    );
  }

  bool get isAvailable => status == 'available';

  String get date {
    final value = jobDate;
    if (value == null) return 'Not provided';
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${value.day} ${months[value.month - 1]} ${value.year}';
  }

  static String formatTime(String value) {
    final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(value);
    if (match == null) return 'Not provided';
    final hour = int.parse(match[1]!);
    final minute = int.parse(match[2]!);
    if (hour > 23 || minute > 59) return 'Not provided';
    return '${hour % 12 == 0 ? 12 : hour % 12}:${minute.toString().padLeft(2, '0')} ${hour < 12 ? 'AM' : 'PM'}';
  }

  String get timeRange => '${formatTime(startTime)} – ${formatTime(endTime)}';

  String get rate {
    final value = payRate;
    if (value == null) return 'Not provided';
    final amount = value == value.truncateToDouble()
        ? value.toStringAsFixed(0)
        : value.toStringAsFixed(2);
    final unit = switch (payRateUnit) {
      'per_hour' => '/hr',
      'per_day' => '/day',
      'per_shift' => '/shift',
      'Not provided' => ' (unit not provided)',
      _ => ' ($payRateUnit)',
    };
    return 'RM $amount$unit';
  }

  String get search =>
      '$id $practice $role $location $date $timeRange $rate $contactNumber'
          .toLowerCase();
}
