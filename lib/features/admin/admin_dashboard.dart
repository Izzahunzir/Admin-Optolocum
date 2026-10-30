import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../auth/admin_login.dart';
import 'reports_page.dart';

const _teal = Color(0xFF3D7789);
const _background = Color(0xFFF5F7F9);
const _titles = [
  'Dashboard',
  'Practice Owner Account',
  'Locum Account',
  'Job Posting',
  'Reports',
];
const _icons = [
  Icons.dashboard,
  Icons.person,
  Icons.badge,
  Icons.work,
  Icons.assessment,
];

class AdminDashboardPage extends StatefulWidget {
  const AdminDashboardPage({super.key});

  @override
  State<AdminDashboardPage> createState() => _AdminDashboardPageState();
}

class _AdminDashboardPageState extends State<AdminDashboardPage> {
  int _selected = 0;
  int _page = 0;
  String _query = '';
  final _search = TextEditingController();
  final _owners = List.generate(
    12,
    (i) => _Account(
      'PO${i + 1}',
      ['Aina Rahman', 'Daniel Lee', 'Nur Amalina', 'Jason Tan'][i % 4],
      'practice${i + 1}@example.com',
      '012-345 ${1000 + i}',
    ),
  );
  final _locums = List.generate(
    12,
    (i) => _Account(
      'LC${i + 1}',
      ['Sarah Lim', 'Amir Hakim', 'Chloe Wong', 'Farah Aziz'][i % 4],
      'locum${i + 1}@example.com',
      '013-567 ${1000 + i}',
    ),
  );
  final _jobs = List.generate(
    12,
    (i) => _Job(
      'JOB${i + 1}',
      [
        'Clear Vision Optometry',
        'Vista Eye Centre',
        'Bright Optics',
        'Focus Optical',
      ][i % 4],
      ['Kuala Lumpur', 'Petaling Jaya', 'Shah Alam', 'Subang Jaya'][i % 4],
      '${i + 1} Nov 2026',
    ),
  );

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _navigate(int index) {
    setState(() {
      _selected = index;
      _page = 0;
      _query = '';
      _search.clear();
    });
  }

