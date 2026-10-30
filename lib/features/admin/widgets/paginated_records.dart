import 'package:flutter/material.dart';

/// Shared six-row pagination; the page is clamped when live records disappear.
class PaginatedRecords<T> extends StatefulWidget {
  const PaginatedRecords({
    super.key,
    required this.records,
    required this.query,
    required this.matches,
    required this.tableBuilder,
    this.emptyMessage = 'No matching records.',
  });
  final List<T> records;
  final String query, emptyMessage;
  final bool Function(T record, String query) matches;
  final Widget Function(List<T> records) tableBuilder;

  @override
  State<PaginatedRecords<T>> createState() => _PaginatedRecordsState<T>();
}

class _PaginatedRecordsState<T> extends State<PaginatedRecords<T>> {
  int _page = 0;

  @override
  void didUpdateWidget(covariant PaginatedRecords<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.query != widget.query) _page = 0;
  }

  @override
  Widget build(BuildContext context) {
    final records = widget.records
        .where((r) => widget.matches(r, widget.query))
        .toList();
    final pages = (records.length / 6).ceil();
    final currentPage = pages == 0 ? 0 : _page.clamp(0, pages - 1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (records.isEmpty)
          Padding(
            padding: const EdgeInsets.all(48),
            child: Center(child: Text(widget.emptyMessage)),
          )
        else
          widget.tableBuilder(records.skip(currentPage * 6).take(6).toList()),
        const SizedBox(height: 12),
        Wrap(
          alignment: WrapAlignment.end,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Text(
              '${records.length} records',
              style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
            ),
            TextButton(
              onPressed: currentPage > 0
                  ? () => setState(() => _page = currentPage - 1)
                  : null,
              child: const Text('Previous'),
            ),
            for (int i = 0; i < pages; i++)
              TextButton(
                onPressed: () => setState(() => _page = i),
                style: TextButton.styleFrom(
                  backgroundColor: currentPage == i
                      ? const Color(0xFFDDEEF2)
                      : null,
                ),
                child: Text('${i + 1}'),
              ),
            TextButton(
              onPressed: currentPage + 1 < pages
                  ? () => setState(() => _page = currentPage + 1)
                  : null,
              child: const Text('Next'),
            ),
          ],
        ),
      ],
    );
  }
}
