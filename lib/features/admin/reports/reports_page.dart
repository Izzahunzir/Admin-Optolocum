import 'dart:math' as math;

import 'package:flutter/material.dart';

const _teal = Color(0xFF3D7789);
const _ownerColor = Color(0xFFE8943A);

enum ReportPeriod {
  week('Last 7 Days', 7),
  month('Last 30 Days', 30),
  quarter('Last 3 Months', null),
  all('All Time', null);

  const ReportPeriod(this.label, this.days);
  final String label;
  final int? days;

  DateTime? start(DateTime now) => switch (this) {
    ReportPeriod.all => null,
    ReportPeriod.quarter => DateTime(now.year, now.month - 3, now.day),
    _ => now.subtract(Duration(days: days!)),
  };
}

/// Replace this source with verified Firestore queries when its schema is known.
class ReportsData {
  const ReportsData({
    required this.locums,
    required this.owners,
    required this.jobs,
    required this.asOf,
  });
  final List<DateTime> locums;
  final List<DateTime> owners;
  final List<DateTime> jobs;
  final DateTime asOf;

  static Future<ReportsData> mock() async {
    final now = DateTime.now();
    List<DateTime> dates(List<int> ages) =>
        ages.map((age) => now.subtract(Duration(days: age))).toList();
    return ReportsData(
      locums: dates([0, 2, 4, 6, 10, 15, 22, 28, 35, 48, 65, 80, 110, 150]),
      owners: dates([1, 5, 12, 20, 40, 55, 75, 120]),
      jobs: dates([0, 3, 6, 9, 17, 25, 38, 60, 85, 130]),
      asOf: now,
    );
  }
}

class ReportsPage extends StatefulWidget {
  const ReportsPage({super.key, this.loadData = ReportsData.mock});
  final Future<ReportsData> Function() loadData;

