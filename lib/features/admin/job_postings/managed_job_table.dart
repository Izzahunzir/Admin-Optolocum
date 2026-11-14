import 'package:flutter/material.dart';

import 'job_posting.dart';
import 'job_posting_table.dart';
import 'job_management_api.dart';

class ManagedJobTable extends StatefulWidget {
  const ManagedJobTable({super.key, required this.jobs, this.api});
  final List<JobPosting> jobs;
  final JobManagementApi? api;
  @override
  State<ManagedJobTable> createState() => _ManagedJobTableState();
}

class _ManagedJobTableState extends State<ManagedJobTable> {
  late final api = widget.api ?? JobManagementApi();
  final busy = <String>{}, deleted = <String>{};
  bool reading = false;
  String? error;
  @override
  void initState() {
    super.initState();
    if (api.configured) refresh();
  }

  @override
  void didUpdateWidget(covariant ManagedJobTable oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.jobs.map((j) => j.id).join('|') !=
            widget.jobs.map((j) => j.id).join('|') &&
        api.configured) {
      refresh();
    }
  }

  Future<void> refresh() async {
    setState(() {
      reading = true;
      error = null;
    });
    for (final job in widget.jobs) {
      try {
        final state = await api.call(job.id);
        if (state['status'] == 'deleted') deleted.add(job.id);
      } catch (_) {
        error = 'Unable to confirm job status. Refresh before retrying.';
      }
    }
    if (mounted) setState(() => reading = false);
  }

  Future<void> remove(JobPosting job) async {
    if (busy.contains(job.id) || !api.canDelete(job.id)) return;
    setState(() => busy.add(job.id));
    try {
      final state = await api.call(job.id);
      if (!mounted) return;
      if (!api.canDelete(job.id)) {
        throw StateError('This posting cannot be deleted.');
      }
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Delete job posting?'),
          content: Text(
            '${job.practice} - ${job.role}\nRemove from available listings? The posting and existing applications will be retained for history.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Delete'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
      await api.call(job.id, expectedStatus: state['status'] as String);
      deleted.add(job.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Job posting deleted. History retained.'),
          ),
        );
      }
    } catch (failure) {
      error = failure is StateError ? failure.message.toString() : 'Job action could not be confirmed. Refresh status before retrying.';
    } finally {
      if (mounted) setState(() => busy.remove(job.id));
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (api.configured)
        TextButton(
          onPressed: reading || busy.isNotEmpty ? null : refresh,
          child: const Text('Refresh job status'),
        ),
      if (error != null) Text(error!),
      JobPostingTable(
        jobs: widget.jobs,
        isDeleted: (j) => deleted.contains(j.id),
        canDelete: (j) =>
            !reading &&
            !deleted.contains(j.id) &&
            !busy.contains(j.id) &&
            api.canDelete(j.id),
        onDelete: remove,
      ),
      if (deleted.isNotEmpty)
        const Text('Deleted postings are retained for history.'),
    ],
  );
}
