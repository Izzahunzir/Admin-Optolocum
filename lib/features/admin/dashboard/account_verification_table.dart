import 'package:flutter/material.dart';

import 'verification_statistics.dart';

class VerificationColumnData {
  VerificationColumnData({
    required Iterable<Object?> statuses,
    this.loading = false,
    this.errorMessage,
    this.fromCache = false,
  }) : statistics = VerificationStatistics(statuses);
  final VerificationStatistics statistics;
  final bool loading, fromCache;
  final String? errorMessage;
  bool get available =>
      !loading && errorMessage == null && !(fromCache && statistics.total == 0);
  String get stateLabel => errorMessage != null
      ? 'Unavailable'
      : loading
      ? 'Loading…'
      : fromCache
      ? 'Cached'
      : 'Live';
}

class AccountVerificationTable extends StatelessWidget {
  const AccountVerificationTable({
    super.key,
    required this.locums,
    required this.owners,
  });
  final VerificationColumnData locums, owners;

  @override
  Widget build(BuildContext context) {
    final a = locums.statistics, b = owners.statistics;
    Widget cell(String text, {bool number = false, bool bold = false}) =>
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
          child: Text(
            text,
            textAlign: number ? TextAlign.right : TextAlign.left,
            style: TextStyle(
              fontSize: 12,
              fontWeight: bold ? FontWeight.w600 : FontWeight.normal,
              color: bold ? const Color(0xFF285D65) : const Color(0xFF455A64),
            ),
          ),
        );
    Widget heading(String label, VerificationColumnData data) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            label,
            textAlign: TextAlign.right,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: Color(0xFF285D65),
            ),
          ),
          const SizedBox(height: 4),
          Tooltip(
            message:
                data.errorMessage ??
                (data.fromCache
                    ? 'Cached data may be incomplete.'
                    : data.stateLabel),
            child: Text(
              data.stateLabel,
              style: const TextStyle(fontSize: 10, color: Colors.blueGrey),
            ),
          ),
        ],
      ),
    );
    TableRow row(String label, int left, int right, {bool total = false}) =>
        TableRow(
          decoration: BoxDecoration(
            color: total ? const Color(0xFFDDEEF2) : Colors.transparent,
            border: const Border(top: BorderSide(color: Color(0xFFD7E4EA))),
          ),
          children: [
            cell(label, bold: total),
            cell(locums.available ? '$left' : '—', number: true, bold: total),
            cell(owners.available ? '$right' : '—', number: true, bold: total),
          ],
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(5),
          child: Table(
            columnWidths: const {
              0: FlexColumnWidth(1.3),
              1: FlexColumnWidth(1),
              2: FlexColumnWidth(1.2),
            },
            defaultVerticalAlignment: TableCellVerticalAlignment.middle,
            children: [
              TableRow(
                decoration: const BoxDecoration(color: Color(0xFFE2F0F4)),
                children: [
                  cell('Status', bold: true),
                  heading('Locums', locums),
                  heading('Practice Owners', owners),
                ],
              ),
              row('Verified', a.verified, b.verified),
              row('Pending', a.pending, b.pending),
              row('Unverified', a.unverified, b.unverified),
              row('Unknown', a.unknown, b.unknown),
              row('Other', a.other, b.other),
              row('Total profiles', a.total, b.total, total: true),
            ],
          ),
        ),
        if (locums.fromCache || owners.fromCache)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'Cached counts may be incomplete.',
              style: TextStyle(fontSize: 10, color: Colors.blueGrey),
            ),
          ),
        if (locums.errorMessage != null || owners.errorMessage != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              [
                if (locums.errorMessage != null)
                  'Locums: ${locums.errorMessage}',
                if (owners.errorMessage != null)
                  'Practice Owners: ${owners.errorMessage}',
              ].join('\n'),
              style: const TextStyle(fontSize: 10, color: Colors.blueGrey),
            ),
          ),
      ],
    );
  }
}
