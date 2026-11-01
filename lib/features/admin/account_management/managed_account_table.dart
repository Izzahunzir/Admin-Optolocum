import 'package:flutter/material.dart';

import '../widgets/account_record.dart';
import '../widgets/account_table.dart';
import 'account_management_api.dart';

class ManagedAccountTable extends StatefulWidget {
  const ManagedAccountTable({
    super.key,
    required this.accounts,
    required this.kind,
    this.roleLabel,
    this.api,
  });
  final List<AccountRecord> accounts;
  final String kind;
  final String Function(AccountRecord)? roleLabel;
  final AccountManagementApi? api;
  @override
  State<ManagedAccountTable> createState() => _ManagedAccountTableState();
}

class _ManagedAccountTableState extends State<ManagedAccountTable> {
  late final AccountManagementApi _api = widget.api ?? AccountManagementApi();
  final Map<String, bool> _disabled = {};
  final Set<String> _busy = {};
  String? _error;
  bool _reading = false;
  bool _completed = false;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ManagedAccountTable oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.accounts.map((a) => a.id).join('|') !=
        widget.accounts.map((a) => a.id).join('|')) {
      _load();
    }
  }

  String _message(Object error) {
    if (error is AccountManagementException) {
      return '${error.code}: ${error.message}';
    }
    return 'Unable to confirm account status. Please retry.';
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _disabled.clear();
      _error = null;
      _reading = true;
      _completed = false;
    });
    await Future.wait(
      widget.accounts.map((account) async {
        try {
          final status = await _api.call(account.id, widget.kind, 'status');
          if (!mounted || generation != _generation) return;
          if (status['disabled'] is! bool) {
            throw StateError('Invalid account status');
          }
          setState(() => _disabled[account.id] = status['disabled'] as bool);
        } catch (error) {
          if (mounted && generation == _generation) {
            setState(() => _error = _message(error));
          }
        }
      }),
    );
    if (mounted && generation == _generation) {
      setState(() {
        _reading = false;
        _completed = true;
      });
    }
  }

  Future<bool> _confirm(AccountRecord account, String action) async {
    String typedUid = '';
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => StatefulBuilder(
            builder: (context, updateDialog) => AlertDialog(
              title: Text('$action account?'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${account.name}\n${account.email}\nUID: ${account.id}',
                    ),
                    const SizedBox(height: 16),
                    Text(
                      action == 'Delete'
                          ? 'Permanently delete the Authentication account and both profile types for this UID. This cannot be undone. Related jobs or applications block deletion. Disable the account and wait at least 61 minutes first.'
                          : action == 'Disable'
                          ? 'Block new sign-ins and revoke refresh tokens? Existing access may continue until its current ID token expires (up to about one hour).'
                          : 'Allow this account to sign in again? The user must log in again.',
                    ),
                    if (action == 'Delete') ...[
                      const SizedBox(height: 16),
                      TextField(
                        decoration: const InputDecoration(
                          labelText: 'Type the UID to confirm',
                        ),
                        onChanged: (value) =>
                            updateDialog(() => typedUid = value),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('Cancel'),
                ),
                TextButton(
                  onPressed: action == 'Delete' && typedUid != account.id
                      ? null
                      : () => Navigator.pop(dialogContext, true),
                  child: Text(
                    action,
                    style: TextStyle(
                      color: action == 'Delete'
                          ? Colors.red
                          : const Color(0xFF3D7789),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ) ??
        false;
  }

  Future<void> _act(AccountRecord account, {bool delete = false}) async {
    if (!_api.accountChangesEnabled) return;
    if (_busy.contains(account.id)) return;
    setState(() => _busy.add(account.id));
    try {
      // Re-read authoritative Authentication state before asking for confirmation.
      final state = await _api.call(account.id, widget.kind, 'status');
      if (!mounted) return;
      final disabled = state['disabled'];
      if (disabled is! bool) throw StateError('Invalid account status');
      setState(() => _disabled[account.id] = disabled);
      final action = delete
          ? 'Delete'
          : disabled
          ? 'Enable'
          : 'Disable';
      if (!await _confirm(account, action) || !mounted) return;
      final result = await _api.call(
        account.id,
        widget.kind,
        delete ? 'delete' : 'setDisabled',
        disabled: delete ? null : !disabled,
        expectedDisabled: delete ? null : disabled,
        confirmUid: delete ? account.id : null,
      );
      if (!mounted) return;
      if (delete) {
        _disabled.remove(account.id);
      } else {
        _disabled[account.id] = result['disabled'] as bool;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$action completed.')));
    } catch (error) {
      _disabled.remove(account.id);
      if (mounted) {
        setState(() => _error = _message(error));
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_message(error))));
      }
    } finally {
      if (mounted) setState(() => _busy.remove(account.id));
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (!_api.accountChangesEnabled)
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text(
            'Account changes are disabled in Phase 1 pending security verification.',
            style: TextStyle(fontSize: 12, color: Colors.blueGrey),
          ),
        ),
      Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        children: [
          Text(
            _api.baseUrl.isEmpty
                ? 'Status source: Cloud Functions (local URL not configured)'
                : _api.baseUrl == 'mock'
                ? 'Status source: in-memory test backend'
                : 'Status source: localhost (read-only)',
            style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
          ),
          TextButton.icon(
            onPressed: _reading || _busy.isNotEmpty ? null : _load,
            icon: const Icon(Icons.refresh, size: 16),
            label: Text(
              _reading ? 'Checking account status…' : 'Refresh account status',
            ),
          ),
        ],
      ),
      if (_completed)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text(
            'Status read succeeded for ${_disabled.length} of ${widget.accounts.length} displayed accounts.',
            style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
          ),
        ),
      if (_error != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                _error!,
                style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
              ),
            ],
          ),
        ),
      AccountTable(
        accounts: widget.accounts,
        showRole: widget.kind == 'practice_owner',
        roleLabel: widget.roleLabel,
        disabledFor: (a) => _disabled[a.id] ?? false,
        statusLabel: (a) => _disabled.containsKey(a.id)
            ? (_disabled[a.id]! ? 'Disabled' : 'Enabled')
            : (_reading ? 'Checking…' : 'Unavailable'),
        canManage: (a) =>
            _api.accountChangesEnabled &&
            _disabled.containsKey(a.id) &&
            !_busy.contains(a.id),
        onToggle: (a) => _act(a),
        onDelete: (a) => _act(a, delete: true),
      ),
    ],
  );
}
