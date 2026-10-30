class AccountRecord {
  AccountRecord(this.id, this.name, this.email, this.phone);
  final String id, name, email, phone;
  bool disabled = false;
}
