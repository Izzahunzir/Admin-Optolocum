import 'package:flutter/material.dart';

import 'verification_document_viewer.dart';
import 'verification_service.dart';
import 'verification_submission.dart';

class VerificationDetailView extends StatelessWidget {
  const VerificationDetailView({
    super.key,
    required this.service,
    required this.submission,
    required this.history,
    required this.historyHasMore,
    required this.historyHasOmittedRecords,
    required this.historyError,
    required this.historyOmittedCount,
    required this.latestSubmittedId,
    required this.historyComplete,
    required this.isLatestSubmitted,
    required this.reviewing,
    required this.onBack,
    required this.onLoadMoreHistory,
    required this.onRetryHistory,
    required this.onSelectRevision,
    required this.onApprove,
    required this.onReject,
  });

  final VerificationService service;
  final VerificationSubmission submission;
  final List<VerificationSubmission> history;
  final bool historyHasMore;
  final bool historyHasOmittedRecords;
  final String? historyError;
  final int historyOmittedCount;
  final String? latestSubmittedId;
  final bool historyComplete;
  final bool isLatestSubmitted;
  final bool reviewing;
  final VoidCallback onBack;
  final VoidCallback onLoadMoreHistory;
  final VoidCallback onRetryHistory;
  final ValueChanged<VerificationSubmission> onSelectRevision;
  final VoidCallback onApprove;
  final ValueChanged<String> onReject;

  @override
  Widget build(BuildContext context) {
    final eligible = submission.isPending && isLatestSubmitted && !reviewing;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextButton.icon(
          onPressed: reviewing ? null : onBack,
          icon: const Icon(Icons.arrow_back),
          label: const Text('Back to submissions'),
          style: TextButton.styleFrom(alignment: Alignment.centerLeft),
        ),
        Card(
          elevation: 0,
          color: Colors.white,
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: Color(0xFFDCE6E9)),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          submission.applicantName,
                          style: const TextStyle(
                            fontSize: 21,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${submission.accountTypeLabel} · ${submission.email}',
                          style: const TextStyle(color: Colors.blueGrey),
                        ),
                      ],
                    ),
                    _StatusChip(
                      label:
                          historyComplete &&
                              !isLatestSubmitted &&
                              submission.state == 'submitted'
                          ? 'Superseded'
                          : _statusLabel(submission),
                    ),
                  ],
                ),
                const Divider(height: 28),
                _SectionTitle(title: 'Applicant information'),
                const SizedBox(height: 8),
                _fieldsFor(submission),
                const SizedBox(height: 18),
                _SectionTitle(title: 'Verification document'),
                const SizedBox(height: 8),
                Text(
                  submission.accountType == 'locum'
                      ? 'MOC Registration Certificate and current APC (may be combined in one PDF)'
                      : 'SSM Business Registration Certificate / Company Profile',
                  style: const TextStyle(color: Colors.blueGrey),
                ),
                const SizedBox(height: 10),
                VerificationDocumentViewer(
                  key: ValueKey('${submission.uid}/${submission.submissionId}'),
                  service: service,
                  submission: submission,
                ),
                if (submission.review != null) ...[
                  const SizedBox(height: 16),
                  _SectionTitle(title: 'Review decision'),
                  const SizedBox(height: 8),
                  Text(_capitalize(submission.review!.decision)),
                  if (submission.review!.reviewedAt != null)
                    Text(_formatDate(submission.review!.reviewedAt)),
                  if ((submission.review!.rejectionReason ?? '').isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        'Reason: ${submission.review!.rejectionReason}',
                      ),
                    ),
                ],
                if (historyComplete &&
                    submission.state == 'submitted' &&
                    !isLatestSubmitted) ...[
                  const SizedBox(height: 14),
                  const Text(
                    'A newer submitted revision exists. This revision is superseded and cannot be reviewed.',
                    style: TextStyle(color: Color(0xFF81550B)),
                  ),
                ],
                const SizedBox(height: 20),
                _SectionTitle(title: 'Submission history'),
                const SizedBox(height: 8),
                if (historyHasOmittedRecords)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      historyOmittedCount > 0
                          ? '$historyOmittedCount malformed history record(s) were omitted from this page.'
                          : 'Some malformed history records were omitted.',
                      style: const TextStyle(color: Colors.blueGrey),
                    ),
                  ),
                if (historyError != null)
                  Row(
                    children: [
                      Expanded(child: Text(historyError!)),
                      TextButton(
                        onPressed: onRetryHistory,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                if (history.isEmpty)
                  const Text('No submission history is available.'),
                for (final revision in history)
                  _HistoryRow(
                    revision: revision,
                    isSelected:
                        revision.submissionId == submission.submissionId,
                    isLatestSubmitted:
                        revision.submissionId == latestSubmittedId,
                    historyComplete: historyComplete,
                    onTap: () => onSelectRevision(revision),
                  ),
                if (historyHasMore)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: reviewing ? null : onLoadMoreHistory,
                      icon: const Icon(Icons.expand_more),
                      label: const Text('Load more history'),
                    ),
                  ),
                const Divider(height: 28),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: eligible ? onApprove : null,
                      icon: const Icon(Icons.check_circle_outline),
                      label: const Text('Approve'),
                    ),
                    FilledButton.icon(
                      onPressed: eligible
                          ? () => _showRejectDialog(context)
                          : null,
                      icon: const Icon(Icons.cancel_outlined),
                      label: const Text('Reject'),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF9B3F45),
                      ),
                    ),
                  ],
                ),
                if (reviewing)
                  const Padding(
                    padding: EdgeInsets.only(top: 12),
                    child: LinearProgressIndicator(),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _fieldsFor(VerificationSubmission item) {
    final fields = item.accountType == 'locum'
        ? const <(String, String)>[
            ('Full Name', 'fullName'),
            ('Email', 'email'),
            ('NRIC', 'nric'),
            ('Phone Number', 'phoneNumber'),
            ('Gender', 'gender'),
            ('Date of Birth', 'dateOfBirth'),
            ('Highest Education', 'highestEducation'),
            ('Course', 'course'),
          ]
        : const <(String, String)>[
            ('Type of Practice', 'practiceType'),
            ('Clinic Name', 'clinicName'),
            ('Clinic Registration Number', 'registrationNumber'),
            ('Clinic Address', 'address'),
            ('State', 'state'),
            ('Clinic Contact Number', 'contactNumber'),
            ('Company Email', 'companyEmail'),
          ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth > 850
            ? 2
            : constraints.maxWidth > 520
            ? 2
            : 1;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: fields.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            childAspectRatio: columns == 1 ? 7.5 : 5.4,
            crossAxisSpacing: 14,
            mainAxisSpacing: 5,
          ),
          itemBuilder: (context, index) {
            final (label, key) = fields[index];
            final raw = item.submittedFields[key];
            final value = raw is String && raw.trim().isNotEmpty
                ? raw.trim()
                : 'Not provided';
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
                ),
                const SizedBox(height: 3),
                Text(value, maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            );
          },
        );
      },
    );
  }

