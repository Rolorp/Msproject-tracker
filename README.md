# Msproject-tracker

Webapp para registrar sesiones de MapleStory Classic World y calcular EXP y mesos por hora.

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

## Cálculos

La EXP ganada es la diferencia entre la EXP final y la inicial, sumando la EXP requerida por cada nivel superado. Esta primera versión pide manualmente esos requisitos cuando subes de nivel. Cada resultado conserva los valores introducidos. Las pérdidas de EXP dentro del mismo nivel se reflejan como progreso neto negativo.

Los mesos netos se calculan como saldo final menos saldo inicial, menos depósitos externos, más retiros externos, menos el coste de consumibles del inventario usados en la sesión. Las compras pagadas durante la sesión ya reducen el saldo, por lo que se contabilizan una sola vez. El resultado mide el cambio neto de saldo ajustado, con las ventas cobradas durante ese periodo. Los objetos pendientes de vender quedan fuera de ese cálculo.

Cada tasa por hora equivale a la ganancia multiplicada por 3 600 000 y dividida entre la duración en milisegundos. El historial muestra las tasas por tiempo activo. El detalle permite elegir tiempo total.

## Verificación

Ejecuta `npm test` para verificar el cronómetro y los cálculos de EXP y mesos. Ejecuta `npm run check` para comprobar la sintaxis.

## Roadmap

1. Tracker de sesiones y exportación CSV, implementados en v0.1.
2. Edición del historial, comparación por mapas y recuperación de copias exportadas.
3. Tabla de EXP de Classic World con fuente, parche y revisión documentados.
4. Planificador de SP a partir del estado actual, con reglas de legalidad verificadas.
5. Comparador de builds con cálculos reproducibles y contraste con sesiones registradas.
6. Sincronización entre dispositivos e importación de capturas con confirmación de valores.

La incorporación de datos externos se hará por fuente y versión. El tracker inicial utiliza valores introducidos por el usuario. Para integrar catálogos o consultas automáticas a NiaDB se requiere la autorización descrita en su [política de reutilización](https://meowdb.com/reuse).
