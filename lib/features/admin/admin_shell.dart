import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../auth/admin_login.dart';
import 'dashboard/dashboard_page.dart';
import 'dashboard/application_statistics_service.dart';
import 'practice_owners/practice_owner_accounts_page.dart';
import 'practice_owners/practice_owner_service.dart';
import 'locums/locum_accounts_page.dart';
import 'locums/locum_service.dart';
import 'job_postings/job_postings_page.dart';
import 'job_postings/job_posting_service.dart';
import 'reports/reports_page.dart';

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

class AdminShell extends StatefulWidget {
  const AdminShell({super.key});
  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _selected = 0;
  String _query = '';
  final _search = TextEditingController();
  final _owners = PracticeOwnerService();
  final _postings = JobPostingService();
  final _applications = ApplicationStatisticsService();
  late final LocumService _locums;
  late final Listenable _data;

  @override
  void initState() {
    super.initState();
    _postings.reload();
    _applications.reload();
    _owners.reload();
    _locums = LocumService()..reload();
    _data = Listenable.merge([_owners, _postings, _locums, _applications]);
  }

  @override
  void dispose() {
    _search.dispose();
    _owners.dispose();
    _postings.dispose();
    _applications.dispose();
    _locums.dispose();
    super.dispose();
  }

  void _navigate(int index) {
    setState(() {
      _selected = index;
      _query = '';
      _search.clear();
    });
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _data,
    builder: (context, _) => _buildShell(context),
  );
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

  Widget _buildShell(BuildContext context) {
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
                        if (_selected == 2)
                          const Text(
                            'Live locum profiles · Account actions are unavailable in this phase.',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.blueGrey,
                            ),
                          )
                        else if (_selected == 1)
                          const Text(
                            'Live practice owner profiles · Account actions are unavailable in this phase.',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.blueGrey,
                            ),
                          )
                        else if (_selected != 4)
                          Text(
                            _selected == 0
                                ? 'Account profiles and job postings use Firestore · Profile trends use creation dates.'
                                : 'Live job postings · Delete is unavailable in this phase.',
                            style: const TextStyle(
                              fontSize: 12,
                              color: Colors.blueGrey,
                            ),
                          ),
                        const SizedBox(height: 16),
                        if (_selected == 0)
                          DashboardPage(
                            locums: _locums,
                            owners: _owners,
                            postings: _postings,
                            applications: _applications,
                            query: _query,
                            onNavigate: _navigate,
                          )
                        else if (_selected == 4)
                          const ReportsPage()
                        else if (_selected == 1)
                          PracticeOwnerAccountsPage(
                            service: _owners,
                            query: _query,
                          )
                        else if (_selected == 2)
                          LocumAccountsPage(service: _locums, query: _query)
                        else
                          JobPostingsPage(service: _postings, query: _query),
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
}
