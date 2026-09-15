class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;

  bool get isUnauthorized => statusCode == 401;
  bool get isForbiddenOrMissing => statusCode == 403 || statusCode == 404;
  bool get isVersionConflict => statusCode == 409 && code == 'version_conflict';

  @override
  String toString() => message;
}
