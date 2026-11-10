# Battle Royale 3D (Jueguito)

Battle royale en 3D, con vista en tercera persona, inspirado en Free Fire, Fortnite y Call of Duty.
Caes en un mapa con casas, cajas y árboles, recoges armas y botiquines, eliminas bots y te mantienes dentro de la zona segura hasta ser el último en pie.

Motor gráfico: **Three.js** (sombras, niebla, cielo, iluminación con tone mapping). Empaquetado para Android con **Capacitor**.

## Jugar en el navegador (PC)

Los módulos de JavaScript no funcionan abriendo el archivo directamente, así que primero instala dependencias y luego levanta un servidor local:

```bash
npm install
npm run copy-three       # copia Three.js a www/lib
npx serve www            # o: cd www && python3 -m http.server 8080
```

Abre la dirección que muestre (por ejemplo `http://localhost:3000`).

**Controles PC**

- `WASD`: moverse
- Ratón: mirar (haz clic en la pantalla para capturar el ratón; `Esc` lo libera)
- Clic izquierdo o `Espacio`: disparar
- `R`: recargar
- `H`: usar botiquín (+35 de vida)

**Controles celular**

- Joystick izquierdo (mitad izquierda): moverse
- Arrastrar en la mitad derecha: mirar
- Botón **DISPARAR**, **RECARGAR** y **+** (curar)

## Reglas

- 30 jugadores (tú + 29 bots).
- La zona se cierra por fases. Fuera de ella pierdes vida cada segundo.
- Armas: Pistola, Escopeta, Rifle y Francotirador, cada una con daño, cadencia, alcance y cargador distintos.
- Al pasar sobre un arma o botiquín en el suelo, lo recoges. Tu arma anterior queda en el suelo.
- Ganas si eres el último con vida.

## Generar el APK para Android

El APK se compila automáticamente en GitHub Actions cada vez que subes cambios a `main`:

1. Ve a la pestaña **Actions** del repositorio.
2. Abre la última ejecución de **Build APK**.
3. Descarga el artefacto **battle-royale-debug-apk**.
4. Pasa el `app-debug.apk` al celular e instálalo (hay que permitir la instalación de orígenes desconocidos).

También puedes lanzarla a mano en **Actions → Build APK → Run workflow**.

### Compilar en tu computadora (opcional)

Requisitos: Node.js 20+, JDK 17 y el Android SDK.

```bash
npm install
npm run copy-three
npx cap add android   # solo la primera vez
npm run build:apk
```

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

## Estructura

```
www/
  index.html        pantalla, HUD y menús
  style.css         estilos
  lib/              Three.js (se copia con npm run copy-three, no va en git)
  js/
    config.js       constantes: mapa, armas, fases de la zona
    logic.js        lógica: mapa, jugadores, bots, balas, zona, botín
    render.js       escena 3D, personajes, cielo, luces, efectos y cámara
    input.js        teclado, ratón y controles táctiles
    main.js         bucle principal y HUD
capacitor.config.json   configuración de la app Android
package.json            dependencias
.github/workflows/      compilación automática del APK
```

## Ideas para seguir

- Sonidos y música (Web Audio).
- Mapa con colinas, ríos y más variedad de edificios.
- Granadas, escudos y vehículos.
- Multijugador en línea (requiere un servidor).
