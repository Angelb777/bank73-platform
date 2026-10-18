# Análisis documental — Residencial El Palmar

Fecha de revisión: 2026-10-16

## Jerarquía de fuentes

1. **Fuente prioritaria para Torre C vigente:** `DATO ÚNICO EL PALMAR TORRE C (OFICIAL Y COMPLETO).xlsx`. Define 57 identificadores comerciales, niveles, modelos, superficies, precios y estados. El usuario confirmó que este inventario sustituye el conteo anterior de Torre C.
2. **Referencia geométrica actual de Torre C:** `TORRE C-BALCONES 28.07.23.pdf`. Su elevación documenta cinco niveles (-400, -300, -200, -100 y 000) y su planta muestra la reorganización en unidades más pequeñas. Los acabados y balcones siguen tratándose como referencia visual, no como inventario comercial.
3. **Fuente histórica para A/B y el conjunto original:** `PLANOS ARQUITECTURA EL PALMAR  TORRE A-B -C APROBADOS.pdf`, juego de 65 láminas con sellos de aprobación del 2 de marzo de 2011.
2. `PLANOS ARQUITECTURA TORRE A.pdf`: duplicado visual exacto del juego aprobado. Las 65 páginas renderizadas coinciden píxel a píxel; solo cambian metadatos del contenedor PDF.
4. `20400-TPA-EP-ARQ-P01-R01.pdf`, 27 de abril de 2023: estudio preliminar R1 de la torre C. Incluye levantamiento, propuesta de fachada y referencias.
5. Diez renders JPG de modelos A, B, C, C1 y D: referencia de distribución interior y acabado. No contienen escala, fecha, revisión ni correspondencia verificable con los tipos 1R/2R/3R/PH del plano aprobado.

## Datos aprobados incorporados

- Conjunto de tres torres: dos torres gemelas altas A/B y una torre C longitudinal integrada con estacionamientos y área social.
- Total histórico aprobado en 2011: **231 apartamentos**. Ya no representa el inventario vigente de Torre C.
- Torre A: 96 unidades (2 PH, 6 de tres recámaras, 44 de dos recámaras y 44 de una recámara).
- Torre B: 96 unidades con la misma distribución.
- Torre C vigente: **57 unidades**: 11 en 000, 11 en -100, 12 en -200, 12 en -300 y 11 en -400.
- Torres A/B: huella acotada de 27,15 × 19,50 m; niveles 100 a 2900; modulación vertical repetida de 2,75 m.
- Niveles 100–2200 de A/B: cuatro unidades por nivel, dos de una recámara y dos de dos recámaras.
- Niveles 2300–2500 de A/B: dos unidades de tres recámaras por nivel.
- Nivel 2600 de A/B: dos PH que continúan volumétricamente por los niveles 2700 y 2800. Nivel 2900: azotea.
- Torre C: ancho general acotado de 65,90 m. El inventario actual usa los modelos comerciales A, B, C, C1 y D. No se infiere el número de recámaras porque el Excel no lo especifica.

## Aproximaciones aún identificadas como provisionales

- Los `unitId` de Torre C son los identificadores comerciales del Excel (`L-101` a `L-511` por nivel). A/B conservan claves técnicas sin vínculo comercial.
- La huella exacta de 11 m usada para la barra residencial C es una simplificación del conjunto de cotas y se marca como aproximada; el ancho 65,90 m sí está acotado.
- La posición relativa fina de A/B respecto a C se ha reconstruido desde plantas generales y renders, sin coordenadas topográficas trasladadas al modelo.
- Huecos, antepechos, núcleos, barandillas y acabados se simplifican. Las ampliaciones de balcones y azotea de 2023 no se presentan como obra aprobada.
- No se asignan los renders A/B/C/C1/D a las categorías aprobadas porque la documentación no demuestra esa equivalencia.
- El basamento añadido en la segunda pasada expresa la existencia de estacionamientos y una base construida bajo las torres, pero no reproduce plazas, rampas ni cotas interiores una a una.
- Los interiores sin techo se generan por categoría aprobada (1R, 2R, 3R y PH). La zonificación de dormitorios, baños, cocina, salón y terraza se apoya en los planos y renders disponibles, pero no se presenta como una planta ejecutiva verificable de cada unidad concreta.

## Trazabilidad del modelo

- `src/data/torre-c.inventory.js`: inventario no sensible de las 57 unidades de Torre C transcrito del Dato Único oficial.
- `src/data/el-palmar.project.js`: configuración del conjunto y advertencias de procedencia.
- `src/model/project-builder.js`: volumetría paramétrica y geometrías independientes por unidad.
- `src/data/unit-data.js`: adapta cada unidad al contrato del visor sin generar estados ni importes ficticios.
