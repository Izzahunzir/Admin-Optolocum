import 'package:flutter/material.dart';

import 'verification_detail_view.dart';
import 'verification_service.dart';
import 'verification_submission.dart';

class VerificationManagementPage extends StatefulWidget {
  const VerificationManagementPage({super.key, this.service});
  final VerificationService? service;

  @override
  State<VerificationManagementPage> createState() =>
      _VerificationManagementPageState();
}

class _VerificationManagementPageState
    extends State<VerificationManagementPage> {
  late final VerificationService _service;
  final _searchController = TextEditingController();
  final List<VerificationSubmission> _items = [];
  List<VerificationSubmission> _history = [];
  String _query = '';
  String? _accountType;
  String? _queueCursor;
  String? _historyCursor;
  String? _error;
  String? _historyError;
  bool _loading = true;
  bool _loadingMore = false;
  bool _historyHasMore = false;
  bool _historyHasOmitted = false;
  int _historyOmittedCount = 0;
  bool _reviewing = false;
  VerificationSubmission? _selected;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? VerificationService();
    _loadQueue();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadQueue({bool append = false}) async {
    if (_loadingMore || (_loading && append)) return;
    setState(() {
      _error = null;
      if (append) {
        _loadingMore = true;
      } else {
        _loading = true;
        _queueCursor = null;
        _items.clear();
      }
    });
    try {
      final result = await _service.listPending(
        accountType: _accountType,
        pageToken: append ? _queueCursor : null,
      );
      if (!mounted) return;
      setState(() {
        _items.addAll(
          result.items.where(
            (item) => !_items.any(
              (existing) =>
                  existing.uid == item.uid &&
                  existing.submissionId == item.submissionId,
            ),
          ),
        );
        _queueCursor = result.nextPageToken;
        _loading = false;
        _loadingMore = false;
      });
    } on VerificationException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'The pending verification queue could not be loaded.';
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _openSubmission(VerificationSubmission queueItem) async {
    setState(() {
      _selected = queueItem;
      _history = [];
      _historyCursor = null;
      _historyHasMore = false;
      _historyHasOmitted = false;
      _historyOmittedCount = 0;
      _historyError = null;
      _loading = true;
      _error = null;
    });
    await _loadSubmission(queueItem, resetHistory: true);
  }

  Future<void> _loadSubmission(
    VerificationSubmission submission, {
    String? historyToken,
    bool resetHistory = false,
  }) async {
    setState(() {
      if (resetHistory) {
        _history = [];
        _historyCursor = null;
        _historyHasMore = false;
        _historyHasOmitted = false;
        _historyOmittedCount = 0;
        _loading = true;
      } else {
        _loadingMore = true;
        _historyError = null;
      }
    });
    try {
      final (selected, historyPage) = await _service.getSubmission(
        uid: submission.uid,
        submissionId: submission.submissionId,
        historyPageToken: historyToken,
      );
      if (!mounted) return;
      setState(() {
        _selected = selected;
        for (final item in historyPage.items) {
          if (!_history.any(
            (existing) => existing.submissionId == item.submissionId,
          )) {
            _history.add(item);
          }
        }
        _historyHasMore = historyPage.hasMore;
        _historyCursor = historyPage.nextPageToken;
        _historyHasOmitted =
            _historyHasOmitted || historyPage.hasOmittedRecords;
        _historyOmittedCount += historyPage.omittedCount;
        _historyError = null;
        _loading = false;
        _loadingMore = false;
      });
    } on VerificationException catch (error) {
      if (!mounted) return;
      setState(() {
        if (resetHistory) _error = error.message;
        _historyError = error.message;
        _loading = false;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _historyError = 'Submission details could not be loaded.';
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _loadMoreHistory() async {
    final selected = _selected;
    final cursor = _historyCursor;
    if (selected == null || cursor == null || _loadingMore) return;
    await _loadSubmission(selected, historyToken: cursor);
  }

  Future<void> _selectRevision(VerificationSubmission revision) async {
    if (revision.submissionId == _selected?.submissionId) return;
    await _openSubmission(revision);
  }

  Future<void> _approve() async {
    final selected = _selected;
    if (selected == null || !_isReviewEligible(selected)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Approve verification?'),
        content: Text(
          'Approve ${selected.applicantName} (${selected.accountTypeLabel})? '
          'This changes verification status only. It does not enable or disable the account.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Approve'),
          ),
        ],
      ),
    );
    if (confirmed == true) await _submitReview(selected, 'approved');
  }

  Future<void> _reject(String reason) async {
    final selected = _selected;
    if (selected == null || !_isReviewEligible(selected)) return;
    await _submitReview(selected, 'rejected', reason: reason);
  }

  Future<void> _submitReview(
    VerificationSubmission submission,
    String decision, {
    String? reason,
  }) async {
    if (_reviewing) return;
    setState(() => _reviewing = true);
    try {
      await _service.review(
        uid: submission.uid,
        submissionId: submission.submissionId,
        decision: decision,
        rejectionReason: reason,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            decision == 'approved'
                ? 'Verification approved.'
                : 'Verification rejected.',
          ),
        ),
      );
      await _loadQueue();
      if (mounted) await _loadSubmission(submission, resetHistory: true);
    } on VerificationException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.message)));
      // The backend is authoritative; refresh details after stale or duplicate
      // review errors so the screen reflects the current revision state.
      await _loadSubmission(submission, resetHistory: true);
   } catch (error, stackTrace) {
  debugPrint('VERIFICATION REVIEW ERROR: $error');
  debugPrint('VERIFICATION REVIEW STACK: $stackTrace');

  if (!mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text('Review error: $error'),
      duration: const Duration(seconds: 8),
    ),
  );
} finally {
      if (mounted) setState(() => _reviewing = false);
    }
  }

  bool _isReviewEligible(VerificationSubmission selected) {
    if (_historyHasMore || _historyHasOmitted) return false;
    final latest = _latestSubmittedId;
    return selected.isPending &&
        latest != null &&
        selected.submissionId == latest &&
        !_reviewing;
  }

  String? get _latestSubmittedId {
    final submitted = _history
        .where((item) => item.state == 'submitted')
        .toList();
    submitted.sort((a, b) {
      final dateOrder =
          (b.submittedAt ?? DateTime.fromMillisecondsSinceEpoch(0)).compareTo(
            a.submittedAt ?? DateTime.fromMillisecondsSinceEpoch(0),
          );
      return dateOrder != 0
          ? dateOrder
          : b.submissionId.compareTo(a.submissionId);
    });
    return submitted.isEmpty ? null : submitted.first.submissionId;
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    if (selected != null) {
      if (_loading && _error != null) {
        return _errorPanel(
          _error!,
          () => _loadSubmission(selected, resetHistory: true),
        );
      }
      if (_loading && _history.isEmpty) {
        return const Padding(
          padding: EdgeInsets.all(48),
          child: Center(child: CircularProgressIndicator()),
        );
      }
      return VerificationDetailView(
        service: _service,
        submission: selected,
        history: _history,
        historyHasMore: _historyHasMore,
        historyHasOmittedRecords: _historyHasOmitted,
        historyError: _historyError,
        historyOmittedCount: _historyOmittedCount,
        latestSubmittedId: _historyHasMore ? null : _latestSubmittedId,
        historyComplete: !_historyHasMore && !_historyHasOmitted,
        isLatestSubmitted:
            !_historyHasMore &&
            !_historyHasOmitted &&
            selected.submissionId == _latestSubmittedId,
        reviewing: _reviewing,
        onBack: () => setState(() => _selected = null),
        onLoadMoreHistory: _loadMoreHistory,
        onRetryHistory: _loadMoreHistory,
        onSelectRevision: _selectRevision,
        onApprove: _approve,
        onReject: _reject,
      );
    }
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(48),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) return _errorPanel(_error!, _loadQueue);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 14,
          runSpacing: 10,
          children: [
            SizedBox(
              width: 320,
              child: TextField(
                controller: _searchController,
                onChanged: (value) =>
                    setState(() => _query = value.trim().toLowerCase()),
                decoration: InputDecoration(
                  labelText: 'Search applicant or email',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _query = '');
                          },
                          icon: const Icon(Icons.close),
                        ),
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Account type'),
                const SizedBox(width: 8),
                DropdownButton<String?>(
                  value: _accountType,
                  items: const [
                    DropdownMenuItem<String?>(value: null, child: Text('All')),
                    DropdownMenuItem<String?>(
                      value: 'locum',
                      child: Text('Locum'),
                    ),
                    DropdownMenuItem<String?>(
                      value: 'practice_owner',
                      child: Text('Practice Owner'),
                    ),
                  ],
                  onChanged: (value) {
                    setState(() => _accountType = value);
                    _loadQueue();
                  },
                ),
                const SizedBox(width: 8),
                IconButton(
                  tooltip: 'Refresh pending submissions',
                  onPressed: () => _loadQueue(),
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          '${_filteredItems.length} loaded pending submission(s)',
          style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
        ),
        const SizedBox(height: 10),
        if (_items.isEmpty)
          const Padding(
            padding: EdgeInsets.all(48),
            child: Center(child: Text('No pending verification submissions.')),
          )
        else if (_filteredItems.isEmpty)
          const Padding(
            padding: EdgeInsets.all(40),
            child: Center(
              child: Text('No loaded submissions match this search.'),
            ),
          )
        else
          _queueTable(_filteredItems),
        if (_queueCursor != null)
          Align(
            alignment: Alignment.center,
            child: TextButton.icon(
              onPressed: _loadingMore ? null : () => _loadQueue(append: true),
              icon: _loadingMore
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.expand_more),
              label: Text(_loadingMore ? 'Loading' : 'Load more submissions'),
            ),
          ),
      ],
    );
  }

  List<VerificationSubmission> get _filteredItems => _items.where((item) {
    if (_accountType != null && item.accountType != _accountType) return false;
    if (_query.isEmpty) return true;
    return '${item.applicantName} ${item.email}'.toLowerCase().contains(_query);
  }).toList();

  Widget _queueTable(List<VerificationSubmission> items) => Card(
    elevation: 0,
    clipBehavior: Clip.antiAlias,
    shape: RoundedRectangleBorder(
      side: const BorderSide(color: Color(0xFFDCE6E9)),
      borderRadius: BorderRadius.circular(8),
    ),
    child: SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowColor: WidgetStateProperty.all(const Color(0xFFF0F5F6)),
        columns: const [
          DataColumn(label: Text('Applicant')),
          DataColumn(label: Text('Email')),
          DataColumn(label: Text('Account type')),
          DataColumn(label: Text('Submitted')),
          DataColumn(label: Text('Status')),
          DataColumn(label: Text('')),
        ],
        rows: items
            .map(
              (item) => DataRow(
                cells: [
                  DataCell(Text(item.applicantName)),
                  DataCell(Text(item.email)),
                  DataCell(Text(item.accountTypeLabel)),
                  DataCell(Text(_formatDate(item.submittedAt))),
                  const DataCell(_PendingLabel()),
                  DataCell(
                    TextButton(
                      onPressed: () => _openSubmission(item),
                      child: const Text('View Details'),
                    ),
                  ),
                ],
              ),
            )
            .toList(),
      ),
    ),
  );

  Widget _errorPanel(String message, VoidCallback retry) => Padding(
    padding: const EdgeInsets.all(40),
    child: Column(
      children: [
        const Icon(Icons.cloud_off_outlined, color: Colors.blueGrey, size: 34),
        const SizedBox(height: 8),
        Text(message, textAlign: TextAlign.center),
        TextButton.icon(
          onPressed: retry,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry'),
        ),
      ],
    ),
  );

  String _formatDate(DateTime? date) => date == null
      ? 'Date unavailable'
      : '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
}

class _PendingLabel extends StatelessWidget {
  const _PendingLabel();
  @override
  Widget build(BuildContext context) => const Chip(
    label: Text('Pending'),
    labelStyle: TextStyle(
      color: Color(0xFF8B6413),
      fontWeight: FontWeight.w600,
    ),
    backgroundColor: Color(0xFFFFF4D6),
    side: BorderSide.none,
  );
}
