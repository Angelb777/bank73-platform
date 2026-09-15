abstract final class ApiConfig {
  static const environment = String.fromEnvironment(
    'APP_ENV',
    defaultValue: 'development',
  );
  static const _configuredBaseUrl = String.fromEnvironment('API_BASE_URL');

  static String get baseUrl {
    final value = _configuredBaseUrl.trim().isNotEmpty
        ? _configuredBaseUrl.trim()
        : 'https://www.bank73.com';
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty)
      throw StateError('API_BASE_URL no es una URL valida.');
    if (environment == 'production' && uri.scheme != 'https') {
      throw StateError('API_BASE_URL debe utilizar HTTPS en produccion.');
    }
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

  static Uri uri(String path) =>
      Uri.parse('$baseUrl${path.startsWith('/') ? path : '/$path'}');

  static String? assetUrl(String? source) {
    final value = source?.trim() ?? '';
    if (value.isEmpty) return null;
    final parsed = Uri.tryParse(value);
    if (parsed != null && parsed.hasScheme) return value;
    return uri(value).toString();
  }
}
