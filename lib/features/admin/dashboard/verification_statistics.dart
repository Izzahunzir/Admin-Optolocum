/// Verification categories are independent of Firebase Authentication activation.
class VerificationStatistics {
  VerificationStatistics(Iterable<Object?> statuses) {
    for (final status in statuses) {
      if (status is! String || status.trim().isEmpty) {
        unknown++;
      } else {
        switch (status) {
          case 'verified':
          case 'approved':
            verified++;
          case 'pending':
            pending++;
          case 'rejected':
            rejected++;
          case 'unverified':
            unverified++;
          default:
            other++;
        }
      }
    }
  }

  int verified = 0,
      pending = 0,
      rejected = 0,
      unverified = 0,
      unknown = 0,
      other = 0;
  int get total => verified + pending + rejected + unverified + unknown + other;
  double get verifiedFraction => total == 0 ? 0 : verified / total;
  String get counts =>
      'Total $total · Verified $verified · Pending $pending · Rejected $rejected · Unverified $unverified · Unknown $unknown · Other $other';
}
