// Compatibility alias. Job data now comes from the read-only Firestore service.
import 'job_posting_service.dart';
export 'job_posting_service.dart';

typedef JobPostingStore = JobPostingService;
