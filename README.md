# IsoCity — constructor de ciudades isométrico

Juego de gestión urbana isométrico hecho con HTML5 (Canvas 2D y WebGL2) y JavaScript puro, con versión para Android.
**No usa ningún asset externo**: edificios, árboles, vehículos, terreno, iconos y hasta la música y los efectos de sonido se generan por código.

## Cómo jugar

- Abre `index.html` en cualquier navegador moderno. No necesita instalación. (Con `node build.js` se genera `IsoCity-standalone.html`, el juego completo en un solo archivo.)
- Opcional: `node serve.js` y abre http://localhost:5600

## Móvil y tablet

La interfaz se adapta sola a pantallas pequeñas (vertical y horizontal) y funciona con el dedo:

- **Un dedo**: usa la herramienta elegida (con ✋ mueve el mapa). Al construir, el punto de acción se sitúa por encima del dedo para que se vea; los edificios se colocan **al soltar** y soltar sobre la barra inferior **cancela**.
- **Dos dedos**: pellizco para el zoom y arrastre para mover el mapa.
- Botones laterales para rotar, zoom y abrir el minimapa con las vistas de datos; la velocidad se cambia con un solo botón; Presupuesto, Estadísticas, etc. están en el menú ☰.
- Para jugar en el teléfono: `node serve.js` en el PC y abre en el móvil (misma Wi-Fi) la dirección que muestra la consola, o copia al dispositivo el `IsoCity-standalone.html` generado con `node build.js`. En Opciones hay modo pantalla completa.
- **Rendimiento:** el juego se dibuja con **WebGL2** (atlas de sprites, prueba de profundidad y MSAA) y, si no está disponible, con Canvas 2D; se puede cambiar en Opciones → *Motor de dibujo*. También hay *Calidad gráfica* (Alta / Media / Baja), *Límite de fps* y un visor de FPS con detalles de diagnóstico. En móviles la calidad se elige sola y, si no se sostienen los fps, se baja la resolución de los sprites automáticamente.

## APK de Android

Hay un proyecto Android nativo mínimo en `android/` (un `WebView` a pantalla completa que carga el juego desde los assets; funciona sin internet y las partidas se guardan en el propio dispositivo).

- APK ya compilado: descárgalo en [Releases](https://github.com/ArisDDev/isocity/releases) (`IsoCity-<versión>.apk`). Cópialo al teléfono, ábrelo y permite "instalar apps desconocidas" para tu gestor de archivos/navegador. O con el móvil por USB: `adb install -r IsoCity-<versión>.apk`.
- Recompilar tras editar el juego (requiere JDK 17 y Android SDK 35): desde `android/` ejecuta `gradlew.bat assembleRelease`; el APK queda en `android/app/build/outputs/apk/release/IsoCity-<versión>.apk` y se copia también a la carpeta raíz del proyecto con ese nombre. La versión sale de `versionName` en `android/app/build.gradle`. Los archivos web se copian solos a los assets.
- Para firmar con tu propia clave crea `android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`); sin ese archivo se firma con la clave de depuración. La clave de firma no forma parte del repositorio.
- Botón Atrás: cierra ventanas/herramientas y, si no hay nada, sale. La partida se autoguarda al pasar a segundo plano.
- Los iconos se generan con `node tools/make-icon.js` (PNG sin dependencias): `icons/` y los recursos del APK.

## Controles (teclado y ratón)

| Acción | Control |
|---|---|
| Mover cámara | Botón derecho/central arrastrando · `WASD` / flechas · herramienta ✋ |
| Zoom | Rueda del ratón · `+` / `−` |
| Rotar la vista (4 ángulos) | `Q` / `E` |
| Construir | Elige categoría abajo y haz clic; calles y zonas se trazan arrastrando |
| Pausa / velocidad | `Espacio` · `1` `2` `3` |
| Demoler / Consultar / Mover | `B` / `X` / `H` |
| Vistas de datos | `V` o el selector del minimapa |
| Cancelar | `Esc` o clic derecho |

## Mecánicas

- **Terreno procedural** (isla, costa o lagos) de 48×48, 64×64 o 96×96, con semilla.
- **Carreteras** (calle y avenida) con puentes sobre el agua. Los vehículos recorren la red real, forman atascos y afectan al valor del suelo.
- **Zonas R/C/I**: los edificios crecen solos si hay carretera adyacente, electricidad y agua, y evolucionan de nivel 1 a 3 según el valor del suelo y la cobertura de servicios. Si faltan servicios, se abandonan.
- **Demanda R/C/I** dinámica (empleos vs. población, impuestos, felicidad, desempleo).
- **Infraestructuras por red**: electricidad (eólica, solar, carbón, nuclear) y agua (pozo, bombeo, potabilizadora) se reparten por cada red de carreteras; los apagones afectan a una parte de los edificios.
- **Servicios con radio de acción**: policía, bomberos (con camiones que acuden al fuego), clínica, hospital, escuela, universidad, parques, estadio, reciclaje, autobús y metro.
- **Mapas simulados**: valor del suelo, contaminación, crimen, tráfico y cobertura de cada servicio.
- **Economía**: impuestos por sector, financiación por departamento, mantenimiento, préstamos con interés, ordenanzas, subvenciones y quiebra.
- **Progresión**: nuevos edificios se desbloquean con la población; objetivos guiados y logros con recompensa.
- **Desastres**: incendios que se propagan, terremoto, meteorito y tornado.
- **Ambiente**: ciclo día/noche con ventanas y farolas iluminadas, lluvia, barcos, humo y vapor, música generativa.
- **Guardado**: 3 ranuras + autoguardado anual (localStorage) y exportar/importar a archivo.

## Estructura

```
index.html            página principal
css/style.css         interfaz (escritorio)
css/mobile.css        adaptación a móvil y tablet
manifest.webmanifest  datos para instalar como app (PWA)
icons/                iconos PNG de la app
android/              proyecto Android (WebView) para generar el APK
tools/make-icon.js    generador de los iconos
js/data.js            definiciones (edificios, ordenanzas, logros…)
js/sprites.js         sprites isométricos procedurales
js/world.js           mapa y generación de terreno
js/sim.js             simulación (economía, crecimiento, tráfico, desastres)
js/render.js          renderizado isométrico, cámara y efectos
js/glrender.js        dibujo WebGL2: atlas de sprites, suelo, objetos con profundidad y pase nocturno (la capa 2D lleva lo vectorial)
js/audio.js           sonido sintetizado (WebAudio)
js/ui.js              HUD, ventanas, minimapa
js/main.js            bucle principal, entrada y guardado
build.js              genera IsoCity-standalone.html
serve.js              servidor estático opcional
```

Para regenerar la versión de un solo archivo tras editar el código: `node build.js`.

## Licencia

Código disponible para verlo, estudiarlo y usarlo **sin fines comerciales** bajo la [PolyForm Noncommercial License 1.0.0](LICENSE). El uso comercial (vender el juego o una copia, incluirlo en un producto de pago, publicarlo con anuncios o compras, etc.) no está permitido sin permiso del autor.

Copyright (c) 2026 ArisDDev.
