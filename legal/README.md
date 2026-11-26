# Flujo legal de BANK73

Los tres documentos de esta carpeta son la fuente versionada que sirve el backend. No existe ni se necesita un panel de administración.

## Estado actual

- Versión vigente: `1.0.0`.
- Documentos aprobados y publicados.
- Registro de aceptación habilitado.
- Bloqueo backend activado.

Sin variables adicionales, el middleware exige la aceptación de la versión vigente. Para una desactivación de emergencia puede establecerse `LEGAL_ACCEPTANCE_ENFORCED=0`.

## Nueva versión futura

1. Actualizar los tres documentos.
2. Incrementar `LEGAL_DOCUMENT_VERSION`.
3. Desplegar y verificar web y móvil.

Para una modificación sustancial posterior, se editan los documentos y se incrementa `LEGAL_DOCUMENT_VERSION`. La clave única `userId + version` hará que todos los usuarios deban aceptar la nueva versión una sola vez, con independencia de los tenants a los que pertenezcan.

No debe reutilizarse un número de versión después de modificar el contenido. Los hashes SHA-256 almacenados en cada aceptación permiten acreditar exactamente los textos aceptados.
