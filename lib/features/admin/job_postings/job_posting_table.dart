import 'package:flutter/material.dart';

import '../widgets/admin_table.dart';
import '../widgets/account_action.dart';
import 'job_posting.dart';

class JobPostingTable extends StatelessWidget {
  const JobPostingTable({
    super.key,
    required this.jobs,
    this.onChangeStatus,
    this.canChangeStatus,
    this.statusOf,
  });
  final List<JobPosting> jobs;
  final ValueChanged<JobPosting>? onChangeStatus;
  final bool Function(JobPosting)? canChangeStatus;
  final String Function(JobPosting)? statusOf;
  @override
  Widget build(BuildContext context) => AdminTable(
    headers: [
      'Job ID',
      'Practice name',
      'Role',
      'Location',
      'Date',
      'Time',
      'Rate',
      'Contact',
      'Action',
    ],
    rows: jobs
        .map(
          (j) => DataRow(
            cells: [
              DataCell(Text(j.id)),
              DataCell(Text(j.practice)),
              DataCell(Text(j.role)),
              DataCell(Text(j.location)),
              DataCell(Text(j.date)),
              DataCell(Text(j.timeRange)),
              DataCell(Text(j.rate)),
              DataCell(Text(j.contactNumber)),
              DataCell(_jobAction(j)),
            ],
          ),
        )
        .toList(),
  );

  Widget _jobAction(JobPosting job) {
    final deleted = (statusOf?.call(job) ?? job.status) == 'deleted';
    final label = deleted ? 'Undo Delete' : 'Delete';
    return accountAction(
      label,
      deleted ? Colors.orange : Colors.red,
      onChangeStatus != null && canChangeStatus?.call(job) == true
          ? () => onChangeStatus!(job)
          : null,
    );
  }
}
