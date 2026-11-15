class VerificationDocumentMetadata {
  const VerificationDocumentMetadata({
    required this.path,
    required this.name,
    required this.contentType,
    required this.size,
    required this.sha256,
  });

  final String path;
  final String name;
  final String contentType;
  final int size;
  final String sha256;

  static VerificationDocumentMetadata? tryParse(Object? value) {
    if (value is! Map) return null;
    final map = Map<String, dynamic>.from(value);
    final path = map['path'];
    final name = map['name'];
    final contentType = map['contentType'];
    final size = map['size'];
    final sha256 = map['sha256'];
    if (path is! String ||
        name is! String ||
        contentType is! String ||
        size is! num ||
        sha256 is! String) {
      return null;
    }
    return VerificationDocumentMetadata(
      path: path,
      name: name,
      contentType: contentType,
      size: size.toInt(),
      sha256: sha256,
    );
  }
}

class VerificationReview {
  const VerificationReview({
    required this.decision,
    required this.reviewedBy,
    this.reviewedAt,
    this.rejectionReason,
  });

  final String decision;
  final String reviewedBy;
  final DateTime? reviewedAt;
  final String? rejectionReason;

  static VerificationReview? tryParse(Object? value) {
    if (value is! Map) return null;
    final map = Map<String, dynamic>.from(value);
    if (map['decision'] is! String || map['reviewedBy'] is! String) {
      return null;
    }
    return VerificationReview(
      decision: map['decision'] as String,
      reviewedBy: map['reviewedBy'] as String,
      reviewedAt: DateTime.tryParse('${map['reviewedAt'] ?? ''}'),
      rejectionReason: map['rejectionReason'] is String
          ? map['rejectionReason'] as String
          : null,
    );
  }
}

class VerificationSubmission {
  const VerificationSubmission({
    required this.uid,
    required this.submissionId,
    required this.accountType,
    required this.submittedFields,
    required this.submittedAt,
    required this.document,
    this.state,
    this.verificationStatus,
    this.review,
  });

  final String uid;
  final String submissionId;
  final String accountType;
  final Map<String, dynamic> submittedFields;
  final DateTime? submittedAt;
  final VerificationDocumentMetadata? document;
  final String? state;
  final String? verificationStatus;
  final VerificationReview? review;

  String get applicantName => _field(
    accountType == 'locum' ? 'fullName' : 'clinicName',
    fallback: accountType == 'practice_owner' ? 'Practice owner' : 'Locum',
  );
  String get email => _field(
    accountType == 'locum' ? 'email' : 'companyEmail',
    fallback: 'Not provided',
  );
  String get accountTypeLabel => accountType == 'practice_owner'
      ? 'Practice Owner'
      : accountType == 'locum'
      ? 'Locum'
      : 'Unknown';
  bool get isPending => verificationStatus == 'pending' && state == 'submitted';

  String _field(String key, {required String fallback}) {
    final value = submittedFields[key];
    return value is String && value.trim().isNotEmpty ? value.trim() : fallback;
  }

  static VerificationSubmission? tryParse(
    Object? value, {
    bool queueItem = false,
  }) {
    if (value is! Map) return null;
    final map = Map<String, dynamic>.from(value);
    final uid = map['uid'];
    final id = map['submissionId'];
    final type = map['accountType'];
    final fields = map['submittedFields'];
    final submittedAt = map['submittedAt'];
    if (uid is! String ||
        id is! String ||
        !['locum', 'practice_owner'].contains(type) ||
        fields is! Map) {
      return null;
    }
    final date = submittedAt is String ? DateTime.tryParse(submittedAt) : null;
    return VerificationSubmission(
      uid: uid,
      submissionId: id,
      accountType: type as String,
      submittedFields: Map<String, dynamic>.from(fields),
      submittedAt: date,
      document: VerificationDocumentMetadata.tryParse(map['document']),
      state: map['state'] is String
          ? map['state'] as String
          : queueItem
          ? 'submitted'
          : null,
      verificationStatus: map['verificationStatus'] is String
          ? map['verificationStatus'] as String
          : queueItem
          ? 'pending'
          : null,
      review: VerificationReview.tryParse(map['review']),
    );
  }
}

class VerificationHistoryPage {
  const VerificationHistoryPage({
    required this.items,
    required this.hasMore,
    required this.nextPageToken,
    required this.hasOmittedRecords,
    required this.omittedCount,
  });

  final List<VerificationSubmission> items;
  final bool hasMore;
  final String? nextPageToken;
  final bool hasOmittedRecords;
  final int omittedCount;
}
