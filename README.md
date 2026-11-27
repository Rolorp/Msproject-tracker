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

## Perfiles y captura del personaje, v0.4

Pulsa **Capturar personaje desde una foto** para crear un perfil a partir de una captura general. Muestra la ventana CHARACTER STAT con sus detalles y el inventario, lee la imagen, revisa los datos propuestos y pulsa **Aplicar datos revisados**. Después guarda el personaje. También puedes introducir y editar los datos desde **Perfiles de personaje**.

Puedes leer primero la ficha y después el inventario. Cada lectura rellena los campos seleccionados del mismo formulario y conserva los demás. Utiliza **Nuevo personaje** cuando quieras comenzar otro perfil.

Job y especialización se guardan por separado. El selector admite Warrior (Fighter, Page, Spearman), Magician (Wizard Fire/Poison, Wizard Ice/Lightning, Cleric), Bowman (Hunter, Crossbowman) y Thief (Assassin, Bandit), con especialización opcional. Los perfiles anteriores con ambos valores juntos se separan al editarlos. Catálogo acotado solicitado por el usuario, contrastado el 27 de noviembre de 2026 con [NiaDB Classes](https://meowdb.com/msclassic/classes); disponibilidad oficial pendiente de contraste directo con Nexon. No se aplican reglas de SP a partir de este catálogo.

El perfil conserva nombre, job y especialización, nivel, HP y MP actuales y máximos, EXP absoluta y porcentaje, mesos, Fame, AP libres, los totales de STR, DEX, INT y LUK. Los valores de combate incluyen el rango Attack, Weapon Def., Magic, Magic Def., Accuracy, Evasion, Crit. Rate, Crit. Damage, Speed y Jump. Los campos desconocidos quedan vacíos. Las habilidades y sus SP se registran manualmente.

Selecciona el perfil en **Antes de empezar** para asociarlo a una sesión. Se rellenan nombre, nivel, EXP y mesos registrados. Revisa los valores de inicio y actualiza el perfil si cambió el nivel. La sesión conserva una copia del estado al iniciarla, consultable desde **Perfil usado en esta sesión**, aunque después modifiques el personaje. Esa copia refleja los valores de EXP y mesos usados al iniciar la sesión. El CSV incluye el identificador y la copia del perfil en columnas adicionales.

Cada perfil identifica sus datos como manuales y su validación de reglas como pendiente. El formulario comprueba formatos y duplicados. La comprobación de prerrequisitos, caps, disponibilidad y legalidad de SP corresponde a la siguiente etapa. Los SP se registran por avance y los valores desconocidos mantienen ese estado.

Las sesiones guardadas con v0.1 siguen disponibles, incluidas las que estaban en curso. Los perfiles guardados sin sesiones asociadas permanecen en el navegador. La exportación CSV contiene las copias vinculadas a sesiones completadas.

## Lectura de imágenes

Pulsa **Leer valores de una imagen** dentro de un perfil o una sesión. Elige una foto o captura PNG, JPG o WebP de hasta 15 MB, pulsa **Leer imagen**, corrige los datos detectados y desmarca los que quieras omitir. Los campos detectados están seleccionados inicialmente. **Campos pendientes de lectura** permite completar los que falten. STR, DEX, INT y LUK tienen un solo campo cada uno: el total mostrado. De `222 (204+18)` se registra 222. Las bases de versiones anteriores se conservan internamente al editar perfiles, pero no aparecen en los formularios ni se reinterpretan como totales. Los campos ya rellenados y no detectados en una foto adicional se muestran como **Datos conservados del formulario**. **Aplicar datos revisados** rellena el formulario, que se guarda con su botón correspondiente. En los formularios de sesión se importan los valores propios del tracker. El botón principal **Capturar personaje desde una foto** importa la ficha completa al perfil.

Desde el celular también puedes pulsar **Tomar foto**. El control solicita la cámara trasera mediante la captura nativa del navegador y envía la foto al mismo flujo de previsualización, OCR y revisión. El navegador y el dispositivo determinan la disponibilidad de la cámara y pueden ofrecer un selector de archivos. Cancelar la cámara o el selector conserva la imagen que ya estuvieras revisando. La captura directa queda pendiente de prueba en un celular real.

La lectura utiliza Tesseract.js y su modelo en inglés en el navegador. La imagen, la previsualización y el texto leído se usan durante la revisión y se descartan al cerrar el diálogo. El motor, el worker y el modelo se sirven desde el mismo alojamiento de la app. Los datos que confirmes se guardan con el formulario correspondiente.

En fotos de monitor, se buscan las filas de color de la ficha y los detalles para aislar sus casillas. La detección exige la estructura completa de filas antes de asociar valores a campos. Se reduce el ruido fino de la foto y cada casilla se lee por separado, con un modo específico para números. El inventario se localiza mediante su icono de moneda y su casilla de saldo. Esto evita mezclar estadísticas con texto del chat o la barra inferior.

Cuando la estructura de las ventanas no se identifica, se utiliza la lectura general. El OCR conserva posiciones de palabras y recompone filas cuando etiquetas y valores aparecen en bloques distintos. Un rango de Attack conserva sus dos extremos. Los atributos guardan únicamente el total mostrado.

La EXP absoluta y su porcentaje se guardan por separado. Un porcentaje solo requiere la tabla por nivel para convertirse en EXP absoluta. Los paréntesis y los bonus de los atributos se ignoran al guardar el total. Para HP y MP se conserva la fracción actual/máximo. Los valores ambiguos o contradictorios quedan pendientes de corrección. Puedes revisar y corregir el texto OCR para volver a extraer los datos.

Las pruebas incluyen imágenes sintéticas, transcripciones y detección de paneles desplazados o incompletos. Para v0.4.2 se reprodujo la lectura incompleta con la foto de monitor aportada por el usuario y se calibró la lectura por casillas con ese archivo. HP y MP se separan por su barra diagonal y las casillas de AP y mesos se delimitan por su marco para evitar leer los bordes como dígitos. La foto de usuario se conserva fuera del repositorio. La legibilidad, los elementos tapados, los reflejos y la compresión siguen afectando a la lectura y requieren revisar los valores propuestos.

**Leer una zona concreta** permite elegir mesos, especialización o AP libres y marcar con dos toques las esquinas de su texto en la foto. Esa lectura se añade a los campos ya detectados y conserva las correcciones y las selecciones de revisión.

El escalado y el contraste de los recortes se calculan por píxel en JavaScript, usando sRGB al decodificar la imagen; no dependen del suavizado de Canvas de Safari o Chrome. Los recortes no reconocidos de mesos y especialización prueban también una variante binaria. La versión del lector y las dimensiones recibidas aparecen junto a la foto.

El saldo se asocia a la etiqueta MESOS de su misma línea, sin tomar cantidades de filas siguientes. La detección por recuadro busca también su etiqueta y exige dos importes completos coincidentes alineados a la derecha. La confianza del motor no se usa como umbral: la tipografía pixelada de una foto puede producir una lectura correcta con confianza baja. La especialización se busca bajo JOB y en la barra inferior sobre el nombre reconocido.

Si no se identifica el saldo por el recuadro del inventario, el lector busca también la etiqueta MESOS y vuelve a leer el importe a su izquierda. Un saldo no reconocido se anuncia como pendiente y puede completarse con otra foto del inventario sin borrar los demás campos aplicados.

Si un recorte falla, la lectura continúa con las otras ventanas. Cuando quedan campos pendientes, una lectura general de toda la imagen completa los huecos aunque ya se hayan detectado paneles. Esta recuperación conserva los valores leídos por ventana y evita que un recorte vacío deje toda la revisión sin datos.

## Captura de ventana en el PC

En Chrome o Edge de escritorio, pulsa **Compartir ventana** y selecciona MapleStory. Con la ficha y el inventario visibles, pulsa **Usar valores en el formulario**, revisa nivel, EXP absoluta y saldo, y pulsa **Iniciar sesión**. **Leer valores** vuelve a tomar la lectura inicial o final.

Durante la sesión se lee la EXP de la barra inferior cada pocos segundos. El saldo se actualiza con el inventario visible. Cada lectura conserva su propia hora de captura, y su tasa se calcula con el tiempo activo hasta esa lectura. La tasa de mesos en vivo refleja el cambio de saldo. Puedes ajustar transferencias y consumibles al guardar. Si subes de nivel o la barra solo muestra el porcentaje, sigue disponible el registro de EXP y requisitos manuales al finalizar.

Al pulsar **Finalizar** se congela el cronómetro y se toma otra lectura. Abre el inventario y vuelve a pulsar **Leer valores** si algún dato quedó pendiente. Revisa la lectura, aplícala al formulario y guarda. Puedes detener la captura desde la app o el navegador. La autorización de captura se vuelve a pedir al recargar. El OCR se ejecuta en el navegador y el historial guarda los valores confirmados. El flujo de fotos está disponible en cualquier momento.

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

La lectura de objetos equipados, sus estadísticas base, las sugerencias de armas y la simulación de scrolls quedan para desarrollo posterior. La captura básica utiliza los valores de CHARACTER STAT y del inventario.

La incorporación de datos externos se hará por fuente y versión. El tracker inicial utiliza valores introducidos por el usuario. Para integrar catálogos o consultas automáticas a NiaDB se requiere la autorización descrita en su [política de reutilización](https://meowdb.com/reuse).

El lector utiliza [Tesseract.js](https://github.com/naptha/tesseract.js), bajo Apache-2.0, y el paquete [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng). La preparación conserva los avisos de licencia disponibles junto a los archivos generados.
