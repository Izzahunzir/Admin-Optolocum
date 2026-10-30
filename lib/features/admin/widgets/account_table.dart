import 'package:flutter/material.dart';

import 'account_record.dart';
import 'account_action.dart';
import 'admin_table.dart';

class AccountTable extends StatelessWidget {
  const AccountTable({
    super.key,
    required this.accounts,
    this.showRole = false,
    this.readOnly = false,
    this.onToggle,
    this.onDelete,
    this.roleLabel,
  });
  final List<AccountRecord> accounts;
  final bool showRole, readOnly;
  final ValueChanged<AccountRecord>? onToggle, onDelete;
  final String Function(AccountRecord)? roleLabel;
  @override
  Widget build(BuildContext context) => AdminTable(
    headers: [
      'ID',
      if (showRole) 'Role',
      'Name',
      'Email',
      'Phone No',
      'Action',
    ],
    rows: accounts
        .map(
          (a) => DataRow(
            cells: [
              DataCell(Text(a.id)),
              if (showRole)
                DataCell(Text(roleLabel?.call(a) ?? 'Practice owner')),
              DataCell(Text(a.name)),
              DataCell(Text(a.email)),
              DataCell(Text(a.phone)),
              DataCell(
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    accountAction(
                      a.disabled ? 'Enable' : 'Disable',
                      Colors.orange,
                      readOnly ? null : () => onToggle!(a),
                    ),
                    const SizedBox(width: 8),
                    accountAction(
                      'Delete',
                      Colors.red,
                      readOnly ? null : () => onDelete!(a),
                    ),
                    if (a.disabled)
                      const Padding(
                        padding: EdgeInsets.only(left: 8),
                        child: Text(
                          'Disabled',
                          style: TextStyle(color: Colors.orange),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        )
        .toList(),
  );
}