  @override
  State<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends State<ReportsPage> {
  late Future<ReportsData> _data;
  ReportPeriod _period = ReportPeriod.month;

  @override
  void initState() {
    super.initState();
    _data = widget.loadData();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text(
        'Mock reports - not live Firebase statistics. All sample jobs are active; other statuses are not defined in this project.',
        style: TextStyle(color: Colors.blueGrey, fontSize: 12),
      ),
      const SizedBox(height: 16),
      Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 16,
        runSpacing: 10,
        children: [
          const Text(
            'Registration and job statistics',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          DropdownMenu<ReportPeriod>(
            label: const Text('Date range'),
            initialSelection: _period,
            dropdownMenuEntries: ReportPeriod.values
                .map((p) => DropdownMenuEntry(value: p, label: p.label))
                .toList(),
            onSelected: (value) {
              if (value != null) setState(() => _period = value);
            },
          ),
        ],
      ),
      const SizedBox(height: 20),
      FutureBuilder<ReportsData>(
        future: _data,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Padding(
              padding: EdgeInsets.all(48),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return _ReportPanel(
              title: 'Reports unavailable',
              child: Column(
                children: [
                  const Text('Unable to load report data. Please try again.'),
                  TextButton(
                    onPressed: () => setState(() => _data = widget.loadData()),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            );
          }
          return _content(snapshot.data!);
        },
      ),
    ],
  );

  Widget _content(ReportsData data) {
    final start = _period.start(data.asOf);
    List<DateTime> filter(List<DateTime> dates) => dates
        .where(
          (d) => (start == null || !d.isBefore(start)) && !d.isAfter(data.asOf),
        )
        .toList();
    final locums = filter(data.locums),
        owners = filter(data.owners),
        jobs = filter(data.jobs);
    final allDates = [...locums, ...owners, ...jobs]..sort();
    final first = start ?? (allDates.isEmpty ? data.asOf : allDates.first);
    final months = <DateTime>[];
    for (
      var date = DateTime(first.year, first.month);
      !date.isAfter(data.asOf);
      date = DateTime(date.year, date.month + 1)
    ) {
      months.add(date);
    }
    List<int> counts(List<DateTime> dates) => months
        .map(
          (m) =>
              dates.where((d) => d.year == m.year && d.month == m.month).length,
        )
        .toList();
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final columns = width >= 1000
            ? 4
            : width >= 500
            ? 2
            : 1;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Totals count records created within the selected range. Active jobs are the active subset of those postings.',
              style: TextStyle(fontSize: 12, color: Colors.blueGrey),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 14,
              runSpacing: 14,
              children: [
                for (final item in [
                  ('Total Locum Accounts', locums.length),
                  ('Total Practice Owner Accounts', owners.length),
                  ('Total Job Postings', jobs.length),
                  ('Active Job Postings', jobs.length),
                ])
                  SizedBox(
                    width: (width - (columns - 1) * 14) / columns,
                    child: _ReportPanel(
                      title: item.$1,
                      child: Text(
                        '${item.$2}',
                        style: const TextStyle(
                          fontSize: 30,
                          fontWeight: FontWeight.bold,
                          color: _teal,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            if (allDates.isEmpty)
              const _ReportPanel(
                title: 'No records',
                child: Text(
                  'No registrations or job postings in this date range.',
                ),
              ),
            if (allDates.isEmpty) const SizedBox(height: 20),
            Wrap(
              spacing: 20,
              runSpacing: 20,
              children: [
                SizedBox(
                  width: width >= 900 ? (width - 20) * .62 : width,
                  child: _ReportPanel(
                    title: 'User Registration Report',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Wrap(
                          spacing: 20,
                          runSpacing: 8,
                          children: [
                            _Legend('Locums', _teal),
                            _Legend('Practice owners', _ownerColor),
                          ],
                        ),
                        const SizedBox(height: 20),
                        if (locums.isEmpty && owners.isEmpty)
                          const SizedBox(
                            height: 230,
                            child: Center(
                              child: Text(
                                'No registrations in this date range.',
                              ),
                            ),
                          )
                        else
                          Semantics(
                            label:
                                'Monthly registrations. Locums: ${counts(locums).join(', ')}. Practice owners: ${counts(owners).join(', ')}.',
                            child: SizedBox(
                              height: 230,
                              child: CustomPaint(
                                painter: _RegistrationChart(
                                  months,
                                  counts(locums),
                                  counts(owners),
                                ),
                              ),
                            ),
                          ),
                        const SizedBox(height: 12),
                        const Text(
                          'Monthly counts within the selected range; boundary months may be partial.',
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.blueGrey,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                SizedBox(
                  width: width >= 900 ? (width - 20) * .38 : width,
                  child: _ReportPanel(
                    title: 'Job Posting Report',
                    child: Column(
                      children: [
                        const SizedBox(height: 10),
                        if (jobs.isEmpty)
                          const SizedBox(
                            height: 180,
                            child: Center(
                              child: Text(
                                'No job postings in this date range.',
                              ),
                            ),
                          )
                        else
                          Semantics(
                            label:
                                '${jobs.length} active sample jobs, 100 percent.',
                            child: SizedBox(
                              width: 180,
                              height: 180,
                              child: Stack(
                                alignment: Alignment.center,
                                children: [
                                  const SizedBox.expand(
                                    child: CircularProgressIndicator(
                                      value: 1,
                                      strokeWidth: 22,
                                      color: _teal,
                                    ),
                                  ),
                                  Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        '${jobs.length}',
                                        style: const TextStyle(
                                          fontSize: 32,
                                          fontWeight: FontWeight.bold,
                                          color: _teal,
                                        ),
                                      ),
                                      const Text(
                                        'Active sample jobs',
                                        style: TextStyle(fontSize: 12),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        const SizedBox(height: 24),
                        _Legend('Active: ${jobs.length}', _teal),
                        const SizedBox(height: 12),
                        const Text(
                          'Filled, expired and cancelled statuses are unavailable in the current model.',
                          style: TextStyle(
                            fontSize: 11,
                            color: Colors.blueGrey,
                          ),
                        ),
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
  }
}

class _ReportPanel extends StatelessWidget {
  const _ReportPanel({required this.title, required this.child});
  final String title;
  final Widget child;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: const Color(0xFFD1E1E8)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
        ),
        const SizedBox(height: 16),
        child,
      ],
    ),
  );
}

class _Legend extends StatelessWidget {
  const _Legend(this.label, this.color);
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(width: 10, height: 10, color: color),
      const SizedBox(width: 7),
      Flexible(child: Text(label, style: const TextStyle(fontSize: 12))),
    ],
  );
}

class _RegistrationChart extends CustomPainter {
  _RegistrationChart(this.months, this.locums, this.owners);
  final List<DateTime> months;
  final List<int> locums, owners;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTRB(30, 10, size.width - 15, size.height - 40);
    final maxCount = math.max(1, [...locums, ...owners].reduce(math.max));
    void label(String text, Offset offset) {
      final painter = TextPainter(
        text: TextSpan(
          text: text,
          style: const TextStyle(fontSize: 10, color: Colors.blueGrey),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      painter.paint(canvas, offset);
    }

    for (var i = 0; i <= 2; i++) {
      final y = plot.bottom - plot.height * i / 2;
      canvas.drawLine(
        Offset(plot.left, y),
        Offset(plot.right, y),
        Paint()..color = const Color(0xFFE0E9ED),
      );
      label((maxCount * i / 2).toStringAsFixed(1), Offset(0, y - 6));
    }
    double x(int i) => months.length == 1
        ? plot.center.dx
        : plot.left + i * plot.width / (months.length - 1);
    for (final series in [(locums, _teal), (owners, _ownerColor)]) {
      final path = Path();
      for (var i = 0; i < months.length; i++) {
        final point = Offset(
          x(i),
          plot.bottom - series.$1[i] / maxCount * plot.height,
        );
        if (i == 0) {
          path.moveTo(point.dx, point.dy);
        } else {
          path.lineTo(point.dx, point.dy);
        }
        canvas.drawCircle(point, 4, Paint()..color = series.$2);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = series.$2
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
    const names = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final step = math.max(
      1,
      (months.length / math.max(1, plot.width / 65)).ceil(),
    );
    for (var i = 0; i < months.length; i += step) {
      label(
        '${names[months[i].month - 1]} ${months[i].year % 100}',
        Offset(x(i) - 15, plot.bottom + 12),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RegistrationChart oldDelegate) => true;
}
