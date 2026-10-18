# Bank73 Real Estate Viewer — prototipo independiente

Visor Three.js desacoplado de la plataforma Bank73. La geometría, los datos por unidad y la interfaz viven en módulos separados. Torre C usa el inventario vigente del Dato Único oficial: 57 unidades en cinco niveles. Las torres A y B conservan la volumetría documental de 2011 y permanecen sin asociación comercial.

## Segunda pasada visual e interiores

- Paleta, iluminación, contraste, sombras, vidrio, balcones, pavimentos, agua y paisaje revisados.
- Torres A y B algo más separadas, sin cambiar sus huellas aprobadas ni la distribución vertical.
- Basamento construido simplificado con tres franjas de estacionamiento, plataforma exterior, piscina y jardineras.
- Botón **Ver interior** y doble clic sobre una unidad para abrir una axonometría navegable sin techo; **Volver al conjunto** restaura la cámara anterior.
- Interiores paramétricos para las tipologías históricas de A/B. Permanecen desactivados en Torre C porque el Excel no define una planta interior verificable para los modelos A/B/C/C1/D.
- Enlace directo opcional para integración o revisión: `?interior=A-N0100-U01`.

## Ejecutar

```powershell
cd el-palmar-viewer
npm install
npm run dev
```

Abrir la URL que indique Vite (normalmente `http://127.0.0.1:5173`). Para comprobar una compilación de producción:

```powershell
npm run build
npm run preview
```

Las pruebas cubren las 57 unidades actuales de Torre C, su distribución 11/12/12/11/11, la unicidad de identificadores comerciales y la conservación de `unitId` en las tipologías interiores históricas.

## Contrato de unidad

Cada unidad es un `THREE.Group` independiente. `group.userData.unitId` contiene su clave y `group.userData.selectableMesh` apunta a la malla utilizada por el raycaster. En Torre C, `unitId` y `externalId` contienen el identificador comercial real (`L-101` a `L-511` según el nivel). En A/B se mantienen claves técnicas sin asociación comercial.

## Añadir otro proyecto

Crear una configuración con el mismo contrato que `src/data/el-palmar.project.js`, aportar un adaptador que devuelva `{ root, towers, units }` y pasarlo a `RealEstateViewer`. El visor y las capas de datos no dependen del nombre El Palmar.
