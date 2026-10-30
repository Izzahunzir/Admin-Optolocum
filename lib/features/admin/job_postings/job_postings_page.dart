import 'package:flutter/material.dart';

import 'job_posting_table.dart';
import '../widgets/paginated_records.dart';
import 'job_posting.dart';
import 'job_posting_service.dart';

class JobPostingsPage extends StatelessWidget {
  const JobPostingsPage({
    super.key,
    required this.service,
    required this.query,
  });
  final JobPostingService service;
  final String query;

  @override
  Widget build(BuildContext context) {
    if (service.loading) {
      return const Padding(
        padding: EdgeInsets.all(48),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (service.errorMessage != null) {
      return Column(
        children: [
          Text(service.errorMessage!, textAlign: TextAlign.center),
          TextButton(onPressed: service.reload, child: const Text('Retry')),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (service.fromCache)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text(
              'Showing cached data while connecting to Firestore. Results may be incomplete.',
              style: TextStyle(fontSize: 12, color: Colors.blueGrey),
            ),
          ),
        PaginatedRecords<JobPosting>(
          records: service.jobs,
          query: query,
          emptyMessage: service.jobs.isEmpty
              ? 'No job postings available.'
              : 'No matching records.',
          matches: (job, query) => job.search.contains(query.toLowerCase()),
          tableBuilder: (accounts) => JobPostingTable(jobs: accounts),
        ),
      ],
    );
  }
}