Future<void> _showRejectDialog(BuildContext context) async {
  final reason = await showDialog<String>(
    context: context,
    builder: (_) => _RejectVerificationDialog(
      applicantName: submission.applicantName,
      accountTypeLabel: submission.accountTypeLabel,
    ),
  );

  if (!context.mounted || reason == null) return;

  onReject(reason);
}
  

  String _statusLabel(VerificationSubmission item) {
    if (item.state == 'draft') return 'Draft';
    return _capitalize(
      item.review?.decision ?? item.verificationStatus ?? 'Unknown',
    );
  }

  String _formatDate(DateTime? date) => date == null
      ? 'Date unavailable'
      : '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  String _capitalize(String value) => value.isEmpty
      ? 'Unknown'
      : '${value[0].toUpperCase()}${value.substring(1)}';
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({
    required this.revision,
    required this.isSelected,
    required this.isLatestSubmitted,
    required this.historyComplete,
    required this.onTap,
  });

  final VerificationSubmission revision;
  final bool isSelected;
  final bool isLatestSubmitted;
  final bool historyComplete;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    elevation: 0,
    color: isSelected ? const Color(0xFFEAF3F5) : const Color(0xFFFAFBFC),
    child: ListTile(
      onTap: onTap,
      dense: true,
      leading: Icon(
        isLatestSubmitted ? Icons.new_releases_outlined : Icons.history,
        color: isLatestSubmitted ? const Color(0xFF3D7789) : Colors.blueGrey,
      ),
      title: Text(
        '${_historyStatus(revision, isLatestSubmitted, historyComplete)} · ${_date(revision.submittedAt)}',
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        'Revision ${_shortId(revision.submissionId)}'
        '${revision.review?.rejectionReason == null ? '' : ' · ${revision.review!.rejectionReason}'}',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: isSelected ? const Icon(Icons.visibility, size: 18) : null,
    ),
  );

  static String _historyStatus(
    VerificationSubmission revision,
    bool latest,
    bool historyComplete,
  ) {
    if (historyComplete && !latest && revision.state == 'submitted') {
      return 'Superseded';
    }
    if (revision.state == 'draft') return 'Draft';
    return revision.review?.decision ??
        revision.verificationStatus ??
        'Submitted';
  }

  static String _shortId(String id) => id.length <= 10
      ? id
      : '${id.substring(0, 6)}…${id.substring(id.length - 4)}';
  static String _date(DateTime? value) => value == null
      ? 'Date unavailable'
      : '${value.year}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) => Text(
    title,
    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
  );
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) {
    final color = switch (label.toLowerCase()) {
      'pending' => const Color(0xFF8B6413),
      'approved' => const Color(0xFF27734D),
      'rejected' => const Color(0xFF9B3F45),
      'superseded' => const Color(0xFF5D6870),
      _ => const Color(0xFF53666F),
    };
    return Chip(
      label: Text(label),
      backgroundColor: color.withValues(alpha: .10),
      labelStyle: TextStyle(color: color, fontWeight: FontWeight.w600),
      side: BorderSide.none,
    );
  }
}

class _RejectVerificationDialog extends StatefulWidget {
  const _RejectVerificationDialog({
    required this.applicantName,
    required this.accountTypeLabel,
  });

  final String applicantName;
  final String accountTypeLabel;

  @override
  State<_RejectVerificationDialog> createState() =>
      _RejectVerificationDialogState();
}

class _RejectVerificationDialogState
    extends State<_RejectVerificationDialog> {
  final _controller = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Reject verification'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${widget.applicantName} · ${widget.accountTypeLabel}',
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _controller,
              autofocus: true,
              maxLength: 1000,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Rejection reason',
                border: OutlineInputBorder(),
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Enter a reason for rejection.';
                }
                return null;
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (_formKey.currentState!.validate()) {
              Navigator.pop(context, _controller.text.trim());
            }
          },
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFF9B3F45),
          ),
          child: const Text('Reject'),
        ),
      ],
    );
  }
}