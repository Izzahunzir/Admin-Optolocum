import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'profile_creation_trend.dart';

class ProfileRegistrationTrend extends StatelessWidget {
  const ProfileRegistrationTrend({
    super.key,
    required this.locums,
    required this.owners,
    required this.loading,
    required this.errorMessage,
    required this.fromCache,
    this.now,
  });
  final Iterable<(String, DateTime?)> locums, owners;
  final bool loading, fromCache;
  final String? errorMessage;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final trend = ProfileCreationTrend.calculate(
      now: now ?? DateTime.now(),
      locums: locums,
      owners: owners,
    );
    const names = [
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
    final maximum = trend.counts.fold<int>(1, math.max);
    return Column(
      children: [
        const Text(
          'Combined profile creations · MYT (UTC+8)',
          style: TextStyle(fontSize: 11, color: Colors.blueGrey),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        SizedBox(
          height: 140,
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : errorMessage != null
              ? Center(
                  child: Text(
                    'Profile trend unavailable.\n$errorMessage',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Colors.blueGrey,
                    ),
                  ),
                )
              : Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    for (int i = 0; i < 6; i++)
                      Tooltip(
                        message:
                            '${names[trend.months[i].month - 1]} ${trend.months[i].year}: ${trend.counts[i]} profile creations${fromCache ? ' (cached)' : ''}',
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            Text(
                              '${trend.counts[i]}',
                              style: const TextStyle(fontSize: 10),
                            ),
                            const SizedBox(height: 4),
                            Container(
                              width: 16,
                              height: trend.counts[i] / maximum * 95,
                              decoration: BoxDecoration(
                                color: const Color(0xFF3D7789),
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              names[trend.months[i].month - 1],
                              style: const TextStyle(fontSize: 10),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        if (!loading && errorMessage == null) ...[
          const SizedBox(height: 8),
          Text(
            fromCache
                ? 'Cached data · May be incomplete'
                : 'Firestore profile creation counts',
            style: const TextStyle(fontSize: 10, color: Colors.blueGrey),
            textAlign: TextAlign.center,
          ),
          if (trend.unknownDates > 0)
            Text(
              '${trend.unknownDates} profiles excluded: creation date unknown.',
              style: const TextStyle(fontSize: 10, color: Colors.blueGrey),
              textAlign: TextAlign.center,
            ),
        ],
      ],
    );
  }
}
