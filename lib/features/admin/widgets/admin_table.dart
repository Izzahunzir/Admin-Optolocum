import 'package:flutter/material.dart';

class AdminTable extends StatelessWidget {
  const AdminTable({super.key, required this.headers, required this.rows});
  final List<String> headers;
  final List<DataRow> rows;
  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xFFD8DEE3)),
    ),
    child: LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: ConstrainedBox(
          constraints: BoxConstraints(minWidth: constraints.maxWidth),
          child: DataTable(
            headingRowHeight: 48,
            dataRowMinHeight: 58,
            dataRowMaxHeight: 64,
            columnSpacing: 26,
            horizontalMargin: 18,
            headingTextStyle: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 12,
              color: Color(0xFF263238),
            ),
            dataTextStyle: const TextStyle(
              fontSize: 12,
              color: Color(0xFF455A64),
            ),
            columns: headers.map((h) => DataColumn(label: Text(h))).toList(),
            rows: rows,
          ),
        ),
      ),
    ),
  );
}
