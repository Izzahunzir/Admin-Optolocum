import 'package:flutter/material.dart';

import 'job_management_api.dart';
import 'job_posting.dart';
import 'job_posting_table.dart';

class ManagedJobTable extends StatefulWidget {
  const ManagedJobTable({super.key, required this.jobs, this.api});
  final List<JobPosting> jobs;
  final JobManagementApi? api;

  @override
  State<ManagedJobTable> createState() => _ManagedJobTableState();
}

class _ManagedJobTableState extends State<ManagedJobTable> {
  late final api = widget.api ?? JobManagementApi();
  final busy = <String>{};
  final statusById = <String, String>{};
  bool reading = false;
  String? error;

  @override
  void initState() {
    super.initState();
    for (final job in widget.jobs) {
      statusById[job.id] = job.status;
    }
    if (api.configured) refresh();
  }

  @override
  void didUpdateWidget(covariant ManagedJobTable oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldStatuses = oldWidget.jobs
        .map((job) => '${job.id}:${job.status}')
        .join('|');
    final newStatuses = widget.jobs
        .map((job) => '${job.id}:${job.status}')
        .join('|');
    if (oldStatuses != newStatuses) {
      for (final job in widget.jobs) {
        statusById[job.id] = job.status;
      }
      if (api.configured) refresh();
    }
  }

  Future<void> refresh() async {
    setState(() {
      reading = true;
      error = null;
    });
    final refreshed = <String, String>{};
    var failed = false;
    for (final job in widget.jobs) {
      try {
        final state = await api.call(job.id);
        refreshed[job.id] = state['status'] as String;
      } catch (_) {
        failed = true;
      }
    }
    if (!mounted) return;
    setState(() {
      statusById.addAll(refreshed);
      reading = false;
      if (failed)
        error = 'Unable to confirm job status. Refresh before retrying.';
    });
  }

  Future<void> changeStatus(JobPosting job) async {
    if (busy.contains(job.id) || !api.canChangeStatus(job.id)) return;
    setState(() {
      busy.add(job.id);
      error = null;
    });
    try {
      final state = await api.call(job.id);
      if (!mounted) return;
      final currentStatus = state['status'] as String;
      setState(() => statusById[job.id] = currentStatus);
      if (!api.canChangeStatus(job.id)) {
        throw StateError('This posting cannot be changed.');
      }

      final restoring = currentStatus == 'deleted';
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(restoring ? 'Undo delete?' : 'Delete job posting?'),
          content: Text(
            restoring
                ? '${job.practice} - ${job.role}\nRestore this posting to its previous valid status? Expired or filled postings will remain unavailable. Existing applications and history will be retained.'
                : '${job.practice} - ${job.role}\nRemove from available listings? The posting and existing applications will be retained for history.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(restoring ? 'Undo Delete' : 'Delete'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;

      final result = await api.call(
        job.id,
        action: restoring ? 'restore' : 'softDelete',
        expectedStatus: currentStatus,
      );
      if (!mounted) return;
      final updatedStatus = result['status'] as String;
      setState(() => statusById[job.id] = updatedStatus);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            restoring
                ? updatedStatus == 'available'
                      ? 'Job posting restored.'
                      : 'Job posting restored with status $updatedStatus.'
                : 'Job posting deleted. History retained.',
          ),
        ),
      );
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
        statusOf: (job) => statusById[job.id] ?? job.status,
        canChangeStatus: (job) =>
            !reading && !busy.contains(job.id) && api.canChangeStatus(job.id),
        onChangeStatus: changeStatus,
      ),
      if (statusById.values.contains('deleted'))
        const Text('Deleted postings are retained for history.'),
    ],
  );
}
