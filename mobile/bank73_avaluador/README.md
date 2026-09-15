# Bank73 Avaluador

Aplicación móvil independiente para ejecutar inspecciones de obra asignadas por Bank73.

## Configuración

El backend se configura exclusivamente mediante `dart-define`:

```powershell
# Emulador Android, backend local en el puerto 3000 (opcional)
flutter run --dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://10.0.2.2:3000

# Dispositivo físico en la misma red
flutter run --dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://192.168.1.20:3000

# Backend real (HTTPS obligatorio en production)
flutter run --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://www.bank73.com
```

Sin `API_BASE_URL`, la app utiliza `https://www.bank73.com`, también desde un Android físico. `API_BASE_URL` permite sustituirlo para desarrollo local.

El login solicita solo email y contraseña. El JWT se guarda con `flutter_secure_storage`; no se guardan credenciales ni se selecciona un tenant en el cliente.

## Verificación

```powershell
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

La aplicación no solicita permisos de cámara, ubicación, archivos ni notificaciones.
