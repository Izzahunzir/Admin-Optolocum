/// Explicit backend origin shared by Admin HTTP services.
class BackendEndpoint {
  const BackendEndpoint({
    this.baseUrl = const String.fromEnvironment('ADMIN_BACKEND_URL'),
    this.localDemo = const bool.fromEnvironment('FYP_USE_FIREBASE_EMULATORS'),
  });
  final String baseUrl;
  final bool localDemo;
  Uri uri(String path, {Map<String, String>? queryParameters}) {
    final base = Uri.tryParse(baseUrl);
    final local =
        localDemo &&
        base?.scheme == 'http' &&
        base?.host == '127.0.0.1' &&
        base?.port == 8787;
    if (base == null ||
        (!local && base.scheme != 'https') ||
        base.host.isEmpty ||
        base.userInfo.isNotEmpty ||
        (base.path.isNotEmpty && base.path != '/') ||
        base.hasQuery ||
        base.hasFragment) {
      throw StateError('Configure ADMIN_BACKEND_URL as an HTTPS origin.');
    }
    return base.replace(path: path, queryParameters: queryParameters);
  }
}
