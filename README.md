# Battle Royale (Jueguito)

Juego de battle royale 2D en vista cenital, inspirado en Free Fire, Fortnite y Call of Duty.
Te lanzas al mapa, recoges armas y botiquines, eliminas bots y te mantienes dentro de la zona segura hasta ser el último en pie.

## Cómo jugar

**En el navegador (PC):** abre `www/index.html` con doble clic.

- `WASD` / flechas: mover
- Ratón: apuntar
- Clic izquierdo o `Espacio`: disparar
- `R`: recargar
- `H`: usar botiquín (+35 vida)

**En el celular (táctil):**

- Joystick izquierdo (mitad izquierda de la pantalla): mover
- Joystick derecho (mitad derecha): apuntar y disparar al mantenerlo
- Botón `+` (abajo a la derecha): usar botiquín

Al pasar sobre un arma o botiquín en el suelo, lo recoges automáticamente.

## Reglas

- 30 jugadores en total (tú + 29 bots).
- La zona blanca se va cerrando por fases. Fuera de ella pierdes vida cada segundo.
- Armas: Pistola, Escopeta, Rifle y Francotirador. Cada una tiene daño, cadencia, alcance y cargador distintos.
- Ganas si eres el último con vida. Pierdes si te eliminan.

## Generar el APK para Android

El APK se compila automáticamente en GitHub:

1. Sube el código a la rama `main` (ya está configurado).
2. Ve a la pestaña **Actions** del repositorio en GitHub.
3. Abre la ejecución **Build APK** más reciente y descarga el artefacto **battle-royale-debug-apk**.
4. Pasa el `app-debug.apk` al celular e instálalo (tendrás que permitir la instalación de orígenes desconocidos).

También puedes lanzar la compilación a mano desde **Actions → Build APK → Run workflow**.

### Compilar en tu propia computadora (opcional)

Requisitos: Node.js 20+, JDK 17 y Android Studio (con el SDK instalado).

```bash
npm install
npx cap add android   # solo la primera vez
npm run build:apk
```

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

## Estructura

```
www/
  index.html   pantalla principal y HUD
  style.css    estilos
  game.js      lógica del juego (mapa, bots, zona, armas, controles)
capacitor.config.json   configuración de la app Android
package.json            dependencias (Capacitor)
.github/workflows/      compilación automática del APK
```

## Ideas para seguir

- Más armas, granadas y escudos.
- Sonidos y efectos.
- Vehículos o un mapa más grande con edificios interiores.
- Modo multijugador en línea (requiere un servidor).
