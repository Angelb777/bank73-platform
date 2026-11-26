# Flujo legal de BANK73

Los tres documentos de esta carpeta son la fuente versionada que sirve el backend. No existe ni se necesita un panel de administración.

## Estado actual

- Versión por defecto: `draft-0.1`.
- Documentos aprobados: no.
- Registro de aceptación: no habilitado para borradores.
- Bloqueo backend: desactivado.

Sin variables adicionales, el middleware legal ejecuta `next()` y no cambia el comportamiento de autenticación ni de las API existentes.

## Publicación futura

Después de completar los datos pendientes y obtener aprobación jurídica:

1. Actualizar los tres archivos y retirar la marca de borrador.
2. Definir una versión definitiva nueva mediante `LEGAL_DOCUMENT_VERSION` (por ejemplo, `1.0.0`).
3. Establecer `LEGAL_DOCUMENTS_APPROVED=1` para permitir que esa versión pueda aceptarse.
4. Establecer `LEGAL_ACCEPTANCE_ENFORCED=1` para activar el bloqueo backend.
5. Desplegar y verificar web y móvil. El enforcement sólo se activa si ambas variables tienen valor `1`.

Para una modificación sustancial posterior, se editan los documentos y se incrementa `LEGAL_DOCUMENT_VERSION`. La clave única `userId + version` hará que todos los usuarios deban aceptar la nueva versión una sola vez, con independencia de los tenants a los que pertenezcan.

No debe reutilizarse un número de versión después de modificar el contenido. Los hashes SHA-256 almacenados en cada aceptación permiten acreditar exactamente los textos aceptados.
