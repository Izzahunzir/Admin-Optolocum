import 'package:flutter/material.dart';

import 'application_statistics_service.dart';
import 'profile_registration_trend.dart';

import '../locums/locum_service.dart';
import '../practice_owners/practice_owner_service.dart';
import '../job_postings/job_posting_service.dart';
import '../widgets/account_record.dart';

const _teal = Color(0xFF3D7789);

class DashboardPage extends StatelessWidget {
  const DashboardPage({
    super.key,
    required this.locums,
    required this.owners,
    required this.postings,
    required this.applications,
    required this.query,
    required this.onNavigate,
  });
  final LocumService locums;
  final PracticeOwnerService owners;
  final JobPostingService postings;
  final ApplicationStatisticsService applications;
  final String query;
  final ValueChanged<int> onNavigate;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final width = constraints.maxWidth;
      final columns = width >= 1000
          ? 4
          : width >= 500
          ? 2
          : 1;
      final items = [
        (
          'Total Locum Accounts',
          locums.loading || locums.errorMessage != null
              ? '—'
              : '${locums.profiles.length}',
          Icons.person,
          const Color(0xFFE4F3EF),
          _teal,
          2,
        ),
        (
          'Total Practice Owners',
          owners.loading || owners.errorMessage != null
              ? '—'
              : '${owners.accounts.length}',
          Icons.medical_services,
          const Color(0xFFCEE5EE),
          const Color(0xFF18546A),
          1,
        ),
        (
          'Active Job Postings',
          postings.loading || postings.errorMessage != null
              ? '—'
              : '${postings.availableCount}',
          Icons.work,
          const Color(0xFFF8DCBC),
          const Color(0xFFEF8300),
          3,
        ),
        (
          'Pending Applications',
          applications.countText,
          Icons.hourglass_top,
          const Color(0xFFEFC1BE),
          const Color(0xFFC62828),
          0,
        ),
      ];
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 14,
            runSpacing: 14,
            children: [
              for (final item in items)
                SizedBox(
                  width: (width - (columns - 1) * 14) / columns,
                  child: Material(
                    color: item.$4,
                    borderRadius: BorderRadius.circular(6),
                    child: InkWell(
                      onTap: item.$6 == 0 ? null : () => onNavigate(item.$6),
                      child: Padding(
                        padding: const EdgeInsets.all(18),
                        child: Row(
                          children: [
                            Icon(item.$3, size: 36, color: item.$5),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.$1,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 5),
                                  Text(
                                    item.$2,
                                    style: const TextStyle(
                                      fontSize: 26,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    item.$6 == 0
                                        ? applications.statusText
                                        : item.$6 == 3 && postings.fromCache
                                        ? 'Cached Firestore total'
                                        : 'Firestore total',
                                    style: const TextStyle(fontSize: 10),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: [
              SizedBox(
                width: width >= 760 ? (width - 32) / 3 : width,
                child: _panel(
                  'User Registration Trend',
                  ProfileRegistrationTrend(
                    locums: locums.profiles.map((p) => (p.id, p.createdAt)),
                    owners: owners.accounts.map((p) => (p.id, p.createdAt)),
                    loading: locums.loading || owners.loading,
                    errorMessage: locums.errorMessage ?? owners.errorMessage,
                    fromCache: locums.fromCache || owners.fromCache,
                  ),
                ),
              ),
              SizedBox(
                width: width >= 760 ? (width - 32) / 3 : width,
                child: _panel(
                  'Job Posting Overview',
                  Column(
                    children: [
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 110,
                        width: 110,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            SizedBox.expand(
                              child: CircularProgressIndicator(
                                value: postings.jobs.isEmpty
                                    ? 0
                                    : postings.availableCount /
                                          postings.jobs.length,
                                strokeWidth: 13,
                                color: _teal,
                              ),
                            ),
                            Text(
                              postings.loading || postings.errorMessage != null
                                  ? '—'
                                  : '${postings.availableCount}',
                              style: const TextStyle(
                                fontSize: 28,
                                fontWeight: FontWeight.bold,
                                color: _teal,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 28),
                      Text(
                        postings.loading
                            ? 'Loading job postings…'
                            : postings.errorMessage != null
                            ? 'Job postings unavailable'
                            : postings.fromCache
                            ? 'Available postings (cached)'
                            : 'Available postings',
                        style: const TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
              SizedBox(
                width: width >= 760 ? (width - 32) / 3 : width,
                child: _panel(
                  'Account Overview',
                  Column(
                    children: [
                      _accountSummary('Locums', locums.profiles),
                      const SizedBox(height: 20),
                      _accountSummary('Practice owners', owners.accounts),
                      const SizedBox(height: 14),
                      const Text(
                        'Account management is not connected',
                        style: TextStyle(fontSize: 11, color: Colors.blueGrey),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: [
              SizedBox(
                width: width >= 760 ? (width - 16) / 2 : width,
                child: _panel(
                  'Recent Job Postings',
                  Column(
                    children: [
                      if (postings.loading)
                        const Center(child: CircularProgressIndicator())
                      else if (postings.errorMessage != null)
                        Text(postings.errorMessage!)
                      else
                        for (final job
                            in postings.jobs
                                .where((j) => j.search.contains(query))
                                .take(3))
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            dense: true,
                            leading: const Icon(
                              Icons.work_outline,
                              color: _teal,
                            ),
                            title: Text(job.practice),
                            subtitle: Text('${job.location} | ${job.date}'),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => onNavigate(3),
                          ),
                      if (!postings.loading &&
                          postings.errorMessage == null &&
                          postings.jobs
                              .where((j) => j.search.contains(query))
                              .isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(24),
                          child: Text('No matching postings.'),
                        ),
                      TextButton(
                        onPressed: () => onNavigate(3),
                        child: const Text('View all job postings'),
                      ),
                    ],
                  ),
                ),
              ),
              SizedBox(
                width: width >= 760 ? (width - 16) / 2 : width,
                child: _panel(
                  'Quick Actions',
                  Column(
                    children: [
                      _quickAction('Manage locum accounts', Icons.person, 2),
                      const SizedBox(height: 10),
                      _quickAction(
                        'Manage practice owners',
                        Icons.medical_services,
                        1,
                      ),
                      const SizedBox(height: 10),
                      _quickAction('Review job postings', Icons.work, 3),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      );
    },
  );

  Widget _panel(String title, Widget child) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: const Color(0xFFEDF5F8),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 18),
        child,
      ],
    ),
  );

  Widget _accountSummary(String label, List<AccountRecord> accounts) {
    if (label == 'Locums') {
      return Text(
        locums.loading
            ? 'Loading locum profiles…'
            : locums.errorMessage != null
            ? 'Locum profiles unavailable'
            : '${accounts.length} locum profiles · Account status not available',
        style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        LinearProgressIndicator(
          value: 0,
          color: _teal,
          backgroundColor: const Color(0xFFD7E4EA),
          minHeight: 8,
        ),
        const SizedBox(height: 6),
        Text(
          owners.loading
              ? 'Loading practice owner profiles…'
              : owners.errorMessage != null
              ? 'Practice owner profiles unavailable'
              : '${accounts.length} profiles · Account status not available',
          style: const TextStyle(fontSize: 11, color: Colors.blueGrey),
        ),
      ],
    );
  }

  Widget _quickAction(String title, IconData icon, int destination) => Material(
    color: const Color(0xFFE0F1EF),
    borderRadius: BorderRadius.circular(5),
    child: ListTile(
      dense: true,
      leading: Icon(icon, color: _teal),
      title: Text(title, style: const TextStyle(fontSize: 12)),
      trailing: const Icon(Icons.chevron_right, size: 18),
      onTap: () => onNavigate(destination),
    ),
  );
}
