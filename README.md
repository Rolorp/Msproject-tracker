# Msproject-tracker

Webapp para registrar sesiones de MapleStory Classic World y calcular EXP y mesos por hora.

La app está publicada en [GitHub Pages](https://rolorp.github.io/Msproject-tracker/). Puedes abrirla desde el navegador del celular y utilizar **Tomar foto** dentro del lector de imágenes.

El código fuente se mantiene en `main`. GitHub Pages sirve los archivos compilados de la rama `gh-pages`, incluido el motor OCR y su modelo local.

El objetivo completo incluye perfiles de personaje, planificación legal de SP y comparaciones reproducibles según la metodología de MSHelper. La versión actual incorpora el tracker, los perfiles manuales y la lectura de valores numéricos desde imágenes con revisión.

## Ejecutar

Requiere Node.js 20 o posterior. Ejecuta `npm ci`, después `npm start` y abre `http://localhost:3000`. Puedes cambiar el puerto con la variable `PORT`.

El proyecto utiliza HTML, CSS y JavaScript con módulos nativos. `npm start` prepara los archivos locales del lector OCR antes de arrancar el servidor. Para un alojamiento estático, ejecuta `npm ci` y `npm run build` y publica el directorio `dist/` completo, incluido `vendor/`. Los archivos generados de terceros están excluidos del repositorio y se reconstruyen desde las versiones fijadas en `package-lock.json`.

## Primera versión

- Introducir personaje, mapa, nivel, EXP y mesos iniciales.
- Iniciar, pausar, reanudar y finalizar el cronómetro.
- Recuperar el cronómetro tras recargar o cerrar la pestaña mediante las marcas de tiempo guardadas.
- Introducir los valores finales y guardar los resultados en el historial.
- Consultar tasas por tiempo activo o por tiempo total, incluidas las pausas.
- Corregir depósitos, retiros y consumibles del inventario.
- Exportar el historial completo a CSV.

Los datos se guardan en el almacenamiento local del navegador y pertenecen al origen donde se ejecuta la app. Exporta el historial para conservar una copia. El reloj utiliza la hora del dispositivo, que debe mantenerse correcta durante la sesión.

## Perfiles de personaje, v0.2

Abre **Perfiles de personaje**, introduce nombre, clase, nivel y región, y guarda el personaje. Puedes añadir mundo, entorno live/test, parche observado, AP base, valores de combate, equipo, SP libres por avance y rangos actuales de habilidades. Los valores numéricos opcionales vacíos se conservan como desconocidos. Los nombres de clases y habilidades se introducen manualmente.

Selecciona el perfil en **Antes de empezar** para asociarlo a una sesión. El nombre y nivel se toman del perfil. Para actualizarlos, utiliza **Editar** en el perfil. La sesión conserva una copia del estado al iniciarla, consultable desde **Perfil usado en esta sesión**, aunque después modifiques el personaje. El CSV incluye el identificador y la copia del perfil en columnas adicionales.

Cada perfil identifica sus datos como manuales y su validación de reglas como pendiente. El formulario comprueba formatos y duplicados. La comprobación de prerrequisitos, caps, disponibilidad y legalidad de SP corresponde a la siguiente etapa. Los SP se registran por avance y los valores desconocidos mantienen ese estado.

Las sesiones guardadas con v0.1 siguen disponibles, incluidas las que estaban en curso. Los perfiles guardados sin sesiones asociadas permanecen en el navegador. La exportación CSV contiene las copias vinculadas a sesiones completadas.

## Lectura de imágenes, v0.3

Pulsa **Leer valores de una imagen** en el perfil, al iniciar una sesión o al finalizarla. Elige una foto o captura PNG, JPG o WebP de hasta 15 MB, pulsa **Leer imagen**, marca los campos detectados que quieres utilizar, corrige sus números y pulsa **Aplicar valores revisados**. Después puedes guardar el perfil o continuar con el flujo de la sesión. La aplicación de valores rellena el formulario y el guardado se realiza con su botón correspondiente.

Desde el celular también puedes pulsar **Tomar foto**. El control solicita la cámara trasera mediante la captura nativa del navegador y envía la foto al mismo flujo de previsualización, OCR y revisión. El navegador y el dispositivo determinan la disponibilidad de la cámara y pueden ofrecer un selector de archivos. Cancelar la cámara o el selector conserva la imagen que ya estuvieras revisando. La captura directa queda pendiente de prueba en un celular real.

La lectura utiliza Tesseract.js y su modelo en inglés en el navegador. La imagen, la previsualización y el texto leído se usan durante la revisión y se descartan al cerrar el diálogo. El motor, el worker y el modelo se sirven desde el mismo alojamiento de la app. Los datos que confirmes se guardan con el formulario correspondiente.

El extractor identifica etiquetas de nivel, EXP, mesos, HP/MP máximos, STR/DEX/INT/LUK base, Weapon Attack, Magic Attack, Accuracy y Avoidability. Los campos disponibles dependen del formulario abierto. El nombre, la clase, las habilidades y el equipo siguen siendo datos manuales. Para cambiar el nombre o nivel de un perfil seleccionado, edita ese perfil.

Los porcentajes de EXP requieren una tabla de EXP por nivel para convertirse a valores absolutos. El lector deja esos casos pendientes. Para atributos base, utiliza una etiqueta explícita como `BASE STR` o una expresión consistente como `STR 120 (100+20)`. Para HP y MP utiliza una etiqueta de máximo o una fracción actual/máximo. Los valores ambiguos o contradictorios quedan pendientes de corrección. Puedes revisar y corregir el texto OCR para volver a extraer los números.

Se verificó el motor con una imagen sintética, además de los casos de texto del parser. La precisión sobre capturas y fotos reales del juego sigue pendiente de contraste. La legibilidad, el tamaño de letra y la compresión afectan a la lectura.

## Cálculos

La EXP ganada es la diferencia entre la EXP final y la inicial, sumando la EXP requerida por cada nivel superado. Esta primera versión pide manualmente esos requisitos cuando subes de nivel. Cada resultado conserva los valores introducidos. Las pérdidas de EXP dentro del mismo nivel se reflejan como progreso neto negativo.

Los mesos netos se calculan como saldo final menos saldo inicial, menos depósitos externos, más retiros externos, menos el coste de consumibles del inventario usados en la sesión. Las compras pagadas durante la sesión ya reducen el saldo, por lo que se contabilizan una sola vez. El resultado mide el cambio neto de saldo ajustado, con las ventas cobradas durante ese periodo. Los objetos pendientes de vender quedan fuera de ese cálculo.

Cada tasa por hora equivale a la ganancia multiplicada por 3 600 000 y dividida entre la duración en milisegundos. El historial muestra las tasas por tiempo activo. El detalle permite elegir tiempo total.

## Verificación

Ejecuta `npm test` para verificar el cronómetro, los cálculos de EXP y mesos, los perfiles, la compatibilidad del almacenamiento, el servidor estático y la extracción OCR. La prueba del motor usa el modelo local y una imagen sintética de etiquetas numéricas. Ejecuta `npm run check` para comprobar la sintaxis. Los datos de personajes de las pruebas son sintéticos.

## Roadmap

1. Tracker de sesiones y exportación CSV, implementados en v0.1.
2. Perfiles manuales y copia del personaje al iniciar cada sesión, implementados en v0.2.
3. Planificador de SP desde cero o desde un personaje existente. Primera rama con datos verificados por parche, SP invertidos conservados y rutas legales. Ampliación progresiva a las demás clases verificadas.
4. Tabla de EXP de Classic World con fuente, parche y revisión documentados. Edición del historial, comparación por mapas y recuperación de copias exportadas.
5. Comparador de builds según objetivos elegidos, con alternativas, interacciones entre habilidades y cálculos reproducibles. Simulaciones de enemigos concretos cuando los modelos estén contrastados. Vinculación con sesiones observadas.
6. Seguimiento de fuentes y cambios de parche para revisar perfiles, catálogos y resultados afectados. Catálogos comunitarios y mediciones identificados por procedencia y grado de verificación.
7. Lectura de imágenes y revisión numérica, implementadas en v0.3. Pendientes la calibración con capturas reales y la sincronización entre dispositivos.
8. Rediseño del frontend, pendiente para una etapa posterior por decisión del usuario.

La incorporación de datos externos se hará por fuente y versión. El tracker inicial utiliza valores introducidos por el usuario. Para integrar catálogos o consultas automáticas a NiaDB se requiere la autorización descrita en su [política de reutilización](https://meowdb.com/reuse).

El lector utiliza [Tesseract.js](https://github.com/naptha/tesseract.js), bajo Apache-2.0, y el paquete [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng). La preparación conserva los avisos de licencia disponibles junto a los archivos generados.
