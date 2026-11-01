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
    this.canManage,
    this.disabledFor,
    this.statusLabel,
  });
  final List<AccountRecord> accounts;
  final bool showRole, readOnly;
  final ValueChanged<AccountRecord>? onToggle, onDelete;
  final String Function(AccountRecord)? roleLabel;
  final bool Function(AccountRecord)? canManage, disabledFor;
  final String Function(AccountRecord)? statusLabel;
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
                      (disabledFor?.call(a) ?? a.disabled)
                          ? 'Enable'
                          : 'Disable',
                      Colors.orange,
                      readOnly ||
                              onToggle == null ||
                              canManage?.call(a) == false
                          ? null
                          : () => onToggle!(a),
                    ),
                    const SizedBox(width: 8),
                    accountAction(
                      'Delete',
                      Colors.red,
                      readOnly ||
                              onDelete == null ||
                              canManage?.call(a) == false
                          ? null
                          : () => onDelete!(a),
                    ),
                    if (statusLabel != null)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Text(
                          statusLabel!(a),
                          style: const TextStyle(fontSize: 11),
                        ),
                      )
                    else if (disabledFor?.call(a) ?? a.disabled)
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
