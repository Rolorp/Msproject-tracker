# Msproject-tracker

Webapp para registrar sesiones de MapleStory Classic World y calcular EXP y mesos por hora.

El objetivo completo incluye perfiles de personaje, planificación legal de SP y comparaciones reproducibles según la metodología de MSHelper. La versión actual incorpora el tracker y los perfiles manuales.

## Ejecutar

Requiere Node.js 20 o posterior. Ejecuta `npm start` y abre `http://localhost:3000`. Puedes cambiar el puerto con la variable `PORT`.

El proyecto utiliza HTML, CSS y JavaScript con módulos nativos. Los archivos de la web están en `dist/` y se pueden servir desde un alojamiento estático.

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

## Cálculos

La EXP ganada es la diferencia entre la EXP final y la inicial, sumando la EXP requerida por cada nivel superado. Esta primera versión pide manualmente esos requisitos cuando subes de nivel. Cada resultado conserva los valores introducidos. Las pérdidas de EXP dentro del mismo nivel se reflejan como progreso neto negativo.

Los mesos netos se calculan como saldo final menos saldo inicial, menos depósitos externos, más retiros externos, menos el coste de consumibles del inventario usados en la sesión. Las compras pagadas durante la sesión ya reducen el saldo, por lo que se contabilizan una sola vez. El resultado mide el cambio neto de saldo ajustado, con las ventas cobradas durante ese periodo. Los objetos pendientes de vender quedan fuera de ese cálculo.

Cada tasa por hora equivale a la ganancia multiplicada por 3 600 000 y dividida entre la duración en milisegundos. El historial muestra las tasas por tiempo activo. El detalle permite elegir tiempo total.

## Verificación

Ejecuta `npm test` para verificar el cronómetro, los cálculos de EXP y mesos, los perfiles y la compatibilidad del almacenamiento. Ejecuta `npm run check` para comprobar la sintaxis. Los datos de personajes de las pruebas son sintéticos.

## Roadmap

1. Tracker de sesiones y exportación CSV, implementados en v0.1.
2. Perfiles manuales y copia del personaje al iniciar cada sesión, implementados en v0.2.
3. Planificador de SP desde cero o desde un personaje existente. Primera rama con datos verificados por parche, SP invertidos conservados y rutas legales. Ampliación progresiva a las demás clases verificadas.
4. Tabla de EXP de Classic World con fuente, parche y revisión documentados. Edición del historial, comparación por mapas y recuperación de copias exportadas.
5. Comparador de builds según objetivos elegidos, con alternativas, interacciones entre habilidades y cálculos reproducibles. Simulaciones de enemigos concretos cuando los modelos estén contrastados. Vinculación con sesiones observadas.
6. Seguimiento de fuentes y cambios de parche para revisar perfiles, catálogos y resultados afectados. Catálogos comunitarios y mediciones identificados por procedencia y grado de verificación.
7. Sincronización entre dispositivos e importación de capturas con confirmación de valores.
8. Rediseño del frontend, pendiente para una etapa posterior por decisión del usuario.

La incorporación de datos externos se hará por fuente y versión. El tracker inicial utiliza valores introducidos por el usuario. Para integrar catálogos o consultas automáticas a NiaDB se requiere la autorización descrita en su [política de reutilización](https://meowdb.com/reuse).
