
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'firebase_options.dart';
import 'features/auth/admin_login.dart';
import 'features/admin/admin_dashboard.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  runApp(const AdminOptolocumApp());
}

class AdminOptolocumApp extends StatelessWidget {
  const AdminOptolocumApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'OptoLocum Admin',
      home: AdminAuthGate(),
    );
  }
}

class AdminAuthGate extends StatefulWidget {
  const AdminAuthGate({super.key});

  @override
  State<AdminAuthGate> createState() => _AdminAuthGateState();
}

class _AdminAuthGateState extends State<AdminAuthGate> {
  bool isChecking = true;
  bool isAuthorized = false;

  @override
  void initState() {
    super.initState();
    checkAdminSession();
  }

  Future<void> checkAdminSession() async {
    try {
      // Wait for Firebase to restore the previous session.
      final user = await FirebaseAuth.instance.authStateChanges().first;

      if (user == null) {
        if (!mounted) return;
        setState(() {
          isAuthorized = false;
          isChecking = false;
        });
        return;
      }

      // Force refresh to check the latest admin custom claim.
      final tokenResult = await user.getIdTokenResult(true);
      final isAdmin = tokenResult.claims?['admin'] == true;

      if (!isAdmin) {
        await FirebaseAuth.instance.signOut();
      }

      if (!mounted) return;

      setState(() {
        isAuthorized = isAdmin;
        isChecking = false;
      });
    } catch (e) {
      // Do not grant access when authorization cannot be verified.
      if (!mounted) return;

      setState(() {
        isAuthorized = false;
        isChecking = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (isChecking) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (isAuthorized) {
      return const AdminDashboardPage();
    }

    return const AdminLoginPage();
  }
}
