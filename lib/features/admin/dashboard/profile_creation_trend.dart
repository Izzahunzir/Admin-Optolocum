/// Calendar months use Malaysia time (UTC+8), independent of browser timezone.
/// Dates here describe Firestore profile creation, not Authentication signup.
class ProfileCreationTrend {
  ProfileCreationTrend._(this.months, this.counts, this.unknownDates);
  final List<DateTime> months;
  final List<int> counts;
  final int unknownDates;

  factory ProfileCreationTrend.calculate({
    required DateTime now,
    required Iterable<(String, DateTime?)> locums,
    required Iterable<(String, DateTime?)> owners,
  }) {
    DateTime malaysiaTime(DateTime value) =>
        value.toUtc().add(const Duration(hours: 8));
    final current = malaysiaTime(now);
    final months = List.generate(
      6,
      (i) => DateTime.utc(current.year, current.month - 5 + i),
    );
    final counts = List.filled(6, 0);
    int unknown = 0;
    // Deduplicate per collection: a UID in both collections represents two profiles.
    for (final profiles in [locums, owners]) {
      final unique = {for (final profile in profiles) profile.$1: profile.$2};
      for (final timestamp in unique.values) {
        if (timestamp == null) {
          unknown++;
          continue;
        }
        final date = malaysiaTime(timestamp);
        final index =
            (date.year - months.first.year) * 12 +
            date.month -
            months.first.month;
        if (index >= 0 && index < 6) counts[index]++;
      }
    }
    return ProfileCreationTrend._(months, counts, unknown);
  }
}
