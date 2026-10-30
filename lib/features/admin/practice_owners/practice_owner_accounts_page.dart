import 'package:flutter/material.dart';

import '../widgets/account_table.dart';
import '../widgets/paginated_records.dart';
import 'practice_owner_profile.dart';
import 'practice_owner_service.dart';

class PracticeOwnerAccountsPage extends StatelessWidget {
  const PracticeOwnerAccountsPage({
    super.key,
    required this.service,
    required this.query,
  });
  final PracticeOwnerService service;
  final String query;

  @override
  Widget build(BuildContext context) {
    if (service.loading) {
      return const Padding(
        padding: EdgeInsets.all(48),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (service.errorMessage != null) {
      return Column(
        children: [
          Text(service.errorMessage!, textAlign: TextAlign.center),
          TextButton(onPressed: service.reload, child: const Text('Retry')),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (service.fromCache)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text(
              'Showing cached data while connecting to Firestore. Results may be incomplete.',
              style: TextStyle(fontSize: 12, color: Colors.blueGrey),
            ),
          ),
        PaginatedRecords<PracticeOwnerProfile>(
          records: service.accounts,
          query: query,
          emptyMessage: service.accounts.isEmpty
              ? 'No practice owner profiles available.'
              : 'No matching records.',
          matches: (a, q) => '${a.id} ${a.name} ${a.email} ${a.phone}'
              .toLowerCase()
              .contains(q),
          tableBuilder: (accounts) => AccountTable(
            accounts: accounts,
            readOnly: true,
            showRole: true,
            roleLabel: (account) => (account as PracticeOwnerProfile).role,
          ),
        ),
      ],
    );
  }
}
