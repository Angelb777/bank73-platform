# Bank73 Avaluador

Aplicación móvil independiente para ejecutar inspecciones de obra asignadas por Bank73.

## Configuración

El backend se configura exclusivamente mediante `dart-define`:

```powershell
# Emulador Android, backend local en el puerto 3000
flutter run --dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://10.0.2.2:3000

# Dispositivo físico en la misma red
flutter run --dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://192.168.1.20:3000

# Producción (HTTPS obligatorio)
flutter run --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://api.example.com
```

Sin `API_BASE_URL`, development utiliza `http://10.0.2.2:3000`. Production rechaza URLs sin HTTPS.

El login solicita el `tenantKey` del banco, email y contraseña. El JWT y el tenant resuelto se guardan con `flutter_secure_storage`; no se guardan credenciales.

## Verificación

```powershell
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

La aplicación no solicita permisos de cámara, ubicación, archivos ni notificaciones.
