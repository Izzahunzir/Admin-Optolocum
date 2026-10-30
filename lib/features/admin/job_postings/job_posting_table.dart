import 'package:flutter/material.dart';

import '../widgets/admin_table.dart';
import '../widgets/account_action.dart';
import 'job_posting.dart';

class JobPostingTable extends StatelessWidget {
  const JobPostingTable({super.key, required this.jobs});
  final List<JobPosting> jobs;
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
              DataCell(accountAction('Delete', Colors.red, null)),
            ],
          ),
        )
        .toList(),
  );
}