  Future<void> _logout() async {
    try {
      await FirebaseAuth.instance.signOut();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const AdminLoginPage()),
        (_) => false,
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to sign out. Please try again.'),
          ),
        );
      }
    }
  }

  Future<void> _delete(String name, VoidCallback remove) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete sample record?'),
        content: Text(
          'Remove $name from this preview? This change only lasts for this session.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      setState(() {
        remove();
        _page = 0;
      });
    }
  }

  Widget _sidebar() => Container(
    width: 230,
    color: _teal,
    child: SafeArea(
      child: Column(
        children: [
          const SizedBox(height: 30),
          const CircleAvatar(
            radius: 43,
            backgroundColor: Color(0xFFE7EFF2),
            child: Icon(Icons.person, size: 66, color: Color(0xFF5C8EA3)),
          ),
          const SizedBox(height: 14),
          const Text(
            'Administrator',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 5),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              FirebaseAuth.instance.currentUser?.email ?? 'OptoLocum Admin',
              style: const TextStyle(color: Colors.white70, fontSize: 11),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(height: 34),
          for (int i = 0; i < _titles.length; i++)
            Container(
              color: _selected == i
                  ? Colors.white.withValues(alpha: .16)
                  : Colors.transparent,
              child: ListTile(
                dense: true,
                leading: Icon(_icons[i], color: Colors.white, size: 18),
                horizontalTitleGap: 10,
                title: Text(
                  _titles[i],
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                ),
                selected: _selected == i,
                onTap: () {
                  _navigate(i);
                  if (MediaQuery.sizeOf(context).width < 850) {
                    Navigator.pop(context);
                  }
                },
              ),
            ),
          const Spacer(),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.white, size: 18),
            title: const Text(
              'Sign out',
              style: TextStyle(color: Colors.white, fontSize: 13),
            ),
            onTap: _logout,
          ),
          const SizedBox(height: 16),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 850;
    return Scaffold(
      backgroundColor: _background,
      drawer: wide ? null : Drawer(child: _sidebar()),
      body: Row(
        children: [
          if (wide) _sidebar(),
          Expanded(
            child: Column(
              children: [
                Container(
                  color: const Color(0xFFC5E6EE),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 16,
                  ),
                  child: SafeArea(
                    bottom: false,
                    child: Row(
                      children: [
                        if (!wide)
                          Builder(
                            builder: (context) => IconButton(
                              onPressed: () =>
                                  Scaffold.of(context).openDrawer(),
                              icon: const Icon(Icons.menu, color: _teal),
                            ),
                          ),
                        const Expanded(
                          child: Text(
                            'Welcome, Admin!',
                            style: TextStyle(
                              color: Color(0xFF285D65),
                              fontWeight: FontWeight.bold,
                              fontSize: 17,
                            ),
                          ),
                        ),
                        SizedBox(
                          width: wide ? 270 : 140,
                          height: 36,
                          child: TextField(
                            controller: _search,
                            onChanged: (value) => setState(() {
                              _query = value.toLowerCase();
                              _page = 0;
                            }),
                            decoration: InputDecoration(
                              hintText: 'Search',
                              hintStyle: const TextStyle(fontSize: 12),
                              suffixIcon: const Icon(Icons.search, size: 18),
                              filled: true,
                              fillColor: Colors.white,
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 15,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(24),
                                borderSide: BorderSide.none,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.all(wide ? 24 : 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 24,
                            vertical: 20,
                          ),
                          decoration: BoxDecoration(
                            color: _teal,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: const Color(0xFF2B5F70),
                              width: 1.5,
                            ),
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x203D7789),
                                blurRadius: 8,
                                offset: Offset(0, 3),
                              ),
                            ],
                          ),
                          child: Text(
                            _titles[_selected],
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        if (_selected != 4)
                          const Text(
                            'Sample data · Preview changes are not saved to Firebase.',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.blueGrey,
                            ),
                          ),
                        const SizedBox(height: 16),
                        if (_selected == 0)
                          _dashboard()
                        else if (_selected == 4)
                          const ReportsPage()
                        else
                          _records(),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _dashboard() => LayoutBuilder(
    builder: (context, constraints) {
      final width = constraints.maxWidth;
      final columns = width >= 1000
          ? 4
          : width >= 500
          ? 2
          : 1;
      final items = [
        (
          'Total Locum Accounts',
          '${_locums.length}',
          Icons.person,
          const Color(0xFFE4F3EF),
          _teal,
          2,
        ),
        (
          'Total Practice Owners',
          '${_owners.length}',
          Icons.medical_services,
          const Color(0xFFCEE5EE),
          const Color(0xFF18546A),
          1,
        ),
        (
          'Active Job Postings',
          '${_jobs.length}',
          Icons.work,
          const Color(0xFFF8DCBC),
          const Color(0xFFEF8300),
          3,
        ),
        (
          'Pending Applications',
          'N/A',
          Icons.hourglass_top,
          const Color(0xFFEFC1BE),
          const Color(0xFFC62828),
          0,
        ),
      ];
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 14,
            runSpacing: 14,
            children: [
              for (final item in items)
                SizedBox(
                  width: (width - (columns - 1) * 14) / columns,
                  child: Material(
                    color: item.$4,
                    borderRadius: BorderRadius.circular(6),
                    child: InkWell(
                      onTap: item.$6 == 0 ? null : () => _navigate(item.$6),
                      child: Padding(
                        padding: const EdgeInsets.all(18),
                        child: Row(
                          children: [
                            Icon(item.$3, size: 36, color: item.$5),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.$1,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 5),
                                  Text(
                                    item.$2,
                                    style: const TextStyle(
                                      fontSize: 26,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    item.$6 == 0
                                        ? 'Data not connected'
                                        : 'Sample total',
                                    style: const TextStyle(fontSize: 10),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: [
              SizedBox(
                width: width >= 760 ? (width - 32) / 3 : width,
                child: _panel(
                  'User Registration Trend',
                  Column(
                    children: [
                      const Text(
                        'Illustrative monthly registrations',
                        style: TextStyle(fontSize: 11, color: Colors.blueGrey),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        height: 140,
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            for (final month in [
                              ('May', 35.0),
                              ('Jun', 62.0),
                              ('Jul', 50.0),
                              ('Aug', 90.0),
                              ('Sep', 76.0),
                              ('Oct', 105.0),
                            ])
                              Column(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  Container(
                                    width: 16,
                                    height: month.$2,
                                    decoration: BoxDecoration(
                                      color: _teal,
                                      borderRadius: BorderRadius.circular(3),
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    month.$1,
                                    style: const TextStyle(fontSize: 10),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SizedBox(
                width: width >= 760 ? (width - 32) / 3 : width,
                child: _panel(
                  'Job Posting Overview',
                  Column(
                    children: [
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 110,
                        width: 110,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            const SizedBox.expand(
                              child: CircularProgressIndicator(
                                value: 1,
                                strokeWidth: 13,
                                color: _teal,
                              ),
                            ),
                            Text(
                              '${_jobs.length}',
                              style: const TextStyle(
                                fontSize: 28,
                                fontWeight: FontWeight.bold,
                                color: _teal,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 28),
                      const Text(
                        'Active sample postings',
                        style: TextStyle(fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
              SizedBox(
                width: width >= 760 ? (width - 32) / 3 : width,
                child: _panel(
                  'Account Overview',
                  Column(
                    children: [
                      _accountSummary('Locums', _locums),
                      const SizedBox(height: 20),
                      _accountSummary('Practice owners', _owners),
                      const SizedBox(height: 14),
                      const Text(
                        'Sample account status',
                        style: TextStyle(fontSize: 11, color: Colors.blueGrey),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: [
              SizedBox(
                width: width >= 760 ? (width - 16) / 2 : width,
                child: _panel(
                  'Recent Job Postings',
                  Column(
                    children: [
                      for (final job
                          in _jobs
                              .where((j) => j.search.contains(_query))
                              .take(3))
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          leading: const Icon(Icons.work_outline, color: _teal),
                          title: Text(job.practice),
                          subtitle: Text('${job.location} | ${job.date}'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => _navigate(3),
                        ),
                      if (_jobs.where((j) => j.search.contains(_query)).isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(24),
                          child: Text('No matching postings.'),
                        ),
                      TextButton(
                        onPressed: () => _navigate(3),
                        child: const Text('View all job postings'),
                      ),
                    ],
                  ),
                ),
              ),
              SizedBox(
                width: width >= 760 ? (width - 16) / 2 : width,
                child: _panel(
                  'Quick Actions',
                  Column(
                    children: [
                      _quickAction('Manage locum accounts', Icons.person, 2),
                      const SizedBox(height: 10),
                      _quickAction(
                        'Manage practice owners',
                        Icons.medical_services,
                        1,
                      ),
                      const SizedBox(height: 10),
                      _quickAction('Review job postings', Icons.work, 3),
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

  Widget _panel(String title, Widget child) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: const Color(0xFFEDF5F8),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 18),
        child,
      ],
    ),
  );

  Widget _accountSummary(String label, List<_Account> accounts) {
    final enabled = accounts.where((a) => !a.disabled).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        LinearProgressIndicator(
          value: accounts.isEmpty ? 0 : enabled / accounts.length,
          color: _teal,
          backgroundColor: const Color(0xFFD7E4EA),
          minHeight: 8,
        ),
        const SizedBox(height: 6),
        Text(
          '$enabled enabled / ${accounts.length - enabled} disabled',
          style: const TextStyle(fontSize: 11, color: Colors.blueGrey),
        ),
      ],
    );
  }

  Widget _quickAction(String title, IconData icon, int destination) => Material(
    color: const Color(0xFFE0F1EF),
    borderRadius: BorderRadius.circular(5),
    child: ListTile(
      dense: true,
      leading: Icon(icon, color: _teal),
      title: Text(title, style: const TextStyle(fontSize: 12)),
      trailing: const Icon(Icons.chevron_right, size: 18),
      onTap: () => _navigate(destination),
    ),
  );
  Widget _records() {
    final jobs = _jobs.where((j) => j.search.contains(_query)).toList();
    final accounts = (_selected == 1 ? _owners : _locums)
        .where(
          (a) => '${a.id} ${a.name} ${a.email} ${a.phone}'
              .toLowerCase()
              .contains(_query),
        )
        .toList();
    final count = _selected == 3 ? jobs.length : accounts.length;
    final pages = (count / 6).ceil();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (count == 0)
          const Padding(
            padding: EdgeInsets.all(48),
            child: Center(child: Text('No matching records.')),
          )
        else if (_selected == 3)
          _jobTable(jobs.skip(_page * 6).take(6).toList())
        else
          _accountTable(accounts.skip(_page * 6).take(6).toList()),
        const SizedBox(height: 12),
        Wrap(
          alignment: WrapAlignment.end,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Text(
              '$count records',
              style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
            ),
            TextButton(
              onPressed: _page > 0 ? () => setState(() => _page--) : null,
              child: const Text('Previous'),
            ),
            for (int i = 0; i < pages; i++)
              TextButton(
                onPressed: () => setState(() => _page = i),
                style: TextButton.styleFrom(
                  backgroundColor: _page == i ? const Color(0xFFDDEEF2) : null,
                ),
                child: Text('${i + 1}'),
              ),
            TextButton(
              onPressed: _page + 1 < pages
                  ? () => setState(() => _page++)
                  : null,
              child: const Text('Next'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _table(List<String> headers, List<DataRow> rows) => Container(
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

  Widget _accountTable(List<_Account> accounts) => _table(
    ['ID', if (_selected == 1) 'Role', 'Name', 'Email', 'Phone No', 'Action'],
    accounts
        .map(
          (a) => DataRow(
            cells: [
              DataCell(Text(a.id)),
              if (_selected == 1) const DataCell(Text('Practice owner')),
              DataCell(Text(a.name)),
              DataCell(Text(a.email)),
              DataCell(Text(a.phone)),
              DataCell(
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _action(
                      a.disabled ? 'Enable' : 'Disable',
                      Colors.orange,
                      () => setState(() => a.disabled = !a.disabled),
                    ),
                    const SizedBox(width: 8),
                    _action(
                      'Delete',
                      Colors.red,
                      () => _delete(
                        a.name,
                        () => (_selected == 1 ? _owners : _locums).remove(a),
                      ),
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

  Widget _jobTable(List<_Job> jobs) => _table(
    [
      'Job ID',
      'Practice name',
      'Role',
      'Location',
      'Date',
      'Time',
      'Rate',
      'Contact',
      'Action',
    ],
    jobs
        .map(
          (j) => DataRow(
            cells: [
              DataCell(Text(j.id)),
              DataCell(Text(j.practice)),
              const DataCell(Text('Optometrist')),
              DataCell(Text(j.location)),
              DataCell(Text(j.date)),
              const DataCell(Text('9am – 6pm')),
              const DataCell(Text('RM 50/hr')),
              const DataCell(Text('012-345 6789')),
              DataCell(
                _action(
                  'Delete',
                  Colors.red,
                  () => _delete(j.id, () => _jobs.remove(j)),
                ),
              ),
            ],
          ),
        )
        .toList(),
  );

  Widget _action(String label, Color color, VoidCallback onPressed) =>
      OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(color: color.withValues(alpha: .5)),
          minimumSize: const Size(58, 28),
          padding: const EdgeInsets.symmetric(horizontal: 10),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)),
          textStyle: const TextStyle(fontSize: 11),
        ),
        child: Text(label),
      );
}

class _Account {
  _Account(this.id, this.name, this.email, this.phone);
  final String id, name, email, phone;
  bool disabled = false;
}

class _Job {
  _Job(this.id, this.practice, this.location, this.date);
  final String id, practice, location, date;
  String get search =>
      '$id $practice $location $date optometrist'.toLowerCase();

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class AdminDashboardPage extends StatelessWidget {
  const AdminDashboardPage({super.key});

  Future<void> _logout(BuildContext context) async {
    await FirebaseAuth.instance.signOut();

    if (context.mounted) {
      Navigator.of(context).pushNamedAndRemoveUntil(
        '/',
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('OptoLocum Admin Dashboard'),
        backgroundColor: const Color(0xFF5C8EA3),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Logout',
            onPressed: () => _logout(context),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: const Center(
        child: Text(
          'Welcome, Admin!\nLogin successful.',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }
}
